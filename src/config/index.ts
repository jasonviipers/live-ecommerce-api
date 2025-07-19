import { z } from "zod";

// Environment validation schema
const envSchema = z.object({
	// Server Configuration
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
	PORT: z.string().transform(Number).default("3000"),
	HOST: z.string().default("0.0.0.0"),

	// Database Configuration
	DATABASE_URL: z.string(),
	DB_HOST: z.string().default("localhost"),
	DB_PORT: z.string().transform(Number).default("5432"),
	DB_NAME: z.string(),
	DB_USER: z.string(),
	DB_PASSWORD: z.string(),

	// Redis Configuration
	REDIS_URL: z.string().default("redis://localhost:6379"),
	REDIS_HOST: z.string().default("localhost"),
	REDIS_PORT: z.string().transform(Number).default("6379"),
	REDIS_PASSWORD: z.string().optional(),

	// JWT Configuration
	JWT_SECRET: z.string().min(32),
	JWT_REFRESH_SECRET: z.string().min(32),
	JWT_EXPIRES_IN: z.string().default("15m"),
	JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),

	// Stripe Configuration
	STRIPE_SECRET_KEY: z.string(),
	STRIPE_PUBLISHABLE_KEY: z.string(),
	STRIPE_WEBHOOK_SECRET: z.string(),

	// Cloudflare R2 Configuration
	CLOUDFLARE_R2_ACCOUNT_ID: z.string(),
	CLOUDFLARE_R2_ACCESS_KEY_ID: z.string(),
	CLOUDFLARE_R2_SECRET_ACCESS_KEY: z.string(),
	CLOUDFLARE_R2_BUCKET_NAME: z.string(),
	CLOUDFLARE_R2_ENDPOINT: z.string().url(),

	// Email Configuration
	SMTP_HOST: z.string(),
	SMTP_PORT: z.string().transform(Number),
	SMTP_USER: z.string().email(),
	SMTP_PASS: z.string(),
	FROM_EMAIL: z.string().email(),

	// RTMP Streaming Configuration
	RTMP_PORT: z.string().transform(Number).default("1935"),
	RTMP_CHUNK_SIZE: z.string().transform(Number).default("60000"),
	RTMP_GOP_CACHE: z
		.string()
		.transform((val) => val === "true")
		.default("true"),
	RTMP_PING: z.string().transform(Number).default("30"),
	RTMP_PING_TIMEOUT: z.string().transform(Number).default("60"),

	// File Upload Configuration
	MAX_FILE_SIZE: z.string().default("100MB"),
	ALLOWED_IMAGE_TYPES: z.string().default("jpg,jpeg,png,gif,webp"),
	ALLOWED_VIDEO_TYPES: z.string().default("mp4,avi,mov,wmv,flv,webm"),

	// Rate Limiting
	RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default("900000"),
	RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).default("100"),

	// CORS Configuration
	CORS_ORIGIN: z
		.string()
		.default("http://localhost:3001,http://localhost:3000"),
	CORS_CREDENTIALS: z
		.string()
		.transform((val) => val === "true")
		.default("true"),

	// Analytics Configuration
	ANALYTICS_RETENTION_DAYS: z.string().transform(Number).default("90"),
	ANALYTICS_BATCH_SIZE: z.string().transform(Number).default("1000"),

	// Commission Configuration
	DEFAULT_COMMISSION_RATE: z.string().transform(Number).default("0.05"),
	PLATFORM_FEE_RATE: z.string().transform(Number).default("0.02"),
});

// Validate environment variables
const env = envSchema.parse(process.env);

// Configuration object
export const config = {
	server: {
		nodeEnv: env.NODE_ENV,
		port: env.PORT,
		host: env.HOST,
		isDevelopment: env.NODE_ENV === "development",
		isProduction: env.NODE_ENV === "production",
		isTest: env.NODE_ENV === "test",
	},

	database: {
		url: env.DATABASE_URL,
		host: env.DB_HOST,
		port: env.DB_PORT,
		name: env.DB_NAME,
		user: env.DB_USER,
		password: env.DB_PASSWORD,
		ssl: env.NODE_ENV === "production",
		maxConnections: 20,
		idleTimeoutMillis: 30000,
		connectionTimeoutMillis: 2000,
	},

	redis: {
		url: env.REDIS_URL,
		host: env.REDIS_HOST,
		port: env.REDIS_PORT,
		password: env.REDIS_PASSWORD,
		retryDelayOnFailover: 100,
		enableReadyCheck: false,
		maxRetriesPerRequest: null,
	},

	jwt: {
		secret: env.JWT_SECRET,
		refreshSecret: env.JWT_REFRESH_SECRET,
		expiresIn: env.JWT_EXPIRES_IN,
		refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
	},

	stripe: {
		secretKey: env.STRIPE_SECRET_KEY,
		publishableKey: env.STRIPE_PUBLISHABLE_KEY,
		webhookSecret: env.STRIPE_WEBHOOK_SECRET,
	},

	cloudflare: {
		r2: {
			accountId: env.CLOUDFLARE_R2_ACCOUNT_ID,
			accessKeyId: env.CLOUDFLARE_R2_ACCESS_KEY_ID,
			secretAccessKey: env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
			bucketName: env.CLOUDFLARE_R2_BUCKET_NAME,
			endpoint: env.CLOUDFLARE_R2_ENDPOINT,
		},
	},

	email: {
		smtp: {
			host: env.SMTP_HOST,
			port: env.SMTP_PORT,
			secure: env.SMTP_PORT === 465,
			auth: {
				user: env.SMTP_USER,
				pass: env.SMTP_PASS,
			},
		},
		from: env.FROM_EMAIL,
	},

	streaming: {
		rtmp: {
			port: env.RTMP_PORT,
			chunkSize: env.RTMP_CHUNK_SIZE,
			gopCache: env.RTMP_GOP_CACHE,
			ping: env.RTMP_PING,
			pingTimeout: env.RTMP_PING_TIMEOUT,
		},
	},

	upload: {
		maxFileSize: env.MAX_FILE_SIZE,
		allowedImageTypes: env.ALLOWED_IMAGE_TYPES.split(","),
		allowedVideoTypes: env.ALLOWED_VIDEO_TYPES.split(","),
	},

	rateLimit: {
		windowMs: env.RATE_LIMIT_WINDOW_MS,
		maxRequests: env.RATE_LIMIT_MAX_REQUESTS,
	},

	cors: {
		origin: env.CORS_ORIGIN.split(","),
		credentials: env.CORS_CREDENTIALS,
	},

	analytics: {
		retentionDays: env.ANALYTICS_RETENTION_DAYS,
		batchSize: env.ANALYTICS_BATCH_SIZE,
	},

	commission: {
		defaultRate: env.DEFAULT_COMMISSION_RATE,
		platformFeeRate: env.PLATFORM_FEE_RATE,
	},
} as const;

export type Config = typeof config;
