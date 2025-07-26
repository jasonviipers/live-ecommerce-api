import { query, withTransaction } from "@/database/connection";
import type {
	CreateOrderData,
	Order,
	OrderItem,
	OrderItemRow,
	OrderRow,
	UpdateOrderData,
} from "@/types";
import type { PoolClient } from "pg";

export async function create(data: CreateOrderData): Promise<Order> {
	return withTransaction(async (client: PoolClient) => {
		const orderNumber = await generateOrderNumber(client);

		// Calculate totals
		const subtotal = data.items.reduce(
			(sum, item) => sum + item.price * item.quantity,
			0,
		);
		const taxAmount = data.taxAmount || 0;
		const shippingAmount = data.shippingAmount || 0;
		const discountAmount = data.discountAmount || 0;
		const totalAmount = subtotal + taxAmount + shippingAmount - discountAmount;

		// Create order
		const orderSql = `
        INSERT INTO orders (
          order_number, user_id, vendor_id, subtotal, tax_amount,
          shipping_amount, discount_amount, total_amount, shipping_address,
          billing_address, notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `;

		const orderValues = [
			orderNumber,
			data.userId,
			data.vendorId,
			subtotal,
			taxAmount,
			shippingAmount,
			discountAmount,
			totalAmount,
			data.shippingAddress ? JSON.stringify(data.shippingAddress) : null,
			data.billingAddress ? JSON.stringify(data.billingAddress) : null,
			data.notes,
		];

		const orderResult = await client.query(orderSql, orderValues);
		const order = orderResult.rows[0];

		// Create order items
		for (const item of data.items) {
			// Get product details
			const productSql = "SELECT name, sku FROM products WHERE id = $1";
			const productResult = await client.query(productSql, [item.productId]);
			const product = productResult.rows[0];

			let variantName = null;
			let variantSku = null;
			if (item.variantId) {
				const variantSql =
					"SELECT name, sku FROM product_variants WHERE id = $1";
				const variantResult = await client.query(variantSql, [item.variantId]);
				if (variantResult.rows.length > 0) {
					variantName = variantResult.rows[0].name;
					variantSku = variantResult.rows[0].sku;
				}
			}

			const itemSql = `
          INSERT INTO order_items (
            order_id, product_id, variant_id, product_name, variant_name,
            sku, quantity, price, total
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `;

			const itemValues = [
				order.id,
				item.productId,
				item.variantId,
				product.name,
				variantName,
				variantSku || product.sku,
				item.quantity,
				item.price,
				item.price * item.quantity,
			];

			await client.query(itemSql, itemValues);
		}

		return mapRowToOrder(order);
	});
}

export async function findById(id: string): Promise<Order | null> {
	const sql = "SELECT * FROM orders WHERE id = $1";
	const result = await query(sql, [id]);

	if (result.rows.length === 0) {
		return null;
	}

	return mapRowToOrder(result.rows[0]);
}

export async function findByOrderNumber(
	orderNumber: string,
): Promise<Order | null> {
	const sql = "SELECT * FROM orders WHERE order_number = $1";
	const result = await query(sql, [orderNumber]);

	if (result.rows.length === 0) {
		return null;
	}

	return mapRowToOrder(result.rows[0]);
}

export async function findAll(
	page: number = 1,
	limit: number = 20,
	filters: {
		userId?: string;
		vendorId?: string;
		status?: string;
		paymentStatus?: string;
		dateFrom?: Date;
		dateTo?: Date;
	} = {},
): Promise<{ orders: Order[]; total: number; page: number; limit: number }> {
	const offset = (page - 1) * limit;
	let whereClause = "WHERE 1=1";
	const values: (string | number | Date | boolean)[] = [];
	let paramCount = 0;

	if (filters.userId) {
		whereClause += ` AND user_id = $${++paramCount}`;
		values.push(filters.userId);
	}

	if (filters.vendorId) {
		whereClause += ` AND vendor_id = $${++paramCount}`;
		values.push(filters.vendorId);
	}

	if (filters.status) {
		whereClause += ` AND status = $${++paramCount}`;
		values.push(filters.status);
	}

	if (filters.paymentStatus) {
		whereClause += ` AND payment_status = $${++paramCount}`;
		values.push(filters.paymentStatus);
	}

	if (filters.dateFrom) {
		whereClause += ` AND created_at >= $${++paramCount}`;
		values.push(filters.dateFrom);
	}

	if (filters.dateTo) {
		whereClause += ` AND created_at <= $${++paramCount}`;
		values.push(filters.dateTo);
	}

	const countSql = `SELECT COUNT(*) FROM orders ${whereClause}`;
	const countResult = await query(countSql, values);
	const total = parseInt(countResult.rows[0].count);

	const sql = `
				SELECT * FROM orders 
				${whereClause}
				ORDER BY created_at DESC
				LIMIT $${++paramCount} OFFSET $${++paramCount}
		`;
	values.push(limit, offset);

	const result = await query(sql, values);
	const orders = result.rows.map(mapRowToOrder);

	return {
		orders,
		total,
		page,
		limit,
	};
}

export async function getOrderItems(orderId: string): Promise<OrderItem[]> {
	const sql =
		"SELECT * FROM order_items WHERE order_id = $1 ORDER BY created_at";
	const result = await query(sql, [orderId]);

	return result.rows.map(mapRowToOrderItem);
}

export async function update(
	id: string,
	data: UpdateOrderData,
): Promise<Order | null> {
	const fields: string[] = [];
	const values: (string | number | Date | boolean)[] = [];
	let paramCount = 0;

	// Build dynamic update query
	Object.entries(data).forEach(([key, value]) => {
		if (value !== undefined) {
			const dbField = camelToSnake(key);
			fields.push(`${dbField} = $${++paramCount}`);
			values.push(value);
		}
	});

	if (fields.length === 0) {
		return findById(id);
	}

	const sql = `
      UPDATE orders 
      SET ${fields.join(", ")}
      WHERE id = $${++paramCount}
      RETURNING *
    `;
	values.push(id);

	const result = await query(sql, values);

	if (result.rows.length === 0) {
		return null;
	}

	return mapRowToOrder(result.rows[0]);
}

export async function updateStatus(
	id: string,
	status: Order["status"],
): Promise<boolean> {
	const updates: UpdateOrderData = { status };

	// Set timestamps based on status
	if (status === "shipped") {
		updates.shippedAt = new Date();
	} else if (status === "delivered") {
		updates.deliveredAt = new Date();
	}

	const result = await update(id, updates);
	return result !== null;
}

export async function updatePaymentStatus(
	id: string,
	paymentStatus: Order["paymentStatus"],
): Promise<boolean> {
	const result = await update(id, { paymentStatus });
	return result !== null;
}

export async function cancel(id: string, reason?: string): Promise<boolean> {
	return withTransaction(async (client: PoolClient) => {
		// Update order status
		const orderSql = `
        UPDATE orders 
        SET status = 'cancelled', notes = COALESCE(notes || ' | ', '') || $1
        WHERE id = $2 AND status IN ('pending', 'confirmed')
      `;
		const orderResult = await client.query(orderSql, [
			`Cancelled: ${reason || "No reason provided"}`,
			id,
		]);

		if (orderResult.rowCount === 0) {
			return false;
		}

		// Restore inventory for order items
		const itemsSql =
			"SELECT product_id, quantity FROM order_items WHERE order_id = $1";
		const itemsResult = await client.query(itemsSql, [id]);

		for (const item of itemsResult.rows) {
			const restoreSql = `
          UPDATE products 
          SET inventory_quantity = inventory_quantity + $1 
          WHERE id = $2 AND track_inventory = true
        `;
			await client.query(restoreSql, [item.quantity, item.product_id]);
		}

		return true;
	});
}

// Get order statistics
export async function getStats(
	filters: { vendorId?: string; dateFrom?: Date; dateTo?: Date } = {},
): Promise<{
	totalOrders: number;
	totalRevenue: number;
	averageOrderValue: number;
	ordersByStatus: Record<string, number>;
}> {
	let whereClause = "WHERE 1=1";
	const values: (string | Date)[] = [];
	let paramCount = 0;

	if (filters.vendorId) {
		whereClause += ` AND vendor_id = $${++paramCount}`;
		values.push(filters.vendorId);
	}

	if (filters.dateFrom) {
		whereClause += ` AND created_at >= $${++paramCount}`;
		values.push(filters.dateFrom);
	}

	if (filters.dateTo) {
		whereClause += ` AND created_at <= $${++paramCount}`;
		values.push(filters.dateTo);
	}

	const sql = `
      SELECT 
        COUNT(*) as total_orders,
        COALESCE(SUM(total_amount), 0) as total_revenue,
        COALESCE(AVG(total_amount), 0) as average_order_value,
        COUNT(*) FILTER (WHERE status = 'pending') as pending_orders,
        COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed_orders,
        COUNT(*) FILTER (WHERE status = 'processing') as processing_orders,
        COUNT(*) FILTER (WHERE status = 'shipped') as shipped_orders,
        COUNT(*) FILTER (WHERE status = 'delivered') as delivered_orders,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_orders,
        COUNT(*) FILTER (WHERE status = 'refunded') as refunded_orders
      FROM orders ${whereClause}
    `;

	const result = await query(sql, values);
	const row = result.rows[0];

	return {
		totalOrders: parseInt(row.total_orders),
		totalRevenue: parseFloat(row.total_revenue),
		averageOrderValue: parseFloat(row.average_order_value),
		ordersByStatus: {
			pending: parseInt(row.pending_orders),
			confirmed: parseInt(row.confirmed_orders),
			processing: parseInt(row.processing_orders),
			shipped: parseInt(row.shipped_orders),
			delivered: parseInt(row.delivered_orders),
			cancelled: parseInt(row.cancelled_orders),
			refunded: parseInt(row.refunded_orders),
		},
	};
}

// Generate unique order number
async function generateOrderNumber(client: PoolClient): Promise<string> {
	const prefix = "ORD";
	const timestamp = Date.now().toString().slice(-8);
	const random = Math.floor(Math.random() * 1000)
		.toString()
		.padStart(3, "0");

	let orderNumber = `${prefix}-${timestamp}-${random}`;

	// Ensure uniqueness
	const checkSql = "SELECT id FROM orders WHERE order_number = $1";
	const checkResult = await client.query(checkSql, [orderNumber]);

	if (checkResult.rows.length > 0) {
		// If collision, add more randomness
		const extraRandom = Math.floor(Math.random() * 100)
			.toString()
			.padStart(2, "0");
		orderNumber = `${prefix}-${timestamp}-${random}-${extraRandom}`;
	}

	return orderNumber;
}

function mapRowToOrder(row: OrderRow): Order {
	return {
		id: row.id,
		orderNumber: row.order_number,
		userId: row.user_id,
		vendorId: row.vendor_id,
		status: row.status as Order["status"],
		paymentStatus: row.payment_status as Order["paymentStatus"],
		subtotal: parseFloat(row.subtotal),
		taxAmount: parseFloat(row.tax_amount),
		shippingAmount: parseFloat(row.shipping_amount),
		discountAmount: parseFloat(row.discount_amount),
		totalAmount: parseFloat(row.total_amount),
		currency: row.currency,
		shippingAddress: row.shipping_address
			? JSON.parse(row.shipping_address)
			: null,
		billingAddress: row.billing_address
			? JSON.parse(row.billing_address)
			: null,
		notes: row.notes || undefined,
		shippedAt: row.shipped_at || undefined,
		deliveredAt: row.delivered_at || undefined,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function mapRowToOrderItem(row: OrderItemRow): OrderItem {
	return {
		id: row.id,
		orderId: row.order_id,
		productId: row.product_id,
		variantId: row.variant_id || undefined,
		productName: row.product_name,
		variantName: row.variant_name || undefined,
		sku: row.sku,
		quantity: parseInt(row.quantity),
		price: parseFloat(row.price),
		total: parseFloat(row.total),
		createdAt: row.created_at,
	};
}

// Helper function to convert camelCase to snake_case
function camelToSnake(str: string): string {
	return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

const OrderRepository = {
	create,
	findById,
	findByOrderNumber,
	findAll,
	getOrderItems,
	update,
	updateStatus,
	updatePaymentStatus,
	cancel,
	getStats,
};

export default OrderRepository;
