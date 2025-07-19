import { query, withTransaction } from "@/database/connection";
import { Cart, CartItem, CartSummary } from "@/types";
import { PoolClient } from "pg";

export class CartRepository {
	static async getOrCreateForUser(userId: string): Promise<Cart> {
		let sql = "SELECT * FROM carts WHERE user_id = $1";
		let result = await query(sql, [userId]);

		if (result.rows.length > 0) {
			return this.mapRowToCart(result.rows[0]);
		}

		// Create new cart
		sql = "INSERT INTO carts (user_id) VALUES ($1) RETURNING *";
		result = await query(sql, [userId]);

		return this.mapRowToCart(result.rows[0]);
	}

	// Get or create cart for session
	static async getOrCreateForSession(sessionId: string): Promise<Cart> {
		// Try to find existing cart
		let sql = "SELECT * FROM carts WHERE session_id = $1";
		let result = await query(sql, [sessionId]);

		if (result.rows.length > 0) {
			return this.mapRowToCart(result.rows[0]);
		}

		// Create new cart
		sql = "INSERT INTO carts (session_id) VALUES ($1) RETURNING *";
		result = await query(sql, [sessionId]);

		return this.mapRowToCart(result.rows[0]);
	}

	// Find cart by ID
	static async findById(id: string): Promise<Cart | null> {
		const sql = "SELECT * FROM carts WHERE id = $1";
		const result = await query(sql, [id]);

		if (result.rows.length === 0) {
			return null;
		}

		return this.mapRowToCart(result.rows[0]);
	}

	// Get cart with items
	static async getCartSummary(cartId: string): Promise<CartSummary | null> {
		const cart = await this.findById(cartId);
		if (!cart) {
			return null;
		}

		const items = await this.getCartItems(cartId);
		const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
		const subtotal = items.reduce(
			(sum, item) => sum + item.price * item.quantity,
			0,
		);

		return {
			cart,
			items,
			itemCount,
			subtotal,
		};
	}

	// Get cart items with product details
	static async getCartItems(cartId: string): Promise<CartItem[]> {
		const sql = `
      SELECT 
        ci.*,
        p.name as product_name,
        p.images->0 as product_image,
        p.inventory_quantity,
        pv.name as variant_name
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      LEFT JOIN product_variants pv ON ci.variant_id = pv.id
      WHERE ci.cart_id = $1
      ORDER BY ci.created_at
    `;

		const result = await query(sql, [cartId]);

		return result.rows.map(
			(row: {
				id: string;
				cart_id: string;
				product_id: string;
				variant_id: string | null;
				quantity: string;
				price: string;
				created_at: Date;
				updated_at: Date;
				product_name: string;
				product_image: string;
				variant_name: string | null;
				inventory_quantity: string;
			}) => ({
				id: row.id,
				cartId: row.cart_id,
				productId: row.product_id,
				variantId: row.variant_id,
				quantity: parseInt(row.quantity),
				price: parseFloat(row.price),
				createdAt: row.created_at,
				updatedAt: row.updated_at,
				productName: row.product_name,
				productImage: row.product_image,
				variantName: row.variant_name,
				inventoryQuantity: parseInt(row.inventory_quantity),
			}),
		);
	}

	// Add item to cart
	static async addItem(
		cartId: string,
		productId: string,
		quantity: number,
		price: number,
		variantId?: string,
	): Promise<CartItem> {
		return withTransaction(async (client: PoolClient) => {
			// Check if item already exists in cart
			const checkSql = `
        SELECT * FROM cart_items 
        WHERE cart_id = $1 AND product_id = $2 AND ($3::uuid IS NULL OR variant_id = $3)
      `;
			const checkResult = await client.query(checkSql, [
				cartId,
				productId,
				variantId,
			]);

			if (checkResult.rows.length > 0) {
				// Update existing item
				const existingItem = checkResult.rows[0];
				const newQuantity = parseInt(existingItem.quantity) + quantity;

				const updateSql = `
          UPDATE cart_items 
          SET quantity = $1, price = $2
          WHERE id = $3
          RETURNING *
        `;
				const updateResult = await client.query(updateSql, [
					newQuantity,
					price,
					existingItem.id,
				]);
				return this.mapRowToCartItem(updateResult.rows[0]);
			} else {
				// Create new item
				const insertSql = `
          INSERT INTO cart_items (cart_id, product_id, variant_id, quantity, price)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING *
        `;
				const insertResult = await client.query(insertSql, [
					cartId,
					productId,
					variantId,
					quantity,
					price,
				]);
				return this.mapRowToCartItem(insertResult.rows[0]);
			}
		});
	}

	// Update cart item quantity
	static async updateItemQuantity(
		itemId: string,
		quantity: number,
	): Promise<CartItem | null> {
		if (quantity <= 0) {
			await this.removeItem(itemId);
			return null;
		}

		const sql = `
      UPDATE cart_items 
      SET quantity = $1
      WHERE id = $2
      RETURNING *
    `;

		const result = await query(sql, [quantity, itemId]);

		if (result.rows.length === 0) {
			return null;
		}

		return this.mapRowToCartItem(result.rows[0]);
	}

	// Remove item from cart
	static async removeItem(itemId: string): Promise<boolean> {
		const sql = "DELETE FROM cart_items WHERE id = $1";
		const result = await query(sql, [itemId]);

		return result.rowCount > 0;
	}

	// Clear cart
	static async clearCart(cartId: string): Promise<boolean> {
		const sql = "DELETE FROM cart_items WHERE cart_id = $1";
		const result = await query(sql, [cartId]);

		return result.rowCount >= 0; // Return true even if cart was already empty
	}

	// Merge session cart with user cart
	static async mergeSessionCartToUser(
		sessionId: string,
		userId: string,
	): Promise<Cart> {
		return withTransaction(async (client: PoolClient) => {
			// Get or create user cart
			const userCart = await this.getOrCreateForUser(userId);

			// Find session cart
			const sessionCartSql = "SELECT * FROM carts WHERE session_id = $1";
			const sessionCartResult = await client.query(sessionCartSql, [sessionId]);

			if (sessionCartResult.rows.length === 0) {
				return userCart;
			}

			const sessionCart = sessionCartResult.rows[0];

			// Get session cart items
			const sessionItemsSql = "SELECT * FROM cart_items WHERE cart_id = $1";
			const sessionItemsResult = await client.query(sessionItemsSql, [
				sessionCart.id,
			]);

			// Merge items into user cart
			for (const sessionItem of sessionItemsResult.rows) {
				// Check if item already exists in user cart
				const existingItemSql = `
          SELECT * FROM cart_items 
          WHERE cart_id = $1 AND product_id = $2 AND ($3::uuid IS NULL OR variant_id = $3)
        `;
				const existingItemResult = await client.query(existingItemSql, [
					userCart.id,
					sessionItem.product_id,
					sessionItem.variant_id,
				]);

				if (existingItemResult.rows.length > 0) {
					// Update existing item quantity
					const existingItem = existingItemResult.rows[0];
					const newQuantity =
						parseInt(existingItem.quantity) + parseInt(sessionItem.quantity);

					const updateSql = `
            UPDATE cart_items 
            SET quantity = $1
            WHERE id = $2
          `;
					await client.query(updateSql, [newQuantity, existingItem.id]);
				} else {
					// Add new item to user cart
					const insertSql = `
            INSERT INTO cart_items (cart_id, product_id, variant_id, quantity, price)
            VALUES ($1, $2, $3, $4, $5)
          `;
					await client.query(insertSql, [
						userCart.id,
						sessionItem.product_id,
						sessionItem.variant_id,
						sessionItem.quantity,
						sessionItem.price,
					]);
				}
			}

			// Delete session cart
			await client.query("DELETE FROM cart_items WHERE cart_id = $1", [
				sessionCart.id,
			]);
			await client.query("DELETE FROM carts WHERE id = $1", [sessionCart.id]);

			return userCart;
		});
	}

	// Validate cart items (check inventory, prices, etc.)
	static async validateCart(cartId: string): Promise<{
		isValid: boolean;
		issues: Array<{
			itemId: string;
			productId: string;
			issue:
				| "out_of_stock"
				| "insufficient_stock"
				| "price_changed"
				| "product_inactive";
			message: string;
		}>;
	}> {
		const sql = `
      SELECT 
        ci.*,
        p.is_active,
        p.price as current_price,
        p.inventory_quantity,
        p.track_inventory
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.cart_id = $1
    `;

		const result = await query(sql, [cartId]);
		const issues: any[] = [];

		for (const row of result.rows) {
			const item = this.mapRowToCartItem(row);

			// Check if product is active
			if (!row.is_active) {
				issues.push({
					itemId: item.id,
					productId: item.productId,
					issue: "product_inactive",
					message: "Product is no longer available",
				});
				continue;
			}

			// Check inventory
			if (row.track_inventory) {
				if (row.inventory_quantity <= 0) {
					issues.push({
						itemId: item.id,
						productId: item.productId,
						issue: "out_of_stock",
						message: "Product is out of stock",
					});
				} else if (row.inventory_quantity < item.quantity) {
					issues.push({
						itemId: item.id,
						productId: item.productId,
						issue: "insufficient_stock",
						message: `Only ${row.inventory_quantity} items available`,
					});
				}
			}

			// Check price changes
			const currentPrice = parseFloat(row.current_price);
			if (Math.abs(currentPrice - item.price) > 0.01) {
				issues.push({
					itemId: item.id,
					productId: item.productId,
					issue: "price_changed",
					message: `Price changed from $${item.price} to $${currentPrice}`,
				});
			}
		}

		return {
			isValid: issues.length === 0,
			issues,
		};
	}

	// Clean up old carts (for maintenance)
	static async cleanupOldCarts(daysOld: number = 30): Promise<number> {
		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - daysOld);

		return await withTransaction(
			async (client: PoolClient): Promise<number> => {
				// Get old cart IDs
				const cartsSql = `
        SELECT id FROM carts 
        WHERE updated_at < $1 AND user_id IS NULL
      `;
				const cartsResult = await client.query(cartsSql, [cutoffDate]);

				if (cartsResult.rows.length === 0) {
					return 0;
				}

				const cartIds = cartsResult.rows.map((row) => row.id);

				// Delete cart items
				const deleteItemsSql = `
        DELETE FROM cart_items 
        WHERE cart_id = ANY($1)
      `;
				await client.query(deleteItemsSql, [cartIds]);

				// Delete carts
				const deleteCartsSql = `
        DELETE FROM carts 
        WHERE id = ANY($1)
      `;
				const deleteResult = await client.query(deleteCartsSql, [cartIds]);

				return deleteResult.rowCount || 0;
			},
		);
	}

	// Helper method to map database row to Cart object
	private static mapRowToCart(row: any): Cart {
		return {
			id: row.id,
			userId: row.user_id,
			sessionId: row.session_id,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	// Helper method to map database row to CartItem object
	private static mapRowToCartItem(row: any): CartItem {
		return {
			id: row.id,
			cartId: row.cart_id,
			productId: row.product_id,
			variantId: row.variant_id,
			quantity: parseInt(row.quantity),
			price: parseFloat(row.price),
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}
}

export default CartRepository;
