import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { secureHeaders } from "hono/secure-headers";
import { fire } from "hono/service-worker";

// Configuration and utilities
import { config } from "./config";
import { logger } from "./config/logger";
import { rateLimiter } from "./middleware/rateLimiter";
import { errorHandler } from "./middleware/errorHandler";
import MediaService from "./services/mediaService";
import InternalService from "./services/InternalService";
import { getMediaServerService } from "./services/mediaServerService";
import { shutdownChatService } from "./services/chatService";

// Database connections
import {
	initializeDatabase,
	closeDatabase,
	checkDatabaseHealth,
} from "./database/connection";
import {
	checkRedisHealth,
	closeRedis,
	initializeRedis,
} from "./database/redis";

// Import routes
import authRoutes from "./routes/auth";
import userRoutes from "./routes/users";
import vendorRoutes from "./routes/vendors";
import analyticsRoutes from "./routes/analytics";
import productRoutes from "./routes/products";
import orderRoutes from "./routes/orders";
import cartRoutes from "./routes/cart";
import streamRoutes from "./routes/streams";
import videoRoutes from "./routes/videos";
import paymentRoutes from "./routes/payments";
import uploadRoutes from "./routes/uploads";
import notificationRoutes from "./routes/notifications";

const app = new Hono();

app.use(
	"*",
	honoLogger((message) => {
		logger.info(message, { type: "http" });
	}),
);

app.use("*", prettyJSON());
app.use("*", secureHeaders());

app.use(
	"*",
	cors({
		origin: config.cors.origin,
		credentials: config.cors.credentials,
		allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
	}),
);

app.use("*", rateLimiter);

app.get("/health", async (c) => {
	const dbHealth = await checkDatabaseHealth();
	const redisHealth = await checkRedisHealth();

	const health = {
		status: dbHealth && redisHealth ? "ok" : "degraded",
		timestamp: new Date().toISOString(),
		environment: config.server.nodeEnv,
		version: "1.0.0",
		services: {
			database: dbHealth ? "healthy" : "unhealthy",
			redis: redisHealth ? "healthy" : "unhealthy",
		},
	};

	const statusCode = health.status === "ok" ? 200 : 503;
	return c.json(health, statusCode);
});

app.route("/api/auth", authRoutes);
app.route("/api/users", userRoutes);
app.route("/api/vendors", vendorRoutes);
app.route("/api/products", productRoutes);
app.route("/api/orders", orderRoutes);
app.route("/api/cart", cartRoutes);
app.route("/api/streams", streamRoutes);
app.route("/api/videos", videoRoutes);
app.route("/api/payments", paymentRoutes);
app.route("/api/analytics", analyticsRoutes);
app.route("/api/uploads", uploadRoutes);
app.route("/api/notifications", notificationRoutes);

// 404 handler
app.notFound((c) => {
	return c.json(
		{
			error: "Not Found",
			message: "The requested resource was not found",
			path: c.req.path,
		},
		404,
	);
});

app.onError(errorHandler);

const startServer = async () => {
	try {
		logger.info("🚀 Starting Live Streaming E-commerce API Server...");

		// Initialize database connections
		logger.info("📊 Initializing database connections...");
		await initializeDatabase();
		await initializeRedis();

		// Initialize MediaService
		logger.info("📁 Initializing MediaService...");
		await MediaService.initialize();

		// Initialize and start Media Server
		logger.info("📺 Initializing Media Server...");
		const mediaServer = getMediaServerService();
		await mediaServer.start();

		// Initialize Internal Service
		logger.info("🔧 Initializing Internal Service...");
		await InternalService.create();

		fire(app);
	} catch (error) {
		logger.error("Failed to start server", error as Error);
		process.exit(1);
	}
};

const gracefulShutdown = async (signal: string) => {
	logger.info(`Received ${signal}. Starting graceful shutdown...`);

	try {
		await shutdownChatService();
		await closeDatabase();
		await closeRedis();
		logger.info("✅ Graceful shutdown completed");
		process.exit(0);
	} catch (error) {
		logger.error("❌ Error during graceful shutdown", error as Error);
		process.exit(1);
	}
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

startServer();
export default app;
