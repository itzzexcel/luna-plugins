import { LunaUnload, Tracer } from "@luna/core";
import { MediaItem, redux } from "@luna/lib";
import { GetNPView, getFeatureFlag } from "./ui-interface";

import createAudioVisualiser, { AudioVisualiserAPI } from "./giragira";
import { DataStoreService } from "./Settings";
import { DevDebugMenu } from "./devDebugMenu";

export { Settings } from "./Settings";
export const { trace, errSignal } = Tracer("[reactivo]");
export const unloads = new Set<LunaUnload>();

// Global state
let visualiser: AudioVisualiserAPI | null = null;
let devMenu: DevDebugMenu | null = null;
export let availableDevices: any[] = [];
export let currentDevice: string = "";

export let vignetteIntensity: number = (DataStoreService.vignetteIntensity ?? 20) / 10;
export let colorSaturation: number = (DataStoreService.colorSaturation ?? 10) / 10;
export let dynamicLerpEnabled: boolean = true;
export let dynamicIntensityEnabled: boolean = false;
export let dynamicCoverColour: boolean = false;
export let enhancedBackgroundEnabled: boolean = DataStoreService.enhancedBackgroundEnabled;
export let appleFluidBackgroundEnabled: boolean = DataStoreService.appleFluidBackgroundEnabled ?? false;
export let apolMusicWannabeEnabled: boolean = DataStoreService.apolMusicWannabeEnabled ?? false;
export let circleDensity: number = (DataStoreService.circleDensity ?? 10) / 10;
export let circleOpacity: number = (DataStoreService.circleOpacity ?? 10) / 10;
export let fluidSpeed: number = (DataStoreService.fluidSpeed ?? 10) / 10;
export let devDebugMenuEnabled: boolean = DataStoreService.devDebugMenuEnabled ?? false;
export let backgroundMode: 'circles' | 'images' =
	(DataStoreService.backgroundMode as 'circles' | 'images') || 'circles';

// Utility functions
async function sendAnalytics(event: string, extraData?: any) {
	const ANALYTICS_URL = "https://reactivo.excelzzz.workers.dev/";

	try {
		await fetch(ANALYTICS_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				event,
				timestamp: new Date().toISOString(),
				userAgent: navigator.userAgent,
				...extraData,
			}),
		});
	} catch (error) {
		console.error("[reactivo] Failed to send analytics:", error);
	}
}

// Core visualiser functions
const initVisualiser = (): void => {
	if (DataStoreService.isFirstRan === false) {
		try {
			window.open(
				"https://github.com/itzzexcel/luna-plugins/tree/master/plugins/itswickedoutside#installation",
			);
		} catch (e) { }
		DataStoreService.isFirstRan = true;
	} // else {
	// 	console.log("[reactivo] installation screen skipped");
	// }

	if (DataStoreService.updateNeeded_1 === true) {
		try {
			window.open(
				"https://github.com/itzzexcel/reactivo/releases/latest",
			);
		} catch (e) { }
		DataStoreService.updateNeeded_1 = false;
	}

	try {
		// Clean up previous instance if it exists
		if (visualiser) {
			visualiser.disconnect();
			visualiser.destroy();
			visualiser = null;
		}

		// Get container element
		const nowPlaying = GetNPView();

		// Create new visualiser instance using live persisted settings so re-entering Now Playing stays in sync
		visualiser = createAudioVisualiser(nowPlaying, {
			lerpFactor: 0.2,
			wsUrl: "ws://localhost:5343",
			autoReconnect: true,
			maxReconnectAttempts: 100,
			showStatus: false,
			showStats: false,
			intensityMultiplier: (DataStoreService.vignetteIntensity ?? vignetteIntensity * 10) / 10,
			colorSaturation: (DataStoreService.colorSaturation ?? colorSaturation * 10) / 10,
			useDynamicLerp: DataStoreService.dynamicLerpEnabled ?? dynamicLerpEnabled,
			useDynamicIntensity: DataStoreService.dynamicIntensityEnabled ?? dynamicIntensityEnabled,
			useEnhancedBackground: DataStoreService.enhancedBackgroundEnabled ?? enhancedBackgroundEnabled,
			useAppleFluidBackground: DataStoreService.appleFluidBackgroundEnabled ?? appleFluidBackgroundEnabled,
			backgroundMode: (DataStoreService.backgroundMode as 'circles' | 'images') || backgroundMode,
			useApolMusicWannabe: DataStoreService.apolMusicWannabeEnabled ?? apolMusicWannabeEnabled,
			circleDensity: (DataStoreService.circleDensity ?? circleDensity * 10) / 10,
			circleOpacity: (DataStoreService.circleOpacity ?? circleOpacity * 10) / 10,
			fluidSpeed: (DataStoreService.fluidSpeed ?? fluidSpeed * 10) / 10,
			zIndex: 0,
		});
	} catch (error) {
		console.error("Failed to initialize visualiser:", error);
		visualiser = null;
	}
};

const ensureVisualiserConnected = (): void => {
	if (!visualiser) {
		initVisualiser();
		return;
	}

	if (!visualiser.isConnected()) {
		visualiser.reconnect();
	}
};

const initWhenReady = (): void => {
	sendAnalytics("plugin_opened");

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", () => {
			initVisualiser();
			if (devDebugMenuEnabled) setDevDebugMenuEnabled(true);
		});
	} else {
		initVisualiser();
		if (devDebugMenuEnabled) setDevDebugMenuEnabled(true);
	}
};

// Event handlers
redux.intercept("view/ENTERED_NOWPLAYING", unloads, function () {
	if (!visualiser) {
		initVisualiser();
	} else {
		visualiser.reconnect();
	}
	visualiser?.togglePause(true);
});

redux.intercept("view/EXITED_NOWPLAYING", unloads, function () {
	visualiser?.togglePause(false);
	visualiser?.disconnect();
	visualiser?.destroy();
	visualiser = null;
});

redux.intercept("player/SET_ACTIVE_DEVICE_SUCCESS", unloads, function (x: any) {
	if (Array.isArray(availableDevices) && availableDevices.length === 0) {
		console.log("[reactivo] No available devices, trying the redux to get the devices again...");
		redux.actions["remotePlayback/REFRESH_DEVICES"]();
		return;
	}

	if (Array.isArray(availableDevices)) {
		let deviceObject = availableDevices.find((d: any) => d.id === x);
		if (deviceObject) {
			console.log(
				"[reactivo] Native Device ID:",
				deviceObject.nativeDeviceId,
			);
			currentDevice = deviceObject.nativeDeviceId;
			if (visualiser) {
				visualiser.deviceChanged(deviceObject.nativeDeviceId);
			}
		}
	}
});

MediaItem.onMediaTransition(unloads, (mediaItem: MediaItem) => {
	if (!mediaItem) {
		if (visualiser) {
			visualiser.disconnect();
		}
		return;
	} else {
		if (visualiser) {
			visualiser.refreshAtmosphereCircles?.();
			visualiser.updateCoverArt?.(undefined, true);
		}
	}

	try {
		if (!visualiser) {
			initVisualiser();
			return;
		}

		ensureVisualiserConnected();
	} catch (error) {
		console.error("Error in media transition:", error);
		initVisualiser();
	}
});

// Settings handlers
export function setVignetteIntensity(value: number) {
	vignetteIntensity = value;
	if (visualiser && typeof visualiser.setIntensityMultiplier === "function") {
		visualiser.setIntensityMultiplier(value);
	}
}

export function setColorSaturation(value: number) {
	colorSaturation = value;
	if (visualiser && typeof visualiser.setColorSaturation === "function") {
		visualiser.setColorSaturation(value);
	}
}

export function setDynamicLerpEnabled(enabled: boolean) {
	dynamicLerpEnabled = enabled;
	if (visualiser && typeof visualiser.setDynamicLerpEnabled === "function") {
		visualiser.setDynamicLerpEnabled(enabled);
	}
}

export function setDynamicIntensityEnabled(enabled: boolean) {
	dynamicIntensityEnabled = enabled;
	if (
		visualiser &&
		typeof visualiser.setDynamicIntensityEnabled === "function"
	) {
		visualiser.setDynamicIntensityEnabled(enabled);
	}
}

export function setEnhancedBackground(enabled: boolean) {
	enhancedBackgroundEnabled = enabled;
	if (visualiser && typeof visualiser.setEnhancedBackground === "function") {
		visualiser.setEnhancedBackground(enabled);
	}
}

export function setAppleFluidBackgroundEnabled(enabled: boolean) {
	appleFluidBackgroundEnabled = enabled;
	if (visualiser && typeof visualiser.setAppleFluidBackgroundEnabled === "function") {
		visualiser.setAppleFluidBackgroundEnabled(enabled);
	}
}

// Deprecated - kept for compatibility but no longer used
export function setDynamicColourArt(enabled: boolean) {
	dynamicCoverColour = enabled;
}

export function setApolMusicWannabeEnabled(enabled: boolean) {
	apolMusicWannabeEnabled = enabled;
	if (visualiser && typeof visualiser.setApolMusicWannabeEnabled === "function") {
		visualiser.setApolMusicWannabeEnabled(enabled);
	}
}

export function setBackgroundMode(mode: 'circles' | 'images') {
	backgroundMode = mode;
	if (visualiser && typeof visualiser.setBackgroundMode === "function") {
		visualiser.setBackgroundMode(mode);
	}
}

export function setCircleDensity(value: number) {
	circleDensity = value;
	if (visualiser && typeof visualiser.setCircleDensity === "function") {
		visualiser.setCircleDensity(value);
	}
}

export function setCircleOpacity(value: number) {
	circleOpacity = value;
	if (visualiser && typeof visualiser.setCircleOpacity === "function") {
		visualiser.setCircleOpacity(value);
	}
}

export function setFluidSpeed(value: number) {
	fluidSpeed = value;
	if (visualiser && typeof visualiser.setFluidSpeed === "function") {
		visualiser.setFluidSpeed(value);
	}
}

export function setDevDebugMenuEnabled(enabled: boolean) {
	devDebugMenuEnabled = enabled;
	if (enabled) {
		if (!devMenu) {
			devMenu = new DevDebugMenu({
				getVisualiser: () => visualiser,
				onClose: () => {
					DataStoreService.devDebugMenuEnabled = false;
					setDevDebugMenuEnabled(false);
				},
				onSetEnhancedBackground: (v) => {
					DataStoreService.enhancedBackgroundEnabled = v;
					setEnhancedBackground(v);
				},
				onSetAppleFluidBackground: (v) => {
					DataStoreService.appleFluidBackgroundEnabled = v;
					setAppleFluidBackgroundEnabled(v);
				},
				onSetBackgroundMode: (m) => {
					DataStoreService.backgroundMode = m;
					setBackgroundMode(m);
				},
				onSetApolMode: (v) => {
					DataStoreService.apolMusicWannabeEnabled = v;
					setApolMusicWannabeEnabled(v);
				},
				onSetDynamicLerp: (v) => {
					DataStoreService.dynamicLerpEnabled = v;
					setDynamicLerpEnabled(v);
				},
				onSetDynamicIntensity: (v) => {
					DataStoreService.dynamicIntensityEnabled = v;
					setDynamicIntensityEnabled(v);
				},
				onSetIntensity: (v) => {
					DataStoreService.vignetteIntensity = Math.round(v * 10);
					setVignetteIntensity(v);
				},
				onSetSaturation: (v) => {
					DataStoreService.colorSaturation = Math.round(v * 10);
					setColorSaturation(v);
				},
				onSetDensity: (v) => {
					DataStoreService.circleDensity = Math.round(v * 10);
					setCircleDensity(v);
				},
				onSetOpacity: (v) => {
					DataStoreService.circleOpacity = Math.round(v * 10);
					setCircleOpacity(v);
				},
				onSetFluidSpeed: (v) => {
					DataStoreService.fluidSpeed = Math.round(v * 10);
					setFluidSpeed(v);
				},
			});
		}
	} else if (devMenu) {
		devMenu.destroy();
		devMenu = null;
	}
}

// Cleanup
unloads.add(() => {
	if (devMenu) {
		try {
			devMenu.destroy();
		} catch { }
		devMenu = null;
	}
	if (visualiser) {
		try {
			visualiser.disconnect();
			visualiser.destroy();
		} catch (error) {
			console.error("Error destroying visualiser:", error);
		} finally {
			visualiser = null;
		}
	}
});

// Initialization
initWhenReady();

export { initVisualiser, ensureVisualiserConnected };