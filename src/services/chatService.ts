import { EventEmitter } from "events";
import { query } from "@/database/connection";
import { logger } from "@/config/logger";
import { ChatMessage, ChatRoom, ChatStats } from "@/types";
import { getRedisClient } from "@/database/redis";
import { createId } from "@paralleldrive/cuid2";
import {
	ChatRoomNotFoundError,
	UserBannedError,
	UserNotFoundError,
	MessageValidationError,
	SlowModeError,
	InsufficientPermissionsError,
	MessageNotFoundError,
	DatabaseOperationError,
	ChatServiceInitializationError,
} from "@/utils/chatErrors";
import { Filter } from "bad-words";

export class ChatService extends EventEmitter {
	readonly chatRooms: Map<string, ChatRoom> = new Map();
	readonly userLastMessage: Map<string, Date> = new Map();
	readonly messageCache: Map<string, ChatMessage[]> = new Map();
	private cleanupIntervals: NodeJS.Timeout[] = [];
	private readonly MAX_CACHED_MESSAGES = 100;
	private readonly DEFAULT_SLOW_MODE = 0;
	private readonly MAX_MESSAGE_LENGTH = 500;
	private readonly profanityFilter: Filter;

	private constructor() {
		super();
		this.profanityFilter = new Filter();
		this.profanityFilter.removeWords("hell");
	}

	static async create(): Promise<ChatService> {
		const service = new ChatService();
		await service.initializeService();
		return service;
	}

	private async initializeService(): Promise<void> {
		try {
			// Load active chat rooms from database
			await this.loadActiveChatRooms();

			// Setup cleanup intervals
			this.setupCleanupIntervals();

			logger.info("Chat service initialized");
		} catch (error) {
			logger.error("Failed to initialize chat service", error as Error);
			throw new ChatServiceInitializationError(error);
		}
	}

	async createChatRoom(
		streamKey: string,
		streamerId: string,
	): Promise<ChatRoom> {
		try {
			const chatRoom: ChatRoom = {
				streamKey,
				streamerId,
				isActive: true,
				viewerCount: 0,
				messageCount: 0,
				moderators: [streamerId], // Streamer is default moderator
				bannedUsers: [],
				slowMode: this.DEFAULT_SLOW_MODE,
				subscriberOnly: false,
				emotesOnly: false,
				settings: {
					maxMessageLength: this.MAX_MESSAGE_LENGTH,
					allowLinks: true,
					allowEmotes: true,
					allowStickers: true,
					profanityFilter: true,
				},
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			// Store in memory
			this.chatRooms.set(streamKey, chatRoom);
			this.messageCache.set(streamKey, []);

			// Store in database
			await this.saveChatRoomToDatabase(chatRoom);

			// Cache in Redis
			const redisClient = await getRedisClient();
			await redisClient.hSet("chat_rooms", streamKey, JSON.stringify(chatRoom));

			logger.info("Chat room created", { streamKey, streamerId });

			this.emit("chatRoomCreated", chatRoom);
			return chatRoom;
		} catch (error) {
			logger.error("Failed to create chat room", { streamKey, error });
			if (error instanceof DatabaseOperationError) {
				throw error;
			}
			throw new DatabaseOperationError("create chat room", error);
		}
	}

	async sendMessage(
		streamKey: string,
		userId: string,
		messageText: string,
		messageType: ChatMessage["messageType"] = "text",
		metadata?: ChatMessage["metadata"],
	): Promise<ChatMessage> {
		const chatRoom = this.chatRooms.get(streamKey);

		if (!chatRoom || !chatRoom.isActive) {
			logger.error("Chat room not found or inactive", { streamKey });
			throw new ChatRoomNotFoundError(streamKey);
		}

		// Check if user is banned
		const isBanned = await this.checkUserBanStatus(streamKey, userId);
		if (isBanned) {
			logger.error("User is banned from chat", { streamKey, userId });
			throw new UserBannedError(userId, streamKey);
		}

		// Check slow mode
		if (chatRoom.slowMode > 0) {
			const lastMessage = this.userLastMessage.get(`${streamKey}:${userId}`);
			if (lastMessage) {
				const timeSinceLastMessage =
					(Date.now() - lastMessage.getTime()) / 1000;
				if (timeSinceLastMessage < chatRoom.slowMode) {
					const remainingTime = chatRoom.slowMode - timeSinceLastMessage;
					logger.error("Slow mode active", {
						streamKey,
						userId,
						remainingTime,
					});
					throw new SlowModeError(remainingTime);
				}
			}
		}

		const validatedMessage = await this.validateMessage(messageText, chatRoom);

		const userInfo = await this.getUserInfo(userId);

		try {
			const message: ChatMessage = {
				id: `msg_${createId()}`,
				streamKey,
				userId,
				username: userInfo.username,
				userAvatar: userInfo.avatar,
				userRole: this.getUserRole(userId, chatRoom),
				message: validatedMessage,
				messageType,
				metadata,
				timestamp: new Date(),
				isDeleted: false,
			};

			await this.storeMessage(message);

			// Update user last message time
			this.userLastMessage.set(`${streamKey}:${userId}`, new Date());

			chatRoom.messageCount++;
			chatRoom.updatedAt = new Date();
			await this.updateChatRoom(chatRoom);

			logger.info("Message sent", {
				streamKey,
				userId,
				messageId: message.id,
				messageType,
			});

			this.emit("messageSent", message);
			return message;
		} catch (error) {
			logger.error("Failed to send message", { streamKey, userId, error });
			throw new DatabaseOperationError("send message", error);
		}
	}

	async deleteMessage(
		messageId: string,
		deletedBy: string,
		streamKey: string,
	): Promise<boolean> {
		const chatRoom = this.chatRooms.get(streamKey);

		if (!chatRoom) {
			logger.error("Chat room not found", { streamKey });
			throw new ChatRoomNotFoundError(streamKey);
		}

		// Check if user has permission to delete
		if (!this.canDeleteMessage(deletedBy, chatRoom)) {
			logger.error("Insufficient permissions to delete message", {
				deletedBy,
				streamKey,
			});
			throw new InsufficientPermissionsError("delete message");
		}

		try {
			// Update message in cache
			const messages = this.messageCache.get(streamKey) || [];
			const messageIndex = messages.findIndex((m) => m.id === messageId);

			if (messageIndex !== -1) {
				messages[messageIndex].isDeleted = true;
				messages[messageIndex].deletedBy = deletedBy;
				messages[messageIndex].deletedAt = new Date();
			}

			// Update in database
			const sql = `
        UPDATE chat_messages 
        SET is_deleted = true, deleted_by = $1, deleted_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND stream_key = $3
      `;
			const result = await query(sql, [deletedBy, messageId, streamKey]);

			if (result.rowCount === 0) {
				logger.error("Message not found", { messageId, streamKey });
				// throw new MessageNotFoundError(messageId);
				return false;
			}

			logger.info("Message deleted", { messageId, deletedBy, streamKey });

			this.emit("messageDeleted", { messageId, deletedBy, streamKey });
			return true;
		} catch (error) {
			if (error instanceof MessageNotFoundError) {
				throw error;
			}
			logger.error("Failed to delete message", { messageId, error });
			throw new DatabaseOperationError("delete message", error);
		}
	}

	async banUser(
		streamKey: string,
		userId: string,
		bannedBy: string,
		duration?: number,
	): Promise<boolean> {
		const chatRoom = this.chatRooms.get(streamKey);

		if (!chatRoom) {
			logger.error("Chat room not found", { streamKey });
			throw new ChatRoomNotFoundError(streamKey);
		}

		if (!this.canBanUser(bannedBy, chatRoom)) {
			logger.error("Insufficient permissions to ban user", {
				bannedBy,
				streamKey,
			});
			throw new InsufficientPermissionsError("ban user");
		}

		try {
			if (!chatRoom.bannedUsers.includes(userId)) {
				chatRoom.bannedUsers.push(userId);
			}

			await this.updateChatRoom(chatRoom);

			const sql = `
        INSERT INTO chat_bans (stream_key, user_id, banned_by, duration, created_at)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      `;
			await query(sql, [streamKey, userId, bannedBy, duration || null]);

			logger.info("User banned from chat", {
				streamKey,
				userId,
				bannedBy,
				duration,
			});

			this.emit("userBanned", { streamKey, userId, bannedBy, duration });
			return true;
		} catch (error) {
			logger.error("Failed to ban user", { streamKey, userId, error });
			throw new DatabaseOperationError("ban user", error);
		}
	}

	async unbanUser(streamKey: string, userId: string): Promise<boolean> {
		const chatRoom = this.chatRooms.get(streamKey);

		if (!chatRoom) {
			logger.error("Chat room not found", { streamKey });
			throw new ChatRoomNotFoundError(streamKey);
		}

		try {
			// Remove from banned users
			const index = chatRoom.bannedUsers.indexOf(userId);
			if (index > -1) {
				chatRoom.bannedUsers.splice(index, 1);
			}

			// Update chat room
			await this.updateChatRoom(chatRoom);

			// Update ban in database
			const sql = `
        UPDATE chat_bans 
        SET unbanned_at = CURRENT_TIMESTAMP
        WHERE stream_key = $1 AND user_id = $2 AND unbanned_at IS NULL
      `;
			await query(sql, [streamKey, userId]);

			logger.info("User unbanned from chat", { streamKey, userId });

			this.emit("userUnbanned", { streamKey, userId });
			return true;
		} catch (error) {
			logger.error("Failed to unban user", { streamKey, userId, error });
			throw new DatabaseOperationError("unban user", error);
		}
	}

	private async checkUserBanStatus(
		streamKey: string,
		userId: string,
	): Promise<boolean> {
		try {
			const sql = `
        SELECT duration, created_at 
        FROM chat_bans 
        WHERE stream_key = $1 AND user_id = $2 AND unbanned_at IS NULL
        ORDER BY created_at DESC 
        LIMIT 1
      `;
			const result = await query(sql, [streamKey, userId]);

			if (result.rows.length === 0) {
				return false; // No active ban
			}

			const ban = result.rows[0];

			// If it's a permanent ban (duration is null), user is banned
			if (ban.duration === null) {
				return true;
			}

			// Check if temporary ban has expired
			const banCreatedAt = new Date(ban.created_at);
			const banExpiresAt = new Date(
				banCreatedAt.getTime() + ban.duration * 60 * 1000,
			);
			const now = new Date();

			if (now >= banExpiresAt) {
				// Ban has expired, automatically unban the user
				await this.unbanUser(streamKey, userId);
				logger.info("Temporary ban expired and user unbanned", {
					streamKey,
					userId,
					banDuration: ban.duration,
				});
				return false;
			}

			return true; // Ban is still active
		} catch (error) {
			logger.error("Failed to check user ban status", {
				streamKey,
				userId,
				error,
			});
			// In case of error, default to not banned to avoid blocking legitimate users
			return false;
		}
	}

	async addModerator(
		streamKey: string,
		userId: string,
		addedBy: string,
	): Promise<boolean> {
		const chatRoom = this.chatRooms.get(streamKey);

		if (!chatRoom) {
			logger.error("Chat room not found", { streamKey });
			throw new ChatRoomNotFoundError(streamKey);
		}

		// Check if user has permission to add moderator
		if (chatRoom.streamerId !== addedBy) {
			logger.error("Insufficient permissions to add moderator", {
				addedBy,
				streamKey,
			});
			throw new InsufficientPermissionsError("add moderator");
		}

		try {
			// Add to moderators
			if (!chatRoom.moderators.includes(userId)) {
				chatRoom.moderators.push(userId);
			}

			// Update chat room
			await this.updateChatRoom(chatRoom);

			logger.info("Moderator added", { streamKey, userId, addedBy });

			this.emit("moderatorAdded", { streamKey, userId, addedBy });
			return true;
		} catch (error) {
			logger.error("Failed to add moderator", { streamKey, userId, error });
			throw new DatabaseOperationError("add moderator", error);
		}
	}

	async updateChatSettings(
		streamKey: string,
		settings: Partial<ChatRoom["settings"]>,
		updatedBy: string,
	): Promise<boolean> {
		const chatRoom = this.chatRooms.get(streamKey);

		if (!chatRoom) {
			logger.error("Chat room not found", { streamKey });
			throw new ChatRoomNotFoundError(streamKey);
		}

		// Check if user has permission to update settings
		if (!this.canUpdateSettings(updatedBy, chatRoom)) {
			logger.error("Insufficient permissions to update settings", {
				updatedBy,
				streamKey,
			});
			throw new InsufficientPermissionsError("update chat settings");
		}

		try {
			// Update settings
			chatRoom.settings = { ...chatRoom.settings, ...settings };
			chatRoom.updatedAt = new Date();

			// Update chat room
			await this.updateChatRoom(chatRoom);

			logger.info("Chat settings updated", { streamKey, settings, updatedBy });

			this.emit("settingsUpdated", { streamKey, settings, updatedBy });
			return true;
		} catch (error) {
			logger.error("Failed to update chat settings", { streamKey, error });
			throw new DatabaseOperationError("update chat settings", error);
		}
	}

	async getChatMessages(
		streamKey: string,
		limit: number = 50,
		before?: string,
	): Promise<ChatMessage[]> {
		try {
			const cachedMessages = this.messageCache.get(streamKey);

			if (cachedMessages && !before) {
				return cachedMessages.slice(-limit).filter((m) => !m.isDeleted);
			}

			// Query database
			let sql = `
        SELECT * FROM chat_messages 
        WHERE stream_key = $1 AND is_deleted = false
      `;
			const values: any[] = [streamKey];

			if (before) {
				sql += ` AND timestamp < $2`;
				values.push(before);
			}

			sql += ` ORDER BY timestamp DESC LIMIT $${values.length + 1}`;
			values.push(limit);

			const result = await query(sql, values);

			return result.rows.map(this.mapRowToChatMessage).reverse();
		} catch (error) {
			logger.error("Failed to get chat messages", { streamKey, error });
			throw new DatabaseOperationError("get chat messages", error);
		}
	}

	async getChatStats(streamKey: string): Promise<ChatStats> {
		const chatRoom = this.chatRooms.get(streamKey);

		if (!chatRoom) {
			logger.error("Chat room not found", { streamKey });
			throw new ChatRoomNotFoundError(streamKey);
		}

		try {
			// Get message count from last hour
			const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

			const messageCountSql = `
        SELECT COUNT(*) as count
        FROM chat_messages 
        WHERE stream_key = $1 AND timestamp > $2 AND is_deleted = false
      `;
			const messageCountResult = await query(messageCountSql, [
				streamKey,
				oneHourAgo,
			]);
			const messagesLastHour = parseInt(messageCountResult.rows[0].count);

			// Get active users
			const activeUsersSql = `
        SELECT COUNT(DISTINCT user_id) as count
        FROM chat_messages 
        WHERE stream_key = $1 AND timestamp > $2 AND is_deleted = false
      `;
			const activeUsersResult = await query(activeUsersSql, [
				streamKey,
				oneHourAgo,
			]);
			const activeUsers = parseInt(activeUsersResult.rows[0].count);

			// Get top chatters
			const topChattersSql = `
        SELECT user_id, username, COUNT(*) as message_count
        FROM chat_messages 
        WHERE stream_key = $1 AND timestamp > $2 AND is_deleted = false
        GROUP BY user_id, username
        ORDER BY message_count DESC
        LIMIT 10
      `;
			const topChattersResult = await query(topChattersSql, [
				streamKey,
				oneHourAgo,
			]);
			const topChatters = topChattersResult.rows.map(
				(row: {
					user_id: string;
					username: string;
					message_count: string;
				}) => ({
					userId: row.user_id,
					username: row.username,
					messageCount: parseInt(row.message_count),
				}),
			);

			return {
				totalMessages: chatRoom.messageCount,
				activeUsers,
				messagesPerMinute: Math.round(messagesLastHour / 60),
				topChatters,
				popularEmotes: [], //TODO: Would need to implement emote tracking
			};
		} catch (error) {
			logger.error("Failed to get chat stats", { streamKey, error });
			throw new DatabaseOperationError("get chat stats", error);
		}
	}

	async closeChatRoom(streamKey: string): Promise<void> {
		const chatRoom = this.chatRooms.get(streamKey);

		if (!chatRoom) {
			logger.error("Chat room not found", { streamKey });
			throw new ChatRoomNotFoundError(streamKey);
		}

		try {
			chatRoom.isActive = false;
			chatRoom.updatedAt = new Date();

			await this.updateChatRoom(chatRoom);

			this.chatRooms.delete(streamKey);
			this.messageCache.delete(streamKey);

			const redisClient = await getRedisClient();
			await redisClient.hDel("chat_rooms", streamKey);

			logger.info("Chat room closed", { streamKey });

			this.emit("chatRoomClosed", { streamKey });
		} catch (error) {
			logger.error("Failed to close chat room", { streamKey, error });
			throw new DatabaseOperationError("close chat room", error);
		}
	}

	async updateChatMode(
		streamKey: string,
		mode: {
			slowMode?: number;
			subscriberOnly?: boolean;
			emotesOnly?: boolean;
		},
		updatedBy: string,
	): Promise<void> {
		const chatRoom = this.chatRooms.get(streamKey);

		if (!chatRoom) {
			logger.error("Chat room not found", { streamKey });
			throw new ChatRoomNotFoundError(streamKey);
		}

		// Check if user has permission to update mode
		if (!this.canUpdateSettings(updatedBy, chatRoom)) {
			logger.error("Insufficient permissions to update chat mode", {
				updatedBy,
				streamKey,
			});
			throw new InsufficientPermissionsError("update chat mode");
		}

		try {
			// Update mode settings
			if (mode.slowMode !== undefined) {
				chatRoom.slowMode = mode.slowMode;
			}
			if (mode.subscriberOnly !== undefined) {
				chatRoom.subscriberOnly = mode.subscriberOnly;
			}
			if (mode.emotesOnly !== undefined) {
				chatRoom.emotesOnly = mode.emotesOnly;
			}

			chatRoom.updatedAt = new Date();

			// Update chat room
			await this.updateChatRoom(chatRoom);

			logger.info("Chat mode updated", { streamKey, mode, updatedBy });

			this.emit("modeUpdated", { streamKey, mode, updatedBy });
		} catch (error) {
			logger.error("Failed to update chat mode", { streamKey, error });
			throw new DatabaseOperationError("update chat mode", error);
		}
	}

	async getChatRoom(streamKey: string): Promise<ChatRoom | null> {
		return this.chatRooms.get(streamKey) || null;
	}

	// Helper methods
	private async validateMessage(
		message: string,
		chatRoom: ChatRoom,
	): Promise<string> {
		if (message.length > chatRoom.settings.maxMessageLength) {
			throw new MessageValidationError(
				`Message exceeds maximum length of ${chatRoom.settings.maxMessageLength} characters`,
			);
		}

		// Check for links if not allowed
		if (!chatRoom.settings.allowLinks && this.containsLinks(message)) {
			throw new MessageValidationError("Links are not allowed in this chat");
		}

		// Apply profanity filter if enabled
		if (chatRoom.settings.profanityFilter) {
			message = this.filterProfanity(message);
		}

		return message.trim();
	}

	private containsLinks(message: string): boolean {
		const urlRegex = /(https?:\/\/[^\s]+)/g;
		return urlRegex.test(message);
	}

	private filterProfanity(message: string): string {
		return this.profanityFilter.clean(message);
	}

	private getUserRole(
		userId: string,
		chatRoom: ChatRoom,
	): ChatMessage["userRole"] {
		if (userId === chatRoom.streamerId) return "streamer";
		if (chatRoom.moderators.includes(userId)) return "moderator";
		return "viewer";
	}

	private canDeleteMessage(userId: string, chatRoom: ChatRoom): boolean {
		return (
			userId === chatRoom.streamerId || chatRoom.moderators.includes(userId)
		);
	}

	private canBanUser(userId: string, chatRoom: ChatRoom): boolean {
		return (
			userId === chatRoom.streamerId || chatRoom.moderators.includes(userId)
		);
	}

	private canUpdateSettings(userId: string, chatRoom: ChatRoom): boolean {
		return (
			userId === chatRoom.streamerId || chatRoom.moderators.includes(userId)
		);
	}

	private async getUserInfo(userId: string): Promise<{
		username: string;
		avatar?: string;
	}> {
		try {
			const sql =
				"SELECT first_name, last_name, avatar_url FROM users WHERE id = $1";
			const result = await query(sql, [userId]);

			if (result.rows.length === 0) {
				logger.error("User not found", { userId });
				throw new UserNotFoundError(userId);
			}

			return {
				username:
					`${result.rows[0].first_name} ${result.rows[0].last_name}`.trim(),
				avatar: result.rows[0].avatar_url,
			};
		} catch (error) {
			if (error instanceof UserNotFoundError) {
				throw error;
			}
			logger.error("Failed to get user info", { userId, error });
			throw new DatabaseOperationError("get user info", error);
		}
	}

	private async storeMessage(message: ChatMessage): Promise<void> {
		try {
			const messages = this.messageCache.get(message.streamKey) || [];
			messages.push(message);

			// Keep only last MAX_CACHED_MESSAGES
			if (messages.length > this.MAX_CACHED_MESSAGES) {
				messages.shift();
			}

			this.messageCache.set(message.streamKey, messages);

			// Store in database
			const sql = `
      INSERT INTO chat_messages (
        id, stream_key, user_id, username, user_avatar, user_role,
        message, message_type, metadata, timestamp, is_deleted
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `;

			const values = [
				message.id,
				message.streamKey,
				message.userId,
				message.username,
				message.userAvatar || null,
				message.userRole,
				message.message,
				message.messageType,
				message.metadata ? JSON.stringify(message.metadata) : null,
				message.timestamp,
				message.isDeleted,
			];

			await query(sql, values);
		} catch (error) {
			throw new DatabaseOperationError("store message", error);
		}
	}

	private async saveChatRoomToDatabase(chatRoom: ChatRoom): Promise<void> {
		try {
			const sql = `
      INSERT INTO chat_rooms (
        stream_key, streamer_id, is_active, viewer_count, message_count,
        moderators, banned_users, slow_mode, subscriber_only, emotes_only,
        settings, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (stream_key) DO UPDATE SET
        is_active = EXCLUDED.is_active,
        viewer_count = EXCLUDED.viewer_count,
        message_count = EXCLUDED.message_count,
        moderators = EXCLUDED.moderators,
        banned_users = EXCLUDED.banned_users,
        slow_mode = EXCLUDED.slow_mode,
        subscriber_only = EXCLUDED.subscriber_only,
        emotes_only = EXCLUDED.emotes_only,
        settings = EXCLUDED.settings,
        updated_at = EXCLUDED.updated_at
    `;

			const values = [
				chatRoom.streamKey,
				chatRoom.streamerId,
				chatRoom.isActive,
				chatRoom.viewerCount,
				chatRoom.messageCount,
				JSON.stringify(chatRoom.moderators),
				JSON.stringify(chatRoom.bannedUsers),
				chatRoom.slowMode,
				chatRoom.subscriberOnly,
				chatRoom.emotesOnly,
				JSON.stringify(chatRoom.settings),
				chatRoom.createdAt,
				chatRoom.updatedAt,
			];

			await query(sql, values);
		} catch (error) {
			throw new DatabaseOperationError("save chat room to database", error);
		}
	}

	private async updateChatRoom(chatRoom: ChatRoom): Promise<void> {
		try {
			this.chatRooms.set(chatRoom.streamKey, chatRoom);
			await this.saveChatRoomToDatabase(chatRoom);
			const redisClient = await getRedisClient();
			await redisClient.hSet(
				"chat_rooms",
				chatRoom.streamKey,
				JSON.stringify(chatRoom),
			);
		} catch (error) {
			throw new DatabaseOperationError("update chat room", error);
		}
	}

	private async loadActiveChatRooms(): Promise<void> {
		try {
			const sql = "SELECT * FROM chat_rooms WHERE is_active = true";
			const result = await query(sql);

			for (const row of result.rows) {
				const chatRoom = this.mapRowToChatRoom(row);
				this.chatRooms.set(chatRoom.streamKey, chatRoom);
				this.messageCache.set(chatRoom.streamKey, []);
			}

			logger.info("Loaded active chat rooms", { count: result.rows.length });
		} catch (error) {
			logger.error("Failed to load active chat rooms", error as Error);
			throw new DatabaseOperationError("load active chat rooms", error);
		}
	}

	private setupCleanupIntervals(): void {
		const messageCleanupInterval = setInterval(
			() => {
				this.cleanupOldMessages();
			},
			60 * 60 * 1000,
		);

		const banCleanupInterval = setInterval(
			() => {
				this.cleanupExpiredBans();
			},
			10 * 60 * 1000,
		);

		this.cleanupIntervals.push(messageCleanupInterval, banCleanupInterval);

		logger.info("Cleanup intervals started", {
			intervalCount: this.cleanupIntervals.length,
		});
	}

	/**
	 * Clear all cleanup intervals to prevent memory leaks
	 * Should be called when the service is stopped or restarted
	 */
	public clearCleanupIntervals(): void {
		this.cleanupIntervals.forEach((interval) => {
			clearInterval(interval);
		});
		this.cleanupIntervals = [];

		logger.info("All cleanup intervals cleared");
	}

	/**
	 * Gracefully shutdown the chat service
	 * Clears all intervals and performs cleanup
	 */
	public async shutdown(): Promise<void> {
		try {
			logger.info("Shutting down chat service...");

			this.clearCleanupIntervals();

			// Close all active chat rooms
			const activeRooms = Array.from(this.chatRooms.keys());
			for (const streamKey of activeRooms) {
				await this.closeChatRoom(streamKey);
			}

			// Clear all caches
			this.chatRooms.clear();
			this.messageCache.clear();
			this.userLastMessage.clear();

			logger.info("Chat service shutdown completed");
		} catch (error) {
			logger.error("Error during chat service shutdown", error as Error);
			throw error;
		}
	}

	private async cleanupOldMessages(): Promise<void> {
		try {
			const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

			const sql = "DELETE FROM chat_messages WHERE timestamp < $1";
			const result = await query(sql, [cutoffDate]);

			logger.info("Cleaned up old chat messages", { deleted: result.rowCount });
		} catch (error) {
			logger.error("Failed to cleanup old messages", error as Error);
			// Don't throw error for cleanup operations to avoid disrupting service
		}
	}

	private async cleanupExpiredBans(): Promise<void> {
		try {
			const sql = `
        SELECT stream_key, user_id FROM chat_bans 
        WHERE duration IS NOT NULL 
        AND created_at + INTERVAL '1 minute' * duration < NOW()
        AND unbanned_at IS NULL
      `;
			const result = await query(sql);

			for (const row of result.rows) {
				await this.unbanUser(row.stream_key, row.user_id);
			}

			logger.info("Cleaned up expired bans", { count: result.rows.length });
		} catch (error) {
			logger.error("Failed to cleanup expired bans", error as Error);
			// Don't throw error for cleanup operations to avoid disrupting service
		}
	}

	private mapRowToChatRoom(row: any): ChatRoom {
		return {
			streamKey: row.stream_key,
			streamerId: row.streamer_id,
			isActive: row.is_active,
			viewerCount: row.viewer_count,
			messageCount: row.message_count,
			moderators: JSON.parse(row.moderators || "[]"),
			bannedUsers: JSON.parse(row.banned_users || "[]"),
			slowMode: row.slow_mode,
			subscriberOnly: row.subscriber_only,
			emotesOnly: row.emotes_only,
			settings: JSON.parse(row.settings),
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	private mapRowToChatMessage(row: any): ChatMessage {
		return {
			id: row.id,
			streamKey: row.stream_key,
			userId: row.user_id,
			username: row.username,
			userAvatar: row.user_avatar,
			userRole: row.user_role,
			message: row.message,
			messageType: row.message_type,
			metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
			timestamp: row.timestamp,
			isDeleted: row.is_deleted,
			deletedBy: row.deleted_by,
			deletedAt: row.deleted_at,
		};
	}
}

let chatService: ChatService | null = null;

export const getChatService = async (): Promise<ChatService> => {
	if (!chatService) {
		chatService = await ChatService.create();
	}

	return chatService;
};

/**
 * Shutdown the chat service and clear the singleton instance
 * Useful for testing or graceful application shutdown
 */
export const shutdownChatService = async (): Promise<void> => {
	if (chatService) {
		await chatService.shutdown();
		chatService = null;
	}
};

export default ChatService;
