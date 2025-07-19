import { config } from "@/config";
import logger from "@/config/logger";
import { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export interface ApiError extends Error {
	statusCode?: number;
	code?: string;
	details?: unknown;
}

export interface ErrorResponse {
	error: {
		message: string;
		code: string;
		statusCode: number;
		details?: unknown;
		stack?: string;
	};
	timestamp: string;
	path: string;
	requestId?: string;
}

export interface ErrorLog {
	message: string;
	statusCode: number;
	code: string;
	stack?: string;
	url: string;
	method: string;
	userAgent?: string;
	ip?: string;
	details?: unknown;
}

export class AppError extends Error implements ApiError {
	public statusCode: number;
	public code: string;
	public details?: unknown;
	public isOperational: boolean;

	constructor(
		message: string,
		statusCode: number = 500,
		code: string = "INTERNAL_ERROR",
		details?: unknown,
		isOperational: boolean = true,
	) {
		super(message);
		this.statusCode = statusCode;
		this.code = code;
		this.details = details;
		this.isOperational = isOperational;

		Error.captureStackTrace(this, this.constructor);
	}
}

export const errorHandler = (
	error: Error | HTTPException | AppError,
	c: Context,
) => {
	let statusCode: number = 500;
	let message = "Internal Server Error";
	let code = "INTERNAL_ERROR";
	let details: unknown = undefined;

	if (error instanceof HTTPException) {
		statusCode = error.status;
		message = error.message;
		code = "HTTP_EXCEPTION";
	} else if (error instanceof AppError) {
		statusCode = error.statusCode;
		message = error.message;
		code = error.code;
		details = error.details;
	} else if (error.name === "ValidationError") {
		statusCode = 400;
		message = "Validation Error";
		code = "VALIDATION_ERROR";
		details = error.message;
	} else if (error.name === "UnauthorizedError") {
		statusCode = 401;
		message = "Unauthorized";
		code = "UNAUTHORIZED";
	} else if (error.name === "ForbiddenError") {
		statusCode = 403;
		message = "Forbidden";
		code = "FORBIDDEN";
	} else if (error.name === "NotFoundError") {
		statusCode = 404;
		message = "Not Found";
		code = "NOT_FOUND";
	} else if (error.name === "ConflictError") {
		statusCode = 409;
		message = "Conflict";
		code = "CONFLICT";
	} else if (error.name === "TooManyRequestsError") {
		statusCode = 429;
		message = "Too Many Requests";
		code = "RATE_LIMIT_EXCEEDED";
	}

	// Log error
	const errorLog: ErrorLog = {
		message: error.message,
		statusCode,
		code,
		stack: error.stack,
		url: c.req.url,
		method: c.req.method,
		userAgent: c.req.header("user-agent"),
		ip: c.req.header("x-forwarded-for") || c.req.header("x-real-ip"),
		details,
	};

	if (statusCode >= 500) {
		logger.error("Server Error", errorLog);
	} else {
		logger.warn("Client Error", errorLog);
	}

	const response: ErrorResponse = {
		error: {
			message,
			code,
			statusCode,
		},
		timestamp: new Date().toISOString(),
		path: c.req.path,
	};

	// Include details in development mode
	if (config.server.isDevelopment) {
		response.error.details = details;
		response.error.stack = error.stack;
	}

	// Include request ID if available
	const requestId = c.req.header("x-request-id");
	if (requestId) {
		response.requestId = requestId;
	}

	return c.json(response, statusCode as ContentfulStatusCode);
};

export const createError = {
	badRequest: (message: string, details?: unknown) =>
		new AppError(message, 400, "BAD_REQUEST", details),

	unauthorized: (message: string = "Unauthorized", details?: unknown) =>
		new AppError(message, 401, "UNAUTHORIZED", details),

	forbidden: (message: string = "Forbidden", details?: unknown) =>
		new AppError(message, 403, "FORBIDDEN", details),

	notFound: (message: string = "Not Found", details?: unknown) =>
		new AppError(message, 404, "NOT_FOUND", details),

	conflict: (message: string, details?: unknown) =>
		new AppError(message, 409, "CONFLICT", details),

	unprocessableEntity: (message: string, details?: unknown) =>
		new AppError(message, 422, "UNPROCESSABLE_ENTITY", details),

	tooManyRequests: (message: string = "Too Many Requests", details?: unknown) =>
		new AppError(message, 429, "TOO_MANY_REQUESTS", details),

	internal: (message: string = "Internal Server Error", details?: unknown) =>
		new AppError(message, 500, "INTERNAL_ERROR", details),

	serviceUnavailable: (
		message: string = "Service Unavailable",
		details?: unknown,
	) => new AppError(message, 503, "SERVICE_UNAVAILABLE", details),
};

export default errorHandler;
