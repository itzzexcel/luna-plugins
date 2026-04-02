import { LunaUnload, Tracer } from "@luna/core";
import { MediaItem, redux } from "@luna/lib";
import { GetNPView, getFeatureFlag } from "./ui-interface";

import createAudioVisualiser, { AudioVisualiserAPI } from "./giragira";
import { DataStoreService } from "./Settings";

export { Settings } from "./Settings";
export const { trace, errSignal } = Tracer("[reactivo]");
export const unloads = new Set<LunaUnload>();

// Global state
let visualiser: AudioVisualiserAPI | null = null;
export let availableDevices: any[] = [];
export let currentDevice: string = "";

export let vignetteIntensity: number = DataStoreService.vignetteIntensity;
export let dynamicLerpEnabled: boolean = true;
export let dynamicIntensityEnabled: boolean = false;
export let dynamicCoverColour: boolean = false;

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

	try {
		// Clean up previous instance if it exists
		if (visualiser) {
			visualiser.disconnect();
			visualiser.destroy();
			visualiser = null;
		}

		// Get container element
		const nowPlaying = GetNPView();

		// Create new visualiser instance
		visualiser = createAudioVisualiser(nowPlaying, {
			lerpFactor: 0.2,
			wsUrl: "ws://localhost:5343",
			autoReconnect: true,
			maxReconnectAttempts: 100,
			showStatus: false,
			showStats: false,
			intensityMultiplier: vignetteIntensity,
			useDynamicLerp: dynamicLerpEnabled,
			useDynamicIntensity: dynamicIntensityEnabled,
			useDynamicColour: dynamicCoverColour,
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
		document.addEventListener("DOMContentLoaded", initVisualiser);
	} else {
		initVisualiser();
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

export function setDynamicColourArt(enabled: boolean) {
	dynamicCoverColour = enabled;
	if (visualiser && typeof visualiser.setDynamicColour === "function") {
		visualiser.setDynamicColour(enabled);
	}
}

// Cleanup
unloads.add(() => {
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