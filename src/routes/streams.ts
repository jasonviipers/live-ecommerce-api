import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
	authMiddleware,
	optionalAuthMiddleware,
	requireVendorOrAdmin,
	requireAuthenticated,
	internalServiceAuthMiddleware,
} from "../middleware/auth";
import { createError } from "@/middleware/errorHandler";
import { logger } from "@/config/logger";
import {
	createStreamSchema,
	querySchema,
	updateStreamSchema,
} from "@/utils/validation";
import StreamRepository from "@/repositories/stream";
import { UpdateStreamData } from "@/types";
import { withTransaction } from "@/database/connection";

const streamRoutes = new Hono();

// Get all streams (public)
streamRoutes.get(
	"/",
	optionalAuthMiddleware,
	zValidator("query", querySchema),
	async (c) => {
		try {
			const query = c.req.valid("query");

			const result = await StreamRepository.findAll(query.page, query.limit, {
				vendorId: query.vendorId,
				status: query.status,
				isLive: query.isLive,
				search: query.search,
				tags: query.tags,
				dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
				dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
				sortBy: query.sortBy as
					| "created_at"
					| "like_count"
					| "scheduled_at"
					| "viewer_count"
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
			logger.error("Failed to get streams", error as Error);
			throw createError.internal("Failed to retrieve streams");
		}
	},
);

// Get live streams (public)
streamRoutes.get("/live", async (c) => {
	try {
		const limit = parseInt(c.req.query("limit") || "20");
		const streams = await StreamRepository.getLiveStreams(Math.min(limit, 100));

		return c.json({
			success: true,
			data: streams,
		});
	} catch (error) {
		logger.error("Failed to get live streams", error as Error);
		throw createError.internal("Failed to retrieve live streams");
	}
});

// Get upcoming streams (public)
streamRoutes.get("/upcoming", async (c) => {
	try {
		const limit = parseInt(c.req.query("limit") || "20");
		const streams = await StreamRepository.getUpcomingStreams(
			Math.min(limit, 100),
		);

		return c.json({
			success: true,
			data: streams,
		});
	} catch (error) {
		logger.error("Failed to get upcoming streams", error as Error);
		throw createError.internal("Failed to retrieve upcoming streams");
	}
});

// Get popular streams (public)
streamRoutes.get(
	"/popular",
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
			const streams = await StreamRepository.getPopularStreams(
				timeframe,
				limit,
			);

			return c.json({
				success: true,
				data: streams,
			});
		} catch (error) {
			logger.error("Failed to get popular streams", error as Error);
			throw createError.internal("Failed to retrieve popular streams");
		}
	},
);

// Create stream (vendor/admin only)
streamRoutes.post(
	"/",
	authMiddleware,
	requireVendorOrAdmin,
	zValidator("json", createStreamSchema),
	async (c) => {
		try {
			const user = c.get("user");
			const data = c.req.valid("json");

			const vendorId = user.vendorId;
			if (!vendorId) {
				throw createError[user.role === "admin" ? "badRequest" : "forbidden"](
					user.role === "admin"
						? "Vendor ID is required for admin users"
						: "Vendor account required",
				);
			}
			const stream = await StreamRepository.create({
				...data,
				vendorId,
				scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : undefined,
			});

			logger.info("Stream created successfully", {
				streamId: stream.id,
				vendorId,
				userId: user.id,
			});

			return c.json(
				{
					success: true,
					message: "Stream created successfully",
					data: stream,
				},
				201,
			);
		} catch (error) {
			logger.error("Failed to create stream", error as Error);
			throw error;
		}
	},
);

// Get single stream (public)
streamRoutes.get("/:id", optionalAuthMiddleware, async (c) => {
	try {
		const id = c.req.param("id");
		const stream = await StreamRepository.findById(id);

		if (!stream) {
			throw createError.notFound("Stream not found");
		}

		return c.json({
			success: true,
			data: stream,
		});
	} catch (error) {
		logger.error("Failed to get stream", error as Error);
		throw error;
	}
});

// Update stream (vendor owner/admin only)
streamRoutes.put(
	"/:id",
	authMiddleware,
	requireVendorOrAdmin,
	zValidator("json", updateStreamSchema),
	async (c) => {
		try {
			const user = c.get("user");
			const id = c.req.param("id");
			const data = c.req.valid("json");

			// Get existing stream
			const existingStream = await StreamRepository.findById(id);
			if (!existingStream) {
				throw createError.notFound("Stream not found");
			}

			// Check ownership (vendors can only update their own streams)
			if (user.role === "vendor" && existingStream.vendorId !== user.vendorId) {
				throw createError.forbidden("Access denied to this stream");
			}

			// Convert date string to Date object
			const updateData: UpdateStreamData = {
				...data,
				scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : undefined,
			};
			if (updateData.scheduledAt) {
				updateData.scheduledAt = new Date(updateData.scheduledAt);
			}

			const stream = await StreamRepository.update(id, updateData);

			if (!stream) {
				throw createError.notFound("Stream not found");
			}

			logger.info("Stream updated successfully", {
				streamId: id,
				userId: user.id,
			});

			return c.json({
				success: true,
				message: "Stream updated successfully",
				data: stream,
			});
		} catch (error) {
			logger.error("Failed to update stream", error as Error);
			throw error;
		}
	},
);

// Start stream (vendor owner/admin only)
streamRoutes.post(
	"/:id/start",
	authMiddleware,
	requireVendorOrAdmin,
	async (c) => {
		try {
			const user = c.get("user");
			const id = c.req.param("id");

			// Get existing stream
			const existingStream = await StreamRepository.findById(id);
			if (!existingStream) {
				throw createError.notFound("Stream not found");
			}

			// Check ownership
			if (user.role === "vendor" && existingStream.vendorId !== user.vendorId) {
				throw createError.forbidden("Access denied to this stream");
			}

			const started = await StreamRepository.startStream(id);

			if (!started) {
				throw createError.badRequest("Stream cannot be started");
			}

			logger.info("Stream started", {
				streamId: id,
				userId: user.id,
			});

			return c.json({
				success: true,
				message: "Stream started successfully",
			});
		} catch (error) {
			logger.error("Failed to start stream", error as Error);
			throw error;
		}
	},
);

// End stream (vendor owner/admin only)
streamRoutes.post(
	"/:id/end",
	authMiddleware,
	requireVendorOrAdmin,
	zValidator(
		"json",
		z.object({
			recordingUrl: z.string().url().optional(),
		}),
	),
	async (c) => {
		try {
			const user = c.get("user");
			const id = c.req.param("id");
			const { recordingUrl } = c.req.valid("json");

			// Get existing stream
			const existingStream = await StreamRepository.findById(id);
			if (!existingStream) {
				throw createError.notFound("Stream not found");
			}

			// Check ownership
			if (user.role === "vendor" && existingStream.vendorId !== user.vendorId) {
				throw createError.forbidden("Access denied to this stream");
			}

			const ended = await StreamRepository.endStream(id, recordingUrl);

			if (!ended) {
				throw createError.badRequest("Stream cannot be ended");
			}

			logger.info("Stream ended", {
				streamId: id,
				userId: user.id,
				recordingUrl,
			});

			return c.json({
				success: true,
				message: "Stream ended successfully",
			});
		} catch (error) {
			logger.error("Failed to end stream", error as Error);
			throw error;
		}
	},
);

// Update viewer count (internal/webhook)
streamRoutes.patch(
	"/:id/viewers",
	internalServiceAuthMiddleware,
	zValidator(
		"json",
		z.object({
			viewerCount: z.number().int().min(0),
		}),
	),
	async (c) => {
		try {
			const id = c.req.param("id");
			const { viewerCount } = c.req.valid("json");

			const updated = await StreamRepository.updateViewerCount(id, viewerCount);

			if (!updated) {
				throw createError.notFound("Stream not found");
			}

			return c.json({
				success: true,
				message: "Viewer count updated",
			});
		} catch (error) {
			logger.error("Failed to update viewer count", error as Error);
			throw error;
		}
	},
);

// Like stream (authenticated users)
streamRoutes.post(
	"/:id/like",
	authMiddleware,
	requireAuthenticated,
	async (c) => {
		try {
			const user = c.get("user");
			const id = c.req.param("id");

			const alreadyLiked = await StreamRepository.hasUserLikedStream(
				id,
				user.id,
			);
			if (alreadyLiked) {
				throw createError.badRequest("You already liked this stream");
			}

			await withTransaction(async (client) => {
				await StreamRepository.incrementLikeCount(id, client);
				await StreamRepository.recordUserLike(id, user.id, client);
			});

			logger.info("Stream liked", {
				streamId: id,
				userId: user.id,
			});

			return c.json({
				success: true,
				message: "Stream liked successfully",
			});
		} catch (error) {
			logger.error("Failed to like stream", error as Error);
			throw error;
		}
	},
);

// Share stream (authenticated users)
streamRoutes.post(
	"/:id/share",
	authMiddleware,
	requireAuthenticated,
	async (c) => {
		try {
			const user = c.get("user");
			const id = c.req.param("id");

			const updated = await StreamRepository.incrementShareCount(id);

			if (!updated) {
				throw createError.notFound("Stream not found");
			}

			logger.info("Stream shared", {
				streamId: id,
				userId: user.id,
			});

			return c.json({
				success: true,
				message: "Stream shared successfully",
			});
		} catch (error) {
			logger.error("Failed to share stream", error as Error);
			throw error;
		}
	},
);

// Delete stream (vendor owner/admin only)
streamRoutes.delete("/:id", authMiddleware, requireVendorOrAdmin, async (c) => {
	try {
		const user = c.get("user");
		const id = c.req.param("id");

		// Get existing stream
		const existingStream = await StreamRepository.findById(id);
		if (!existingStream) {
			throw createError.notFound("Stream not found");
		}

		// Check ownership (vendors can only delete their own streams)
		if (user.role === "vendor" && existingStream.vendorId !== user.vendorId) {
			throw createError.forbidden("Access denied to this stream");
		}

		const deleted = await StreamRepository.delete(id);

		if (!deleted) {
			throw createError.notFound("Stream not found");
		}

		logger.info("Stream deleted successfully", {
			streamId: id,
			userId: user.id,
		});

		return c.json({
			success: true,
			message: "Stream deleted successfully",
		});
	} catch (error) {
		logger.error("Failed to delete stream", error as Error);
		throw error;
	}
});

// Get vendor's streams (vendor owner/admin only)
streamRoutes.get(
	"/vendor/:vendorId",
	authMiddleware,
	zValidator("query", querySchema),
	async (c) => {
		try {
			const user = c.get("user");
			const vendorId = c.req.param("vendorId");
			const query = c.req.valid("query");

			// Check access (vendors can only see their own streams, admins can see all)
			if (user.role === "vendor" && user.vendorId !== vendorId) {
				throw createError.forbidden("Access denied to this vendor's streams");
			}

			const result = await StreamRepository.findAll(query.page, query.limit, {
				vendorId,
				status: query.status,
				isLive: query.isLive,
				search: query.search,
				tags: query.tags,
				dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
				dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
				sortBy: query.sortBy as
					| "created_at"
					| "like_count"
					| "scheduled_at"
					| "viewer_count"
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
			logger.error("Failed to get vendor streams", error as Error);
			throw error;
		}
	},
);

export default streamRoutes;
