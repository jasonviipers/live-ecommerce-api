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

export interface CreateUserData {
	email: string;
	password: string;
	firstName: string;
	lastName: string;
	phone?: string;
	role?: "vendor" | "customer";
}

export interface UpdateUserData {
	firstName?: string;
	lastName?: string;
	phone?: string;
	avatarUrl?: string;
	isActive?: boolean;
	emailVerified?: boolean;
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
		| "refunded";
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
	shippingAddress?: any;
	billingAddress?: any;
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
	shippingAddress?: any;
	billingAddress?: any;
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
	dimensions?: any;
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
	dimensions?: any;
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
	dimensions?: any;
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
	metadata?: any;
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
	metadata?: any;
}

export interface UpdateStreamData {
	title?: string;
	description?: string;
	thumbnailUrl?: string;
	scheduledAt?: Date;
	status?: Stream["status"];
	isRecorded?: boolean;
	tags?: string[];
	metadata?: any;
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
	address?: any;
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
	address?: any;
	taxId?: string;
}

export interface UpdateVendorData {
	businessName?: string;
	businessType?: string;
	description?: string;
	logoUrl?: string;
	bannerUrl?: string;
	websiteUrl?: string;
	address?: any;
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
	metadata?: any;
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
	metadata?: any;
}

export interface UpdateVideoData {
	title?: string;
	description?: string;
	thumbnailUrl?: string;
	status?: Video["status"];
	isPublic?: boolean;
	tags?: string[];
	metadata?: any;
}
