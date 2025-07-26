import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware, optionalAuthMiddleware } from "@/middleware/auth";
import { createError } from "@/middleware/errorHandler";
import { logger } from "@/config/logger";
import CartRepository from "@/repositories/cart";
import { addItemSchema, updateItemSchema } from "@/utils/validation";
import ProductRepository from "@/repositories/product";
import { z } from "zod";
import type { CartSummary, User } from "@/types";

const cartRoutes = new Hono();

async function verifyCartItemOwnership(
	c: Context,
	itemId: string,
): Promise<{ cartId: string }> {
	const user = c.get("user") as User | undefined;
	let cartId: string;

	if (user) {
		const userCart = await CartRepository.getOrCreateForUser(user.id);
		cartId = userCart.id;
	} else {
		const sessionId = c.req.header("x-session-id") || "anonymous";
		const sessionCart = await CartRepository.getOrCreateForSession(sessionId);
		cartId = sessionCart.id;
	}

	const cartItems = await CartRepository.getCartItems(cartId);
	const itemExists = cartItems.some((item) => item.id === itemId);

	if (!itemExists) {
		throw createError.forbidden("Cart item does not belong to your cart");
	}

	return { cartId };
}

cartRoutes.get("/", optionalAuthMiddleware, async (c) => {
	try {
		const user = c.get("user");
		let cartSummary: CartSummary | null;

		if (user) {
			const userCart = await CartRepository.getOrCreateForUser(user.id);
			cartSummary = await CartRepository.getCartSummary(userCart.id);
		} else {
			// Get session cart
			const sessionId = c.req.header("x-session-id") || "anonymous";
			const sessionCart = await CartRepository.getOrCreateForSession(sessionId);
			cartSummary = await CartRepository.getCartSummary(sessionCart.id);
		}

		return c.json({
			success: true,
			data: cartSummary,
		});
	} catch (error) {
		logger.error("Failed to get cart", error as Error);
		throw createError.internal("Failed to retrieve cart");
	}
});

// Add item to cart
cartRoutes.post(
	"/items",
	optionalAuthMiddleware,
	zValidator("json", addItemSchema),
	async (c) => {
		try {
			const user = c.get("user");
			const { productId, variantId, quantity } = c.req.valid("json");

			// Get or create cart
			let cartId: string;
			if (user) {
				const userCart = await CartRepository.getOrCreateForUser(user.id);
				cartId = userCart.id;
			} else {
				const sessionId = c.req.header("x-session-id") || "anonymous";
				const sessionCart =
					await CartRepository.getOrCreateForSession(sessionId);
				cartId = sessionCart.id;
			}

			const product = await ProductRepository.findById(productId);
			if (!product || !product.isActive) {
				throw createError.badRequest("Product is not available");
			}

			if (product.trackInventory && product.inventoryQuantity < quantity) {
				throw createError.badRequest("Insufficient inventory");
			}

			const cartItem = await CartRepository.addItem(
				cartId,
				productId,
				quantity,
				product.price,
				variantId,
			);

			logger.info("Item added to cart", {
				cartId,
				productId,
				quantity,
				userId: user?.id,
			});

			return c.json(
				{
					success: true,
					message: "Item added to cart",
					data: cartItem,
				},
				201,
			);
		} catch (error) {
			logger.error("Failed to add item to cart", error as Error);
			throw error;
		}
	},
);

// Update cart item quantity
cartRoutes.put(
	"/items/:itemId",
	optionalAuthMiddleware,
	zValidator("json", updateItemSchema),
	async (c) => {
		try {
			const user = c.get("user");
			const itemId = c.req.param("itemId");
			const { quantity } = c.req.valid("json");

			await verifyCartItemOwnership(c, itemId);

			const cartItem = await CartRepository.updateItemQuantity(
				itemId,
				quantity,
			);

			if (!cartItem && quantity > 0) {
				throw createError.notFound("Cart item not found");
			}

			logger.info("Cart item updated", {
				itemId,
				quantity,
				userId: user?.id,
			});

			return c.json({
				success: true,
				message:
					quantity > 0 ? "Item quantity updated" : "Item removed from cart",
				data: cartItem,
			});
		} catch (error) {
			logger.error("Failed to update cart item", error as Error);
			throw error;
		}
	},
);

// Remove item from cart
cartRoutes.delete("/items/:itemId", optionalAuthMiddleware, async (c) => {
	try {
		const user = c.get("user");
		const itemId = c.req.param("itemId");

		await verifyCartItemOwnership(c, itemId);

		const removed = await CartRepository.removeItem(itemId);

		if (!removed) {
			throw createError.notFound("Cart item not found");
		}

		logger.info("Item removed from cart", {
			itemId,
			userId: user?.id,
		});

		return c.json({
			success: true,
			message: "Item removed from cart",
		});
	} catch (error) {
		logger.error("Failed to remove cart item", error as Error);
		throw error;
	}
});

// Clear cart
cartRoutes.delete("/", optionalAuthMiddleware, async (c) => {
	try {
		const user = c.get("user");
		let cartId: string;

		if (user) {
			const userCart = await CartRepository.getOrCreateForUser(user.id);
			cartId = userCart.id;
		} else {
			const sessionId = c.req.header("x-session-id") || "anonymous";
			const sessionCart = await CartRepository.getOrCreateForSession(sessionId);
			cartId = sessionCart.id;
		}

		await CartRepository.clearCart(cartId);

		logger.info("Cart cleared", {
			cartId,
			userId: user?.id,
		});

		return c.json({
			success: true,
			message: "Cart cleared",
		});
	} catch (error) {
		logger.error("Failed to clear cart", error as Error);
		throw error;
	}
});

// Validate cart
cartRoutes.get("/validate", optionalAuthMiddleware, async (c) => {
	try {
		const user = c.get("user");
		let cartId: string;

		if (user) {
			const userCart = await CartRepository.getOrCreateForUser(user.id);
			cartId = userCart.id;
		} else {
			const sessionId = c.req.header("x-session-id") || "anonymous";
			const sessionCart = await CartRepository.getOrCreateForSession(sessionId);
			cartId = sessionCart.id;
		}

		const validation = await CartRepository.validateCart(cartId);

		return c.json({
			success: true,
			data: validation,
		});
	} catch (error) {
		logger.error("Failed to validate cart", error as Error);
		throw createError.internal("Failed to validate cart");
	}
});

// Merge session cart with user cart (called after login)
cartRoutes.post(
	"/merge",
	authMiddleware,
	zValidator(
		"json",
		z.object({
			sessionId: z.string().min(1, "Session ID is required"),
		}),
	),
	async (c) => {
		try {
			const user = c.get("user");
			const { sessionId } = c.req.valid("json");

			const mergedCart = await CartRepository.mergeSessionCartToUser(
				sessionId,
				user.id,
			);

			logger.info("Session cart merged with user cart", {
				sessionId,
				userId: user.id,
				cartId: mergedCart.id,
			});

			return c.json({
				success: true,
				message: "Cart merged successfully",
				data: mergedCart,
			});
		} catch (error) {
			logger.error("Failed to merge cart", error as Error);
			throw error;
		}
	},
);

export default cartRoutes;
