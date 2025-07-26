import { query } from "@/database/connection";
import EmailService from "@/services/emailService";
import type { CreateUserData, UpdateUserData, User, UserRow } from "@/types";
import { generateOtp } from "@/utils/utils";

// Helper function to map database row to User object
function mapRowToUser(row: UserRow): User {
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

// Helper function to convert camelCase to snake_case
function camelToSnake(str: string): string {
	return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export async function create(data: CreateUserData): Promise<User> {
	const optCode = generateOtp(6);
	const optCodeExpiresAt = new Date();
	optCodeExpiresAt.setMinutes(optCodeExpiresAt.getMinutes() + 15); // Expires in 15 minutes
	const passwordHash = await Bun.password.hash(data.password);
	const sql = `
        INSERT INTO users (email, password_hash, first_name, last_name, phone, role, opt_code, opt_code_expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
    `;
	const values = [
		data.email,
		passwordHash,
		data.firstName,
		data.lastName,
		data.phone,
		data.role || "customer",
		optCode,
		optCodeExpiresAt,
	];

	const result = await query(sql, values);
	const user = mapRowToUser(result.rows[0]);
	try {
		await EmailService.sendOtpEmail({
			email: user.email,
			firstName: user.firstName,
			lastName: user.lastName,
			optCode,
		});
	} catch (error) {
		console.error("Failed to send OTP email:", error);
	}

	return user;
}

export async function findByOptCode(
	optCode: string,
): Promise<User | undefined> {
	const sql =
		"SELECT * FROM users WHERE opt_code = $1 AND opt_code_expires_at > CURRENT_TIMESTAMP";
	const result = await query(sql, [optCode]);

	if (result.rows.length === 0) {
		return undefined;
	}

	return mapRowToUser(result.rows[0]);
}

export async function findById(id: string): Promise<User | null> {
	const sql = "SELECT * FROM users WHERE id = $1";
	const result = await query(sql, [id]);

	if (result.rows.length === 0) {
		return null;
	}

	return mapRowToUser(result.rows[0]);
}

export async function findByEmail(email: string): Promise<User | null> {
	const sql = "SELECT * FROM users WHERE email = $1";
	const result = await query(sql, [email]);

	if (result.rows.length === 0) {
		return null;
	}

	return mapRowToUser(result.rows[0]);
}

// Find all users with pagination
export async function findAll(
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
	const values: (string | boolean | number)[] = [];
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
	const users = result.rows.map(mapRowToUser);

	return {
		users,
		total,
		page,
		limit,
	};
}

export async function update(
	id: string,
	data: UpdateUserData,
): Promise<User | null> {
	const fields = Object.keys(data).filter(
		(key) => data[key as keyof UpdateUserData] !== undefined,
	);
	const values: (string | boolean | Date | undefined)[] = [];

	const setClause = fields
		.map((field, index) => `${camelToSnake(field)} = $${index + 1}`)
		.join(", ");
	// Build dynamic update query
	fields.forEach((field) => {
		const value = data[field as keyof UpdateUserData];
		values.push(value);
	});

	if (fields.length === 0) {
		return findById(id);
	}

	const sql = `
		UPDATE users 
		SET ${setClause}
		WHERE id = $${fields.length + 1}
		RETURNING *
		`;

	values.push(id);

	const result = await query(sql, values);

	if (result.rows.length === 0) {
		return null;
	}

	return mapRowToUser(result.rows[0]);
}

export async function updatePassword(
	id: string,
	newPassword: string,
): Promise<boolean> {
	const passwordHash = await Bun.password.hash(newPassword);

	const sql = "UPDATE users SET password_hash = $1 WHERE id = $2";
	const result = await query(sql, [passwordHash, id]);

	return (result.rowCount ?? 0) > 0;
}

export async function verifyPassword(
	user: User,
	password: string,
): Promise<boolean> {
	return Bun.password.verify(password, user.passwordHash);
}

export async function updateLastLogin(id: string): Promise<void> {
	const sql =
		"UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1";
	await query(sql, [id]);
}

export async function verifyEmail(id: string): Promise<boolean> {
	const sql = `
  UPDATE users 
  SET email_verified = true, email_verified_at = CURRENT_TIMESTAMP 
  WHERE id = $1
`;
	const result = await query(sql, [id]);

	return (result.rowCount ?? 0) > 0;
}

// Soft delete user (deactivate)
export async function deactivate(id: string): Promise<boolean> {
	const sql = "UPDATE users SET is_active = false WHERE id = $1";
	const result = await query(sql, [id]);

	return (result.rowCount ?? 0) > 0;
}

// Backward compatibility - export an object with all methods for existing imports
export const UserRepository = {
	create,
	findByOptCode,
	findById,
	findByEmail,
	findAll,
	update,
	updatePassword,
	verifyPassword,
	updateLastLogin,
	verifyEmail,
	deactivate,
};

export default UserRepository;
