import { EventEmitter } from "events";
import crypto from "crypto";
import { query } from "@/database/connection";
import { WebhookDelivery, WebhookEndpoint, WebhookEvent } from "@/types";
import logger from "@/config/logger";
import { config } from "@/config";

export class WebhookService extends EventEmitter {
	private webhookEndpoints: Map<string, WebhookEndpoint> = new Map();
	private processingQueue: WebhookEvent[] = [];
	private isProcessing: boolean = false;
	private isInitialized: boolean = false;
	private initializationPromise: Promise<void> | null = null;
	private readonly MAX_CONCURRENT_DELIVERIES = 10;
	private readonly DEFAULT_TIMEOUT = 30000; // 30 seconds

	constructor() {
		super();
	}

	public static async create(): Promise<WebhookService> {
		const service = new WebhookService();
		await service.initializeService();
		return service;
	}

	private async ensureInitialized(): Promise<void> {
		if (this.isInitialized) {
			return;
		}

		if (this.initializationPromise) {
			await this.initializationPromise;
			return;
		}

		this.initializationPromise = this.initializeService();
		await this.initializationPromise;
	}

	private async initializeService(): Promise<void> {
		try {
			// Load webhook endpoints from database
			await this.loadWebhookEndpoints();

			// Start processing queue
			this.startProcessingQueue();

			// Setup cleanup intervals
			this.setupCleanupIntervals();

			this.isInitialized = true;
			logger.info("Webhook service initialized");
		} catch (error) {
			logger.error("Failed to initialize webhook service", error as Error);
			throw error; // Re-throw to allow proper handling in factory method
		} finally {
			this.initializationPromise = null;
		}
	}

	// Create webhook event
	async createEvent(
		type: string,
		data: any,
		source: WebhookEvent["source"] = "internal",
	): Promise<WebhookEvent> {
		await this.ensureInitialized();
		try {
			const event: WebhookEvent = {
				id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
				type,
				source,
				data,
				timestamp: new Date(),
				processed: false,
				retryCount: 0,
				maxRetries: 3,
			};

			// Store event in database
			await this.storeWebhookEvent(event);

			// Add to processing queue
			this.processingQueue.push(event);

			logger.info("Webhook event created", {
				eventId: event.id,
				type: event.type,
				source: event.source,
			});

			this.emit("eventCreated", event);
			return event;
		} catch (error) {
			logger.error("Failed to create webhook event", { type, source, error });
			throw error;
		}
	}

	// Register webhook endpoint
	async registerEndpoint(
		url: string,
		events: string[],
		options: {
			secret?: string;
			maxRetries?: number;
			backoffMultiplier?: number;
			initialDelay?: number;
			headers?: Record<string, string>;
		} = {},
	): Promise<WebhookEndpoint> {
		await this.ensureInitialized();
		try {
			const endpoint: WebhookEndpoint = {
				id: `wh_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
				url,
				events,
				secret: options.secret || this.generateSecret(),
				isActive: true,
				retryPolicy: {
					maxRetries: options.maxRetries || 3,
					backoffMultiplier: options.backoffMultiplier || 2,
					initialDelay: options.initialDelay || 1000,
				},
				headers: options.headers,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			// Store endpoint in database
			await this.storeWebhookEndpoint(endpoint);

			// Add to memory
			this.webhookEndpoints.set(endpoint.id, endpoint);

			logger.info("Webhook endpoint registered", {
				endpointId: endpoint.id,
				url: endpoint.url,
				events: endpoint.events,
			});

			this.emit("endpointRegistered", endpoint);
			return endpoint;
		} catch (error) {
			logger.error("Failed to register webhook endpoint", {
				url,
				events,
				error,
			});
			throw error;
		}
	}

	// Update webhook endpoint
	async updateEndpoint(
		endpointId: string,
		updates: {
			url?: string;
			events?: string[];
			isActive?: boolean;
			headers?: Record<string, string>;
		},
	): Promise<WebhookEndpoint | null> {
		await this.ensureInitialized();
		try {
			const endpoint = this.webhookEndpoints.get(endpointId);

			if (!endpoint) {
				return null;
			}

			// Update properties
			if (updates.url) endpoint.url = updates.url;
			if (updates.events) endpoint.events = updates.events;
			if (updates.isActive !== undefined) endpoint.isActive = updates.isActive;
			if (updates.headers) endpoint.headers = updates.headers;

			endpoint.updatedAt = new Date();

			// Update in database
			await this.updateWebhookEndpoint(endpoint);

			// Update in memory
			this.webhookEndpoints.set(endpointId, endpoint);

			logger.info("Webhook endpoint updated", {
				endpointId,
				updates,
			});

			this.emit("endpointUpdated", endpoint);
			return endpoint;
		} catch (error) {
			logger.error("Failed to update webhook endpoint", { endpointId, error });
			throw error;
		}
	}

	// Delete webhook endpoint
	async deleteEndpoint(endpointId: string): Promise<boolean> {
		await this.ensureInitialized();
		try {
			const endpoint = this.webhookEndpoints.get(endpointId);

			if (!endpoint) {
				return false;
			}

			// Mark as inactive in database
			endpoint.isActive = false;
			endpoint.updatedAt = new Date();
			await this.updateWebhookEndpoint(endpoint);

			// Remove from memory
			this.webhookEndpoints.delete(endpointId);

			logger.info("Webhook endpoint deleted", { endpointId });

			this.emit("endpointDeleted", { endpointId });
			return true;
		} catch (error) {
			logger.error("Failed to delete webhook endpoint", { endpointId, error });
			return false;
		}
	}

	// Process Stripe webhook
	async processStripeWebhook(
		payload: string,
		signature: string,
	): Promise<boolean> {
		await this.ensureInitialized();
		try {
			// Verify Stripe signature
			const isValid = this.verifyStripeSignature(payload, signature);

			if (!isValid) {
				logger.error("Invalid Stripe webhook signature");
				return false;
			}

			const event = JSON.parse(payload);

			// Create internal webhook event
			await this.createEvent(`stripe.${event.type}`, event.data, "stripe");

			// Handle specific Stripe events
			await this.handleStripeEvent(event);

			logger.info("Stripe webhook processed", {
				eventType: event.type,
				eventId: event.id,
			});

			return true;
		} catch (error) {
			logger.error("Failed to process Stripe webhook", { error });
			return false;
		}
	}

	// Handle Stripe events
	private async handleStripeEvent(event: any): Promise<void> {
		try {
			switch (event.type) {
				case "payment_intent.succeeded":
					await this.handlePaymentIntentSucceeded(event.data.object);
					break;

				case "payment_intent.payment_failed":
					await this.handlePaymentIntentFailed(event.data.object);
					break;

				case "invoice.payment_succeeded":
					await this.handleInvoicePaymentSucceeded(event.data.object);
					break;

				case "customer.subscription.created":
					await this.handleSubscriptionCreated(event.data.object);
					break;

				case "customer.subscription.deleted":
					await this.handleSubscriptionDeleted(event.data.object);
					break;

				default:
					logger.info("Unhandled Stripe event type", { eventType: event.type });
			}
		} catch (error) {
			logger.error("Failed to handle Stripe event", {
				eventType: event.type,
				error,
			});
		}
	}

	// Handle payment intent succeeded
	private async handlePaymentIntentSucceeded(
		paymentIntent: any,
	): Promise<void> {
		try {
			const metadata = paymentIntent.metadata;

			if (metadata.type === "donation") {
				// TODO: Handle donation completion
				// const donationService = getDonationService();
				// await donationService.completeDonation(paymentIntent.id);
			} else if (metadata.type === "order") {
				// Handle order payment completion
				await this.handleOrderPaymentSuccess(metadata.orderId);
			}
		} catch (error) {
			logger.error("Failed to handle payment intent succeeded", {
				paymentIntentId: paymentIntent.id,
				error,
			});
		}
	}

	// Handle payment intent failed
	private async handlePaymentIntentFailed(paymentIntent: any): Promise<void> {
		try {
			const metadata = paymentIntent.metadata;

			if (metadata.type === "order") {
				// Update order status to payment failed
				const sql = `
          UPDATE orders 
          SET status = 'payment_failed', updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `;
				await query(sql, [metadata.orderId]);
			}
		} catch (error) {
			logger.error("Failed to handle payment intent failed", {
				paymentIntentId: paymentIntent.id,
				error,
			});
		}
	}

	// Handle invoice payment succeeded
	private async handleInvoicePaymentSucceeded(invoice: any): Promise<void> {
		try {
			// Get customer ID from the invoice
			const customerId = invoice.customer;

			// Get subscription ID if this invoice is for a subscription
			const subscriptionId = invoice.subscription;

			if (subscriptionId) {
				// Update user subscription status to active
				const sql = `
          UPDATE users 
          SET subscription_status = 'active', 
              updated_at = CURRENT_TIMESTAMP
          WHERE stripe_customer_id = $1
        `;
				await query(sql, [customerId]);

				// Create internal event for subscription payment
				await this.createEvent("subscription.payment_succeeded", {
					customerId,
					subscriptionId,
					invoiceId: invoice.id,
					amount: invoice.amount_paid / 100, // Convert from cents to dollars
					currency: invoice.currency,
				});

				logger.info("Subscription payment succeeded", {
					subscriptionId,
					customerId,
					invoiceId: invoice.id,
				});
			} else {
				// This is a one-time invoice payment, not subscription-related
				logger.info("One-time invoice payment succeeded", {
					customerId,
					invoiceId: invoice.id,
				});
			}
		} catch (error) {
			logger.error("Failed to handle invoice payment succeeded", {
				invoiceId: invoice.id,
				error,
			});
		}
	}

	// Handle order payment success
	private async handleOrderPaymentSuccess(orderId: string): Promise<void> {
		try {
			// Update order status
			const sql = `
        UPDATE orders 
        SET status = 'paid', payment_status = 'completed', updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `;
			await query(sql, [orderId]);

			// Create internal event for order paid
			await this.createEvent("order.paid", { orderId });

			logger.info("Order payment completed", { orderId });
		} catch (error) {
			logger.error("Failed to handle order payment success", {
				orderId,
				error,
			});
		}
	}

	// Handle subscription events
	private async handleSubscriptionCreated(subscription: any): Promise<void> {
		try {
			// Update user subscription status
			const customerId = subscription.customer;

			const sql = `
        UPDATE users 
        SET subscription_status = 'active', 
            subscription_id = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE stripe_customer_id = $2
      `;
			await query(sql, [subscription.id, customerId]);

			logger.info("Subscription created", { subscriptionId: subscription.id });
		} catch (error) {
			logger.error("Failed to handle subscription created", {
				subscriptionId: subscription.id,
				error,
			});
		}
	}

	private async handleSubscriptionDeleted(subscription: any): Promise<void> {
		try {
			// Update user subscription status
			const customerId = subscription.customer;

			const sql = `
        UPDATE users 
        SET subscription_status = 'cancelled', 
            updated_at = CURRENT_TIMESTAMP
        WHERE stripe_customer_id = $1
      `;
			await query(sql, [customerId]);

			logger.info("Subscription cancelled", {
				subscriptionId: subscription.id,
			});
		} catch (error) {
			logger.error("Failed to handle subscription deleted", {
				subscriptionId: subscription.id,
				error,
			});
		}
	}

	// Start processing queue
	private startProcessingQueue(): void {
		setInterval(async () => {
			if (this.isProcessing || this.processingQueue.length === 0) {
				return;
			}

			this.isProcessing = true;

			try {
				const events = this.processingQueue.splice(
					0,
					this.MAX_CONCURRENT_DELIVERIES,
				);

				await Promise.all(events.map((event) => this.processEvent(event)));
			} catch (error) {
				logger.error("Failed to process webhook queue", error as Error);
			} finally {
				this.isProcessing = false;
			}
		}, 1000); // Process every second
	}

	// Process individual event
	private async processEvent(event: WebhookEvent): Promise<void> {
		try {
			// Get matching endpoints
			const endpoints = Array.from(this.webhookEndpoints.values()).filter(
				(endpoint) => endpoint.isActive && endpoint.events.includes(event.type),
			);

			if (endpoints.length === 0) {
				// Mark as processed if no endpoints
				event.processed = true;
				event.processedAt = new Date();
				await this.updateWebhookEvent(event);
				return;
			}

			// Deliver to all matching endpoints
			const deliveries = await Promise.allSettled(
				endpoints.map((endpoint) => this.deliverToEndpoint(event, endpoint)),
			);

			// Check if all deliveries succeeded
			const allSucceeded = deliveries.every(
				(result) => result.status === "fulfilled",
			);

			if (allSucceeded) {
				event.processed = true;
				event.processedAt = new Date();
			} else {
				event.retryCount++;

				if (event.retryCount >= event.maxRetries) {
					event.processed = true;
					event.processedAt = new Date();
					event.error = "Max retries exceeded";
				} else {
					// Schedule retry
					const delay = Math.min(Math.pow(2, event.retryCount) * 1000, 300000); //cap at 5min
					event.nextRetryAt = new Date(Date.now() + delay);
				}
			}

			await this.updateWebhookEvent(event);
		} catch (error) {
			logger.error("Failed to process webhook event", {
				eventId: event.id,
				error,
			});
		}
	}

	// Deliver event to endpoint
	private async deliverToEndpoint(
		event: WebhookEvent,
		endpoint: WebhookEndpoint,
	): Promise<WebhookDelivery> {
		const delivery: WebhookDelivery = {
			id: `del_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
			webhookId: endpoint.id,
			eventId: event.id,
			url: endpoint.url,
			retryCount: 0,
			createdAt: new Date(),
		};

		try {
			// Prepare payload
			const payload = JSON.stringify({
				id: event.id,
				type: event.type,
				data: event.data,
				timestamp: event.timestamp,
			});

			// Generate signature
			const signature = this.generateSignature(payload, endpoint.secret);

			// Prepare headers
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
				"User-Agent": "LiveStreaming-Webhook/1.0",
				"X-Webhook-Signature": signature,
				"X-Webhook-Event-Type": event.type,
				"X-Webhook-Event-Id": event.id,
				...endpoint.headers,
			};

			// Make HTTP request
			let controller: AbortController | undefined;
			let timeoutId: NodeJS.Timeout | undefined;

			const signal =
				typeof AbortSignal.timeout === "function"
					? AbortSignal.timeout(this.DEFAULT_TIMEOUT)
					: (() => {
							controller = new AbortController();
							timeoutId = setTimeout(
								() => controller?.abort(),
								this.DEFAULT_TIMEOUT,
							);
							return controller.signal;
						})();

			try {
				const response = await fetch(endpoint.url, {
					method: "POST",
					headers,
					body: payload,
					signal,
				});

				delivery.httpStatus = response.status;
				delivery.responseHeaders = Object.fromEntries(
					response.headers.entries(),
				);
				delivery.responseBody = await response.text();
				delivery.deliveredAt = new Date();

				if (!response.ok) {
					delivery.error = `HTTP ${response.status}: ${response.statusText}`;
				}
			} finally {
				if (timeoutId) {
					clearTimeout(timeoutId);
				}
			}

			logger.info("Webhook delivered", {
				deliveryId: delivery.id,
				endpointUrl: endpoint.url,
				eventType: event.type,
				httpStatus: delivery.httpStatus,
			});
		} catch (error) {
			delivery.error = error instanceof Error ? error.message : "Unknown error";

			logger.error("Failed to deliver webhook", {
				deliveryId: delivery.id,
				endpointUrl: endpoint.url,
				eventType: event.type,
				error: delivery.error,
			});
		}

		// Store delivery record
		await this.storeWebhookDelivery(delivery);

		return delivery;
	}

	// Verify Stripe signature
	private verifyStripeSignature(payload: string, signature: string): boolean {
		try {
			const elements = signature.split(",");
			const signatureHash = elements
				.find((element) => element.startsWith("v1="))
				?.split("=")[1];

			if (!signatureHash) {
				return false;
			}

			const expectedSignature = crypto
				.createHmac("sha256", config.stripe.webhookSecret)
				.update(payload, "utf8")
				.digest("hex");

			return crypto.timingSafeEqual(
				Buffer.from(signatureHash, "hex"),
				Buffer.from(expectedSignature, "hex"),
			);
		} catch (error) {
			logger.error("Failed to verify Stripe signature", error as Error);
			return false;
		}
	}

	// Generate signature for webhook payload
	private generateSignature(payload: string, secret: string): string {
		return crypto
			.createHmac("sha256", secret)
			.update(payload, "utf8")
			.digest("hex");
	}

	// Generate webhook secret
	private generateSecret(): string {
		return crypto.randomBytes(32).toString("hex");
	}

	// Database operations
	private async storeWebhookEvent(event: WebhookEvent): Promise<void> {
		const sql = `
      INSERT INTO webhook_events (
        id, type, source, data, timestamp, signature, processed,
        processed_at, retry_count, max_retries, next_retry_at, error
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `;

		const values = [
			event.id,
			event.type,
			event.source,
			JSON.stringify(event.data),
			event.timestamp,
			event.signature || null,
			event.processed,
			event.processedAt || null,
			event.retryCount,
			event.maxRetries,
			event.nextRetryAt || null,
			event.error || null,
		];

		await query(sql, values);
	}

	private async updateWebhookEvent(event: WebhookEvent): Promise<void> {
		const sql = `
      UPDATE webhook_events 
      SET processed = $1, processed_at = $2, retry_count = $3, 
          next_retry_at = $4, error = $5
      WHERE id = $6
    `;

		const values = [
			event.processed,
			event.processedAt || null,
			event.retryCount,
			event.nextRetryAt || null,
			event.error || null,
			event.id,
		];

		await query(sql, values);
	}

	private async storeWebhookEndpoint(endpoint: WebhookEndpoint): Promise<void> {
		const sql = `
      INSERT INTO webhook_endpoints (
        id, url, events, secret, is_active, retry_policy, headers, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;

		const values = [
			endpoint.id,
			endpoint.url,
			JSON.stringify(endpoint.events),
			endpoint.secret,
			endpoint.isActive,
			JSON.stringify(endpoint.retryPolicy),
			endpoint.headers ? JSON.stringify(endpoint.headers) : null,
			endpoint.createdAt,
			endpoint.updatedAt,
		];

		await query(sql, values);
	}

	private async updateWebhookEndpoint(
		endpoint: WebhookEndpoint,
	): Promise<void> {
		const sql = `
      UPDATE webhook_endpoints 
      SET url = $1, events = $2, is_active = $3, headers = $4, updated_at = $5
      WHERE id = $6
    `;

		const values = [
			endpoint.url,
			JSON.stringify(endpoint.events),
			endpoint.isActive,
			endpoint.headers ? JSON.stringify(endpoint.headers) : null,
			endpoint.updatedAt,
			endpoint.id,
		];

		await query(sql, values);
	}

	private async storeWebhookDelivery(delivery: WebhookDelivery): Promise<void> {
		const sql = `
      INSERT INTO webhook_deliveries (
        id, webhook_id, event_id, url, http_status, response_body,
        response_headers, delivered_at, error, retry_count, next_retry_at, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `;

		const values = [
			delivery.id,
			delivery.webhookId,
			delivery.eventId,
			delivery.url,
			delivery.httpStatus || null,
			delivery.responseBody || null,
			delivery.responseHeaders
				? JSON.stringify(delivery.responseHeaders)
				: null,
			delivery.deliveredAt || null,
			delivery.error || null,
			delivery.retryCount,
			delivery.nextRetryAt || null,
			delivery.createdAt,
		];

		await query(sql, values);
	}

	private async loadWebhookEndpoints(): Promise<void> {
		try {
			const sql = "SELECT * FROM webhook_endpoints WHERE is_active = true";
			const result = await query(sql);

			for (const row of result.rows) {
				const endpoint = this.mapRowToWebhookEndpoint(row);
				this.webhookEndpoints.set(endpoint.id, endpoint);
			}

			logger.info("Loaded webhook endpoints", { count: result.rows.length });
		} catch (error) {
			logger.error("Failed to load webhook endpoints", error as Error);
		}
	}

	private setupCleanupIntervals(): void {
		// Clean up old events and deliveries every hour
		setInterval(
			() => {
				this.cleanupOldRecords();
			},
			60 * 60 * 1000,
		);
	}

	private async cleanupOldRecords(): Promise<void> {
		try {
			const cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

			// Clean up old events
			const eventSql =
				"DELETE FROM webhook_events WHERE timestamp < $1 AND processed = true";
			const eventResult = await query(eventSql, [cutoffDate]);

			// Clean up old deliveries
			const deliverySql =
				"DELETE FROM webhook_deliveries WHERE created_at < $1";
			const deliveryResult = await query(deliverySql, [cutoffDate]);

			logger.info("Cleaned up old webhook records", {
				eventsDeleted: eventResult.rowCount,
				deliveriesDeleted: deliveryResult.rowCount,
			});
		} catch (error) {
			logger.error("Failed to cleanup old webhook records", error as Error);
		}
	}

	private mapRowToWebhookEndpoint(row: any): WebhookEndpoint {
		return {
			id: row.id,
			url: row.url,
			events: JSON.parse(row.events),
			secret: row.secret,
			isActive: row.is_active,
			retryPolicy: JSON.parse(row.retry_policy),
			headers: row.headers ? JSON.parse(row.headers) : undefined,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}
}

// Create singleton instance
let webhookService: WebhookService | null = null;
let initializationPromise: Promise<WebhookService> | null = null;

export const getWebhookService = async (): Promise<WebhookService> => {
	if (!webhookService) {
		if (!initializationPromise) {
			initializationPromise = WebhookService.create();
		}
		webhookService = await initializationPromise;
		initializationPromise = null;
	}

	return webhookService;
};

export default WebhookService;
