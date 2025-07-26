import { query, withTransaction } from "@/database/connection";
import type { CreateVideoData, UpdateVideoData, Video } from "@/types";
import type { PoolClient } from "pg";

export type SqlParameter = string | number | boolean | Date | string[] | null;
interface VideoRow {
	id: string;
	vendor_id: string;
	title: string;
	description: string | null;
	video_url: string;
	thumbnail_url: string | null;
	duration: string;
	file_size: string;
	resolution: string;
	format: string;
	status: string;
	is_public: boolean;
	view_count: string;
	like_count: string;
	share_count: string;
	comment_count: string;
	tags: string[] | null;
	metadata: Record<string, unknown> | null;
	created_at: Date;
	updated_at: Date;
}

// Helper function to map database row to Video object
function mapRowToVideo(row: VideoRow): Video {
	return {
		id: row.id,
		vendorId: row.vendor_id,
		title: row.title,
		description: row.description || undefined,
		videoUrl: row.video_url,
		thumbnailUrl: row.thumbnail_url || undefined,
		duration: parseInt(row.duration),
		fileSize: parseInt(row.file_size),
		resolution: row.resolution,
		format: row.format,
		status: row.status as "processing" | "ready" | "failed",
		isPublic: row.is_public,
		viewCount: parseInt(row.view_count),
		likeCount: parseInt(row.like_count),
		shareCount: parseInt(row.share_count),
		commentCount: parseInt(row.comment_count),
		tags: row.tags || [],
		metadata: row.metadata || undefined,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

// Helper function to convert camelCase to snake_case
function camelToSnake(str: string): string {
	return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export async function createVideo(data: CreateVideoData): Promise<Video> {
	const sql = `
      INSERT INTO videos (
        vendor_id, title, description, video_url, thumbnail_url,
        duration, file_size, resolution, format, is_public, tags, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `;

	const values = [
		data.vendorId,
		data.title,
		data.description,
		data.videoUrl,
		data.thumbnailUrl,
		data.duration,
		data.fileSize,
		data.resolution,
		data.format,
		data.isPublic ?? true,
		data.tags || [],
		data.metadata ? JSON.stringify(data.metadata) : null,
	];

	const result = await query(sql, values);
	return mapRowToVideo(result.rows[0]);
}

// Find video by ID
export async function findVideoById(id: string): Promise<Video | null> {
	const sql = "SELECT * FROM videos WHERE id = $1";
	const result = await query(sql, [id]);

	if (result.rows.length === 0) {
		return null;
	}

	return mapRowToVideo(result.rows[0]);
}

// Check if user has already liked a video
export async function hasUserLikedVideo(
	videoId: string,
	userId: string,
): Promise<boolean> {
	const sql = `
			SELECT 1 FROM likes 
			WHERE likeable_type = 'video' 
			AND likeable_id = $1 
			AND user_id = $2
	 `;
	const result = await query(sql, [videoId, userId]);
	return (result.rowCount ?? 0) > 0;
}

// Record a user like for a video
export async function recordUserLike(
	videoId: string,
	userId: string,
): Promise<void> {
	await query(
		"INSERT INTO likes (user_id, likeable_type, likeable_id) VALUES ($1, $2, $3)",
		[userId, "video", videoId],
	);
}

// Find all videos with pagination and filters
export async function findAllVideos(
	page: number = 1,
	limit: number = 20,
	filters: {
		vendorId?: string;
		status?: string;
		isPublic?: boolean;
		search?: string;
		tags?: string[];
		dateFrom?: Date;
		dateTo?: Date;
		sortBy?: "created_at" | "view_count" | "like_count" | "title";
		sortOrder?: "asc" | "desc";
	} = {},
): Promise<{ videos: Video[]; total: number; page: number; limit: number }> {
	const offset = (page - 1) * limit;
	let whereClause = "WHERE 1=1";
	const values: SqlParameter[] = [];
	let paramCount = 0;

	// Apply filters
	if (filters.vendorId) {
		whereClause += ` AND vendor_id = $${++paramCount}`;
		values.push(filters.vendorId);
	}

	if (filters.status) {
		whereClause += ` AND status = $${++paramCount}`;
		values.push(filters.status);
	}

	if (filters.isPublic !== undefined) {
		whereClause += ` AND is_public = $${++paramCount}`;
		values.push(filters.isPublic);
	}

	if (filters.search) {
		whereClause += ` AND (title ILIKE $${++paramCount} OR description ILIKE $${++paramCount})`;
		const searchPattern = `%${filters.search}%`;
		values.push(searchPattern, searchPattern);
		paramCount++;
	}

	if (filters.tags && filters.tags.length > 0) {
		whereClause += ` AND tags && $${++paramCount}`;
		values.push(filters.tags);
	}

	if (filters.dateFrom) {
		whereClause += ` AND created_at >= $${++paramCount}`;
		values.push(filters.dateFrom);
	}

	if (filters.dateTo) {
		whereClause += ` AND created_at <= $${++paramCount}`;
		values.push(filters.dateTo);
	}

	// Get total count
	const countSql = `SELECT COUNT(*) FROM videos ${whereClause}`;
	const countResult = await query(countSql, values);
	const total = parseInt(countResult.rows[0].count);

	// Build order clause
	const sortBy = filters.sortBy || "created_at";
	const sortOrder = filters.sortOrder || "desc";
	const orderClause = `ORDER BY ${camelToSnake(sortBy)} ${sortOrder.toUpperCase()}`;

	// Get videos
	const sql = `
      SELECT * FROM videos 
      ${whereClause}
      ${orderClause}
      LIMIT $${++paramCount} OFFSET $${++paramCount}
    `;
	values.push(limit, offset);

	const result = await query(sql, values);
	const videos = result.rows.map(mapRowToVideo);

	return {
		videos,
		total,
		page,
		limit,
	};
}

// Update video
export async function updateVideo(
	id: string,
	data: UpdateVideoData,
): Promise<Video | null> {
	const fields: string[] = [];
	const values: SqlParameter[] = [];
	let paramCount = 0;

	// Build dynamic update query
	Object.entries(data).forEach(([key, value]) => {
		if (value !== undefined) {
			const dbField = camelToSnake(key);
			if (key === "metadata" && value) {
				fields.push(`${dbField} = $${++paramCount}`);
				values.push(JSON.stringify(value));
			} else if (key === "tags" && Array.isArray(value)) {
				fields.push(`${dbField} = $${++paramCount}`);
				values.push(value);
			} else {
				fields.push(`${dbField} = $${++paramCount}`);
				values.push(value);
			}
		}
	});

	if (fields.length === 0) {
		return findVideoById(id);
	}

	const sql = `
      UPDATE videos 
      SET ${fields.join(", ")}
      WHERE id = $${++paramCount}
      RETURNING *
    `;
	values.push(id);

	const result = await query(sql, values);

	if (result.rows.length === 0) {
		return null;
	}

	return mapRowToVideo(result.rows[0]);
}

// Update video statistics
export async function updateVideoStats(
	id: string,
	stats: {
		viewCount?: number;
		likeCount?: number;
		shareCount?: number;
		commentCount?: number;
	},
): Promise<boolean> {
	const fields: string[] = [];
	const values: SqlParameter[] = [];
	let paramCount = 0;

	Object.entries(stats).forEach(([key, value]) => {
		if (value !== undefined) {
			const dbField = camelToSnake(key);
			fields.push(`${dbField} = $${++paramCount}`);
			values.push(value);
		}
	});

	if (fields.length === 0) {
		return false;
	}

	const sql = `
      UPDATE videos 
      SET ${fields.join(", ")}
      WHERE id = $${++paramCount}
    `;
	values.push(id);

	const result = await query(sql, values);
	return (result.rowCount ?? 0) > 0;
}

// Increment view count
export async function incrementViewCount(id: string): Promise<boolean> {
	const sql = "UPDATE videos SET view_count = view_count + 1 WHERE id = $1";
	const result = await query(sql, [id]);
	return (result.rowCount ?? 0) > 0;
}

// Increment like count
export async function incrementLikeCount(id: string): Promise<boolean> {
	const sql = "UPDATE videos SET like_count = like_count + 1 WHERE id = $1";
	const result = await query(sql, [id]);
	return (result.rowCount ?? 0) > 0;
}

// Increment share count
export async function incrementShareCount(id: string): Promise<boolean> {
	const sql = "UPDATE videos SET share_count = share_count + 1 WHERE id = $1";
	const result = await query(sql, [id]);
	return (result.rowCount ?? 0) > 0;
}

// Get trending videos
export async function getTrendingVideos(
	timeframe: "day" | "week" | "month" = "week",
	limit: number = 20,
): Promise<Video[]> {
	let dateFilter = "";
	switch (timeframe) {
		case "day":
			dateFilter = "AND created_at >= CURRENT_TIMESTAMP - INTERVAL '1 day'";
			break;
		case "week":
			dateFilter = "AND created_at >= CURRENT_TIMESTAMP - INTERVAL '1 week'";
			break;
		case "month":
			dateFilter = "AND created_at >= CURRENT_TIMESTAMP - INTERVAL '1 month'";
			break;
	}

	const sql = `
      SELECT * FROM videos 
      WHERE status = 'ready' AND is_public = true ${dateFilter}
      ORDER BY 
        (view_count * 0.4 + like_count * 0.3 + share_count * 0.2 + comment_count * 0.1) DESC,
        created_at DESC
      LIMIT $1
    `;

	const result = await query(sql, [limit]);
	return result.rows.map(mapRowToVideo);
}

// Get recent videos
export async function getRecentVideos(limit: number = 20): Promise<Video[]> {
	const sql = `
      SELECT * FROM videos 
      WHERE status = 'ready' AND is_public = true
      ORDER BY created_at DESC
      LIMIT $1
    `;

	const result = await query(sql, [limit]);
	return result.rows.map(mapRowToVideo);
}

// Get popular videos by view count
export async function getPopularVideos(
	timeframe: "day" | "week" | "month" | "all" = "all",
	limit: number = 20,
): Promise<Video[]> {
	let dateFilter = "";
	if (timeframe !== "all") {
		switch (timeframe) {
			case "day":
				dateFilter = "AND created_at >= CURRENT_TIMESTAMP - INTERVAL '1 day'";
				break;
			case "week":
				dateFilter = "AND created_at >= CURRENT_TIMESTAMP - INTERVAL '1 week'";
				break;
			case "month":
				dateFilter = "AND created_at >= CURRENT_TIMESTAMP - INTERVAL '1 month'";
				break;
		}
	}

	const sql = `
      SELECT * FROM videos 
      WHERE status = 'ready' AND is_public = true ${dateFilter}
      ORDER BY view_count DESC, like_count DESC
      LIMIT $1
    `;

	const result = await query(sql, [limit]);
	return result.rows.map(mapRowToVideo);
}

// Search videos
export async function searchVideos(
	searchTerm: string,
	filters: {
		vendorId?: string;
		tags?: string[];
		dateFrom?: Date;
		dateTo?: Date;
	} = {},
	page: number = 1,
	limit: number = 20,
): Promise<{ videos: Video[]; total: number }> {
	const offset = (page - 1) * limit;
	let whereClause = `
      WHERE status = 'ready' AND is_public = true
      AND (
        title ILIKE $1 
        OR description ILIKE $1 
        OR $2 = ANY(tags)
      )
    `;
	const values: SqlParameter[] = [`%${searchTerm}%`, searchTerm];
	let paramCount = 2;

	if (filters.vendorId) {
		whereClause += ` AND vendor_id = $${++paramCount}`;
		values.push(filters.vendorId);
	}

	if (filters.tags && filters.tags.length > 0) {
		whereClause += ` AND tags && $${++paramCount}`;
		values.push(filters.tags);
	}

	if (filters.dateFrom) {
		whereClause += ` AND created_at >= $${++paramCount}`;
		values.push(filters.dateFrom);
	}

	if (filters.dateTo) {
		whereClause += ` AND created_at <= $${++paramCount}`;
		values.push(filters.dateTo);
	}

	// Get total count
	const countSql = `SELECT COUNT(*) FROM videos ${whereClause}`;
	const countResult = await query(countSql, values);
	const total = parseInt(countResult.rows[0].count);

	// Get videos
	const sql = `
      SELECT * FROM videos 
      ${whereClause}
      ORDER BY 
        CASE WHEN title ILIKE $1 THEN 1 ELSE 2 END,
        view_count DESC,
        created_at DESC
      LIMIT $${++paramCount} OFFSET $${++paramCount}
    `;
	values.push(limit, offset);

	const result = await query(sql, values);
	const videos = result.rows.map(mapRowToVideo);

	return { videos, total };
}

// Get videos by vendor
export async function getVideosByVendor(
	vendorId: string,
	page: number = 1,
	limit: number = 20,
	includePrivate: boolean = false,
): Promise<{ videos: Video[]; total: number }> {
	const offset = (page - 1) * limit;
	let whereClause = "WHERE vendor_id = $1 AND status = $2";
	const values: SqlParameter[] = [vendorId, "ready"];

	if (!includePrivate) {
		whereClause += " AND is_public = true";
	}

	// Get total count
	const countSql = `SELECT COUNT(*) FROM videos ${whereClause}`;
	const countResult = await query(countSql, values);
	const total = parseInt(countResult.rows[0].count);

	// Get videos
	const sql = `
      SELECT * FROM videos 
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4
    `;
	values.push(limit, offset);

	const result = await query(sql, values);
	const videos = result.rows.map(mapRowToVideo);

	return { videos, total };
}

// Delete video
export async function deleteVideo(id: string): Promise<boolean> {
	return withTransaction(async (client: PoolClient) => {
		const sql = "DELETE FROM videos WHERE id = $1";
		const result = await client.query(sql, [id]);
		return (result.rowCount ?? 0) > 0;
	});
}

// Get video statistics
export async function getVideoStats(
	filters: { vendorId?: string; dateFrom?: Date; dateTo?: Date } = {},
): Promise<{
	totalVideos: number;
	totalViews: number;
	totalLikes: number;
	totalShares: number;
	totalComments: number;
	averageViews: number;
	videosByStatus: Record<string, number>;
}> {
	let whereClause = "WHERE 1=1";
	const values: SqlParameter[] = [];
	let paramCount = 0;

	if (filters.vendorId) {
		whereClause += ` AND vendor_id = $${++paramCount}`;
		values.push(filters.vendorId);
	}

	if (filters.dateFrom) {
		whereClause += ` AND created_at >= $${++paramCount}`;
		values.push(filters.dateFrom);
	}

	if (filters.dateTo) {
		whereClause += ` AND created_at <= $${++paramCount}`;
		values.push(filters.dateTo);
	}

	const sql = `
      SELECT 
        COUNT(*) as total_videos,
        COALESCE(SUM(view_count), 0) as total_views,
        COALESCE(SUM(like_count), 0) as total_likes,
        COALESCE(SUM(share_count), 0) as total_shares,
        COALESCE(SUM(comment_count), 0) as total_comments,
        COALESCE(AVG(view_count), 0) as average_views,
        COUNT(*) FILTER (WHERE status = 'processing') as processing_videos,
        COUNT(*) FILTER (WHERE status = 'ready') as ready_videos,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_videos
      FROM videos ${whereClause}
    `;

	const result = await query(sql, values);
	const row = result.rows[0];

	return {
		totalVideos: parseInt(row.total_videos),
		totalViews: parseInt(row.total_views),
		totalLikes: parseInt(row.total_likes),
		totalShares: parseInt(row.total_shares),
		totalComments: parseInt(row.total_comments),
		averageViews: parseFloat(row.average_views),
		videosByStatus: {
			processing: parseInt(row.processing_videos),
			ready: parseInt(row.ready_videos),
			failed: parseInt(row.failed_videos),
		},
	};
}

// Legacy export for backward compatibility (if needed)
export const VideoRepository = {
	create: createVideo,
	findById: findVideoById,
	hasUserLikedVideo,
	recordUserLike,
	findAll: findAllVideos,
	update: updateVideo,
	updateStats: updateVideoStats,
	incrementViewCount,
	incrementLikeCount,
	incrementShareCount,
	getTrendingVideos,
	getRecentVideos,
	getPopularVideos,
	search: searchVideos,
	getByVendor: getVideosByVendor,
	delete: deleteVideo,
	getStats: getVideoStats,
};

export default VideoRepository;
