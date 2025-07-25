import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware, optionalAuthMiddleware } from "@/middleware/auth";
import { logger } from "@/config/logger";
import { getChatService } from "@/services/chatService";
import {
	addModeratorSchema,
	banUserSchema,
	sendMessageSchema,
	updateChatModeSchema,
	updateSettingsSchema,
} from "@/utils/validation";

const chat = new Hono();

chat.get("/:streamKey/messages", optionalAuthMiddleware, async (c) => {
	try {
		const streamKey = c.req.param("streamKey");
		const limit = parseInt(c.req.query("limit") || "50");
		const before = c.req.query("before");

		const chatService = await getChatService();
		const messages = await chatService.getChatMessages(
			streamKey,
			limit,
			before,
		);

		return c.json({
			success: true,
			data: {
				messages,
				streamKey,
			},
		});
	} catch (error) {
		logger.error("Failed to get chat messages", { error });
		return c.json(
			{
				success: false,
				error: "Failed to get chat messages",
			},
			500,
		);
	}
});

// Send chat message
chat.post(
	"/:streamKey/messages",
	authMiddleware,
	zValidator("json", sendMessageSchema),
	async (c) => {
		try {
			const streamKey = c.req.param("streamKey");
			const userId = c.get("userId");
			const { message, messageType } = c.req.valid("json");

			const chatService = await getChatService();
			const chatMessage = await chatService.sendMessage(
				streamKey,
				userId,
				message,
				messageType,
			);

			if (!chatMessage) {
				return c.json(
					{
						success: false,
						error: "Failed to send message",
					},
					400,
				);
			}

			return c.json({
				success: true,
				data: chatMessage,
			});
		} catch (error) {
			logger.error("Failed to send chat message", { error });
			return c.json(
				{
					success: false,
					error:
						error instanceof Error ? error.message : "Failed to send message",
				},
				400,
			);
		}
	},
);

// Delete chat message
chat.delete("/:streamKey/messages/:messageId", authMiddleware, async (c) => {
	try {
		const streamKey = c.req.param("streamKey");
		const messageId = c.req.param("messageId");
		const userId = c.get("userId");

		const chatService = await getChatService();
		const success = await chatService.deleteMessage(
			messageId,
			userId,
			streamKey,
		);

		if (!success) {
			return c.json(
				{
					success: false,
					error: "Failed to delete message or insufficient permissions",
				},
				403,
			);
		}

		return c.json({
			success: true,
			message: "Message deleted successfully",
		});
	} catch (error) {
		logger.error("Failed to delete chat message", { error });
		return c.json(
			{
				success: false,
				error: "Failed to delete message",
			},
			500,
		);
	}
});

// Ban user from chat
chat.post(
	"/:streamKey/ban",
	authMiddleware,
	zValidator("json", banUserSchema),
	async (c) => {
		try {
			const streamKey = c.req.param("streamKey");
			const bannedBy = c.get("userId");
			const { userId, duration } = c.req.valid("json");

			const chatService = await getChatService();
			const success = await chatService.banUser(
				streamKey,
				userId,
				bannedBy,
				duration,
			);

			if (!success) {
				return c.json(
					{
						success: false,
						error: "Failed to ban user or insufficient permissions",
					},
					403,
				);
			}

			return c.json({
				success: true,
				message: "User banned successfully",
				data: {
					userId,
					duration,
					bannedBy,
				},
			});
		} catch (error) {
			logger.error("Failed to ban user", { error });
			return c.json(
				{
					success: false,
					error: "Failed to ban user",
				},
				500,
			);
		}
	},
);

// Unban user from chat
chat.delete("/:streamKey/ban/:userId", authMiddleware, async (c) => {
	try {
		const streamKey = c.req.param("streamKey");
		const userId = c.req.param("userId");

		const chatService = await getChatService();
		const success = await chatService.unbanUser(streamKey, userId);

		if (!success) {
			return c.json(
				{
					success: false,
					error: "Failed to unban user",
				},
				400,
			);
		}

		return c.json({
			success: true,
			message: "User unbanned successfully",
		});
	} catch (error) {
		logger.error("Failed to unban user", { error });
		return c.json(
			{
				success: false,
				error: "Failed to unban user",
			},
			500,
		);
	}
});

// Add moderator
chat.post(
	"/:streamKey/moderators",
	authMiddleware,
	zValidator("json", addModeratorSchema),
	async (c) => {
		try {
			const streamKey = c.req.param("streamKey");
			const addedBy = c.get("userId");
			const { userId } = c.req.valid("json");

			const chatService = await getChatService();
			const success = await chatService.addModerator(
				streamKey,
				userId,
				addedBy,
			);

			if (!success) {
				return c.json(
					{
						success: false,
						error: "Failed to add moderator or insufficient permissions",
					},
					403,
				);
			}

			return c.json({
				success: true,
				message: "Moderator added successfully",
				data: {
					userId,
					addedBy,
				},
			});
		} catch (error) {
			logger.error("Failed to add moderator", { error });
			return c.json(
				{
					success: false,
					error: "Failed to add moderator",
				},
				500,
			);
		}
	},
);

// Update chat settings
chat.patch(
	"/:streamKey/settings",
	authMiddleware,
	zValidator("json", updateSettingsSchema),
	async (c) => {
		try {
			const streamKey = c.req.param("streamKey");
			const updatedBy = c.get("userId");
			const settings = c.req.valid("json");

			const chatService = await getChatService();
			const success = await chatService.updateChatSettings(
				streamKey,
				settings,
				updatedBy,
			);

			if (!success) {
				return c.json(
					{
						success: false,
						error: "Failed to update settings or insufficient permissions",
					},
					403,
				);
			}

			return c.json({
				success: true,
				message: "Chat settings updated successfully",
				data: settings,
			});
		} catch (error) {
			logger.error("Failed to update chat settings", { error });
			return c.json(
				{
					success: false,
					error: "Failed to update chat settings",
				},
				500,
			);
		}
	},
);

// Update chat mode (slow mode, subscriber only, etc.)
chat.patch(
	"/:streamKey/mode",
	authMiddleware,
	zValidator("json", updateChatModeSchema),
	async (c) => {
		try {
			const streamKey = c.req.param("streamKey");
			const updatedBy = c.get("userId");
			const modeSettings = c.req.valid("json");

			const chatService = await getChatService();

			// Get current chat room to update mode settings
			const chatRoom = (chatService as any).chatRooms.get(streamKey);

			if (!chatRoom) {
				return c.json(
					{
						success: false,
						error: "Chat room not found",
					},
					404,
				);
			}

			// Check permissions
			if (
				chatRoom.streamerId !== updatedBy &&
				!chatRoom.moderators.includes(updatedBy)
			) {
				return c.json(
					{
						success: false,
						error: "Insufficient permissions",
					},
					403,
				);
			}

			// Update mode settings
			if (modeSettings.slowMode !== undefined) {
				chatRoom.slowMode = modeSettings.slowMode;
			}
			if (modeSettings.subscriberOnly !== undefined) {
				chatRoom.subscriberOnly = modeSettings.subscriberOnly;
			}
			if (modeSettings.emotesOnly !== undefined) {
				chatRoom.emotesOnly = modeSettings.emotesOnly;
			}

			chatRoom.updatedAt = new Date();

			// Update in database and cache
			await (chatService as any).updateChatRoom(chatRoom);

			return c.json({
				success: true,
				message: "Chat mode updated successfully",
				data: {
					slowMode: chatRoom.slowMode,
					subscriberOnly: chatRoom.subscriberOnly,
					emotesOnly: chatRoom.emotesOnly,
				},
			});
		} catch (error) {
			logger.error("Failed to update chat mode", { error });
			return c.json(
				{
					success: false,
					error: "Failed to update chat mode",
				},
				500,
			);
		}
	},
);

// Get chat statistics
chat.get("/:streamKey/stats", authMiddleware, async (c) => {
	try {
		const streamKey = c.req.param("streamKey");

		const chatService = await getChatService();
		const stats = await chatService.getChatStats(streamKey);

		return c.json({
			success: true,
			data: stats,
		});
	} catch (error) {
		logger.error("Failed to get chat stats", { error });
		return c.json(
			{
				success: false,
				error: "Failed to get chat statistics",
			},
			500,
		);
	}
});

// Get chat room info
chat.get("/:streamKey/info", optionalAuthMiddleware, async (c) => {
	try {
		const streamKey = c.req.param("streamKey");

		const chatService = await getChatService();
		const chatRoom = chatService.chatRooms.get(streamKey);

		if (!chatRoom) {
			return c.json(
				{
					success: false,
					error: "Chat room not found",
				},
				404,
			);
		}

		// Return public info only
		const publicInfo = {
			streamKey: chatRoom.streamKey,
			isActive: chatRoom.isActive,
			viewerCount: chatRoom.viewerCount,
			messageCount: chatRoom.messageCount,
			slowMode: chatRoom.slowMode,
			subscriberOnly: chatRoom.subscriberOnly,
			emotesOnly: chatRoom.emotesOnly,
			settings: {
				maxMessageLength: chatRoom.settings.maxMessageLength,
				allowLinks: chatRoom.settings.allowLinks,
				allowEmotes: chatRoom.settings.allowEmotes,
				allowStickers: chatRoom.settings.allowStickers,
			},
			createdAt: chatRoom.createdAt,
		};

		return c.json({
			success: true,
			data: publicInfo,
		});
	} catch (error) {
		logger.error("Failed to get chat room info", { error });
		return c.json(
			{
				success: false,
				error: "Failed to get chat room info",
			},
			500,
		);
	}
});

export default chat;
