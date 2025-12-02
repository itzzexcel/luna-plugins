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

import { LunaUnload, reduxStore, Tracer } from "@luna/core";
import { MediaItem, redux } from "@luna/lib";
import { GetNPView } from "./ui-interface";
import createAudioVisualiser, { AudioVisualiserAPI } from "./giragira";

export const { trace, errSignal } = Tracer("[reactivo]");
export const unloads = new Set<LunaUnload>();

// Visualiser instance (initially null)
let visualiser: AudioVisualiserAPI | null = null;

/**
 * Initialises or reinitialises the visualiser
 */
const initVisualiser = (): void => {
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
			lerpFactor: 0.5,
			wsUrl: 'ws://localhost:5343',
			autoReconnect: true,
			maxReconnectAttempts: 100,
			showStatus: false,
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

// Start initialization
initWhenReady();

redux.intercept("view/ENTERED_NOWPLAYING", unloads, function () {
	visualiser?.reconnect();
	if (visualiser?.isConnected) {
		initVisualiser();
		console.log("reconnected successfully");

	}
});

redux.intercept("view/EXITED_NOWPLAYING", unloads, function () {
	// Stop rendering
	visualiser?.disconnect();
	visualiser?.destroy();
	console.log("visualiser disconnected");

})



// Cleanup when plugin unloads
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

// Handle media transitions
MediaItem.onMediaTransition(unloads, async (mediaItem) => {
	if (!mediaItem) {
		if (visualiser) {
			visualiser.disconnect();
		}
		return;
	}

	try {
		// Verify container is available
		const currentContainer = GetNPView();

		// Reinitialise if visualiser doesn't exist
		if (!visualiser) {
			initVisualiser();
			return;
		}

		// Ensure connection is active
		ensureVisualiserConnected();

		// Adjust settings for new track
		visualiser.setLerpFactor(0.5);

	} catch (error) {
		console.error("Error in media transition:", error);
		initVisualiser();
	}
});

// Export utility functions
export { initVisualiser, ensureVisualiserConnected };
