import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
	authMiddleware,
	generateTokens,
	verifyRefreshToken,
} from "@/middleware/auth";
import { authRateLimiter } from "@/middleware/rateLimiter";
import { createError } from "@/middleware/errorHandler";
import { logger } from "@/config/logger";
import VendorRepository from "@/repositories/vendor";
import { UserRepository } from "@/repositories/user";
import {
	registerSchema,
	loginSchema,
	forgotPasswordSchema,
	refreshTokenSchema,
	resetPasswordSchema,
	changePasswordSchema,
} from "@/utils/validation";
import { NotificationService } from "@/services/notification";
import EmailService from "@/services/emailService";
import { generateOtp } from "@/utils/utils";

const auth = new Hono();

auth.post(
	"/register",
	authRateLimiter,
	zValidator("json", registerSchema),
	async (c) => {
		try {
			const data = c.req.valid("json");

			const existingUser = await UserRepository.findByEmail(data.email);
			if (existingUser) {
				throw createError.conflict("Please provide a different email address");
			}

			const optCode = generateOtp(6);
			const optCodeExpiresAt = new Date();
			optCodeExpiresAt.setMinutes(optCodeExpiresAt.getMinutes() + 15); // Expires in 15 minutes

			const user = await UserRepository.create({
				email: data.email,
				password: data.password,
				firstName: data.firstName,
				lastName: data.lastName,
				phone: data.phone,
				role: data.role,
				optCode,
				optCodeExpiresAt,
			});

			// Send email verification notification
			await EmailService.sendOtpEmail({
				email: user.email,
				firstName: user.firstName,
				lastName: user.lastName,
				optCode,
			});

			// Create vendor if role is vendor
			let vendor = null;
			if (data.role === "vendor" && data.vendorInfo) {
				vendor = await VendorRepository.create({
					userId: user.id,
					businessName: data.vendorInfo.businessName,
					businessType: data.vendorInfo.businessType,
					description: data.vendorInfo.description,
				});
			}

			const tokens = generateTokens({
				userId: user.id,
				email: user.email,
				role: user.role,
				vendorId: vendor?.id,
			});

			logger.info("User registered successfully", {
				userId: user.id,
				email: user.email,
				role: user.role,
			});

			return c.json(
				{
					message: "Registration successful",
					user: {
						id: user.id,
						email: user.email,
						firstName: user.firstName,
						lastName: user.lastName,
						role: user.role,
						emailVerified: user.emailVerified,
						vendor: vendor
							? {
									id: vendor.id,
									businessName: vendor.businessName,
									businessType: vendor.businessType,
									isVerified: vendor.isVerified,
								}
							: null,
					},
					tokens,
				},
				201,
			);
		} catch (error) {
			logger.error("Registration failed", error as Error, {
				email: c.req.valid("json").email,
			});
			throw error;
		}
	},
);

auth.post(
	"/login",
	authRateLimiter,
	zValidator("json", loginSchema),
	async (c) => {
		try {
			const { email, password } = c.req.valid("json");

			const user = await UserRepository.findByEmail(email);
			if (!user) {
				throw createError.unauthorized("Invalid credentials");
			}

			if (!user.isActive) {
				throw createError.forbidden("Account is deactivated");
			}

			const isValidPassword = await UserRepository.verifyPassword(
				user,
				password,
			);
			if (!isValidPassword) {
				throw createError.unauthorized("Invalid credentials");
			}

			// Get vendor info if user is a vendor
			let vendor = null;
			if (user.role === "vendor") {
				vendor = await VendorRepository.findByUserId(user.id);
			}

			await UserRepository.updateLastLogin(user.id);

			const tokens = generateTokens({
				userId: user.id,
				email: user.email,
				role: user.role,
				vendorId: vendor?.id,
			});

			logger.info("User logged in successfully", {
				userId: user.id,
				email: user.email,
			});

			return c.json({
				message: "Login successful",
				user: {
					id: user.id,
					email: user.email,
					firstName: user.firstName,
					lastName: user.lastName,
					role: user.role,
					emailVerified: user.emailVerified,
					vendor: vendor
						? {
								id: vendor.id,
								businessName: vendor.businessName,
								businessType: vendor.businessType,
								isVerified: vendor.isVerified,
							}
						: null,
				},
				tokens,
			});
		} catch (error) {
			logger.error("Login failed", error as Error, {
				email: c.req.valid("json").email,
			});
			throw error;
		}
	},
);

auth.post("/refresh", zValidator("json", refreshTokenSchema), async (c) => {
	try {
		const { refreshToken } = c.req.valid("json");

		const decoded = verifyRefreshToken(refreshToken);

		// Verify user still exists and is active
		const user = await UserRepository.findById((await decoded).userId);
		if (!user || !user.isActive) {
			throw createError.unauthorized("Invalid refresh token");
		}

		// Get vendor info if user is a vendor
		let vendor = null;
		if (user.role === "vendor") {
			vendor = await VendorRepository.findByUserId(user.id);
		}

		const tokens = generateTokens({
			userId: user.id,
			email: user.email,
			role: user.role,
			vendorId: vendor?.id,
		});

		logger.info("Tokens refreshed successfully", { userId: user.id });

		return c.json({
			message: "Tokens refreshed successfully",
			tokens,
		});
	} catch (error) {
		logger.error("Token refresh failed", error as Error);
		throw createError.unauthorized("Invalid refresh token");
	}
});

auth.post("/logout", authMiddleware, async (c) => {
	try {
		const user = c.get("user");

		// TODO: Implement token blacklisting in Redis
		// await tokenService.revokeRefreshToken(user.id);

		logger.info("User logged out successfully", { userId: user.id });

		return c.json({
			message: "Logout successful",
		});
	} catch (error) {
		logger.error("Logout failed", error as Error);
		throw error;
	}
});

auth.get("/me", authMiddleware, async (c) => {
	try {
		const currentUser = c.get("user");

		const user = await UserRepository.findById(currentUser.id);
		if (!user) {
			throw createError.notFound("User not found");
		}

		// Get vendor info if user is a vendor
		let vendor = null;
		if (user.role === "vendor") {
			vendor = await VendorRepository.findByUserId(user.id);
		}

		return c.json({
			user: {
				id: user.id,
				email: user.email,
				firstName: user.firstName,
				lastName: user.lastName,
				phone: user.phone,
				avatarUrl: user.avatarUrl,
				role: user.role,
				isActive: user.isActive,
				emailVerified: user.emailVerified,
				lastLoginAt: user.lastLoginAt,
				createdAt: user.createdAt,
				vendor: vendor
					? {
							id: vendor.id,
							businessName: vendor.businessName,
							businessType: vendor.businessType,
							description: vendor.description,
							logoUrl: vendor.logoUrl,
							bannerUrl: vendor.bannerUrl,
							websiteUrl: vendor.websiteUrl,
							isVerified: vendor.isVerified,
							isActive: vendor.isActive,
							rating: vendor.rating,
							reviewCount: vendor.reviewCount,
						}
					: null,
			},
		});
	} catch (error) {
		logger.error("Failed to get current user", error as Error);
		throw error;
	}
});

auth.post(
	"/forgot-password",
	authRateLimiter,
	zValidator("json", forgotPasswordSchema),
	async (c) => {
		try {
			const { email } = c.req.valid("json");

			const user = await UserRepository.findByEmail(email);
			if (user) {
				// TODO: Generate reset token and send email
				// const resetToken = await tokenService.generatePasswordResetToken(user.id);
				// await emailService.sendPasswordResetEmail(user.email, resetToken);
			}

			logger.info("Password reset requested", { email });

			// Always return success to prevent email enumeration
			return c.json({
				message:
					"If an account with that email exists, a password reset link has been sent.",
			});
		} catch (error) {
			logger.error("Forgot password failed", error as Error);
			throw error;
		}
	},
);

auth.post(
	"/reset-password",
	authRateLimiter,
	zValidator("json", resetPasswordSchema),
	async (c) => {
		try {
			const { token, password } = c.req.valid("json");

			// TODO: Verify reset token and update password
			// const userId = await tokenService.verifyPasswordResetToken(token);
			// await UserRepository.updatePassword(userId, password);
			// await tokenService.revokePasswordResetToken(token);

			logger.info("Password reset successfully");

			return c.json({
				message: "Password reset successful",
			});
		} catch (error) {
			logger.error("Password reset failed", error as Error);
			throw createError.badRequest("Invalid or expired reset token");
		}
	},
);

auth.post(
	"/change-password",
	authMiddleware,
	zValidator("json", changePasswordSchema),
	async (c) => {
		try {
			const user = c.get("user");
			const { currentPassword, newPassword } = c.req.valid("json");

			// Get user data from database
			const userData = await UserRepository.findById(user.id);
			if (!userData) {
				throw createError.notFound("User not found");
			}

			// Verify current password
			const isValidPassword = await UserRepository.verifyPassword(
				userData,
				currentPassword,
			);
			if (!isValidPassword) {
				throw createError.badRequest("Current password is incorrect");
			}

			await UserRepository.updatePassword(user.id, newPassword);

			logger.info("Password changed successfully", { userId: user.id });

			return c.json({
				message: "Password changed successfully",
			});
		} catch (error) {
			logger.error("Password change failed", error as Error);
			throw error;
		}
	},
);

export default auth;
