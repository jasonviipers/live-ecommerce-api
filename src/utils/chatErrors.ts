import { AppError } from "@/middleware/errorHandler";

export class ChatRoomNotFoundError extends AppError {
	constructor(roomId?: string) {
		super(
			roomId
				? `Chat room with ID ${roomId} not found or inactive`
				: "Chat room not found or inactive",
			404,
			"CHAT_ROOM_NOT_FOUND",
		);
	}
}

export class UserBannedError extends AppError {
	constructor(userId?: string, roomId?: string) {
		super(
			`User ${userId || "user"} is banned from chat room ${roomId || "this chat room"}`,
			403,
			"USER_BANNED",
		);
	}
}

export class UserNotFoundError extends AppError {
	constructor(userId?: string) {
		super(
			userId ? `User with ID ${userId} not found` : "User not found",
			404,
			"USER_NOT_FOUND",
		);
	}
}

export class MessageValidationError extends AppError {
	constructor(reason: string) {
		super(
			`Message validation failed: ${reason}`,
			400,
			"MESSAGE_VALIDATION_ERROR",
		);
	}
}

export class SlowModeError extends AppError {
	constructor(remainingTime: number) {
		super(
			`Slow mode active. Please wait ${remainingTime} seconds before sending another message`,
			429,
			"SLOW_MODE_ACTIVE",
		);
	}
}

export class InsufficientPermissionsError extends AppError {
	constructor(action: string) {
		super(
			`Insufficient permissions to ${action}`,
			403,
			"INSUFFICIENT_PERMISSIONS",
		);
	}
}

export class MessageNotFoundError extends AppError {
	constructor(messageId?: string) {
		super(
			messageId
				? `Message with ID ${messageId} not found`
				: "Message not found",
			404,
			"MESSAGE_NOT_FOUND",
		);
	}
}

export class ChatRoomInactiveError extends AppError {
	constructor(roomId?: string) {
		super(
			roomId ? `Chat room ${roomId} is inactive` : "Chat room is inactive",
			400,
			"CHAT_ROOM_INACTIVE",
		);
	}
}

export class DatabaseOperationError extends AppError {
	constructor(operation: string, details?: unknown) {
		super(
			`Database operation failed: ${operation}`,
			500,
			"DATABASE_OPERATION_ERROR",
			details,
		);
	}
}

export class ChatServiceInitializationError extends AppError {
	constructor(details?: unknown) {
		super(
			"Failed to initialize chat service",
			500,
			"CHAT_SERVICE_INITIALIZATION_ERROR",
			details,
		);
	}
}
