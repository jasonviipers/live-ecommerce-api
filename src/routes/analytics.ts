import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
	authMiddleware,
	optionalAuthMiddleware,
	requireVendorOrAdmin,
	requireAdmin,
} from "../middleware/auth";
import { createError } from "@/middleware/errorHandler";
import { logger } from "@/config/logger";
import {
	dateRangeSchema,
	trackEventSchema,
	vendorAnalyticsSchema,
} from "@/utils/validation";
import AnalyticsService from "@/services/analyticsService";
import type {
	AnalyticsMetrics,
	RealTimeMetrics,
	VendorAnalytics,
} from "@/types";
import StreamRepository from "@/repositories/stream";
import ProductRepository from "@/repositories/product";

interface IDashboardData {
	general?: AnalyticsMetrics;
	vendor?: VendorAnalytics;
	realtime?: RealTimeMetrics;
}

type Env = {
	Bindings: {
		ip?: string;
	};
};

const analyticsRoutes = new Hono<Env>();

// Track analytics event (public endpoint with optional auth)
analyticsRoutes.post(
	"/track",
	optionalAuthMiddleware,
	zValidator("json", trackEventSchema),
	async (c) => {
		try {
			const user = c.get("user");
			const data = c.req.valid("json");

			// Get client information
			const ipAddress =
				c.req.header("x-forwarded-for") ||
				c.req.header("x-real-ip") ||
				c.env?.ip ||
				"unknown";

			const userAgent = c.req.header("user-agent") || "unknown";
			const referrer = c.req.header("referer");

			const event = await AnalyticsService.trackEvent({
				userId: user?.id,
				sessionId: data.sessionId,
				eventType: data.eventType,
				eventCategory: data.eventCategory,
				eventAction: data.eventAction,
				eventLabel: data.eventLabel,
				eventValue: data.eventValue,
				properties: data.properties,
				ipAddress,
				userAgent,
				referrer,
				url: data.properties?.url,
			});

			return c.json({
				success: true,
				message: "Event tracked successfully",
				data: {
					eventId: event.id,
					timestamp: event.timestamp,
				},
			});
		} catch (error) {
			logger.error("Failed to track analytics event", error as Error);
			// Don't throw error for tracking - just log and return success
			return c.json({
				success: true,
				message: "Event received",
			});
		}
	},
);

// Get general analytics metrics (admin only)
analyticsRoutes.get(
	"/metrics/general",
	authMiddleware,
	requireAdmin,
	zValidator("query", dateRangeSchema),
	async (c) => {
		try {
			const query = c.req.valid("query");

			const metrics = await AnalyticsService.getGeneralMetrics(
				query.dateFrom ? new Date(query.dateFrom) : undefined,
				query.dateTo ? new Date(query.dateTo) : undefined,
			);

			return c.json({
				success: true,
				data: metrics,
			});
		} catch (error) {
			logger.error("Failed to get general metrics", error as Error);
			throw createError.internal("Failed to retrieve general metrics");
		}
	},
);

// Get real-time metrics (admin only)
analyticsRoutes.get(
	"/metrics/realtime",
	authMiddleware,
	requireAdmin,
	async (c) => {
		try {
			const metrics = await AnalyticsService.getRealTimeMetrics();

			return c.json({
				success: true,
				data: metrics,
			});
		} catch (error) {
			logger.error("Failed to get real-time metrics", error as Error);
			throw createError.internal("Failed to retrieve real-time metrics");
		}
	},
);

// Get stream analytics
analyticsRoutes.get(
	"/streams/:streamId",
	authMiddleware,
	requireVendorOrAdmin,
	zValidator("query", dateRangeSchema),
	async (c) => {
		try {
			const user = c.get("user");
			const streamId = c.req.param("streamId");
			const query = c.req.valid("query");

			const stream = await StreamRepository.findById(streamId);
			if (!stream) {
				throw createError.notFound("Stream not found");
			}
			if (user.role !== "admin" && stream.vendorId !== user.vendorId) {
				throw createError.forbidden("Access denied to this stream's analytics");
			}

			const analytics = await AnalyticsService.getStreamAnalytics(
				streamId,
				query.dateFrom ? new Date(query.dateFrom) : undefined,
				query.dateTo ? new Date(query.dateTo) : undefined,
			);

			return c.json({
				success: true,
				data: analytics,
			});
		} catch (error) {
			logger.error("Failed to get stream analytics", error as Error);
			throw createError.internal("Failed to retrieve stream analytics");
		}
	},
);

// Get product analytics
analyticsRoutes.get(
	"/products/:productId",
	authMiddleware,
	requireVendorOrAdmin,
	zValidator("query", dateRangeSchema),
	async (c) => {
		try {
			const user = c.get("user");
			const productId = c.req.param("productId");
			const query = c.req.valid("query");

			const product = await ProductRepository.findById(productId);
			if (!product) {
				throw createError.notFound("Product not found");
			}
			if (user.role !== "admin" && product.vendorId !== user.vendorId) {
				throw createError.forbidden(
					"Access denied to this product's analytics",
				);
			}

			const analytics = await AnalyticsService.getProductAnalytics(
				productId,
				query.dateFrom ? new Date(query.dateFrom) : undefined,
				query.dateTo ? new Date(query.dateTo) : undefined,
			);

			return c.json({
				success: true,
				data: analytics,
			});
		} catch (error) {
			logger.error("Failed to get product analytics", error as Error);
			throw createError.internal("Failed to retrieve product analytics");
		}
	},
);

// Get vendor analytics
analyticsRoutes.get(
	"/vendors/:vendorId",
	authMiddleware,
	requireVendorOrAdmin,
	zValidator("query", dateRangeSchema),
	async (c) => {
		try {
			const user = c.get("user");
			const vendorId = c.req.param("vendorId");
			const query = c.req.valid("query");

			// Check access (vendors can only see their own analytics)
			if (user.role === "vendor" && user.vendorId !== vendorId) {
				throw createError.forbidden("Access denied to this vendor's analytics");
			}

			const analytics = await AnalyticsService.getVendorAnalytics(
				vendorId,
				query.dateFrom ? new Date(query.dateFrom) : undefined,
				query.dateTo ? new Date(query.dateTo) : undefined,
			);

			return c.json({
				success: true,
				data: analytics,
			});
		} catch (error) {
			logger.error("Failed to get vendor analytics", error as Error);
			throw createError.internal("Failed to retrieve vendor analytics");
		}
	},
);

// Get current user's vendor analytics (convenience endpoint)
analyticsRoutes.get(
	"/my-analytics",
	authMiddleware,
	requireVendorOrAdmin,
	zValidator("query", dateRangeSchema),
	async (c) => {
		try {
			const user = c.get("user");
			const query = c.req.valid("query");

			if (user.role === "vendor" && !user.vendorId) {
				throw createError.forbidden("Vendor account required");
			}

			let vendorId: string;
			if (user.role === "admin") {
				// For admin, we could return aggregated analytics or require vendorId parameter
				throw createError.badRequest(
					"Admin users must specify vendorId parameter",
				);
			} else {
				vendorId = user.vendorId!;
			}

			const analytics = await AnalyticsService.getVendorAnalytics(
				vendorId,
				query.dateFrom ? new Date(query.dateFrom) : undefined,
				query.dateTo ? new Date(query.dateTo) : undefined,
			);

			return c.json({
				success: true,
				data: analytics,
			});
		} catch (error) {
			logger.error("Failed to get user analytics", error as Error);
			throw error;
		}
	},
);

// Batch track events (for performance)
analyticsRoutes.post(
	"/track/batch",
	optionalAuthMiddleware,
	zValidator(
		"json",
		z.object({
			events: z
				.array(trackEventSchema)
				.max(100, "Maximum 100 events per batch"),
		}),
	),
	async (c) => {
		try {
			const user = c.get("user");
			const { events } = c.req.valid("json");

			// Get client information
			const ipAddress =
				c.req.header("x-forwarded-for") ||
				c.req.header("x-real-ip") ||
				c.env?.ip ||
				"unknown";

			const userAgent = c.req.header("user-agent") || "unknown";
			const referrer = c.req.header("referer");

			const trackingPromises = events.map((eventData) =>
				AnalyticsService.trackEvent({
					userId: user?.id,
					sessionId: eventData.sessionId,
					eventType: eventData.eventType,
					eventCategory: eventData.eventCategory,
					eventAction: eventData.eventAction,
					eventLabel: eventData.eventLabel,
					eventValue: eventData.eventValue,
					properties: eventData.properties,
					ipAddress,
					userAgent,
					referrer,
					url: eventData.properties?.url,
				}),
			);

			// Use Promise.allSettled to handle partial failures
			const results = await Promise.allSettled(trackingPromises);

			const successful = results.filter((r) => r.status === "fulfilled").length;
			const failed = results.filter((r) => r.status === "rejected").length;

			logger.info("Batch analytics tracking completed", {
				total: events.length,
				successful,
				failed,
				userId: user?.id,
			});

			return c.json({
				success: true,
				message: "Batch events processed",
				data: {
					total: events.length,
					successful,
					failed,
				},
			});
		} catch (error) {
			logger.error("Failed to track batch analytics events", error as Error);
			// Don't throw error for tracking - just log and return success
			return c.json({
				success: true,
				message: "Batch events received",
			});
		}
	},
);

// Get analytics dashboard data (vendor/admin)
analyticsRoutes.get(
	"/dashboard",
	authMiddleware,
	requireVendorOrAdmin,
	zValidator("query", vendorAnalyticsSchema),
	async (c) => {
		try {
			const user = c.get("user");
			const query = c.req.valid("query");

			let vendorId: string | undefined;

			if (user.role === "vendor") {
				if (!user.vendorId) {
					throw createError.forbidden("Vendor account required");
				}
				vendorId = user.vendorId;
			} else if (user.role === "admin") {
				vendorId = query.vendorId;
			}

			const dateFrom = query.dateFrom ? new Date(query.dateFrom) : undefined;
			const dateTo = query.dateTo ? new Date(query.dateTo) : undefined;

			// Get different analytics based on user role
			const dashboardData: IDashboardData = {};

			if (user.role === "admin" && !vendorId) {
				// Admin dashboard - general metrics
				dashboardData.general = await AnalyticsService.getGeneralMetrics(
					dateFrom,
					dateTo,
				);
				dashboardData.realtime = await AnalyticsService.getRealTimeMetrics();
			} else if (vendorId) {
				// Vendor dashboard - vendor-specific metrics
				dashboardData.vendor = await AnalyticsService.getVendorAnalytics(
					vendorId,
					dateFrom,
					dateTo,
				);
				dashboardData.realtime = await AnalyticsService.getRealTimeMetrics();
			}

			return c.json({
				success: true,
				data: dashboardData,
			});
		} catch (error) {
			logger.error("Failed to get dashboard analytics", error as Error);
			throw createError.internal("Failed to retrieve dashboard analytics");
		}
	},
);

export default analyticsRoutes;
