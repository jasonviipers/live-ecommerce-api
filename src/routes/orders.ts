import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
	authMiddleware,
	requireAuthenticated,
	requireVendorOrAdmin,
	requireAdmin,
} from "../middleware/auth";
import { createError } from "../middleware/errorHandler";
import { logger } from "../config/logger";
import OrderRepository from "@/repositories/order";
import {
	addressSchema,
	createOrderSchema,
	querySchema,
	updateOrderSchema,
} from "@/utils/validation";
import CartRepository from "@/repositories/cart";
import ProductRepository from "@/repositories/product";

const orders = new Hono();

// Get all orders (user's own orders or vendor/admin)
orders.get(
	"/",
	authMiddleware,
	requireAuthenticated,
	zValidator("query", querySchema),
	async (c) => {
		try {
			const user = c.get("user");
			const query = c.req.valid("query");

			let filters: any = {
				status: query.status,
				paymentStatus: query.paymentStatus,
				dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
				dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
			};

			// Apply user-specific filters
			if (user.role === "customer") {
				filters.userId = user.id;
			} else if (user.role === "vendor") {
				filters.vendorId = query.vendorId || user.vendorId;
			} else if (user.role === "admin") {
				filters.vendorId = query.vendorId;
			}

			const result = await OrderRepository.findAll(
				query.page,
				query.limit,
				filters,
			);

			return c.json({
				success: true,
				data: result,
				pagination: {
					page: result.page,
					limit: result.limit,
					total: result.total,
					totalPages: Math.ceil(result.total / result.limit),
				},
			});
		} catch (error) {
			logger.error("Failed to get orders", error as Error);
			throw createError.internal("Failed to retrieve orders");
		}
	},
);

// Create order from cart or direct items
orders.post(
	"/",
	authMiddleware,
	requireAuthenticated,
	zValidator(
		"json",
		createOrderSchema.or(
			z.object({
				cartId: z.string().uuid("Invalid cart ID"),
				vendorId: z.string().uuid("Invalid vendor ID"),
				shippingAddress: addressSchema,
				billingAddress: addressSchema.optional(),
				notes: z.string().max(1000).optional(),
				taxAmount: z.number().min(0).default(0),
				shippingAmount: z.number().min(0).default(0),
				discountAmount: z.number().min(0).default(0),
			}),
		),
	),
	async (c) => {
		try {
			const user = c.get("user");
			const data = c.req.valid("json");

			let orderItems: any[] = [];

			if ("cartId" in data) {
				// Create order from cart
				const cartSummary = await CartRepository.getCartSummary(data.cartId);
				if (!cartSummary || cartSummary.items.length === 0) {
					throw createError.badRequest("Cart is empty or not found");
				}

				const validation = await CartRepository.validateCart(data.cartId);
				if (!validation.isValid) {
					return c.json(
						{
							success: false,
							message: "Cart validation failed",
							issues: validation.issues,
						},
						400,
					);
				}

				// Convert cart items to order items
				orderItems = cartSummary.items.map((item) => ({
					productId: item.productId,
					variantId: item.variantId,
					quantity: item.quantity,
					price: item.price,
				}));
			} else {
				orderItems = data.items;
			}

			// Validate inventory for all items
			for (const item of orderItems) {
				const product = await ProductRepository.findById(item.productId);
				if (!product || !product.isActive) {
					throw createError.badRequest(
						`Product ${item.productId} is not available`,
					);
				}

				if (
					product.trackInventory &&
					product.inventoryQuantity < item.quantity
				) {
					throw createError.badRequest(
						`Insufficient inventory for product ${product.name}`,
					);
				}
			}

			// Create order
			const order = await OrderRepository.create({
				userId: user.id,
				vendorId: data.vendorId,
				items: orderItems,
				shippingAddress: data.shippingAddress,
				billingAddress: data.billingAddress || data.shippingAddress,
				notes: data.notes,
				taxAmount: data.taxAmount,
				shippingAmount: data.shippingAmount,
				discountAmount: data.discountAmount,
			});

			// Update inventory for all items
			for (const item of orderItems) {
				await ProductRepository.decreaseInventory(
					item.productId,
					item.quantity,
				);
			}

			// Clear cart if order was created from cart
			if ("cartId" in data) {
				await CartRepository.clearCart(data.cartId);
			}

			logger.info("Order created successfully", {
				orderId: order.id,
				orderNumber: order.orderNumber,
				userId: user.id,
				vendorId: data.vendorId,
				totalAmount: order.totalAmount,
			});

			return c.json(
				{
					success: true,
					message: "Order created successfully",
					data: order,
				},
				201,
			);
		} catch (error) {
			logger.error("Failed to create order", error as Error);
			throw error;
		}
	},
);

// Get single order
orders.get("/:id", authMiddleware, requireAuthenticated, async (c) => {
	try {
		const user = c.get("user");
		const id = c.req.param("id");

		const order = await OrderRepository.findById(id);
		if (!order) {
			throw createError.notFound("Order not found");
		}

		// Check access permissions
		if (user.role === "customer" && order.userId !== user.id) {
			throw createError.forbidden("Access denied to this order");
		} else if (user.role === "vendor" && order.vendorId !== user.vendorId) {
			throw createError.forbidden("Access denied to this order");
		}

		// Get order items
		const items = await OrderRepository.getOrderItems(id);

		return c.json({
			success: true,
			data: {
				...order,
				items,
			},
		});
	} catch (error) {
		logger.error("Failed to get order", error as Error);
		throw error;
	}
});

// Get order by order number
orders.get(
	"/number/:orderNumber",
	authMiddleware,
	requireAuthenticated,
	async (c) => {
		try {
			const user = c.get("user");
			const orderNumber = c.req.param("orderNumber");

			const order = await OrderRepository.findByOrderNumber(orderNumber);
			if (!order) {
				throw createError.notFound("Order not found");
			}

			// Check access permissions
			if (user.role === "customer" && order.userId !== user.id) {
				throw createError.forbidden("Access denied to this order");
			} else if (user.role === "vendor" && order.vendorId !== user.vendorId) {
				throw createError.forbidden("Access denied to this order");
			}

			// Get order items
			const items = await OrderRepository.getOrderItems(order.id);

			return c.json({
				success: true,
				data: {
					...order,
					items,
				},
			});
		} catch (error) {
			logger.error("Failed to get order by number", error as Error);
			throw error;
		}
	},
);

// Update order (vendor/admin only)
orders.put(
	"/:id",
	authMiddleware,
	requireVendorOrAdmin,
	zValidator("json", updateOrderSchema),
	async (c) => {
		try {
			const user = c.get("user");
			const id = c.req.param("id");
			const data = c.req.valid("json");

			// Get existing order
			const existingOrder = await OrderRepository.findById(id);
			if (!existingOrder) {
				throw createError.notFound("Order not found");
			}

			// Check ownership (vendors can only update their own orders)
			if (user.role === "vendor" && existingOrder.vendorId !== user.vendorId) {
				throw createError.forbidden("Access denied to this order");
			}

			// Convert date strings to Date objects
			const updateData: any = { ...data };
			if (updateData.shippedAt) {
				updateData.shippedAt = new Date(updateData.shippedAt);
			}
			if (updateData.deliveredAt) {
				updateData.deliveredAt = new Date(updateData.deliveredAt);
			}

			const order = await OrderRepository.update(id, updateData);

			if (!order) {
				throw createError.notFound("Order not found");
			}

			logger.info("Order updated successfully", {
				orderId: id,
				userId: user.id,
				changes: data,
			});

			return c.json({
				success: true,
				message: "Order updated successfully",
				data: order,
			});
		} catch (error) {
			logger.error("Failed to update order", error as Error);
			throw error;
		}
	},
);

// Update order status (vendor/admin only)
orders.patch(
	"/:id/status",
	authMiddleware,
	requireVendorOrAdmin,
	zValidator(
		"json",
		z.object({
			status: z.enum([
				"pending",
				"confirmed",
				"processing",
				"shipped",
				"delivered",
				"cancelled",
				"refunded",
			]),
		}),
	),
	async (c) => {
		try {
			const user = c.get("user");
			const id = c.req.param("id");
			const { status } = c.req.valid("json");

			// Get existing order
			const existingOrder = await OrderRepository.findById(id);
			if (!existingOrder) {
				throw createError.notFound("Order not found");
			}

			// Check ownership
			if (user.role === "vendor" && existingOrder.vendorId !== user.vendorId) {
				throw createError.forbidden("Access denied to this order");
			}

			const updated = await OrderRepository.updateStatus(id, status);

			if (!updated) {
				throw createError.notFound("Order not found");
			}

			logger.info("Order status updated", {
				orderId: id,
				status,
				userId: user.id,
			});

			return c.json({
				success: true,
				message: "Order status updated successfully",
			});
		} catch (error) {
			logger.error("Failed to update order status", error as Error);
			throw error;
		}
	},
);

// Update payment status (admin only)
orders.patch(
	"/:id/payment-status",
	authMiddleware,
	requireAdmin,
	zValidator(
		"json",
		z.object({
			paymentStatus: z.enum([
				"pending",
				"paid",
				"failed",
				"refunded",
				"partially_refunded",
			]),
		}),
	),
	async (c) => {
		try {
			const user = c.get("user");
			const id = c.req.param("id");
			const { paymentStatus } = c.req.valid("json");

			const updated = await OrderRepository.updatePaymentStatus(
				id,
				paymentStatus,
			);

			if (!updated) {
				throw createError.notFound("Order not found");
			}

			logger.info("Order payment status updated", {
				orderId: id,
				paymentStatus,
				userId: user.id,
			});

			return c.json({
				success: true,
				message: "Payment status updated successfully",
			});
		} catch (error) {
			logger.error("Failed to update payment status", error as Error);
			throw error;
		}
	},
);

// Cancel order
orders.post(
	"/:id/cancel",
	authMiddleware,
	requireAuthenticated,
	zValidator(
		"json",
		z.object({
			reason: z.string().max(500).optional(),
		}),
	),
	async (c) => {
		try {
			const user = c.get("user");
			const id = c.req.param("id");
			const { reason } = c.req.valid("json");

			// Get existing order
			const existingOrder = await OrderRepository.findById(id);
			if (!existingOrder) {
				throw createError.notFound("Order not found");
			}

			// Check permissions
			const canCancel =
				user.role === "admin" ||
				(user.role === "vendor" && existingOrder.vendorId === user.vendorId) ||
				(user.role === "customer" && existingOrder.userId === user.id);

			if (!canCancel) {
				throw createError.forbidden("Access denied to cancel this order");
			}

			const cancelled = await OrderRepository.cancel(id, reason);

			if (!cancelled) {
				throw createError.badRequest("Order cannot be cancelled");
			}

			logger.info("Order cancelled", {
				orderId: id,
				reason,
				userId: user.id,
			});

			return c.json({
				success: true,
				message: "Order cancelled successfully",
			});
		} catch (error) {
			logger.error("Failed to cancel order", error as Error);
			throw error;
		}
	},
);

// Get order statistics (vendor/admin only)
orders.get(
	"/stats/summary",
	authMiddleware,
	requireVendorOrAdmin,
	zValidator(
		"query",
		z.object({
			vendorId: z.string().uuid().optional(),
			dateFrom: z.string().datetime().optional(),
			dateTo: z.string().datetime().optional(),
		}),
	),
	async (c) => {
		try {
			const user = c.get("user");
			const query = c.req.valid("query");

			let filters: any = {
				dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
				dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
			};

			if (user.role === "vendor") {
				filters.vendorId = user.vendorId;
			} else if (user.role === "admin") {
				filters.vendorId = query.vendorId;
			}

			const stats = await OrderRepository.getStats(filters);

			return c.json({
				success: true,
				data: stats,
			});
		} catch (error) {
			logger.error("Failed to get order statistics", error as Error);
			throw createError.internal("Failed to retrieve order statistics");
		}
	},
);

export default orders;
