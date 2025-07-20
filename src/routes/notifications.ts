import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware, requireAuthenticated } from "@/middleware/auth";
import { createError } from "@/middleware/errorHandler";
import { logger } from "@/config/logger";
import { markAsReadSchema, querySchema } from "@/utils/validation";
import { NotificationService } from "@/services/notification";
import * as z from "zod";
import { config } from "@/config";

const notifications = new Hono();

// Get user notifications
notifications.get(
	"/",
	authMiddleware,
	requireAuthenticated,
	zValidator("query", querySchema),
	async (c) => {
		try {
			const user = c.get("user");
			const query = c.req.valid("query");

			const result = await NotificationService.getUserNotifications(
				user.id,
				query.page,
				query.limit,
				query.unreadOnly,
			);

			return c.json({
				success: true,
				data: result.notifications,
				pagination: {
					page: query.page,
					limit: query.limit,
					total: result.total,
					totalPages: Math.ceil(result.total / query.limit),
				},
				meta: {
					unreadCount: result.unreadCount,
				},
			});
		} catch (error) {
			logger.error("Failed to get notifications", error as Error);
			throw createError.internal("Failed to retrieve notifications");
		}
	},
);

// Get unread notification count
notifications.get(
	"/unread-count",
	authMiddleware,
	requireAuthenticated,
	async (c) => {
		try {
			const user = c.get("user");

			const result = await NotificationService.getUserNotifications(
				user.id,
				1,
				1,
				true,
			);

			return c.json({
				success: true,
				data: {
					unreadCount: result.unreadCount,
				},
			});
		} catch (error) {
			logger.error("Failed to get unread count", error as Error);
			throw createError.internal("Failed to retrieve unread count");
		}
	},
);

// Mark notifications as read
notifications.patch(
	"/read",
	authMiddleware,
	requireAuthenticated,
	zValidator("json", markAsReadSchema),
	async (c) => {
		try {
			const user = c.get("user");
			const { notificationIds, markAll } = c.req.valid("json");

			let updatedCount = 0;

			if (markAll) {
				// Mark all notifications as read
				updatedCount = await NotificationService.markAllAsRead(user.id);
			} else if (notificationIds && notificationIds.length > 0) {
				// Mark specific notifications as read
				const promises = notificationIds.map((id) =>
					NotificationService.markAsRead(id, user.id),
				);
				const results = await Promise.all(promises);
				updatedCount = results.filter(Boolean).length;
			} else {
				throw createError.badRequest(
					"Either notificationIds or markAll must be provided",
				);
			}

			logger.info("Notifications marked as read", {
				userId: user.id,
				updatedCount,
				markAll: !!markAll,
			});

			return c.json({
				success: true,
				message: `${updatedCount} notification(s) marked as read`,
				data: {
					updatedCount,
				},
			});
		} catch (error) {
			logger.error("Failed to mark notifications as read", error as Error);
			throw error;
		}
	},
);

// Delete notification
notifications.delete(
	"/:id",
	authMiddleware,
	requireAuthenticated,
	async (c) => {
		try {
			const user = c.get("user");
			const notificationId = c.req.param("id");

			const deleted = await NotificationService.delete(notificationId, user.id);

			if (!deleted) {
				throw createError.notFound("Notification not found");
			}

			logger.info("Notification deleted", {
				userId: user.id,
				notificationId,
			});

			return c.json({
				success: true,
				message: "Notification deleted successfully",
			});
		} catch (error) {
			logger.error("Failed to delete notification", error as Error);
			throw error;
		}
	},
);

// Test notification (development only)
notifications.post(
	"/test",
	authMiddleware,
	requireAuthenticated,
	zValidator(
		"json",
		z.object({
			type: z.enum(["order", "stream", "product", "vendor", "system"]),
			title: z.string().min(1).max(255),
			message: z.string().min(1).max(1000),
			data: z.record(z.string(), z.unknown()).optional()
		}),
	),
	async (c) => {
		try {
			// Only allow in development environment
			if (config.server.nodeEnv === "production") {
				throw createError.forbidden(
					"Test notifications not allowed in production",
				);
			}

			const user = c.get("user");
			const { type, title, message, data } = c.req.valid("json");

			const notification = await NotificationService.create({
				userId: user.id,
				type,
				title,
				message,
				data,
			});

			return c.json({
				success: true,
				message: "Test notification sent",
				data: notification,
			});
		} catch (error) {
			logger.error("Failed to send test notification", error as Error);
			throw error;
		}
	},
);

export default notifications;