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

const addressSchema = z.object({
	firstName: z.string().min(1, "First name is required"),
	lastName: z.string().min(1, "Last name is required"),
	company: z.string().optional(),
	address1: z.string().min(1, "Address is required"),
	address2: z.string().optional(),
	city: z.string().min(1, "City is required"),
	state: z.string().min(1, "State is required"),
	postalCode: z.string().min(1, "Postal code is required"),
	country: z.string().min(1, "Country is required"),
	phone: z.string().optional(),
});

const orderItemSchema = z.object({
	productId: z.string().uuid("Invalid product ID"),
	variantId: z.string().uuid().optional(),
	quantity: z.number().int().min(1, "Quantity must be at least 1"),
	price: z.number().min(0, "Price must be non-negative"),
});

const createOrderSchema = z.object({
	vendorId: z.string().uuid("Invalid vendor ID"),
	items: z.array(orderItemSchema).min(1, "At least one item is required"),
	shippingAddress: addressSchema,
	billingAddress: addressSchema.optional(),
	notes: z.string().max(1000).optional(),
	taxAmount: z.number().min(0).default(0),
	shippingAmount: z.number().min(0).default(0),
	discountAmount: z.number().min(0).default(0),
});

const updateOrderSchema = z.object({
	status: z
		.enum([
			"pending",
			"confirmed",
			"processing",
			"shipped",
			"delivered",
			"cancelled",
			"refunded",
		])
		.optional(),
	paymentStatus: z
		.enum(["pending", "paid", "failed", "refunded", "partially_refunded"])
		.optional(),
	notes: z.string().max(1000).optional(),
	shippedAt: z.string().datetime().optional(),
	deliveredAt: z.string().datetime().optional(),
});

const querySchema = z.object({
	page: z.string().transform((val) => parseInt(val) || 1),
	limit: z.string().transform((val) => Math.min(parseInt(val) || 20, 100)),
	unreadOnly: z.coerce.boolean().optional(),
	status: z.string().optional(),
	paymentStatus: z.string().optional(),
	vendorId: z.string().uuid().optional(),
	dateFrom: z.string().datetime().optional(),
	dateTo: z.string().datetime().optional(),
	categoryId: z.string().uuid().optional(),
	type: z.enum(["image", "video", "all"]).default("all"),
	isActive: z
		.string()
		.transform((val) =>
			val === "true" ? true : val === "false" ? false : undefined,
		)
		.optional(),
	isFeatured: z
		.string()
		.transform((val) =>
			val === "true" ? true : val === "false" ? false : undefined,
		)
		.optional(),
	search: z.string().optional(),
	tags: z
		.string()
		.transform((val) => (val ? val.split(",") : undefined))
		.optional(),
	priceMin: z
		.string()
		.transform((val) => (val ? parseFloat(val) : undefined))
		.optional(),
	priceMax: z
		.string()
		.transform((val) => (val ? parseFloat(val) : undefined))
		.optional(),
	sortBy: z
		.enum(["created_at", "price", "name", "view_count", "like_count"])
		.default("created_at"),
	sortOrder: z.enum(["asc", "desc"]).default("desc"),
	isLive: z
		.string()
		.transform((val) =>
			val === "true" ? true : val === "false" ? false : undefined,
		)
		.optional(),
});

const createPaymentIntentSchema = z.object({
	orderId: z.string().uuid("Invalid order ID"),
	paymentMethodTypes: z.array(z.string()).default(["card"]),
	metadata: z.record(z.any()).optional(),
});

const createRefundSchema = z.object({
	amount: z.number().positive().optional(),
	reason: z
		.enum(["duplicate", "fraudulent", "requested_by_customer"])
		.optional(),
});

const createPayoutSchema = z.object({
	vendorId: z.string().uuid("Invalid vendor ID").optional(),
	amount: z.number().positive("Amount must be positive"),
	currency: z.string().default("usd"),
	description: z.string().max(500).optional(),
	metadata: z.record(z.any()).optional(),
});

const createProductSchema = z.object({
	categoryId: z.string().uuid().optional(),
	name: z.string().min(1, "Product name is required").max(255),
	description: z.string().optional(),
	shortDescription: z.string().max(500).optional(),
	sku: z.string().max(100).optional(),
	price: z.number().min(0, "Price must be non-negative"),
	comparePrice: z.number().min(0).optional(),
	costPrice: z.number().min(0).optional(),
	trackInventory: z.boolean().default(true),
	inventoryQuantity: z.number().int().min(0).default(0),
	lowStockThreshold: z.number().int().min(0).default(10),
	weight: z.number().min(0).optional(),
	dimensions: z
		.object({
			length: z.number().min(0),
			width: z.number().min(0),
			height: z.number().min(0),
			unit: z.enum(["cm", "in"]).default("cm"),
		})
		.optional(),
	images: z.array(z.string().url()).default([]),
	tags: z.array(z.string()).default([]),
	metaTitle: z.string().max(255).optional(),
	metaDescription: z.string().max(500).optional(),
	isDigital: z.boolean().default(false),
});

const updateProductSchema = createProductSchema.partial().extend({
	isActive: z.boolean().optional(),
	isFeatured: z.boolean().optional(),
});

const createStreamSchema = z.object({
	title: z.string().min(1, "Stream title is required").max(255),
	description: z.string().max(1000).optional(),
	thumbnailUrl: z.string().url().optional(),
	scheduledAt: z.string().datetime().optional(),
	isRecorded: z.boolean().default(false),
	tags: z.array(z.string()).default([]),
	metadata: z.record(z.any()).optional(),
});

const updateStreamSchema = createStreamSchema.partial().extend({
	status: z.enum(["scheduled", "live", "ended", "cancelled"]).optional(),
});

const uploadOptionsSchema = z.object({
	folder: z.string().optional(),
	generateThumbnail: z
		.string()
		.transform((val) => val === "true")
		.optional(),
	processVideo: z
		.string()
		.transform((val) => val === "true")
		.optional(),
	maxWidth: z
		.string()
		.transform((val) => parseInt(val))
		.optional(),
	maxHeight: z
		.string()
		.transform((val) => parseInt(val))
		.optional(),
	quality: z
		.string()
		.transform((val) => parseInt(val))
		.optional(),
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
	addressSchema,
	orderItemSchema,
	createOrderSchema,
	updateOrderSchema,
	createPaymentIntentSchema,
	createRefundSchema,
	createPayoutSchema,
	createProductSchema,
	updateProductSchema,
	createStreamSchema,
	updateStreamSchema,
	uploadOptionsSchema,
};
