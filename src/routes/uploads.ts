import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import multer from "multer";
import { authMiddleware, requireAuthenticated } from "@/middleware/auth";
import { createError } from "@/middleware/errorHandler";
import { logger } from "@/config/logger";
import { querySchema, uploadOptionsSchema } from "@/utils/validation";
import MediaService from "@/services/mediaService";

const uploads = new Hono();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
	storage,
	limits: {
		fileSize: 100 * 1024 * 1024, // 100MB
		files: 10, // Maximum 10 files per request
	},
	fileFilter: (req, file, cb) => {
		const allowedTypes = [
			"image/jpeg",
			"image/png",
			"image/gif",
			"image/webp",
			"video/mp4",
			"video/webm",
			"video/mov",
			"video/avi",
		];

		if (allowedTypes.includes(file.mimetype)) {
			cb(null, true);
		} else {
			cb(new Error(`File type ${file.mimetype} is not allowed`));
		}
	},
});

uploads.post("/single", authMiddleware, requireAuthenticated, async (c) => {
	try {
		const user = c.get("user");

		// Use multer middleware
		const uploadMiddleware = upload.single("file");

		return new Promise((resolve, reject) => {
			uploadMiddleware(c.req.raw as any, c.res as any, async (err: any) => {
				if (err) {
					logger.error("Multer upload error", err);
					return reject(createError.badRequest(err.message));
				}

				try {
					const file = (c.req.raw as any).file;
					if (!file) {
						return reject(createError.badRequest("No file uploaded"));
					}

					// Get upload options from query parameters
					const options = uploadOptionsSchema.parse(c.req.query());

					const mediaFile = await MediaService.uploadFile({
						userId: user.id,
						file: {
							buffer: file.buffer,
							originalname: file.originalname,
							mimetype: file.mimetype,
							size: file.size,
						},
						folder: options.folder,
						generateThumbnail: options.generateThumbnail,
						processVideo: options.processVideo,
						maxWidth: options.maxWidth,
						maxHeight: options.maxHeight,
						quality: options.quality,
					});

					logger.info("File uploaded successfully", {
						mediaId: mediaFile.id,
						userId: user.id,
						filename: mediaFile.filename,
					});

					resolve(
						c.json(
							{
								success: true,
								message: "File uploaded successfully",
								data: mediaFile,
							},
							201,
						),
					);
				} catch (error) {
					logger.error("Failed to process uploaded file", error as Error);
					reject(error);
				}
			});
		});
	} catch (error) {
		logger.error("Failed to upload file", error as Error);
		throw error;
	}
});

// Upload multiple files
uploads.post("/multiple", authMiddleware, requireAuthenticated, async (c) => {
	try {
		const user = c.get("user");

		// Use multer middleware for multiple files
		const uploadMiddleware = upload.array("files", 10);

		return new Promise((resolve, reject) => {
			uploadMiddleware(c.req.raw as any, c.res as any, async (err: any) => {
				if (err) {
					logger.error("Multer upload error", err);
					return reject(createError.badRequest(err.message));
				}

				try {
					const files = (c.req.raw as any).files;
					if (!files || files.length === 0) {
						return reject(createError.badRequest("No files uploaded"));
					}

					// Get upload options from query parameters
					const options = uploadOptionsSchema.parse(c.req.query());

					// Upload all files
					const uploadPromises = files.map((file: any) =>
						MediaService.uploadFile({
							userId: user.id,
							file: {
								buffer: file.buffer,
								originalname: file.originalname,
								mimetype: file.mimetype,
								size: file.size,
							},
							folder: options.folder,
							generateThumbnail: options.generateThumbnail,
							processVideo: options.processVideo,
							maxWidth: options.maxWidth,
							maxHeight: options.maxHeight,
							quality: options.quality,
						}),
					);

					const mediaFiles = await Promise.all(uploadPromises);

					logger.info("Multiple files uploaded successfully", {
						count: mediaFiles.length,
						userId: user.id,
					});

					resolve(
						c.json(
							{
								success: true,
								message: `${mediaFiles.length} files uploaded successfully`,
								data: mediaFiles,
							},
							201,
						),
					);
				} catch (error) {
					logger.error("Failed to process uploaded files", error as Error);
					reject(error);
				}
			});
		});
	} catch (error) {
		logger.error("Failed to upload files", error as Error);
		throw error;
	}
});

// Get user's media files
uploads.get(
	"/my-files",
	authMiddleware,
	requireAuthenticated,
	zValidator("query", querySchema),
	async (c) => {
		try {
			const user = c.get("user");
			const query = c.req.valid("query");

			// Determine mime type filter
			let mimeType: string | undefined;
			if (query.type === "image") {
				mimeType = "image";
			} else if (query.type === "video") {
				mimeType = "video";
			}

			const result = await MediaService.getMediaByUser(
				user.id,
				query.page,
				query.limit,
				mimeType,
			);

			return c.json({
				success: true,
				data: result.files,
				pagination: {
					page: query.page,
					limit: query.limit,
					total: result.total,
					totalPages: Math.ceil(result.total / query.limit),
				},
			});
		} catch (error) {
			logger.error("Failed to get user media files", error as Error);
			throw createError.internal("Failed to retrieve media files");
		}
	},
);

// Get media file by ID
uploads.get("/:id", authMiddleware, requireAuthenticated, async (c) => {
	try {
		const user = c.get("user");
		const mediaId = c.req.param("id");

		const mediaFile = await MediaService.getMediaById(mediaId);

		if (!mediaFile) {
			throw createError.notFound("Media file not found");
		}

		// Check ownership (users can only access their own files)
		if (mediaFile.userId !== user.id && user.role !== "admin") {
			throw createError.forbidden("Access denied to this media file");
		}

		return c.json({
			success: true,
			data: mediaFile,
		});
	} catch (error) {
		logger.error("Failed to get media file", error as Error);
		throw error;
	}
});

// Delete media file
uploads.delete("/:id", authMiddleware, requireAuthenticated, async (c) => {
	try {
		const user = c.get("user");
		const mediaId = c.req.param("id");

		const deleted = await MediaService.deleteMedia(mediaId, user.id);

		if (!deleted) {
			throw createError.notFound("Media file not found or access denied");
		}

		logger.info("Media file deleted", {
			mediaId,
			userId: user.id,
		});

		return c.json({
			success: true,
			message: "Media file deleted successfully",
		});
	} catch (error) {
		logger.error("Failed to delete media file", error as Error);
		throw error;
	}
});

// Upload avatar/profile image
uploads.post("/avatar", authMiddleware, requireAuthenticated, async (c) => {
	try {
		const user = c.get("user");

		const uploadMiddleware = upload.single("avatar");

		return new Promise((resolve, reject) => {
			uploadMiddleware(c.req.raw as any, c.res as any, async (err: any) => {
				if (err) {
					logger.error("Avatar upload error", err);
					return reject(createError.badRequest(err.message));
				}

				try {
					const file = (c.req.raw as any).file;
					if (!file) {
						return reject(createError.badRequest("No avatar file uploaded"));
					}

					// Validate image type
					if (!file.mimetype.startsWith("image/")) {
						return reject(
							createError.badRequest("Avatar must be an image file"),
						);
					}

					const mediaFile = await MediaService.uploadFile({
						userId: user.id,
						file: {
							buffer: file.buffer,
							originalname: file.originalname,
							mimetype: file.mimetype,
							size: file.size,
						},
						folder: "avatars",
						generateThumbnail: true,
						maxWidth: 400,
						maxHeight: 400,
						quality: 85,
					});

					// TODO: Update user avatar URL in database
					// await UserRepository.updateAvatar(user.id, mediaFile.url);

					logger.info("Avatar uploaded successfully", {
						mediaId: mediaFile.id,
						userId: user.id,
					});

					resolve(
						c.json(
							{
								success: true,
								message: "Avatar uploaded successfully",
								data: {
									id: mediaFile.id,
									url: mediaFile.url,
									thumbnailUrl: mediaFile.thumbnailUrl,
								},
							},
							201,
						),
					);
				} catch (error) {
					logger.error("Failed to process avatar upload", error as Error);
					reject(error);
				}
			});
		});
	} catch (error) {
		logger.error("Failed to upload avatar", error as Error);
		throw error;
	}
});

// Upload product images
uploads.post(
	"/product/:productId/images",
	authMiddleware,
	requireAuthenticated,
	async (c) => {
		try {
			const user = c.get("user");
			const productId = c.req.param("productId");

			// TODO: Verify user owns the product or is admin

			const uploadMiddleware = upload.array("images", 5);

			return new Promise((resolve, reject) => {
				uploadMiddleware(c.req.raw as any, c.res as any, async (err: any) => {
					if (err) {
						logger.error("Product images upload error", err);
						return reject(createError.badRequest(err.message));
					}

					try {
						const files = (c.req.raw as any).files;
						if (!files || files.length === 0) {
							return reject(createError.badRequest("No image files uploaded"));
						}

						// Validate all files are images
						for (const file of files) {
							if (!file.mimetype.startsWith("image/")) {
								return reject(
									createError.badRequest("All files must be images"),
								);
							}
						}

						// Upload all images
						const uploadPromises = files.map((file: any) =>
							MediaService.uploadFile({
								userId: user.id,
								file: {
									buffer: file.buffer,
									originalname: file.originalname,
									mimetype: file.mimetype,
									size: file.size,
								},
								folder: `products/${productId}`,
								generateThumbnail: true,
								maxWidth: 1200,
								maxHeight: 1200,
								quality: 90,
							}),
						);

						const mediaFiles = await Promise.all(uploadPromises);

						// TODO: Associate images with product in database
						// await ProductRepository.addImages(productId, mediaFiles.map(f => f.url));

						logger.info("Product images uploaded successfully", {
							productId,
							count: mediaFiles.length,
							userId: user.id,
						});

						resolve(
							c.json(
								{
									success: true,
									message: `${mediaFiles.length} product images uploaded successfully`,
									data: mediaFiles.map((f) => ({
										id: f.id,
										url: f.url,
										thumbnailUrl: f.thumbnailUrl,
									})),
								},
								201,
							),
						);
					} catch (error) {
						logger.error(
							"Failed to process product images upload",
							error as Error,
						);
						reject(error);
					}
				});
			});
		} catch (error) {
			logger.error("Failed to upload product images", error as Error);
			throw error;
		}
	},
);

// Get upload statistics
uploads.get(
	"/stats/summary",
	authMiddleware,
	requireAuthenticated,
	async (c) => {
		try {
			const user = c.get("user");
			const stats = await MediaService.getMediaStatsByUser(user.id);

			return c.json({
				success: true,
				data: stats,
			});
		} catch (error) {
			logger.error("Failed to get upload statistics", error as Error);
			throw createError.internal("Failed to retrieve upload statistics");
		}
	},
);

export default uploads;
