import {
	S3Client,
	PutObjectCommand,
	GetObjectCommand,
	DeleteObjectCommand,
	HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";
import { Readable } from "node:stream";
import crypto from "node:crypto";
import path from "node:path";
import { logger } from "@/config/logger";
import { config } from "@/config";
import { query } from "@/database/connection";

export interface UploadResult {
	key: string;
	url: string;
	publicUrl: string;
	size: number;
	etag?: string;
}

export interface PresignedUrlOptions {
	expiresIn?: number;
	contentType?: string;
	contentLength?: number;
}

export interface CloudflareR2Config {
	accountId: string;
	accessKeyId: string;
	secretAccessKey: string;
	bucketName: string;
	publicDomain?: string;
	region?: string;
}

export class CloudflareR2Service {
	private s3Client: S3Client;
	private bucketName: string;
	private publicDomain?: string;

	constructor(config: CloudflareR2Config) {
		this.bucketName = config.bucketName;
		this.publicDomain = config.publicDomain;

		// Initialize S3 client for Cloudflare R2
		this.s3Client = new S3Client({
			region: config.region || "auto",
			endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
			credentials: {
				accessKeyId: config.accessKeyId,
				secretAccessKey: config.secretAccessKey,
			},
			forcePathStyle: true,
		});

		logger.info("Cloudflare R2 service initialized", {
			bucketName: this.bucketName,
			accountId: config.accountId,
		});
	}

	async uploadFile(
		buffer: Buffer,
		key: string,
		options: {
			contentType?: string;
			metadata?: Record<string, string>;
			cacheControl?: string;
			contentDisposition?: string;
		} = {},
	): Promise<UploadResult> {
		try {
			const upload = new Upload({
				client: this.s3Client,
				params: {
					Bucket: this.bucketName,
					Key: key,
					Body: buffer,
					ContentType: options.contentType || "application/octet-stream",
					Metadata: options.metadata,
					CacheControl: options.cacheControl || "public, max-age=31536000",
					ContentDisposition: options.contentDisposition,
				},
			});

			const result = await upload.done();

			const url = `https://${this.bucketName}.${config.cloudflare.r2.accountId}.r2.cloudflarestorage.com/${key}`;
			const publicUrl = this.publicDomain
				? `https://${this.publicDomain}/${key}`
				: url;

			logger.info("File uploaded to R2", {
				key,
				size: buffer.length,
				contentType: options.contentType,
			});

			return {
				key,
				url,
				publicUrl,
				size: buffer.length,
				etag: result.ETag,
			};
		} catch (error) {
			logger.error("Failed to upload file to R2", { key, error });
			throw new Error(`Failed to upload file: ${error}`);
		}
	}

	// Upload stream to R2 (for large files)
	async uploadStream(
		stream: Readable,
		key: string,
		options: {
			contentType?: string;
			contentLength?: number;
			metadata?: Record<string, string>;
			cacheControl?: string;
		} = {},
	): Promise<UploadResult> {
		try {
			const upload = new Upload({
				client: this.s3Client,
				params: {
					Bucket: this.bucketName,
					Key: key,
					Body: stream,
					ContentType: options.contentType || "application/octet-stream",
					ContentLength: options.contentLength,
					Metadata: options.metadata,
					CacheControl: options.cacheControl || "public, max-age=31536000",
				},
			});

			const result = await upload.done();

			const url = `https://${this.bucketName}.${config.cloudflare.r2.accountId}.r2.cloudflarestorage.com/${key}`;
			const publicUrl = this.publicDomain
				? `https://${this.publicDomain}/${key}`
				: url;

			logger.info("Stream uploaded to R2", {
				key,
				contentType: options.contentType,
				contentLength: options.contentLength,
			});

			return {
				key,
				url,
				publicUrl,
				size: options.contentLength || 0,
				etag: result.ETag,
			};
		} catch (error) {
			logger.error("Failed to upload stream to R2", { key, error });
			throw new Error(`Failed to upload stream: ${error}`);
		}
	}

	async getFile(key: string): Promise<Buffer> {
		try {
			const command = new GetObjectCommand({
				Bucket: this.bucketName,
				Key: key,
			});

			const response = await this.s3Client.send(command);

			if (!response.Body) {
				throw new Error("No file body received");
			}

			// Convert stream to buffer
			const chunks: Uint8Array[] = [];
			const stream = response.Body as NodeJS.ReadableStream;

			return new Promise((resolve, reject) => {
				stream.on("data", (chunk) => chunks.push(chunk));
				stream.on("end", () => resolve(Buffer.concat(chunks)));
				stream.on("error", reject);
			});
		} catch (error) {
			logger.error("Failed to get file from R2", { key, error });
			throw new Error(`Failed to get file: ${error}`);
		}
	}

	async getFileStream(key: string): Promise<NodeJS.ReadableStream> {
		try {
			const command = new GetObjectCommand({
				Bucket: this.bucketName,
				Key: key,
			});

			const response = await this.s3Client.send(command);

			if (!response.Body) {
				throw new Error("No file body received");
			}

			return response.Body as NodeJS.ReadableStream;
		} catch (error) {
			logger.error("Failed to get file stream from R2", { key, error });
			throw new Error(`Failed to get file stream: ${error}`);
		}
	}

	async deleteFile(key: string): Promise<boolean> {
		try {
			const command = new DeleteObjectCommand({
				Bucket: this.bucketName,
				Key: key,
			});

			await this.s3Client.send(command);

			logger.info("File deleted from R2", { key });
			return true;
		} catch (error) {
			logger.error("Failed to delete file from R2", { key, error });
			return false;
		}
	}

	// Check if file exists
	async fileExists(key: string): Promise<boolean> {
		try {
			const command = new HeadObjectCommand({
				Bucket: this.bucketName,
				Key: key,
			});

			await this.s3Client.send(command);
			return true;
		} catch (error) {
			return false;
		}
	}

	async getFileMetadata(key: string): Promise<{
		size: number;
		lastModified: Date;
		contentType: string;
		etag: string;
		metadata?: Record<string, string>;
	} | null> {
		try {
			const command = new HeadObjectCommand({
				Bucket: this.bucketName,
				Key: key,
			});

			const response = await this.s3Client.send(command);

			return {
				size: response.ContentLength || 0,
				lastModified: response.LastModified || new Date(),
				contentType: response.ContentType || "application/octet-stream",
				etag: response.ETag || "",
				metadata: response.Metadata,
			};
		} catch (error) {
			logger.error("Failed to get file metadata from R2", { key, error });
			return null;
		}
	}

	async generatePresignedUploadUrl(
		key: string,
		options: PresignedUrlOptions = {},
	): Promise<string> {
		try {
			const command = new PutObjectCommand({
				Bucket: this.bucketName,
				Key: key,
				ContentType: options.contentType,
				ContentLength: options.contentLength,
			});

			const url = await getSignedUrl(this.s3Client, command, {
				expiresIn: options.expiresIn || 3600, // 1 hour default
			});

			logger.info("Generated presigned upload URL", {
				key,
				expiresIn: options.expiresIn || 3600,
			});

			return url;
		} catch (error) {
			logger.error("Failed to generate presigned upload URL", { key, error });
			throw new Error(`Failed to generate presigned URL: ${error}`);
		}
	}

	async generatePresignedDownloadUrl(
		key: string,
		expiresIn: number = 3600,
	): Promise<string> {
		try {
			const command = new GetObjectCommand({
				Bucket: this.bucketName,
				Key: key,
			});

			const url = await getSignedUrl(this.s3Client, command, {
				expiresIn,
			});

			logger.info("Generated presigned download URL", {
				key,
				expiresIn,
			});

			return url;
		} catch (error) {
			logger.error("Failed to generate presigned download URL", { key, error });
			throw new Error(`Failed to generate presigned URL: ${error}`);
		}
	}

	// Generate unique key for file
	generateFileKey(
		folder: string,
		originalName: string,
		userId?: string,
	): string {
		const timestamp = Date.now();
		const random = crypto.randomBytes(8).toString("hex");
		const extension = path.extname(originalName);
		const baseName = path.basename(originalName, extension);

		// Sanitize filename
		const sanitizedName = baseName.replace(/[^a-zA-Z0-9-_]/g, "_");

		const filename = `${timestamp}_${random}_${sanitizedName}${extension}`;

		if (userId) {
			return `${folder}/${userId}/${filename}`;
		}

		return `${folder}/${filename}`;
	}

	// Get public URL for file
	getPublicUrl(key: string): string {
		if (this.publicDomain) {
			return `https://${this.publicDomain}/${key}`;
		}

		return `https://${this.bucketName}.${config.cloudflare.r2.accountId}.r2.cloudflarestorage.com/${key}`;
	}

	async uploadMultipleFiles(
		files: Array<{
			buffer: Buffer;
			key: string;
			contentType?: string;
			metadata?: Record<string, string>;
		}>,
	): Promise<UploadResult[]> {
		try {
			const uploadPromises = files.map((file) =>
				this.uploadFile(file.buffer, file.key, {
					contentType: file.contentType,
					metadata: file.metadata,
				}),
			);

			const results = await Promise.all(uploadPromises);

			logger.info("Multiple files uploaded to R2", {
				count: files.length,
				totalSize: files.reduce((sum, file) => sum + file.buffer.length, 0),
			});

			return results;
		} catch (error) {
			logger.error("Failed to upload multiple files to R2", { error });
			throw new Error(`Failed to upload multiple files: ${error}`);
		}
	}

	async copyFile(sourceKey: string, destinationKey: string): Promise<boolean> {
		try {
			// Get source file
			const sourceBuffer = await this.getFile(sourceKey);
			const sourceMetadata = await this.getFileMetadata(sourceKey);

			if (!sourceMetadata) {
				throw new Error("Source file not found");
			}

			// Upload to destination
			await this.uploadFile(sourceBuffer, destinationKey, {
				contentType: sourceMetadata.contentType,
				metadata: sourceMetadata.metadata,
			});

			logger.info("File copied in R2", {
				sourceKey,
				destinationKey,
				size: sourceMetadata.size,
			});

			return true;
		} catch (error) {
			logger.error("Failed to copy file in R2", {
				sourceKey,
				destinationKey,
				error,
			});
			return false;
		}
	}

	// Get bucket usage statistics
	async getBucketStats(): Promise<{
		totalFiles: number;
		totalSize: number;
	}> {
		const { rows } = await query(
			`SELECT total_files as "totalFiles", 
                    total_size_bytes as "totalSizeBytes"
             FROM r2_bucket_stats 
             WHERE bucket = $1`,
			[this.bucketName],
		);

		const stats = rows[0] || {
			totalFiles: 0,
			totalSizeBytes: 0,
		};

		const result = {
			totalFiles: Number(stats.totalFiles),
			totalSize: Number(stats.totalSizeBytes),
		};

		logger.info("Retrieved bucket stats", {
			bucket: this.bucketName,
			...result,
		});

		return result;
	}

	async updateBucketStats(fileSize: number): Promise<void> {
		try {
			await query(
				`
            INSERT INTO r2_bucket_stats (bucket, total_files, total_size_bytes)
            VALUES ($1, 1, $2)
            ON CONFLICT (bucket) 
            DO UPDATE SET 
                total_files = r2_bucket_stats.total_files + 1,
                total_size_bytes = r2_bucket_stats.total_size_bytes + $2,
                updated_at = CURRENT_TIMESTAMP
        `,
				[this.bucketName, fileSize],
			);

			logger.debug("Updated bucket stats", {
				bucket: this.bucketName,
				fileSize,
			});
		} catch (error) {
			logger.error("Failed to update bucket stats", {
				bucket: this.bucketName,
				error,
			});
			throw new Error("Failed to update bucket statistics");
		}
	}

	async deleteBucketStats(): Promise<void> {
		try {
			await query(
				`
            DELETE FROM r2_bucket_stats
            WHERE bucket = $1
        `,
				[this.bucketName],
			);
			logger.debug("Deleted bucket stats", { bucket: this.bucketName });
		} catch (error) {
			logger.error("Failed to delete bucket stats", {
				bucket: this.bucketName,
				error,
			});
			throw new Error("Failed to delete bucket statistics");
		}
	}

	async cleanupBucketStats(): Promise<void> {
		try {
			await query(
				`
            UPDATE r2_bucket_stats
            SET total_files = 0,
                total_size_bytes = 0,
                updated_at = CURRENT_TIMESTAMP
            WHERE bucket = $1
        `,
				[this.bucketName],
			);

			logger.info("Reset bucket stats", { bucket: this.bucketName });
		} catch (error) {
			logger.error("Failed to reset bucket stats", {
				bucket: this.bucketName,
				error,
			});
			throw new Error("Failed to reset bucket statistics");
		}
	}
}

// Create singleton instance
let r2Service: CloudflareR2Service | null = null;

export const getR2Service = (): CloudflareR2Service => {
	if (!r2Service) {
		r2Service = new CloudflareR2Service({
			accountId: config.cloudflare.r2.accountId,
			accessKeyId: config.cloudflare.r2.accessKeyId,
			secretAccessKey: config.cloudflare.r2.secretAccessKey,
			bucketName: config.cloudflare.r2.bucketName,
			publicDomain: config.cloudflare.r2.publicDomain,
			region: config.cloudflare.r2.region,
		});
	}

	return r2Service;
};

export default CloudflareR2Service;
