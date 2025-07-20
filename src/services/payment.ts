import Stripe from "stripe";
import { query, withTransaction } from "@/database/connection";
import { PoolClient } from "pg";
import { config } from "@/config";
import logger from "@/config/logger";
import { getSocketManager } from "@/config/socket";
import type {
	CreatePaymentIntentData,
	CreatePayoutData,
	Payment,
	Payout,
} from "@/types";
import { NotificationService } from "./notification";

export class PaymentService {
	private static stripe = new Stripe(config.stripe.secretKey, {
		apiVersion: "2025-06-30.basil",
	});

	static async createPaymentIntent(data: CreatePaymentIntentData): Promise<{
		payment: Payment;
		clientSecret: string;
	}> {
		return withTransaction(async (client: PoolClient) => {
			try {
				// Get order details
				const orderSql = "SELECT * FROM orders WHERE id = $1";
				const orderResult = await client.query(orderSql, [data.orderId]);

				if (orderResult.rows.length === 0) {
					throw new Error("Order not found");
				}

				const order = orderResult.rows[0];

				// Create Stripe payment intent
				const paymentIntent = await this.stripe.paymentIntents.create({
					amount: Math.round(data.amount * 100), // Convert to cents
					currency: data.currency || "usd",
					payment_method_types: data.paymentMethodTypes || ["card"],
					metadata: {
						orderId: data.orderId,
						vendorId: order.vendor_id,
						userId: order.user_id,
						...data.metadata,
					},
				});

				// Save payment record
				const paymentSql = `
          INSERT INTO payments (
            order_id, vendor_id, user_id, stripe_payment_intent_id,
            amount, currency, status, payment_method, metadata
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING *
        `;

				const paymentValues = [
					data.orderId,
					order.vendor_id,
					order.user_id,
					paymentIntent.id,
					data.amount,
					data.currency || "usd",
					"pending",
					"card",
					data.metadata ? JSON.stringify(data.metadata) : null,
				];

				const paymentResult = await client.query(paymentSql, paymentValues);
				const payment = this.mapRowToPayment(paymentResult.rows[0]);

				logger.info("Payment intent created", {
					paymentId: payment.id,
					orderId: data.orderId,
					amount: data.amount,
					paymentIntentId: paymentIntent.id,
				});

				return {
					payment,
					clientSecret: paymentIntent.client_secret!,
				};
			} catch (error) {
				logger.error("Failed to create payment intent", error as Error);
				throw error;
			}
		});
	}

	static async confirmPayment(
		paymentIntentId: string,
	): Promise<Payment | null> {
		return withTransaction(async (client: PoolClient) => {
			try {
				// Get payment record
				const paymentSql =
					"SELECT * FROM payments WHERE stripe_payment_intent_id = $1";
				const paymentResult = await client.query(paymentSql, [paymentIntentId]);

				if (paymentResult.rows.length === 0) {
					logger.warn("Payment not found for payment intent", {
						paymentIntentId,
					});
					return null;
				}

				const payment = paymentResult.rows[0];

				// Get payment intent from Stripe
				const paymentIntent = await this.stripe.paymentIntents.retrieve(
					paymentIntentId,
					{ expand: ["charges"] },
				);

				let chargeId: string | null = null;
				if (paymentIntent.latest_charge) {
					const charge = await this.stripe.charges.retrieve(
						paymentIntent.latest_charge as string,
					);
					chargeId = charge.id;
				}
				const updateSql = `
						UPDATE payments 
						SET status = $1, stripe_charge_id = $2, updated_at = CURRENT_TIMESTAMP
						WHERE id = $3
						RETURNING *
					`;

				const status =
					paymentIntent.status === "succeeded" ? "succeeded" : "failed";
				const updateResult = await client.query(updateSql, [
					status,
					chargeId,
					payment.id,
				]);
				const updatedPayment = this.mapRowToPayment(updateResult.rows[0]);

				if (status === "succeeded") {
					// Update order payment status
					await client.query(
						"UPDATE orders SET payment_status = $1 WHERE id = $2",
						["paid", payment.order_id],
					);

					// Send notification to user
					await NotificationService.notifyOrderStatusChange(
						payment.user_id,
						payment.order_id,
						"Payment confirmed",
						"confirmed",
					);

					// Send notification to vendor
					await NotificationService.notifyVendorNewOrder(
						payment.vendor_id,
						payment.order_id,
						"New paid order",
						"Customer",
						payment.amount,
					);

					// Send real-time updates
					const socketManager = getSocketManager();
					await socketManager.sendOrderUpdate(payment.order_id, {
						paymentStatus: "paid",
						status: "confirmed",
					});
				}

				logger.info("Payment confirmed", {
					paymentId: updatedPayment.id,
					orderId: payment.order_id,
					status,
					amount: payment.amount,
				});

				return updatedPayment;
			} catch (error) {
				logger.error("Failed to confirm payment", error as Error);
				throw error;
			}
		});
	}

	// Create refund
	static async createRefund(
		paymentId: string,
		amount?: number,
		reason?: string,
	): Promise<{ payment: Payment; refund: Stripe.Refund }> {
		return withTransaction(async (client: PoolClient) => {
			try {
				// Get payment record
				const paymentSql = "SELECT * FROM payments WHERE id = $1";
				const paymentResult = await client.query(paymentSql, [paymentId]);

				if (paymentResult.rows.length === 0) {
					throw new Error("Payment not found");
				}

				const payment = paymentResult.rows[0];

				if (payment.status !== "succeeded") {
					throw new Error("Payment must be succeeded to refund");
				}

				// Create refund in Stripe
				const refund = await this.stripe.refunds.create({
					payment_intent: payment.stripe_payment_intent_id,
					amount: amount ? Math.round(amount * 100) : undefined, // Convert to cents
					reason: reason as any,
					metadata: {
						paymentId,
						orderId: payment.order_id,
					},
				});

				// Update payment status
				const refundAmount = refund.amount / 100; // Convert back to dollars
				const isPartialRefund = refundAmount < payment.amount;
				const newStatus = isPartialRefund ? "partially_refunded" : "refunded";

				const updateSql = `
          UPDATE payments 
          SET status = $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
          RETURNING *
        `;

				const updateResult = await client.query(updateSql, [
					newStatus,
					paymentId,
				]);
				const updatedPayment = this.mapRowToPayment(updateResult.rows[0]);

				// Update order status
				await client.query(
					"UPDATE orders SET payment_status = $1, status = $2 WHERE id = $3",
					[newStatus, "refunded", payment.order_id],
				);

				// Send notification to user
				await NotificationService.notifyOrderStatusChange(
					payment.user_id,
					payment.order_id,
					"Order refunded",
					"refunded",
				);

				logger.info("Refund created", {
					paymentId,
					orderId: payment.order_id,
					refundAmount,
					isPartialRefund,
					refundId: refund.id,
				});

				return { payment: updatedPayment, refund };
			} catch (error) {
				logger.error("Failed to create refund", error as Error);
				throw error;
			}
		});
	}

	static async createPayout(data: CreatePayoutData): Promise<Payout> {
		return withTransaction(async (client: PoolClient) => {
			try {
				// Get vendor Stripe account
				const vendorSql = "SELECT * FROM vendors WHERE id = $1";
				const vendorResult = await client.query(vendorSql, [data.vendorId]);

				if (vendorResult.rows.length === 0) {
					throw new Error("Vendor not found");
				}

				const vendor = vendorResult.rows[0];

				if (!vendor.stripe_account_id) {
					throw new Error("Vendor Stripe account not connected");
				}

				// Create payout record first
				const payoutSql = `
							INSERT INTO payouts (
								vendor_id, amount, currency, status, description, metadata
							)
							VALUES ($1, $2, $3, $4, $5, $6)
							RETURNING *
					`;

				const payoutValues = [
					data.vendorId,
					data.amount,
					data.currency || "usd",
					"pending",
					data.description,
					data.metadata ? JSON.stringify(data.metadata) : null,
				];

				const payoutResult = await client.query(payoutSql, payoutValues);
				const payout = this.mapRowToPayout(payoutResult.rows[0]);

				// Create payout in Stripe
				const stripePayout = await this.stripe.payouts.create(
					{
						amount: Math.round(data.amount * 100), // Convert to cents
						currency: data.currency || "usd",
						description: data.description,
						metadata: {
							payoutId: payout.id,
							vendorId: data.vendorId,
							...data.metadata,
						},
					},
					{
						stripeAccount: vendor.stripe_account_id,
					},
				);

				// Update payout with Stripe payout ID
				const updateSql = `
						UPDATE payouts 
						SET stripe_payout_id = $1, status = $2, updated_at = CURRENT_TIMESTAMP
						WHERE id = $3
						RETURNING *
					`;

				const updateResult = await client.query(updateSql, [
					stripePayout.id,
					"in_transit",
					payout.id,
				]);

				const updatedPayout = this.mapRowToPayout(updateResult.rows[0]);

				// Send notification to vendor
				await NotificationService.sendVendorNotification(data.vendorId, {
					type: "payout",
					title: "Payout Initiated",
					message: `Payout of $${data.amount.toFixed(2)} has been initiated`,
					data: { payoutId: payout.id, amount: data.amount },
				});

				logger.info("Payout created", {
					payoutId: payout.id,
					vendorId: data.vendorId,
					amount: data.amount,
					stripePayoutId: stripePayout.id,
				});

				return updatedPayout;
			} catch (error) {
				logger.error("Failed to create payout", error as Error);
				throw error;
			}
		});
	}

	// Get payment by ID
	static async getPaymentById(paymentId: string): Promise<Payment | null> {
		const sql = "SELECT * FROM payments WHERE id = $1";
		const result = await query(sql, [paymentId]);

		if (result.rows.length === 0) {
			return null;
		}

		return this.mapRowToPayment(result.rows[0]);
	}

	// Get payments for order
	static async getPaymentsByOrder(orderId: string): Promise<Payment[]> {
		const sql =
			"SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at DESC";
		const result = await query(sql, [orderId]);

		return result.rows.map(this.mapRowToPayment);
	}

	// Get payments for vendor
	static async getPaymentsByVendor(
		vendorId: string,
		page: number = 1,
		limit: number = 20,
		status?: string,
	): Promise<{ payments: Payment[]; total: number }> {
		const offset = (page - 1) * limit;
		let whereClause = "WHERE vendor_id = $1";
		const values: any[] = [vendorId];
		let paramCount = 1;

		if (status) {
			whereClause += ` AND status = $${++paramCount}`;
			values.push(status);
		}

		// Get total count
		const countSql = `SELECT COUNT(*) FROM payments ${whereClause}`;
		const countResult = await query(countSql, values);
		const total = parseInt(countResult.rows[0].count);

		// Get payments
		const sql = `
      SELECT * FROM payments 
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${++paramCount} OFFSET $${++paramCount}
    `;
		values.push(limit, offset);

		const result = await query(sql, values);
		const payments = result.rows.map(this.mapRowToPayment);

		return { payments, total };
	}

	// Get payout by ID
	static async getPayoutById(payoutId: string): Promise<Payout | null> {
		const sql = "SELECT * FROM payouts WHERE id = $1";
		const result = await query(sql, [payoutId]);

		if (result.rows.length === 0) {
			return null;
		}

		return this.mapRowToPayout(result.rows[0]);
	}

	// Get payouts for vendor
	static async getPayoutsByVendor(
		vendorId: string,
		page: number = 1,
		limit: number = 20,
		status?: string,
	): Promise<{ payouts: Payout[]; total: number }> {
		const offset = (page - 1) * limit;
		let whereClause = "WHERE vendor_id = $1";
		const values: any[] = [vendorId];
		let paramCount = 1;

		if (status) {
			whereClause += ` AND status = $${++paramCount}`;
			values.push(status);
		}

		// Get total count
		const countSql = `SELECT COUNT(*) FROM payouts ${whereClause}`;
		const countResult = await query(countSql, values);
		const total = parseInt(countResult.rows[0].count);

		// Get payouts
		const sql = `
      SELECT * FROM payouts 
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${++paramCount} OFFSET $${++paramCount}
    `;
		values.push(limit, offset);

		const result = await query(sql, values);
		const payouts = result.rows.map(this.mapRowToPayout);

		return { payouts, total };
	}

	// Calculate vendor earnings
	static async calculateVendorEarnings(
		vendorId: string,
		dateFrom?: Date,
		dateTo?: Date,
	): Promise<{
		totalEarnings: number;
		totalPayouts: number;
		availableBalance: number;
		pendingPayments: number;
	}> {
		let whereClause = "WHERE vendor_id = $1 AND status = $2";
		const values: any[] = [vendorId, "succeeded"];
		let paramCount = 2;

		if (dateFrom) {
			whereClause += ` AND created_at >= $${++paramCount}`;
			values.push(dateFrom);
		}

		if (dateTo) {
			whereClause += ` AND created_at <= $${++paramCount}`;
			values.push(dateTo);
		}

		// Get total earnings from successful payments
		const earningsSql = `
      SELECT COALESCE(SUM(amount), 0) as total_earnings
      FROM payments 
      ${whereClause}
    `;

		const earningsResult = await query(earningsSql, values);
		const totalEarnings = parseFloat(earningsResult.rows[0].total_earnings);

		// Get total payouts
		const payoutsSql = `
      SELECT COALESCE(SUM(amount), 0) as total_payouts
      FROM payouts 
      WHERE vendor_id = $1 AND status IN ('in_transit', 'paid')
    `;

		const payoutsResult = await query(payoutsSql, [vendorId]);
		const totalPayouts = parseFloat(payoutsResult.rows[0].total_payouts);

		// Get pending payments
		const pendingSql = `
      SELECT COALESCE(SUM(amount), 0) as pending_payments
      FROM payments 
      WHERE vendor_id = $1 AND status = 'pending'
    `;

		const pendingResult = await query(pendingSql, [vendorId]);
		const pendingPayments = parseFloat(pendingResult.rows[0].pending_payments);

		const availableBalance = totalEarnings - totalPayouts;

		return {
			totalEarnings,
			totalPayouts,
			availableBalance,
			pendingPayments,
		};
	}

	// Webhook handler for Stripe events
	static async handleStripeWebhook(event: Stripe.Event): Promise<void> {
		try {
			switch (event.type) {
				case "payment_intent.succeeded":
					const paymentIntent = event.data.object as Stripe.PaymentIntent;
					await this.confirmPayment(paymentIntent.id);
					break;

				case "payment_intent.payment_failed":
					// Handle failed payment
					break;

				case "payout.paid":
					const payout = event.data.object as Stripe.Payout;
					await this.updatePayoutStatus(payout.id, "paid");
					break;

				case "payout.failed":
					const failedPayout = event.data.object as Stripe.Payout;
					await this.updatePayoutStatus(failedPayout.id, "failed");
					break;

				default:
					logger.info("Unhandled Stripe webhook event", { type: event.type });
			}
		} catch (error) {
			logger.error("Failed to handle Stripe webhook", error as Error);
			throw error;
		}
	}

	// Update payout status
	private static async updatePayoutStatus(
		stripePayoutId: string,
		status: "paid" | "failed",
	): Promise<void> {
		const sql = `
      UPDATE payouts 
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE stripe_payout_id = $2
      RETURNING *
    `;

		const result = await query(sql, [status, stripePayoutId]);

		if (result.rows.length > 0) {
			const payout = this.mapRowToPayout(result.rows[0]);

			// Send notification to vendor
			const message =
				status === "paid"
					? `Payout of $${payout.amount.toFixed(2)} has been completed`
					: `Payout of $${payout.amount.toFixed(2)} has failed`;

			await NotificationService.sendVendorNotification(payout.vendorId, {
				type: "payout",
				title: status === "paid" ? "Payout Completed" : "Payout Failed",
				message,
				data: { payoutId: payout.id, amount: payout.amount, status },
			});
		}
	}

	// Helper methods to map database rows to objects
	private static mapRowToPayment(row: any): Payment {
		return {
			id: row.id,
			orderId: row.order_id,
			vendorId: row.vendor_id,
			userId: row.user_id,
			stripePaymentIntentId: row.stripe_payment_intent_id,
			stripeChargeId: row.stripe_charge_id,
			amount: parseFloat(row.amount),
			currency: row.currency,
			status: row.status,
			paymentMethod: row.payment_method,
			metadata: row.metadata,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	private static mapRowToPayout(row: any): Payout {
		return {
			id: row.id,
			vendorId: row.vendor_id,
			stripePayoutId: row.stripe_payout_id,
			amount: parseFloat(row.amount),
			currency: row.currency,
			status: row.status,
			description: row.description,
			metadata: row.metadata,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}
}

export default PaymentService;
