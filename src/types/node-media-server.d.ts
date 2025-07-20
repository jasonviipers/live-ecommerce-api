declare module "node-media-server" {
	interface Session {
		reject(): void;
		accept(): void;
	}

	interface NodeMediaServer {
		on(
			event:
				| "prePublish"
				| "postPublish"
				| "donePublish"
				| "prePlay"
				| "postPlay"
				| "donePlay",
			listener: (id: string, StreamPath: string, args: any) => void,
		): this;

		getSession(id: string): Session | undefined;
		run(): void;
		stop(): void;
	}

	interface Config {
		rtmp: {
			port: number;
			chunk_size: number;
			gop_cache: boolean;
			ping: number;
			ping_timeout: number;
		};
		http: {
			port: number;
			mediaroot: string;
			allow_origin: string;
		};
		relay: {
			ffmpeg: string;
			tasks: Array<{
				app: string;
				mode: string;
				edge: string;
			}>;
		};
		recording: {
			enabled: boolean;
			type: string;
			path: string;
		};
	}

	class NodeMediaServer {
		constructor(config: Config);
	}

	export = NodeMediaServer;
}
