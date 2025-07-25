import { existsSync, mkdirSync } from "node:fs";
import * as winston from "winston";
import "winston-daily-rotate-file";
import { config } from "./index";

// Custom log format
const logFormat = winston.format.combine(
	winston.format.timestamp({
		format: "YYYY-MM-DD HH:mm:ss",
	}),
	winston.format.errors({ stack: true }),
	winston.format.json(),
	winston.format.prettyPrint(),
);

// Console format for development
const consoleFormat = winston.format.combine(
	winston.format.colorize(),
	winston.format.timestamp({
		format: "HH:mm:ss",
	}),
	winston.format.printf(({ timestamp, level, message, ...meta }) => {
		let msg = `${timestamp} [${level}]: ${message}`;
		if (Object.keys(meta).length > 0) {
			msg += `\n${JSON.stringify(meta, null, 2)}`;
		}
		return msg;
	}),
);

// Create logger instance
export const logger = winston.createLogger({
	level: config.server.isDevelopment ? "debug" : "info",
	format: logFormat,
	defaultMeta: {
		service: "live-streaming-ecommerce-api",
		environment: config.server.nodeEnv,
	},
	transports: [
		// Console transport
		new winston.transports.Console({
			format: config.server.isDevelopment ? consoleFormat : logFormat,
		}),

		// File transport for errors
		new winston.transports.File({
			filename: "logs/error.log",
			level: "error",
			maxsize: 5242880, // 5MB
			maxFiles: 5,
		}),

		// File transport for all logs
		new winston.transports.File({
			filename: "logs/combined.log",
			maxsize: 5242880, // 5MB
			maxFiles: 5,
		}),
	],
	exceptionHandlers: [
		new winston.transports.File({
			filename: "logs/exceptions.log",
		}),
	],
	rejectionHandlers: [
		new winston.transports.File({
			filename: "logs/rejections.log",
		}),
	],
});

if (!existsSync("logs")) {
	mkdirSync("logs");
}

// Stream for Morgan HTTP logging
export const httpLogStream = {
	write: (message: string) => {
		logger.info(message.trim(), { type: "http" });
	},
};

// Helper functions for structured logging
export const loggers = {
	auth: (message: string, meta?: Record<string, unknown>) =>
		logger.info(message, { type: "auth", ...meta }),
	database: (message: string, meta?: Record<string, unknown>) =>
		logger.info(message, { type: "database", ...meta }),
	payment: (message: string, meta?: Record<string, unknown>) =>
		logger.info(message, { type: "payment", ...meta }),
	streaming: (message: string, meta?: Record<string, unknown>) =>
		logger.info(message, { type: "streaming", ...meta }),
	upload: (message: string, meta?: Record<string, unknown>) =>
		logger.info(message, { type: "upload", ...meta }),
	analytics: (message: string, meta?: Record<string, unknown>) =>
		logger.info(message, { type: "analytics", ...meta }),
	error: (message: string, error?: Error, meta?: Record<string, unknown>) => {
		logger.error(message, {
			type: "error",
			error: error?.message,
			stack: error?.stack,
			...meta,
		});
	},
};

export default logger;
