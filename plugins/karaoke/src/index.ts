import { LunaUnload, Tracer } from "@luna/core";
import { MediaItem, PlayState, redux } from "@luna/lib";
import { DataStoreService } from "./Settings";
import { KaraokeBridgeClient, extractTrackLoadPayload, type KaraokeMode } from "./bridgeClient";
import { KaraokeUi } from "./karaokeUi";

export { Settings } from "./Settings";
export { type KaraokeMode } from "./bridgeClient";
export const { trace, errSignal } = Tracer("[karaoke]");
export const unloads = new Set<LunaUnload>();

let enabled = DataStoreService.enabled ?? false;
let vocalGainPct = DataStoreService.vocalGain ?? 15;
let mode: KaraokeMode = (DataStoreService.mode as KaraokeMode) || "karaoke";
let useGpu = DataStoreService.useGpu ?? true;
let autoPreload = DataStoreService.autoPreload ?? true;
let useLossless = DataStoreService.useLossless ?? false;
let syncOffsetMs = DataStoreService.syncOffsetMs ?? 0;
let cacheMaxMb = DataStoreService.cacheMaxMb ?? 2048;
let wsPort = DataStoreService.wsPort ?? 5445;

let lastSentPlaying: boolean | null = null;
let lastSentTrackId: string | undefined;
let lastSentTime = -1;
let lastSentVol = -1;

let latestTimeSec = 0;
let lastRequestedLoadId = "";
let lastRequestedLoadMs = 0;

const updateLatestTime = (timeSec: number): void => {
	if (Number.isFinite(timeSec) && timeSec >= 0) {
		latestTimeSec = timeSec;
	}
};

const getMasterVolume = (): number => {
	try {
		const controls = PlayState.playbackControls;
		if (controls.muted) return 0;
		return Math.max(0, Math.min(1, (controls.volume ?? 100) / 100));
	} catch {
		return 1;
	}
};

const isActuallyPlaying = (): boolean => {
	try {
		const pc = PlayState.playbackControls;
		return pc.playbackState === "PLAYING" && pc.desiredPlaybackState === "PLAYING";
	} catch {
		return PlayState.state === "PLAYING";
	}
};

let localPausedOverride = !isActuallyPlaying();

const getLiveCurrentTime = (): number => {
	try {
		const raw = PlayState.currentTime;
		if (Number.isFinite(raw) && raw >= 0) {
			latestTimeSec = raw;
			return raw;
		}
		const pc = PlayState.playbackControls;
		const base = pc?.latestCurrentTime ?? 0;
		if (Number.isFinite(base) && base >= 0) {
			return base;
		}
		return latestTimeSec;
	} catch {
		return latestTimeSec;
	}
};

function sendSyncNow(playing: boolean, force = false): void {
	if (!enabled) return;
	const trackId = PlayState.playbackContext?.actualProductId;
	const t = getLiveCurrentTime();
	const vol = getMasterVolume();

	if (
		!force &&
		!playing &&
		lastSentPlaying === false &&
		trackId === lastSentTrackId &&
		Math.abs(t - lastSentTime) < 0.02 &&
		Math.abs(vol - lastSentVol) < 0.005
	) {
		return;
	}

	lastSentPlaying = playing;
	lastSentTrackId = trackId;
	lastSentTime = t;
	lastSentVol = vol;
	bridge.sendSync(trackId, t, playing, vol);
}

const bridge = new KaraokeBridgeClient(wsPort, {
	vocalGain: vocalGainPct / 100,
	masterVolume: getMasterVolume(),
	mode,
	useGpu,
	syncOffsetMs,
	cacheMaxMb,
});

let lastPreloadedTrackId: string | null = null;

const ui = new KaraokeUi({
	onToggleEnabled: (nextEnabled) => {
		DataStoreService.enabled = nextEnabled;
		setKaraokeEnabled(nextEnabled);
	},
	onChangeVocalGainPct: (pct) => {
		DataStoreService.vocalGain = pct;
		setVocalGainPct(pct);
	},
	onChangeMode: (nextMode) => {
		DataStoreService.mode = nextMode;
		setKaraokeMode(nextMode);
	},
	onDownloadModel: (model) => bridge.requestModelDownload(model),
	onReconnect: () => bridge.reconnectNow(),
	getInitialState: () => ({ enabled, vocalGainPct, mode, port: wsPort }),
});

async function preloadNextInQueue(): Promise<void> {
	if (!enabled || !autoPreload) return;
	try {
		const nextItem = await PlayState.nextMediaItem();
		if (!nextItem || nextItem.contentType !== "track") return;
		const nextId = String(nextItem.id);
		const curId = PlayState.playbackContext?.actualProductId;
		if (nextId === curId || nextId === lastPreloadedTrackId) return;
		lastPreloadedTrackId = nextId;
		await loadMediaItem(nextItem, true);
	} catch { }
}

bridge.onStatusChange((status, connected) => {
	ui.updateStatus(status, connected);
	if (
		enabled &&
		autoPreload &&
		status &&
		status.separatedPct === 100 &&
		status.trackId &&
		status.trackId === PlayState.playbackContext?.actualProductId
	) {
		void preloadNextInQueue();
	}
});

async function loadMediaItem(mediaItem: MediaItem | undefined, preload: boolean): Promise<void> {
	if (!mediaItem || mediaItem.contentType !== "track") return;
	const idStr = String(mediaItem.id);
	const nowMs = performance.now();
	if (!preload) {
		if (idStr === lastRequestedLoadId && nowMs - lastRequestedLoadMs < 400) return;
		lastRequestedLoadId = idStr;
		lastRequestedLoadMs = nowMs;
	}
	const startTime = preload ? 0 : getLiveCurrentTime();
	const playingNow = !localPausedOverride && isActuallyPlaying();
	const payload = await extractTrackLoadPayload(mediaItem, startTime, playingNow, preload, useLossless);
	if (payload) {
		bridge.sendTrack(payload);
	}
}

// Initial hydration if a track is already loaded in Tidal
if (enabled) {
	bridge.setEnabled(true);
	MediaItem.fromPlaybackContext().then((item) => {
		if (enabled && item) void loadMediaItem(item, false);
	}).catch(() => { });
}

MediaItem.onMediaTransition(unloads, (mediaItem) => {
	lastPreloadedTrackId = null;
	if (enabled) {
		void loadMediaItem(mediaItem, false);
	}
});

MediaItem.onPreload(unloads, (mediaItem) => {
	if (enabled && autoPreload) {
		void loadMediaItem(mediaItem, true);
	}
});

redux.intercept("playbackControls/TIME_UPDATE", unloads, (time) => {
	if (typeof time === "number" && Number.isFinite(time)) {
		updateLatestTime(time);
	}
});

redux.intercept("playbackControls/SEEK", unloads, (seekTime) => {
	if (typeof seekTime === "number" && Number.isFinite(seekTime)) {
		updateLatestTime(seekTime);
		if (enabled) {
			bridge.sendSeek(PlayState.playbackContext?.actualProductId, seekTime, !localPausedOverride && isActuallyPlaying());
		}
	}
});

redux.intercept("playbackControls/SET_VOLUME", unloads, (payload) => {
	if (enabled) {
		const vol = typeof payload === "object" && payload !== null && "volume" in payload
			? Number((payload as { volume: number }).volume) / 100
			: getMasterVolume();
		bridge.updateConfig({ masterVolume: Math.max(0, Math.min(1, vol)) });
	}
});

redux.intercept("playbackControls/SET_MUTE", unloads, (muted) => {
	if (enabled) {
		bridge.updateConfig({ masterVolume: muted ? 0 : (PlayState.playbackControls.volume ?? 100) / 100 });
	}
});

redux.intercept("playbackControls/TOGGLE_MUTE", unloads, () => {
	if (enabled) {
		window.setTimeout(() => {
			bridge.updateConfig({ masterVolume: getMasterVolume() });
		}, 10);
	}
});

redux.intercept(["playbackControls/PAUSE", "playbackControls/STOP", "playbackControls/ENDED"], unloads, () => {
	updateLatestTime(PlayState.currentTime);
	localPausedOverride = true;
	if (enabled) {
		sendSyncNow(false, true);
	}
});

redux.intercept("playbackControls/PLAY", unloads, () => {
	updateLatestTime(PlayState.currentTime);
	localPausedOverride = false;
	window.setTimeout(() => {
		if (enabled && !localPausedOverride && isActuallyPlaying()) {
			sendSyncNow(true, true);
		}
	}, 40);
});

redux.intercept("playbackControls/SET_PLAYBACK_STATE", unloads, (state) => {
	const nowPlaying = state === "PLAYING";
	updateLatestTime(PlayState.currentTime);
	localPausedOverride = !nowPlaying;
	if (enabled) {
		sendSyncNow(nowPlaying, true);
	}
});

const syncTimerId = window.setInterval(() => {
	if (!enabled) return;
	const playing = !localPausedOverride && isActuallyPlaying();
	sendSyncNow(playing, false);
}, 500);

// Live Settings Handlers
export function setKaraokeEnabled(next: boolean): void {
	enabled = !!next;
	if (enabled) {
		updateLatestTime(PlayState.currentTime);
		localPausedOverride = !isActuallyPlaying();
		lastSentPlaying = null;
	}
	bridge.setEnabled(enabled);
	ui.syncExternalConfig(enabled, vocalGainPct, mode);
	if (enabled) {
		MediaItem.fromPlaybackContext().then((item) => {
			if (enabled && item) void loadMediaItem(item, false);
		}).catch(() => { });
	}
}

export function setVocalGainPct(pct: number): void {
	vocalGainPct = Math.max(0, Math.min(100, Math.round(pct)));
	bridge.updateConfig({ vocalGain: vocalGainPct / 100 });
	ui.syncExternalConfig(enabled, vocalGainPct, mode);
}

export function setKaraokeMode(nextMode: KaraokeMode): void {
	mode = nextMode;
	bridge.updateConfig({ mode });
	ui.syncExternalConfig(enabled, vocalGainPct, mode);
}

export function setUseGpu(nextUseGpu: boolean): void {
	useGpu = !!nextUseGpu;
	bridge.updateConfig({ useGpu });
}

export function setAutoPreload(nextPreload: boolean): void {
	autoPreload = !!nextPreload;
}

export function setUseLossless(nextLossless: boolean): void {
	useLossless = !!nextLossless;
}

export function setSyncOffsetMs(offsetMs: number): void {
	syncOffsetMs = Math.max(-200, Math.min(200, Math.round(offsetMs)));
	bridge.updateConfig({ syncOffsetMs });
}

export function setWsPort(port: number): void {
	wsPort = Math.max(1024, Math.min(65535, Math.round(port)));
	bridge.setPort(wsPort);
}

export function setCacheMaxMb(mb: number): void {
	cacheMaxMb = Math.max(256, Math.min(16384, Math.round(mb)));
	bridge.updateConfig({ cacheMaxMb });
}

export function clearStemCache(): void {
	bridge.clearCache();
}

unloads.add(() => {
	clearInterval(syncTimerId);
	bridge.destroy();
	ui.destroy();
});
