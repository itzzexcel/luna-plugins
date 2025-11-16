import { LunaUnload, Tracer } from "@luna/core";
import { MediaItem } from "@luna/lib";
import { GetNPView } from "./ui-interface";
import createAudioVisualiser, { AudioVisualiserAPI } from "./giragira";

export const { trace, errSignal } = Tracer("[Awesome Lyrics]");
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
