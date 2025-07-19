import { query } from "@/database/connection";
import { getSocketManager } from "@/config/socket";
import { logger } from "@/config/logger";
import type { CreateNotificationData, Notification } from "@/types";

export class NotificationService {
	static async create(data: CreateNotificationData): Promise<Notification> {
		try {
			const sql = `
        INSERT INTO notifications (user_id, type, title, message, data)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `;

			const values = [
				data.userId,
				data.type,
				data.title,
				data.message,
				data.data ? JSON.stringify(data.data) : null,
			];

			const result = await query(sql, values);
			const notification = this.mapRowToNotification(result.rows[0]);

			// Send real-time notification
			await this.sendRealTimeNotification(notification);

			logger.info("Notification created and sent", {
				notificationId: notification.id,
				userId: data.userId,
				type: data.type,
			});

			return notification;
		} catch (error) {
			logger.error("Failed to create notification", error as Error);
			throw error;
		}
	}

	// Send real-time notification via Socket.io
	static async sendRealTimeNotification(
		notification: Notification,
	): Promise<void> {
		try {
			const socketManager = getSocketManager();
			await socketManager.sendNotification(notification.userId, {
				id: notification.id,
				type: notification.type,
				title: notification.title,
				message: notification.message,
				data: notification.data,
				createdAt: notification.createdAt,
			});
		} catch (error) {
			logger.error("Failed to send real-time notification", error as Error);
			// Don't throw error as notification is already saved in database
		}
	}

	// Get user notifications
	static async getUserNotifications(
		userId: string,
		page: number = 1,
		limit: number = 20,
		unreadOnly: boolean = false,
	): Promise<{
		notifications: Notification[];
		total: number;
		unreadCount: number;
	}> {
		const offset = (page - 1) * limit;

		let whereClause = "WHERE user_id = $1";
		const values: any[] = [userId];
		let paramCount = 1;

		if (unreadOnly) {
			whereClause += " AND is_read = false";
		}

		// Get total count
		const countSql = `SELECT COUNT(*) FROM notifications ${whereClause}`;
		const countResult = await query(countSql, values);
		const total = parseInt(countResult.rows[0].count);

		// Get unread count
		const unreadCountSql =
			"SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false";
		const unreadCountResult = await query(unreadCountSql, [userId]);
		const unreadCount = parseInt(unreadCountResult.rows[0].count);

		// Get notifications
		const sql = `
			SELECT * FROM notifications 
			${whereClause}
			ORDER BY created_at DESC
			LIMIT $${++paramCount} OFFSET $${++paramCount}
		`;
		values.push(limit, offset);

		const result = await query(sql, values);
		const notifications = result.rows.map(this.mapRowToNotification);

		return { notifications, total, unreadCount };
	}

	// Mark notification as read
	static async markAsRead(
		notificationId: string,
		userId: string,
	): Promise<boolean> {
		const sql = `
      UPDATE notifications 
      SET is_read = true, read_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND user_id = $2 AND is_read = false
      RETURNING *
    `;

		const result = await query(sql, [notificationId, userId]);
		return result.rowCount > 0;
	}

	// Mark all notifications as read for user
	static async markAllAsRead(userId: string): Promise<number> {
		const sql = `
			UPDATE notifications 
			SET is_read = true, read_at = CURRENT_TIMESTAMP
			WHERE user_id = $1 AND is_read = false
			RETURNING *
		`;

		const result = await query(sql, [userId]);
		return result.rowCount;
	}

	// Delete notification
	static async delete(
		notificationId: string,
		userId: string,
	): Promise<boolean> {
		const sql = "DELETE FROM notifications WHERE id = $1 AND user_id = $2";
		const result = await query(sql, [notificationId, userId]);
		return result.rowCount > 0;
	}

	// Bulk notification methods for common scenarios
	static async notifyOrderStatusChange(
		userId: string,
		orderId: string,
		orderNumber: string,
		status: string,
	): Promise<void> {
		const statusMessages = {
			confirmed: "Your order has been confirmed",
			processing: "Your order is being processed",
			shipped: "Your order has been shipped",
			delivered: "Your order has been delivered",
			cancelled: "Your order has been cancelled",
			refunded: "Your order has been refunded",
		};

		await this.create({
			userId,
			type: "order",
			title: "Order Status Update",
			message:
				statusMessages[status as keyof typeof statusMessages] ||
				`Order status changed to ${status}`,
			data: { orderId, orderNumber, status },
		});
	}

	static async notifyStreamStarted(
		userId: string,
		streamId: string,
		streamTitle: string,
		vendorName: string,
	): Promise<void> {
		await this.create({
			userId,
			type: "stream",
			title: "Live Stream Started",
			message: `${vendorName} is now live: ${streamTitle}`,
			data: { streamId, streamTitle, vendorName },
		});
	}

	static async notifyProductBackInStock(
		userId: string,
		productId: string,
		productName: string,
	): Promise<void> {
		await this.create({
			userId,
			type: "product",
			title: "Product Back in Stock",
			message: `${productName} is now available`,
			data: { productId, productName },
		});
	}

	static async notifyVendorNewOrder(
		vendorId: string,
		orderId: string,
		orderNumber: string,
		customerName: string,
		totalAmount: number,
	): Promise<void> {
		await this.create({
			userId: vendorId,
			type: "vendor",
			title: "New Order Received",
			message: `New order #${orderNumber} from ${customerName} - $${totalAmount.toFixed(2)}`,
			data: { orderId, orderNumber, customerName, totalAmount },
		});
	}

	static async notifyVendorLowStock(
		vendorId: string,
		productId: string,
		productName: string,
		currentStock: number,
		threshold: number,
	): Promise<void> {
		await this.create({
			userId: vendorId,
			type: "vendor",
			title: "Low Stock Alert",
			message: `${productName} is running low (${currentStock} left, threshold: ${threshold})`,
			data: { productId, productName, currentStock, threshold },
		});
	}

	static async notifySystemMaintenance(
		userId: string,
		maintenanceDate: Date,
		duration: string,
	): Promise<void> {
		await this.create({
			userId,
			type: "system",
			title: "Scheduled Maintenance",
			message: `System maintenance scheduled for ${maintenanceDate.toLocaleDateString()} (${duration})`,
			data: { maintenanceDate, duration },
		});
	}

	// Bulk send notifications to multiple users
	static async sendBulkNotifications(
		userIds: string[],
		notificationData: Omit<CreateNotificationData, "userId">,
	): Promise<void> {
		const promises = userIds.map((userId) =>
			this.create({ ...notificationData, userId }),
		);

		await Promise.allSettled(promises);

		logger.info("Bulk notifications sent", {
			userCount: userIds.length,
			type: notificationData.type,
		});
	}

	// Clean up old notifications
	static async cleanupOldNotifications(daysOld: number = 30): Promise<number> {
		const sql = `
      DELETE FROM notifications 
      WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '${daysOld} days'
      AND is_read = true
    `;

		const result = await query(sql);

		logger.info("Old notifications cleaned up", {
			deletedCount: result.rowCount,
			daysOld,
		});

		return result.rowCount;
	}

	// Helper method to map database row to Notification object
	private static mapRowToNotification(row: any): Notification {
		return {
			id: row.id,
			userId: row.user_id,
			type: row.type,
			title: row.title,
			message: row.message,
			data: row.data,
			isRead: row.is_read,
			createdAt: row.created_at,
			readAt: row.read_at,
		};
	}
}
