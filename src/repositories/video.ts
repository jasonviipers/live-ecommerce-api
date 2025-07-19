import { query, withTransaction } from "@/database/connection";
import { CreateVideoData, UpdateVideoData, Video } from "@/types";
import { PoolClient } from "pg";

export class VideoRepository {
	// Create a new video
	static async create(data: CreateVideoData): Promise<Video> {
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
		return this.mapRowToVideo(result.rows[0]);
	}

	// Find video by ID
	static async findById(id: string): Promise<Video | null> {
		const sql = "SELECT * FROM videos WHERE id = $1";
		const result = await query(sql, [id]);

		if (result.rows.length === 0) {
			return null;
		}

		return this.mapRowToVideo(result.rows[0]);
	}

	// Find all videos with pagination and filters
	static async findAll(
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
		const values: any[] = [];
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
		const orderClause = `ORDER BY ${this.camelToSnake(sortBy)} ${sortOrder.toUpperCase()}`;

		// Get videos
		const sql = `
      SELECT * FROM videos 
      ${whereClause}
      ${orderClause}
      LIMIT $${++paramCount} OFFSET $${++paramCount}
    `;
		values.push(limit, offset);

		const result = await query(sql, values);
		const videos = result.rows.map(this.mapRowToVideo);

		return {
			videos,
			total,
			page,
			limit,
		};
	}

	// Update video
	static async update(
		id: string,
		data: UpdateVideoData,
	): Promise<Video | null> {
		const fields: string[] = [];
		const values: any[] = [];
		let paramCount = 0;

		// Build dynamic update query
		Object.entries(data).forEach(([key, value]) => {
			if (value !== undefined) {
				const dbField = this.camelToSnake(key);
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
			return this.findById(id);
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

		return this.mapRowToVideo(result.rows[0]);
	}

	// Update video statistics
	static async updateStats(
		id: string,
		stats: {
			viewCount?: number;
			likeCount?: number;
			shareCount?: number;
			commentCount?: number;
		},
	): Promise<boolean> {
		const fields: string[] = [];
		const values: any[] = [];
		let paramCount = 0;

		Object.entries(stats).forEach(([key, value]) => {
			if (value !== undefined) {
				const dbField = this.camelToSnake(key);
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
		return result.rowCount > 0;
	}

	// Increment view count
	static async incrementViewCount(id: string): Promise<boolean> {
		const sql = "UPDATE videos SET view_count = view_count + 1 WHERE id = $1";
		const result = await query(sql, [id]);
		return result.rowCount > 0;
	}

	// Increment like count
	static async incrementLikeCount(id: string): Promise<boolean> {
		const sql = "UPDATE videos SET like_count = like_count + 1 WHERE id = $1";
		const result = await query(sql, [id]);
		return result.rowCount > 0;
	}

	// Increment share count
	static async incrementShareCount(id: string): Promise<boolean> {
		const sql = "UPDATE videos SET share_count = share_count + 1 WHERE id = $1";
		const result = await query(sql, [id]);
		return result.rowCount > 0;
	}

	// Get trending videos
	static async getTrendingVideos(
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
		return result.rows.map(this.mapRowToVideo);
	}

	// Get recent videos
	static async getRecentVideos(limit: number = 20): Promise<Video[]> {
		const sql = `
      SELECT * FROM videos 
      WHERE status = 'ready' AND is_public = true
      ORDER BY created_at DESC
      LIMIT $1
    `;

		const result = await query(sql, [limit]);
		return result.rows.map(this.mapRowToVideo);
	}

	// Get popular videos by view count
	static async getPopularVideos(
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
					dateFilter =
						"AND created_at >= CURRENT_TIMESTAMP - INTERVAL '1 week'";
					break;
				case "month":
					dateFilter =
						"AND created_at >= CURRENT_TIMESTAMP - INTERVAL '1 month'";
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
		return result.rows.map(this.mapRowToVideo);
	}

	// Search videos
	static async search(
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
		const values: any[] = [`%${searchTerm}%`, searchTerm];
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
		const videos = result.rows.map(this.mapRowToVideo);

		return { videos, total };
	}

	// Get videos by vendor
	static async getByVendor(
		vendorId: string,
		page: number = 1,
		limit: number = 20,
		includePrivate: boolean = false,
	): Promise<{ videos: Video[]; total: number }> {
		const offset = (page - 1) * limit;
		let whereClause = "WHERE vendor_id = $1 AND status = $2";
		const values: any[] = [vendorId, "ready"];

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
		const videos = result.rows.map(this.mapRowToVideo);

		return { videos, total };
	}

	// Delete video
	static async delete(id: string): Promise<boolean> {
		return withTransaction(async (client: PoolClient) => {
			const sql = "DELETE FROM videos WHERE id = $1";
			const result = await client.query(sql, [id]);
			return (result.rowCount ?? 0) > 0;
		});
	}

	// Get video statistics
	static async getStats(
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
		const values: any[] = [];
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

	// Helper method to map database row to Video object
	private static mapRowToVideo(row: any): Video {
		return {
			id: row.id,
			vendorId: row.vendor_id,
			title: row.title,
			description: row.description,
			videoUrl: row.video_url,
			thumbnailUrl: row.thumbnail_url,
			duration: parseInt(row.duration),
			fileSize: parseInt(row.file_size),
			resolution: row.resolution,
			format: row.format,
			status: row.status,
			isPublic: row.is_public,
			viewCount: parseInt(row.view_count),
			likeCount: parseInt(row.like_count),
			shareCount: parseInt(row.share_count),
			commentCount: parseInt(row.comment_count),
			tags: row.tags || [],
			metadata: row.metadata,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	// Helper method to convert camelCase to snake_case
	private static camelToSnake(str: string): string {
		return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
	}
}

export default VideoRepository;
