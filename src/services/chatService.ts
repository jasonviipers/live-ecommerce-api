import { EventEmitter } from "events";
import { query } from "@/database/connection";
import { logger } from "@/config/logger";
import { ChatMessage, ChatRoom, ChatStats } from "@/types";
import { getRedisClient } from "@/database/redis";

export class ChatService extends EventEmitter {
	private chatRooms: Map<string, ChatRoom> = new Map();
	private userLastMessage: Map<string, Date> = new Map();
	private messageCache: Map<string, ChatMessage[]> = new Map();
	private readonly MAX_CACHED_MESSAGES = 100;
	private readonly DEFAULT_SLOW_MODE = 0;
	private readonly MAX_MESSAGE_LENGTH = 500;

	constructor() {
		super();
		this.initializeService();
	}

	// Initialize chat service
	private async initializeService(): Promise<void> {
		try {
			// Load active chat rooms from database
			await this.loadActiveChatRooms();

			// Setup cleanup intervals
			this.setupCleanupIntervals();

			logger.info("Chat service initialized");
		} catch (error) {
			logger.error("Failed to initialize chat service", error as Error);
		}
	}

	// Create chat room for stream
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
			throw error;
		}
	}

	// Send message to chat
	async sendMessage(
		streamKey: string,
		userId: string,
		messageText: string,
		messageType: ChatMessage["messageType"] = "text",
		metadata?: ChatMessage["metadata"],
	): Promise<ChatMessage | null> {
		try {
			const chatRoom = this.chatRooms.get(streamKey);

			if (!chatRoom || !chatRoom.isActive) {
				throw new Error("Chat room not found or inactive");
			}

			// Check if user is banned
			if (chatRoom.bannedUsers.includes(userId)) {
				throw new Error("User is banned from chat");
			}

			// Check slow mode
			if (chatRoom.slowMode > 0) {
				const lastMessage = this.userLastMessage.get(`${streamKey}:${userId}`);
				if (lastMessage) {
					const timeSinceLastMessage =
						(Date.now() - lastMessage.getTime()) / 1000;
					if (timeSinceLastMessage < chatRoom.slowMode) {
						throw new Error(
							`Slow mode: ${chatRoom.slowMode - timeSinceLastMessage}s remaining`,
						);
					}
				}
			}

			// Validate message
			const validatedMessage = await this.validateMessage(
				messageText,
				chatRoom,
			);

			if (!validatedMessage) {
				throw new Error("Message validation failed");
			}

			// Get user info
			const userInfo = await this.getUserInfo(userId);

			if (!userInfo) {
				throw new Error("User not found");
			}

			// Create message
			const message: ChatMessage = {
				id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
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

			// Store message
			await this.storeMessage(message);

			// Update user last message time
			this.userLastMessage.set(`${streamKey}:${userId}`, new Date());

			// Update chat room stats
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
			return null;
		}
	}

	// Delete message
	async deleteMessage(
		messageId: string,
		deletedBy: string,
		streamKey: string,
	): Promise<boolean> {
		try {
			const chatRoom = this.chatRooms.get(streamKey);

			if (!chatRoom) {
				return false;
			}

			// Check if user has permission to delete
			if (!this.canDeleteMessage(deletedBy, chatRoom)) {
				return false;
			}

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
			await query(sql, [deletedBy, messageId, streamKey]);

			logger.info("Message deleted", { messageId, deletedBy, streamKey });

			this.emit("messageDeleted", { messageId, deletedBy, streamKey });
			return true;
		} catch (error) {
			logger.error("Failed to delete message", { messageId, error });
			return false;
		}
	}

	// Ban user from chat
	async banUser(
		streamKey: string,
		userId: string,
		bannedBy: string,
		duration?: number, // minutes, undefined for permanent
	): Promise<boolean> {
		try {
			const chatRoom = this.chatRooms.get(streamKey);

			if (!chatRoom) {
				return false;
			}

			// Check if user has permission to ban
			if (!this.canBanUser(bannedBy, chatRoom)) {
				return false;
			}

			// Add to banned users
			if (!chatRoom.bannedUsers.includes(userId)) {
				chatRoom.bannedUsers.push(userId);
			}

			// Update chat room
			await this.updateChatRoom(chatRoom);

			// Store ban in database
			const sql = `
        INSERT INTO chat_bans (stream_key, user_id, banned_by, duration, created_at)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      `;
			await query(sql, [streamKey, userId, bannedBy, duration || null]);

			// Schedule unban if duration is specified
			if (duration) {
				setTimeout(
					() => {
						this.unbanUser(streamKey, userId);
					},
					duration * 60 * 1000,
				);
			}

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
			return false;
		}
	}

	// Unban user from chat
	async unbanUser(streamKey: string, userId: string): Promise<boolean> {
		try {
			const chatRoom = this.chatRooms.get(streamKey);

			if (!chatRoom) {
				return false;
			}

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
			return false;
		}
	}

	async addModerator(
		streamKey: string,
		userId: string,
		addedBy: string,
	): Promise<boolean> {
		try {
			const chatRoom = this.chatRooms.get(streamKey);

			if (!chatRoom) {
				return false;
			}

			// Check if user has permission to add moderator
			if (chatRoom.streamerId !== addedBy) {
				return false;
			}

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
			return false;
		}
	}

	// Update chat settings
	async updateChatSettings(
		streamKey: string,
		settings: Partial<ChatRoom["settings"]>,
		updatedBy: string,
	): Promise<boolean> {
		try {
			const chatRoom = this.chatRooms.get(streamKey);

			if (!chatRoom) {
				return false;
			}

			// Check if user has permission to update settings
			if (!this.canUpdateSettings(updatedBy, chatRoom)) {
				return false;
			}

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
			return false;
		}
	}

	// Get chat messages
	async getChatMessages(
		streamKey: string,
		limit: number = 50,
		before?: string,
	): Promise<ChatMessage[]> {
		try {
			// Try cache first
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
			return [];
		}
	}

	// Get chat statistics
	async getChatStats(streamKey: string): Promise<ChatStats> {
		try {
			const chatRoom = this.chatRooms.get(streamKey);

			if (!chatRoom) {
				throw new Error("Chat room not found");
			}

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
			throw error;
		}
	}

	// Close chat room
	async closeChatRoom(streamKey: string): Promise<boolean> {
		try {
			const chatRoom = this.chatRooms.get(streamKey);

			if (!chatRoom) {
				return false;
			}

			chatRoom.isActive = false;
			chatRoom.updatedAt = new Date();

			await this.updateChatRoom(chatRoom);

			this.chatRooms.delete(streamKey);
			this.messageCache.delete(streamKey);

			const redisClient = await getRedisClient();
			await redisClient.hDel("chat_rooms", streamKey);

			logger.info("Chat room closed", { streamKey });

			this.emit("chatRoomClosed", { streamKey });
			return true;
		} catch (error) {
			logger.error("Failed to close chat room", { streamKey, error });
			return false;
		}
	}

	// Helper methods
	private async validateMessage(
		message: string,
		chatRoom: ChatRoom,
	): Promise<string | null> {
		// Check message length
		if (message.length > chatRoom.settings.maxMessageLength) {
			return null;
		}

		// Check for links if not allowed
		if (!chatRoom.settings.allowLinks && this.containsLinks(message)) {
			return null;
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
		// Simple profanity filter - in production, use a proper library
		const profanityWords = ["badword1", "badword2"]; // Add actual words
		let filtered = message;

		profanityWords.forEach((word) => {
			const regex = new RegExp(word, "gi");
			filtered = filtered.replace(regex, "*".repeat(word.length));
		});

		return filtered;
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
	} | null> {
		try {
			const sql = "SELECT username, avatar FROM users WHERE id = $1";
			const result = await query(sql, [userId]);

			if (result.rows.length === 0) {
				return null;
			}

			return {
				username: result.rows[0].username,
				avatar: result.rows[0].avatar,
			};
		} catch (error) {
			logger.error("Failed to get user info", { userId, error });
			return null;
		}
	}

	private async storeMessage(message: ChatMessage): Promise<void> {
		// Store in cache
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
	}

	private async saveChatRoomToDatabase(chatRoom: ChatRoom): Promise<void> {
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
	}

	private async updateChatRoom(chatRoom: ChatRoom): Promise<void> {
		this.chatRooms.set(chatRoom.streamKey, chatRoom);
		await this.saveChatRoomToDatabase(chatRoom);
		const redisClient = await getRedisClient();
		await redisClient.hSet(
			"chat_rooms",
			chatRoom.streamKey,
			JSON.stringify(chatRoom),
		);
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
		}
	}

	private setupCleanupIntervals(): void {
		// Clean up old messages every hour
		setInterval(
			() => {
				this.cleanupOldMessages();
			},
			60 * 60 * 1000,
		);

		// Clean up expired bans every 10 minutes
		setInterval(
			() => {
				this.cleanupExpiredBans();
			},
			10 * 60 * 1000,
		);
	}

	private async cleanupOldMessages(): Promise<void> {
		try {
			const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

			const sql = "DELETE FROM chat_messages WHERE timestamp < $1";
			const result = await query(sql, [cutoffDate]);

			logger.info("Cleaned up old chat messages", { deleted: result.rowCount });
		} catch (error) {
			logger.error("Failed to cleanup old messages", error as Error);
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

// Create singleton instance
let chatService: ChatService | null = null;

export const getChatService = (): ChatService => {
	if (!chatService) {
		chatService = new ChatService();
	}

	return chatService;
};

export default ChatService;
