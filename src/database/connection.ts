import { Pool, PoolClient } from "pg";
import { config } from "../config";
import { logger } from "../config/logger";

// PostgreSQL connection pool
let pool: Pool | null = null;

export const initializeDatabase = async (): Promise<Pool> => {
	if (pool) {
		return pool;
	}

	try {
		pool = new Pool({
			connectionString: config.database.url,
			host: config.database.host,
			port: config.database.port,
			database: config.database.name,
			user: config.database.user,
			password: config.database.password,
			ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
			max: config.database.maxConnections,
			idleTimeoutMillis: config.database.idleTimeoutMillis,
			connectionTimeoutMillis: config.database.connectionTimeoutMillis,
		});

		// Test connection
		const client = await pool.connect();
		await client.query("SELECT NOW()");
		client.release();

		logger.info("✅ PostgreSQL connected successfully");

		// Handle pool errors
		pool.on("error", (err) => {
			logger.error("PostgreSQL pool error", err);
		});

		return pool;
	} catch (error) {
		logger.error("❌ Failed to connect to PostgreSQL", error as Error);
		throw error;
	}
};

export const getDatabase = (): Pool => {
	if (!pool) {
		throw new Error(
			"Database not initialized. Call initializeDatabase() first.",
		);
	}
	return pool;
};

export const closeDatabase = async (): Promise<void> => {
	if (pool) {
		await pool.end();
		pool = null;
		logger.info("PostgreSQL connection closed");
	}
};

// Query helper function
export const query = async (text: string, params?: any[]): Promise<any> => {
	const db = getDatabase();
	const start = Date.now();

	try {
		const result = await db.query(text, params);
		const duration = Date.now() - start;

		logger.debug("Database query executed", {
			query: text,
			duration: `${duration}ms`,
			rows: result.rowCount,
		});

		return result;
	} catch (error) {
		const duration = Date.now() - start;
		logger.error("Database query failed", error as Error, {
			query: text,
			params,
			duration: `${duration}ms`,
		});
		throw error;
	}
};

// Transaction helper
export const withTransaction = async <T>(
	callback: (client: PoolClient) => Promise<T>,
): Promise<T> => {
	const db = getDatabase();
	const client = await db.connect();

	try {
		await client.query("BEGIN");
		const result = await callback(client);
		await client.query("COMMIT");
		return result;
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
};

// Health check
export const checkDatabaseHealth = async (): Promise<boolean> => {
	try {
		const result = await query("SELECT 1 as health");
		return result.rows.length > 0;
	} catch (error) {
		logger.error("Database health check failed", error as Error);
		return false;
	}
};

export default {
	initializeDatabase,
	getDatabase,
	closeDatabase,
	query,
	withTransaction,
	checkDatabaseHealth,
};
