import { query, withTransaction } from "@/database/connection";
import { CreateProductData, Product, UpdateProductData } from "@/types";
import { PoolClient } from "pg";

export class ProductRepository {
	static async create(data: CreateProductData): Promise<Product> {
		const slug = this.generateSlug(data.name);

		const sql = `
      INSERT INTO products (
        vendor_id, category_id, name, slug, description, short_description,
        sku, price, compare_price, cost_price, track_inventory, inventory_quantity,
        low_stock_threshold, weight, dimensions, images, tags, meta_title,
        meta_description, is_digital
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING *
    `;

		const values = [
			data.vendorId,
			data.categoryId,
			data.name,
			slug,
			data.description,
			data.shortDescription,
			data.sku,
			data.price,
			data.comparePrice,
			data.costPrice,
			data.trackInventory ?? true,
			data.inventoryQuantity ?? 0,
			data.lowStockThreshold ?? 10,
			data.weight,
			data.dimensions ? JSON.stringify(data.dimensions) : null,
			JSON.stringify(data.images || []),
			data.tags || [],
			data.metaTitle,
			data.metaDescription,
			data.isDigital ?? false,
		];

		const result = await query(sql, values);
		return this.mapRowToProduct(result.rows[0]);
	}

	// Find product by ID
	static async findById(id: string): Promise<Product | null> {
		const sql = "SELECT * FROM products WHERE id = $1";
		const result = await query(sql, [id]);

		if (result.rows.length === 0) {
			return null;
		}

		return this.mapRowToProduct(result.rows[0]);
	}

	// Find product by slug
	static async findBySlug(
		vendorId: string,
		slug: string,
	): Promise<Product | null> {
		const sql = "SELECT * FROM products WHERE vendor_id = $1 AND slug = $2";
		const result = await query(sql, [vendorId, slug]);

		if (result.rows.length === 0) {
			return null;
		}

		return this.mapRowToProduct(result.rows[0]);
	}

	// Find all products with pagination and filters
	static async findAll(
		page: number = 1,
		limit: number = 20,
		filters: {
			vendorId?: string;
			categoryId?: string;
			isActive?: boolean;
			isFeatured?: boolean;
			search?: string;
			tags?: string[];
			priceMin?: number;
			priceMax?: number;
			sortBy?: "created_at" | "price" | "name" | "view_count" | "like_count";
			sortOrder?: "asc" | "desc";
		} = {},
	): Promise<{
		products: Product[];
		total: number;
		page: number;
		limit: number;
	}> {
		const offset = (page - 1) * limit;
		let whereClause = "WHERE 1=1";
		const values: any[] = [];
		let paramCount = 0;

		// Apply filters
		if (filters.vendorId) {
			whereClause += ` AND vendor_id = $${++paramCount}`;
			values.push(filters.vendorId);
		}

		if (filters.categoryId) {
			whereClause += ` AND category_id = $${++paramCount}`;
			values.push(filters.categoryId);
		}

		if (filters.isActive !== undefined) {
			whereClause += ` AND is_active = $${++paramCount}`;
			values.push(filters.isActive);
		}

		if (filters.isFeatured !== undefined) {
			whereClause += ` AND is_featured = $${++paramCount}`;
			values.push(filters.isFeatured);
		}

		if (filters.search) {
			whereClause += ` AND (name ILIKE $${++paramCount} OR description ILIKE $${++paramCount} OR tags && ARRAY[$${++paramCount}])`;
			const searchPattern = `%${filters.search}%`;
			values.push(searchPattern, searchPattern, filters.search);
			paramCount += 2;
		}

		if (filters.tags && filters.tags.length > 0) {
			whereClause += ` AND tags && $${++paramCount}`;
			values.push(filters.tags);
		}

		if (filters.priceMin !== undefined) {
			whereClause += ` AND price >= $${++paramCount}`;
			values.push(filters.priceMin);
		}

		if (filters.priceMax !== undefined) {
			whereClause += ` AND price <= $${++paramCount}`;
			values.push(filters.priceMax);
		}

		// Get total count
		const countSql = `SELECT COUNT(*) FROM products ${whereClause}`;
		const countResult = await query(countSql, values);
		const total = parseInt(countResult.rows[0].count);

		// Build order clause
		const sortBy = filters.sortBy || "created_at";
		const sortOrder = filters.sortOrder || "desc";
		const orderClause = `ORDER BY ${this.camelToSnake(sortBy)} ${sortOrder.toUpperCase()}`;

		// Get products
		const sql = `
      SELECT * FROM products 
      ${whereClause}
      ${orderClause}
      LIMIT $${++paramCount} OFFSET $${++paramCount}
    `;
		values.push(limit, offset);

		const result = await query(sql, values);
		const products = result.rows.map(this.mapRowToProduct);

		return {
			products,
			total,
			page,
			limit,
		};
	}

	// Update product
	static async update(
		id: string,
		data: UpdateProductData,
	): Promise<Product | null> {
		const fields: string[] = [];
		const values: any[] = [];
		let paramCount = 0;

		// Build dynamic update query
		Object.entries(data).forEach(([key, value]) => {
			if (value !== undefined) {
				const dbField = this.camelToSnake(key);
				if (key === "dimensions" && value) {
					fields.push(`${dbField} = $${++paramCount}`);
					values.push(JSON.stringify(value));
				} else if (key === "images" && Array.isArray(value)) {
					fields.push(`${dbField} = $${++paramCount}`);
					values.push(JSON.stringify(value));
				} else if (key === "tags" && Array.isArray(value)) {
					fields.push(`${dbField} = $${++paramCount}`);
					values.push(value);
				} else {
					fields.push(`${dbField} = $${++paramCount}`);
					values.push(value);
				}
			}
		});

		if (fields.length === 0) {
			return this.findById(id);
		}

		const sql = `
      UPDATE products 
      SET ${fields.join(", ")}
      WHERE id = $${++paramCount}
      RETURNING *
    `;
		values.push(id);

		const result = await query(sql, values);

		if (result.rows.length === 0) {
			return null;
		}

		return this.mapRowToProduct(result.rows[0]);
	}

	// Update product statistics
	static async updateStats(
		id: string,
		stats: {
			viewCount?: number;
			likeCount?: number;
			shareCount?: number;
		},
	): Promise<boolean> {
		const fields: string[] = [];
		const values: any[] = [];
		let paramCount = 0;

		Object.entries(stats).forEach(([key, value]) => {
			if (value !== undefined) {
				const dbField = this.camelToSnake(key);
				fields.push(`${dbField} = $${++paramCount}`);
				values.push(value);
			}
		});

		if (fields.length === 0) {
			return false;
		}

		const sql = `
      UPDATE products 
      SET ${fields.join(", ")}
      WHERE id = $${++paramCount}
    `;
		values.push(id);

		const result = await query(sql, values);
		return result.rowCount > 0;
	}

	// Increment view count
	static async incrementViewCount(id: string): Promise<boolean> {
		const sql = "UPDATE products SET view_count = view_count + 1 WHERE id = $1";
		const result = await query(sql, [id]);
		return result.rowCount > 0;
	}

	// Update inventory
	static async updateInventory(id: string, quantity: number): Promise<boolean> {
		const sql = "UPDATE products SET inventory_quantity = $1 WHERE id = $2";
		const result = await query(sql, [quantity, id]);
		return result.rowCount > 0;
	}

	// Decrease inventory (for orders)
	static async decreaseInventory(
		id: string,
		quantity: number,
	): Promise<boolean> {
		const sql = `
      UPDATE products 
      SET inventory_quantity = inventory_quantity - $1 
      WHERE id = $2 AND inventory_quantity >= $1
    `;
		const result = await query(sql, [quantity, id]);
		return result.rowCount > 0;
	}

	// Delete product
	static async delete(id: string): Promise<boolean> {
		return withTransaction(async (client: PoolClient) => {
			const sql = "DELETE FROM products WHERE id = $1";
			const result = await client.query(sql, [id]);
			return (result.rowCount ?? 0) > 0;
		});
	}

	// Get low stock products
	static async getLowStockProducts(vendorId?: string): Promise<Product[]> {
		let sql = `
      SELECT * FROM products 
      WHERE track_inventory = true 
      AND inventory_quantity <= low_stock_threshold
      AND is_active = true
    `;
		const values: any[] = [];

		if (vendorId) {
			sql += " AND vendor_id = $1";
			values.push(vendorId);
		}

		sql += " ORDER BY inventory_quantity ASC";

		const result = await query(sql, values);
		return result.rows.map(this.mapRowToProduct);
	}

	// Get featured products
	static async getFeaturedProducts(limit: number = 10): Promise<Product[]> {
		const sql = `
      SELECT * FROM products 
      WHERE is_featured = true AND is_active = true
      ORDER BY created_at DESC
      LIMIT $1
    `;

		const result = await query(sql, [limit]);
		return result.rows.map(this.mapRowToProduct);
	}

	// Search products
	static async search(
		searchTerm: string,
		filters: {
			categoryId?: string;
			priceMin?: number;
			priceMax?: number;
			tags?: string[];
		} = {},
		page: number = 1,
		limit: number = 20,
	): Promise<{ products: Product[]; total: number }> {
		const offset = (page - 1) * limit;
		let whereClause = `
      WHERE is_active = true 
      AND (
        name ILIKE $1 
        OR description ILIKE $1 
        OR short_description ILIKE $1
        OR $2 = ANY(tags)
      )
    `;
		const values: any[] = [`%${searchTerm}%`, searchTerm];
		let paramCount = 2;

		if (filters.categoryId) {
			whereClause += ` AND category_id = $${++paramCount}`;
			values.push(filters.categoryId);
		}

		if (filters.priceMin !== undefined) {
			whereClause += ` AND price >= $${++paramCount}`;
			values.push(filters.priceMin);
		}

		if (filters.priceMax !== undefined) {
			whereClause += ` AND price <= $${++paramCount}`;
			values.push(filters.priceMax);
		}

		if (filters.tags && filters.tags.length > 0) {
			whereClause += ` AND tags && $${++paramCount}`;
			values.push(filters.tags);
		}

		// Get total count
		const countSql = `SELECT COUNT(*) FROM products ${whereClause}`;
		const countResult = await query(countSql, values);
		const total = parseInt(countResult.rows[0].count);

		// Get products
		const sql = `
      SELECT * FROM products 
      ${whereClause}
      ORDER BY 
        CASE WHEN name ILIKE $1 THEN 1 ELSE 2 END,
        view_count DESC,
        created_at DESC
      LIMIT $${++paramCount} OFFSET $${++paramCount}
    `;
		values.push(limit, offset);

		const result = await query(sql, values);
		const products = result.rows.map(this.mapRowToProduct);

		return { products, total };
	}

	// Generate slug from name
	private static generateSlug(name: string): string {
		return name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/(^-|-$)/g, "");
	}

	// Helper method to map database row to Product object
	private static mapRowToProduct(row: any): Product {
		return {
			id: row.id,
			vendorId: row.vendor_id,
			categoryId: row.category_id,
			name: row.name,
			slug: row.slug,
			description: row.description,
			shortDescription: row.short_description,
			sku: row.sku,
			price: parseFloat(row.price),
			comparePrice: row.compare_price
				? parseFloat(row.compare_price)
				: undefined,
			costPrice: row.cost_price ? parseFloat(row.cost_price) : undefined,
			trackInventory: row.track_inventory,
			inventoryQuantity: parseInt(row.inventory_quantity),
			lowStockThreshold: parseInt(row.low_stock_threshold),
			weight: row.weight ? parseFloat(row.weight) : undefined,
			dimensions: row.dimensions,
			images: JSON.parse(row.images || "[]"),
			tags: row.tags || [],
			metaTitle: row.meta_title,
			metaDescription: row.meta_description,
			isActive: row.is_active,
			isFeatured: row.is_featured,
			isDigital: row.is_digital,
			viewCount: parseInt(row.view_count),
			likeCount: parseInt(row.like_count),
			shareCount: parseInt(row.share_count),
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	// Helper method to convert camelCase to snake_case
	private static camelToSnake(str: string): string {
		return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
	}
}

export default ProductRepository;
