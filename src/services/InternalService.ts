import { EventEmitter } from "events";
import { query } from "../database/connection";
import { logger } from "../config/logger";
import { config } from "../config";
import { getRedisClient } from "@/database/redis";
import { getWebhookService } from "./webhookService";
import EmailService from "./emailService";

export interface ServiceEvent {
	id: string;
	service: string;
	type: string;
	data: any;
	timestamp: Date;
	correlationId?: string;
	userId?: string;
	metadata?: Record<string, any>;
}

export interface ServiceHealth {
	service: string;
	status: "healthy" | "degraded" | "unhealthy";
	version: string;
	uptime: number;
	lastCheck: Date;
	dependencies: Array<{
		name: string;
		status: "healthy" | "unhealthy";
		responseTime?: number;
	}>;
	metrics: {
		requestsPerSecond: number;
		averageResponseTime: number;
		errorRate: number;
		memoryUsage: number;
		cpuUsage: number;
	};
}

export interface ServiceRegistry {
	services: Map<
		string,
		{
			name: string;
			version: string;
			endpoint: string;
			health: ServiceHealth;
			lastHeartbeat: Date;
		}
	>;
}
export type EventHandler = (event: ServiceEvent) => void | Promise<void>;

export class InternalService extends EventEmitter {
	private serviceRegistry: ServiceRegistry["services"] = new Map();
	private eventHandlers: Map<string, EventHandler[]> = new Map();
	private readonly SERVICE_NAME = "live-streaming-api";
	private readonly SERVICE_VERSION = "1.0.0";
	private heartbeatInterval?: NodeJS.Timeout;

	constructor() {
		super();
		this.initializeService();
	}

	// Initialize internal service
	private async initializeService(): Promise<void> {
		try {
			await this.registerService();
			this.startHeartbeat();
			this.setupEventHandlers();
			await this.loadServiceRegistry();

			logger.info("Internal service initialized");
		} catch (error) {
			logger.error("Failed to initialize internal service", error as Error);
		}
	}

	private async registerService(): Promise<void> {
		try {
			const health = await this.getServiceHealth();

			const serviceInfo = {
				name: this.SERVICE_NAME,
				version: this.SERVICE_VERSION,
				endpoint: `http://localhost:${config.server.port}`,
				health,
				lastHeartbeat: new Date(),
			};

			// Store in Redis
			const redisClient = getRedisClient();
			await redisClient.hSet(
				"service_registry",
				this.SERVICE_NAME,
				JSON.stringify(serviceInfo),
			);

			// Store in local registry
			this.serviceRegistry.set(this.SERVICE_NAME, serviceInfo);

			logger.info("Service registered", {
				service: this.SERVICE_NAME,
				version: this.SERVICE_VERSION,
			});
		} catch (error) {
			logger.error("Failed to register service", error as Error);
		}
	}

	// Start heartbeat to maintain service registration
	private startHeartbeat(): void {
		this.heartbeatInterval = setInterval(async () => {
			try {
				await this.sendHeartbeat();
			} catch (error) {
				logger.error("Failed to send heartbeat", error as Error);
			}
		}, 30000); // Every 30 seconds
	}

	// Send heartbeat
	private async sendHeartbeat(): Promise<void> {
		try {
			const health = await this.getServiceHealth();
			const redisClient = getRedisClient();

			const serviceInfo = {
				name: this.SERVICE_NAME,
				version: this.SERVICE_VERSION,
				endpoint: `http://localhost:${config.server.port}`,
				health,
				lastHeartbeat: new Date(),
			};

			await redisClient.hSet(
				"service_registry",
				this.SERVICE_NAME,
				JSON.stringify(serviceInfo),
			);

			// Emit heartbeat event
			await this.emitEvent("service.heartbeat", {
				service: this.SERVICE_NAME,
				health,
			});
		} catch (error) {
			logger.error("Failed to send heartbeat", error as Error);
		}
	}

	// Get service health
	private async getServiceHealth(): Promise<ServiceHealth> {
		try {
			const startTime = process.hrtime();

			// Check database health
			const dbHealth = await this.checkDatabaseHealth();

			// Check Redis health
			const redisHealth = await this.checkRedisHealth();

			// Calculate response time
			const [seconds, nanoseconds] = process.hrtime(startTime);
			const responseTime = seconds * 1000 + nanoseconds / 1000000;

			// Get memory usage
			const memoryUsage = process.memoryUsage();

			// Calculate uptime
			const uptime = process.uptime();

			return {
				service: this.SERVICE_NAME,
				status: dbHealth && redisHealth ? "healthy" : "degraded",
				version: this.SERVICE_VERSION,
				uptime,
				lastCheck: new Date(),
				dependencies: [
					{
						name: "postgresql",
						status: dbHealth ? "healthy" : "unhealthy",
						responseTime: responseTime,
					},
					{
						name: "redis",
						status: redisHealth ? "healthy" : "unhealthy",
					},
				],
				metrics: {
					requestsPerSecond: 0, // Would need to implement request tracking
					averageResponseTime: responseTime,
					errorRate: 0, // Would need to implement error tracking
					memoryUsage: memoryUsage.heapUsed / 1024 / 1024, // MB
					cpuUsage: 0, // Would need to implement CPU tracking
				},
			};
		} catch (error) {
			logger.error("Failed to get service health", error as Error);

			return {
				service: this.SERVICE_NAME,
				status: "unhealthy",
				version: this.SERVICE_VERSION,
				uptime: process.uptime(),
				lastCheck: new Date(),
				dependencies: [],
				metrics: {
					requestsPerSecond: 0,
					averageResponseTime: 0,
					errorRate: 1,
					memoryUsage: 0,
					cpuUsage: 0,
				},
			};
		}
	}

	// Check database health
	private async checkDatabaseHealth(): Promise<boolean> {
		try {
			await query("SELECT 1");
			return true;
		} catch (error) {
			return false;
		}
	}

	// Check Redis health
	private async checkRedisHealth(): Promise<boolean> {
		try {
			const redisClient = getRedisClient();
			await redisClient.ping();
			return true;
		} catch (error) {
			return false;
		}
	}

	// Emit internal event
	async emitEvent(
		type: string,
		data: any,
		options: {
			correlationId?: string;
			userId?: string;
			metadata?: Record<string, any>;
		} = {},
	): Promise<ServiceEvent> {
		try {
			const event: ServiceEvent = {
				id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
				service: this.SERVICE_NAME,
				type,
				data,
				timestamp: new Date(),
				correlationId: options.correlationId,
				userId: options.userId,
				metadata: options.metadata,
			};

			// Store event in database
			await this.storeServiceEvent(event);

			// Publish to Redis for other services
			const redisClient = getRedisClient();
			await redisClient.publish("internal_events", JSON.stringify(event));

			// Create webhook event
			const webhookService = await getWebhookService();
			await webhookService.createEvent(type, data, "internal");

			// Emit locally
			this.emit(type, event);

			logger.info("Internal event emitted", {
				eventId: event.id,
				type: event.type,
				service: event.service,
			});

			return event;
		} catch (error) {
			logger.error("Failed to emit internal event", { type, error });
			throw error;
		}
	}

	// Subscribe to internal events
	subscribeToEvent(
		eventType: string,
		handler: (event: ServiceEvent) => void,
	): void {
		if (!this.eventHandlers.has(eventType)) {
			this.eventHandlers.set(eventType, []);
		}

		this.eventHandlers.get(eventType)!.push(handler);

		logger.info("Subscribed to internal event", { eventType });
	}

	// Unsubscribe from internal events
	unsubscribeFromEvent(eventType: string, handler: EventHandler): void {
		const handlers = this.eventHandlers.get(eventType);

		if (handlers) {
			const index = handlers.indexOf(handler);
			if (index > -1) {
				handlers.splice(index, 1);
			}
		}
	}

	// Setup event handlers for business logic
	private setupEventHandlers(): void {
		// User events
		this.subscribeToEvent("user.created", this.handleUserCreated.bind(this));
		this.subscribeToEvent("user.updated", this.handleUserUpdated.bind(this));
		this.subscribeToEvent("user.deleted", this.handleUserDeleted.bind(this));

		// Order events
		this.subscribeToEvent("order.created", this.handleOrderCreated.bind(this));
		this.subscribeToEvent("order.paid", this.handleOrderPaid.bind(this));
		this.subscribeToEvent("order.shipped", this.handleOrderShipped.bind(this));
		this.subscribeToEvent(
			"order.delivered",
			this.handleOrderDelivered.bind(this),
		);

		// Stream events
		this.subscribeToEvent(
			"stream.started",
			this.handleStreamStarted.bind(this),
		);
		this.subscribeToEvent("stream.ended", this.handleStreamEnded.bind(this));
		this.subscribeToEvent(
			"stream.viewer_joined",
			this.handleViewerJoined.bind(this),
		);

		// Product events
		this.subscribeToEvent(
			"product.created",
			this.handleProductCreated.bind(this),
		);
		this.subscribeToEvent(
			"product.updated",
			this.handleProductUpdated.bind(this),
		);
		this.subscribeToEvent(
			"product.low_stock",
			this.handleProductLowStock.bind(this),
		);

		// Payment events
		this.subscribeToEvent(
			"payment.completed",
			this.handlePaymentCompleted.bind(this),
		);
		this.subscribeToEvent(
			"payment.failed",
			this.handlePaymentFailed.bind(this),
		);

		logger.info("Internal event handlers setup complete");
	}

	private async handleOrderShipped(event: ServiceEvent): Promise<void> {
		try {
			const { orderId, trackingInfo } = event.data;

			// Send shipping confirmation email
			await EmailService.sendShippingConfirmationEmail(orderId, trackingInfo);

			// Update order status in analytics
			await this.trackOrderShipped(orderId, trackingInfo);

			logger.info("Order shipped event handled", { orderId });
		} catch (error) {
			logger.error("Failed to handle order shipped event", { event, error });
		}
	}

	private async handleOrderDelivered(event: ServiceEvent): Promise<void> {
		try {
			const { orderId } = event.data;

			// Send delivery confirmation email
			await EmailService.sendDeliveryConfirmationEmail(orderId);

			// Update order status in analytics
			await this.trackOrderDelivered(orderId);

			logger.info("Order delivered event handled", { orderId });
		} catch (error) {
			logger.error("Failed to handle order delivered event", { event, error });
		}
	}

	private async handleViewerJoined(event: ServiceEvent): Promise<void> {
		try {
			const { streamKey, viewerId, viewerData } = event.data;

			// Update viewer count
			await this.updateStreamViewerCount(streamKey);

			// Track viewer analytics
			await this.trackViewerJoined(streamKey, viewerId, viewerData);

			logger.info("Viewer joined event handled", { streamKey, viewerId });
		} catch (error) {
			logger.error("Failed to handle viewer joined event", { event, error });
		}
	}

	private async handleProductCreated(event: ServiceEvent): Promise<void> {
		try {
			const { productId, productData } = event.data;

			// Index product for search
			await this.indexProductForSearch(productId, productData);

			// Track product creation in analytics
			await this.trackProductCreated(productId, productData);

			logger.info("Product created event handled", { productId });
		} catch (error) {
			logger.error("Failed to handle product created event", { event, error });
		}
	}

	private async handleProductUpdated(event: ServiceEvent): Promise<void> {
		try {
			const { productId, changes } = event.data;

			// Update product index for search
			await this.updateProductIndex(productId, changes);

			// Track product update in analytics
			await this.trackProductUpdated(productId, changes);

			logger.info("Product updated event handled", { productId });
		} catch (error) {
			logger.error("Failed to handle product updated event", { event, error });
		}
	}

	private async handlePaymentCompleted(event: ServiceEvent): Promise<void> {
		try {
			const { paymentId, orderId, amount } = event.data;

			// Update order status
			await this.updateOrderPaymentStatus(orderId, "paid");

			// Track payment in analytics
			await this.trackPaymentCompleted(paymentId, orderId, amount);

			logger.info("Payment completed event handled", { paymentId, orderId });
		} catch (error) {
			logger.error("Failed to handle payment completed event", {
				event,
				error,
			});
		}
	}

	private async handlePaymentFailed(event: ServiceEvent): Promise<void> {
		try {
			const { paymentId, orderId, errorCode, errorMessage } = event.data;

			// Update order status
			await this.updateOrderPaymentStatus(orderId, "failed");

			// Notify customer of payment failure
			await this.notifyPaymentFailure(orderId, errorMessage);

			// Track payment failure in analytics
			await this.trackPaymentFailed(paymentId, orderId, errorCode);

			logger.info("Payment failed event handled", {
				paymentId,
				orderId,
				errorCode,
			});
		} catch (error) {
			logger.error("Failed to handle payment failed event", { event, error });
		}
	}

	// Event handlers
	private async handleUserCreated(event: ServiceEvent): Promise<void> {
		try {
			const { userId, userData } = event.data;

			// Send welcome email
			await EmailService.sendWelcomeEmail(userId, userData);

			// Create user analytics profile
			await this.createUserAnalyticsProfile(userId);

			logger.info("User created event handled", { userId });
		} catch (error) {
			logger.error("Failed to handle user created event", { event, error });
		}
	}

	private async handleUserUpdated(event: ServiceEvent): Promise<void> {
		try {
			const { userId, changes } = event.data;

			// Update analytics profile if relevant fields changed
			if (changes.email || changes.username || changes.profile) {
				await this.updateUserAnalyticsProfile(userId, changes);
			}

			logger.info("User updated event handled", { userId });
		} catch (error) {
			logger.error("Failed to handle user updated event", { event, error });
		}
	}

	private async handleUserDeleted(event: ServiceEvent): Promise<void> {
		try {
			const { userId } = event.data;

			// Clean up user data
			await this.cleanupUserData(userId);

			logger.info("User deleted event handled", { userId });
		} catch (error) {
			logger.error("Failed to handle user deleted event", { event, error });
		}
	}

	private async handleOrderCreated(event: ServiceEvent): Promise<void> {
		try {
			const { orderId, orderData } = event.data;

			// Send order confirmation email
			await this.sendOrderConfirmationEmail(orderId, orderData);

			// Update inventory
			await this.updateInventoryForOrder(orderId, orderData);

			// Create analytics event
			await this.trackOrderCreated(orderId, orderData);

			logger.info("Order created event handled", { orderId });
		} catch (error) {
			logger.error("Failed to handle order created event", { event, error });
		}
	}

	private async handleOrderPaid(event: ServiceEvent): Promise<void> {
		try {
			const { orderId } = event.data;

			// Send payment confirmation email
			await this.sendPaymentConfirmationEmail(orderId);

			// Notify vendor
			await this.notifyVendorOfPaidOrder(orderId);

			// Update analytics
			await this.trackOrderPaid(orderId);

			logger.info("Order paid event handled", { orderId });
		} catch (error) {
			logger.error("Failed to handle order paid event", { event, error });
		}
	}

	private async handleStreamStarted(event: ServiceEvent): Promise<void> {
		try {
			const { streamKey, streamerId } = event.data;

			// TODO: Create chat room

			// const chatService = getChatService();
			// await chatService.createChatRoom(streamKey, streamerId);

			// Notify followers
			await this.notifyFollowersOfStream(streamerId, streamKey);

			// Track analytics
			await this.trackStreamStarted(streamKey, streamerId);

			logger.info("Stream started event handled", { streamKey, streamerId });
		} catch (error) {
			logger.error("Failed to handle stream started event", { event, error });
		}
	}

	private async handleStreamEnded(event: ServiceEvent): Promise<void> {
		try {
			const { streamKey, streamerId, duration, viewerCount } = event.data;

			// TODO: Close chat room

			// const chatService = getChatService();
			// await chatService.closeChatRoom(streamKey);

			// Process stream analytics
			await this.processStreamAnalytics(
				streamKey,
				streamerId,
				duration,
				viewerCount,
			);

			logger.info("Stream ended event handled", { streamKey, streamerId });
		} catch (error) {
			logger.error("Failed to handle stream ended event", { event, error });
		}
	}

	private async handleProductLowStock(event: ServiceEvent): Promise<void> {
		try {
			const { productId, currentStock, threshold } = event.data;

			// Notify vendor
			await this.notifyVendorOfLowStock(productId, currentStock, threshold);

			// Create analytics event
			await this.trackLowStockEvent(productId, currentStock);

			logger.info("Product low stock event handled", {
				productId,
				currentStock,
			});
		} catch (error) {
			logger.error("Failed to handle product low stock event", {
				event,
				error,
			});
		}
	}

	// Helper methods (simplified implementations)

	private async trackOrderShipped(
		orderId: string,
		trackingInfo: any,
	): Promise<void> {
		//TODO: Implementation would track order shipped in analytics
		logger.info("Order shipped tracked", { orderId });
	}

	private async trackOrderDelivered(orderId: string): Promise<void> {
		//TODO: Implementation would track order delivered in analytics
		logger.info("Order delivered tracked", { orderId });
	}

	private async updateStreamViewerCount(streamKey: string): Promise<void> {
		//TODO: Implementation would update stream viewer count
		logger.info("Stream viewer count updated", { streamKey });
	}

	private async trackViewerJoined(
		streamKey: string,
		viewerId: string,
		viewerData: any,
	): Promise<void> {
		//TODO: Implementation would track viewer joined in analytics
		logger.info("Viewer joined tracked", { streamKey, viewerId });
	}

	private async indexProductForSearch(
		productId: string,
		productData: any,
	): Promise<void> {
		//TODO: Implementation would index product for search
		logger.info("Product indexed for search", { productId });
	}

	private async trackProductCreated(
		productId: string,
		productData: any,
	): Promise<void> {
		//TODO: Implementation would track product created in analytics
		logger.info("Product created tracked", { productId });
	}

	private async updateProductIndex(
		productId: string,
		changes: any,
	): Promise<void> {
		//TODO: Implementation would update product index for search
		logger.info("Product index updated", { productId });
	}

	private async trackProductUpdated(
		productId: string,
		changes: any,
	): Promise<void> {
		//TODO: Implementation would track product updated in analytics
		logger.info("Product updated tracked", { productId });
	}

	private async updateOrderPaymentStatus(
		orderId: string,
		status: string,
	): Promise<void> {
		//TODO: Implementation would update order payment status
		logger.info("Order payment status updated", { orderId, status });
	}

	private async trackPaymentCompleted(
		paymentId: string,
		orderId: string,
		amount: number,
	): Promise<void> {
		//TODO: Implementation would track payment completed in analytics

		logger.info("Payment completed tracked", { paymentId, orderId, amount });
	}

	private async notifyPaymentFailure(
		orderId: string,
		errorMessage: string,
	): Promise<void> {
		//TODO: Implementation would notify customer of payment failure
		logger.info("Payment failure notification sent", { orderId, errorMessage });
	}

	private async trackPaymentFailed(
		paymentId: string,
		orderId: string,
		errorCode: string,
	): Promise<void> {
		//TODO: Implementation would track payment failed in analytics
		logger.info("Payment failed tracked", { paymentId, orderId, errorCode });
	}

	private async createUserAnalyticsProfile(userId: string): Promise<void> {
		// Implementation would create analytics profile
		logger.info("User analytics profile created", { userId });
	}

	private async updateUserAnalyticsProfile(
		userId: string,
		changes: any,
	): Promise<void> {
		//TODO: Implementation would update analytics profile
		logger.info("User analytics profile updated", { userId });
	}

	private async cleanupUserData(userId: string): Promise<void> {
		//TODO: Implementation would clean up user data
		logger.info("User data cleaned up", { userId });
	}

	private async sendOrderConfirmationEmail(
		orderId: string,
		orderData: any,
	): Promise<void> {
		//TODO: Implementation would send order confirmation email
		logger.info("Order confirmation email sent", { orderId });
	}

	private async updateInventoryForOrder(
		orderId: string,
		orderData: any,
	): Promise<void> {
		//TODO: Implementation would update inventory
		logger.info("Inventory updated for order", { orderId });
	}

	private async trackOrderCreated(
		orderId: string,
		orderData: any,
	): Promise<void> {
		//TODO: Implementation would track analytics
		logger.info("Order created tracked", { orderId });
	}

	private async trackOrderPaid(orderId: string): Promise<void> {
		//TODO: Implementation would track analytics
		logger.info("Order paid tracked", { orderId });
	}

	private async sendPaymentConfirmationEmail(orderId: string): Promise<void> {
		//TODO: Implementation would send payment confirmation email
		logger.info("Payment confirmation email sent", { orderId });
	}

	private async notifyVendorOfPaidOrder(orderId: string): Promise<void> {
		//TODO: Implementation would notify vendor
		logger.info("Vendor notified of paid order", { orderId });
	}

	private async notifyFollowersOfStream(
		streamerId: string,
		streamKey: string,
	): Promise<void> {
		//TODO: Implementation would notify followers
		logger.info("Followers notified of stream", { streamerId, streamKey });
	}

	private async trackStreamStarted(
		streamKey: string,
		streamerId: string,
	): Promise<void> {
		//TODO: Implementation would track analytics
		logger.info("Stream started tracked", { streamKey, streamerId });
	}

	private async processStreamAnalytics(
		streamKey: string,
		streamerId: string,
		duration: number,
		viewerCount: number,
	): Promise<void> {
		//TODO: Implementation would process stream analytics
		logger.info("Stream analytics processed", {
			streamKey,
			streamerId,
			duration,
			viewerCount,
		});
	}

	private async notifyVendorOfLowStock(
		productId: string,
		currentStock: number,
		threshold: number,
	): Promise<void> {
		//TODO: Implementation would notify vendor
		logger.info("Vendor notified of low stock", {
			productId,
			currentStock,
			threshold,
		});
	}

	private async trackLowStockEvent(
		productId: string,
		currentStock: number,
	): Promise<void> {
		//TODO: Implementation would track analytics
		logger.info("Low stock event tracked", { productId, currentStock });
	}

	// Database operations
	private async storeServiceEvent(event: ServiceEvent): Promise<void> {
		const sql = `
      INSERT INTO service_events (
        id, service, type, data, timestamp, correlation_id, user_id, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;

		const values = [
			event.id,
			event.service,
			event.type,
			JSON.stringify(event.data),
			event.timestamp,
			event.correlationId || null,
			event.userId || null,
			event.metadata ? JSON.stringify(event.metadata) : null,
		];

		await query(sql, values);
	}

	private async loadServiceRegistry(): Promise<void> {
		try {
			// Load from Redis
			const redisClient = getRedisClient();
			const services = await redisClient.hGetAll("service_registry");

			for (const [serviceName, serviceData] of Object.entries(services)) {
				try {
					const serviceInfo = JSON.parse(serviceData);
					this.serviceRegistry.set(serviceName, serviceInfo);
				} catch (error) {
					logger.error("Failed to parse service registry data", {
						serviceName,
						error,
					});
				}
			}

			logger.info("Service registry loaded", {
				count: this.serviceRegistry.size,
			});
		} catch (error) {
			logger.error("Failed to load service registry", error as Error);
		}
	}

	// Get service registry
	getServiceRegistry(): ServiceRegistry["services"] {
		return this.serviceRegistry;
	}

	// Get service health
	async getHealth(): Promise<ServiceHealth> {
		return await this.getServiceHealth();
	}

	// Cleanup
	destroy(): void {
		if (this.heartbeatInterval) {
			clearInterval(this.heartbeatInterval);
		}

		this.removeAllListeners();
		this.eventHandlers.clear();

		logger.info("Internal service destroyed");
	}
}

// Create singleton instance
let internalService: InternalService | null = null;

export const getInternalService = (): InternalService => {
	if (!internalService) {
		internalService = new InternalService();
	}

	return internalService;
};

export default InternalService;
