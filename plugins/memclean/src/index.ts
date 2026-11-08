import { LunaUnload, Tracer } from "@luna/core";
import { MediaItem, redux } from "@luna/lib";
import { DataStoreService } from "./Settings";
import { ImageTrimmer } from "./imageTrimmer";
import { Hibernator } from "./hibernator";
import { GCManager } from "./gcManager";

export { Settings } from "./Settings";
export const { trace, errSignal } = Tracer("[memclean]");
export const unloads = new Set<LunaUnload>();

// Initialize core managers
const imageTrimmer = new ImageTrimmer(DataStoreService.trimOffscreenImages);

const gcManager = new GCManager(
	DataStoreService.periodicSweepEnabled ?? true,
	2,
	() => {
		imageTrimmer.trimAllOffscreen();
	}
);

const hibernator = new Hibernator(
	DataStoreService.hibernateInBackground,
	DataStoreService.pauseBackgroundVideos,
	() => {
		imageTrimmer.trimAllOffscreen();
		gcManager.runIdleCleanup();
	}
);

// Hook into track changes to release memory from previously played tracks
MediaItem.onMediaTransition(unloads, (mediaItem: MediaItem) => {
	if (DataStoreService.trackChangePurge) {
		imageTrimmer.trimAllOffscreen();
		gcManager.runIdleCleanup();
	}
});

// Hook into view exits to purge lingering off-screen component allocations
try {
	redux.intercept("view/EXITED_NOWPLAYING", unloads, () => {
		imageTrimmer.trimAllOffscreen();
		gcManager.runIdleCleanup();
	});
} catch { }

// Register cleanup upon plugin unload
unloads.add(() => {
	imageTrimmer.stop();
	hibernator.stop();
	gcManager.destroy();
});

// Settings handlers
export function setTrimOffscreenImages(enabled: boolean): void {
	imageTrimmer.setEnabled(enabled);
}

export function setPeriodicSweepEnabled(enabled: boolean): void {
	gcManager.setEnabled(enabled);
}

export function setHibernateInBackground(enabled: boolean): void {
	hibernator.setEnabled(enabled);
}

export function setTrackChangePurge(enabled: boolean): void {
	gcManager.setEnabled(enabled);
}

export function setPauseBackgroundVideos(enabled: boolean): void {
	hibernator.setPauseVideos(enabled);
}
