import fs from "node:fs/promises";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import { EventEmitter } from "node:events";
import { promisify } from "node:util";
import { exec } from "node:child_process";
import { logger } from "@/config/logger";
import { getRedisClient } from "@/database/redis";
import { query } from "@/database/connection";
import { config } from "@/config";
import { getR2Service } from "./cloudflareR2Service";

ffmpeg.setFfmpegPath(ffmpegStatic!);

const execAsync = promisify(exec);

export interface metadata {
	width: number;
	height: number;
	fps: number;
	codec: string;
	bitrate: string;
}
export interface VideoProcessingJob {
	id: string;
	userId: string;
	inputPath: string;
	outputPath?: string;
	status: "pending" | "processing" | "completed" | "failed";
	progress: number;
	qualities: string[];
	metadata?: metadata;
	error?: string;
	createdAt: Date;
	updatedAt: Date;
	completedAt?: Date;
}

export interface ProcessingOptions {
	qualities?: Array<{
		name: string;
		width: number;
		height: number;
		bitrate: string;
	}>;
	generateThumbnail?: boolean;
	uploadToR2?: boolean;
	deleteOriginal?: boolean;
	webhookUrl?: string;
	watermark?: {
		text?: string;
		image?: string;
		position?:
			| "top-left"
			| "top-right"
			| "bottom-left"
			| "bottom-right"
			| "center";
	};
}

export interface ProcessingResult {
	success: boolean;
	outputs: Array<{
		quality: string;
		path: string;
		url?: string;
		size: number;
	}>;
	thumbnail?: {
		path: string;
		url?: string;
	};
	metadata?: metadata;
	error?: string;
}

class VideoProcessingQueue extends EventEmitter {
	public jobs: Map<string, VideoProcessingJob> = new Map();
	private processing: Set<string> = new Set();
	private maxConcurrentJobs: number;

	constructor(maxConcurrentJobs: number) {
		super();
		this.maxConcurrentJobs = maxConcurrentJobs;
		this.startProcessing();
	}

	public async addJob(job: VideoProcessingJob): Promise<void> {
		const redisClient = getRedisClient();
		this.jobs.set(job.id, job);
		await this.saveJobToDatabase(job);
		await redisClient.hSet(
			"video_processing_jobs",
			job.id,
			JSON.stringify(job),
		);

		logger.info("Video processing job added to queue", {
			jobId: job.id,
			userId: job.userId,
			inputPath: job.inputPath,
		});

		this.emit("jobAdded", job);
		this.processNext();
	}

	public getJobById(jobId: string): VideoProcessingJob | undefined {
		return this.jobs.get(jobId);
	}

	public getUserJobs(userId: string): VideoProcessingJob[] {
		return Array.from(this.jobs.values()).filter(
			(job) => job.userId === userId,
		);
	}

	// Start processing queue
	private startProcessing(): void {
		setInterval(() => {
			this.processNext();
		}, 1000);

		// Load jobs from Redis on startup
		this.loadJobsFromRedis();
	}

	// Process next job in queue
	private async processNext(): Promise<void> {
		if (this.processing.size >= this.maxConcurrentJobs) {
			return;
		}

		const pendingJob = Array.from(this.jobs.values()).find(
			(job) => job.status === "pending",
		);

		if (!pendingJob) {
			return;
		}

		this.processing.add(pendingJob.id);
		await this.processJob(pendingJob);
		this.processing.delete(pendingJob.id);
	}

	// Process individual job
	private async processJob(job: VideoProcessingJob): Promise<void> {
		try {
			logger.info("Starting video processing job", { jobId: job.id });

			// Update job status
			job.status = "processing";
			job.updatedAt = new Date();
			await this.updateJob(job);

			// Process video
			const result = await VideoProcessingService.processVideo(
				job.inputPath,
				{
					qualities: [...config.videoProcessing.qualities],
					generateThumbnail: true,
					uploadToR2: true,
				},
				(progress) => {
					job.progress = progress;
					this.updateJob(job);
					this.emit("jobProgress", job);
				},
			);

			if (result.success) {
				job.status = "completed";
				job.progress = 100;
				job.completedAt = new Date();
				job.metadata = result.metadata;
			} else {
				job.status = "failed";
				job.error = result.error;
			}

			job.updatedAt = new Date();
			await this.updateJob(job);

			logger.info("Video processing job completed", {
				jobId: job.id,
				status: job.status,
				outputs: result.outputs?.length || 0,
			});

			this.emit("jobCompleted", job);
		} catch (error) {
			logger.error("Video processing job failed", {
				jobId: job.id,
				error: error as Error,
			});

			job.status = "failed";
			job.error = (error as Error).message;
			job.updatedAt = new Date();
			await this.updateJob(job);

			this.emit("jobFailed", job);
		}
	}

	async updateJob(job: VideoProcessingJob): Promise<void> {
		const redisClient = getRedisClient();
		this.jobs.set(job.id, job);
		await redisClient.hSet(
			"video_processing_jobs",
			job.id,
			JSON.stringify(job),
		);
		await this.saveJobToDatabase(job);
	}

	private async saveJobToDatabase(job: VideoProcessingJob): Promise<void> {
		const sql = `
      INSERT INTO video_processing_jobs (
        id, user_id, input_path, output_path, status, progress, 
        qualities, metadata, error, created_at, updated_at, completed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (id) DO UPDATE SET
        output_path = EXCLUDED.output_path,
        status = EXCLUDED.status,
        progress = EXCLUDED.progress,
        metadata = EXCLUDED.metadata,
        error = EXCLUDED.error,
        updated_at = EXCLUDED.updated_at,
        completed_at = EXCLUDED.completed_at
    `;

		const values = [
			job.id,
			job.userId,
			job.inputPath,
			job.outputPath || null,
			job.status,
			job.progress,
			JSON.stringify(job.qualities),
			job.metadata ? JSON.stringify(job.metadata) : null,
			job.error || null,
			job.createdAt,
			job.updatedAt,
			job.completedAt || null,
		];

		await query(sql, values);
	}

	// Load jobs from Redis
	private async loadJobsFromRedis(): Promise<void> {
		try {
			const redisClient = getRedisClient();
			const jobsData = await redisClient.hGetAll("video_processing_jobs");

			for (const [jobId, jobData] of Object.entries(jobsData)) {
				const job: VideoProcessingJob = JSON.parse(jobData);
				job.createdAt = new Date(job.createdAt);
				job.updatedAt = new Date(job.updatedAt);
				if (job.completedAt) {
					job.completedAt = new Date(job.completedAt);
				}

				this.jobs.set(jobId, job);
			}

			logger.info("Loaded video processing jobs from Redis", {
				count: this.jobs.size,
			});
		} catch (error) {
			logger.error("Failed to load jobs from Redis", error as Error);
		}
	}

	// Remove completed jobs older than specified days
	async cleanupOldJobs(days: number = 7): Promise<void> {
		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - days);
		const redisClient = getRedisClient();
		const jobsToRemove: string[] = [];

		for (const [jobId, job] of this.jobs.entries()) {
			if (
				job.status === "completed" &&
				job.completedAt &&
				job.completedAt < cutoffDate
			) {
				jobsToRemove.push(jobId);
			}
		}

		for (const jobId of jobsToRemove) {
			this.jobs.delete(jobId);
			await redisClient.hDel("video_processing_jobs", jobId);
		}

		// Also cleanup database
		const sql = `
      DELETE FROM video_processing_jobs 
      WHERE status = 'completed' AND completed_at < $1
    `;
		await query(sql, [cutoffDate]);

		logger.info("Cleaned up old video processing jobs", {
			removed: jobsToRemove.length,
			cutoffDate,
		});
	}
}

export class VideoProcessingService {
	private static queue: VideoProcessingQueue;

	// Initialize service
	static initialize(): void {
		this.queue = new VideoProcessingQueue(
			config.videoProcessing.maxConcurrentJobs,
		);

		// Setup cleanup interval
		setInterval(
			() => {
				this.queue.cleanupOldJobs();
			},
			24 * 60 * 60 * 1000,
		); // Daily cleanup

		logger.info("Video processing service initialized", {
			maxConcurrentJobs: config.videoProcessing.maxConcurrentJobs,
		});
	}

	// Add video processing job
	static async addProcessingJob(
		userId: string,
		inputPath: string,
		options: ProcessingOptions = {},
	): Promise<string> {
		const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

		const job: VideoProcessingJob = {
			id: jobId,
			userId,
			inputPath,
			status: "pending",
			progress: 0,
			qualities:
				options.qualities?.map((q) => q.name) ||
				config.videoProcessing.qualities.map((q) => q.name),
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		await this.queue.addJob(job);
		return jobId;
	}

	// Get job status
	static getJobStatus(jobId: string): VideoProcessingJob | null {
		return this.queue.getJobById(jobId) || null;
	}

	// Get user jobs
	static getUserJobs(userId: string): VideoProcessingJob[] {
		return this.queue.getUserJobs(userId);
	}

	// Process video with multiple qualities
	static async processVideo(
		inputPath: string,
		options: ProcessingOptions = {},
		progressCallback?: (progress: number) => void,
	): Promise<ProcessingResult> {
		try {
			const qualities = options.qualities || config.videoProcessing.qualities;
			const outputs: ProcessingResult["outputs"] = [];
			let thumbnail: ProcessingResult["thumbnail"] | undefined;

			// Ensure directories exist
			await fs.mkdir(config.videoProcessing.tempDir, { recursive: true });
			await fs.mkdir(config.videoProcessing.outputDir, { recursive: true });

			// Get video metadata
			const metadata = await this.getVideoMetadata(inputPath);

			progressCallback?.(10);

			// Generate thumbnail
			if (options.generateThumbnail !== false) {
				thumbnail = await this.generateVideoThumbnail(inputPath);
				progressCallback?.(20);
			}

			// Process each quality
			const totalQualities = qualities.length;
			for (let i = 0; i < qualities.length; i++) {
				const quality = qualities[i];
				const outputPath = await this.transcodeVideo(inputPath, quality);

				let url: string | undefined;
				let size = 0;

				if (outputPath) {
					const stats = await fs.stat(outputPath);
					size = stats.size;

					// Upload to R2 if requested
					if (options.uploadToR2) {
						const r2Service = getR2Service();
						const key = r2Service.generateFileKey(
							"videos",
							path.basename(outputPath),
						);
						const buffer = await fs.readFile(outputPath);

						const uploadResult = await r2Service.uploadFile(buffer, key, {
							contentType: "video/mp4",
							metadata: {
								quality: quality.name,
								originalFile: path.basename(inputPath),
							},
						});

						url = uploadResult.publicUrl;
					}

					outputs.push({
						quality: quality.name,
						path: outputPath,
						url,
						size,
					});
				}

				const progress = 20 + ((i + 1) / totalQualities) * 70;
				progressCallback?.(progress);
			}

			// Upload thumbnail to R2
			if (thumbnail && options.uploadToR2) {
				const r2Service = getR2Service();
				const key = r2Service.generateFileKey(
					"thumbnails",
					path.basename(thumbnail.path),
				);
				const buffer = await fs.readFile(thumbnail.path);

				const uploadResult = await r2Service.uploadFile(buffer, key, {
					contentType: "image/jpeg",
					metadata: {
						type: "video_thumbnail",
						originalFile: path.basename(inputPath),
					},
				});

				thumbnail.url = uploadResult.publicUrl;
			}

			progressCallback?.(100);

			// Delete original file if requested
			if (options.deleteOriginal) {
				try {
					await fs.unlink(inputPath);
				} catch (error) {
					logger.warn("Failed to delete original file", { inputPath, error });
				}
			}

			return {
				success: true,
				outputs,
				thumbnail,
				metadata,
			};
		} catch (error) {
			logger.error("Video processing failed", { inputPath, error });
			return {
				success: false,
				outputs: [],
				metadata: {
					width: 0,
					height: 0,
					bitrate: "0kb/s",
					fps: 0,
					codec: "unknown",
				},
				error: (error as Error).message,
			};
		}
	}

	// Transcode video to specific quality
	private static async transcodeVideo(
		inputPath: string,
		quality: { name: string; width: number; height: number; bitrate: string },
	): Promise<string | null> {
		try {
			const outputFilename = `${path.basename(inputPath, path.extname(inputPath))}_${quality.name}.mp4`;
			const outputPath = path.join(
				config.videoProcessing.outputDir,
				outputFilename,
			);

			const command = [
				config.mediaServer.ffmpeg.path,
				"-i",
				`"${inputPath}"`,
				"-c:v",
				"libx264",
				"-preset",
				"medium",
				"-crf",
				"23",
				"-vf",
				`scale=${quality.width}:${quality.height}`,
				"-b:v",
				quality.bitrate,
				"-c:a",
				"aac",
				"-b:a",
				"128k",
				"-movflags",
				"+faststart",
				"-y",
				`"${outputPath}"`,
			].join(" ");

			await execAsync(command);

			logger.info("Video transcoded successfully", {
				inputPath,
				outputPath,
				quality: quality.name,
			});

			return outputPath;
		} catch (error) {
			logger.error("Video transcoding failed", {
				inputPath,
				quality: quality.name,
				error,
			});
			return null;
		}
	}

	// Generate video thumbnail
	private static async generateVideoThumbnail(inputPath: string): Promise<{
		path: string;
		url?: string;
	}> {
		const thumbnailFilename = `${path.basename(inputPath, path.extname(inputPath))}_thumb.jpg`;
		const thumbnailPath = path.join(
			config.videoProcessing.outputDir,
			thumbnailFilename,
		);

		const command = [
			config.mediaServer.ffmpeg.path,
			"-i",
			`"${inputPath}"`,
			"-ss",
			"00:00:01",
			"-vframes",
			"1",
			"-vf",
			"scale=320:240",
			"-y",
			`"${thumbnailPath}"`,
		].join(" ");

		await execAsync(command);

		return {
			path: thumbnailPath,
		};
	}

	private static async getVideoMetadata(inputPath: string): Promise<any> {
		try {
			const command = `${config.mediaServer.ffmpeg.probePath} -v quiet -print_format json -show_format -show_streams "${inputPath}"`;
			const { stdout } = await execAsync(command);
			return JSON.parse(stdout);
		} catch (error) {
			logger.error("Failed to get video metadata", { inputPath, error });
			return {};
		}
	}

	static getProcessingStats(): {
		totalJobs: number;
		pendingJobs: number;
		processingJobs: number;
		completedJobs: number;
		failedJobs: number;
	} {
		const jobs = Array.from(this.queue.jobs.values());

		return {
			totalJobs: jobs.length,
			pendingJobs: jobs.filter((j) => j.status === "pending").length,
			processingJobs: jobs.filter((j) => j.status === "processing").length,
			completedJobs: jobs.filter((j) => j.status === "completed").length,
			failedJobs: jobs.filter((j) => j.status === "failed").length,
		};
	}

	static async cancelJob(jobId: string): Promise<boolean> {
		const job = this.queue.getJobById(jobId);

		if (!job || job.status === "completed") {
			return false;
		}

		job.status = "failed";
		job.error = "Cancelled by user";
		job.updatedAt = new Date();

		await this.queue.updateJob(job);

		logger.info("Video processing job cancelled", { jobId });
		return true;
	}

	// Retry failed job
	static async retryJob(jobId: string): Promise<boolean> {
		const job = this.queue.getJobById(jobId);

		if (!job || job.status !== "failed") {
			return false;
		}

		job.status = "pending";
		job.progress = 0;
		job.error = undefined;
		job.updatedAt = new Date();

		await this.queue.updateJob(job);

		logger.info("Video processing job retried", { jobId });
		return true;
	}
}
