import { query, withTransaction } from "../database/connection";
import { PoolClient } from "pg";
import type { CreateVendorData, UpdateVendorData, Vendor } from "../types";

export class VendorRepository {
	// Create a new vendor
	static async create(data: CreateVendorData): Promise<Vendor> {
		const sql = `
      INSERT INTO vendors (
        user_id, business_name, business_type, description, 
        logo_url, banner_url, website_url, address, tax_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

		const values = [
			data.userId,
			data.businessName,
			data.businessType,
			data.description,
			data.logoUrl,
			data.bannerUrl,
			data.websiteUrl,
			data.address ? JSON.stringify(data.address) : null,
			data.taxId,
		];

		const result = await query(sql, values);
		return this.mapRowToVendor(result.rows[0]);
	}

	// Find vendor by ID
	static async findById(id: string): Promise<Vendor | null> {
		const sql = "SELECT * FROM vendors WHERE id = $1";
		const result = await query(sql, [id]);

		if (result.rows.length === 0) {
			return null;
		}

		return this.mapRowToVendor(result.rows[0]);
	}

	// Find vendor by user ID
	static async findByUserId(userId: string): Promise<Vendor | null> {
		const sql = "SELECT * FROM vendors WHERE user_id = $1";
		const result = await query(sql, [userId]);

		if (result.rows.length === 0) {
			return null;
		}

		return this.mapRowToVendor(result.rows[0]);
	}

	// Find all vendors with pagination
	static async findAll(
		page: number = 1,
		limit: number = 20,
		filters: {
			isActive?: boolean;
			isVerified?: boolean;
			search?: string;
			businessType?: string;
		} = {},
	): Promise<{
		vendors: Vendor[];
		total: number;
		page: number;
		limit: number;
	}> {
		const offset = (page - 1) * limit;
		let whereClause = "WHERE 1=1";
		const values: any[] = [];
		let paramCount = 0;

		// Apply filters
		if (filters.isActive !== undefined) {
			whereClause += ` AND is_active = $${++paramCount}`;
			values.push(filters.isActive);
		}

		if (filters.isVerified !== undefined) {
			whereClause += ` AND is_verified = $${++paramCount}`;
			values.push(filters.isVerified);
		}

		if (filters.businessType) {
			whereClause += ` AND business_type = $${++paramCount}`;
			values.push(filters.businessType);
		}

		if (filters.search) {
			whereClause += ` AND (business_name ILIKE $${++paramCount} OR description ILIKE $${++paramCount})`;
			const searchPattern = `%${filters.search}%`;
			values.push(searchPattern, searchPattern);
			paramCount += 1; // We added 2 parameters but only incremented once
		}

		// Get total count
		const countSql = `SELECT COUNT(*) FROM vendors ${whereClause}`;
		const countResult = await query(countSql, values);
		const total = parseInt(countResult.rows[0].count);

		// Get vendors
		const sql = `
      SELECT * FROM vendors 
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${++paramCount} OFFSET $${++paramCount}
    `;
		values.push(limit, offset);

		const result = await query(sql, values);
		const vendors = result.rows.map(this.mapRowToVendor);

		return {
			vendors,
			total,
			page,
			limit,
		};
	}

	static async update(
		id: string,
		data: UpdateVendorData,
	): Promise<Vendor | null> {
		const fields: string[] = [];
		const values: any[] = [];
		let paramCount = 0;

		// Build dynamic update query
		Object.entries(data).forEach(([key, value]) => {
			if (value !== undefined) {
				const dbField = this.camelToSnake(key);
				if (key === "address" && value) {
					fields.push(`${dbField} = $${++paramCount}`);
					values.push(JSON.stringify(value));
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
      UPDATE vendors 
      SET ${fields.join(", ")}
      WHERE id = $${++paramCount}
      RETURNING *
    `;
		values.push(id);

		const result = await query(sql, values);

		if (result.rows.length === 0) {
			return null;
		}

		return this.mapRowToVendor(result.rows[0]);
	}

	// Update vendor statistics
	static async updateStats(
		id: string,
		stats: {
			totalSales?: number;
			totalOrders?: number;
			rating?: number;
			reviewCount?: number;
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
      UPDATE vendors 
      SET ${fields.join(", ")}
      WHERE id = $${++paramCount}
    `;
		values.push(id);

		const result = await query(sql, values);
		return result.rowCount > 0;
	}

	// Verify vendor
	static async verify(id: string): Promise<boolean> {
		const sql = "UPDATE vendors SET is_verified = true WHERE id = $1";
		const result = await query(sql, [id]);

		return result.rowCount > 0;
	}

	// Deactivate vendor
	static async deactivate(id: string): Promise<boolean> {
		const sql = "UPDATE vendors SET is_active = false WHERE id = $1";
		const result = await query(sql, [id]);

		return result.rowCount > 0;
	}

	// Delete vendor
	static async delete(id: string): Promise<boolean> {
		return withTransaction(async (client: PoolClient) => {
			// Delete related data first (if needed)
			// This is handled by CASCADE constraints in the schema

			const sql = "DELETE FROM vendors WHERE id = $1";
			const result = await client.query(sql, [id]);

			return (result.rowCount ?? 0) > 0;
		});
	}

	// Get vendor statistics
	static async getStats(): Promise<{
		total: number;
		active: number;
		verified: number;
		totalSales: number;
		totalOrders: number;
	}> {
		const sql = `
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE is_active = true) as active,
        COUNT(*) FILTER (WHERE is_verified = true) as verified,
        COALESCE(SUM(total_sales), 0) as total_sales,
        COALESCE(SUM(total_orders), 0) as total_orders
      FROM vendors
    `;

		const result = await query(sql);
		const row = result.rows[0];

		return {
			total: parseInt(row.total),
			active: parseInt(row.active),
			verified: parseInt(row.verified),
			totalSales: parseFloat(row.total_sales),
			totalOrders: parseInt(row.total_orders),
		};
	}

	// Get top vendors by sales
	static async getTopVendors(limit: number = 10): Promise<Vendor[]> {
		const sql = `
      SELECT * FROM vendors 
      WHERE is_active = true AND is_verified = true
      ORDER BY total_sales DESC, rating DESC
      LIMIT $1
    `;

		const result = await query(sql, [limit]);
		return result.rows.map(this.mapRowToVendor);
	}

	// Helper method to map database row to Vendor object
	private static mapRowToVendor(row: any): Vendor {
		return {
			id: row.id,
			userId: row.user_id,
			businessName: row.business_name,
			businessType: row.business_type,
			description: row.description,
			logoUrl: row.logo_url,
			bannerUrl: row.banner_url,
			websiteUrl: row.website_url,
			address: row.address,
			taxId: row.tax_id,
			commissionRate: parseFloat(row.commission_rate),
			isVerified: row.is_verified,
			isActive: row.is_active,
			totalSales: parseFloat(row.total_sales),
			totalOrders: parseInt(row.total_orders),
			rating: parseFloat(row.rating),
			reviewCount: parseInt(row.review_count),
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	// Helper method to convert camelCase to snake_case
	private static camelToSnake(str: string): string {
		return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
	}
}

export default VendorRepository;
