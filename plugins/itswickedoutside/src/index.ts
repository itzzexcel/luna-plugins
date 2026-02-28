/*
Le caes a todos bien
Todos te ríen la gracia
Tienes un gesto extraño
A mí no me engañas

Así que eres humilde
Teniendo un barco en casa
Arqueaste la ceja
Porque por mí no pasas

No me mola tu forma de hablar
No me fío
No me importa dónde quieres llegar
No me fío

Estás usando tu control mental
Quieres hacerme el lío
No me trago tu juego emocional
No me fío

No creías tan pronto
Verte así destapado
Conmigo no sirve eso
De hacerte el colocado

Tranquilo, no diré nada
Me la sudan tus juegos
Solo mantén la distancia
Y no me rompas los huevo

No me mola tu forma de hablar
No me fío
No me importa dónde quieres llegar
No me fío

Estás usando tu control mental
Quieres hacerme el lío
No me trago tu juego emocional
No me fío
*/

import { LunaUnload, Tracer } from "@luna/core";
import { MediaItem, redux } from "@luna/lib";
import { GetNPView } from "./ui-interface";


import createAudioVisualiser, { AudioVisualiserAPI } from "./giragira";
import { DataStoreService, Settings } from "./Settings";

export { Settings } from "./Settings";
export const { trace, errSignal } = Tracer("[reactivo]");
export const unloads = new Set<LunaUnload>();

// Instances (initially null)
let visualiser: AudioVisualiserAPI | null = null;
export let availableDevices: any[] = [];
export let currentDevice: string = "";

export let vignetteIntensity: number = 1;
export let dynamicLerpEnabled: boolean = true;
export let dynamicIntensityEnabled: boolean = false;
export let dynamicCoverColour: boolean = false;

/**
 * Initialises or reinitialises the visualiser
 */
const initVisualiser = (): void => {
	if (DataStoreService.isFirstRan === false) {
		try {
			window.open("https://github.com/itzzexcel/luna-plugins/tree/master/plugins/itswickedoutside#installation");
		} catch (e) { }
		DataStoreService.isFirstRan = true;
	} else {
		console.log("[reactivo] installation screen skipped");

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

		// Create new visualiser instance
		visualiser = createAudioVisualiser(nowPlaying, {
			lerpFactor: 0.2,
			wsUrl: 'ws://localhost:5343',
			autoReconnect: true,
			maxReconnectAttempts: 100,
			showStatus: false,
			showStats: false,
			intensityMultiplier: vignetteIntensity,
			useDynamicLerp: dynamicLerpEnabled,
			useDynamicIntensity: dynamicIntensityEnabled,
			useDynamicColour: dynamicCoverColour,
		});

	} catch (error) {
		console.error("Failed to initialize visualiser:", error);
		visualiser = null;
	}
};

/**
 * Ensures visualiser is connected, reconnects if necessary
 */
const ensureVisualiserConnected = (): void => {
	if (!visualiser) {
		initVisualiser();
		return;
	}

	if (!visualiser.isConnected()) {
		visualiser.reconnect();
	}
};

/**
 * Initialises visualiser when DOM is ready
 */
const initWhenReady = (): void => {
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initVisualiser);
	} else {
		initVisualiser();
	}
};

// Start initialisation
initWhenReady();

redux.intercept("view/ENTERED_NOWPLAYING", unloads, function () {
	visualiser?.togglePause(true);
	if (!visualiser) {
		initVisualiser();
	} else {
		visualiser.reconnect();
		if (visualiser.isConnected()) {
			console.log("[reactivo] reconnected successfully");
		}
	}
});

redux.intercept("view/EXITED_NOWPLAYING", unloads, function () {
	visualiser?.togglePause(false);
	visualiser?.disconnect();

});

redux.intercept("player/SET_ACTIVE_DEVICE_SUCCESS", unloads, function (x: any) {

	if (Array.isArray(availableDevices) && availableDevices.length === 0) {
		console.log("[reactivo] No available devices, forcing the redux to set again the thingaling bleh");
	}

	if (Array.isArray(availableDevices)) {
		let deviceObject = availableDevices.find((d: any) => d.id === x);
		if (deviceObject) {
			console.log("[reactivo] Native Device ID:", deviceObject.nativeDeviceId);
			currentDevice = deviceObject.nativeDeviceId;
			if (visualiser) {
				visualiser.deviceChanged(deviceObject.nativeDeviceId);
			}
		}
	}
});

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

MediaItem.onMediaTransition(unloads, async (mediaItem: MediaItem) => {
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

// UI / settings hooks
export function setVignetteIntensity(value: number) {
	vignetteIntensity = value;
	if (visualiser && typeof visualiser.setIntensityMultiplier === 'function') {
		visualiser.setIntensityMultiplier(value);
	}
}

export function setDynamicLerpEnabled(enabled: boolean) {
	dynamicLerpEnabled = enabled;
	if (visualiser && typeof visualiser.setDynamicLerpEnabled === 'function') {
		visualiser.setDynamicLerpEnabled(enabled);
	}
}

export function setDynamicIntensityEnabled(enabled: boolean) {
	dynamicIntensityEnabled = enabled;
	if (visualiser && typeof visualiser.setDynamicIntensityEnabled === 'function') {
		visualiser.setDynamicIntensityEnabled(enabled);
	}
}

export function setDynamicColourArt(enabled: boolean) {
	dynamicCoverColour = enabled;
	if (visualiser && typeof visualiser.setDynamicColour === 'function') {
		visualiser.setDynamicColour(enabled);
	}
}

export { initVisualiser, ensureVisualiserConnected };
