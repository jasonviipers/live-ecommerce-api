import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import Stripe from "stripe";
import {
	authMiddleware,
	requireAuthenticated,
	requireVendorOrAdmin,
	requireAdmin,
} from "../middleware/auth";
import { createError } from "../middleware/errorHandler";
import { logger } from "../config/logger";
import { config } from "../config";
import {
	createPaymentIntentSchema,
	createPayoutSchema,
	createRefundSchema,
	querySchema,
} from "@/utils/validation";
import PaymentService from "@/services/payment";

const payments = new Hono();

// Create payment intent
payments.post(
	"/payment-intents",
	authMiddleware,
	requireAuthenticated,
	zValidator("json", createPaymentIntentSchema),
	async (c) => {
		try {
			const user = c.get("user");
			const data = c.req.valid("json");

			// TODO: Verify user owns the order or is admin

			// Get order to calculate amount
			// This would typically come from your order service
			const orderAmount = 100; // Placeholder - get from order service

			const result = await PaymentService.createPaymentIntent({
				orderId: data.orderId,
				amount: orderAmount,
				paymentMethodTypes: data.paymentMethodTypes,
				metadata: data.metadata,
			});

			logger.info("Payment intent created", {
				paymentId: result.payment.id,
				orderId: data.orderId,
				userId: user.id,
			});

			return c.json(
				{
					success: true,
					message: "Payment intent created successfully",
					data: {
						payment: result.payment,
						clientSecret: result.clientSecret,
					},
				},
				201,
			);
		} catch (error) {
			logger.error("Failed to create payment intent", error as Error);
			throw createError.internal("Failed to create payment intent");
		}
	},
);

// Get payment by ID
payments.get("/:id", authMiddleware, requireAuthenticated, async (c) => {
	try {
		const user = c.get("user");
		const paymentId = c.req.param("id");

		const payment = await PaymentService.getPaymentById(paymentId);

		if (!payment) {
			throw createError.notFound("Payment not found");
		}

		// Check access (users can see their own payments, vendors their payments, admins all)
		if (user.role === "customer" && payment.userId !== user.id) {
			throw createError.forbidden("Access denied to this payment");
		}

		if (user.role === "vendor" && payment.vendorId !== user.vendorId) {
			throw createError.forbidden("Access denied to this payment");
		}

		return c.json({
			success: true,
			data: payment,
		});
	} catch (error) {
		logger.error("Failed to get payment", error as Error);
		throw error;
	}
});

// Get payments for order
payments.get(
	"/order/:orderId",
	authMiddleware,
	requireAuthenticated,
	async (c) => {
		try {
			const user = c.get("user");
			const orderId = c.req.param("orderId");

			// TODO: Verify user has access to this order

			const payments = await PaymentService.getPaymentsByOrder(orderId);

			return c.json({
				success: true,
				data: payments,
			});
		} catch (error) {
			logger.error("Failed to get order payments", error as Error);
			throw createError.internal("Failed to retrieve order payments");
		}
	},
);

// Get vendor payments
payments.get(
	"/vendor/:vendorId",
	authMiddleware,
	requireVendorOrAdmin,
	zValidator("query", querySchema),
	async (c) => {
		try {
			const user = c.get("user");
			const vendorId = c.req.param("vendorId");
			const query = c.req.valid("query");

			// Check access (vendors can only see their own payments)
			if (user.role === "vendor" && user.vendorId !== vendorId) {
				throw createError.forbidden("Access denied to this vendor's payments");
			}

			const result = await PaymentService.getPaymentsByVendor(
				vendorId,
				query.page,
				query.limit,
				query.status,
			);

			return c.json({
				success: true,
				data: result.payments,
				pagination: {
					page: query.page,
					limit: query.limit,
					total: result.total,
					totalPages: Math.ceil(result.total / query.limit),
				},
			});
		} catch (error) {
			logger.error("Failed to get vendor payments", error as Error);
			throw createError.internal("Failed to retrieve vendor payments");
		}
	},
);

// Create refund
payments.post(
	"/:id/refund",
	authMiddleware,
	requireVendorOrAdmin,
	zValidator("json", createRefundSchema),
	async (c) => {
		try {
			const user = c.get("user");
			const paymentId = c.req.param("id");
			const { amount, reason } = c.req.valid("json");

			// Get payment to check ownership
			const payment = await PaymentService.getPaymentById(paymentId);

			if (!payment) {
				throw createError.notFound("Payment not found");
			}

			// Check access (vendors can refund their own payments, admins can refund any)
			if (user.role === "vendor" && payment.vendorId !== user.vendorId) {
				throw createError.forbidden("Access denied to this payment");
			}

			const result = await PaymentService.createRefund(
				paymentId,
				amount,
				reason,
			);

			logger.info("Refund created", {
				paymentId,
				refundAmount: amount || payment.amount,
				userId: user.id,
			});

			return c.json({
				success: true,
				message: "Refund created successfully",
				data: {
					payment: result.payment,
					refund: {
						id: result.refund.id,
						amount: result.refund.amount / 100, // Convert from cents
						status: result.refund.status,
						reason: result.refund.reason,
					},
				},
			});
		} catch (error) {
			logger.error("Failed to create refund", error as Error);
			throw error;
		}
	},
);

// Create payout
payments.post(
	"/payouts",
	authMiddleware,
	requireVendorOrAdmin,
	zValidator("json", createPayoutSchema),
	async (c) => {
		try {
			const user = c.get("user");
			const data = c.req.valid("json");

			// Determine vendor ID
			let vendorId: string;
			if (user.role === "admin") {
				if (!data.vendorId) {
					throw createError.badRequest("Vendor ID is required for admin users");
				}
				vendorId = data.vendorId;
			} else {
				if (!user.vendorId) {
					throw createError.forbidden("Vendor account required");
				}
				vendorId = user.vendorId;
			}

			// Check available balance
			const earnings = await PaymentService.calculateVendorEarnings(vendorId);

			if (data.amount > earnings.availableBalance) {
				throw createError.badRequest(
					`Insufficient balance. Available: $${earnings.availableBalance.toFixed(2)}, Requested: $${data.amount.toFixed(2)}`,
				);
			}

			const payout = await PaymentService.createPayout({
				vendorId,
				amount: data.amount,
				currency: data.currency,
				description: data.description,
				metadata: data.metadata,
			});

			logger.info("Payout created", {
				payoutId: payout.id,
				vendorId,
				amount: data.amount,
				userId: user.id,
			});

			return c.json(
				{
					success: true,
					message: "Payout created successfully",
					data: payout,
				},
				201,
			);
		} catch (error) {
			logger.error("Failed to create payout", error as Error);
			throw error;
		}
	},
);

// Get payout by ID
payments.get(
	"/payouts/:id",
	authMiddleware,
	requireVendorOrAdmin,
	async (c) => {
		try {
			const user = c.get("user");
			const payoutId = c.req.param("id");

			const payout = await PaymentService.getPayoutById(payoutId);

			if (!payout) {
				throw createError.notFound("Payout not found");
			}

			// Check access (vendors can see their own payouts, admins can see all)
			if (user.role === "vendor" && payout.vendorId !== user.vendorId) {
				throw createError.forbidden("Access denied to this payout");
			}

			return c.json({
				success: true,
				data: payout,
			});
		} catch (error) {
			logger.error("Failed to get payout", error as Error);
			throw error;
		}
	},
);

// Get vendor payouts
payments.get(
	"/vendor/:vendorId/payouts",
	authMiddleware,
	requireVendorOrAdmin,
	zValidator("query", querySchema),
	async (c) => {
		try {
			const user = c.get("user");
			const vendorId = c.req.param("vendorId");
			const query = c.req.valid("query");

			// Check access (vendors can only see their own payouts)
			if (user.role === "vendor" && user.vendorId !== vendorId) {
				throw createError.forbidden("Access denied to this vendor's payouts");
			}

			const result = await PaymentService.getPayoutsByVendor(
				vendorId,
				query.page,
				query.limit,
				query.status,
			);

			return c.json({
				success: true,
				data: result.payouts,
				pagination: {
					page: query.page,
					limit: query.limit,
					total: result.total,
					totalPages: Math.ceil(result.total / query.limit),
				},
			});
		} catch (error) {
			logger.error("Failed to get vendor payouts", error as Error);
			throw createError.internal("Failed to retrieve vendor payouts");
		}
	},
);

// Get vendor earnings summary
payments.get(
	"/vendor/:vendorId/earnings",
	authMiddleware,
	requireVendorOrAdmin,
	zValidator(
		"query",
		z.object({
			dateFrom: z.string().datetime().optional(),
			dateTo: z.string().datetime().optional(),
		}),
	),
	async (c) => {
		try {
			const user = c.get("user");
			const vendorId = c.req.param("vendorId");
			const query = c.req.valid("query");

			// Check access (vendors can only see their own earnings)
			if (user.role === "vendor" && user.vendorId !== vendorId) {
				throw createError.forbidden("Access denied to this vendor's earnings");
			}

			const earnings = await PaymentService.calculateVendorEarnings(
				vendorId,
				query.dateFrom ? new Date(query.dateFrom) : undefined,
				query.dateTo ? new Date(query.dateTo) : undefined,
			);

			return c.json({
				success: true,
				data: earnings,
			});
		} catch (error) {
			logger.error("Failed to get vendor earnings", error as Error);
			throw createError.internal("Failed to retrieve vendor earnings");
		}
	},
);

// Stripe webhook endpoint
payments.post("/webhooks/stripe", async (c) => {
	try {
		const body = await c.req.text();
		const signature = c.req.header("stripe-signature");

		if (!signature) {
			throw createError.badRequest("Missing Stripe signature");
		}

		const stripe = new Stripe(config.stripe.secretKey, {
			apiVersion: "2025-06-30.basil",
		});

		// Verify webhook signature
		const event = stripe.webhooks.constructEvent(
			body,
			signature,
			config.stripe.webhookSecret,
		);

		// Handle the event
		await PaymentService.handleStripeWebhook(event);

		logger.info("Stripe webhook processed", {
			eventType: event.type,
			eventId: event.id,
		});

		return c.json({ received: true });
	} catch (error) {
		logger.error("Failed to process Stripe webhook", error as Error);

		if (error instanceof Stripe.errors.StripeSignatureVerificationError) {
			throw createError.badRequest("Invalid Stripe signature");
		}

		throw createError.internal("Failed to process webhook");
	}
});

export default payments;
