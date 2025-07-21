import { query } from "@/database/connection";
import { logger } from "@/config/logger";
import {
	AnalyticsEvent,
	AnalyticsMetrics,
	ProductAnalytics,
	StreamAnalytics,
	TrackEventData,
	VendorAnalytics,
	RealTimeMetrics,
} from "@/types";
import { getRedisClient } from "@/database/redis";

export class AnalyticsService {
	// Track analytics event
	static async trackEvent(data: TrackEventData): Promise<AnalyticsEvent> {
		try {
			const sql = `
        INSERT INTO analytics_events (
          user_id, session_id, event_type, event_category, event_action,
          event_label, event_value, properties, ip_address, user_agent,
          referrer, url
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
      `;

			const values = [
				data.userId || null,
				data.sessionId || null,
				data.eventType,
				data.eventCategory,
				data.eventAction,
				data.eventLabel || null,
				data.eventValue || null,
				data.properties ? JSON.stringify(data.properties) : null,
				data.ipAddress || null,
				data.userAgent || null,
				data.referrer || null,
				data.url || null,
			];

			const result = await query(sql, values);
			const event = AnalyticsService.mapRowToAnalyticsEvent(result.rows[0]);

			// Cache real-time metrics in Redis
			await AnalyticsService.updateRealTimeMetrics(event);

			return event;
		} catch (error) {
			logger.error("Failed to track analytics event", error as Error);
			throw error;
		}
	}

	// Get general analytics metrics
	static async getGeneralMetrics(
		dateFrom?: Date,
		dateTo?: Date,
	): Promise<AnalyticsMetrics> {
		try {
			const dateFilter = AnalyticsService.buildDateFilter(dateFrom, dateTo);

			// Total and active users
			const usersSql = `
        SELECT 
          COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) as total_users,
          COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL AND timestamp >= CURRENT_DATE - INTERVAL '30 days') as active_users
        FROM analytics_events 
        ${dateFilter.whereClause}
      `;

			const usersResult = await query(usersSql, dateFilter.values);
			const { total_users, active_users } = usersResult.rows[0];

			// Sessions and page views
			const sessionsSql = `
        SELECT 
          COUNT(DISTINCT session_id) as total_sessions,
          COUNT(*) FILTER (WHERE event_category = 'page_view') as page_views,
          COUNT(DISTINCT CONCAT(session_id, url)) FILTER (WHERE event_category = 'page_view') as unique_page_views
        FROM analytics_events 
        ${dateFilter.whereClause}
      `;

			const sessionsResult = await query(sessionsSql, dateFilter.values);
			const { total_sessions, page_views, unique_page_views } =
				sessionsResult.rows[0];

			// Session duration and bounce rate
			const sessionMetricsSql = `
        WITH session_metrics AS (
          SELECT 
            session_id,
            MIN(timestamp) as session_start,
            MAX(timestamp) as session_end,
            COUNT(*) as event_count
          FROM analytics_events 
          ${dateFilter.whereClause}
          GROUP BY session_id
        )
        SELECT 
          AVG(EXTRACT(EPOCH FROM (session_end - session_start))) as avg_session_duration,
          COUNT(*) FILTER (WHERE event_count = 1)::float / COUNT(*) as bounce_rate
        FROM session_metrics
      `;

			const sessionMetricsResult = await query(
				sessionMetricsSql,
				dateFilter.values,
			);
			const { avg_session_duration, bounce_rate } =
				sessionMetricsResult.rows[0];

			// Conversion rate (orders / unique visitors)
			const conversionSql = `
        SELECT 
          COUNT(DISTINCT user_id) FILTER (WHERE event_category = 'ecommerce' AND event_action = 'purchase') as conversions,
          COUNT(DISTINCT user_id) as total_visitors
        FROM analytics_events 
        ${dateFilter.whereClause}
      `;

			const conversionResult = await query(conversionSql, dateFilter.values);
			const { conversions, total_visitors } = conversionResult.rows[0];
			const conversionRate =
				total_visitors > 0 ? (conversions / total_visitors) * 100 : 0;

			return {
				totalUsers: parseInt(total_users) || 0,
				activeUsers: parseInt(active_users) || 0,
				totalSessions: parseInt(total_sessions) || 0,
				averageSessionDuration: parseFloat(avg_session_duration) || 0,
				bounceRate: parseFloat(bounce_rate) * 100 || 0,
				pageViews: parseInt(page_views) || 0,
				uniquePageViews: parseInt(unique_page_views) || 0,
				conversionRate: parseFloat(conversionRate.toFixed(2)),
			};
		} catch (error) {
			logger.error("Failed to get general metrics", error as Error);
			throw error;
		}
	}

	// Get stream analytics
	static async getStreamAnalytics(
		streamId: string,
		dateFrom?: Date,
		dateTo?: Date,
	): Promise<StreamAnalytics> {
		try {
			const dateFilter = AnalyticsService.buildDateFilter(
				dateFrom,
				dateTo,
				"ae.",
			);

			const sql = `
        SELECT 
          COUNT(*) FILTER (WHERE ae.event_category = 'stream' AND ae.event_action = 'view') as total_views,
          COUNT(DISTINCT ae.user_id) FILTER (WHERE ae.event_category = 'stream' AND ae.event_action = 'view') as unique_viewers,
          AVG(ae.event_value) FILTER (WHERE ae.event_category = 'stream' AND ae.event_action = 'view_duration') as avg_view_duration,
          MAX(ae.event_value) FILTER (WHERE ae.event_category = 'stream' AND ae.event_action = 'viewer_count') as peak_viewers,
          COUNT(*) FILTER (WHERE ae.event_category = 'stream' AND ae.event_action = 'chat_message') as chat_messages,
          COUNT(*) FILTER (WHERE ae.event_category = 'stream' AND ae.event_action = 'like') as likes,
          COUNT(*) FILTER (WHERE ae.event_category = 'stream' AND ae.event_action = 'share') as shares,
          COUNT(*) FILTER (WHERE ae.event_category = 'ecommerce' AND ae.event_action = 'purchase' AND ae.properties->>'streamId' = $1) as purchases,
          COALESCE(SUM((ae.properties->>'amount')::numeric) FILTER (WHERE ae.event_category = 'ecommerce' AND ae.event_action = 'purchase' AND ae.properties->>'streamId' = $1), 0) as revenue
        FROM analytics_events ae
        WHERE (ae.properties->>'streamId' = $1 OR (ae.event_category = 'ecommerce' AND ae.properties->>'streamId' = $1))
        ${dateFilter.whereClause ? "AND " + dateFilter.whereClause.replace("WHERE ", "") : ""}
      `;

			const values = [streamId, ...dateFilter.values];
			const result = await query(sql, values);
			const row = result.rows[0];

			const totalViews = parseInt(row.total_views) || 0;
			const uniqueViewers = parseInt(row.unique_viewers) || 0;
			const purchases = parseInt(row.purchases) || 0;
			const conversionRate =
				uniqueViewers > 0 ? (purchases / uniqueViewers) * 100 : 0;

			return {
				streamId,
				totalViews,
				uniqueViewers,
				averageViewDuration: parseFloat(row.avg_view_duration) || 0,
				peakViewers: parseInt(row.peak_viewers) || 0,
				chatMessages: parseInt(row.chat_messages) || 0,
				likes: parseInt(row.likes) || 0,
				shares: parseInt(row.shares) || 0,
				conversionRate: parseFloat(conversionRate.toFixed(2)),
				revenue: parseFloat(row.revenue) || 0,
			};
		} catch (error) {
			logger.error("Failed to get stream analytics", error as Error);
			throw error;
		}
	}

	// Get product analytics
	static async getProductAnalytics(
		productId: string,
		dateFrom?: Date,
		dateTo?: Date,
	): Promise<ProductAnalytics> {
		try {
			const dateFilter = AnalyticsService.buildDateFilter(
				dateFrom,
				dateTo,
				"ae.",
			);

			const sql = `
        SELECT 
          COUNT(*) FILTER (WHERE ae.event_category = 'product' AND ae.event_action = 'view') as views,
          COUNT(DISTINCT ae.user_id) FILTER (WHERE ae.event_category = 'product' AND ae.event_action = 'view') as unique_views,
          COUNT(*) FILTER (WHERE ae.event_category = 'ecommerce' AND ae.event_action = 'add_to_cart') as add_to_cart,
          COUNT(*) FILTER (WHERE ae.event_category = 'ecommerce' AND ae.event_action = 'purchase') as purchases,
          COALESCE(SUM((ae.properties->>'amount')::numeric) FILTER (WHERE ae.event_category = 'ecommerce' AND ae.event_action = 'purchase'), 0) as revenue
        FROM analytics_events ae
        WHERE ae.properties->>'productId' = $1
        ${dateFilter.whereClause ? "AND " + dateFilter.whereClause.replace("WHERE ", "") : ""}
      `;

			const values = [productId, ...dateFilter.values];
			const result = await query(sql, values);
			const row = result.rows[0];

			// Get product rating and reviews from products table
			const productSql = `
        SELECT 
          COALESCE(AVG(rating), 0) as average_rating,
          COUNT(*) as review_count
        FROM product_reviews 
        WHERE product_id = $1
      `;

			const productResult = await query(productSql, [productId]);
			const productRow = productResult.rows[0] || {
				average_rating: 0,
				review_count: 0,
			};

			const uniqueViews = parseInt(row.unique_views) || 0;
			const purchases = parseInt(row.purchases) || 0;
			const conversionRate =
				uniqueViews > 0 ? (purchases / uniqueViews) * 100 : 0;

			return {
				productId,
				views: parseInt(row.views) || 0,
				uniqueViews,
				addToCart: parseInt(row.add_to_cart) || 0,
				purchases,
				conversionRate: parseFloat(conversionRate.toFixed(2)),
				revenue: parseFloat(row.revenue) || 0,
				averageRating: parseFloat(productRow.average_rating) || 0,
				reviewCount: parseInt(productRow.review_count) || 0,
			};
		} catch (error) {
			logger.error("Failed to get product analytics", error as Error);
			throw error;
		}
	}

	// Get vendor analytics
	static async getVendorAnalytics(
		vendorId: string,
		dateFrom?: Date,
		dateTo?: Date,
	): Promise<VendorAnalytics> {
		try {
			const dateFilter = AnalyticsService.buildDateFilter(dateFrom, dateTo);

			// Basic vendor metrics
			const vendorSql = `
        SELECT 
          (SELECT COUNT(*) FROM products WHERE vendor_id = $1) as total_products,
          (SELECT COUNT(*) FROM orders WHERE vendor_id = $1 ${dateFilter.whereClause ? "AND " + dateFilter.whereClause.replace("WHERE ", "").replace("timestamp", "created_at") : ""}) as total_orders,
          (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE vendor_id = $1 AND status = 'completed' ${dateFilter.whereClause ? "AND " + dateFilter.whereClause.replace("WHERE ", "").replace("timestamp", "created_at") : ""}) as total_revenue,
          (SELECT COALESCE(AVG(total_amount), 0) FROM orders WHERE vendor_id = $1 AND status = 'completed' ${dateFilter.whereClause ? "AND " + dateFilter.whereClause.replace("WHERE ", "").replace("timestamp", "created_at") : ""}) as avg_order_value,
          (SELECT COUNT(DISTINCT user_id) FROM orders WHERE vendor_id = $1 ${dateFilter.whereClause ? "AND " + dateFilter.whereClause.replace("WHERE ", "").replace("timestamp", "created_at") : ""}) as customer_count
      `;

			const vendorResult = await query(vendorSql, [
				vendorId,
				...dateFilter.values,
			]);
			const vendorRow = vendorResult.rows[0];

			// Conversion rate
			const conversionSql = `
        SELECT 
          COUNT(*) FILTER (WHERE ae.event_category = 'ecommerce' AND ae.event_action = 'purchase') as purchases,
          COUNT(DISTINCT ae.user_id) FILTER (WHERE ae.event_category = 'product' AND ae.event_action = 'view') as unique_visitors
        FROM analytics_events ae
        WHERE ae.properties->>'vendorId' = $1
        ${dateFilter.whereClause ? "AND " + dateFilter.whereClause.replace("WHERE ", "") : ""}
      `;

			const conversionResult = await query(conversionSql, [
				vendorId,
				...dateFilter.values,
			]);
			const { purchases, unique_visitors } = conversionResult.rows[0];
			const conversionRate =
				unique_visitors > 0 ? (purchases / unique_visitors) * 100 : 0;

			// Repeat customer rate
			const repeatCustomerSql = `
        WITH customer_orders AS (
          SELECT user_id, COUNT(*) as order_count
          FROM orders 
          WHERE vendor_id = $1 ${dateFilter.whereClause ? "AND " + dateFilter.whereClause.replace("WHERE ", "").replace("timestamp", "created_at") : ""}
          GROUP BY user_id
        )
        SELECT 
          COUNT(*) FILTER (WHERE order_count > 1)::float / COUNT(*) as repeat_rate
        FROM customer_orders
      `;

			const repeatResult = await query(repeatCustomerSql, [
				vendorId,
				...dateFilter.values,
			]);
			const repeatCustomerRate =
				parseFloat(repeatResult.rows[0]?.repeat_rate || 0) * 100;

			// Top products
			const topProductsSql = `
        SELECT 
          p.id as product_id,
          COUNT(*) FILTER (WHERE ae.event_category = 'ecommerce' AND ae.event_action = 'purchase') as purchases,
          COALESCE(SUM((ae.properties->>'amount')::numeric) FILTER (WHERE ae.event_category = 'ecommerce' AND ae.event_action = 'purchase'), 0) as revenue
        FROM products p
        LEFT JOIN analytics_events ae ON ae.properties->>'productId' = p.id::text
        WHERE p.vendor_id = $1
        ${dateFilter.whereClause ? "AND " + dateFilter.whereClause.replace("WHERE ", "") : ""}
        GROUP BY p.id
        ORDER BY purchases DESC, revenue DESC
        LIMIT 10
      `;

			const topProductsResult = await query(topProductsSql, [
				vendorId,
				...dateFilter.values,
			]);
			const topProducts: ProductAnalytics[] = [];

			for (const row of topProductsResult.rows) {
				const productAnalytics = await this.getProductAnalytics(
					row.product_id,
					dateFrom,
					dateTo,
				);
				topProducts.push(productAnalytics);
			}

			return {
				vendorId,
				totalProducts: parseInt(vendorRow.total_products) || 0,
				totalOrders: parseInt(vendorRow.total_orders) || 0,
				totalRevenue: parseFloat(vendorRow.total_revenue) || 0,
				averageOrderValue: parseFloat(vendorRow.avg_order_value) || 0,
				conversionRate: parseFloat(conversionRate.toFixed(2)),
				customerCount: parseInt(vendorRow.customer_count) || 0,
				repeatCustomerRate: parseFloat(repeatCustomerRate.toFixed(2)),
				topProducts,
				recentStreams: [], // TODO: Implement recent streams analytics
			};
		} catch (error) {
			logger.error("Failed to get vendor analytics", error as Error);
			throw error;
		}
	}

	// Get real-time metrics from Redis
	static async getRealTimeMetrics(): Promise<RealTimeMetrics> {
		try {
			const keys = [
				"analytics:active_users",
				"analytics:page_views_today",
				"analytics:orders_today",
				"analytics:revenue_today",
				"analytics:active_streams",
			];

			const redisClient = getRedisClient();
			const pipeline = redisClient.multi();
			keys.forEach((k) => pipeline.get(k));

			const raw = await pipeline.exec();
			const getVal = (idx: number) =>
				(raw?.[idx] as unknown as string | null) ?? "0";

			return {
				activeUsers: Number(getVal(0)),
				pageViewsToday: Number(getVal(1)),
				ordersToday: Number(getVal(2)),
				revenueToday: Number(getVal(3)),
				activeStreams: Number(getVal(4)),
			};
		} catch (error) {
			logger.error("Failed to get real-time metrics", error as Error);
			return {
				activeUsers: 0,
				pageViewsToday: 0,
				ordersToday: 0,
				revenueToday: 0,
				activeStreams: 0,
			};
		}
	}

	// Update real-time metrics in Redis
	private static async updateRealTimeMetrics(
		event: AnalyticsEvent,
	): Promise<void> {
		try {
			const redisClient = getRedisClient();
			const pipeline = redisClient.multi();
			const today = new Date().toISOString().split("T")[0];

			// Track active users (expire after 30 minutes)
			if (event.userId) {
				pipeline.setEx(`analytics:active_user:${event.userId}`, 1800, "1");
			}

			// Track page views today
			if (event.eventCategory === "page_view") {
				pipeline.incr(`analytics:page_views:${today}`);
				pipeline.expire(`analytics:page_views:${today}`, 86400 * 7); // Keep for 7 days
			}

			// Track orders today
			if (
				event.eventCategory === "ecommerce" &&
				event.eventAction === "purchase"
			) {
				pipeline.incr(`analytics:orders:${today}`);
				pipeline.expire(`analytics:orders:${today}`, 86400 * 7);

				if (event.eventValue) {
					pipeline.incrByFloat(`analytics:revenue:${today}`, event.eventValue);
					pipeline.expire(`analytics:revenue:${today}`, 86400 * 7);
				}
			}

			await pipeline.exec();

			// Update aggregated counters
			await this.updateAggregatedCounters();
		} catch (error) {
			logger.error("Failed to update real-time metrics", error as Error);
		}
	}

	// Update aggregated counters
	private static async updateAggregatedCounters(): Promise<void> {
		try {
			const redisClient = getRedisClient();
			const pipeline = redisClient.multi();
			const today = new Date().toISOString().split("T")[0];

			// Count active users
			const activeUserKeys = await redisClient.keys("analytics:active_user:*");
			pipeline.set("analytics:active_users", activeUserKeys.length);

			// Get today's metrics
			pipeline.get(`analytics:page_views:${today}`);
			pipeline.get(`analytics:orders:${today}`);
			pipeline.get(`analytics:revenue:${today}`);

			const results = await pipeline.exec();
			if (!results) return;

			const val = (idx: number) => String(results[idx] ?? "0");

			pipeline
				.set("analytics:page_views_today", val(1))
				.set("analytics:orders_today", val(2))
				.set("analytics:revenue_today", val(3));

			await pipeline.exec();
		} catch (error) {
			logger.error("Failed to update aggregated counters", error as Error);
		}
	}

	// Helper method to build date filter
	private static buildDateFilter(
		dateFrom?: Date,
		dateTo?: Date,
		tableAlias: string = "",
	): { whereClause: string; values: any[] } {
		const conditions: string[] = [];
		const values: any[] = [];
		let paramCount = 0;

		const timestampField = tableAlias ? `${tableAlias}timestamp` : "timestamp";

		if (dateFrom) {
			conditions.push(`${timestampField} >= $${++paramCount}`);
			values.push(dateFrom);
		}

		if (dateTo) {
			conditions.push(`${timestampField} <= $${++paramCount}`);
			values.push(dateTo);
		}

		const whereClause =
			conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

		return { whereClause, values };
	}

	// Helper method to map database row to AnalyticsEvent
	private static mapRowToAnalyticsEvent(row: any): AnalyticsEvent {
		return {
			id: row.id,
			userId: row.user_id,
			sessionId: row.session_id,
			eventType: row.event_type,
			eventCategory: row.event_category,
			eventAction: row.event_action,
			eventLabel: row.event_label,
			eventValue: row.event_value ? parseFloat(row.event_value) : undefined,
			properties: row.properties,
			timestamp: row.timestamp,
			ipAddress: row.ip_address,
			userAgent: row.user_agent,
			referrer: row.referrer,
			url: row.url,
		};
	}
}

export default AnalyticsService;
