/**
 * Garbage Collection & Memory Pressure Manager (MemClean)
 * Periodically hints V8 to run scavenge passes, trims off-screen caches,
 * and flushes stale track metadata.
 */

export class GCManager {
	private enabled = true;
	private idleTimeout: number | null = null;
	private intervalId: number | null = null;
	private periodicMinutes = 2;
	private onPeriodicSweep?: () => void;

	constructor(enabled = true, periodicMinutes = 2, onPeriodicSweep?: () => void) {
		this.enabled = enabled;
		this.periodicMinutes = periodicMinutes;
		this.onPeriodicSweep = onPeriodicSweep;

		if (this.enabled) {
			this.startInterval();
		}
	}

	public setEnabled(enabled: boolean): void {
		this.enabled = enabled;
		if (enabled) {
			this.startInterval();
		} else {
			this.stopInterval();
		}
	}

	public setPeriodicMinutes(minutes: number): void {
		this.periodicMinutes = Math.max(1, minutes);
		if (this.enabled) {
			this.stopInterval();
			this.startInterval();
		}
	}

	private startInterval(): void {
		if (this.intervalId !== null) return;
		const ms = this.periodicMinutes * 60 * 1000;
		this.intervalId = window.setInterval(() => {
			this.onPeriodicSweep?.();
			this.runIdleCleanup();
		}, ms);
	}

	private stopInterval(): void {
		if (this.intervalId !== null) {
			window.clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	/**
	 * Triggers memory cleanup during idle time.
	 */
	public runIdleCleanup(): void {
		if (!this.enabled) return;

		if (this.idleTimeout !== null) {
			window.clearTimeout(this.idleTimeout);
		}

		this.idleTimeout = window.setTimeout(() => {
			this.idleTimeout = null;
			this.performCleanup();
		}, 500);
	}

	private performCleanup(): void {
		try {
			// If Chromium was started with --js-flags="--expose-gc", call V8 directly
			const globalGc = (window as unknown as { gc?: () => void }).gc;
			if (typeof globalGc === "function") {
				globalGc();
				return;
			}

			// In standard Electron without flag:
			// Schedule in requestIdleCallback to hint V8 nursery collection during idle
			const runNudge = () => {
				let dummy: Uint8Array | null = new Uint8Array(64 * 1024);
				dummy[0] = 1;
				dummy = null;
			};

			if ("requestIdleCallback" in window) {
				(window as unknown as { requestIdleCallback: (fn: () => void, opts: { timeout: number }) => void })
					.requestIdleCallback(runNudge, { timeout: 1000 });
			} else {
				runNudge();
			}
		} catch { }
	}

	public destroy(): void {
		this.stopInterval();
		if (this.idleTimeout !== null) {
			window.clearTimeout(this.idleTimeout);
			this.idleTimeout = null;
		}
	}
}
