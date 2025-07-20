import { Server as SocketIOServer, Socket } from "socket.io";
import { Server as HTTPServer } from "http";
import { logger } from "./logger";
import { secret, toJWTPayload } from "../middleware/auth";
import { jwtVerify } from "jose";
import { UserRepository } from "../repositories/user";
import { getRedisClient } from "../database/redis";
import StreamRepository from "../repositories/stream";
import { query } from "../database/connection";
import { createId } from "@paralleldrive/cuid2";
import { Stream } from "../types";

export interface AuthenticatedSocket extends Socket {
	userId?: string;
	userRole?: string;
	vendorId?: string;
}

export class SocketManager {
	private io: SocketIOServer;
	private connectedUsers: Map<string, string> = new Map();
	private streamViewers: Map<string, Set<string>> = new Map();

	constructor(server: HTTPServer) {
		this.io = new SocketIOServer(server, {
			cors: {
				origin: "*",
				methods: ["GET", "POST"],
				credentials: true,
			},
			transports: ["websocket", "polling"],
		});

		this.setupMiddleware();
		this.setupEventHandlers();
	}

	private setupMiddleware() {
		this.io.use(async (socket: Socket, next) => {
			try {
				const token =
					socket.handshake.auth.token ||
					socket.handshake.headers.authorization?.replace("Bearer ", "");

				if (!token) {
					// Allow anonymous connections for public streams
					socket.isAuthenticated = false;
					return next();
				}

				const { payload } = await jwtVerify(token, secret);
				const decoded = toJWTPayload(payload);

				const user = await UserRepository.findById(decoded.userId);
				if (!user || !user.isActive) {
					socket.isAuthenticated = false;
					return next();
				}

				socket.userId = decoded.userId;
				socket.userRole = decoded.role;
				socket.vendorId = decoded.vendorId;
				socket.isAuthenticated = true;

				logger.info("Socket authenticated", {
					socketId: socket.id,
					userId: decoded.userId,
					role: decoded.role,
				});

				next();
			} catch (error) {
				logger.error("Socket authentication failed", error as Error);
				socket.isAuthenticated = false;
				next(); // Allow connection but mark as unauthenticated
			}
		});
	}

	private setupEventHandlers() {
		this.io.on("connection", (socket: Socket) => {
			logger.info("Socket connected", {
				socketId: socket.id,
				userId: socket.userId,
				isAuthenticated: socket.isAuthenticated,
			});

			// Store authenticated user connection
			if (socket.isAuthenticated && socket.userId) {
				this.connectedUsers.set(socket.userId, socket.id);
				socket.join(`user:${socket.userId}`);

				// Join vendor room if applicable
				if (socket.vendorId) {
					socket.join(`vendor:${socket.vendorId}`);
				}
			}

			this.handleStreamEvents(socket);
			this.handleChatEvents(socket);
			this.handleNotificationEvents(socket);
			this.handleEcommerceEvents(socket);

			// Handle disconnection
			socket.on("disconnect", () => {
				logger.info("Socket disconnected", {
					socketId: socket.id,
					userId: socket.userId,
				});

				if (socket.userId) {
					this.connectedUsers.delete(socket.userId);
				}

				// Remove from all stream viewer sets
				this.streamViewers.forEach((viewers, streamId) => {
					if (viewers.has(socket.id)) {
						viewers.delete(socket.id);
						this.updateStreamViewerCount(streamId);
					}
				});
			});
		});
	}

	private handleStreamEvents(socket: Socket) {
		socket.on("stream:join", (data: { streamId: string }) => {
			const { streamId } = data;

			socket.join(`stream:${streamId}`);

			if (!this.streamViewers.has(streamId)) {
				this.streamViewers.set(streamId, new Set());
			}
			this.streamViewers.get(streamId)!.add(socket.id);

			this.updateStreamViewerCount(streamId);

			logger.info("User joined stream", {
				socketId: socket.id,
				userId: socket.userId,
				streamId,
			});
		});

		socket.on("stream:leave", (data: { streamId: string }) => {
			const { streamId } = data;

			socket.leave(`stream:${streamId}`);

			if (this.streamViewers.has(streamId)) {
				this.streamViewers.get(streamId)!.delete(socket.id);
				this.updateStreamViewerCount(streamId);
			}

			logger.info("User left stream", {
				socketId: socket.id,
				userId: socket.userId,
				streamId,
			});
		});

		socket.on(
			"stream:status",
			async (data: { streamId: string; status: string }) => {
				if (!socket.isAuthenticated || !socket.vendorId) return;

				const { streamId, status } = data;

				const stream = await StreamRepository.findById(streamId);

				if (
					!stream ||
					typeof stream.vendorId !== "string" ||
					stream.vendorId !== socket.vendorId
				) {
					logger.warn("Unauthorized stream status update attempt", {
						streamId,
						userId: socket.userId,
						vendorId: socket.vendorId,
					});
					return;
				}

				// Update stream status in database
				await StreamRepository.update(streamId, { status } as Partial<Stream>);

				this.io.to(`stream:${streamId}`).emit("stream:status_update", {
					streamId,
					status,
					timestamp: new Date().toISOString(),
				});

				logger.info("Stream status updated", {
					streamId,
					status,
					userId: socket.userId,
				});
			},
		);
	}

	private handleChatEvents(socket: Socket) {
		socket.on(
			"chat:message",
			async (data: {
				streamId?: string;
				message: string;
				type?: "text" | "emoji" | "gift";
			}) => {
				if (!socket.isAuthenticated) return;

				const { streamId, message, type = "text" } = data;

				// Validate message content and rate limiting
				if (!message.trim() || message.length > 500) {
					logger.warn("Invalid chat message", {
						userId: socket.userId,
						messageLength: message.length,
					});
					return;
				}

				// Store message in database
				if (streamId) {
					try {
						await query(
							"INSERT INTO chat_messages (stream_id, user_id, message, type) VALUES ($1, $2, $3, $4)",
							[streamId, socket.userId, message, type],
						);
					} catch (error) {
						logger.error("Failed to store chat message", error as Error);
					}
				}

				const chatMessage = {
					id: `msg_${createId()}`,
					userId: socket.userId,
					message,
					type,
					timestamp: new Date().toISOString(),
				};

				if (streamId) {
					// Stream chat
					this.io.to(`stream:${streamId}`).emit("chat:message", {
						streamId,
						...chatMessage,
					});
				}

				logger.info("Chat message sent", {
					userId: socket.userId,
					streamId,
					messageType: type,
				});
			},
		);

		socket.on(
			"chat:delete",
			async (data: { messageId: string; streamId: string }) => {
				if (!socket.isAuthenticated) return;

				const { messageId, streamId } = data;

				// Verify user has moderation permissions
				try {
					const stream = await StreamRepository.findById(streamId);
					if (!stream || stream.vendorId !== socket.vendorId) {
						logger.warn("Unauthorized chat message deletion attempt", {
							userId: socket.userId,
							messageId,
							streamId,
						});
						return;
					}

					// Delete message from database
					await query(
						"DELETE FROM chat_messages WHERE id = $1 AND stream_id = $2",
						[messageId, streamId],
					);

					this.io.to(`stream:${streamId}`).emit("chat:message_deleted", {
						messageId,
						streamId,
						deletedBy: socket.userId,
						timestamp: new Date().toISOString(),
					});
				} catch (error) {
					logger.error("Failed to delete chat message", error as Error);
				}
			},
		);
	}

	private handleNotificationEvents(socket: Socket) {
		socket.on("notification:read", async (data: { notificationId: string }) => {
			if (!socket.isAuthenticated) return;

			const { notificationId } = data;

			// Update notification status in database
			try {
				await query(
					"UPDATE notifications SET is_read = true, read_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2",
					[notificationId, socket.userId],
				);

				logger.info("Notification marked as read", {
					userId: socket.userId,
					notificationId,
				});
			} catch (error) {
				logger.error("Failed to mark notification as read", error as Error);
			}
		});
	}

	private handleEcommerceEvents(socket: Socket) {
		socket.on(
			"product:interest",
			async (data: {
				streamId: string;
				productId: string;
				action: "view" | "like" | "add_to_cart";
			}) => {
				if (!socket.isAuthenticated) return;

				const { streamId, productId, action } = data;

				// Track product interaction analytics
				try {
					await query(
						"INSERT INTO product_interactions (stream_id, product_id, user_id, action_type) VALUES ($1, $2, $3, $4)",
						[streamId, productId, socket.userId, action],
					);
				} catch (error) {
					logger.error("Failed to track product interaction", error as Error);
				}

				// Notify stream owner about product interest
				this.io.to(`stream:${streamId}`).emit("product:interaction", {
					streamId,
					productId,
					action,
					userId: socket.userId,
					timestamp: new Date().toISOString(),
				});
			},
		);

		socket.on("order:subscribe", async (data: { orderId: string }) => {
			if (!socket.isAuthenticated) return;

			const { orderId } = data;

			// Verify user owns the order or is the vendor
			try {
				const orderResult = await query(
					"SELECT user_id, vendor_id FROM orders WHERE id = $1",
					[orderId],
				);

				if (orderResult.rows.length === 0) {
					logger.warn("Order not found for subscription", {
						userId: socket.userId,
						orderId,
					});
					return;
				}

				const order = orderResult.rows[0];
				if (
					order.user_id !== socket.userId &&
					order.vendor_id !== socket.vendorId
				) {
					logger.warn("Unauthorized order subscription attempt", {
						userId: socket.userId,
						orderId,
					});
					return;
				}

				socket.join(`order:${orderId}`);

				logger.info("Subscribed to order updates", {
					userId: socket.userId,
					orderId,
				});
			} catch (error) {
				logger.error("Failed to verify order subscription", error as Error);
			}
		});
	}

	private async updateStreamViewerCount(streamId: string) {
		const viewerCount = this.streamViewers.get(streamId)?.size || 0;

		// Emit to stream room
		this.io.to(`stream:${streamId}`).emit("stream:viewer_count", {
			streamId,
			viewerCount,
			timestamp: new Date().toISOString(),
		});

		// Update viewer count in database
		try {
			await StreamRepository.updateViewerCount(streamId, viewerCount);
		} catch (error) {
			logger.error(
				"Failed to update stream viewer count in database",
				error as Error,
			);
		}

		// Cache viewer count in Redis
		try {
			const redisClient = getRedisClient();
			await redisClient.setEx(
				`stream:${streamId}:viewers`,
				60,
				viewerCount.toString(),
			);
		} catch (error) {
			logger.error("Failed to cache viewer count", error as Error);
		}
	}

	// Public methods for external use
	public async sendNotification(userId: string, notification: any) {
		const socketId = this.connectedUsers.get(userId);
		if (socketId) {
			this.io.to(socketId).emit("notification:new", notification);
		}

		// Also send to user room in case of multiple connections
		this.io.to(`user:${userId}`).emit("notification:new", notification);
	}

	public async sendOrderUpdate(orderId: string, update: any) {
		this.io.to(`order:${orderId}`).emit("order:update", {
			orderId,
			...update,
			timestamp: new Date().toISOString(),
		});
	}

	public async sendVendorNotification(vendorId: string, notification: any) {
		this.io.to(`vendor:${vendorId}`).emit("vendor:notification", notification);
	}

	public async broadcastStreamEvent(
		streamId: string,
		event: string,
		data: any,
	) {
		this.io.to(`stream:${streamId}`).emit(event, {
			streamId,
			...data,
			timestamp: new Date().toISOString(),
		});
	}

	public getConnectedUserCount(): number {
		return this.connectedUsers.size;
	}

	public getStreamViewerCount(streamId: string): number {
		return this.streamViewers.get(streamId)?.size || 0;
	}

	public getIO(): SocketIOServer {
		return this.io;
	}
}

let socketManager: SocketManager;

export const initializeSocket = (server: HTTPServer): SocketManager => {
	socketManager = new SocketManager(server);
	logger.info("Socket.io server initialized");
	return socketManager;
};

export const getSocketManager = (): SocketManager => {
	if (!socketManager) {
		throw new Error("Socket manager not initialized");
	}
	return socketManager;
};
