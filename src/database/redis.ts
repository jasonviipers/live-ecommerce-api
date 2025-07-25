import { createClient, type RedisClientType } from "redis";
import { config } from "../config";
import { logger } from "../config/logger";

// Redis clients
let redisClient: RedisClientType | null = null;
let redisSubscriber: RedisClientType | null = null;
let redisPublisher: RedisClientType | null = null;

export const initializeRedis = async (): Promise<{
	client: RedisClientType;
	subscriber: RedisClientType;
	publisher: RedisClientType;
}> => {
	if (redisClient && redisSubscriber && redisPublisher) {
		return {
			client: redisClient,
			subscriber: redisSubscriber,
			publisher: redisPublisher,
		};
	}

	try {
		// Main Redis client for general operations
		redisClient = createClient({
			url: config.redis.url,
			socket: {
				host: config.redis.host,
				port: config.redis.port,
			},
			password: config.redis.password,
		});

		// Subscriber client for pub/sub
		redisSubscriber = createClient({
			url: config.redis.url,
			socket: {
				host: config.redis.host,
				port: config.redis.port,
			},
			password: config.redis.password,
		});

		// Publisher client for pub/sub
		redisPublisher = createClient({
			url: config.redis.url,
			socket: {
				host: config.redis.host,
				port: config.redis.port,
			},
			password: config.redis.password,
		});

		// Error handlers
		redisClient.on("error", (err) => {
			logger.error("Redis client error", err);
		});

		redisSubscriber.on("error", (err) => {
			logger.error("Redis subscriber error", err);
		});

		redisPublisher.on("error", (err) => {
			logger.error("Redis publisher error", err);
		});

		// Connect all clients
		await Promise.all([
			redisClient.connect(),
			redisSubscriber.connect(),
			redisPublisher.connect(),
		]);

		logger.info("✅ Redis connected successfully");

		return {
			client: redisClient,
			subscriber: redisSubscriber,
			publisher: redisPublisher,
		};
	} catch (error) {
		logger.error("❌ Failed to connect to Redis", error as Error);
		throw error;
	}
};

export const getRedisClient = (): RedisClientType => {
	if (!redisClient) {
		throw new Error("Redis not initialized. Call initializeRedis() first.");
	}
	return redisClient;
};

export const getRedisSubscriber = (): RedisClientType => {
	if (!redisSubscriber) {
		throw new Error(
			"Redis subscriber not initialized. Call initializeRedis() first.",
		);
	}
	return redisSubscriber;
};

export const getRedisPublisher = (): RedisClientType => {
	if (!redisPublisher) {
		throw new Error(
			"Redis publisher not initialized. Call initializeRedis() first.",
		);
	}
	return redisPublisher;
};

export const closeRedis = async (): Promise<void> => {
	const promises = [];

	if (redisClient) {
		promises.push(redisClient.quit());
		redisClient = null;
	}

	if (redisSubscriber) {
		promises.push(redisSubscriber.quit());
		redisSubscriber = null;
	}

	if (redisPublisher) {
		promises.push(redisPublisher.quit());
		redisPublisher = null;
	}

	await Promise.all(promises);
	logger.info("Redis connections closed");
};

// Cache helper functions
export const cache = {
	// Get value from cache
	get: async (key: string): Promise<string | null> => {
		const client = getRedisClient();
		return await client.get(key);
	},

	// Set value in cache
	set: async (key: string, value: string, ttl?: number): Promise<void> => {
		const client = getRedisClient();
		if (ttl) {
			await client.setEx(key, ttl, value);
		} else {
			await client.set(key, value);
		}
	},

	getJSON: async <T>(key: string): Promise<T | null> => {
		const value = await cache.get(key);
		return value ? JSON.parse(value) : null;
	},

	setJSON: async (key: string, value: unknown, ttl?: number): Promise<void> => {
		await cache.set(key, JSON.stringify(value), ttl);
	},

	del: async (key: string): Promise<void> => {
		const client = getRedisClient();
		await client.del(key);
	},

	exists: async (key: string): Promise<boolean> => {
		const client = getRedisClient();
		return (await client.exists(key)) === 1;
	},

	expire: async (key: string, ttl: number): Promise<void> => {
		const client = getRedisClient();
		await client.expire(key, ttl);
	},

	keys: async (pattern: string): Promise<string[]> => {
		const client = getRedisClient();
		return await client.keys(pattern);
	},

	// Increment counter
	incr: async (key: string): Promise<number> => {
		const client = getRedisClient();
		return await client.incr(key);
	},

	incrWithExpire: async (key: string, ttl: number): Promise<number> => {
		const client = getRedisClient();
		const value = await client.incr(key);
		if (value === 1) {
			await client.expire(key, ttl);
		}
		return value;
	},
};

// Session helper functions
export const session = {
	// Get session data
	get: async <T = Record<string, unknown>>(
		sessionId: string,
	): Promise<T | null> => {
		return await cache.getJSON(`session:${sessionId}`);
	},

	// Set session data
	set: async (
		sessionId: string,
		data: Record<string, unknown>,
		ttl: number = 3600,
	): Promise<void> => {
		await cache.setJSON(`session:${sessionId}`, data, ttl);
	},

	// Delete session
	delete: async (sessionId: string): Promise<void> => {
		await cache.del(`session:${sessionId}`);
	},

	// Extend session expiration
	extend: async (sessionId: string, ttl: number = 3600): Promise<void> => {
		await cache.expire(`session:${sessionId}`, ttl);
	},
};

// Pub/Sub helper functions
export const pubsub = {
	// Publish message
	publish: async (channel: string, message: string): Promise<void> => {
		const publisher = getRedisPublisher();
		await publisher.publish(channel, JSON.stringify(message));
	},

	// Subscribe to channel
	subscribe: async (
		channel: string,
		callback: (message: string) => void,
	): Promise<void> => {
		const subscriber = getRedisSubscriber();
		await subscriber.subscribe(channel, (message) => {
			try {
				const parsedMessage = JSON.parse(message);
				callback(parsedMessage);
			} catch (error) {
				logger.error("Failed to parse pub/sub message", error as Error, {
					channel,
					message,
				});
			}
		});
	},

	// Unsubscribe from channel
	unsubscribe: async (channel: string): Promise<void> => {
		const subscriber = getRedisSubscriber();
		await subscriber.unsubscribe(channel);
	},
};

// Health check
export const checkRedisHealth = async (): Promise<boolean> => {
	try {
		const client = getRedisClient();
		const result = await client.ping();
		return result === "PONG";
	} catch (error) {
		logger.error("Redis health check failed", error as Error);
		return false;
	}
};

export default {
	initializeRedis,
	getRedisClient,
	getRedisSubscriber,
	getRedisPublisher,
	closeRedis,
	cache,
	session,
	pubsub,
	checkRedisHealth,
};
