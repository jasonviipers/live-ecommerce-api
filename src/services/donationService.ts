import { EventEmitter } from "events";
import { query } from "@/database/connection";
import logger from "@/config/logger";
import PaymentService from "./payment";
import { createId } from "@paralleldrive/cuid2";
import { config } from "@/config";
import { QueryResult } from "pg";
import {
	Donation,
	DonationAlert,
	DonationGoal,
	DonationStats,
	DonationTier,
	TopDonorRow,
} from "@/types";
import { getChatService } from "./chatService";

export class DonationService extends EventEmitter {
	private readonly activeDonationGoals: Map<string, DonationGoal> = new Map();
	private readonly donationTiers: DonationTier[] = [
		{
			minAmount: 1,
			maxAmount: 4.99,
			name: "Supporter",
			color: "#4CAF50",
			highlightDuration: 5,
			soundAlert: "ding.mp3",
		},
		{
			minAmount: 5,
			maxAmount: 9.99,
			name: "Fan",
			color: "#2196F3",
			highlightDuration: 8,
			soundAlert: "chime.mp3",
			animationEffect: "bounce",
		},
		{
			minAmount: 10,
			maxAmount: 24.99,
			name: "Super Fan",
			color: "#FF9800",
			highlightDuration: 12,
			soundAlert: "fanfare.mp3",
			animationEffect: "pulse",
		},
		{
			minAmount: 25,
			maxAmount: 49.99,
			name: "Champion",
			color: "#9C27B0",
			highlightDuration: 15,
			soundAlert: "celebration.mp3",
			animationEffect: "sparkle",
		},
		{
			minAmount: 50,
			name: "Legend",
			color: "#F44336",
			highlightDuration: 20,
			soundAlert: "epic.mp3",
			animationEffect: "fireworks",
			benefits: ["Special badge", "Priority chat"],
		},
	];

	private constructor() {
		super();
	}

	static async create() {
		const instance = new DonationService();
		await instance.initializeService();
		return instance;
	}

	private async initializeService(): Promise<void> {
		try {
			await this.loadActiveDonationGoals();
			this.setupCleanupIntervals();

			logger.info("Donation service initialized");
		} catch (error) {
			logger.error("Failed to initialize donation service", error as Error);
		}
	}

	async processDonation(
		streamKey: string,
		donorId: string,
		amount: number,
		currency: string = "USD",
		message?: string,
		isAnonymous: boolean = false,
	): Promise<Donation | null> {
		try {
			const streamInfo = await this.getStreamInfo(streamKey);

			if (!streamInfo) {
				throw new Error("Stream not found");
			}

			const donorInfo = await this.getDonorInfo(donorId);

			if (!donorInfo) {
				throw new Error("Donor not found");
			}

			// Validate donation amount
			if (amount < 1) {
				throw new Error("Minimum donation amount is $1");
			}

			// Create payment intent
			const paymentIntent = await PaymentService.createPaymentIntent({
				amount: Math.round(amount * 100), // Convert to cents
				orderId: `don_${createId()}`,
				currency: currency.toLowerCase(),
				metadata: {
					type: "donation",
					streamKey,
					streamerId: streamInfo.streamerId,
					donorId,
					message: message || "",
				},
			});

			// Determine donation tier
			const tier = this.getDonationTier(amount);

			// Create donation record
			const donation: Donation = {
				id: `don_${createId()}`,
				streamKey,
				streamerId: streamInfo.streamerId,
				donorId,
				donorName: isAnonymous ? "Anonymous" : donorInfo.username,
				donorAvatar: isAnonymous ? undefined : donorInfo.avatar,
				amount,
				currency,
				message,
				isAnonymous,
				isHighlighted: amount >= 5, // Highlight donations $5 and above
				highlightDuration: tier.highlightDuration,
				paymentIntentId: paymentIntent.payment.id,
				status: "pending",
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			await this.storeDonation(donation);

			logger.info("Donation created", {
				donationId: donation.id,
				streamKey,
				amount,
				currency,
				donorId,
			});

			this.emit("donationCreated", donation);
			return donation;
		} catch (error) {
			logger.error("Failed to process donation", {
				streamKey,
				donorId,
				amount,
				error,
			});
			return null;
		}
	}

	async completeDonation(paymentIntentId: string): Promise<boolean> {
		try {
			const donation = await this.getDonationByPaymentIntent(paymentIntentId);

			if (!donation) {
				logger.error("Donation not found for payment intent", {
					paymentIntentId,
				});
				return false;
			}

			// Update donation status
			donation.status = "completed";
			donation.processedAt = new Date();
			donation.updatedAt = new Date();

			await this.updateDonation(donation);

			// Update donation goals
			await this.updateDonationGoals(donation.streamKey, donation.amount);

			// Send to chat if message exists
			if (donation.message) {
				const chatService = await getChatService();
				await chatService.sendMessage(
					donation.streamKey,
					donation.donorId,
					donation.message,
					"donation",
					{
						donationAmount: donation.amount,
						currency: donation.currency,
						isHighlighted: donation.isHighlighted,
					},
				);
			}

			await this.createDonationAlert(donation);

			await this.updateStreamerEarnings(donation);

			logger.info("Donation completed", {
				donationId: donation.id,
				amount: donation.amount,
				streamKey: donation.streamKey,
			});

			this.emit("donationCompleted", donation);
			return true;
		} catch (error) {
			logger.error("Failed to complete donation", { paymentIntentId, error });
			return false;
		}
	}

	async createDonationGoal(
		streamKey: string,
		streamerId: string,
		title: string,
		targetAmount: number,
		currency: string = "USD",
		description?: string,
		endDate?: Date,
	): Promise<DonationGoal> {
		try {
			const goal: DonationGoal = {
				id: `goal_${createId()}`,
				streamKey,
				streamerId,
				title,
				description,
				targetAmount,
				currentAmount: 0,
				currency,
				isActive: true,
				startDate: new Date(),
				endDate,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			await this.storeDonationGoal(goal);

			this.activeDonationGoals.set(goal.id, goal);

			logger.info("Donation goal created", {
				goalId: goal.id,
				streamKey,
				targetAmount,
				title,
			});

			this.emit("donationGoalCreated", goal);
			return goal;
		} catch (error) {
			logger.error("Failed to create donation goal", { streamKey, error });
			throw error;
		}
	}

	private async updateDonationGoals(
		streamKey: string,
		donationAmount: number,
	): Promise<void> {
		try {
			const goals = Array.from(this.activeDonationGoals.values()).filter(
				(goal) => goal.streamKey === streamKey && goal.isActive,
			);

			for (const goal of goals) {
				const previousAmount = goal.currentAmount;
				goal.currentAmount += donationAmount;
				goal.updatedAt = new Date();

				await this.updateDonationGoal(goal);

				// Check if goal is reached
				if (
					previousAmount < goal.targetAmount &&
					goal.currentAmount >= goal.targetAmount
				) {
					await this.handleGoalReached(goal);
				}

				// Check for milestones (25%, 50%, 75%)
				const milestones = [0.25, 0.5, 0.75];
				for (const milestone of milestones) {
					const milestoneAmount = goal.targetAmount * milestone;
					if (
						previousAmount < milestoneAmount &&
						goal.currentAmount >= milestoneAmount
					) {
						await this.handleMilestoneReached(goal, milestone);
					}
				}
			}
		} catch (error) {
			logger.error("Failed to update donation goals", { streamKey, error });
		}
	}

	private async handleGoalReached(goal: DonationGoal): Promise<void> {
		try {
			// Create alert
			const alert: DonationAlert = {
				id: `alert_${createId()}`,
				streamKey: goal.streamKey,
				donationId: "", // Not tied to specific donation
				type: "goal_reached",
				title: "Goal Reached! 🎉",
				message: `"${goal.title}" goal of $${goal.targetAmount} has been reached!`,
				amount: goal.targetAmount,
				currency: goal.currency,
				duration: 15,
				isShown: false,
				createdAt: new Date(),
			};

			await this.storeDonationAlert(alert);

			// Mark goal as completed
			goal.isActive = false;
			await this.updateDonationGoal(goal);

			logger.info("Donation goal reached", {
				goalId: goal.id,
				streamKey: goal.streamKey,
				amount: goal.targetAmount,
			});

			this.emit("donationGoalReached", goal);
		} catch (error) {
			logger.error("Failed to handle goal reached", { goalId: goal.id, error });
		}
	}

	private async handleMilestoneReached(
		goal: DonationGoal,
		milestone: number,
	): Promise<void> {
		try {
			const percentage = Math.round(milestone * 100);
			const milestoneAmount = goal.targetAmount * milestone;

			const alert: DonationAlert = {
				id: `alert_${createId()}`,
				streamKey: goal.streamKey,
				donationId: "",
				type: "milestone",
				title: `${percentage}% Goal Reached! 🚀`,
				message: `"${goal.title}" is ${percentage}% complete ($${milestoneAmount.toFixed(2)})`,
				amount: milestoneAmount,
				currency: goal.currency,
				duration: 10,
				isShown: false,
				createdAt: new Date(),
			};

			await this.storeDonationAlert(alert);

			logger.info("Donation milestone reached", {
				goalId: goal.id,
				streamKey: goal.streamKey,
				milestone: percentage,
				amount: milestoneAmount,
			});

			this.emit("donationMilestoneReached", {
				goal,
				milestone,
				amount: milestoneAmount,
			});
		} catch (error) {
			logger.error("Failed to handle milestone reached", {
				goalId: goal.id,
				error,
			});
		}
	}

	async getDonationStats(
		streamKey: string,
		period: "today" | "week" | "month" | "all" = "all",
	): Promise<DonationStats> {
		try {
			let dateFilter = "";
			const values: any[] = [streamKey];

			if (period !== "all") {
				let days = 1;
				if (period === "week") days = 7;
				if (period === "month") days = 30;

				dateFilter = "AND created_at >= NOW() - INTERVAL $2 DAY";
				values.push(days);
			}

			// Get total stats
			const totalSql = `
        SELECT 
          COUNT(*) as total_donations,
          COALESCE(SUM(amount), 0) as total_amount,
          COALESCE(AVG(amount), 0) as average_donation,
          COALESCE(MAX(amount), 0) as top_donation,
          currency
        FROM donations 
        WHERE stream_key = $1 AND status = 'completed' ${dateFilter}
        GROUP BY currency
      `;
			const totalResult = await query(totalSql, values);
			const totalStats = totalResult.rows[0] || {
				total_donations: 0,
				total_amount: 0,
				average_donation: 0,
				top_donation: 0,
				currency: "USD",
			};

			// Get today's stats
			const todaySql = `
        SELECT 
          COUNT(*) as donations_today,
          COALESCE(SUM(amount), 0) as amount_today
        FROM donations 
        WHERE stream_key = $1 AND status = 'completed' 
        AND DATE(created_at) = CURRENT_DATE
      `;
			const todayResult = await query(todaySql, [streamKey]);
			const todayStats = todayResult.rows[0] || {
				donations_today: 0,
				amount_today: 0,
			};

			// Get top donors
			const topDonorsSql = `
        SELECT 
          donor_id,
          donor_name,
          SUM(amount) as total_amount,
          COUNT(*) as donation_count
        FROM donations 
        WHERE stream_key = $1 AND status = 'completed' ${dateFilter}
        GROUP BY donor_id, donor_name
        ORDER BY total_amount DESC
        LIMIT 10
      `;
			const topDonorsResult: QueryResult<TopDonorRow> = await query(
				topDonorsSql,
				values,
			);
			const topDonors = topDonorsResult.rows.map((row) => ({
				donorId: row.donor_id,
				donorName: row.donor_name,
				totalAmount: parseFloat(row.total_amount),
				donationCount: parseInt(row.donation_count),
			}));

			// Get recent donations
			const recentSql = `
        SELECT * FROM donations 
        WHERE stream_key = $1 AND status = 'completed'
        ORDER BY created_at DESC
        LIMIT 10
      `;
			const recentResult = await query(recentSql, [streamKey]);
			const recentDonations = recentResult.rows.map(this.mapRowToDonation);

			return {
				totalDonations: parseInt(totalStats.total_donations),
				totalAmount: parseFloat(totalStats.total_amount),
				currency: totalStats.currency,
				averageDonation: parseFloat(totalStats.average_donation),
				topDonation: parseFloat(totalStats.top_donation),
				donationsToday: parseInt(todayStats.donations_today),
				amountToday: parseFloat(todayStats.amount_today),
				topDonors,
				recentDonations,
			};
		} catch (error) {
			logger.error("Failed to get donation stats", { streamKey, error });
			throw error;
		}
	}

	// Get pending alerts
	async getPendingAlerts(streamKey: string): Promise<DonationAlert[]> {
		try {
			const sql = `
        SELECT * FROM donation_alerts 
        WHERE stream_key = $1 AND is_shown = false
        ORDER BY created_at ASC
      `;
			const result = await query(sql, [streamKey]);

			return result.rows.map(this.mapRowToDonationAlert);
		} catch (error) {
			logger.error("Failed to get pending alerts", { streamKey, error });
			return [];
		}
	}

	// Mark alert as shown
	async markAlertAsShown(alertId: string): Promise<boolean> {
		try {
			const sql = `
        UPDATE donation_alerts 
        SET is_shown = true, shown_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `;
			const result = await query(sql, [alertId]);

			return result.rowCount > 0;
		} catch (error) {
			logger.error("Failed to mark alert as shown", { alertId, error });
			return false;
		}
	}

	getDonationTiers(): DonationTier[] {
		return this.donationTiers.map((tier) => ({
			...tier,
		}));
	}

	// Helper methods
	private getDonationTier(amount: number): DonationTier {
		for (const tier of this.donationTiers) {
			if (
				amount >= tier.minAmount &&
				(!tier.maxAmount || amount <= tier.maxAmount)
			) {
				return tier;
			}
		}

		return this.donationTiers[this.donationTiers.length - 1]; // Return highest tier as fallback
	}

	private async getStreamInfo(
		streamKey: string,
	): Promise<{ streamerId: string } | null> {
		try {
			const sql =
				"SELECT user_id as streamer_id FROM streams WHERE stream_key = $1";
			const result = await query(sql, [streamKey]);

			return result.rows.length > 0
				? { streamerId: result.rows[0].streamer_id }
				: null;
		} catch (error) {
			logger.error("Failed to get stream info", { streamKey, error });
			return null;
		}
	}

	private async getDonorInfo(donorId: string): Promise<{
		username: string;
		avatar?: string;
	} | null> {
		try {
			const sql = "SELECT username, avatar FROM users WHERE id = $1"; // Fixed: SELECT FROM firstName and lastName instead
			const result = await query(sql, [donorId]);

			return result.rows.length > 0
				? {
						username: result.rows[0].username,
						avatar: result.rows[0].avatar,
					}
				: null;
		} catch (error) {
			logger.error("Failed to get donor info", { donorId, error });
			return null;
		}
	}

	private async storeDonation(donation: Donation): Promise<void> {
		const sql = `
      INSERT INTO donations (
        id, stream_key, streamer_id, donor_id, donor_name, donor_avatar,
        amount, currency, message, is_anonymous, is_highlighted, highlight_duration,
        payment_intent_id, status, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    `;

		const values = [
			donation.id,
			donation.streamKey,
			donation.streamerId,
			donation.donorId,
			donation.donorName,
			donation.donorAvatar || null,
			donation.amount,
			donation.currency,
			donation.message || null,
			donation.isAnonymous,
			donation.isHighlighted,
			donation.highlightDuration,
			donation.paymentIntentId,
			donation.status,
			donation.createdAt,
			donation.updatedAt,
		];

		await query(sql, values);
	}

	private async updateDonation(donation: Donation): Promise<void> {
		const sql = `
      UPDATE donations 
      SET status = $1, processed_at = $2, updated_at = $3
      WHERE id = $4
    `;

		const values = [
			donation.status,
			donation.processedAt || null,
			donation.updatedAt,
			donation.id,
		];

		await query(sql, values);
	}

	private async getDonationByPaymentIntent(
		paymentIntentId: string,
	): Promise<Donation | null> {
		try {
			const sql = "SELECT * FROM donations WHERE payment_intent_id = $1";
			const result = await query(sql, [paymentIntentId]);

			return result.rows.length > 0
				? this.mapRowToDonation(result.rows[0])
				: null;
		} catch (error) {
			logger.error("Failed to get donation by payment intent", {
				paymentIntentId,
				error,
			});
			return null;
		}
	}

	private async createDonationAlert(donation: Donation): Promise<void> {
		const tier = this.getDonationTier(donation.amount);

		const alert: DonationAlert = {
			id: `alert_${createId()}`,
			streamKey: donation.streamKey,
			donationId: donation.id,
			type: "new_donation",
			title: `${tier.name} Donation!`,
			message: `${donation.donorName} donated $${donation.amount}${donation.message ? `: "${donation.message}"` : ""}`,
			amount: donation.amount,
			currency: donation.currency,
			duration: tier.highlightDuration,
			isShown: false,
			createdAt: new Date(),
		};

		await this.storeDonationAlert(alert);
	}

	private async storeDonationAlert(alert: DonationAlert): Promise<void> {
		const sql = `
      INSERT INTO donation_alerts (
        id, stream_key, donation_id, type, title, message,
        amount, currency, duration, is_shown, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `;

		const values = [
			alert.id,
			alert.streamKey,
			alert.donationId,
			alert.type,
			alert.title,
			alert.message,
			alert.amount || null,
			alert.currency || null,
			alert.duration,
			alert.isShown,
			alert.createdAt,
		];

		await query(sql, values);
	}

	private async storeDonationGoal(goal: DonationGoal): Promise<void> {
		const sql = `
      INSERT INTO donation_goals (
        id, stream_key, streamer_id, title, description, target_amount,
        current_amount, currency, is_active, start_date, end_date,
        created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `;

		const values = [
			goal.id,
			goal.streamKey,
			goal.streamerId,
			goal.title,
			goal.description || null,
			goal.targetAmount,
			goal.currentAmount,
			goal.currency,
			goal.isActive,
			goal.startDate,
			goal.endDate || null,
			goal.createdAt,
			goal.updatedAt,
		];

		await query(sql, values);
	}

	private async updateDonationGoal(goal: DonationGoal): Promise<void> {
		const sql = `
      UPDATE donation_goals 
      SET title = $1, description = $2, target_amount = $3, end_date = $4,
          current_amount = $5, is_active = $6, updated_at = $7
      WHERE id = $8
    `;

		const values = [
			goal.title,
			goal.description || null,
			goal.targetAmount,
			goal.endDate || null,
			goal.currentAmount,
			goal.isActive,
			goal.updatedAt,
			goal.id,
		];

		await query(sql, values);

		// Update in memory
		this.activeDonationGoals.set(goal.id, goal);
	}

	private async updateStreamerEarnings(donation: Donation): Promise<void> {
		try {
			// Calculate platform fee (e.g., 5%)
			const platformFee = donation.amount * config.commission.platformFeeRate;
			const streamerEarnings = donation.amount - platformFee;

			// Update streamer balance
			const sql = `
        UPDATE vendor_balances 
        SET available_balance = available_balance + $1,
            total_earnings = total_earnings + $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $3
      `;

			await query(sql, [
				streamerEarnings,
				donation.amount,
				donation.streamerId,
			]);

			logger.info("Streamer earnings updated", {
				streamerId: donation.streamerId,
				donationAmount: donation.amount,
				earnings: streamerEarnings,
				platformFee,
			});
		} catch (error) {
			logger.error("Failed to update streamer earnings", { donation, error });
		}
	}

	private async loadActiveDonationGoals(): Promise<void> {
		try {
			const sql = "SELECT * FROM donation_goals WHERE is_active = true";
			const result = await query(sql);

			for (const row of result.rows) {
				const goal = this.mapRowToDonationGoal(row);
				this.activeDonationGoals.set(goal.id, goal);
			}

			logger.info("Loaded active donation goals", {
				count: result.rows.length,
			});
		} catch (error) {
			logger.error("Failed to load active donation goals", error as Error);
		}
	}

	private setupCleanupIntervals(): void {
		// Clean up old alerts every hour
		setInterval(
			() => {
				this.cleanupOldAlerts();
			},
			60 * 60 * 1000,
		);
	}

	private async cleanupOldAlerts(): Promise<void> {
		try {
			const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

			const sql =
				"DELETE FROM donation_alerts WHERE created_at < $1 AND is_shown = true";
			const result = await query(sql, [cutoffDate]);

			logger.info("Cleaned up old donation alerts", {
				deleted: result.rowCount,
			});
		} catch (error) {
			logger.error("Failed to cleanup old alerts", error as Error);
		}
	}

	private mapRowToDonation(row: any): Donation {
		return {
			id: row.id,
			streamKey: row.stream_key,
			streamerId: row.streamer_id,
			donorId: row.donor_id,
			donorName: row.donor_name,
			donorAvatar: row.donor_avatar,
			amount: parseFloat(row.amount),
			currency: row.currency,
			message: row.message,
			isAnonymous: row.is_anonymous,
			isHighlighted: row.is_highlighted,
			highlightDuration: row.highlight_duration,
			paymentIntentId: row.payment_intent_id,
			status: row.status,
			processedAt: row.processed_at,
			refundedAt: row.refunded_at,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	private mapRowToDonationGoal(row: any): DonationGoal {
		return {
			id: row.id,
			streamKey: row.stream_key,
			streamerId: row.streamer_id,
			title: row.title,
			description: row.description,
			targetAmount: parseFloat(row.target_amount),
			currentAmount: parseFloat(row.current_amount),
			currency: row.currency,
			isActive: row.is_active,
			startDate: row.start_date,
			endDate: row.end_date,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	private mapRowToDonationAlert(row: any): DonationAlert {
		return {
			id: row.id,
			streamKey: row.stream_key,
			donationId: row.donation_id,
			type: row.type,
			title: row.title,
			message: row.message,
			amount: row.amount ? parseFloat(row.amount) : undefined,
			currency: row.currency,
			duration: row.duration,
			isShown: row.is_shown,
			shownAt: row.shown_at,
			createdAt: row.created_at,
		};
	}

	async updateDonationGoalFields(
		goalId: string,
		updates: Partial<
			Pick<
				DonationGoal,
				"title" | "description" | "targetAmount" | "endDate" | "isActive"
			>
		>,
	): Promise<DonationGoal | null> {
		try {
			const goal = this.activeDonationGoals.get(goalId);

			if (!goal) {
				return null;
			}

			// Create updated goal with only the provided fields
			const updatedGoal: DonationGoal = {
				...goal,
				...updates,
				updatedAt: new Date(),
			};

			await this.updateDonationGoal(updatedGoal);

			return updatedGoal;
		} catch (error) {
			logger.error("Failed to update donation goal fields", {
				goalId,
				updates,
				error,
			});
			throw error;
		}
	}
}

let donationService: DonationService | null = null;

export const getDonationService = async (): Promise<DonationService> => {
	if (!donationService) {
		donationService = await DonationService.create();
	}

	return donationService;
};

export default DonationService;
