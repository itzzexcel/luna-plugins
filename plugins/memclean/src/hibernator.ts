/**
 * Hibernator for Tidal (MemClean)
 * Pauses unnecessary animations, video buffers, and rendering loops when Tidal
 * is minimized or placed in the background.
 */

export class Hibernator {
	private enabled = true;
	private pauseVideos = true;
	private isHibernating = false;
	private styleElement: HTMLStyleElement | null = null;
	private onVisibilityChangeBound: () => void;
	private onIdleCleanup?: () => void;

	constructor(enabled = true, pauseVideos = true, onIdleCleanup?: () => void) {
		this.enabled = enabled;
		this.pauseVideos = pauseVideos;
		this.onIdleCleanup = onIdleCleanup;
		this.onVisibilityChangeBound = this.onVisibilityChange.bind(this);

		if (this.enabled) {
			this.start();
		}
	}

	public setEnabled(enabled: boolean): void {
		if (this.enabled === enabled) return;
		this.enabled = enabled;
		if (enabled) {
			this.start();
		} else {
			this.stop();
		}
	}

	public setPauseVideos(pause: boolean): void {
		this.pauseVideos = pause;
	}

	public start(): void {
		this.ensureStyle();
		document.addEventListener("visibilitychange", this.onVisibilityChangeBound);
		window.addEventListener("blur", this.onVisibilityChangeBound);
		window.addEventListener("focus", this.onVisibilityChangeBound);
		this.checkState();
	}

	public stop(): void {
		document.removeEventListener("visibilitychange", this.onVisibilityChangeBound);
		window.removeEventListener("blur", this.onVisibilityChangeBound);
		window.removeEventListener("focus", this.onVisibilityChangeBound);
		this.wakeUp();
		if (this.styleElement?.parentNode) {
			this.styleElement.parentNode.removeChild(this.styleElement);
			this.styleElement = null;
		}
	}

	private ensureStyle(): void {
		if (this.styleElement) return;
		this.styleElement = document.createElement("style");
		this.styleElement.id = "memclean-hibernation-styles";
		this.styleElement.textContent = `
			html.memclean-hibernating * {
				animation-play-state: paused !important;
			}
			html.memclean-hibernating video:not([data-test*="main-video"]) {
				opacity: 0 !important;
				pointer-events: none !important;
			}
			html.memclean-hibernating [class*="_videoFallback"] {
				display: none !important;
			}
		`;
		document.head.appendChild(this.styleElement);
	}

	private onVisibilityChange(): void {
		this.checkState();
	}

	private checkState(): void {
		if (!this.enabled) return;

		// Consider hidden if document is hidden or window is not focused
		const shouldHibernate = document.hidden;
		if (shouldHibernate && !this.isHibernating) {
			this.hibernate();
		} else if (!shouldHibernate && this.isHibernating) {
			this.wakeUp();
		}
	}

	private hibernate(): void {
		this.isHibernating = true;
		document.documentElement.classList.add("memclean-hibernating");

		if (this.pauseVideos) {
			// Pause video elements to purge hardware decoding framebuffers in Chromium
			document.querySelectorAll<HTMLVideoElement>("video").forEach((video) => {
				if (!video.paused) {
					try {
						video.dataset.memcleanWasPlaying = "true";
						video.pause();
					} catch { }
				}
			});
		}

		// Nudge GC when entering background
		this.onIdleCleanup?.();
	}

	private wakeUp(): void {
		this.isHibernating = false;
		document.documentElement.classList.remove("memclean-hibernating");

		// Resume videos that were paused during hibernation
		document.querySelectorAll<HTMLVideoElement>("video[data-memclean-was-playing]").forEach((video) => {
			delete video.dataset.memcleanWasPlaying;
			try {
				video.play().catch(() => { });
			} catch { }
		});
	}
}

