import { config } from "@/config";
import logger from "@/config/logger";
import { getRedisClient } from "@/database/redis";
import NodeMediaServer from "node-media-server";
import { EventEmitter } from "node:events";
import { accessSync } from "node:fs";
import { VideoProcessingService } from "./videoProcessor";
import { query } from "@/database/connection";

export interface StreamSession {
	id: string;
	streamKey: string;
	userId: string;
	title: string;
	description?: string;
	category?: string;
	isLive: boolean;
	viewerCount: number;
	startTime?: Date;
	endTime?: Date;
	recordingPath?: string;
	recordingUrl?: string;
	thumbnailUrl?: string;
	metadata?: unknown;
}

export interface StreamStats {
	totalStreams: number;
	liveStreams: number;
	totalViewers: number;
	totalWatchTime: number;
	averageViewDuration: number;
}

export class MediaServerService extends EventEmitter {
	private nms!: NodeMediaServer;
	private activeSessions: Map<string, StreamSession> = new Map();
	private streamKeys: Map<string, string> = new Map(); // streamKey -> userId
	private viewerCounts: Map<string, number> = new Map();
	private socketManager: any;

	constructor() {
		super();
		this.initializeMediaServer();
	}

	private initializeMediaServer(): void {
		const nmsConfig = {
			rtmp: {
				port: config.streaming.rtmp.port,
				chunk_size: config.streaming.rtmp.chunkSize,
				gop_cache: config.streaming.rtmp.gopCache,
				ping: config.streaming.rtmp.ping,
				ping_timeout: config.streaming.rtmp.pingTimeout,
			},
			http: {
				port: config.mediaServer.http.port,
				mediaroot: config.mediaServer.http.mediaroot,
				allow_origin: config.mediaServer.http.allowOrigin,
			},
			relay: {
				ffmpeg: config.mediaServer.ffmpeg.path,
				tasks: [
					{
						app: "live",
						mode: "push",
						edge: `rtmp://127.0.0.1:${config.streaming.rtmp.port}/live_edge`,
					},
				],
			},
			recording: {
				enabled: true,
				type: "record",
				path: config.mediaServer.http.mediaroot + "/recordings",
			},
		};

		this.nms = new NodeMediaServer(nmsConfig);
		this.setupEventHandlers();

		logger.info("Media server initialized", {
			rtmpPort: config.streaming.rtmp.port,
			httpPort: config.mediaServer.http.port,
		});
	}

	private setupEventHandlers(): void {
		this.nms.on(
			"prePublish",
			async (id: string, StreamPath: string, args: any) => {
				await this.handlePrePublish(id, StreamPath, args);
			},
		);

		this.nms.on(
			"postPublish",
			async (id: string, StreamPath: string, args: any) => {
				await this.handlePostPublish(id, StreamPath, args);
			},
		);

		this.nms.on(
			"donePublish",
			async (id: string, StreamPath: string, args: any) => {
				await this.handleDonePublish(id, StreamPath, args);
			},
		);

		this.nms.on(
			"prePlay",
			async (id: string, StreamPath: string, args: any) => {
				await this.handlePrePlay(id, StreamPath, args);
			},
		);

		this.nms.on(
			"postPlay",
			async (id: string, StreamPath: string, args: any) => {
				await this.handlePostPlay(id, StreamPath, args);
			},
		);

		this.nms.on(
			"donePlay",
			async (id: string, StreamPath: string, args: any) => {
				await this.handleDonePlay(id, StreamPath, args);
			},
		);

		logger.info("Media server event handlers setup complete");
	}

	private async handlePrePublish(
		id: string,
		streamPath: string,
		args: unknown,
	): Promise<void> {
		try {
			const streamKey = this.extractStreamKey(streamPath);

			if (!streamKey) {
				logger.warn("Stream publish rejected - no stream key", {
					id,
					streamPath,
				});
				this.nms.getSession(id)?.reject();
				return;
			}

			// Validate stream key
			const userId = await this.validateStreamKey(streamKey);

			if (!userId) {
				logger.warn("Stream publish rejected - invalid stream key", {
					id,
					streamKey,
				});
				this.nms.getSession(id)?.reject();
				return;
			}

			const existingSession = Array.from(this.activeSessions.values()).find(
				(session) => session.userId === userId && session.isLive,
			);

			if (existingSession) {
				logger.warn("Stream publish rejected - user already streaming", {
					id,
					userId,
				});
				this.nms.getSession(id)?.reject();
				return;
			}

			// Store stream key mapping
			this.streamKeys.set(streamKey, userId);

			logger.info("Stream publish authorized", { id, streamKey, userId });
		} catch (error) {
			logger.error("Error in prePublish handler", { id, streamPath, error });
			this.nms.getSession(id)?.reject();
		}
	}

	private async handlePostPublish(
		id: string,
		streamPath: string,
		args: any,
	): Promise<void> {
		try {
			const streamKey = this.extractStreamKey(streamPath);
			const userId = this.streamKeys.get(streamKey!);

			if (!userId) {
				logger.error("No user found for stream key in postPublish", {
					id,
					streamKey,
				});
				return;
			}

			// Get stream details from database
			const streamDetails = await this.getStreamDetails(streamKey!);

			if (!streamDetails) {
				logger.error("No stream details found", { id, streamKey });
				return;
			}

			const session: StreamSession = {
				id,
				streamKey: streamKey!,
				userId,
				title: streamDetails.title,
				description: streamDetails.description,
				category: streamDetails.category,
				isLive: true,
				viewerCount: 0,
				startTime: new Date(),
				metadata: {
					streamPath,
					args,
				},
			};

			this.activeSessions.set(id, session);
			this.viewerCounts.set(streamKey!, 0);

			// Update stream status in database
			await this.updateStreamStatus(streamKey!, "live", session.startTime!);

			// Cache stream info in Redis
			const redisClient = getRedisClient();
			await redisClient.hSet(
				"live_streams",
				streamKey!,
				JSON.stringify(session),
			);

			// Notify via Socket.IO
			if (this.socketManager) {
				this.socketManager.emit("stream:started", {
					streamKey: streamKey!,
					userId,
					title: session.title,
					startTime: session.startTime,
				});
			}

			logger.info("Stream started", {
				id,
				streamKey: streamKey!,
				userId,
				title: session.title,
			});

			this.emit("streamStarted", session);
		} catch (error) {
			logger.error("Error in postPublish handler", { id, streamPath, error });
		}
	}

	// Handle done-publish (stream ended)
	private async handleDonePublish(
		id: string,
		streamPath: string,
		args: any,
	): Promise<void> {
		try {
			const session = this.activeSessions.get(id);

			if (!session) {
				logger.warn("No session found for stream end", { id });
				return;
			}

			session.isLive = false;
			session.endTime = new Date();

			// Calculate stream duration
			const duration =
				session.endTime.getTime() - (session.startTime?.getTime() || 0);

			// Update stream status in database
			await this.updateStreamStatus(
				session.streamKey,
				"ended",
				session.endTime,
				duration,
			);

			// Process recording if exists
			const recordingPath = this.getRecordingPath(session.streamKey);
			if (recordingPath) {
				session.recordingPath = recordingPath;

				// Add to video processing queue
				const jobId = await VideoProcessingService.addProcessingJob(
					session.userId,
					recordingPath,
					{
						qualities: [...config.videoProcessing.qualities],
						generateThumbnail: true,
						uploadToR2: true,
						deleteOriginal: false,
					},
				);

				logger.info("Recording added to processing queue", {
					streamKey: session.streamKey,
					recordingPath,
					jobId,
				});
			}

			// Clean up
			this.activeSessions.delete(id);
			this.viewerCounts.delete(session.streamKey);
			this.streamKeys.delete(session.streamKey);

			// Remove from Redis
			const redisClient = getRedisClient();
			await redisClient.hDel("live_streams", session.streamKey);

			// Notify via Socket.IO
			if (this.socketManager) {
				this.socketManager.emit("stream:ended", {
					streamKey: session.streamKey,
					userId: session.userId,
					endTime: session.endTime,
					duration,
				});
			}

			logger.info("Stream ended", {
				id,
				streamKey: session.streamKey,
				userId: session.userId,
				duration: Math.round(duration / 1000) + "s",
			});

			this.emit("streamEnded", session);
		} catch (error) {
			logger.error("Error in donePublish handler", { id, streamPath, error });
		}
	}

	// Handle pre-play (viewer authentication)
	private async handlePrePlay(
		id: string,
		streamPath: string,
		args: any,
	): Promise<void> {
		try {
			const streamKey = this.extractStreamKey(streamPath);

			if (!streamKey) {
				logger.warn("Stream play rejected - no stream key", { id, streamPath });
				this.nms.getSession(id)?.reject();
				return;
			}

			// Check if stream is live
			const session = Array.from(this.activeSessions.values()).find(
				(s) => s.streamKey === streamKey && s.isLive,
			);

			if (!session) {
				logger.warn("Stream play rejected - stream not live", {
					id,
					streamKey,
				});
				this.nms.getSession(id)?.reject();
				return;
			}

			logger.info("Stream play authorized", { id, streamKey });
		} catch (error) {
			logger.error("Error in prePlay handler", { id, streamPath, error });
			this.nms.getSession(id)?.reject();
		}
	}

	// Handle post-play (viewer joined)
	private async handlePostPlay(
		id: string,
		streamPath: string,
		args: any,
	): Promise<void> {
		try {
			const streamKey = this.extractStreamKey(streamPath);

			if (!streamKey) return;

			// Increment viewer count
			const currentCount = this.viewerCounts.get(streamKey) || 0;
			const newCount = currentCount + 1;
			this.viewerCounts.set(streamKey, newCount);

			// Update session
			const session = Array.from(this.activeSessions.values()).find(
				(s) => s.streamKey === streamKey,
			);

			if (session) {
				session.viewerCount = newCount;
				this.activeSessions.set(session.id, session);

				// Update Redis
				const redisClient = getRedisClient();
				await redisClient.hSet(
					"live_streams",
					streamKey,
					JSON.stringify(session),
				);

				// Notify via Socket.IO
				if (this.socketManager) {
					this.socketManager.to(`stream:${streamKey}`).emit("viewer:joined", {
						streamKey,
						viewerCount: newCount,
					});
				}
			}

			logger.info("Viewer joined stream", {
				id,
				streamKey,
				viewerCount: newCount,
			});
		} catch (error) {
			logger.error("Error in postPlay handler", { id, streamPath, error });
		}
	}

	// Handle done-play (viewer left)
	private async handleDonePlay(
		id: string,
		streamPath: string,
		args: any,
	): Promise<void> {
		try {
			const streamKey = this.extractStreamKey(streamPath);

			if (!streamKey) return;

			// Decrement viewer count
			const currentCount = this.viewerCounts.get(streamKey) || 0;
			const newCount = Math.max(0, currentCount - 1);
			this.viewerCounts.set(streamKey, newCount);

			// Update session
			const session = Array.from(this.activeSessions.values()).find(
				(s) => s.streamKey === streamKey,
			);

			if (session) {
				session.viewerCount = newCount;
				this.activeSessions.set(session.id, session);

				// Update Redis
				const redisClient = getRedisClient();
				await redisClient.hSet(
					"live_streams",
					streamKey,
					JSON.stringify(session),
				);

				// Notify via Socket.IO
				if (this.socketManager) {
					this.socketManager.to(`stream:${streamKey}`).emit("viewer:left", {
						streamKey,
						viewerCount: newCount,
					});
				}
			}

			logger.info("Viewer left stream", {
				id,
				streamKey,
				viewerCount: newCount,
			});
		} catch (error) {
			logger.error("Error in donePlay handler", { id, streamPath, error });
		}
	}

	// Start media server
	start(): void {
		this.nms.run();
		logger.info("Media server started", {
			rtmpPort: config.streaming.rtmp.port,
			httpPort: config.mediaServer.http.port,
		});
	}

	// Stop media server
	stop(): void {
		this.nms.stop();
		logger.info("Media server stopped");
	}

	// Set socket manager for real-time updates
	setSocketManager(socketManager: any): void {
		this.socketManager = socketManager;
	}

	// Get active streams
	getActiveStreams(): StreamSession[] {
		return Array.from(this.activeSessions.values()).filter((s) => s.isLive);
	}

	// Get stream by key
	getStreamByKey(streamKey: string): StreamSession | undefined {
		return Array.from(this.activeSessions.values()).find(
			(s) => s.streamKey === streamKey,
		);
	}

	// Get viewer count for stream
	getViewerCount(streamKey: string): number {
		return this.viewerCounts.get(streamKey) || 0;
	}

	getServerStats(): StreamStats {
		const activeSessions = Array.from(this.activeSessions.values());
		const liveStreams = activeSessions.filter((s) => s.isLive);

		return {
			totalStreams: activeSessions.length,
			liveStreams: liveStreams.length,
			totalViewers: Array.from(this.viewerCounts.values()).reduce(
				(sum, count) => sum + count,
				0,
			),
			totalWatchTime: 0, // Would need to track this separately
			averageViewDuration: 0, // Would need to track this separately
		};
	}

	// Helper methods
	private extractStreamKey(streamPath: string): string | null {
		const match = streamPath.match(/\/live\/(.+)/);
		return match ? match[1] : null;
	}

	private async validateStreamKey(streamKey: string): Promise<string | null> {
		try {
			const sql =
				"SELECT user_id FROM streams WHERE stream_key = $1 AND status = $2";
			const result = await query(sql, [streamKey, "active"]);

			return result.rows.length > 0 ? result.rows[0].user_id : null;
		} catch (error) {
			logger.error("Error validating stream key", { streamKey, error });
			return null;
		}
	}

	private async getStreamDetails(streamKey: string): Promise<{
		title: string;
		description?: string;
		category?: string;
	} | null> {
		try {
			const sql =
				"SELECT title, description, category FROM streams WHERE stream_key = $1";
			const result = await query(sql, [streamKey]);

			return result.rows.length > 0 ? result.rows[0] : null;
		} catch (error) {
			logger.error("Error getting stream details", { streamKey, error });
			return null;
		}
	}

	private async updateStreamStatus(
		streamKey: string,
		status: string,
		timestamp: Date,
		duration?: number,
	): Promise<void> {
		try {
			let sql: string;
			let values: any[];

			if (status === "live") {
				sql =
					"UPDATE streams SET status = $1, started_at = $2, viewer_count = 0 WHERE stream_key = $3";
				values = [status, timestamp, streamKey];
			} else {
				sql =
					"UPDATE streams SET status = $1, ended_at = $2, duration = $3 WHERE stream_key = $4";
				values = [status, timestamp, duration, streamKey];
			}

			await query(sql, values);
		} catch (error) {
			logger.error("Error updating stream status", {
				streamKey,
				status,
				error,
			});
		}
	}

	private getRecordingPath(streamKey: string): string | null {
		const recordingDir = config.mediaServer.http.mediaroot + "/recordings";
		const recordingFile = `${streamKey}.flv`;
		const fullPath = `${recordingDir}/${recordingFile}`;

		// Check if recording file exists
		try {
			accessSync(fullPath);
			return fullPath;
		} catch {
			return null;
		}
	}
}

// Create singleton instance
let mediaServerService: MediaServerService | null = null;

export const getMediaServerService = (): MediaServerService => {
	if (!mediaServerService) {
		mediaServerService = new MediaServerService();
	}

	return mediaServerService;
};

export default MediaServerService;
