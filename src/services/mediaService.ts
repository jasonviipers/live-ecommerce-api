import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { query } from "../database/connection";
import { logger } from "../config/logger";
import { config } from "../config";
import { VideoProcessingService } from "./videoProcessor";
import { getR2Service } from "./cloudflareR2Service";
import { MediaFile, UploadOptions } from "@/types";

const execAsync = promisify(exec);
export class MediaService {
	private static readonly UPLOAD_DIR = path.join(process.cwd(), "uploads");
	private static readonly ALLOWED_IMAGE_TYPES = [
		"image/jpeg",
		"image/png",
		"image/gif",
		"image/webp",
	];
	private static readonly ALLOWED_VIDEO_TYPES = [
		"video/mp4",
		"video/webm",
		"video/mov",
		"video/avi",
	];
	private static readonly MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

	static async initialize(): Promise<void> {
		try {
			await fs.mkdir(this.UPLOAD_DIR, { recursive: true });
			await fs.mkdir(path.join(this.UPLOAD_DIR, "images"), { recursive: true });
			await fs.mkdir(path.join(this.UPLOAD_DIR, "videos"), { recursive: true });
			await fs.mkdir(path.join(this.UPLOAD_DIR, "thumbnails"), {
				recursive: true,
			});
			await fs.mkdir(path.join(this.UPLOAD_DIR, "temp"), { recursive: true });

			// Initialize video processing service
			VideoProcessingService.initialize();

			logger.info("Media service initialized");
		} catch (error) {
			logger.error("Failed to initialize media service", error as Error);
			throw error;
		}
	}

	static async uploadFile(options: UploadOptions): Promise<MediaFile> {
		try {
			// Validate file
			this.validateFile(options.file);

			// Generate unique filename and R2 key
			const fileExtension = path.extname(options.file.originalname);
			const filename = this.generateFilename(fileExtension);

			// Determine file type and folder
			const isImage = this.ALLOWED_IMAGE_TYPES.includes(options.file.mimetype);
			const isVideo = this.ALLOWED_VIDEO_TYPES.includes(options.file.mimetype);
			const folder =
				options.folder || (isImage ? "images" : isVideo ? "videos" : "files");

			// Upload to R2 by default (production-ready)
			const uploadToR2 = options.uploadToR2 !== false;
			let url: string;
			let r2Key: string | undefined;

			if (uploadToR2) {
				// Upload directly to Cloudflare R2
				const r2Service = getR2Service();
				r2Key = r2Service.generateFileKey(
					folder,
					options.file.originalname,
					options.userId,
				);

				const uploadResult = await r2Service.uploadFile(
					options.file.buffer,
					r2Key,
					{
						contentType: options.file.mimetype,
						metadata: {
							originalName: options.file.originalname,
							userId: options.userId,
							uploadedAt: new Date().toISOString(),
						},
					},
				);

				url = uploadResult.publicUrl;
			} else {
				// Fallback to local storage
				const filePath = path.join(this.UPLOAD_DIR, folder, filename);
				await fs.writeFile(filePath, options.file.buffer);
				url = `/uploads/${folder}/${filename}`;
			}

			// Create database record
			const mediaFile = await this.createMediaRecord({
				userId: options.userId,
				filename,
				originalName: options.file.originalname,
				mimeType: options.file.mimetype,
				size: options.file.size,
				url,
				r2Key,
				status: "uploading",
			});

			// Process file asynchronously
			this.processFileAsync(mediaFile.id, options.file.buffer, r2Key || url, {
				isImage,
				isVideo,
				generateThumbnail: options.generateThumbnail,
				processVideo: options.processVideo,
				maxWidth: options.maxWidth,
				maxHeight: options.maxHeight,
				quality: options.quality,
				uploadToR2,
			});

			logger.info("File uploaded successfully", {
				mediaId: mediaFile.id,
				filename,
				size: options.file.size,
				userId: options.userId,
				r2Key,
			});

			return mediaFile;
		} catch (error) {
			logger.error("Failed to upload file", error as Error);
			throw error;
		}
	}

	static async getMediaStatsByUser(userId: string): Promise<{
		totalFiles: number;
		totalSize: number;
		imageCount: number;
		videoCount: number;
		processingCount: number;
		readyCount: number;
		failedCount: number;
	}> {
		const sql = `
    SELECT 
      COUNT(*) as total_files,
      COALESCE(SUM(size), 0) as total_size,
      SUM(CASE WHEN mime_type LIKE 'image/%' THEN 1 ELSE 0 END) as image_count,
      SUM(CASE WHEN mime_type LIKE 'video/%' THEN 1 ELSE 0 END) as video_count,
      SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing_count,
      SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) as ready_count,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count
    FROM media_files
    WHERE user_id = $1
  `;
		const result = await query(sql, [userId]);

		if (result.rows.length === 0) {
			return {
				totalFiles: 0,
				totalSize: 0,
				imageCount: 0,
				videoCount: 0,
				processingCount: 0,
				readyCount: 0,
				failedCount: 0,
			};
		}

		const row = result.rows[0];
		return {
			totalFiles: parseInt(row.total_files),
			totalSize: parseInt(row.total_size),
			imageCount: parseInt(row.image_count),
			videoCount: parseInt(row.video_count),
			processingCount: parseInt(row.processing_count),
			readyCount: parseInt(row.ready_count),
			failedCount: parseInt(row.failed_count),
		};
	}

	static async getMediaById(id: string): Promise<MediaFile | null> {
		const sql = "SELECT * FROM media_files WHERE id = $1";
		const result = await query(sql, [id]);

		if (result.rows.length === 0) {
			return null;
		}

		return this.mapRowToMediaFile(result.rows[0]);
	}

	static async getMediaByUser(
		userId: string,
		page: number = 1,
		limit: number = 20,
		mimeType?: string,
	): Promise<{ files: MediaFile[]; total: number }> {
		const offset = (page - 1) * limit;
		let whereClause = "WHERE user_id = $1";
		const values: any[] = [userId];
		let paramCount = 1;

		if (mimeType) {
			whereClause += ` AND mime_type LIKE $${++paramCount}`;
			values.push(`${mimeType}%`);
		}

		// Get total count
		const countSql = `SELECT COUNT(*) FROM media_files ${whereClause}`;
		const countResult = await query(countSql, values);
		const total = parseInt(countResult.rows[0].count);

		// Get files
		const sql = `
      SELECT * FROM media_files 
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${++paramCount} OFFSET $${++paramCount}
    `;
		values.push(limit, offset);

		const result = await query(sql, values);
		const files = result.rows.map(this.mapRowToMediaFile);

		return { files, total };
	}

	static async deleteMedia(id: string, userId: string): Promise<boolean> {
		try {
			// Get media file
			const mediaFile = await this.getMediaById(id);

			if (!mediaFile || mediaFile.userId !== userId) {
				return false;
			}

			// Delete from R2 if exists
			if (mediaFile.r2Key) {
				const r2Service = getR2Service();
				await r2Service.deleteFile(mediaFile.r2Key);

				// Delete thumbnail from R2 if exists
				if (
					mediaFile.thumbnailUrl &&
					mediaFile.thumbnailUrl.includes("r2.cloudflarestorage.com")
				) {
					const thumbnailKey = this.extractR2KeyFromUrl(mediaFile.thumbnailUrl);
					if (thumbnailKey) {
						await r2Service.deleteFile(thumbnailKey);
					}
				}
			} else {
				// Delete from local storage
				const filePath = path.join(this.UPLOAD_DIR, "..", mediaFile.url);

				try {
					await fs.unlink(filePath);
				} catch (error) {
					logger.warn("Failed to delete file from disk", { filePath, error });
				}

				// Delete thumbnail if exists
				if (mediaFile.thumbnailUrl) {
					const thumbnailPath = path.join(
						this.UPLOAD_DIR,
						"..",
						mediaFile.thumbnailUrl,
					);
					try {
						await fs.unlink(thumbnailPath);
					} catch (error) {
						logger.warn("Failed to delete thumbnail from disk", {
							thumbnailPath,
							error,
						});
					}
				}
			}

			// Delete from database
			const sql = "DELETE FROM media_files WHERE id = $1 AND user_id = $2";
			const result = await query(sql, [id, userId]);

			logger.info("Media file deleted", { mediaId: id, userId });

			return result.rowCount > 0;
		} catch (error) {
			logger.error("Failed to delete media file", error as Error);
			throw error;
		}
	}

	static async processImage(
		buffer: Buffer,
		options: {
			maxWidth?: number;
			maxHeight?: number;
			quality?: number;
			format?: string;
		} = {},
	): Promise<{ buffer: Buffer; metadata: any }> {
		try {
			// Create temporary files
			const tempDir = path.join(this.UPLOAD_DIR, "temp");
			const inputPath = path.join(tempDir, `input_${Date.now()}.jpg`);
			const outputPath = path.join(tempDir, `output_${Date.now()}.jpg`);

			// Write input buffer to file
			await fs.writeFile(inputPath, buffer);

			// Build FFmpeg command for image processing
			let command = `${config.mediaServer.ffmpeg.path} -i "${inputPath}"`;

			// Add scaling if specified
			if (options.maxWidth || options.maxHeight) {
				const scale =
					options.maxWidth && options.maxHeight
						? `${options.maxWidth}:${options.maxHeight}`
						: options.maxWidth
							? `${options.maxWidth}:-1`
							: `-1:${options.maxHeight}`;
				command += ` -vf "scale=${scale}"`;
			}

			// Add quality settings
			if (options.quality) {
				command += ` -q:v ${Math.round((100 - options.quality) / 10)}`;
			}

			command += ` -y "${outputPath}"`;

			await execAsync(command);

			// Read processed file
			const processedBuffer = await fs.readFile(outputPath);

			// Get image metadata
			const metadataCommand = `${config.mediaServer.ffmpeg.probePath} -v quiet -print_format json -show_format -show_streams "${outputPath}"`;
			const { stdout } = await execAsync(metadataCommand);
			const metadata = JSON.parse(stdout);

			// Clean up temporary files
			await fs.unlink(inputPath);
			await fs.unlink(outputPath);

			return { buffer: processedBuffer, metadata };
		} catch (error) {
			logger.error("Failed to process image", error as Error);
			throw error;
		}
	}

	static async generateThumbnail(
		buffer: Buffer,
		isVideo: boolean = false,
	): Promise<Buffer> {
		try {
			const tempDir = path.join(this.UPLOAD_DIR, "temp");
			const inputPath = path.join(
				tempDir,
				`input_${Date.now()}${isVideo ? ".mp4" : ".jpg"}`,
			);
			const thumbnailPath = path.join(tempDir, `thumb_${Date.now()}.jpg`);

			// Write input buffer to file
			await fs.writeFile(inputPath, buffer);

			let command: string;

			if (isVideo) {
				// Generate video thumbnail from first frame
				command = `${config.mediaServer.ffmpeg.path} -i "${inputPath}" -ss 00:00:01 -vframes 1 -vf "scale=320:240" -y "${thumbnailPath}"`;
			} else {
				// Generate image thumbnail
				command = `${config.mediaServer.ffmpeg.path} -i "${inputPath}" -vf "scale=320:240" -y "${thumbnailPath}"`;
			}

			await execAsync(command);

			// Read thumbnail
			const thumbnailBuffer = await fs.readFile(thumbnailPath);

			// Clean up temporary files
			await fs.unlink(inputPath);
			await fs.unlink(thumbnailPath);

			return thumbnailBuffer;
		} catch (error) {
			logger.error("Failed to generate thumbnail", error as Error);
			throw error;
		}
	}

	static async getFileMetadata(buffer: Buffer, mimeType: string): Promise<any> {
		try {
			const tempDir = path.join(this.UPLOAD_DIR, "temp");
			const extension = mimeType.startsWith("video/") ? ".mp4" : ".jpg";
			const filePath = path.join(tempDir, `metadata_${Date.now()}${extension}`);

			await fs.writeFile(filePath, buffer);

			const command = `${config.mediaServer.ffmpeg.probePath} -v quiet -print_format json -show_format -show_streams "${filePath}"`;
			const { stdout } = await execAsync(command);

			await fs.unlink(filePath);

			return JSON.parse(stdout);
		} catch (error) {
			logger.error("Failed to get file metadata", error as Error);
			return null;
		}
	}

	private static validateFile(file: { mimetype: string; size: number }): void {
		if (file.size > this.MAX_FILE_SIZE) {
			throw new Error(
				`File size exceeds maximum allowed size of ${this.MAX_FILE_SIZE / 1024 / 1024}MB`,
			);
		}

		const allowedTypes = [
			...this.ALLOWED_IMAGE_TYPES,
			...this.ALLOWED_VIDEO_TYPES,
		];
		if (!allowedTypes.includes(file.mimetype)) {
			throw new Error(`File type ${file.mimetype} is not allowed`);
		}
	}

	private static generateFilename(extension: string): string {
		const timestamp = Date.now();
		const random = crypto.randomBytes(8).toString("hex");
		return `${timestamp}_${random}${extension}`;
	}

	private static async createMediaRecord(data: {
		userId: string;
		filename: string;
		originalName: string;
		mimeType: string;
		size: number;
		url: string;
		r2Key?: string;
		status: string;
	}): Promise<MediaFile> {
		const sql = `
      INSERT INTO media_files (
        user_id, filename, original_name, mime_type, size, url, r2_key, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

		const values = [
			data.userId,
			data.filename,
			data.originalName,
			data.mimeType,
			data.size,
			data.url,
			data.r2Key || null,
			data.status,
		];

		const result = await query(sql, values);
		return this.mapRowToMediaFile(result.rows[0]);
	}

	private static async updateMediaRecord(
		id: string,
		updates: {
			status?: string;
			url?: string;
			thumbnailUrl?: string;
			metadata?: any;
		},
	): Promise<void> {
		const fields: string[] = [];
		const values: any[] = [];
		let paramCount = 0;

		if (updates.status) {
			fields.push(`status = $${++paramCount}`);
			values.push(updates.status);
		}

		if (updates.url) {
			fields.push(`url = $${++paramCount}`);
			values.push(updates.url);
		}

		if (updates.thumbnailUrl) {
			fields.push(`thumbnail_url = $${++paramCount}`);
			values.push(updates.thumbnailUrl);
		}

		if (updates.metadata) {
			fields.push(`metadata = $${++paramCount}`);
			values.push(JSON.stringify(updates.metadata));
		}

		fields.push(`updated_at = CURRENT_TIMESTAMP`);

		const sql = `
      UPDATE media_files 
      SET ${fields.join(", ")}
      WHERE id = $${++paramCount}
    `;
		values.push(id);

		await query(sql, values);
	}

	private static async processFileAsync(
		mediaId: string,
		buffer: Buffer,
		fileKey: string,
		options: {
			isImage: boolean;
			isVideo: boolean;
			generateThumbnail?: boolean;
			processVideo?: boolean;
			maxWidth?: number;
			maxHeight?: number;
			quality?: number;
			uploadToR2?: boolean;
		},
	): Promise<void> {
		try {
			// Update status to processing
			await this.updateMediaRecord(mediaId, { status: "processing" });

			let processedUrl: string | undefined;
			let thumbnailUrl: string | undefined;
			let metadata: any;

			// Process image
			if (options.isImage) {
				if (options.maxWidth || options.maxHeight || options.quality) {
					const result = await this.processImage(buffer, {
						maxWidth: options.maxWidth,
						maxHeight: options.maxHeight,
						quality: options.quality,
					});

					// Upload processed image to R2
					if (options.uploadToR2) {
						const r2Service = getR2Service();
						const processedKey = fileKey.replace(/\.[^/.]+$/, "_processed.jpg");

						const uploadResult = await r2Service.uploadFile(
							result.buffer,
							processedKey,
							{
								contentType: "image/jpeg",
								metadata: {
									processed: "true",
									originalKey: fileKey,
								},
							},
						);

						processedUrl = uploadResult.publicUrl;
					}

					metadata = result.metadata;
				} else {
					metadata = await this.getFileMetadata(buffer, "image/jpeg");
				}

				// Generate thumbnail for images
				if (options.generateThumbnail) {
					const thumbnailBuffer = await this.generateThumbnail(buffer, false);

					if (options.uploadToR2) {
						const r2Service = getR2Service();
						const thumbnailKey = fileKey.replace(/\.[^/.]+$/, "_thumb.jpg");

						const uploadResult = await r2Service.uploadFile(
							thumbnailBuffer,
							thumbnailKey,
							{
								contentType: "image/jpeg",
								metadata: {
									type: "thumbnail",
									originalKey: fileKey,
								},
							},
						);

						thumbnailUrl = uploadResult.publicUrl;
					}
				}
			}

			if (options.isVideo) {
				metadata = await this.getFileMetadata(buffer, "video/mp4");

				// Add to video processing queue for transcoding
				if (options.processVideo) {
					// Save buffer to temporary file for processing
					const tempDir = path.join(this.UPLOAD_DIR, "temp");
					const tempPath = path.join(tempDir, `video_${Date.now()}.mp4`);
					await fs.writeFile(tempPath, buffer);

					// Get media file to get userId
					const mediaFile = await this.getMediaById(mediaId);
					if (mediaFile) {
						await VideoProcessingService.addProcessingJob(
							mediaFile.userId,
							tempPath,
							{
								qualities: [...config.videoProcessing.qualities],
								generateThumbnail: true,
								uploadToR2: options.uploadToR2,
								deleteOriginal: true,
							},
						);
					}
				}

				// Generate thumbnail for videos
				if (options.generateThumbnail !== false) {
					const thumbnailBuffer = await this.generateThumbnail(buffer, true);

					if (options.uploadToR2) {
						const r2Service = getR2Service();
						const thumbnailKey = fileKey.replace(/\.[^/.]+$/, "_thumb.jpg");

						const uploadResult = await r2Service.uploadFile(
							thumbnailBuffer,
							thumbnailKey,
							{
								contentType: "image/jpeg",
								metadata: {
									type: "video_thumbnail",
									originalKey: fileKey,
								},
							},
						);

						thumbnailUrl = uploadResult.publicUrl;
					}
				}
			}

			await this.updateMediaRecord(mediaId, {
				status: "ready",
				url: processedUrl || undefined,
				thumbnailUrl,
				metadata,
			});

			logger.info("File processing completed", { mediaId });
		} catch (error) {
			logger.error("File processing failed", { mediaId, error });

			// Update status to failed
			await this.updateMediaRecord(mediaId, { status: "failed" });
		}
	}

	// Helper method to extract R2 key from URL
	private static extractR2KeyFromUrl(url: string): string | null {
		const match = url.match(/\/([^\/]+)$/);
		return match ? match[1] : null;
	}

	// Helper method to map database row to MediaFile
	private static mapRowToMediaFile(row: any): MediaFile {
		return {
			id: row.id,
			userId: row.user_id,
			filename: row.filename,
			originalName: row.original_name,
			mimeType: row.mime_type,
			size: parseInt(row.size),
			url: row.url,
			r2Key: row.r2_key,
			thumbnailUrl: row.thumbnail_url,
			metadata: row.metadata,
			status: row.status,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}
}

export default MediaService;
