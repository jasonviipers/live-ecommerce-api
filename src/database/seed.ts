import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { initializeDatabase, query, closeDatabase } from "./connection";
import { logger } from "@/config/logger";

interface Seed {
	id: number;
	name: string;
	filename: string;
	sql: string;
}

// Create seeds table if it doesn't exist
const createSeedsTable = async (): Promise<void> => {
	const sql = `
    CREATE TABLE IF NOT EXISTS seeds (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;

	await query(sql);
	logger.info("Seeds table created or already exists");
};

// Get executed seeds
const getExecutedSeeds = async (): Promise<string[]> => {
	const result = await query("SELECT name FROM seeds ORDER BY id");
	return result.rows.map((row: { name: string }) => row.name);
};

// Mark seed as executed
const markSeedExecuted = async (name: string): Promise<void> => {
	await query("INSERT INTO seeds (name) VALUES ($1)", [name]);
};

// Load seed files
const loadSeeds = (): Seed[] => {
	const seedsDir = join(__dirname, "seeds");
	const files = readdirSync(seedsDir)
		.filter((file) => file.endsWith(".sql"))
		.sort();

	return files.map((filename) => {
		const match = filename.match(/^(\d+)_(.+)\.sql$/);
		if (!match) {
			throw new Error(`Invalid seed filename: ${filename}`);
		}

		const [, idStr, _name] = match;
		const id = parseInt(idStr, 10);
		const sql = readFileSync(join(seedsDir, filename), "utf-8");

		return {
			id,
			name: filename.replace(".sql", ""),
			filename,
			sql,
		};
	});
};

// Run seeds
const runSeeds = async (): Promise<void> => {
	try {
		logger.info("🌱 Starting database seeding...");

		// Initialize database connection
		await initializeDatabase();

		// Create seeds table
		await createSeedsTable();

		// Get executed seeds
		const executedSeeds = await getExecutedSeeds();
		logger.info(`Found ${executedSeeds.length} executed seeds`);

		// Load seed files
		const seeds = loadSeeds();
		logger.info(`Found ${seeds.length} seed files`);

		// Filter pending seeds
		const pendingSeeds = seeds.filter(
			(seed) => !executedSeeds.includes(seed.name),
		);

		if (pendingSeeds.length === 0) {
			logger.info("✅ No pending seeds");
			return;
		}

		logger.info(`Found ${pendingSeeds.length} pending seeds`);

		// Execute pending seeds
		for (const seed of pendingSeeds) {
			logger.info(`Executing seed: ${seed.name}`);

			try {
				// Execute seed SQL
				await query(seed.sql);

				// Mark as executed
				await markSeedExecuted(seed.name);

				logger.info(`✅ Seed completed: ${seed.name}`);
			} catch (error: unknown) {
				logger.error(
					`❌ Seed failed: ${seed.name}`,
					error instanceof Error ? error : new Error(String(error)),
				);
				throw error;
			}
		}

		logger.info("✅ All seeds completed successfully");
	} catch (error: unknown) {
		logger.error(
			"❌ Seeding process failed",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw error;
	} finally {
		await closeDatabase();
	}
};

const resetSeeds = async (): Promise<void> => {
	try {
		logger.warn("🔄 Resetting seeds (this will re-run all seeds)...");

		await initializeDatabase();
		await createSeedsTable();

		// Clear seeds table
		await query("DELETE FROM seeds");
		logger.info("Cleared seeds table");

		// Re-run all seeds
		await runSeeds();

		logger.info("✅ Seeds reset completed");
	} catch (error: unknown) {
		logger.error(
			"❌ Seeds reset failed",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw error;
	}
};

// CLI interface
const main = async (): Promise<void> => {
	const command = process.argv[2];

	switch (command) {
		case "run":
		case undefined: {
			await runSeeds();
			break;
		}
		case "reset": {
			await resetSeeds();
			break;
		}
		case "status": {
			await initializeDatabase();
			await createSeedsTable();
			const executed = await getExecutedSeeds();
			const all = loadSeeds();
			const pending = all.filter((s) => !executed.includes(s.name));

			logger.info(`Executed seeds: ${executed.length}`);
			logger.info(`Pending seeds: ${pending.length}`);

			if (pending.length > 0) {
				logger.info("Pending seeds:");
				pending.forEach((s) => logger.info(`  - ${s.name}`));
			}

			await closeDatabase();
			break;
		}
		default: {
			logger.error(`Unknown command: ${command}`);
			logger.info("Available commands: run, reset, status");
			process.exit(1);
		}
	}
};

// Run if called directly
if (require.main === module) {
	main().catch((error) => {
		logger.error("Seed script failed", error);
		process.exit(1);
	});
}

export { runSeeds, resetSeeds };
