/**
 * Audio Visualiser Module
 */

import { currentDevice } from ".";
import { DataStoreService } from "./Settings";
import { retrieveCoverArt, retrieveCoverArtVibrant } from "./ui-interface";

export interface AudioAnalysis {
	bass?: {
		strongest: {
			frequency: number;
			magnitude: number;
		};
		average: number;
		max: number;
		frequency: number;
	};
	bpm?: number;
	utime?: number | bigint;
}

export interface AudioVisualiserOptions {
	wsUrl?: string;
	autoReconnect?: boolean;
	maxReconnectAttempts?: number;
	reconnectDelay?: number;
	lerpFactor?: number;
	showStats?: boolean;
	showStatus?: boolean;
	zIndex?: number;
	isNowPlayingVisible?: boolean;
	intensityMultiplier?: number;
	useDynamicLerp?: boolean;
	useDynamicIntensity?: boolean;
	useDynamicColour?: boolean;
}

export interface AudioVisualiserAPI {
	destroy: () => void;
	reconnect: () => void;
	disconnect: () => void;
	isConnected: () => boolean;
	setLerpFactor: (factor: number) => void;
	togglePause: (pause: boolean) => void;
	deviceChanged: (deviceId: string) => void;
	setIntensityMultiplier?: (mult: number) => void;
	setDynamicLerpEnabled?: (enabled: boolean) => void;
	setDynamicIntensityEnabled?: (enabled: boolean) => void;
	setDynamicColour?: (enabled: boolean) => void;
}

class DynamicIntensityController {
	private smoothedEnergy: number = 0;
	private frequencySpread: number = 0;
	private bassPresence: number = 0;
	private readonly smoothingFactor: number = 0.1;

	calculateDynamicIntensity(analysis: AudioAnalysis): number {
		const bass = analysis.bass;
		if (!bass) return 0;

		// Bass presence: how much bass energy is present
		const rawBassPresence = Math.min(bass.average * 10000, 1);

		// Frequency spread: penalizes very narrow frequency content
		// (songs with only low bass should still be visible)
		const freqSpread = Math.min(bass.frequency / 200, 1);

		// Magnitude strength: the peak bass magnitude
		const magnitudeStrength = Math.min(bass.strongest.magnitude * 100, 1);

		// Smooth the bass presence to avoid jittery changes
		this.bassPresence += (rawBassPresence - this.bassPresence) * this.smoothingFactor;
		this.frequencySpread += (freqSpread - this.frequencySpread) * this.smoothingFactor;

		// Compute combined dynamic intensity
		// Weight: bass presence (60%), frequency diversity (20%), magnitude (20%)
		const dynamicIntensity =
			this.bassPresence * 0.6 +
			this.frequencySpread * 0.2 +
			magnitudeStrength * 0.2;

		return Math.min(dynamicIntensity, 1);
	}

	reset(): void {
		this.smoothedEnergy = 0;
		this.frequencySpread = 0;
		this.bassPresence = 0;
	}
}

class DynamicLerpController {
	private currentLerp: number = 0.5;
	private targetLerp: number = 0.5;
	private lerpTransitionSpeed: number = 0.05;

	private config = {
		bpmMin: 60,
		bpmMax: 180,
		lerpMin: 0.3,
		lerpMax: 0.8,
		curve: 'exponential' as 'linear' | 'exponential' | 'logarithmic'
	};

	constructor(config?: Partial<typeof this.config>) {
		if (config) {
			this.config = { ...this.config, ...config };
		}
	}
	calculateBPMLerp(bpm: number): number {
		const { bpmMin, bpmMax, lerpMin, lerpMax, curve } = this.config;

		const normalizedBPM = Math.min(Math.max((bpm - bpmMin) / (bpmMax - bpmMin), 0), 1);

		let curveFactor: number;
		switch (curve) {
			case 'exponential':
				curveFactor = Math.pow(normalizedBPM, 1.5);
				break;
			case 'logarithmic':
				curveFactor = Math.log1p(normalizedBPM * 9) / Math.log(10);
				break;
			case 'linear':
			default:
				curveFactor = normalizedBPM;
		}

		return lerpMin + (lerpMax - lerpMin) * curveFactor;
	}

	calculateEnergyLerp(energy: number): number {
		return this.config.lerpMin + (this.config.lerpMax - this.config.lerpMin) * energy;
	}

	calculateCombinedLerp(factors: {
		bpm?: number;
		energy?: number;
		loudness?: number;
		tempo?: number;
	}, weights: {
		bpm?: number;
		energy?: number;
		loudness?: number;
		tempo?: number;
	} = { bpm: 0.6, energy: 0.4 }): number {
		let totalWeight = 0;
		let weightedSum = 0;

		if (factors.bpm !== undefined && weights.bpm) {
			weightedSum += this.calculateBPMLerp(factors.bpm) * weights.bpm;
			totalWeight += weights.bpm;
		}

		if (factors.energy !== undefined && weights.energy) {
			weightedSum += this.calculateEnergyLerp(factors.energy) * weights.energy;
			totalWeight += weights.energy;
		}


		return totalWeight > 0 ? weightedSum / totalWeight : this.config.lerpMin;
	}

	update(targetLerp: number, deltaTime: number = 1 / 60): number {
		this.targetLerp = targetLerp;

		this.currentLerp += (this.targetLerp - this.currentLerp) * this.lerpTransitionSpeed;

		return this.currentLerp;
	}

	setTransitionSpeed(speed: number) {
		this.lerpTransitionSpeed = Math.min(Math.max(speed, 0.01), 1);
	}

	getCurrentLerp(): number {
		return this.currentLerp;
	}
}

export class AudioVisualiser implements AudioVisualiserAPI {
	private overlayWrapper: HTMLElement;
	private container: HTMLElement;
	public ws: WebSocket | null = null;
	private reconnectTimeout: number | null = null;
	private reconnectAttempts = 0;

	private elements: {
		vignette: HTMLElement;
		glowLayer: HTMLElement;
		pulseRing: HTMLElement;
	};

	private state = {
		currentVignetteSize: 100,
		currentVignetteBlur: 10,
		currentIntensity: 0,
		targetVignetteSize: 100,
		targetVignetteBlur: 10,
		targetIntensity: 0,
	};

	private isLoadingCoverArt: boolean = false;

	private options: Required<AudioVisualiserOptions>;
	private lerpController: DynamicLerpController;
	private dynamicIntensityController: DynamicIntensityController;
	private lastUpdateTime: number = 0;
	private updateIntervalMs: number = 33;
	private cachedVignetteColour: string = "255, 255, 255";
	private lastCoverUrl: string | null = null;

	constructor(
		containerSelector: string | HTMLElement,
		options: AudioVisualiserOptions = {}
	) {


		this.options = {
			wsUrl: 'ws://localhost:5343',
			autoReconnect: true,
			maxReconnectAttempts: 5,
			reconnectDelay: 2000,
			lerpFactor: 0.5,
			showStats: false,
			showStatus: false,
			zIndex: -1,
			intensityMultiplier: 1,
			useDynamicLerp: true,
			useDynamicIntensity: false,
			isNowPlayingVisible: false,
			useDynamicColour: false,
			...options,
		};

		this.lerpController = new DynamicLerpController({
			bpmMin: 80,      // Min BPM expected
			bpmMax: 180,     // Max BPM expected
			lerpMin: 0.3,    // Minimum lerp factor
			lerpMax: 0.8,    // Maximum lerp factor
			curve: 'exponential' // Curve type
		});

		this.lerpController.setTransitionSpeed(0.1); // Transition smoothness
		this.dynamicIntensityController = new DynamicIntensityController();

		this.container = this.resolveContainer(containerSelector);
		this.ensureContainerPosition();
		this.overlayWrapper = this.createOverlayWrapper();
		this.elements = this.createDOMStructure();
		this.connect();
	}

	// Resolves container from selector or element
	private resolveContainer(selector: string | HTMLElement): HTMLElement {
		if (typeof selector === 'string') {
			const element = document.querySelector<HTMLElement>(selector);
			if (!element) {
				throw new Error(`Container not found: ${selector}`);
			}
			return element;
		}
		return selector;
	}

	private ensureContainerPosition(): void {
		const position = window.getComputedStyle(this.container).position;
		if (position === 'static') {
			this.container.style.position = 'relative';
		}
	}

	private createOverlayWrapper(): HTMLElement {
		const wrapper = document.createElement('div');
		wrapper.style.cssText = `
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            height: 100% !important;
            overflow: hidden !important;
            pointer-events: none !important;
            z-index: ${this.options.zIndex} !important;
        `;
		this.container.appendChild(wrapper);
		return wrapper;
	}

	private createDOMStructure() {
		const visualiser = document.createElement('div');
		visualiser.style.cssText = `
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            height: 100% !important;
            background: transparent !important;
        `;

		const glowLayer = document.createElement('div');
		glowLayer.style.cssText = `
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            height: 100% !important;
            pointer-events: none !important;
            transition: background 0.08s ease-out !important;
        `;

		const vignette = document.createElement('div');
		vignette.style.cssText = `
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            height: 100% !important;
            pointer-events: none !important;
            opacity: 0.2 !important;
            transition: box-shadow 0.08s cubic-bezier(0.4, 0.0, 0.2, 1) !important;
        `;

		const pulseRing = document.createElement('div');
		pulseRing.style.cssText = `
            position: absolute !important;
            top: 50% !important;
            left: 50% !important;
            transform: translate(-50%, -50%) !important;
            width: 300px !important;
            height: 300px !important;
            border-radius: 50% !important;
            transition: all 0.08s ease-out !important;
            opacity: 0 !important;
            pointer-events: none !important;
        `;

		const status = document.createElement('div');
		status.textContent = 'Disconnected';
		status.style.cssText = `
            position: absolute !important;
            top: 20px !important;
            right: 20px !important;
            padding: 8px 16px !important;
            border-radius: 20px !important;
            font-size: 12px !important;
            font-weight: 500 !important;
            backdrop-filter: blur(10px) !important;
            pointer-events: all !important;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
            background: rgba(255, 50, 50, 0.15) !important;
            color: #ff3232 !important;
            border: 1px solid rgba(255, 50, 50, 0.3) !important;
            display: ${this.options.showStatus ? 'block' : 'none'} !important;
            z-index: ${this.options.zIndex} !important;
        `;

		const stats = document.createElement('div');
		stats.style.cssText = `
            position: absolute !important;
            bottom: 30px !important;
            left: 50% !important;
            transform: translateX(-50%) !important;
            display: ${this.options.showStats ? 'flex' : 'none'} !important;
            gap: 20px !important;
            z-index: ${this.options.zIndex} !important;
            pointer-events: all !important;
        `;

		const createStat = (label: string) => {
			const stat = document.createElement('div');
			stat.style.cssText = `
                background: rgba(255, 255, 255, 0.05) !important;
                backdrop-filter: blur(10px) !important;
                padding: 12px 20px !important;
                border-radius: 12px !important;
                border: 1px solid rgba(255, 255, 255, 0.1) !important;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
            `;

			const statLabel = document.createElement('div');
			statLabel.textContent = label;
			statLabel.style.cssText = `
                font-size: 11px !important;
                color: rgba(255, 255, 255, 0.5) !important;
                text-transform: uppercase !important;
                letter-spacing: 1px !important;
                margin-bottom: 4px !important;
            `;

			const statValue = document.createElement('div');
			statValue.textContent = '0';
			statValue.style.cssText = `
                font-size: 20px !important;
                font-weight: 600 !important;
                color: #fff !important;
            `;

			stat.appendChild(statLabel);
			stat.appendChild(statValue);

			return { stat, value: statValue };
		};

		const bassStat = createStat('Bass');
		const freqStat = createStat('Frequency');
		const bpmStat = createStat('BPM');

		stats.appendChild(bassStat.stat);
		stats.appendChild(freqStat.stat);
		stats.appendChild(bpmStat.stat);

		visualiser.appendChild(glowLayer);
		visualiser.appendChild(vignette);
		visualiser.appendChild(pulseRing);

		this.overlayWrapper.appendChild(visualiser);
		this.overlayWrapper.appendChild(status);
		this.overlayWrapper.appendChild(stats);

		return {
			vignette,
			glowLayer,
			pulseRing,
			status,
			stats,
			bassValue: bassStat.value,
			freqValue: freqStat.value,
			bpmValue: bpmStat.value,
		};
	}

	/**
	 * Linear interpolation for smooth transitions
	 */
	private lerp(start: number, end: number, factor: number): number {
		return start + (end - start) * factor;
	}

	// ws connection
	private connect(): void {
		try {
			this.ws = new WebSocket(this.options.wsUrl);

			this.ws.onopen = () => {
				this.ws?.send(currentDevice);
			};

			this.ws.onmessage = (event: MessageEvent) => {
				const now = performance.now();
				if (now - this.lastUpdateTime < this.updateIntervalMs) {
					return;
				}
				this.lastUpdateTime = now;
				try {
					const data: AudioAnalysis[] = JSON.parse(event.data);
					if (Array.isArray(data) && data.length > 0) {
						const analysis = data[0];
						this.update(analysis);
						if (analysis.bpm && this.options.useDynamicLerp) {
							const targetLerp = this.lerpController.calculateBPMLerp(analysis.bpm);
							const smoothLerp = this.lerpController.update(targetLerp);
							this.setLerpFactor(smoothLerp);
						}
					}
				} catch (error) {
					console.warn("Error parsing audio analysis:", error);
				}
			};

			this.ws.onerror = () => {
				// Connection error occurred
			};

			this.ws.onclose = () => {
				// If explicitly disconnected, don't reconnect
				if (!this.ws) return;

				// this.elements.status.textContent = 'Disconnected';
				// this.elements.status.style.background = 'rgba(255, 50, 50, 0.15)';
				// this.elements.status.style.color = '#ff3232';

				if (this.options.autoReconnect) {
					this.scheduleReconnect();
				}
			};
		} catch (error) {
			this.scheduleReconnect();
		}
	}

	public deviceChanged(deviceId: string): void {
		if (this.ws) {
			this.ws?.send(deviceId);
		}
	}

	private scheduleReconnect(): void {
		if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
			return;
		}

		this.reconnectAttempts++;
		const delay = this.options.reconnectDelay * this.reconnectAttempts;

		this.reconnectTimeout = window.setTimeout(() => {
			this.connect();
		}, delay);
	}

	public togglePause(pause: boolean): void {
		this.options.isNowPlayingVisible = pause;
	}

	/**
	 * Visualiser update
	 */
	private update(analysis: AudioAnalysis): void {
		if (!this.options.isNowPlayingVisible) {
			return;
		}

		const strongestBass = analysis.bass?.strongest;
		const bassAverage = analysis.bass?.average || 0;

		if (!strongestBass) {
			return;
		}

		// Calculate intensity based on frequency and magnitude
		const lowFreqIntensity = Math.max(0, 1 - (strongestBass.frequency - 20) / 200);
		const magnitudeIntensity = Math.min(bassAverage * 10000, 1);
		let baseIntensity = lowFreqIntensity * magnitudeIntensity;

		// Apply dynamic intensity if enabled—scales based on multiple audio factors
		if (this.options.useDynamicIntensity) {
			const dynamicFactor = this.dynamicIntensityController.calculateDynamicIntensity(analysis);
			baseIntensity = Math.max(baseIntensity, dynamicFactor * 0.5);
		}

		const totalIntensity = baseIntensity * (this.options.intensityMultiplier ?? 1);

		// Update target values
		this.state.targetVignetteSize = 100 + totalIntensity * 300;
		this.state.targetVignetteBlur = 10 + totalIntensity * 200;
		this.state.targetIntensity = totalIntensity;

		const { lerpFactor } = this.options;
		const attackFactor = lerpFactor;
		const decayFactor = lerpFactor * 0.15;

		const getFactor = (current: number, target: number) =>
			target > current ? attackFactor : decayFactor;

		this.state.currentVignetteSize = this.lerp(
			this.state.currentVignetteSize,
			this.state.targetVignetteSize,
			getFactor(this.state.currentVignetteSize, this.state.targetVignetteSize)
		);
		this.state.currentVignetteBlur = this.lerp(
			this.state.currentVignetteBlur,
			this.state.targetVignetteBlur,
			getFactor(this.state.currentVignetteBlur, this.state.targetVignetteBlur)
		);
		this.state.currentIntensity = this.lerp(
			this.state.currentIntensity,
			this.state.targetIntensity,
			getFactor(this.state.currentIntensity, this.state.targetIntensity)
		);

		this.applyEffects(strongestBass.frequency);
	}

	/**
	* Applies visual effects based on current state
	*/
	private async applyEffects(frequency: number): Promise<void> {
		const { currentVignetteSize, currentVignetteBlur, currentIntensity } = this.state;

		const leftIntensity = currentIntensity * 0.7;
		const bottomIntensity = currentIntensity * 0.6;

		if (DataStoreService.vignetteUsesArtworkColourEnabled == true) {
			const coverUrl = retrieveCoverArt();
			if (coverUrl && coverUrl !== this.lastCoverUrl) {
				this.lastCoverUrl = coverUrl;
				// console.log("[reactivo] New cover detected:", coverUrl);

				if (!this.isLoadingCoverArt) {
					this.isLoadingCoverArt = true;
					// Fire and forget
					this.loadCoverArtColor(coverUrl).catch(err => {
						console.error("[reactivo] Error loading cover art:", err);
						this.cachedVignetteColour = "255, 255, 255";
						this.isLoadingCoverArt = false;
					});
				}
			}
		} else {
			this.cachedVignetteColour = "255, 255, 255";
			this.lastCoverUrl = null;
		}

		const vignetteColour = this.cachedVignetteColour;
		// console.log("[reactivo] Using vignette colour:", vignetteColour);

		let vignetteBoxShadow = `
        inset 0 0 ${currentVignetteSize}px ${currentVignetteBlur}px rgba(${vignetteColour}, ${0.4 + currentIntensity * 0.6}),
        inset 0 0 ${currentVignetteSize * 0.7}px ${currentVignetteBlur * 0.7}px rgba(${vignetteColour}, ${currentIntensity * 0.8}),
        inset 0 0 ${currentVignetteSize * 0.5}px ${currentVignetteBlur * 0.5}px rgba(${vignetteColour}, ${currentIntensity * 0.6}),
        inset ${currentVignetteSize * 0.4}px 0 ${currentVignetteBlur * 1.2}px ${currentVignetteBlur * 0.3}px rgba(${vignetteColour}, ${leftIntensity}),
        inset 0 ${currentVignetteSize * 0.3}px ${currentVignetteBlur * 1.2}px ${currentVignetteBlur * 0.3}px rgba(${vignetteColour}, ${bottomIntensity})
    `;

		this.elements.vignette.style.boxShadow = vignetteBoxShadow;

		const hue = 200 + frequency / 10;
		// use same colour as vignette for the glow, with alpha based on intensity
		const glowBackground = `
    radial-gradient(ellipse 140% 120% at 35% 70%,
        rgba(${vignetteColour}, ${currentIntensity * 0.35}) 0%,
        rgba(${vignetteColour}, ${currentIntensity * 0.18}) 30%,
        transparent 70%
    )
`;
		this.elements.glowLayer.style.background = glowBackground;

		const ringSize = 200 + currentIntensity * 600;
		this.elements.pulseRing.style.width = `${ringSize}px`;
		this.elements.pulseRing.style.height = `${ringSize}px`;
	}

	private async loadCoverArtColor(coverUrl: string): Promise<void> {
		try {
			// console.log("[reactivo] Fetching image via fetch API...");

			const response = await fetch(coverUrl, {
				mode: 'cors',
				cache: 'force-cache'
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			const blob = await response.blob();
			const blobUrl = URL.createObjectURL(blob);

			// console.log("[reactivo] Blob created, loading image...");

			const tempImg = new Image();

			tempImg.onload = () => {
				// console.log("[reactivo] ✓ Image loaded from blob");
				// console.log("[reactivo] Dimensions:", tempImg.naturalWidth, "x", tempImg.naturalHeight);

				try {
					const colour = retrieveCoverArtVibrant(tempImg) as any;

					if (colour && colour !== "255, 255, 255") {
						// console.log("[reactivo] ✓ Extracted vibrant color:", colour);
						this.cachedVignetteColour = colour;
					} else {
						// console.warn("[reactivo] Default color returned");
						this.cachedVignetteColour = "255, 255, 255";
					}
				} catch (error) {
					console.error("[reactivo] Error extracting color:", error);
					this.cachedVignetteColour = "255, 255, 255";
				} finally {
					URL.revokeObjectURL(blobUrl);
					this.isLoadingCoverArt = false;
				}
			};

			tempImg.onerror = (error) => {
				console.error("[reactivo] Error loading blob image:", error);
				URL.revokeObjectURL(blobUrl);
				this.cachedVignetteColour = "255, 255, 255";
				this.isLoadingCoverArt = false;
			};

			// No need for crossOrigin with blob URLs
			tempImg.src = blobUrl;

		} catch (error) {
			console.error("[reactivo] Fetch error:", error);

			console.log("[reactivo] Trying direct load without CORS...");

			const tempImg = new Image();

			tempImg.onload = async () => {
				console.log("[reactivo] ✓ Direct load successful (but may fail on getImageData)");

				try {
					const colour = await retrieveCoverArtVibrant(tempImg);

					if (colour && colour !== "255, 255, 255") {
						console.log("[reactivo] ✓ Color extracted:", colour);
						this.cachedVignetteColour = colour;
					} else {
						this.cachedVignetteColour = "255, 255, 255";
					}
				} catch (error) {
					console.error("[reactivo] CORS blocked getImageData:", error);
					this.cachedVignetteColour = "255, 255, 255";
				} finally {
					this.isLoadingCoverArt = false;
				}
			};

			tempImg.onerror = () => {
				console.error("[reactivo] Direct load also failed");
				this.cachedVignetteColour = "255, 255, 255";
				this.isLoadingCoverArt = false;
			};

			tempImg.src = coverUrl;
		}
	}

	public disconnect(): void {
		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
			this.reconnectTimeout = null;
		}
		if (this.ws) {
			this.ws.onopen = null;
			this.ws.onmessage = null;
			this.ws.onclose = null;
			this.ws.onerror = null;
			this.ws.close(1000, 'Client disconnect');
			this.ws = null;
		}
	}

	public reconnect(): void {
		this.disconnect();
		this.reconnectAttempts = 0;
		this.connect();
	}

	public isConnected(): boolean {
		return this.ws?.readyState === WebSocket.OPEN;
	}

	public setLerpFactor(factor: number): void {
		this.options.lerpFactor = Math.max(0, Math.min(1, factor));
	}

	public setIntensityMultiplier(mult: number): void {
		this.options.intensityMultiplier = Math.max(0, mult);
	}

	public setDynamicLerpEnabled(enabled: boolean): void {
		this.options.useDynamicLerp = !!enabled;
	}

	public setDynamicIntensityEnabled(enabled: boolean): void {
		this.options.useDynamicIntensity = enabled;
	}

	public setDynamicColour(enabled: boolean): void {
		this.options.useDynamicColour = enabled;
		if (!enabled) {
			this.cachedVignetteColour = "255, 255, 255";
			this.lastCoverUrl = null;
		}
	}

	public destroy(): void {
		this.disconnect();
		if (this.overlayWrapper?.parentNode) {
			this.overlayWrapper.parentNode.removeChild(this.overlayWrapper);
		}
	}
}

export function createAudioVisualiser(
	container: string | HTMLElement,
	options?: AudioVisualiserOptions
): AudioVisualiserAPI {
	return new AudioVisualiser(container, options);
}

export default createAudioVisualiser;
