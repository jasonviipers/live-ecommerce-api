import { Context, Next } from "hono";
import { SignJWT, jwtVerify, JWTPayload as JoseJWTPayload } from "jose";
import { createError } from "./errorHandler";
import { UserRepository } from "@/repositories/user";
import VendorRepository from "@/repositories/vendor";
import logger from "@/config/logger";
import { config } from "@/config";
import VideoRepository from "@/repositories/video";
import ProductRepository from "@/repositories/product";
import StreamRepository from "@/repositories/stream";
import OrderRepository from "@/repositories/order";

export interface JWTPayload {
	userId: string;
	email: string;
	role: string;
	vendorId?: string;
	iat?: number;
	exp?: number;
}

export interface User {
	id: string;
	email: string;
	role: "admin" | "vendor" | "customer";
	vendorId?: string;
	isActive: boolean;
	emailVerified: boolean;
}

declare module "hono" {
	interface ContextVariableMap {
		user: User;
	}
}

/* ------------------------------------------------------------------ */
/* 1.  Shared helpers                                                  */
/* ------------------------------------------------------------------ */
export const secret = new TextEncoder().encode(config.jwt.secret);
export const refreshSecret = new TextEncoder().encode(config.jwt.refreshSecret);

export function toJWTPayload(p: JoseJWTPayload): JWTPayload {
	return {
		userId: String(p.userId),
		email: String(p.email),
		role: String(p.role),
		vendorId: p.vendorId ? String(p.vendorId) : undefined,
		iat: p.iat,
		exp: p.exp,
	};
}

/* ------------------------------------------------------------------ */
/* 3.  Middleware                                                      */
/* ------------------------------------------------------------------ */
export const authMiddleware = async (c: Context, next: Next) => {
	try {
		const authHeader = c.req.header("authorization");
		if (!authHeader)
			throw createError.unauthorized("Authorization header is required");

		const token = authHeader.startsWith("Bearer ")
			? authHeader.slice(7)
			: authHeader;
		if (!token) throw createError.unauthorized("Token is required");

		const { payload } = await jwtVerify(token, secret);
		const decoded = toJWTPayload(payload);

		const userData = await UserRepository.findById(decoded.userId);
		if (!userData) throw createError.unauthorized("User not found");
		if (!userData.isActive)
			throw createError.forbidden("Account is deactivated");

		let vendorId: string | undefined;
		if (userData.role === "vendor") {
			const vendor = await VendorRepository.findByUserId(userData.id);
			vendorId = vendor?.id;
		}

		const user: User = {
			id: userData.id,
			email: userData.email,
			role: userData.role,
			vendorId,
			isActive: userData.isActive,
			emailVerified: userData.emailVerified,
		};

		c.set("user", user);
		await next();
	} catch (error: any) {
		if (error?.code === "ERR_JWT_EXPIRED") {
			logger.warn("Expired JWT token", { error: error.message });
			throw createError.unauthorized("Token expired");
		} else if (error?.code?.startsWith("ERR_JWT")) {
			logger.warn("Invalid JWT token", { error: error.message });
			throw createError.unauthorized("Invalid token");
		}
		throw error;
	}
};

/* ------------------------------------------------------------------ */
/* 4.  Optional auth                                                   */
/* ------------------------------------------------------------------ */
export const optionalAuthMiddleware = async (c: Context, next: Next) => {
	try {
		const authHeader = c.req.header("authorization");
		if (!authHeader) {
			await next();
			return;
		}

		const token = authHeader.startsWith("Bearer ")
			? authHeader.slice(7)
			: authHeader;
		if (!token) {
			await next();
			return;
		}

		const { payload } = await jwtVerify(token, secret);
		const decoded = toJWTPayload(payload);

		const userData = await UserRepository.findById(decoded.userId);
		if (userData && userData.isActive) {
			let vendorId: string | undefined;
			if (userData.role === "vendor") {
				const vendor = await VendorRepository.findByUserId(userData.id);
				vendorId = vendor?.id;
			}

			const user: User = {
				id: userData.id,
				email: userData.email,
				role: userData.role,
				vendorId,
				isActive: userData.isActive,
				emailVerified: userData.emailVerified,
			};
			c.set("user", user);
		}
	} catch {
		// ignore
	}
	await next();
};

/* ------------------------------------------------------------------ */
/* 5.  Role helpers                                                    */
/* ------------------------------------------------------------------ */
export const requireRole =
	(...roles: string[]) =>
	async (c: Context, next: Next) => {
		const user = c.get("user");
		if (!user) throw createError.unauthorized("Authentication required");
		if (!roles.includes(user.role))
			throw createError.forbidden(
				`Access denied. Required roles: ${roles.join(", ")}`,
			);
		await next();
	};

export const requireAdmin = requireRole("admin");
export const requireVendorOrAdmin = requireRole("vendor", "admin");
export const requireAuthenticated = requireRole("customer", "vendor", "admin");

/* ------------------------------------------------------------------ */
/* 6.  Ownership guards                                                */
/* ------------------------------------------------------------------ */
export const requireVendorOwnership = async (c: Context, next: Next) => {
	const user = c.get("user");
	const vendorId = c.req.param("vendorId") || c.req.param("id");

	if (!user) throw createError.unauthorized("Authentication required");
	if (user.role === "admin") {
		await next();
		return;
	}
	if (user.role !== "vendor")
		throw createError.forbidden("Vendor access required");
	if (user.vendorId !== vendorId)
		throw createError.forbidden("Access denied to this vendor account");

	await next();
};

export const requireResourceOwnership =
	(resourceIdParam: string = "id") =>
	async (c: Context, next: Next) => {
		const user = c.get("user");
		if (!user) throw createError.unauthorized("Authentication required");
		if (user.role === "admin") {
			await next();
			return;
		}
		const resourceId = c.req.param(resourceIdParam);
		if (!resourceId) {
			throw createError.badRequest(
				`Resource ID parameter '${resourceIdParam}' is required`,
			);
		}
		const path = c.req.path;
		if (path.includes("/videos/")) {
			const video = await VideoRepository.findById(resourceId);
			if (!video) throw createError.notFound("Video not found");
			if (video.vendorId !== user.vendorId) {
				throw createError.forbidden("You don't own this video");
			}
		} else if (path.includes("/products/")) {
			const product = await ProductRepository.findById(resourceId);
			if (!product) throw createError.notFound("Product not found");
			if (product.vendorId !== user.vendorId) {
				throw createError.forbidden("You don't own this product");
			}
		} else if (path.includes("/streams/")) {
			const stream = await StreamRepository.findById(resourceId);
			if (!stream) throw createError.notFound("Stream not found");
			if (stream.vendorId !== user.vendorId) {
				throw createError.forbidden("You don't own this stream");
			}
		} else if (path.includes("/orders/")) {
			const order = await OrderRepository.findById(resourceId);
			if (!order) throw createError.notFound("Order not found");
			if (user.role === "customer" && order.userId !== user.id) {
				throw createError.forbidden("You don't own this order");
			}
			if (user.role === "vendor" && order.vendorId !== user.vendorId) {
				throw createError.forbidden("You don't own this order");
			}
		} else {
			throw createError.forbidden(
				"Ownership check not implemented for this resource type",
			);
		}
		await next();
	};

/* ------------------------------------------------------------------ */
/* 7.  Email / verification guards                                     */
/* ------------------------------------------------------------------ */
export const requireEmailVerification = async (c: Context, next: Next) => {
	const user = c.get("user");
	if (!user) throw createError.unauthorized("Authentication required");
	if (!user.emailVerified)
		throw createError.forbidden("Email verification required");
	await next();
};

export const requireActiveUser = async (c: Context, next: Next) => {
	const user = c.get("user");
	if (!user) throw createError.unauthorized("Authentication required");
	if (!user.isActive) throw createError.forbidden("Account is deactivated");
	await next();
};

export const requireVerifiedVendor = async (c: Context, next: Next) => {
	const user = c.get("user");
	if (!user) throw createError.unauthorized("Authentication required");
	if (user.role !== "vendor" && user.role !== "admin")
		throw createError.forbidden("Vendor access required");

	if (user.role === "vendor" && user.vendorId) {
		const vendor = await VendorRepository.findById(user.vendorId);
		if (!vendor || !vendor.isVerified)
			throw createError.forbidden("Vendor verification required");
	}
	await next();
};

/* ------------------------------------------------------------------ */
/* 8.  Token utilities                                                 */
/* ------------------------------------------------------------------ */
export const generateTokens = (payload: Omit<JWTPayload, "iat" | "exp">) => {
	const now = Math.floor(Date.now() / 1000);

	const accessToken = new SignJWT({ ...payload })
		.setProtectedHeader({ alg: "HS256" })
		.setIssuedAt()
		.setExpirationTime(now + config.jwt.expiresIn)
		.sign(secret);

	const refreshToken = new SignJWT({ ...payload })
		.setProtectedHeader({ alg: "HS256" })
		.setIssuedAt()
		.setExpirationTime(now + config.jwt.refreshExpiresIn)
		.sign(refreshSecret);

	return Promise.all([accessToken, refreshToken]).then(([at, rt]) => ({
		accessToken: at,
		refreshToken: rt,
	}));
};

export const verifyRefreshToken = async (
	token: string,
): Promise<JWTPayload> => {
	const { payload } = await jwtVerify(token, refreshSecret);
	return toJWTPayload(payload);
};

/* ------------------------------------------------------------------ */
/* 9.  Internal service authentication                                  */
/* ------------------------------------------------------------------ */
export const internalServiceAuthMiddleware = async (c: Context, next: Next) => {
	try {
		const apiKey = c.req.header("x-api-key");

		if (!apiKey) {
			throw createError.unauthorized("API key is required");
		}

		if (apiKey !== config.internal.apiKey) {
			throw createError.forbidden("Invalid API key");
		}

		await next();
	} catch (error) {
		logger.warn("Internal service authentication failed", { error });
		throw error;
	}
};

export default authMiddleware;
