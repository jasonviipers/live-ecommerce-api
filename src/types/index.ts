export interface User {
	id: string;
	email: string;
	passwordHash: string;
	firstName: string;
	lastName: string;
	phone?: string;
	avatarUrl?: string;
	role: "admin" | "vendor" | "customer";
	isActive: boolean;
	emailVerified: boolean;
	emailVerifiedAt?: Date;
	lastLoginAt?: Date;
	createdAt: Date;
	updatedAt: Date;
}

export interface UserRow {
	id: string;
	email: string;
	password_hash: string;
	first_name: string;
	last_name: string;
	phone?: string;
	avatar_url?: string;
	role: "admin" | "vendor" | "customer";
	is_active: boolean;
	email_verified: boolean;
	email_verified_at?: Date;
	last_login_at?: Date;
	created_at: Date;
	updated_at: Date;
}

export interface CreateUserData {
	email: string;
	password: string;
	firstName: string;
	lastName: string;
	phone?: string;
	role?: "vendor" | "customer";
	optCode?: string;
	optCodeExpiresAt?: Date;
}

export interface UpdateUserData {
	firstName?: string;
	lastName?: string;
	phone?: string;
	avatarUrl?: string;
	isActive?: boolean;
	emailVerified?: boolean;
	optCode?: string | undefined;
	optCodeExpiresAt?: Date | undefined;
	passwordHash?: string | undefined;
}

export interface Cart {
	id: string;
	userId?: string;
	sessionId?: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface CartItem {
	id: string;
	cartId: string;
	productId: string;
	variantId?: string;
	quantity: number;
	price: number;
	createdAt: Date;
	updatedAt: Date;
	// Populated fields
	productName?: string;
	productImage?: string;
	variantName?: string;
	inventoryQuantity?: number;
}

export interface CartSummary {
	cart: Cart;
	items: CartItem[];
	itemCount: number;
	subtotal: number;
}

export interface Order {
	id: string;
	orderNumber: string;
	userId: string;
	vendorId: string;
	status:
		| "pending"
		| "confirmed"
		| "processing"
		| "shipped"
		| "delivered"
		| "cancelled"
		| "refunded"
		| "completed";
	paymentStatus:
		| "pending"
		| "paid"
		| "failed"
		| "refunded"
		| "partially_refunded";
	subtotal: number;
	taxAmount: number;
	shippingAmount: number;
	discountAmount: number;
	totalAmount: number;
	currency: string;
	shippingAddress?: Record<string, string>;
	billingAddress?: Record<string, string>;
	notes?: string;
	shippedAt?: Date;
	deliveredAt?: Date;
	createdAt: Date;
	updatedAt: Date;
}

export interface OrderItem {
	id: string;
	orderId: string;
	productId: string;
	variantId?: string;
	productName: string;
	variantName?: string;
	sku?: string;
	quantity: number;
	price: number;
	total: number;
	createdAt: Date;
}

export interface CreateOrderData {
	userId: string;
	vendorId: string;
	items: {
		productId: string;
		variantId?: string;
		quantity: number;
		price: number;
	}[];
	shippingAddress?: Record<string, string>;
	billingAddress?: Record<string, string>;
	notes?: string;
	taxAmount?: number;
	shippingAmount?: number;
	discountAmount?: number;
}

export interface UpdateOrderData {
	status?: Order["status"];
	paymentStatus?: Order["paymentStatus"];
	notes?: string;
	shippedAt?: Date;
	deliveredAt?: Date;
}

export interface Product {
	id: string;
	vendorId: string;
	categoryId?: string;
	name: string;
	slug: string;
	description?: string;
	shortDescription?: string;
	sku?: string;
	price: number;
	comparePrice?: number;
	costPrice?: number;
	trackInventory: boolean;
	inventoryQuantity: number;
	lowStockThreshold: number;
	weight?: number;
	dimensions?: Record<string, number>;
	images: string[];
	tags: string[];
	metaTitle?: string;
	metaDescription?: string;
	isActive: boolean;
	isFeatured: boolean;
	isDigital: boolean;
	viewCount: number;
	likeCount: number;
	shareCount: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface CreateProductData {
	vendorId: string;
	categoryId?: string;
	name: string;
	description?: string;
	shortDescription?: string;
	sku?: string;
	price: number;
	comparePrice?: number;
	costPrice?: number;
	trackInventory?: boolean;
	inventoryQuantity?: number;
	lowStockThreshold?: number;
	weight?: number;
	dimensions?: Record<string, number>;
	images?: string[];
	tags?: string[];
	metaTitle?: string;
	metaDescription?: string;
	isDigital?: boolean;
}

export interface UpdateProductData {
	categoryId?: string;
	name?: string;
	description?: string;
	shortDescription?: string;
	sku?: string;
	price?: number;
	comparePrice?: number;
	costPrice?: number;
	trackInventory?: boolean;
	inventoryQuantity?: number;
	lowStockThreshold?: number;
	weight?: number;
	dimensions?: Record<string, number>;
	images?: string[];
	tags?: string[];
	metaTitle?: string;
	metaDescription?: string;
	isActive?: boolean;
	isFeatured?: boolean;
	isDigital?: boolean;
}

export interface Stream {
	id: string;
	vendorId: string;
	title: string;
	description?: string;
	thumbnailUrl?: string;
	streamKey: string;
	rtmpUrl: string;
	playbackUrl: string;
	status: "scheduled" | "live" | "ended" | "cancelled";
	scheduledAt?: Date;
	startedAt?: Date;
	endedAt?: Date;
	viewerCount: number;
	maxViewerCount: number;
	likeCount: number;
	shareCount: number;
	commentCount: number;
	isRecorded: boolean;
	recordingUrl?: string;
	tags: string[];
	metadata?: Record<string, number>;
	createdAt: Date;
	updatedAt: Date;
}

export interface CreateStreamData {
	vendorId: string;
	title: string;
	description?: string;
	thumbnailUrl?: string;
	scheduledAt?: Date;
	isRecorded?: boolean;
	tags?: string[];
	metadata?: Record<string, number>;
}

export interface UpdateStreamData {
	title?: string;
	description?: string;
	thumbnailUrl?: string;
	scheduledAt?: Date;
	status?: Stream["status"];
	isRecorded?: boolean;
	tags?: string[];
	metadata?: Record<string, number>;
}

export interface Vendor {
	id: string;
	userId: string;
	businessName: string;
	businessType: string;
	description?: string;
	logoUrl?: string;
	bannerUrl?: string;
	websiteUrl?: string;
	address?: Record<string, string>;
	taxId?: string;
	commissionRate: number;
	isVerified: boolean;
	isActive: boolean;
	totalSales: number;
	totalOrders: number;
	rating: number;
	reviewCount: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface CreateVendorData {
	userId: string;
	businessName: string;
	businessType: string;
	description?: string;
	logoUrl?: string;
	bannerUrl?: string;
	websiteUrl?: string;
	address?: Record<string, string>;
	taxId?: string;
}

export interface UpdateVendorData {
	businessName?: string;
	businessType?: string;
	description?: string;
	logoUrl?: string;
	bannerUrl?: string;
	websiteUrl?: string;
	address?: Record<string, string>;
	taxId?: string;
	commissionRate?: number;
	isVerified?: boolean;
	isActive?: boolean;
}

export interface Video {
	id: string;
	vendorId: string;
	title: string;
	description?: string;
	videoUrl: string;
	thumbnailUrl?: string;
	duration: number; // in seconds
	fileSize: number; // in bytes
	resolution: string; // e.g., "1920x1080"
	format: string; // e.g., "mp4"
	status: "processing" | "ready" | "failed";
	isPublic: boolean;
	viewCount: number;
	likeCount: number;
	shareCount: number;
	commentCount: number;
	tags: string[];
	metadata?: Record<string, number>;
	createdAt: Date;
	updatedAt: Date;
}

export interface CreateVideoData {
	vendorId: string;
	title: string;
	description?: string;
	videoUrl: string;
	thumbnailUrl?: string;
	duration: number;
	fileSize: number;
	resolution: string;
	format: string;
	isPublic?: boolean;
	tags?: string[];
	metadata?: Record<string, number>;
}

export interface UpdateVideoData {
	title?: string;
	description?: string;
	thumbnailUrl?: string;
	status?: Video["status"];
	isPublic?: boolean;
	tags?: string[];
	metadata?: Record<string, number>;
}

export interface Payment {
	id: string;
	orderId: string;
	vendorId: string;
	userId: string;
	stripePaymentIntentId: string;
	stripeChargeId?: string;
	amount: number;
	currency: string;
	status:
		| "pending"
		| "processing"
		| "succeeded"
		| "failed"
		| "canceled"
		| "refunded"
		| "partially_refunded";
	paymentMethod: string;
	metadata?: Record<string, number>;
	createdAt: Date;
	updatedAt: Date;
}

export interface Payout {
	id: string;
	vendorId: string;
	stripePayoutId?: string;
	amount: number;
	currency: string;
	status: "pending" | "in_transit" | "paid" | "failed" | "canceled";
	description?: string;
	metadata?: Record<string, number>;
	createdAt: Date;
	updatedAt: Date;
}

export interface CreatePaymentIntentData {
	orderId: string;
	amount: number;
	currency?: string;
	paymentMethodTypes?: string[];
	metadata?: Record<string, number>;
}

export interface CreatePayoutData {
	vendorId: string;
	amount: number;
	currency?: string;
	description?: string;
	metadata?: Record<string, number>;
}

export interface Notification {
	id: string;
	userId: string;
	type: "order" | "stream" | "product" | "vendor" | "system" | "payout";
	title: string;
	message: string;
	data?: Record<string, number>;
	isRead: boolean;
	createdAt: Date;
	readAt?: Date;
}

export interface CreateNotificationData {
	userId: string;
	type: Notification["type"];
	title: string;
	message: string;
	data?: Record<string, number>;
}

export interface MediaFile {
	id: string;
	userId: string;
	filename: string;
	originalName: string;
	mimeType: string;
	size: number;
	url: string;
	r2Key?: string;
	thumbnailUrl?: string;
	metadata?: Record<string, number>;
	status: "uploading" | "processing" | "ready" | "failed";
	createdAt: Date;
	updatedAt: Date;
}

export interface UploadOptions {
	userId: string;
	file: {
		buffer: Buffer;
		originalname: string;
		mimetype: string;
		size: number;
	};
	folder?: string;
	generateThumbnail?: boolean;
	processVideo?: boolean;
	uploadToR2?: boolean;
	maxWidth?: number;
	maxHeight?: number;
	quality?: number;
}

export interface ProcessingResult {
	success: boolean;
	processedUrl?: string;
	thumbnailUrl?: string;
	metadata?: Record<string, number>;
	error?: string;
}

export interface AnalyticsEvent {
	id: string;
	userId?: string;
	sessionId?: string;
	eventType: string;
	eventCategory: string;
	eventAction: string;
	eventLabel?: string;
	eventValue?: number;
	properties?: Record<string, number>;
	timestamp: Date;
	ipAddress?: string;
	userAgent?: string;
	referrer?: string;
	url?: string;
}

export interface TrackEventData {
	userId?: string;
	sessionId?: string;
	eventType: string;
	eventCategory: string;
	eventAction: string;
	eventLabel?: string;
	eventValue?: number;
	properties?: Record<string, number>;
	ipAddress?: string;
	userAgent?: string;
	referrer?: string;
	url?: string;
}

export interface AnalyticsMetrics {
	totalUsers: number;
	activeUsers: number;
	totalSessions: number;
	averageSessionDuration: number;
	bounceRate: number;
	pageViews: number;
	uniquePageViews: number;
	conversionRate: number;
}

export interface StreamAnalytics {
	streamId: string;
	totalViews: number;
	uniqueViewers: number;
	averageViewDuration: number;
	peakViewers: number;
	chatMessages: number;
	likes: number;
	shares: number;
	conversionRate: number;
	revenue: number;
}

export interface ProductAnalytics {
	productId: string;
	views: number;
	uniqueViews: number;
	addToCart: number;
	purchases: number;
	conversionRate: number;
	revenue: number;
	averageRating: number;
	reviewCount: number;
}

export interface VendorAnalytics {
	vendorId: string;
	totalProducts: number;
	totalOrders: number;
	totalRevenue: number;
	averageOrderValue: number;
	conversionRate: number;
	customerCount: number;
	repeatCustomerRate: number;
	topProducts: ProductAnalytics[];
	recentStreams: StreamAnalytics[];
}

export type ErrorResult = [
	error: Error | undefined,
	message: string | undefined,
];

export interface RealTimeMetrics {
	activeUsers: number;
	pageViewsToday: number;
	ordersToday: number;
	revenueToday: number;
	activeStreams: number;
}

export interface WebhookEvent {
	id: string;
	type: string;
	source: "internal" | "stripe" | "cloudflare" | "external";
	data: Record<string, number>;
	timestamp: Date;
	signature?: string;
	processed: boolean;
	processedAt?: Date;
	retryCount: number;
	maxRetries: number;
	nextRetryAt?: Date;
	error?: string;
}

export interface WebhookEndpoint {
	id: string;
	url: string;
	events: string[];
	secret: string;
	isActive: boolean;
	retryPolicy: {
		maxRetries: number;
		backoffMultiplier: number;
		initialDelay: number;
	};
	headers?: Record<string, string>;
	createdAt: Date;
	updatedAt: Date;
}

export interface WebhookDelivery {
	id: string;
	webhookId: string;
	eventId: string;
	url: string;
	httpStatus?: number;
	responseBody?: string;
	responseHeaders?: Record<string, string>;
	deliveredAt?: Date;
	error?: string;
	retryCount: number;
	nextRetryAt?: Date;
	createdAt: Date;
}

export interface TrackingInfo {
	trackingNumber: string;
	carrier: string;
	estimatedDelivery?: string;
	shippingDate: string;
	recipientName: string;
	recipientEmail: string;
	shippingAddress: {
		street: string;
		city: string;
		state: string;
		zipCode: string;
		country: string;
	};
	trackingUrl?: string;
	orderItems?: Array<{
		name: string;
		quantity: number;
		price: number;
	}>;
}

export interface OrderData {
	orderId: string;
	customerName: string;
	customerEmail: string;
	orderDate: string;
	items: Array<{
		id: string;
		name: string;
		description?: string;
		quantity: number;
		price: number;
		imageUrl?: string;
	}>;
	subtotal: number;
	tax: number;
	shipping: number;
	total: number;
	billingAddress: {
		street: string;
		city: string;
		state: string;
		zipCode: string;
		country: string;
	};
	shippingAddress: {
		street: string;
		city: string;
		state: string;
		zipCode: string;
		country: string;
	};
	paymentMethod: {
		type: string;
		last4?: string;
	};
	estimatedDelivery?: string;
}

export interface ServiceHealth {
	service: string;
	status: "healthy" | "degraded" | "unhealthy";
	version: string;
	uptime: number;
	lastCheck: Date;
	dependencies: Array<{
		name: string;
		status: "healthy" | "unhealthy";
		responseTime?: number;
	}>;
	metrics: {
		requestsPerSecond: number;
		averageResponseTime: number;
		errorRate: number;
		memoryUsage: number;
		cpuUsage: number;
	};
}

export interface ServiceRegistry {
	services: Map<
		string,
		{
			name: string;
			version: string;
			endpoint: string;
			health: ServiceHealth;
			lastHeartbeat: Date;
		}
	>;
}

export type PaymentConfirmationData = {
	orderId: string;
	paymentData: {
		customerName: string;
		customerEmail: string;
		amount: number;
		currency: string;
		paymentMethod: {
			type: string;
			last4?: string;
		};
		transactionId: string;
		paymentDate: Date;
		orderItems: Array<{
			name: string;
			quantity: number;
			price: number;
		}>;
	};
};

export type DeliveryConfirmationData = {
	orderId: string;
	deliveryData: {
		customerName: string;
		customerEmail: string;
		deliveryDate: Date;
		deliveryAddress: {
			street: string;
			city: string;
			state: string;
			zipCode: string;
			country: string;
		};
		orderItems: Array<{
			name: string;
			quantity: number;
			price: number;
		}>;
		totalAmount: number;
		trackingNumber?: string;
		carrier?: string;
		deliveryNotes?: string;
	};
};

export interface OrderShippedEvent {
	orderId: string;
	trackingInfo: TrackingInfo;
}

export interface ChatMessage {
	id: string;
	streamKey: string;
	userId: string;
	username: string;
	userAvatar?: string;
	userRole: "viewer" | "moderator" | "streamer" | "admin";
	message: string;
	messageType: "text" | "emoji" | "sticker" | "system" | "donation";
	metadata?: {
		donationAmount?: number;
		currency?: string;
		productId?: string;
		stickerUrl?: string;
		mentions?: string[];
		isHighlighted?: boolean;
		emotes?: string[];
	};
	timestamp: Date;
	isDeleted: boolean;
	deletedBy?: string;
	deletedAt?: Date;
}

export interface ChatRoom {
	streamKey: string;
	streamerId: string;
	isActive: boolean;
	viewerCount: number;
	messageCount: number;
	moderators: string[];
	bannedUsers: string[];
	slowMode: number; // seconds between messages
	subscriberOnly: boolean;
	emotesOnly: boolean;
	settings: {
		maxMessageLength: number;
		allowLinks: boolean;
		allowEmotes: boolean;
		allowStickers: boolean;
		profanityFilter: boolean;
	};
	createdAt: Date;
	updatedAt: Date;
}

export interface ChatStats {
	totalMessages: number;
	activeUsers: number;
	messagesPerMinute: number;
	topChatters: Array<{
		userId: string;
		username: string;
		messageCount: number;
	}>;
	popularEmotes: Array<{
		emote: string;
		count: number;
	}>;
}

export interface Donation {
	id: string;
	streamKey: string;
	streamerId: string;
	donorId: string;
	donorName: string;
	donorAvatar?: string;
	amount: number;
	currency: string;
	message?: string;
	isAnonymous: boolean;
	isHighlighted: boolean;
	highlightDuration: number; // seconds
	paymentIntentId: string;
	status: "pending" | "completed" | "failed" | "refunded";
	processedAt?: Date;
	refundedAt?: Date;
	createdAt: Date;
	updatedAt: Date;
}
export interface TopDonorRow {
	donor_id: string;
	donor_name: string;
	total_amount: string;
	donation_count: string;
}
export interface DonationGoal {
	id: string;
	streamKey: string;
	streamerId: string;
	title: string;
	description?: string;
	targetAmount: number;
	currentAmount: number;
	currency: string;
	isActive: boolean;
	startDate: Date;
	endDate?: Date;
	createdAt: Date;
	updatedAt: Date;
}

export interface DonationAlert {
	id: string;
	streamKey: string;
	donationId: string;
	type: "new_donation" | "goal_reached" | "milestone";
	title: string;
	message: string;
	amount?: number;
	currency?: string;
	duration: number; // seconds
	isShown: boolean;
	shownAt?: Date;
	createdAt: Date;
}

export interface DonationStats {
	totalDonations: number;
	totalAmount: number;
	currency: string;
	averageDonation: number;
	topDonation: number;
	donationsToday: number;
	amountToday: number;
	topDonors: Array<{
		donorId: string;
		donorName: string;
		totalAmount: number;
		donationCount: number;
	}>;
	recentDonations: Donation[];
}

export interface DonationTier {
	minAmount: number;
	maxAmount?: number;
	name: string;
	color: string;
	highlightDuration: number;
	soundAlert?: string;
	animationEffect?: string;
	benefits?: string[];
}

export interface OrderRow {
	id: string;
	order_number: string;
	user_id: string;
	vendor_id: string;
	status: string;
	payment_status: string;
	subtotal: string;
	tax_amount: string;
	shipping_amount: string;
	discount_amount: string;
	total_amount: string;
	currency: string;
	shipping_address: string;
	billing_address: string;
	notes: string | null;
	shipped_at: Date | null;
	delivered_at: Date | null;
	created_at: Date;
	updated_at: Date;
}

export interface OrderItemRow {
	id: string;
	order_id: string;
	product_id: string;
	variant_id: string | null;
	product_name: string;
	variant_name: string | null;
	sku: string;
	quantity: string;
	price: string;
	total: string;
	created_at: Date;
}
