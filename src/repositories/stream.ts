import type { PoolClient } from "pg";
import { createId } from "@paralleldrive/cuid2";
import type {
	CreateStreamData,
	Stream,
	StreamRow,
	UpdateStreamData,
} from "@/types";
import { query, withTransaction } from "@/database/connection";

// Helper function to map database row to Stream object
function mapRowToStream(row: StreamRow): Stream {
	return {
		id: row.id,
		vendorId: row.vendor_id,
		title: row.title,
		description: row.description || undefined,
		thumbnailUrl: row.thumbnail_url || undefined,
		streamKey: row.stream_key,
		rtmpUrl: row.rtmp_url,
		playbackUrl: row.playback_url,
		status: row.status,
		scheduledAt: row.scheduled_at || undefined,
		startedAt: row.started_at || undefined,
		endedAt: row.ended_at || undefined,
		viewerCount: parseInt(row.viewer_count),
		maxViewerCount: parseInt(row.max_viewer_count),
		likeCount: parseInt(row.like_count),
		shareCount: parseInt(row.share_count),
		commentCount: parseInt(row.comment_count),
		isRecorded: row.is_recorded,
		recordingUrl: row.recording_url || undefined,
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

export async function create(data: CreateStreamData): Promise<Stream> {
	const streamKey = createId();
	const rtmpUrl = `rtmp://localhost:1935/live/${streamKey}`;
	const playbackUrl = `http://localhost:8080/live/${streamKey}/index.m3u8`;

	const sql = `
      INSERT INTO streams (
        vendor_id, title, description, thumbnail_url, stream_key,
        rtmp_url, playback_url, scheduled_at, is_recorded, tags, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;

	const values = [
		data.vendorId,
		data.title,
		data.description,
		data.thumbnailUrl,
		streamKey,
		rtmpUrl,
		playbackUrl,
		data.scheduledAt,
		data.isRecorded ?? false,
		data.tags || [],
		data.metadata ? JSON.stringify(data.metadata) : null,
	];

	const result = await query(sql, values);
	return mapRowToStream(result.rows[0]);
}

export async function findById(id: string): Promise<Stream | null> {
	const sql = "SELECT * FROM streams WHERE id = $1";
	const result = await query(sql, [id]);

	if (result.rows.length === 0) {
		return null;
	}

	return mapRowToStream(result.rows[0]);
}

export async function findByStreamKey(
	streamKey: string,
): Promise<Stream | null> {
	const sql = "SELECT * FROM streams WHERE stream_key = $1";
	const result = await query(sql, [streamKey]);

	if (result.rows.length === 0) {
		return null;
	}

	return mapRowToStream(result.rows[0]);
}

export async function findAll(
	page: number = 1,
	limit: number = 20,
	filters: {
		vendorId?: string;
		status?: string;
		isLive?: boolean;
		search?: string;
		tags?: string[];
		dateFrom?: Date;
		dateTo?: Date;
		sortBy?: "created_at" | "scheduled_at" | "viewer_count" | "like_count";
		sortOrder?: "asc" | "desc";
	} = {},
): Promise<{
	streams: Stream[];
	total: number;
	page: number;
	limit: number;
}> {
	const offset = (page - 1) * limit;
	let whereClause = "WHERE 1=1";
	const values: (string | string[] | Date | number)[] = [];
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

	if (filters.isLive !== undefined) {
		if (filters.isLive) {
			whereClause += ` AND status = 'live'`;
		} else {
			whereClause += ` AND status != 'live'`;
		}
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
	const countSql = `SELECT COUNT(*) FROM streams ${whereClause}`;
	const countResult = await query(countSql, values);
	const total = parseInt(countResult.rows[0].count);

	// Build order clause
	const sortBy = filters.sortBy || "created_at";
	const sortOrder = filters.sortOrder || "desc";
	const orderClause = `ORDER BY ${camelToSnake(sortBy)} ${sortOrder.toUpperCase()}`;

	// Get streams
	const sql = `
      SELECT * FROM streams 
      ${whereClause}
      ${orderClause}
      LIMIT $${++paramCount} OFFSET $${++paramCount}
    `;
	values.push(limit, offset);

	const result = await query(sql, values);
	const streams = result.rows.map(mapRowToStream);

	return {
		streams,
		total,
		page,
		limit,
	};
}

export async function update(
	id: string,
	data: UpdateStreamData,
): Promise<Stream | null> {
	const fields: string[] = [];
	const values: (string | number | boolean | Date | string[])[] = [];
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
		return findById(id);
	}

	const sql = `
			UPDATE streams 
			SET ${fields.join(", ")}
			WHERE id = $${++paramCount}
			RETURNING *
			`;
	values.push(id);

	const result = await query(sql, values);

	if (result.rows.length === 0) {
		return null;
	}

	return mapRowToStream(result.rows[0]);
}

export async function startStream(id: string): Promise<boolean> {
	const sql = `
      UPDATE streams 
      SET status = 'live', started_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status IN ('scheduled', 'ended')
      RETURNING *
    `;

	const result = await query(sql, [id]);
	return (result.rowCount ?? 0) > 0;
}

export async function endStream(
	id: string,
	recordingUrl?: string,
): Promise<boolean> {
	const sql = `
      UPDATE streams 
      SET status = 'ended', ended_at = CURRENT_TIMESTAMP, recording_url = $2
      WHERE id = $1 AND status = 'live'
      RETURNING *
    `;

	const result = await query(sql, [id, recordingUrl]);
	if ((result.rowCount ?? 0) === 0) {
		return false;
	}
	return true;
}

export async function updateViewerCount(
	id: string,
	viewerCount: number,
): Promise<boolean> {
	const sql = `
      UPDATE streams 
      SET viewer_count = $1, max_viewer_count = GREATEST(max_viewer_count, $1)
      WHERE id = $2
    `;

	const result = await query(sql, [viewerCount, id]);
	return (result.rowCount ?? 0) > 0;
}

export async function updateStats(
	id: string,
	stats: {
		likeCount?: number;
		shareCount?: number;
		commentCount?: number;
	},
): Promise<boolean> {
	const fields: string[] = [];
	const values: (number | string)[] = [];
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
      UPDATE streams 
      SET ${fields.join(", ")}
      WHERE id = $${++paramCount}
    `;
	values.push(id);

	const result = await query(sql, values);
	return (result.rowCount ?? 0) > 0;
}

export async function incrementLikeCount(
	streamId: string,
	client: PoolClient | null = null,
): Promise<boolean> {
	const queryFn = client ? client.query.bind(client) : query;
	await queryFn(
		"UPDATE streams SET like_count = like_count + 1 WHERE id = $1",
		[streamId],
	);
	return true;
}

export async function incrementShareCount(id: string): Promise<boolean> {
	const sql = "UPDATE streams SET share_count = share_count + 1 WHERE id = $1";
	const result = await query(sql, [id]);
	return (result.rowCount ?? 0) > 0;
}

export async function getLiveStreams(limit: number = 20): Promise<Stream[]> {
	const sql = `
      SELECT * FROM streams 
      WHERE status = 'live'
      ORDER BY viewer_count DESC, started_at DESC
      LIMIT $1
    `;

	const result = await query(sql, [limit]);
	return result.rows.map(mapRowToStream);
}

export async function getUpcomingStreams(
	limit: number = 20,
): Promise<Stream[]> {
	const sql = `
      SELECT * FROM streams 
      WHERE status = 'scheduled' AND scheduled_at > CURRENT_TIMESTAMP
      ORDER BY scheduled_at ASC
      LIMIT $1
    `;

	const result = await query(sql, [limit]);
	return result.rows.map(mapRowToStream);
}

// Get popular streams (by viewer count)
export async function getPopularStreams(
	timeframe: "day" | "week" | "month" = "week",
	limit: number = 20,
): Promise<Stream[]> {
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
      SELECT * FROM streams 
      WHERE status IN ('live', 'ended') ${dateFilter}
      ORDER BY max_viewer_count DESC, like_count DESC
      LIMIT $1
    `;

	const result = await query(sql, [limit]);
	return result.rows.map(mapRowToStream);
}

export async function deleteStream(id: string): Promise<boolean> {
	return withTransaction(async (client: PoolClient) => {
		const sql = "DELETE FROM streams WHERE id = $1";
		const result = await client.query(sql, [id]);
		return (result.rowCount ?? 0) > 0;
	});
}

export async function hasUserLikedStream(
	streamId: string,
	userId: string,
): Promise<boolean> {
	const sql = `
        SELECT 1 FROM likes 
        WHERE likeable_type = 'stream' 
        AND likeable_id = $1 
        AND user_id = $2
    `;
	const result = await query(sql, [streamId, userId]);
	return (result.rowCount ?? 0) > 0;
}

export async function recordUserLike(
	streamId: string,
	userId: string,
	client: PoolClient | null = null,
): Promise<void> {
	const queryFn = client ? client.query.bind(client) : query;
	await queryFn(
		"INSERT INTO stream_likes (user_id, stream_id) VALUES ($1, $2)",
		[userId, streamId],
	);
}

export default {
	create,
	findById,
	findByStreamKey,
	findAll,
	update,
	startStream,
	endStream,
	updateViewerCount,
	updateStats,
	incrementLikeCount,
	incrementShareCount,
	getLiveStreams,
	getUpcomingStreams,
	getPopularStreams,
	delete: deleteStream,
	hasUserLikedStream,
	recordUserLike,
};
