import { query } from "../database/connection";
import type { CreateUserData, UpdateUserData, User } from "../types";

export class UserRepository {
	static async create(data: CreateUserData): Promise<User> {
		const passwordHash = await Bun.password.hash(data.password);
		const sql = `
            INSERT INTO users (email, password_hash, first_name, last_name, phone, role)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `;
		const values = [
			data.email,
			passwordHash,
			data.firstName,
			data.lastName,
			data.phone,
			data.role || "customer",
		];

		const result = await query(sql, values);
		return this.mapRowToUser(result.rows[0]);
	}

	static async findById(id: string): Promise<User | null> {
		const sql = "SELECT * FROM users WHERE id = $1";
		const result = await query(sql, [id]);

		if (result.rows.length === 0) {
			return null;
		}

		return this.mapRowToUser(result.rows[0]);
	}

	static async findByEmail(email: string): Promise<User | null> {
		const sql = "SELECT * FROM users WHERE email = $1";
		const result = await query(sql, [email]);

		if (result.rows.length === 0) {
			return null;
		}

		return this.mapRowToUser(result.rows[0]);
	}

	// Find all users with pagination
	static async findAll(
		page: number = 1,
		limit: number = 20,
		filters: {
			role?: string;
			isActive?: boolean;
			search?: string;
		} = {},
	): Promise<{ users: User[]; total: number; page: number; limit: number }> {
		const offset = (page - 1) * limit;
		let whereClause = "WHERE 1=1";
		const values: any[] = [];
		let paramCount = 0;

		// Apply filters
		if (filters.role) {
			whereClause += ` AND role = $${++paramCount}`;
			values.push(filters.role);
		}

		if (filters.isActive !== undefined) {
			whereClause += ` AND is_active = $${++paramCount}`;
			values.push(filters.isActive);
		}

		if (filters.search) {
			whereClause += ` AND (first_name ILIKE $${++paramCount} OR last_name ILIKE $${++paramCount} OR email ILIKE $${++paramCount})`;
			const searchPattern = `%${filters.search}%`;
			values.push(searchPattern, searchPattern, searchPattern);
			paramCount += 2; // We added 3 parameters but only incremented once
		}

		// Get total count
		const countSql = `SELECT COUNT(*) FROM users ${whereClause}`;
		const countResult = await query(countSql, values);
		const total = parseInt(countResult.rows[0].count);

		// Get users
		const sql = `
      SELECT * FROM users 
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${++paramCount} OFFSET $${++paramCount}
    `;
		values.push(limit, offset);

		const result = await query(sql, values);
		const users = result.rows.map(this.mapRowToUser);

		return {
			users,
			total,
			page,
			limit,
		};
	}

	static async update(id: string, data: UpdateUserData): Promise<User | null> {
		const fields: string[] = [];
		const values: any[] = [];
		let paramCount = 0;

		// Build dynamic update query
		Object.entries(data).forEach(([key, value]) => {
			if (value !== undefined) {
				const dbField = this.camelToSnake(key);
				fields.push(`${dbField} = $${++paramCount}`);
				values.push(value);
			}
		});

		if (fields.length === 0) {
			return this.findById(id);
		}

		const sql = `
      UPDATE users 
      SET ${fields.join(", ")}
      WHERE id = $${++paramCount}
      RETURNING *
    `;
		values.push(id);

		const result = await query(sql, values);

		if (result.rows.length === 0) {
			return null;
		}

		return this.mapRowToUser(result.rows[0]);
	}

	static async updatePassword(
		id: string,
		newPassword: string,
	): Promise<boolean> {
		const passwordHash = await Bun.password.hash(newPassword);

		const sql = "UPDATE users SET password_hash = $1 WHERE id = $2";
		const result = await query(sql, [passwordHash, id]);

		return result.rowCount > 0;
	}

	static async verifyPassword(user: User, password: string): Promise<boolean> {
		return Bun.password.verify(password, user.passwordHash);
	}

	static async updateLastLogin(id: string): Promise<void> {
		const sql =
			"UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1";
		await query(sql, [id]);
	}

	static async verifyEmail(id: string): Promise<boolean> {
		const sql = `
      UPDATE users 
      SET email_verified = true, email_verified_at = CURRENT_TIMESTAMP 
      WHERE id = $1
    `;
		const result = await query(sql, [id]);

		return result.rowCount > 0;
	}

	// Soft delete user (deactivate)
	static async deactivate(id: string): Promise<boolean> {
		const sql = "UPDATE users SET is_active = false WHERE id = $1";
		const result = await query(sql, [id]);

		return result.rowCount > 0;
	}

	// Helper method to map database row to User object
	private static mapRowToUser(row: any): User {
		return {
			id: row.id,
			email: row.email,
			passwordHash: row.password_hash,
			firstName: row.first_name,
			lastName: row.last_name,
			phone: row.phone,
			avatarUrl: row.avatar_url,
			role: row.role,
			isActive: row.is_active,
			emailVerified: row.email_verified,
			emailVerifiedAt: row.email_verified_at,
			lastLoginAt: row.last_login_at,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	// Helper method to convert camelCase to snake_case
	private static camelToSnake(str: string): string {
		return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
	}
}
