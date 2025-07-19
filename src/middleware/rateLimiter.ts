import { Context, Next } from "hono";
import { config } from "../config";
import { createError } from "./errorHandler";
import { logger } from "../config/logger";

interface RateLimitStore {
	[key: string]: {
		count: number;
		resetTime: number;
	};
}

// In-memory store for rate limiting (in production, use Redis)
const store: RateLimitStore = {};

// Clean up expired entries every minute
setInterval(() => {
	const now = Date.now();
	Object.keys(store).forEach((key) => {
		if (store[key].resetTime < now) {
			delete store[key];
		}
	});
}, 60000);

export interface RateLimitOptions {
	windowMs?: number;
	maxRequests?: number;
	message?: string;
	skipSuccessfulRequests?: boolean;
	skipFailedRequests?: boolean;
	keyGenerator?: (c: Context) => string;
}

export const createRateLimiter = (options: RateLimitOptions = {}) => {
	const {
		windowMs = config.rateLimit.windowMs,
		maxRequests = config.rateLimit.maxRequests,
		message = "Too many requests, please try again later",
		skipSuccessfulRequests = false,
		skipFailedRequests = false,
		keyGenerator = (c: Context) => {
			// Use IP address as default key
			return (
				c.req.header("x-forwarded-for") ||
				c.req.header("x-real-ip") ||
				"unknown"
			);
		},
	} = options;

	return async (c: Context, next: Next) => {
		const key = keyGenerator(c);
		const now = Date.now();
		const resetTime = now + windowMs;

		// Initialize or get existing record
		if (!store[key] || store[key].resetTime < now) {
			store[key] = {
				count: 0,
				resetTime,
			};
		}

		const record = store[key];

		// Check if limit exceeded
		if (record.count >= maxRequests) {
			logger.warn("Rate limit exceeded", {
				key,
				count: record.count,
				maxRequests,
				resetTime: new Date(record.resetTime).toISOString(),
			});

			// Set rate limit headers
			c.header("X-RateLimit-Limit", maxRequests.toString());
			c.header("X-RateLimit-Remaining", "0");
			c.header(
				"X-RateLimit-Reset",
				Math.ceil(record.resetTime / 1000).toString(),
			);
			c.header(
				"Retry-After",
				Math.ceil((record.resetTime - now) / 1000).toString(),
			);

			throw createError.tooManyRequests(message);
		}

		// Increment counter
		record.count++;

		// Set rate limit headers
		c.header("X-RateLimit-Limit", maxRequests.toString());
		c.header("X-RateLimit-Remaining", (maxRequests - record.count).toString());
		c.header(
			"X-RateLimit-Reset",
			Math.ceil(record.resetTime / 1000).toString(),
		);

		await next();

		// Handle skip options
		const statusCode = c.res.status;
		if (skipSuccessfulRequests && statusCode < 400) {
			record.count--;
		} else if (skipFailedRequests && statusCode >= 400) {
			record.count--;
		}
	};
};

export const rateLimiter = createRateLimiter();

// Specific rate limiters for different endpoints
export const authRateLimiter = createRateLimiter({
	windowMs: 15 * 60 * 1000, // 15 minutes
	maxRequests: 5, // 5 attempts per 15 minutes
	message: "Too many authentication attempts, please try again later",
});

export const uploadRateLimiter = createRateLimiter({
	windowMs: 60 * 60 * 1000, // 1 hour
	maxRequests: 50, // 50 uploads per hour
	message: "Too many upload requests, please try again later",
});

export const streamRateLimiter = createRateLimiter({
	windowMs: 60 * 60 * 1000, // 1 hour
	maxRequests: 10, // 10 stream creations per hour
	message: "Too many stream creation requests, please try again later",
});

export const paymentRateLimiter = createRateLimiter({
	windowMs: 60 * 60 * 1000, // 1 hour
	maxRequests: 20, // 20 payment requests per hour
	message: "Too many payment requests, please try again later",
});

// Rate limiter by user ID
export const createUserRateLimiter = (options: RateLimitOptions = {}) => {
	return createRateLimiter({
		...options,
		keyGenerator: (c: Context) => {
			const user = c.get("user");
			return user?.id || c.req.header("x-forwarded-for") || "unknown";
		},
	});
};

export default rateLimiter;
