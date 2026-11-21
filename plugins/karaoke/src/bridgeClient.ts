import { Quality, type MediaItem } from "@luna/lib";

export type KaraokeMode = "karaoke" | "instrumental" | "dsp";

export interface EngineStatus {
	type: "status";
	enabled: boolean;
	state: "idle" | "loading" | "dsp_bridge" | "ai_active" | "error";
	provider: string;
	mode: KaraokeMode;
	vocalGain: number;
	masterVolume: number;
	trackId: string;
	separatedPct: number;
	fromCache?: boolean;
	cacheEntries?: number;
	cacheMb?: number;
	modelInstalled: {
		karaoke: boolean;
		instrumental: boolean;
	};
	downloadProgress: number;
	lastChunkMs: number;
	error?: string | null;
}

export interface TrackLoadPayload {
	trackId: string;
	title: string;
	manifestMimeType: string;
	urls: string[];
	encryptionType?: string;
	keyId?: string;
	startTime: number;
	playing: boolean;
	preload: boolean;
}

export interface EngineConfigPayload {
	vocalGain: number;
	masterVolume: number;
	mode: KaraokeMode;
	useGpu: boolean;
	syncOffsetMs: number;
	cacheMaxMb?: number;
}

export async function extractTrackLoadPayload(
	mediaItem: MediaItem,
	startTime: number,
	playing: boolean,
	preload: boolean,
	useLossless = false
): Promise<TrackLoadPayload | null> {
	// Default to Low (320kbps AAC) for ~5x faster stream fetch & instant start unless Lossless FLAC is requested
	const candidates = useLossless
		? [Quality.High.audioQuality, Quality.Low.audioQuality, undefined]
		: [Quality.Low.audioQuality, Quality.High.audioQuality, undefined];
	let info = undefined;
	for (const q of candidates) {
		try {
			info = await mediaItem.playbackInfo(q);
			if (info) break;
		} catch { }
	}
	if (!info) return null;

	const title = mediaItem.tidalItem?.title ?? String(mediaItem.id);
	if (info.manifestMimeType === "application/vnd.tidal.bts") {
		if (!info.manifest?.urls?.length) return null;
		return {
			trackId: String(mediaItem.id),
			title,
			manifestMimeType: info.manifestMimeType,
			urls: info.manifest.urls,
			encryptionType: info.manifest.encryptionType,
			keyId: info.manifest.keyId,
			startTime,
			playing,
			preload,
		};
	}

	if (info.manifestMimeType === "application/dash+xml") {
		const urls = info.manifest.tracks?.audios?.[0]?.segments?.map((s: { url: string }) => s.url).filter(Boolean) ?? [];
		if (!urls.length) return null;
		return {
			trackId: String(mediaItem.id),
			title,
			manifestMimeType: info.manifestMimeType,
			urls,
			startTime,
			playing,
			preload,
		};
	}

	return null;
}

export class KaraokeBridgeClient {
	private ws: WebSocket | null = null;
	private port: number;
	private reconnectTimer: number | null = null;
	private destroyed = false;

	private desiredEnabled = false;
	private latestConfig: EngineConfigPayload;
	private latestActiveTrack: TrackLoadPayload | null = null;

	public connected = false;
	public lastStatus: EngineStatus | null = null;

	private onStatusListeners = new Set<(status: EngineStatus | null, connected: boolean) => void>();

	constructor(port: number, initialConfig: EngineConfigPayload) {
		this.port = port;
		this.latestConfig = { ...initialConfig };
		this.connect();
	}

	public onStatusChange(cb: (status: EngineStatus | null, connected: boolean) => void): () => void {
		this.onStatusListeners.add(cb);
		cb(this.lastStatus, this.connected);
		return () => this.onStatusListeners.delete(cb);
	}

	private notifyListeners(): void {
		for (const cb of this.onStatusListeners) {
			try { cb(this.lastStatus, this.connected); } catch { }
		}
	}

	public setPort(port: number): void {
		if (this.port === port) return;
		this.port = port;
		this.disconnectSocket();
		if (!this.destroyed) this.connect();
	}

	private connect(): void {
		if (this.destroyed) return;
		this.disconnectSocket();

		try {
			const socket = new WebSocket(`ws://127.0.0.1:${this.port}/control`);
			this.ws = socket;

			socket.onopen = () => {
				if (this.destroyed || this.ws !== socket) return;
				this.connected = true;
				this.sendJson({ type: "config", ...this.latestConfig });
				this.sendJson({ type: "enable", enabled: this.desiredEnabled });
				if (this.desiredEnabled && this.latestActiveTrack) {
					this.sendJson({ type: "load_track", ...this.latestActiveTrack });
				}
				this.notifyListeners();
			};

			socket.onmessage = (event) => {
				try {
					const parsed = JSON.parse(event.data) as EngineStatus;
					if (parsed && parsed.type === "status") {
						this.lastStatus = parsed;
						this.notifyListeners();
					}
				} catch { }
			};

			socket.onclose = () => {
				if (this.ws === socket) {
					this.ws = null;
					this.connected = false;
					this.lastStatus = null;
					this.notifyListeners();
					this.scheduleReconnect();
				}
			};

			socket.onerror = () => {
				// Reconnect handled cleanly via onclose
			};
		} catch {
			this.scheduleReconnect();
		}
	}

	private scheduleReconnect(): void {
		if (this.destroyed || this.reconnectTimer !== null) return;
		this.reconnectTimer = window.setTimeout(() => {
			this.reconnectTimer = null;
			this.connect();
		}, 2000);
	}

	private disconnectSocket(): void {
		if (this.reconnectTimer !== null) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.ws) {
			this.ws.onopen = null;
			this.ws.onmessage = null;
			this.ws.onclose = null;
			this.ws.onerror = null;
			try { this.ws.close(1000, "Client reset"); } catch { }
			this.ws = null;
		}
		this.connected = false;
	}

	private sendJson(payload: Record<string, unknown>): void {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			try {
				this.ws.send(JSON.stringify(payload));
			} catch { }
		}
	}

	public setEnabled(enabled: boolean): void {
		this.desiredEnabled = enabled;
		this.sendJson({ type: "enable", enabled });
	}

	public updateConfig(partial: Partial<EngineConfigPayload>): void {
		this.latestConfig = { ...this.latestConfig, ...partial };
		this.sendJson({ type: "config", ...this.latestConfig });
	}

	public sendTrack(payload: TrackLoadPayload): void {
		if (!payload.preload) {
			this.latestActiveTrack = payload;
		}
		this.sendJson({ type: "load_track", ...payload });
	}

	public sendSync(trackId: string | undefined, currentTime: number, playing: boolean, masterVolume: number): void {
		if (!this.desiredEnabled) return;
		this.sendJson({
			type: "sync",
			trackId,
			currentTime,
			playing,
			masterVolume,
		});
	}

	public sendSeek(trackId: string | undefined, currentTime: number, playing: boolean): void {
		if (!this.desiredEnabled) return;
		this.sendJson({
			type: "seek",
			trackId,
			currentTime,
			playing,
		});
	}

	public requestModelDownload(model: "karaoke" | "instrumental"): void {
		this.sendJson({ type: "download_model", model });
	}

	public clearCache(): void {
		this.sendJson({ type: "clear_cache" });
	}

	public reconnectNow(): void {
		this.connect();
	}

	public destroy(): void {
		this.destroyed = true;
		if (this.connected && this.desiredEnabled) {
			this.sendJson({ type: "enable", enabled: false });
		}
		this.disconnectSocket();
		this.onStatusListeners.clear();
	}
}
