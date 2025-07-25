import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { initializeDatabase, query, closeDatabase } from "./connection";
import { logger } from "@/config/logger";

interface Migration {
	id: number;
	name: string;
	filename: string;
	sql: string;
}

const createMigrationsTable = async (): Promise<void> => {
	const sql = `
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;

	await query(sql);
	logger.info("Migrations table created or already exists");
};

const getExecutedMigrations = async (): Promise<string[]> => {
	const result = await query("SELECT name FROM migrations ORDER BY id");
	return result.rows.map((row: any) => row.name);
};

const markMigrationExecuted = async (name: string): Promise<void> => {
	await query("INSERT INTO migrations (name) VALUES ($1)", [name]);
};

const loadMigrations = (): Migration[] => {
	const migrationsDir = join(__dirname, "migrations");
	const files = readdirSync(migrationsDir)
		.filter((file) => file.endsWith(".sql"))
		.sort();

	return files.map((filename) => {
		const match = filename.match(/^(\d+)_(.+)\.sql$/);
		if (!match) {
			throw new Error(`Invalid migration filename: ${filename}`);
		}

		const [, idStr, _name] = match;
		const id = parseInt(idStr, 10);
		const sql = readFileSync(join(migrationsDir, filename), "utf-8");

		return {
			id,
			name: filename.replace(".sql", ""),
			filename,
			sql,
		};
	});
};

const runMigrations = async (): Promise<void> => {
	try {
		logger.info("🚀 Starting database migrations...");

		// Initialize database connection
		await initializeDatabase();

		// Create migrations table
		await createMigrationsTable();

		// Get executed migrations
		const executedMigrations = await getExecutedMigrations();
		logger.info(`Found ${executedMigrations.length} executed migrations`);

		// Load migration files
		const migrations = loadMigrations();
		logger.info(`Found ${migrations.length} migration files`);

		// Filter pending migrations
		const pendingMigrations = migrations.filter(
			(migration) => !executedMigrations.includes(migration.name),
		);

		if (pendingMigrations.length === 0) {
			logger.info("✅ No pending migrations");
			return;
		}

		logger.info(`Found ${pendingMigrations.length} pending migrations`);

		// Execute pending migrations
		for (const migration of pendingMigrations) {
			logger.info(`Executing migration: ${migration.name}`);

			try {
				// Execute migration SQL
				await query(migration.sql);

				// Mark as executed
				await markMigrationExecuted(migration.name);

				logger.info(`✅ Migration completed: ${migration.name}`);
			} catch (error) {
				logger.error(`❌ Migration failed: ${migration.name}`, error as Error);
				throw error;
			}
		}

		logger.info("✅ All migrations completed successfully");
	} catch (error) {
		logger.error("❌ Migration process failed", error as Error);
		throw error;
	} finally {
		await closeDatabase();
	}
};

const rollbackMigration = async (): Promise<void> => {
	try {
		logger.info("🔄 Rolling back last migration...");

		await initializeDatabase();
		await createMigrationsTable();

		const result = await query(
			"SELECT name FROM migrations ORDER BY id DESC LIMIT 1",
		);

		if (result.rows.length === 0) {
			logger.info("No migrations to rollback");
			return;
		}

		const lastMigration = result.rows[0].name;
		logger.warn(`Rolling back migration: ${lastMigration}`);

		// Remove from migrations table
		await query("DELETE FROM migrations WHERE name = $1", [lastMigration]);

		logger.info(`✅ Rollback completed: ${lastMigration}`);
		logger.warn(
			"⚠️  Note: This only removes the migration record. Manual cleanup may be required.",
		);
	} catch (error) {
		logger.error("❌ Rollback failed", error as Error);
		throw error;
	} finally {
		await closeDatabase();
	}
};

const resetDatabase = async (): Promise<void> => {
	try {
		logger.warn("🔥 Resetting database (this will drop all tables)...");

		await initializeDatabase();

		// Drop all tables (be very careful with this!)
		const dropTablesSQL = `
      DROP SCHEMA public CASCADE;
      CREATE SCHEMA public;
      GRANT ALL ON SCHEMA public TO postgres;
      GRANT ALL ON SCHEMA public TO public;
    `;

		await query(dropTablesSQL);
		logger.info("All tables dropped");

		// Re-run all migrations
		await runMigrations();

		logger.info("✅ Database reset completed");
	} catch (error) {
		logger.error("❌ Database reset failed", error as Error);
		throw error;
	}
};

// CLI interface
const main = async (): Promise<void> => {
	const command = process.argv[2];

	switch (command) {
		case "up":
		case undefined: {
			await runMigrations();
			break;
		}
		case "rollback": {
			await rollbackMigration();
			break;
		}
		case "reset": {
			await resetDatabase();
			break;
		}
		case "status": {
			await initializeDatabase();
			await createMigrationsTable();
			const executed = await getExecutedMigrations();
			const all = loadMigrations();
			const pending = all.filter((m) => !executed.includes(m.name));

			logger.info(`Executed migrations: ${executed.length}`);
			logger.info(`Pending migrations: ${pending.length}`);

			if (pending.length > 0) {
				logger.info("Pending migrations:");
				pending.forEach((m) => logger.info(`  - ${m.name}`));
			}

			await closeDatabase();
			break;
		}
		default: {
			logger.error(`Unknown command: ${command}`);
			logger.info("Available commands: up, rollback, reset, status");
			process.exit(1);
		}
	}
};

// Run if called directly
if (require.main === module) {
	main().catch((error) => {
		logger.error("Migration script failed", error);
		process.exit(1);
	});
}

export { runMigrations, rollbackMigration, resetDatabase };
