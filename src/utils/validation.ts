import * as z from "zod";

const registerSchema = z.object({
	email: z.string().email("Invalid email format"),
	password: z.string().min(8, "Password must be at least 8 characters"),
	firstName: z.string().min(1, "First name is required"),
	lastName: z.string().min(1, "Last name is required"),
	role: z.enum(["customer", "vendor"]).default("customer"),
	phone: z.string().optional(),
	vendorInfo: z
		.object({
			businessName: z.string().min(1, "Business name is required"),
			businessType: z.string().min(1, "Business type is required"),
			description: z.string().optional(),
		})
		.optional(),
});

const loginSchema = z.object({
	email: z.string().email("Invalid email format"),
	password: z.string().min(1, "Password is required"),
});

const refreshTokenSchema = z.object({
	refreshToken: z.string().min(1, "Refresh token is required"),
});

const forgotPasswordSchema = z.object({
	email: z.string().email("Invalid email format"),
});

const resetPasswordSchema = z.object({
	token: z.string().min(1, "Reset token is required"),
	password: z.string().min(8, "Password must be at least 8 characters"),
});

const changePasswordSchema = z.object({
	currentPassword: z.string().min(1, "Current password is required"),
	newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

const querySchema = z.object({
	page: z.coerce.number().min(1).default(1),
	limit: z.coerce.number().min(1).max(100).default(20),
	unreadOnly: z.coerce.boolean().optional(),
});

const markAsReadSchema = z.object({
	notificationIds: z.array(z.string().uuid()).optional(),
	markAll: z.boolean().optional(),
});

const addItemSchema = z.object({
	productId: z.string().uuid("Invalid product ID"),
	variantId: z.string().uuid().optional(),
	quantity: z.number().int().min(1, "Quantity must be at least 1"),
});

const updateItemSchema = z.object({
	quantity: z.number().int().min(0, "Quantity must be non-negative"),
});

export {
	registerSchema,
	loginSchema,
	refreshTokenSchema,
	forgotPasswordSchema,
	resetPasswordSchema,
	changePasswordSchema,
	querySchema,
	markAsReadSchema,
	addItemSchema,
	updateItemSchema,
};
