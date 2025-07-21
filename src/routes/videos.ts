import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
	authMiddleware,
	optionalAuthMiddleware,
	requireVendorOrAdmin,
	requireAuthenticated,
} from "../middleware/auth";
import { createError } from "../middleware/errorHandler";
import { logger } from "../config/logger";
import VideoRepository from "@/repositories/video";
import {
	createVideoSchema,
	querySchema,
	updateVideoSchema,
} from "@/utils/validation";

const videos = new Hono();

// Get all videos (public)
videos.get(
	"/",
	optionalAuthMiddleware,
	zValidator("query", querySchema),
	async (c) => {
		try {
			const query = c.req.valid("query");

			const result = await VideoRepository.findAll(query.page, query.limit, {
				vendorId: query.vendorId,
				status: query.status || "ready", // Default to ready videos for public
				isPublic: query.isPublic ?? true, // Default to public videos
				search: query.search,
				tags: query.tags,
				dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
				dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
				sortBy: query.sortBy as
					| "title"
					| "created_at"
					| "view_count"
					| "like_count"
					| undefined,
				sortOrder: query.sortOrder,
			});

			return c.json({
				success: true,
				data: result,
				pagination: {
					page: result.page,
					limit: result.limit,
					total: result.total,
					totalPages: Math.ceil(result.total / result.limit),
				},
			});
		} catch (error) {
			logger.error("Failed to get videos", error as Error);
			throw createError.internal("Failed to retrieve videos");
		}
	},
);

// Get trending videos (public)
videos.get(
	"/trending",
	zValidator(
		"query",
		z.object({
			timeframe: z.enum(["day", "week", "month"]).default("week"),
			limit: z.string().transform((val) => Math.min(parseInt(val) || 20, 100)),
		}),
	),
	async (c) => {
		try {
			const { timeframe, limit } = c.req.valid("query");
			const videos = await VideoRepository.getTrendingVideos(timeframe, limit);

			return c.json({
				success: true,
				data: videos,
			});
		} catch (error) {
			logger.error("Failed to get trending videos", error as Error);
			throw createError.internal("Failed to retrieve trending videos");
		}
	},
);

// Get recent videos (public)
videos.get("/recent", async (c) => {
	try {
		const limit = parseInt(c.req.query("limit") || "20");
		const videos = await VideoRepository.getRecentVideos(Math.min(limit, 100));

		return c.json({
			success: true,
			data: videos,
		});
	} catch (error) {
		logger.error("Failed to get recent videos", error as Error);
		throw createError.internal("Failed to retrieve recent videos");
	}
});

// Get popular videos (public)
videos.get(
	"/popular",
	zValidator(
		"query",
		z.object({
			timeframe: z.enum(["day", "week", "month", "all"]).default("all"),
			limit: z.string().transform((val) => Math.min(parseInt(val) || 20, 100)),
		}),
	),
	async (c) => {
		try {
			const { timeframe, limit } = c.req.valid("query");
			const videos = await VideoRepository.getPopularVideos(timeframe, limit);

			return c.json({
				success: true,
				data: videos,
			});
		} catch (error) {
			logger.error("Failed to get popular videos", error as Error);
			throw createError.internal("Failed to retrieve popular videos");
		}
	},
);

// Search videos (public)
videos.get(
	"/search",
	zValidator(
		"query",
		z.object({
			q: z.string().min(1, "Search query is required"),
			vendorId: z.string().uuid().optional(),
			tags: z
				.string()
				.transform((val) => (val ? val.split(",") : undefined))
				.optional(),
			dateFrom: z.string().datetime().optional(),
			dateTo: z.string().datetime().optional(),
			page: z.string().transform((val) => parseInt(val) || 1),
			limit: z.string().transform((val) => Math.min(parseInt(val) || 20, 100)),
		}),
	),
	async (c) => {
		try {
			const query = c.req.valid("query");

			const result = await VideoRepository.search(
				query.q,
				{
					vendorId: query.vendorId,
					tags: query.tags,
					dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
					dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
				},
				query.page,
				query.limit,
			);

			return c.json({
				success: true,
				data: {
					videos: result.videos,
					total: result.total,
					page: query.page,
					limit: query.limit,
				},
				pagination: {
					page: query.page,
					limit: query.limit,
					total: result.total,
					totalPages: Math.ceil(result.total / query.limit),
				},
			});
		} catch (error) {
			logger.error("Failed to search videos", error as Error);
			throw createError.internal("Failed to search videos");
		}
	},
);

// Create video (vendor/admin only)
videos.post(
	"/",
	authMiddleware,
	requireVendorOrAdmin,
	zValidator("json", createVideoSchema),
	async (c) => {
		try {
			const user = c.get("user");
			const data = c.req.valid("json");

			// Get vendor ID
			let vendorId: string;
			if (user.role === "admin") {
				vendorId = user.vendorId!;
				if (!vendorId) {
					throw createError.badRequest("Vendor ID is required for admin users");
				}
			} else {
				if (!user.vendorId) {
					throw createError.forbidden("Vendor account required");
				}
				vendorId = user.vendorId;
			}

			const video = await VideoRepository.create({
				...data,
				vendorId,
			});

			logger.info("Video created successfully", {
				videoId: video.id,
				vendorId,
				userId: user.id,
			});

			return c.json(
				{
					success: true,
					message: "Video created successfully",
					data: video,
				},
				201,
			);
		} catch (error) {
			logger.error("Failed to create video", error as Error);
			throw error;
		}
	},
);

// Get single video (public)
videos.get("/:id", optionalAuthMiddleware, async (c) => {
	try {
		const id = c.req.param("id");
		const video = await VideoRepository.findById(id);

		if (!video) {
			throw createError.notFound("Video not found");
		}

		// Check if video is public or user has access
		const user = c.get("user");
		if (!video.isPublic) {
			if (
				!user ||
				(user.role === "vendor" && user.vendorId !== video.vendorId) ||
				(user.role !== "admin" && user.role !== "vendor")
			) {
				throw createError.forbidden("Access denied to this video");
			}
		}

		// Increment view count
		await VideoRepository.incrementViewCount(id);

		return c.json({
			success: true,
			data: video,
		});
	} catch (error) {
		logger.error("Failed to get video", error as Error);
		throw error;
	}
});

// Update video (vendor owner/admin only)
videos.put(
	"/:id",
	authMiddleware,
	requireVendorOrAdmin,
	zValidator("json", updateVideoSchema),
	async (c) => {
		try {
			const user = c.get("user");
			const id = c.req.param("id");
			const data = c.req.valid("json");

			// Get existing video
			const existingVideo = await VideoRepository.findById(id);
			if (!existingVideo) {
				throw createError.notFound("Video not found");
			}

			// Check ownership (vendors can only update their own videos)
			if (user.role === "vendor" && existingVideo.vendorId !== user.vendorId) {
				throw createError.forbidden("Access denied to this video");
			}

			const video = await VideoRepository.update(id, data);

			if (!video) {
				throw createError.notFound("Video not found");
			}

			logger.info("Video updated successfully", {
				videoId: id,
				userId: user.id,
			});

			return c.json({
				success: true,
				message: "Video updated successfully",
				data: video,
			});
		} catch (error) {
			logger.error("Failed to update video", error as Error);
			throw error;
		}
	},
);

// Like video (authenticated users)
videos.post("/:id/like", authMiddleware, requireAuthenticated, async (c) => {
	try {
		const user = c.get("user");
		const id = c.req.param("id");

		// TODO: Check if user already liked this video
		// TODO: Store user likes in database

		const updated = await VideoRepository.incrementLikeCount(id);

		if (!updated) {
			throw createError.notFound("Video not found");
		}

		logger.info("Video liked", {
			videoId: id,
			userId: user.id,
		});

		return c.json({
			success: true,
			message: "Video liked successfully",
		});
	} catch (error) {
		logger.error("Failed to like video", error as Error);
		throw error;
	}
});

// Share video (authenticated users)
videos.post("/:id/share", authMiddleware, requireAuthenticated, async (c) => {
	try {
		const user = c.get("user");
		const id = c.req.param("id");

		const updated = await VideoRepository.incrementShareCount(id);

		if (!updated) {
			throw createError.notFound("Video not found");
		}

		logger.info("Video shared", {
			videoId: id,
			userId: user.id,
		});

		return c.json({
			success: true,
			message: "Video shared successfully",
		});
	} catch (error) {
		logger.error("Failed to share video", error as Error);
		throw error;
	}
});

// Delete video (vendor owner/admin only)
videos.delete("/:id", authMiddleware, requireVendorOrAdmin, async (c) => {
	try {
		const user = c.get("user");
		const id = c.req.param("id");

		// Get existing video
		const existingVideo = await VideoRepository.findById(id);
		if (!existingVideo) {
			throw createError.notFound("Video not found");
		}

		// Check ownership (vendors can only delete their own videos)
		if (user.role === "vendor" && existingVideo.vendorId !== user.vendorId) {
			throw createError.forbidden("Access denied to this video");
		}

		const deleted = await VideoRepository.delete(id);

		if (!deleted) {
			throw createError.notFound("Video not found");
		}

		logger.info("Video deleted successfully", {
			videoId: id,
			userId: user.id,
		});

		return c.json({
			success: true,
			message: "Video deleted successfully",
		});
	} catch (error) {
		logger.error("Failed to delete video", error as Error);
		throw error;
	}
});

// Get vendor's videos (vendor owner/admin only)
videos.get(
	"/vendor/:vendorId",
	authMiddleware,
	zValidator(
		"query",
		querySchema.extend({
			includePrivate: z
				.string()
				.transform((val) => val === "true")
				.optional(),
		}),
	),
	async (c) => {
		try {
			const user = c.get("user");
			const vendorId = c.req.param("vendorId");
			const query = c.req.valid("query");

			// Check access (vendors can only see their own videos, admins can see all)
			if (user.role === "vendor" && user.vendorId !== vendorId) {
				throw createError.forbidden("Access denied to this vendor's videos");
			}

			const includePrivate =
				user.role === "admin" ||
				(user.role === "vendor" && user.vendorId === vendorId);

			const result = await VideoRepository.getByVendor(
				vendorId,
				query.page,
				query.limit,
				includePrivate && query.includePrivate,
			);

			return c.json({
				success: true,
				data: result,
				pagination: {
					page: query.page,
					limit: query.limit,
					total: result.total,
					totalPages: Math.ceil(result.total / query.limit),
				},
			});
		} catch (error) {
			logger.error("Failed to get vendor videos", error as Error);
			throw error;
		}
	},
);

// Get video statistics (vendor/admin only)
videos.get(
	"/stats/summary",
	authMiddleware,
	requireVendorOrAdmin,
	zValidator(
		"query",
		z.object({
			vendorId: z.string().uuid().optional(),
			dateFrom: z.string().datetime().optional(),
			dateTo: z.string().datetime().optional(),
		}),
	),
	async (c) => {
		try {
			const user = c.get("user");
			const query = c.req.valid("query");

			let filters: any = {
				dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
				dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
			};

			// Apply user-specific filters
			if (user.role === "vendor") {
				filters.vendorId = user.vendorId;
			} else if (user.role === "admin") {
				filters.vendorId = query.vendorId;
			}

			const stats = await VideoRepository.getStats(filters);

			return c.json({
				success: true,
				data: stats,
			});
		} catch (error) {
			logger.error("Failed to get video statistics", error as Error);
			throw createError.internal("Failed to retrieve video statistics");
		}
	},
);

export default videos;
