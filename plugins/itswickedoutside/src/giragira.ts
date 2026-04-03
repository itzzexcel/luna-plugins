/**
* Audio Visualiser Module
*/

import { currentDevice, Settings } from ".";
import { DataStoreService } from "./Settings";
import {
	retrieveCoverArt,
	retrieveCoverArtVibrant,
	retrieveCoverArtPalette,
} from "./ui-interface";

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
	useEnhancedBackground?: boolean;
	backgroundMode?: 'circles' | 'images';
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
	setEnhancedBackground?: (enabled: boolean) => void;
	setBackgroundMode?: (mode: 'circles' | 'images') => void;
}

class DynamicIntensityController {
	private smoothedEnergy: number = 0;
	private frequencySpread: number = 0;
	private bassPresence: number = 0;
	private readonly smoothingFactor: number = 0.1;

	calculateDynamicIntensity(analysis: AudioAnalysis): number {
		const bass = analysis.bass;
		if (!bass) return 0;

		const rawBassPresence = Math.min(bass.average * 10000, 1);
		const freqSpread = Math.min(bass.frequency / 200, 1);
		const magnitudeStrength = Math.min(bass.strongest.magnitude * 100, 1);

		this.bassPresence += (rawBassPresence - this.bassPresence) * this.smoothingFactor;
		this.frequencySpread += (freqSpread - this.frequencySpread) * this.smoothingFactor;

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
		currentCircleIntensity: 0,
		targetVignetteSize: 100,
		targetVignetteBlur: 10,
		targetIntensity: 0,
		targetCircleIntensity: 0,
	};

	private isLoadingCoverArt: boolean = false;

	private options: Required<AudioVisualiserOptions>;
	private lerpController: DynamicLerpController;
	private dynamicIntensityController: DynamicIntensityController;
	private lastUpdateTime: number = 0;
	private updateIntervalMs: number = 0; // 0 = uncapped, use requestAnimationFrame
	private animationFrameId: number | null = null;
	private pendingAudioData: AudioAnalysis | null = null;
	private cachedVignetteColour: string = "255, 255, 255";
	private lastCoverUrl: string | null = null;
	private cachedAtmospherePalette: string[] = [];
	private imageCache: Map<string, { colour: string; palette: string[]; timestamp: number }> = new Map();
	private readonly CACHE_TTL = 300000; // 5 minutes
	private atmosphereLayer: HTMLElement | null = null;
	private coverSpinner: HTMLElement | null = null;
	private atmosphereCircles: Array<{
		element: HTMLElement;
		baseX: number;
		baseY: number;
		size: number;
		reactToBass: boolean;
		offsetX: number;
		offsetY: number;
		staticCorner?: boolean;
		inUse: boolean;
	}> = [];
	private circlePool: HTMLElement[] = [];

	// Initialization
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
			zIndex: 0,
			intensityMultiplier: 1,
			useDynamicLerp: true,
			useDynamicIntensity: false,
			isNowPlayingVisible: false,
			useEnhancedBackground: false,
			backgroundMode: 'circles',
			...options,
		};

		this.lerpController = new DynamicLerpController({
			bpmMin: 80,
			bpmMax: 180,
			lerpMin: 0.3,
			lerpMax: 0.8,
			curve: 'exponential'
		});

		this.lerpController.setTransitionSpeed(0.1);
		this.dynamicIntensityController = new DynamicIntensityController();

		this.container = this.resolveContainer(containerSelector);
		this.ensureContainerPosition();
		this.overlayWrapper = this.createOverlayWrapper();
		this.atmosphereLayer = this.createAtmosphereLayer();
		this.elements = this.createDOMStructure();
		this.atmosphereLayer.style.opacity = this.options.useEnhancedBackground ? '1' : '0';
		this.connect();
	}

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

	private rgbToHsv(r: number, g: number, b: number) {
		r /= 255;
		g /= 255;
		b /= 255;
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		const d = max - min;
		let h = 0;
		if (d !== 0) {
			if (max === r) {
				h = ((g - b) / d) % 6;
			} else if (max === g) {
				h = (b - r) / d + 2;
			} else {
				h = (r - g) / d + 4;
			}
			h *= 60;
			if (h < 0) h += 360;
		}
		const s = max === 0 ? 0 : d / max;
		const v = max;
		return { h, s, v };
	}

	private hsvToRgb(h: number, s: number, v: number) {
		const c = v * s;
		const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
		const m = v - c;
		let r = 0,
			g = 0,
			b = 0;

		if (h < 60) {
			r = c;
			g = x;
			b = 0;
		} else if (h < 120) {
			r = x;
			g = c;
			b = 0;
		} else if (h < 180) {
			r = 0;
			g = c;
			b = x;
		} else if (h < 240) {
			r = 0;
			g = x;
			b = c;
		} else if (h < 300) {
			r = x;
			g = 0;
			b = c;
		} else {
			r = c;
			g = 0;
			b = x;
		}

		return {
			r: Math.round((r + m) * 255),
			g: Math.round((g + m) * 255),
			b: Math.round((b + m) * 255),
		};
	}

	private formatRgbColor(color: string): string {
		const cleaned = color.trim();
		const rgbMatch = cleaned.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
		if (rgbMatch) return `rgb(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]})`;
		const rawMatch = cleaned.match(/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/);
		if (rawMatch) return `rgb(${rawMatch[1]}, ${rawMatch[2]}, ${rawMatch[3]})`;
		return color;
	}

	private toneDownCircleColor(color: string): string {
		const match = color.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
		if (!match) return color;
		const r = Number(match[1]);
		const g = Number(match[2]);
		const b = Number(match[3]);
		const { h, s, v } = this.rgbToHsv(r, g, b);

		const targetS = Math.min(s, 0.96);
		const saturationBoost = 2 - targetS; // less saturated colors can stay brighter
		const brightnessScale = 2 - targetS * 0.32; // more saturated colors are dimmed more
		const rawV = v * brightnessScale + saturationBoost * 0.18;

		const minBrightness = 0.25;
		const maxBrightness = 0.78;
		const targetV = Math.min(Math.max(rawV, minBrightness), maxBrightness);

		const toned = this.hsvToRgb(h, targetS, targetV);
		return `rgb(${toned.r}, ${toned.g}, ${toned.b})`;
	}

	private createRadialCircleGradient(primaryColor: string, accentColor?: string): string {
		const accent = accentColor ? this.toneDownCircleColor(accentColor) : primaryColor;
		const positionX = 30 + Math.random() * 40;
		const positionY = 30 + Math.random() * 40;
		return `radial-gradient(circle at ${positionX}% ${positionY}%, ${primaryColor} 0%, ${primaryColor} 26%, ${accent} 30%, ${accent} 34%, rgba(0, 0, 0, 0.08) 36%, transparent 44%)`;
	}

	private createCoverFragmentBackground(coverUrl: string | null, primaryColor: string, accentColor?: string): string {
		if (!coverUrl || this.options.backgroundMode === 'images') {
			return this.createRadialCircleGradient(primaryColor, accentColor);
		}

		const accent = accentColor ? this.toneDownCircleColor(accentColor) : primaryColor;
		const coverPosX = 25 + Math.random() * 50;
		const coverPosY = 25 + Math.random() * 50;
		const coverScale = 120 + Math.random() * 40;
		const coverGhostX = coverPosX + (Math.random() - 0.5) * 18;
		const coverGhostY = coverPosY + (Math.random() - 0.5) * 18;
		const coverGhostScale = coverScale * (0.92 + Math.random() * 0.12);
		const overlayPosX = 30 + Math.random() * 40;
		const overlayPosY = 30 + Math.random() * 40;
		return `radial-gradient(circle at ${overlayPosX}% ${overlayPosY}%, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0.08) 14%, rgba(0,0,0,0.34) 42%, transparent 56%) no-repeat center center,
            repeating-linear-gradient(0deg, rgba(255,255,255,0.04) 0 1px, rgba(0,0,0,0.04) 1px 2px) no-repeat center center,
            url("${coverUrl}") no-repeat ${coverPosX}% ${coverPosY}% / ${coverScale}% auto,
            url("${coverUrl}") no-repeat ${coverGhostX}% ${coverGhostY}% / ${coverGhostScale}% auto`;
	}

	private updateAtmosphereLayerBackground(coverUrl: string | null): void {
		if (!this.atmosphereLayer) return;
		if (coverUrl && this.options.backgroundMode === 'images') {
			this.atmosphereLayer.style.backgroundImage = `url("${coverUrl}")`;
			this.atmosphereLayer.style.backgroundSize = '150% 150%';
			this.atmosphereLayer.style.backgroundPosition = 'center center';
			this.atmosphereLayer.style.backgroundRepeat = 'no-repeat';
			this.atmosphereLayer.style.backgroundBlendMode = 'normal';

			if (this.coverSpinner) {
				this.coverSpinner.style.display = 'none';
			}
		} else {
			this.atmosphereLayer.style.backgroundImage = 'none';
			this.atmosphereLayer.style.animation = 'none';
			if (this.coverSpinner) {
				this.coverSpinner.style.display = 'none';
			}
		}
	}

	private async fetchCoverArtData(coverUrl: string): Promise<{ colour: string; palette: string[] }> {
		// Check cache first
		const cached = this.imageCache.get(coverUrl);
		const now = Date.now();
		if (cached && (now - cached.timestamp) < this.CACHE_TTL) {
			return { colour: cached.colour, palette: cached.palette };
		}

		const result: { colour: string; palette: string[] } = {
			colour: '255, 255, 255',
			palette: [],
		};

		try {
			const response = await fetch(coverUrl, {
				mode: 'cors',
				cache: 'force-cache',
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			const blob = await response.blob();
			const blobUrl = URL.createObjectURL(blob);
			const tempImg = new Image();

			await new Promise<void>((resolve, reject) => {
				tempImg.onload = () => resolve();
				tempImg.onerror = reject;
				tempImg.src = blobUrl;
			});

			const vibrantColour = retrieveCoverArtVibrant(tempImg);
			result.colour = vibrantColour;
			result.palette = [this.formatRgbColor(vibrantColour)];
			URL.revokeObjectURL(blobUrl);
		} catch (error) {
			console.error('[reactivo] Error fetching cover art data:', error);
		}

		// Cache the result
		if (result.colour !== '255, 255, 255' || result.palette.length > 0) {
			this.imageCache.set(coverUrl, {
				colour: result.colour,
				palette: result.palette,
				timestamp: Date.now()
			});
		}

		return result;
	}

	private createAtmosphereLayer(): HTMLElement {
		let targetBlur = DataStoreService.backgroundMode === 'images' ? 45 : 100;
		const layer = document.createElement('div');
		layer.style.cssText = `
        position: absolute !important;
        top: 50% !important;
        left: 50% !important;
        width: 200% !important;
        height: 200% !important;
        transform: translate(-50%, -50%) !important; /* centrado */
        overflow: hidden !important;
        pointer-events: none !important;
        filter: blur(${targetBlur}px) brightness(0.35) saturate(1) !important;
        opacity: 0 !important;
        transition: opacity 0.35s ease-out !important;
        z-index: ${this.options.zIndex} !important;
    `;

		const spinner = document.createElement('div');
		spinner.style.cssText = `
        position: absolute !important;
        inset: 0 !important;
        pointer-events: none !important;
        background-size: cover !important;
        background-position: center center !important;
        background-repeat: no-repeat !important;
        transform-origin: center center !important;
        will-change: transform, background-position, opacity !important;
    `;

		layer.appendChild(spinner);
		this.coverSpinner = spinner;
		this.overlayWrapper.appendChild(layer);
		return layer;
	}

	private createAtmosphereCircles(colors: string[]): void {
		if (!this.atmosphereLayer) return;

		// Recycle existing circles instead of recreating
		this.atmosphereCircles.forEach((circle) => {
			circle.inUse = false;
			circle.element.style.opacity = '0';
			circle.element.style.transition = 'opacity 0.4s ease-out !important';
			setTimeout(() => {
				circle.element.style.display = 'none';
				this.circlePool.push(circle.element);
			}, 400); // Wait for fade-out to complete
		});
		this.atmosphereCircles = [];

		if (colors.length === 0) return;

		// HERE HERE - DETERMINE NUMBER OF CIRCLES BASED ON CONTAINER SIZE AND COLOR COUNT
		const width = this.container.offsetWidth || window.innerWidth;
		const height = this.container.offsetHeight || window.innerHeight;
		const minDim = Math.min(width, height);

		const minCircleCount = 1;
		const maxCircleCount = 2;
		const areaScale = 500 * 500;
		const areaBasedCount = Math.max(1, Math.round((width * height) / areaScale));
		const circleCount = Math.min(
			maxCircleCount,
			Math.max(minCircleCount, Math.max(colors.length, areaBasedCount)),
		);

		const coverUrl = this.options.backgroundMode === 'images' ? retrieveCoverArt() : null;
		const baseColor = colors[0] ?? 'rgb(255, 255, 255)';
		const palette = Array(circleCount).fill(baseColor);

		const corners = [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 0, y: 1 },
			{ x: 1, y: 1 },
		];
		const reactiveCorner = corners[Math.floor(Math.random() * corners.length)];
		const staticColor = this.toneDownCircleColor(baseColor);

		// SET SIZE OF STATIC CORNER CIRCLE BASED ON CONTAINER SIZE WITH SOME RANDOMNESS
		const staticSize = Math.round(minDim * (0.3 + Math.random() * 1));
		const staticLeft = Math.round(reactiveCorner.x === 0 ? 0 : width - staticSize);
		const staticTop = Math.round(reactiveCorner.y === 0 ? 0 : height - staticSize);

		const staticCircle = document.createElement('div');
		staticCircle.style.cssText = `
            position: absolute !important;
            width: ${staticSize}px !important;
            height: ${staticSize}px !important;
            left: ${staticLeft}px !important;
            top: ${staticTop}px !important;
            border-radius: 50% !important;
            background: ${this.createCoverFragmentBackground(coverUrl, staticColor, palette[0] ?? staticColor)} !important;
            opacity: 0.39 !important;
            pointer-events: none !important;
            mix-blend-mode: ${coverUrl ? 'normal' : 'screen'} !important;
            filter: ${coverUrl ? 'blur(8px) contrast(1.05) saturate(1.08)' : 'none'} !important;
        `;
		this.atmosphereLayer.appendChild(staticCircle);
		this.atmosphereCircles.push({
			element: staticCircle,
			baseX: staticLeft,
			baseY: staticTop,
			size: staticSize,
			reactToBass: false,
			staticCorner: true,
			offsetX: 0,
			offsetY: 0,
			inUse: true,
		});

		const gridCols = Math.max(1, Math.round(width / 600));
		const gridRows = Math.max(1, Math.round(height / 600));
		const cellWidth = width / gridCols;
		const cellHeight = height / gridRows;

		const totalCircles = Math.min(areaBasedCount, gridCols * gridRows);

		for (let i = 0; i < totalCircles; i++) {
			const color = this.toneDownCircleColor(palette[i % palette.length]);
			const col = i % gridCols;
			const row = Math.floor(i / gridCols);

			// SET TARGET SIZE BASED ON CONTAINER SIZE WITH SOME RANDOMNESS
			const targetSize = Math.round(Math.max(cellWidth, cellHeight) * (1.05 + Math.random() * 1));
			const centerX = col * cellWidth + cellWidth * 0.5;
			const centerY = row * cellHeight + cellHeight * 0.5;
			const jitterX = (Math.random() - 0.5) * cellWidth * 0.28;
			const jitterY = (Math.random() - 0.5) * cellHeight * 0.28;
			const left = Math.round(centerX - targetSize * 0.5 + jitterX);
			const top = Math.round(centerY - targetSize * 0.5 + jitterY);
			const clampedLeft = Math.max(-targetSize * 0.25, Math.min(width - targetSize * 0.75, left));
			const clampedTop = Math.max(-targetSize * 0.25, Math.min(height - targetSize * 0.75, top));
			const circleCenterX = clampedLeft + targetSize * 0.5;
			const circleCenterY = clampedTop + targetSize * 0.5;
			const cornerX = reactiveCorner.x === 0 ? 0 : width;
			const cornerY = reactiveCorner.y === 0 ? 0 : height;
			const distance = Math.hypot(circleCenterX - cornerX, circleCenterY - cornerY);
			const maxDistance = Math.hypot(width, height);
			const proximity = 1 - distance / maxDistance;
			const reactToBass = proximity > 0.3 ? Math.random() < 0.72 : Math.random() < 0.18;

			// Use pooled circle or create new one
			let circle: HTMLElement;
			if (this.circlePool.length > 0) {
				circle = this.circlePool.pop()!;
				circle.style.display = 'block';
				circle.style.opacity = '0';
				circle.style.transition = 'opacity 0.8s ease-out, transform 0.6s ease-out !important';
				// Animate pooled circle entrance
				setTimeout(() => {
					circle.style.opacity = '0.94';
				}, i * 80);
			} else {
				circle = document.createElement('div');
				circle.style.cssText = `
            position: absolute !important;
            width: ${targetSize}px !important;
            height: ${targetSize}px !important;
            left: ${clampedLeft}px !important;
            top: ${clampedTop}px !important;
            border-radius: 50% !important;
            background: ${this.createCoverFragmentBackground(coverUrl, color, palette[(i + 1) % palette.length])} !important;
            opacity: 0 !important;
            pointer-events: none !important;
            mix-blend-mode: ${coverUrl ? 'normal' : 'screen'} !important;
            filter: ${coverUrl ? 'blur(6px) contrast(1.05) saturate(1.06)' : 'none'} !important;
            will-change: transform, opacity !important;
            transition: opacity 0.8s ease-out, transform 0.6s ease-out !important;
        `;

				this.atmosphereLayer.appendChild(circle);
				this.atmosphereCircles.push({
					element: circle,
					baseX: clampedLeft,
					baseY: clampedTop,
					size: targetSize,
					reactToBass,
					offsetX: Math.random() * Math.PI * 2,
					offsetY: Math.random() * Math.PI * 2,
					inUse: true,
				});

				// Animate entrance with staggered timing
				setTimeout(() => {
					circle.style.opacity = '0.94';
				}, i * 80); // Staggered delay for smooth sequential appearance
			}
		}
	}

	private updateAtmosphereCircles(): void {
		if (!this.atmosphereLayer || this.atmosphereCircles.length === 0) return;
		const bgElements = document.querySelectorAll<HTMLElement>('[class*="_background_"]');

		bgElements.forEach(el => {
			el.style.backgroundColor = "black";
		});

		const currentIntensity = this.state.currentCircleIntensity;
		const time = performance.now() * 0.0006;
		if (this.coverSpinner && this.options.backgroundMode === 'images') {
			const spinAngle = (performance.now() * 0.008) % 360;
			const moveX = Math.sin(time * 0.42) * 10;
			const moveY = Math.cos(time * 0.35) * 8;
			const coverScale = 1 + Math.sin(time * 0.18) * 0.025;
			this.coverSpinner.style.transform = `translate3d(${moveX}px, ${moveY}px, 0) rotate(${spinAngle}deg) scale(${coverScale})`;
			this.coverSpinner.style.backgroundPosition = `${50 + Math.sin(time * 0.2) * 5}% ${50 + Math.cos(time * 0.24) * 5}%`;
		}

		this.atmosphereCircles.forEach((circle, index) => {
			const isStatic = !!(circle as any).staticCorner;
			const isReactive = circle.reactToBass && !isStatic;
			const baseDrift = 12 + index * 2;
			const motionLerp = this.getLerpFactor(this.state.currentCircleIntensity, this.state.targetCircleIntensity);
			const reactiveDrift = isReactive ? currentIntensity * 42 * motionLerp : currentIntensity * 8 * motionLerp;
			const driftAmplitude = baseDrift + reactiveDrift;
			const driftX = isStatic ? 0 : Math.sin(time + circle.offsetX) * driftAmplitude;
			const driftY = isStatic ? 0 : Math.cos(time + circle.offsetY) * (driftAmplitude * 0.8);
			const liquidX = isStatic ? 0 : Math.sin(time * 0.58 + circle.offsetY) * (driftAmplitude * 0.24);
			const liquidY = isStatic ? 0 : Math.cos(time * 0.66 + circle.offsetX) * (driftAmplitude * 0.18);
			const waveRotate = isStatic ? 0 : Math.sin(time * 0.45 + circle.offsetX) * 6;
			const intensityScale = isStatic
				? 1
				: 1 + (isReactive ? currentIntensity * 0.45 : currentIntensity * 0.12) + Math.sin(time * 0.9 + circle.offsetX) * 0.03;
			const targetOpacity = isStatic ? 1 : isReactive ? 1 : 0.9;

			circle.element.style.transform = `translate(${driftX + liquidX}px, ${driftY + liquidY}px) rotate(${waveRotate}deg) scale(${intensityScale})`;
			circle.element.style.opacity = `${targetOpacity}`;
		});
	}

	// Connection management
	private connect(): void {
		try {
			if (this.ws) {
				this.ws.close();
				this.ws = null;
			}
			this.ws = new WebSocket(this.options.wsUrl);

			this.ws.onopen = () => {
				this.ws?.send(currentDevice);
			};

			this.ws.onmessage = (event: MessageEvent) => {
				try {
					const data: AudioAnalysis[] = JSON.parse(event.data);
					if (Array.isArray(data) && data.length > 0) {
						this.pendingAudioData = data[0];
						
						// Start animation loop if not already running
						if (!this.animationFrameId) {
							this.startAnimationLoop();
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
				if (!this.ws) return;

				if (this.options.autoReconnect) {
					this.scheduleReconnect();
				}
			};
		} catch (error) {
			this.scheduleReconnect();
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

	public deviceChanged(deviceId: string): void {
		if (this.ws) {
			this.ws?.send(deviceId);
		}
	}

	public togglePause(pause: boolean): void {
		this.options.isNowPlayingVisible = pause;
	}

	// Visual updates
	private lerp(start: number, end: number, factor: number): number {
		return start + (end - start) * factor;
	}

	private getLerpFactor(current: number, target: number): number {
		const { lerpFactor } = this.options;
		return target > current ? lerpFactor : lerpFactor * 0.15;
	}

	private update(analysis: AudioAnalysis): void {
		if (!this.options.isNowPlayingVisible) {
			return;
		}

		const strongestBass = analysis.bass?.strongest;
		const bassAverage = analysis.bass?.average || 0;

		if (!strongestBass) {
			return;
		}

		let baseIntensity = this.calculateBaseIntensity(strongestBass, bassAverage);

		if (this.options.useDynamicIntensity) {
			const dynamicFactor = this.dynamicIntensityController.calculateDynamicIntensity(analysis);
			baseIntensity = Math.max(baseIntensity, dynamicFactor * 0.5);
		}

		const totalIntensity = baseIntensity * (this.options.intensityMultiplier ?? 1);

		this.updateTargetValues(totalIntensity);
		this.applyLerping();
		this.applyEffects(strongestBass.frequency);
	}

	private calculateBaseIntensity(strongestBass: any, bassAverage: number): number {
		const lowFreqIntensity = Math.max(0, 1 - (strongestBass.frequency - 20) / 200);
		const magnitudeIntensity = Math.min(bassAverage * 10000, 1);
		return lowFreqIntensity * magnitudeIntensity;
	}

	private updateTargetValues(totalIntensity: number): void {
		this.state.targetVignetteSize = 100 + totalIntensity * 300;
		this.state.targetVignetteBlur = 10 + totalIntensity * 200;
		this.state.targetIntensity = totalIntensity;
		this.state.targetCircleIntensity = totalIntensity;
	}

	private applyLerping(): void {
		const { lerpFactor } = this.options;
		const attackFactor = lerpFactor;
		const decayFactor = lerpFactor * 0.15;

		const getFactor = (current: number, target: number) =>
			this.getLerpFactor(current, target);

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
		this.state.currentCircleIntensity = this.lerp(
			this.state.currentCircleIntensity,
			this.state.targetCircleIntensity,
			getFactor(this.state.currentCircleIntensity, this.state.targetCircleIntensity)
		);
	}

	private async applyEffects(frequency: number): Promise<void> {
		const { currentVignetteSize, currentVignetteBlur, currentIntensity } = this.state;

		const leftIntensity = currentIntensity * 0.7;
		const bottomIntensity = currentIntensity * 0.6;
		const artworkColourEnabled = DataStoreService.vignetteUsesArtworkColourEnabled == true;
		const enhancedBackgroundEnabled = DataStoreService.enhancedBackgroundEnabled == true;

		if (artworkColourEnabled || enhancedBackgroundEnabled || this.options.backgroundMode === 'images') {
			const coverUrl = retrieveCoverArt();
			this.updateAtmosphereLayerBackground(coverUrl);
			if (coverUrl && !this.isLoadingCoverArt && coverUrl !== this.lastCoverUrl) {
				this.isLoadingCoverArt = true;
				try {
					const { colour, palette } = await this.fetchCoverArtData(coverUrl);
					this.lastCoverUrl = coverUrl;
					this.cachedVignetteColour = colour && colour !== '255, 255, 255' ? colour : '255, 255, 255';
					this.updateAtmosphereLayerBackground(coverUrl);

					if (enhancedBackgroundEnabled && palette.length > 0) {
						this.createAtmosphereCircles(palette);
					}

					this.cachedAtmospherePalette = palette;
				} catch (error) {
					console.error('[reactivo] Error loading cover art:', error);
					this.cachedVignetteColour = '255, 255, 255';
					this.cachedAtmospherePalette = [];
				} finally {
					this.isLoadingCoverArt = false;
				}
			} else if (coverUrl && enhancedBackgroundEnabled && this.atmosphereCircles.length === 0) {
				const { colour, palette } = await this.fetchCoverArtData(coverUrl);
				this.cachedVignetteColour = colour && colour !== '255, 255, 255' ? colour : '255, 255, 255';
				if (palette.length > 0) {
					this.createAtmosphereCircles(palette);
				}
				this.cachedAtmospherePalette = palette;
			}
		} else {
			this.cachedVignetteColour = "255, 255, 255";
			this.cachedAtmospherePalette = [];
			this.lastCoverUrl = null;
		}

		const vignetteColour = this.cachedVignetteColour;

		let vignetteBoxShadow = `
        inset 0 0 ${currentVignetteSize}px ${currentVignetteBlur}px rgba(${vignetteColour}, ${0.4 + currentIntensity * 0.6}),
        inset 0 0 ${currentVignetteSize * 0.7}px ${currentVignetteBlur * 0.7}px rgba(${vignetteColour}, ${currentIntensity * 0.8}),
        inset 0 0 ${currentVignetteSize * 0.5}px ${currentVignetteBlur * 0.5}px rgba(${vignetteColour}, ${currentIntensity * 0.6}),
        inset ${currentVignetteSize * 0.4}px 0 ${currentVignetteBlur * 1.2}px ${currentVignetteBlur * 0.3}px rgba(${vignetteColour}, ${leftIntensity}),
        inset 0 ${currentVignetteSize * 0.3}px ${currentVignetteBlur * 1.2}px ${currentVignetteBlur * 0.3}px rgba(${vignetteColour}, ${bottomIntensity})
    `;

		this.elements.vignette.style.boxShadow = vignetteBoxShadow;

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

		if (DataStoreService.enhancedBackgroundEnabled) {
			if (this.cachedAtmospherePalette.length && this.atmosphereCircles.length === 0) {
				this.createAtmosphereCircles(this.cachedAtmospherePalette);
			}
			if (this.atmosphereLayer) {
				this.atmosphereLayer.style.opacity = '1';
			}
			this.updateAtmosphereCircles();
		} else if (this.atmosphereLayer) {
			this.atmosphereLayer.style.opacity = '0';
		}
	}



	// Public API
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



	public setBackgroundMode(mode: 'circles' | 'images'): void {
		this.options.backgroundMode = mode;
		if (this.options.useEnhancedBackground && this.cachedAtmospherePalette.length) {
			this.createAtmosphereCircles(this.cachedAtmospherePalette);
		}
	}

	public setEnhancedBackground(enabled: boolean): void {
		this.options.useEnhancedBackground = enabled;
		if (enabled && this.cachedAtmospherePalette.length && this.atmosphereCircles.length === 0) {
			this.createAtmosphereCircles(this.cachedAtmospherePalette);
		}
		if (this.atmosphereLayer) {
			this.atmosphereLayer.style.opacity = enabled && this.atmosphereCircles.length > 0 ? '1' : '0';
		}
	}

	private startAnimationLoop(): void {
		const animate = (timestamp: number) => {
			if (this.pendingAudioData) {
				const analysis = this.pendingAudioData;
				this.update(analysis);
				
				if (analysis.bpm && this.options.useDynamicLerp) {
					const targetLerp = this.lerpController.calculateBPMLerp(analysis.bpm);
					const smoothLerp = this.lerpController.update(targetLerp);
					this.setLerpFactor(smoothLerp);
				}
				
				this.pendingAudioData = null;
			}
			
			// Continue animation loop
			this.animationFrameId = requestAnimationFrame(animate);
		};
		
		this.animationFrameId = requestAnimationFrame(animate);
	}

	private stopAnimationLoop(): void {
		if (this.animationFrameId) {
			cancelAnimationFrame(this.animationFrameId);
			this.animationFrameId = null;
		}
	}

	public destroy(): void {
		this.disconnect();
		this.stopAnimationLoop();
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
