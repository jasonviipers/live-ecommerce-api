import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware, optionalAuthMiddleware } from "../middleware/auth";
import { logger } from "../config/logger";
import {
	createDonationSchema,
	createGoalSchema,
	updateGoalSchema,
} from "@/utils/validation";
import { getDonationService } from "@/services/donationService";
import { DonationTier } from "@/types";
import Stripe from "stripe";
import { stripe } from "@/utils/utils";
import { config } from "@/config";

const donations = new Hono();

// Create donation
donations.post(
	"/:streamKey",
	authMiddleware,
	zValidator("json", createDonationSchema),
	async (c) => {
		try {
			const streamKey = c.req.param("streamKey");
			const user = c.get("user");
			const donorId = user.id;
			const { amount, currency, message, isAnonymous } = c.req.valid("json");

			const donationService = await getDonationService();
			const donation = await donationService.processDonation(
				streamKey,
				donorId,
				amount,
				currency,
				message,
				isAnonymous,
			);

			if (!donation) {
				return c.json(
					{
						success: false,
						error: "Failed to process donation",
					},
					400,
				);
			}

			return c.json({
				success: true,
				data: donation,
				message: "Donation created successfully",
			});
		} catch (error) {
			logger.error("Failed to create donation", { error });
			return c.json(
				{
					success: false,
					error:
						error instanceof Error
							? error.message
							: "Failed to create donation",
				},
				400,
			);
		}
	},
);

// Get donation statistics
donations.get("/:streamKey/stats", optionalAuthMiddleware, async (c) => {
	try {
		const streamKey = c.req.param("streamKey");
		const period =
			(c.req.query("period") as "today" | "week" | "month" | "all") || "all";

		const donationService = await getDonationService();
		const stats = await donationService.getDonationStats(streamKey, period);

		return c.json({
			success: true,
			data: stats,
		});
	} catch (error) {
		logger.error("Failed to get donation stats", { error });
		return c.json(
			{
				success: false,
				error: "Failed to get donation statistics",
			},
			500,
		);
	}
});

// Get donation alerts
donations.get("/:streamKey/alerts", authMiddleware, async (c) => {
	try {
		const streamKey = c.req.param("streamKey");

		const donationService = await getDonationService();
		const alerts = await donationService.getPendingAlerts(streamKey);

		return c.json({
			success: true,
			data: {
				alerts,
				count: alerts.length,
			},
		});
	} catch (error) {
		logger.error("Failed to get donation alerts", { error });
		return c.json(
			{
				success: false,
				error: "Failed to get donation alerts",
			},
			500,
		);
	}
});

// Mark alert as shown
donations.patch("/alerts/:alertId/shown", authMiddleware, async (c) => {
	try {
		const alertId = c.req.param("alertId");

		const donationService = await getDonationService();
		const success = await donationService.markAlertAsShown(alertId);

		if (!success) {
			return c.json(
				{
					success: false,
					error: "Alert not found",
				},
				404,
			);
		}

		return c.json({
			success: true,
			message: "Alert marked as shown",
		});
	} catch (error) {
		logger.error("Failed to mark alert as shown", { error });
		return c.json(
			{
				success: false,
				error: "Failed to mark alert as shown",
			},
			500,
		);
	}
});

// Create donation goal
donations.post(
	"/:streamKey/goals",
	authMiddleware,
	zValidator("json", createGoalSchema),
	async (c) => {
		try {
			const streamKey = c.req.param("streamKey");
			const user = c.get("user");
			const streamerId = user.id;
			const { title, description, targetAmount, currency, endDate } =
				c.req.valid("json");

			const donationService = await getDonationService();
			const goal = await donationService.createDonationGoal(
				streamKey,
				streamerId,
				title,
				targetAmount,
				currency,
				description,
				endDate ? new Date(endDate) : undefined,
			);

			return c.json({
				success: true,
				data: goal,
				message: "Donation goal created successfully",
			});
		} catch (error) {
			logger.error("Failed to create donation goal", { error });
			return c.json(
				{
					success: false,
					error:
						error instanceof Error
							? error.message
							: "Failed to create donation goal",
				},
				400,
			);
		}
	},
);

// Get donation goals
donations.get("/:streamKey/goals", optionalAuthMiddleware, async (c) => {
	try {
		const streamKey = c.req.param("streamKey");

		const donationService = getDonationService();
		const activeGoals = Array.from(
			(donationService as any).activeDonationGoals.values(),
		).filter((goal: any) => goal.streamKey === streamKey && goal.isActive);

		return c.json({
			success: true,
			data: {
				goals: activeGoals,
				count: activeGoals.length,
			},
		});
	} catch (error) {
		logger.error("Failed to get donation goals", { error });
		return c.json(
			{
				success: false,
				error: "Failed to get donation goals",
			},
			500,
		);
	}
});

// Update donation goal
donations.patch(
	"/goals/:goalId",
	authMiddleware,
	zValidator("json", updateGoalSchema),
	async (c) => {
		try {
			const goalId = c.req.param("goalId");
			const user = c.get("user");
			const userId = user.id;
			const updates = c.req.valid("json");

			const donationService = getDonationService();
			const goal = (donationService as any).activeDonationGoals.get(goalId);

			if (!goal) {
				return c.json(
					{
						success: false,
						error: "Donation goal not found",
					},
					404,
				);
			}

			// Check if user is the streamer
			if (goal.streamerId !== userId) {
				return c.json(
					{
						success: false,
						error: "Insufficient permissions",
					},
					403,
				);
			}

			// Update goal properties
			if (updates.title) goal.title = updates.title;
			if (updates.description !== undefined)
				goal.description = updates.description;
			if (updates.targetAmount) goal.targetAmount = updates.targetAmount;
			if (updates.endDate) goal.endDate = new Date(updates.endDate);
			if (updates.isActive !== undefined) goal.isActive = updates.isActive;

			goal.updatedAt = new Date();

			// Update in database and cache
			await (donationService as any).updateDonationGoal(goal);

			return c.json({
				success: true,
				data: goal,
				message: "Donation goal updated successfully",
			});
		} catch (error) {
			logger.error("Failed to update donation goal", { error });
			return c.json(
				{
					success: false,
					error: "Failed to update donation goal",
				},
				500,
			);
		}
	},
);

// Delete donation goal
donations.delete("/goals/:goalId", authMiddleware, async (c) => {
	try {
		const goalId = c.req.param("goalId");
		const user = c.get("user");
		const userId = user.id;

		const donationService = getDonationService();
		const goal = (donationService as any).activeDonationGoals.get(goalId);

		if (!goal) {
			return c.json(
				{
					success: false,
					error: "Donation goal not found",
				},
				404,
			);
		}

		// Check if user is the streamer
		if (goal.streamerId !== userId) {
			return c.json(
				{
					success: false,
					error: "Insufficient permissions",
				},
				403,
			);
		}

		// Mark as inactive instead of deleting
		goal.isActive = false;
		goal.updatedAt = new Date();

		await (donationService as any).updateDonationGoal(goal);

		return c.json({
			success: true,
			message: "Donation goal deleted successfully",
		});
	} catch (error) {
		logger.error("Failed to delete donation goal", { error });
		return c.json(
			{
				success: false,
				error: "Failed to delete donation goal",
			},
			500,
		);
	}
});

// Get donation leaderboard
donations.get("/:streamKey/leaderboard", optionalAuthMiddleware, async (c) => {
	try {
		const streamKey = c.req.param("streamKey");
		const period =
			(c.req.query("period") as "today" | "week" | "month" | "all") || "month";
		const limit = parseInt(c.req.query("limit") || "10");

		const donationService = await getDonationService();
		const stats = await donationService.getDonationStats(streamKey, period);

		return c.json({
			success: true,
			data: {
				leaderboard: stats.topDonors.slice(0, limit),
				period,
				totalAmount: stats.totalAmount,
				totalDonations: stats.totalDonations,
			},
		});
	} catch (error) {
		logger.error("Failed to get donation leaderboard", { error });
		return c.json(
			{
				success: false,
				error: "Failed to get donation leaderboard",
			},
			500,
		);
	}
});

// Get recent donations
donations.get("/:streamKey/recent", optionalAuthMiddleware, async (c) => {
	try {
		const streamKey = c.req.param("streamKey");
		const limit = parseInt(c.req.query("limit") || "20");

		const donationService = await getDonationService();
		const stats = await donationService.getDonationStats(streamKey, "all");

		return c.json({
			success: true,
			data: {
				donations: stats.recentDonations.slice(0, limit),
				count: stats.recentDonations.length,
			},
		});
	} catch (error) {
		logger.error("Failed to get recent donations", { error });
		return c.json(
			{
				success: false,
				error: "Failed to get recent donations",
			},
			500,
		);
	}
});

// Get donation tiers info
donations.get("/tiers", async (c) => {
	try {
		const donationService = await getDonationService();
		const tiers = await donationService.getDonationTiers();

		return c.json({
			success: true,
			data: {
				tiers: tiers.map((tier: DonationTier) => ({
					name: tier.name,
					minAmount: tier.minAmount,
					maxAmount: tier.maxAmount,
					color: tier.color,
					highlightDuration: tier.highlightDuration,
					benefits: tier.benefits || [],
				})),
			},
		});
	} catch (error) {
		logger.error("Failed to get donation tiers", { error });
		return c.json(
			{
				success: false,
				error: "Failed to get donation tiers",
			},
			500,
		);
	}
});

// Webhook endpoint for payment completion (called by Stripe)
donations.post("/webhook/payment-completed", async (c) => {
	try {
		const rawBody = await c.req.text();
		const signature = c.req.header("stripe-signature");

		if (!signature) {
			logger.error("Missing Stripe signature header");
			return c.json(
				{
					success: false,
					error: "Missing Stripe signature",
				},
				400,
			);
		}

		let event: Stripe.Event;
		try {
			// Verify webhook signature and construct event
			event = stripe.webhooks.constructEvent(
				rawBody,
				signature,
				config.stripe.webhookSecret,
			);
		} catch (err) {
			logger.error("Stripe webhook signature verification failed", {
				error: err instanceof Error ? err.message : "Unknown error",
			});
			return c.json(
				{
					success: false,
					error: "Invalid signature",
				},
				400,
			);
		}
		// Only process payment_intent.succeeded events
		if (event.type !== "payment_intent.succeeded") {
			logger.info("Ignoring non-payment_intent.succeeded event", {
				eventType: event.type,
			});
			return c.json({
				success: true,
				message: "Event ignored",
			});
		}

		// Extract payment intent from event
		const paymentIntent = event.data.object as Stripe.PaymentIntent;
		const paymentIntentId = paymentIntent.id;

		if (!paymentIntentId) {
			logger.error("Payment intent ID missing from webhook event");
			return c.json(
				{
					success: false,
					error: "Payment intent ID required",
				},
				400,
			);
		}

		const donationService = await getDonationService();
		const success = await donationService.completeDonation(paymentIntentId);

		if (!success) {
			logger.error("Failed to complete donation", { paymentIntentId });
			return c.json(
				{
					success: false,
					error: "Failed to complete donation",
				},
				400,
			);
		}

		logger.info("Donation completed successfully via webhook", {
			paymentIntentId,
			eventId: event.id,
		});

		return c.json({
			success: true,
			message: "Donation completed successfully",
		});
	} catch (error) {
		logger.error("Failed to process donation webhook", { error });
		return c.json(
			{
				success: false,
				error: "Failed to process webhook",
			},
			500,
		);
	}
});

export default donations;
