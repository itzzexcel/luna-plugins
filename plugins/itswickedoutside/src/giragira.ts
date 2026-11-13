/**
 * Gira Gira - Audio Visualiser
 * Turns music into smooth, adaptive visuals that respond to bass and rhythm
 */

import { apolMusicWannabeEnabled, currentDevice, Settings } from ".";
import { DataStoreService } from "./Settings";
import {
	retrieveCoverArt,
	retrieveCoverArtVibrant,
	retrieveCoverArtPalette,
	retrieveCoverArtDataUnified,
} from "./ui-interface";

export interface AudioAnalysis {
	bass?: {
		strongest?: {
			frequency: number;
			magnitude: number;
		};
		average: number;
		max: number;
		frequency: number;
	};
	energy?: number;
	treble?: {
		average: number;
		max: number;
		strongest?: {
			frequency: number;
			magnitude: number;
		};
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
	colorSaturation?: number;
	useDynamicLerp?: boolean;
	useDynamicIntensity?: boolean;
	useEnhancedBackground?: boolean;
	backgroundMode?: 'circles' | 'images';
	useApolMusicWannabe?: boolean;
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
	setColorSaturation?: (saturation: number) => void;
	setDynamicLerpEnabled?: (enabled: boolean) => void;
	setDynamicIntensityEnabled?: (enabled: boolean) => void;
	setEnhancedBackground?: (enabled: boolean) => void;
	setBackgroundMode?: (mode: 'circles' | 'images') => void;
	setApolMusicWannabeEnabled?: (enabled: boolean) => void;
	refreshAtmosphereCircles?: () => void;
	updateCoverArt?: (coverUrl?: string) => Promise<void>;
}

// Detects sudden bass intensity spikes for genres with dynamic bass emphasis
class BassSpikeDetector {
	private bassHistory: number[] = [];
	private readonly historySize = 20; // ~1 second at 20fps
	private spikeThreshold = 0.32; // How much above average to trigger
	private spikeCooldown = 0; // Frames to wait before detecting another spike
	private readonly maxCooldown = 5; // ~115ms cooldown (allows detecting 170+ BPM kicks & syncopations)
	private currentSpikeLevel = 0;
	private spikeDecayRate = 0.88;

	addBassReading(bassIntensity: number): void {
		// Add to history
		this.bassHistory.push(bassIntensity);
		if (this.bassHistory.length > this.historySize) {
			this.bassHistory.shift();
		}

		// Update cooldown
		if (this.spikeCooldown > 0) {
			this.spikeCooldown--;
		}

		// Detect spike if we have enough history and cooldown is over
		if (this.bassHistory.length >= 5 && this.spikeCooldown === 0) {
			const recent = this.bassHistory.slice(-3); // Last 3 readings
			const older = this.bassHistory.slice(0, -3); // Everything before that
			
			if (older.length > 0) {
				const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
				const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
				
				// Calculate how much the recent readings exceed the baseline
				const spikeRatio = recentAvg / Math.max(olderAvg, 0.01);
				const delta = recentAvg - olderAvg;

				// Trigger either on ratio (electronic kicks from silence)
				// or on delta (heavy continuous or fast uptempo kicks that ride on top of a sustained floor)
				if (spikeRatio > (1 + this.spikeThreshold) || (olderAvg > 0.16 && delta > 0.07)) {
					// Spike detected! Set spike level based on intensity
					this.currentSpikeLevel = Math.min(1.0, Math.max((spikeRatio - 1) * 0.5, delta * 2.8));
					this.spikeCooldown = this.maxCooldown;
				}
			}
		}

		// Decay spike level over time
		this.currentSpikeLevel *= this.spikeDecayRate;
	}

	getSpikeMultiplier(): number {
		// Gentle spike boost (up to 1.2x instead of 2.0x to avoid harshness on heavy drops)
		return 1.0 + (this.currentSpikeLevel * 0.2);
	}

	getSpikeLevel(): number {
		return this.currentSpikeLevel;
	}

	reset(): void {
		this.bassHistory = [];
		this.spikeCooldown = 0;
		this.currentSpikeLevel = 0;
	}
}

// Tracks running baseline floor and ceiling to extract transients from continuous heavy bass (e.g. rock)
export class AdaptiveBassTracker {
	private baselineFloor: number = 0;
	private baselineCeiling: number = 0.5;
	private lastIntensity: number = 0;
	private smoothedOutput: number = 0;
	private readonly floorRiseRate: number = 0.005; // Slow rise when bass is continuous (~2-3 sec)
	private readonly floorFallRate: number = 0.08;  // Fast drop when bass stops (~120-150ms)
	private readonly ceilingDecayRate: number = 0.005;
	public isSustainedBass: boolean = false;

	process(rawIntensity: number): number {
		// Track the running floor (the sustained bass component)
		if (rawIntensity < this.baselineFloor) {
			this.baselineFloor += (rawIntensity - this.baselineFloor) * this.floorFallRate;
		} else {
			this.baselineFloor += (rawIntensity - this.baselineFloor) * this.floorRiseRate;
		}

		// Track running ceiling
		if (rawIntensity > this.baselineCeiling) {
			this.baselineCeiling = rawIntensity;
		} else {
			this.baselineCeiling += (rawIntensity - this.baselineCeiling) * this.ceilingDecayRate;
		}
		this.baselineCeiling = Math.max(this.baselineCeiling, this.baselineFloor + 0.12);

		// Detect sustained heavy bass (when baseline floor is elevated)
		this.isSustainedBass = this.baselineFloor > 0.22;

		// Dynamic range between floor and ceiling
		const dynamicRange = Math.max(0.12, this.baselineCeiling - this.baselineFloor);

		// Transient extraction: how much does this moment exceed the sustained baseline floor?
		const transient = Math.max(0, rawIntensity - this.baselineFloor) / dynamicRange;

		// Onset: detect sudden rise (attack of drums/guitar hit)
		const onset = Math.max(0, rawIntensity - this.lastIntensity);
		this.lastIntensity = rawIntensity;

		let punch: number;
		if (this.isSustainedBass) {
			// Continuous heavy bass (rock, metal):
			// Base the visual on the transient punch above the continuous floor
			punch = transient * 0.7 + onset * 0.4 + rawIntensity * 0.2;
		} else {
			// Electronic / synthpop / dance bursts:
			// Combine steady energy with transient kick attack so fast tempos cut through cleanly
			punch = Math.max(rawIntensity * 0.9, transient * 0.85 + onset * 0.35);
		}

		const clamped = Math.min(1.0, Math.max(0, punch));
		this.smoothedOutput += (clamped - this.smoothedOutput) * 0.42;
		return this.smoothedOutput;
	}

	reset(): void {
		this.baselineFloor = 0;
		this.baselineCeiling = 0.5;
		this.lastIntensity = 0;
		this.smoothedOutput = 0;
		this.isSustainedBass = false;
	}
}

// Closed-form critically damped harmonic spring solver (Unity SmoothDamp / iOS CoreAnimation spring curve)
// Mathematically guaranteed: zero oscillation, zero overshoot, zero harsh jerk, perfectly smooth C^inf trajectory
export class DampedSpring {
	public value: number = 0;
	public velocity: number = 0;
	public target: number = 0;
	private smoothTime: number;

	constructor(smoothTime = 0.08) {
		this.smoothTime = smoothTime;
	}

	setTarget(target: number): void {
		this.target = target;
	}

	setSmoothTime(smoothTime: number): void {
		this.smoothTime = Math.max(0.035, Math.min(0.25, smoothTime));
	}

	// Backwards compatibility if setParameters is invoked
	setParameters(stiffness: number, damping: number): void {
		if (stiffness > 0) {
			this.setSmoothTime(2 / Math.sqrt(stiffness));
		}
	}

	update(dt: number): number {
		const clampedDt = Math.max(0.001, Math.min(dt, 0.05));
		const omega = 2 / Math.max(0.001, this.smoothTime);
		const x = omega * clampedDt;
		// 4th order rational approximation of exp(-omega * dt)
		const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
		
		const change = this.value - this.target;
		const temp = (this.velocity + omega * change) * clampedDt;
		
		this.velocity = (this.velocity - omega * temp) * exp;
		this.value = this.target + (change + temp) * exp;

		return this.value;
	}

	snap(val: number): void {
		this.value = val;
		this.velocity = 0;
		this.target = val;
	}

	reset(): void {
		this.value = 0;
		this.velocity = 0;
		this.target = 0;
	}
}

// Multi-band dynamics engine: analytical smooth-damp solvers for Bass, Treble, and Broadband Energy
export class AudioDynamicsEngine {
	public bassSpring = new DampedSpring(0.078);   // Responsive bass punch with silky organic recovery
	public energySpring = new DampedSpring(0.14);  // Smooth, luminous broadband energy
	public trebleSpring = new DampedSpring(0.085); // Gentle transient shimmer for cymbals/hi-hats

	public fluidPhase: number = 0;
	public currentBPM: number = 120;

	setBPM(bpm: number): void {
		if (!bpm || bpm <= 0) return;
		this.currentBPM = bpm;

		// Adapt smoothTime gracefully based on tempo:
		// At 80 BPM: ~0.095s (deep, slow breathing)
		// At 120 BPM: 0.078s (standard punch)
		// At 169 BPM (e.g. weathergirl): 0.056s (cleanly tracks consecutive 177ms eighth-note kicks with zero jitter!)
		const bpmScale = Math.max(0.75, Math.min(1.8, bpm / 120));
		this.bassSpring.setSmoothTime(0.078 / bpmScale);
		this.trebleSpring.setSmoothTime(0.085 / bpmScale);
		this.energySpring.setSmoothTime(0.13 / bpmScale);
	}

	updateAudio(analysis: AudioAnalysis, trackedBassIntensity: number, intensityMultiplier = 1): void {
		if (analysis.bpm) {
			this.setBPM(analysis.bpm);
		}

		// 1. Bass Target with gentle soft-knee compression
		const rawBass = trackedBassIntensity * (intensityMultiplier * 0.5);
		const compressedBass = rawBass <= 0.75
			? rawBass
			: 0.75 + Math.tanh((rawBass - 0.75) * 0.5) * 0.3;
		
		const targetBass = Math.min(1.05, compressedBass);
		this.bassSpring.setTarget(targetBass);

		// 2. Broadband Energy Target
		const rawEnergy = typeof analysis.energy === 'number' ? analysis.energy : 0.3;
		const energyTarget = Math.min(1.0, Math.max(0.1, rawEnergy * 1.1));
		this.energySpring.setTarget(energyTarget);

		// 3. Treble Target (hi-hats, cymbals, snare snap, vocaloid air)
		const trebleAvg = analysis.treble?.average ?? 0;
		const trebleMag = analysis.treble?.strongest?.magnitude ?? 0;
		const rawTreble = Math.min(1.0, trebleAvg * 60000 + trebleMag * 70);
		this.trebleSpring.setTarget(rawTreble);
	}

	updatePhysics(dt: number): {
		bass: number;
		energy: number;
		treble: number;
		fluidPhase: number;
	} {
		const bass = Math.max(0, this.bassSpring.update(dt));
		const energy = Math.max(0, this.energySpring.update(dt));
		const treble = Math.max(0, this.trebleSpring.update(dt));

		// Fluid phase velocity: gentle, organic floating drift
		const bpmTempoFactor = Math.max(0.85, Math.min(1.35, this.currentBPM / 120));
		const phaseSpeed = (0.32 + energy * 0.35 + treble * 0.15) * bpmTempoFactor;
		this.fluidPhase += dt * phaseSpeed;

		return { bass, energy, treble, fluidPhase: this.fluidPhase };
	}

	reset(): void {
		this.bassSpring.reset();
		this.energySpring.reset();
		this.trebleSpring.reset();
		this.fluidPhase = 0;
		this.currentBPM = 120;
	}
}

// Figures out how intense things should be based on the bass
class DynamicIntensityController {
	private smoothedEnergy: number = 0;
	private frequencySpread: number = 0;
	private bassPresence: number = 0;
	private readonly smoothingFactor: number = 0.12;  // More responsive for fast bass changes
	private readonly decaySmoothingFactor: number = 0.06;  // Faster decay
	private bassSpikeDetector: BassSpikeDetector;

	constructor() {
		this.bassSpikeDetector = new BassSpikeDetector();
	}

	calculateDynamicIntensity(analysis: AudioAnalysis): number {
		const bass = analysis.bass;
		if (!bass) return 0;

		// Broaden bass frequency range to 20-220Hz (accommodates rock bass guitar fundamentals & harmonics)
		const isRealBass = bass.frequency >= 20 && bass.frequency <= 200;
		const bassFreqFactor = isRealBass ? 1.0 : Math.max(0.2, 1 - (bass.frequency - 200) / 100);
		
		// When we get real bass, crank it up based on how thick it feels
		// Higher multiplier for fast-changing bass (DnB style)
		const bassMag = bass.strongest?.magnitude ?? 0;
		const rawBassPresence = isRealBass 
			? Math.min(bass.average * 18000, 1) * (1 + Math.min(1.2, bassMag * 120))
			: Math.min(bass.average * 12000, 1) * (1 + Math.min(0.8, bassMag * 60));
		
		const freqSpread = Math.min(bass.frequency / 200, 1);
		const magnitudeStrength = Math.min(bassMag * 140, 1);  // More sensitive

		// Smooth it out with momentum to prevent jittery jumps
		const effectiveSmoothing = isRealBass ? this.smoothingFactor : this.decaySmoothingFactor;
		this.bassPresence += (rawBassPresence - this.bassPresence) * effectiveSmoothing;
		this.frequencySpread += (freqSpread - this.frequencySpread) * this.decaySmoothingFactor;

		// Feed bass intensity to spike detector
		this.bassSpikeDetector.addBassReading(this.bassPresence);

		// Mix it all together: bass weight matters most, frequency context a little, punch even less
		let dynamicIntensity =
			this.bassPresence * 0.75 +  // Increased bass weight
			this.frequencySpread * 0.12 +
			(magnitudeStrength * bassFreqFactor) * 0.13;

		// Apply spike multiplier for sudden bass emphasis moments
		const spikeMultiplier = this.bassSpikeDetector.getSpikeMultiplier();
		dynamicIntensity *= spikeMultiplier;

		return Math.min(dynamicIntensity, 1);
	}

	reset(): void {
		this.smoothedEnergy = 0;
		this.frequencySpread = 0;
		this.bassPresence = 0;
		this.bassSpikeDetector.reset();
	}
}

// Adapts smoothing based on the BPM and tempo of the track
class DynamicLerpController {
	private currentLerp: number = 0.32;
	private targetLerp: number = 0.32;
	private lerpTransitionSpeed: number = 0.08; // Smooth, continuous adaptation without jarring steps

	private config = {
		bpmMin: 60,
		bpmMax: 200,
		lerpMin: 0.22,
		lerpMax: 0.40,
		curve: 'exponential' as 'linear' | 'exponential' | 'logarithmic'
	};

	constructor(config?: Partial<typeof this.config>) {
		if (config) {
			this.config = { ...this.config, ...config };
		}
	}

	calculateBPMLerp(bpm: number): number {
		// Continuous, silky tempo response: scales musically with BPM
		// At 60-100 BPM: 0.22-0.26 (smooth and floating)
		// At 140-180+ BPM (weathergirl, synthpop): 0.32-0.38 (crisp, musical, distinct beats without twitching)
		const clampedBpm = Math.max(60, Math.min(210, bpm));
		const tempoAgility = (clampedBpm - 60) / 150;
		const curveFactor = Math.pow(tempoAgility, 0.9);

		return this.config.lerpMin + (this.config.lerpMax - this.config.lerpMin) * curveFactor;
	}

	update(targetLerp: number, deltaTime: number = 1 / 60): number {
		this.targetLerp = targetLerp;
		const speed = 1 - Math.pow(1 - this.lerpTransitionSpeed, Math.min(deltaTime * 60, 3));
		this.currentLerp += (this.targetLerp - this.currentLerp) * speed;
		return this.currentLerp;
	}

	setTransitionSpeed(speed: number) {
		this.lerpTransitionSpeed = Math.min(Math.max(speed, 0.01), 1);
	}

	getCurrentLerp(): number {
		return this.currentLerp;
	}
}

// Learns what kind of track we're playing and adjusts behavior accordingly
class SongAdaptationController {
	private analysisHistory: Array<{
		intensity: number;
		frequency: number;
		magnitude: number;
		bpm: number;
		spikeLevel: number;
		timestamp: number;
	}> = [];
	
	private readonly HISTORY_SIZE = 30; // 30 frames de historia
	private readonly HISTORY_WINDOW_MS = 1000; // 1 segundo de ventana
	
	private adaptiveSmoothing: number = 0.15;
	private energyTrend: number = 0;
	private variability: number = 0;
	private consistencyFactor: number = 0.5;
	private averageBPM: number = 120;
	private bassSpikeFrequency: number = 0; // How often bass spikes occur (0-1)

	addAnalysis(analysis: AudioAnalysis, currentIntensity: number, spikeLevel: number = 0): void {
		const now = Date.now();

		this.analysisHistory.push({
			intensity: currentIntensity,
			frequency: analysis.bass?.frequency ?? 100,
			magnitude: analysis.bass?.strongest?.magnitude ?? 0,
			bpm: analysis.bpm ?? 120,
			spikeLevel: spikeLevel,
			timestamp: now,
		});

		// Drop ancient history, keeps things responsive
		this.analysisHistory = this.analysisHistory.filter(
			item => now - item.timestamp < this.HISTORY_WINDOW_MS
		);

		// Keep it from growing too big in memory
		if (this.analysisHistory.length > this.HISTORY_SIZE) {
			this.analysisHistory.shift();
		}

		this.updateAdaptiveParameters();
	}

	private updateAdaptiveParameters(): void {
		// Need some data before we can figure anything out
		if (this.analysisHistory.length < 3) return;

		// Check if the track's energy is ramping up or cooling down
		const recent = this.analysisHistory.slice(-5);
		const oldest = this.analysisHistory.slice(0, 5);
		
		const recentAvg = recent.reduce((sum, a) => sum + a.intensity, 0) / recent.length;
		const oldestAvg = oldest.reduce((sum, a) => sum + a.intensity, 0) / oldest.length;
		
		this.energyTrend = (recentAvg - oldestAvg);

		// See how much the intensity bounces around
		const intensities = this.analysisHistory.map(a => a.intensity);
		const mean = intensities.reduce((a, b) => a + b, 0) / intensities.length;
		const variance = intensities.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / intensities.length;
		this.variability = Math.sqrt(variance);

		// Steady beat like a DJ set, or all over the place like prog rock?
		this.consistencyFactor = Math.max(0, 1 - this.variability * 2);

		// Calculate average BPM for high-BPM genre detection
		const bpms = this.analysisHistory.map(a => a.bpm);
		this.averageBPM = bpms.reduce((a, b) => a + b, 0) / bpms.length;

		// How often do bass spikes happen? (0-1 scale)
		const spikeReadings = this.analysisHistory.map(a => a.spikeLevel);
		const avgSpikeLevel = spikeReadings.reduce((sum, val) => sum + val, 0) / spikeReadings.length;
		this.bassSpikeFrequency = Math.min(1, avgSpikeLevel / 0.5); // Normalize to 0-1

		// Now tweak how smooth we want things to be
		this.adaptSmoothing();
	}

	private adaptSmoothing(): void {
		// Wild tracks need smoothing so we don't jitter
		// Steady tracks can react faster
		
		const baseSmoothing = 0.15;
		const smoothingRange = 0.12; // Range from crisp to glassy smooth
		
		// Locked groove? Stay snappy. All over? Get smooth
		const variabilityInfluence = this.variability * smoothingRange;
		
		// Building up? Don't smooth too much. Falling off? Give it more cushion
		const trendInfluence = Math.max(0, -this.energyTrend * 0.05);
		
		this.adaptiveSmoothing = Math.max(
			0.03,
			Math.min(0.27, baseSmoothing + variabilityInfluence + trendInfluence)
		);
	}

	getAdaptiveSmoothing(): number {
		return this.adaptiveSmoothing;
	}

	getConsistencyFactor(): number {
		return this.consistencyFactor;
	}

	getVariability(): number {
		return this.variability;
	}

	getEnergyTrend(): number {
		return this.energyTrend;
	}

	getAverageBPM(): number {
		return this.averageBPM || 120;
	}

	// Different songs need different transition vibes
	getSmoothnessFactor(): number {
		// Wild energy swings? Make transitions dreamy
		// Locked in? Let changes feel punchy
		const baseSmoothness = 0.5;
		const variabilitySmoothing = this.variability * 0.4;
		return Math.min(0.9, baseSmoothness + variabilitySmoothing);
	}

	// Keep the intensity from getting too crazy on bouncy tracks
	getAdaptiveIntensityMultiplier(): number {
		// High-BPM tracks (weathergirl, DnB, uptempo synthpop) need full intensity and agile dynamics
		const isHighBPM = this.averageBPM > 140;
		
		if (isHighBPM) {
			let multiplier = Math.min(1.25, 1.0 + (this.averageBPM - 140) * 0.005);
			
			// If bass spikes are common, boost intensity even more for those moments
			if (this.bassSpikeFrequency > 0.25) {
				multiplier *= 1.0 + (this.bassSpikeFrequency - 0.25) * 0.45;
			}
			
			return multiplier;
		}
		
		// For variable tracks (like rock, prog, syncopated beats):
		// Do NOT penalize variability! Instead, give dynamic rock tracks a healthy punch
		const baseMultiplier = 1.0;
		const variabilityBoost = this.variability * 0.2;
		return Math.min(1.2, baseMultiplier + variabilityBoost);
	}

	reset(): void {
		this.analysisHistory = [];
		this.adaptiveSmoothing = 0.15;
		this.energyTrend = 0;
		this.variability = 0;
		this.consistencyFactor = 0.5;
		this.averageBPM = 120;
		this.bassSpikeFrequency = 0;
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

	private apolMusicWannabeEnabled: boolean = false;

	private isLoadingCoverArt: boolean = false;

	private options: Required<AudioVisualiserOptions>;
	private lerpController: DynamicLerpController;
	private dynamicIntensityController: DynamicIntensityController;
	private songAdaptationController: SongAdaptationController;
	private bassSpikeDetector: BassSpikeDetector;
	private adaptiveBassTracker: AdaptiveBassTracker;
	private dynamicsEngine: AudioDynamicsEngine;
	private lastUpdateTime: number = 0;
	private updateIntervalMs: number = 0; // 0 = uncapped, use requestAnimationFrame
	private animationFrameId: number | null = null;
	private pendingAudioData: AudioAnalysis | null = null;
	private cachedVignetteColour: string = "255, 255, 255";
	private lastAppliedVignetteColour: string = '';
	private lastAppliedVignetteSize: number = -1;
	private lastAppliedGlowColour: string = '';
	private lastCoverUrl: string | null = null;
	private lastCoverCheckTime: number = 0;
	private currentAppliedCoverUrl: string | null = '__init__';
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
		reactToTreble?: boolean;
		harmonicRatioX?: number;
		harmonicRatioY?: number;
		offsetX: number;
		offsetY: number;
		staticCorner?: boolean;
		inUse: boolean;
	}> = [];

	// Set up the whole visualizer
	constructor(
		containerSelector: string | HTMLElement,
		options: AudioVisualiserOptions = {}
	) {
		this.options = {
			wsUrl: 'ws://localhost:5343',
			autoReconnect: true,
			maxReconnectAttempts: 5,
			reconnectDelay: 2000,
			lerpFactor: 0.35,
			showStats: false,
			showStatus: false,
			zIndex: 0,
			intensityMultiplier: 1,
			colorSaturation: 1,
			useDynamicLerp: true,
			useDynamicIntensity: false,
			isNowPlayingVisible: false,
			useEnhancedBackground: false,
			backgroundMode: 'circles',
			useApolMusicWannabe: false,
			...options,
		};

		this.lerpController = new DynamicLerpController({
			bpmMin: 70,
			bpmMax: 210,
			lerpMin: 0.22,
			lerpMax: 0.40,
			curve: 'exponential'
		});

		this.lerpController.setTransitionSpeed(0.08);
		this.dynamicIntensityController = new DynamicIntensityController();
		this.songAdaptationController = new SongAdaptationController();
		this.bassSpikeDetector = new BassSpikeDetector();
		this.adaptiveBassTracker = new AdaptiveBassTracker();
		this.dynamicsEngine = new AudioDynamicsEngine();

		this.container = this.resolveContainer(containerSelector);
		this.ensureContainerPosition();
		this.overlayWrapper = this.createOverlayWrapper();
		this.atmosphereLayer = this.createAtmosphereLayer();
		this.elements = this.createDOMStructure();
		this.atmosphereLayer.style.opacity = this.options.useEnhancedBackground ? '1' : '0';
		document.addEventListener('visibilitychange', this.onVisibilityChange);
		this.startMemorySweep();
		this.updateCoverArt();
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
            will-change: opacity !important;
            opacity: 0 !important;
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
            will-change: opacity !important;
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

		this.overlayWrapper.appendChild(visualiser);
		this.overlayWrapper.appendChild(status);
		this.overlayWrapper.appendChild(stats);

		return {
			vignette,
			glowLayer,
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

	private applySaturationToRgb(rgbString: string, saturation: number): string {
		if (saturation === 1) return rgbString;
		const match = rgbString.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
		if (!match) return rgbString;
		const { h, s, v } = this.rgbToHsv(Number(match[1]), Number(match[2]), Number(match[3]));
		const targetS = Math.min(Math.max(s * saturation, 0), 1);
		const rgb = this.hsvToRgb(h, targetS, v);
		return `${rgb.r}, ${rgb.g}, ${rgb.b}`;
	}

	private toneDownCircleColor(color: string): string {
		const match = color.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
		if (!match) return color;
		const r = Number(match[1]);
		const g = Number(match[2]);
		const b = Number(match[3]);
		const { h, s, v } = this.rgbToHsv(r, g, b);

		const targetS = Math.min(s * (this.options.colorSaturation ?? 1), 0.98);
		const saturationBoost = 2 - targetS; // less saturated colors can stay brighter
		const brightnessScale = 2 - targetS * 0.32; // more saturated colors are dimmed more
		const rawV = v * brightnessScale + saturationBoost * 0.18;

		const minBrightness = 0.25;
		const maxBrightness = 0.78;
		const targetV = Math.min(Math.max(rawV, minBrightness), maxBrightness);

		const toned = this.hsvToRgb(h, targetS, targetV);
		return `rgb(${toned.r}, ${toned.g}, ${toned.b})`;
	}

	private generateHarmonicPalette(baseColor: string): string[] {
		const match = baseColor.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
		if (!match) return [baseColor];
		const { h, s, v } = this.rgbToHsv(Number(match[1]), Number(match[2]), Number(match[3]));
		// Analogous (+28°), complementary (+175°), and triadic accent (+325°)
		const c1 = this.hsvToRgb((h + 28) % 360, Math.min(s * 0.9, 0.9), Math.max(v * 0.85, 0.4));
		const c2 = this.hsvToRgb((h + 175) % 360, Math.min(s * 0.75, 0.85), Math.max(v * 0.75, 0.35));
		const c3 = this.hsvToRgb((h + 325) % 360, Math.min(s * 0.95, 0.95), Math.max(v * 0.9, 0.45));
		return [
			baseColor,
			`rgb(${c1.r}, ${c1.g}, ${c1.b})`,
			`rgb(${c2.r}, ${c2.g}, ${c2.b})`,
			`rgb(${c3.r}, ${c3.g}, ${c3.b})`,
		];
	}

	private createRadialCircleGradient(primaryColor: string, accentColor?: string): string {
		const accent = accentColor ? this.toneDownCircleColor(accentColor) : primaryColor;
		const positionX = 35 + Math.random() * 30;
		const positionY = 35 + Math.random() * 30;
		return `radial-gradient(circle at ${positionX}% ${positionY}%, ${primaryColor} 0%, ${accent} 42%, transparent 72%)`;
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
		if (this.currentAppliedCoverUrl === coverUrl) return;
		this.currentAppliedCoverUrl = coverUrl;

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
		// Already grabbed this cover? Use it
		const cached = this.imageCache.get(coverUrl);
		const now = Date.now();
		if (cached && (now - cached.timestamp) < this.CACHE_TTL) {
			return { colour: cached.colour, palette: cached.palette };
		}

		const result: { colour: string; palette: string[] } = {
			colour: '255, 255, 255',
			palette: [],
		};

		let blobUrl: string | null = null;
		let tempImg: HTMLImageElement | null = null;

		try {
			const response = await fetch(coverUrl, {
				mode: 'cors',
				cache: 'force-cache',
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			const blob = await response.blob();
			blobUrl = URL.createObjectURL(blob);
			tempImg = new Image();

			await new Promise<void>((resolve, reject) => {
				if (!tempImg) return reject();
				tempImg.onload = () => resolve();
				tempImg.onerror = reject;
				tempImg.src = blobUrl!;
			});

			const unified = retrieveCoverArtDataUnified(tempImg, 6);
			result.colour = unified.colour;
			result.palette = unified.palette && unified.palette.length > 0
				? unified.palette.map(c => this.formatRgbColor(c))
				: [this.formatRgbColor(unified.colour)];
		} catch (error) {
			console.error('[reactivo] Error fetching cover art data:', error);
		} finally {
			if (blobUrl) {
				URL.revokeObjectURL(blobUrl);
			}
			if (tempImg) {
				tempImg.onload = null;
				tempImg.onerror = null;
				tempImg.src = ''; // Immediately free decoded bitmap memory
			}
		}

		// Cap imageCache to max 30 entries (LRU-like eviction) to prevent long-session memory leaks
		if (this.imageCache.size >= 30) {
			const oldestKey = this.imageCache.keys().next().value;
			if (oldestKey) this.imageCache.delete(oldestKey);
		}

		// Remember it for next time
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
		let targetBlur = DataStoreService.backgroundMode === 'images' ? 35 : 48;
		
		const layer = document.createElement('div');
		layer.style.cssText = `
        position: absolute !important;
        top: 50% !important;
        left: 50% !important;
        width: 140% !important;
        height: 140% !important;
        transform: translate(-50%, -50%) !important;
        overflow: hidden !important;
        pointer-events: none !important;
        filter: blur(${targetBlur}px) contrast(1.12) brightness(0.52) saturate(${this.options.colorSaturation ?? 1}) !important;
        opacity: 0 !important;
        transition: opacity 0.35s ease-out !important;
        z-index: ${this.options.zIndex} !important;
        will-change: opacity !important;
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
		if (colors.length === 0) return;

		const width = this.container.offsetWidth || window.innerWidth;
		const height = this.container.offsetHeight || window.innerHeight;
		const minDim = Math.min(width, height);

		const apolMode = this.apolMusicWannabeEnabled || (DataStoreService.apolMusicWannabeEnabled ?? false);
		const coverUrl = this.options.backgroundMode === 'images' ? retrieveCoverArt() : null;

		// Ensure a rich multi-color palette from extracted cover art
		let palette = colors.length > 0 ? [...colors] : ['rgb(255, 255, 255)'];
		if (palette.length < 3) {
			palette = this.generateHarmonicPalette(palette[0]);
		}

		const HARMONIC_RATIOS = [
			{ rx: 1.0, ry: 1.25 },
			{ rx: 1.414, ry: 0.866 },
			{ rx: 1.732, ry: 1.618 },
			{ rx: 2.236, ry: 1.15 },
			{ rx: 0.707, ry: 1.414 },
		];

		// 1. Static Corner Anchor Blob
		let staticSize: number, staticLeft: number, staticTop: number;
		const staticColor = this.toneDownCircleColor(palette[0]);

		if (apolMode) {
			staticSize = Math.round(Math.max(minDim * 0.9, width * 0.45));
			staticLeft = Math.round(width - staticSize * 0.75);
			staticTop = Math.round(-staticSize * 0.2);
		} else {
			staticSize = Math.round(minDim * 0.85);
			staticLeft = Math.round(width - staticSize * 0.65);
			staticTop = 0;
		}

		// 2. Dynamic Fluid Blobs (Multi-color mesh gradient with irrational harmonic circulation)
		const dynamicConfigs = apolMode
			? [
				{
					cx: width * 0.76,
					cy: height * 0.32,
					size: Math.round(minDim * 0.86),
					reactToBass: true,
					reactToTreble: false,
					color: this.toneDownCircleColor(palette[1 % palette.length]),
					accent: palette[2 % palette.length],
				},
				{
					cx: width * 0.86,
					cy: height * 0.54,
					size: Math.round(minDim * 0.78),
					reactToBass: true,
					reactToTreble: true,
					color: this.toneDownCircleColor(palette[2 % palette.length]),
					accent: palette[3 % palette.length],
				},
				{
					cx: width * 0.60,
					cy: height * 0.20,
					size: Math.round(minDim * 0.92),
					reactToBass: false,
					reactToTreble: true,
					color: this.toneDownCircleColor(palette[3 % palette.length]),
					accent: palette[0],
				},
				{
					cx: width * 0.72,
					cy: height * 0.44,
					size: Math.round(minDim * 0.64),
					reactToBass: false,
					reactToTreble: true,
					color: this.toneDownCircleColor(palette[4 % palette.length] ?? palette[1 % palette.length]),
					accent: palette[1 % palette.length],
				},
			]
			: [
				{
					cx: width * 0.28,
					cy: height * 0.42,
					size: Math.round(minDim * 0.88),
					reactToBass: true,
					reactToTreble: false,
					color: this.toneDownCircleColor(palette[0]),
					accent: palette[1 % palette.length],
				},
				{
					cx: width * 0.74,
					cy: height * 0.58,
					size: Math.round(minDim * 0.88),
					reactToBass: true,
					reactToTreble: true,
					color: this.toneDownCircleColor(palette[1 % palette.length]),
					accent: palette[2 % palette.length],
				},
				{
					cx: width * 0.50,
					cy: height * 0.22,
					size: Math.round(minDim * 0.78),
					reactToBass: false,
					reactToTreble: true,
					color: this.toneDownCircleColor(palette[2 % palette.length]),
					accent: palette[3 % palette.length],
				},
				{
					cx: width * 0.48,
					cy: height * 0.78,
					size: Math.round(minDim * 0.82),
					reactToBass: false,
					reactToTreble: false,
					color: this.toneDownCircleColor(palette[3 % palette.length]),
					accent: palette[0],
				},
				{
					cx: width * 0.82,
					cy: height * 0.28,
					size: Math.round(minDim * 0.68),
					reactToBass: true,
					reactToTreble: true,
					color: this.toneDownCircleColor(palette[4 % palette.length] ?? palette[0]),
					accent: palette[1 % palette.length],
				},
			];

		const totalCircles = 1 + dynamicConfigs.length;

		// Prune any excess elements if switching between modes
		while (this.atmosphereCircles.length > totalCircles) {
			const excess = this.atmosphereCircles.pop();
			if (excess && excess.element.parentElement === this.atmosphereLayer) {
				excess.element.remove();
			}
		}

		// 1. Static Anchor Circle
		const staticBg = this.createCoverFragmentBackground(coverUrl, staticColor, palette[1 % palette.length]);
		if (this.atmosphereCircles.length === 0) {
			const staticCircle = document.createElement('div');
			staticCircle.style.cssText = `
				position: absolute !important;
				width: ${staticSize}px !important;
				height: ${staticSize}px !important;
				left: ${staticLeft}px !important;
				top: ${staticTop}px !important;
				border-radius: 50% !important;
				background: ${staticBg} !important;
				opacity: 0.78 !important;
				pointer-events: none !important;
				mix-blend-mode: ${coverUrl ? 'normal' : 'screen'} !important;
				transition: opacity 0.8s ease-out, background 0.8s ease-out !important;
			`;
			this.atmosphereLayer.appendChild(staticCircle);
			this.atmosphereCircles.push({
				element: staticCircle,
				baseX: staticLeft,
				baseY: staticTop,
				size: staticSize,
				reactToBass: false,
				reactToTreble: false,
				harmonicRatioX: 0.8,
				harmonicRatioY: 0.7,
				staticCorner: true,
				offsetX: 0,
				offsetY: 0,
				inUse: true,
			});
		} else {
			// Reuse in-place without DOM allocation
			const staticData = this.atmosphereCircles[0];
			staticData.element.style.width = `${staticSize}px`;
			staticData.element.style.height = `${staticSize}px`;
			staticData.element.style.left = `${staticLeft}px`;
			staticData.element.style.top = `${staticTop}px`;
			staticData.element.style.background = staticBg;
			staticData.baseX = staticLeft;
			staticData.baseY = staticTop;
			staticData.size = staticSize;
		}

		// 2. Dynamic Blobs
		dynamicConfigs.forEach((config, i) => {
			const circleIdx = i + 1;
			const jitterX = (Math.random() - 0.5) * 40;
			const jitterY = (Math.random() - 0.5) * 40;
			const left = Math.round(config.cx - config.size * 0.5 + jitterX);
			const top = Math.round(config.cy - config.size * 0.5 + jitterY);
			const harmonic = HARMONIC_RATIOS[i % HARMONIC_RATIOS.length];
			const bg = this.createCoverFragmentBackground(coverUrl, config.color, config.accent);

			if (this.atmosphereCircles.length <= circleIdx) {
				const circle = document.createElement('div');
				circle.style.cssText = `
					position: absolute !important;
					width: ${config.size}px !important;
					height: ${config.size}px !important;
					left: ${left}px !important;
					top: ${top}px !important;
					border-radius: 50% !important;
					background: ${bg} !important;
					opacity: 0.94 !important;
					pointer-events: none !important;
					mix-blend-mode: ${coverUrl ? 'normal' : 'screen'} !important;
					transition: opacity 0.8s ease-out, background 0.8s ease-out !important;
				`;
				this.atmosphereLayer!.appendChild(circle);
				this.atmosphereCircles.push({
					element: circle,
					baseX: left,
					baseY: top,
					size: config.size,
					reactToBass: config.reactToBass,
					reactToTreble: config.reactToTreble,
					harmonicRatioX: harmonic.rx,
					harmonicRatioY: harmonic.ry,
					offsetX: Math.random() * Math.PI * 2,
					offsetY: Math.random() * Math.PI * 2,
					staticCorner: false,
					inUse: true,
				});
			} else {
				// Reuse in-place without DOM allocation
				const circleData = this.atmosphereCircles[circleIdx];
				circleData.element.style.width = `${config.size}px`;
				circleData.element.style.height = `${config.size}px`;
				circleData.element.style.left = `${left}px`;
				circleData.element.style.top = `${top}px`;
				circleData.element.style.background = bg;
				circleData.baseX = left;
				circleData.baseY = top;
				circleData.size = config.size;
				circleData.reactToBass = config.reactToBass;
				circleData.reactToTreble = config.reactToTreble;
				circleData.harmonicRatioX = harmonic.rx;
				circleData.harmonicRatioY = harmonic.ry;
			}
		});
	}

	private updateAtmosphereCircles(dynamics?: { bass: number; energy: number; treble: number; fluidPhase: number }): void {
		if (!this.atmosphereLayer || this.atmosphereCircles.length === 0) return;

		const apolMode = this.apolMusicWannabeEnabled || (DataStoreService.apolMusicWannabeEnabled ?? false);

		// Physics values from AudioDynamicsEngine spring solver
		const phase = dynamics ? dynamics.fluidPhase : (performance.now() * 0.0006);
		const bassEnergy = dynamics ? dynamics.bass : this.state.currentCircleIntensity;
		const trebleEnergy = dynamics ? dynamics.treble : 0;
		const broadbandEnergy = dynamics ? dynamics.energy : 0.3;
			
		if (this.coverSpinner && this.options.backgroundMode === 'images') {
			const spinAngle = (phase * 80) % 360;
			const moveX = Math.sin(phase * 0.7) * 10;
			const moveY = Math.cos(phase * 0.6) * 8;
			const coverScale = 1 + Math.sin(phase * 0.4) * 0.025;
			this.coverSpinner.style.transform = `translate3d(${moveX}px, ${moveY}px, 0) rotate(${spinAngle}deg) scale(${coverScale})`;
			this.coverSpinner.style.backgroundPosition = `${50 + Math.sin(phase * 0.5) * 5}% ${50 + Math.cos(phase * 0.6) * 5}%`;
		}
	
		this.atmosphereCircles.forEach((circle, index) => {
			const isStatic = !!circle.staticCorner;
			const isReactiveBass = circle.reactToBass && !isStatic;
			const isReactiveTreble = circle.reactToTreble && !isStatic;

			const rx = circle.harmonicRatioX ?? (1.0 + (index % 3) * 0.35);
			const ry = circle.harmonicRatioY ?? (1.25 + (index % 2) * 0.4);

			// Multi-frequency Lissajous fluid circulation (organic, non-repeating paths)
			const lissajousX = Math.sin(phase * rx + circle.offsetX);
			const lissajousY = Math.cos(phase * ry + circle.offsetY);

			let driftX = 0;
			let driftY = 0;
			let liquidX = 0;
			let liquidY = 0;
			let waveRotate = 0;
			let intensityScale = 1;
			let targetOpacity = 0.92;

			if (apolMode) {
				if (isStatic) {
					// Static corner anchor: slow breathing, subtle ambient drift
					driftX = Math.sin(phase * 0.3 + circle.offsetX) * 8;
					driftY = Math.cos(phase * 0.25 + circle.offsetY) * 6;
					intensityScale = 1 + Math.sin(phase * 0.5) * 0.02;
					targetOpacity = 0.78;
				} else {
					const baseDrift = 18 + index * 4;
					const driftAmplitude = baseDrift + broadbandEnergy * 14;

					driftX = lissajousX * (driftAmplitude * 0.65);
					driftY = lissajousY * (driftAmplitude * 0.5);
					liquidX = Math.sin(phase * 1.3 + circle.offsetY) * (driftAmplitude * 0.14);
					liquidY = Math.cos(phase * 1.1 + circle.offsetX) * (driftAmplitude * 0.1);
					waveRotate = Math.sin(phase * 0.4 + circle.offsetX) * 4;

					// Apple-style viscoelastic contraction on bass hits (damped harmonic spring response):
					// Musical physical punch on transients with graceful organic recovery
					if (isReactiveBass) {
						const contractionFactor = Math.min(0.20, bassEnergy * 0.18);
						intensityScale = 1 - contractionFactor;
						targetOpacity = Math.max(0.76, 0.94 - contractionFactor * 0.3);
					} else {
						intensityScale = 1 + Math.sin(phase * 0.8 + circle.offsetX) * 0.03;
						targetOpacity = 0.9;
					}

					// Treble transient shimmer (cymbals, hi-hats, vocal sparkle)
					if (isReactiveTreble) {
						const shimmer = Math.sin(phase * 2.8 + circle.offsetX) * (trebleEnergy * 0.02);
						intensityScale += shimmer;
					}
				}
			} else {
				// Normal mode
				if (isStatic) {
					driftX = Math.sin(phase * 0.3 + circle.offsetX) * 10;
					driftY = Math.cos(phase * 0.3 + circle.offsetY) * 8;
					intensityScale = 1;
					targetOpacity = 0.85;
				} else {
					const baseDrift = 20 + index * 5;
					const reactiveDrift = isReactiveBass ? bassEnergy * 16 : broadbandEnergy * 8;
					const driftAmplitude = baseDrift + reactiveDrift;

					driftX = lissajousX * driftAmplitude;
					driftY = lissajousY * (driftAmplitude * 0.82);
					liquidX = Math.sin(phase * 1.1 + circle.offsetY) * (driftAmplitude * 0.12);
					liquidY = Math.cos(phase * 1.2 + circle.offsetX) * (driftAmplitude * 0.10);
					waveRotate = Math.sin(phase * 0.4 + circle.offsetX) * 4;

					intensityScale = 1 + (isReactiveBass ? bassEnergy * 0.16 : broadbandEnergy * 0.08);
					if (isReactiveTreble) {
						intensityScale += Math.sin(phase * 2.8 + circle.offsetX) * (trebleEnergy * 0.02);
					}
					targetOpacity = isReactiveBass ? 0.94 : 0.88;
				}
			}

			circle.element.style.transform = `translate3d(${(driftX || 0) + (liquidX || 0)}px, ${(driftY || 0) + (liquidY || 0)}px, 0) rotate(${waveRotate}deg) scale(${intensityScale})`;
			circle.element.style.opacity = `${targetOpacity}`;
		});
	}

	// Handle WebSocket connection stuff
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
						
						// Fire up the animation loop if it's not running
						if (!this.animationFrameId) {
							this.startAnimationLoop();
						}
					}
				} catch (error) {
					console.warn("Error parsing audio analysis:", error);
				}
			};

			this.ws.onerror = () => {
				// WebSocket had an issue, but we'll handle reconnect elsewhere
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
		if (!pause) {
			this.adaptiveBassTracker?.reset();
			this.songAdaptationController?.reset();
			this.bassSpikeDetector?.reset();
			this.dynamicsEngine?.reset();
		}
	}

	// Handle all the animation and visual updates
	private lerp(start: number, end: number, factor: number): number {
		return start + (end - start) * factor;
	}

	private getLerpFactor(current: number, target: number): number {
		const baseLerp = this.options.lerpFactor ?? 0.35;
		const currentBpm = this.pendingAudioData?.bpm || this.songAdaptationController?.getAverageBPM() || 120;
		const tempoScale = Math.max(0.85, Math.min(1.35, currentBpm / 120));

		if (target > current) {
			// Musical attack: punchy and immediate without jarring instant snaps
			return Math.min(0.45, Math.max(0.24, baseLerp * 0.8 * tempoScale));
		}
		// Graceful decay: recovers in time for fast beats (160+ BPM) without sudden drop-offs
		const isSustained = this.adaptiveBassTracker?.isSustainedBass ?? false;
		const decayBase = isSustained ? 0.22 : 0.16;
		return Math.min(0.32, Math.max(0.10, baseLerp * decayBase * tempoScale));
	}

	private lastFrequency: number = 60;

	private update(analysis: AudioAnalysis): void {
		if (!this.options.isNowPlayingVisible) {
			return;
		}

		const strongestBass = analysis.bass?.strongest;
		const bassAverage = analysis.bass?.average || 0;

		if (!strongestBass) {
			return;
		}

		this.lastFrequency = strongestBass.frequency;

		let baseIntensity = this.calculateBaseIntensity(strongestBass, bassAverage);

		if (this.options.useDynamicIntensity) {
			const dynamicFactor = this.dynamicIntensityController.calculateDynamicIntensity(analysis);
			baseIntensity = Math.max(baseIntensity, dynamicFactor * 0.5);
		}

		// Process through adaptive baseline tracker to extract transients from continuous heavy bass
		const trackedIntensity = this.adaptiveBassTracker.process(baseIntensity);

		// Let the song shape how intense things get
		const adaptiveIntensityMultiplier = this.songAdaptationController.getAdaptiveIntensityMultiplier();
		const rawIntensity = trackedIntensity * ((this.options.intensityMultiplier ?? 2) * 0.5) * adaptiveIntensityMultiplier;

		// Soft-compression limiter curve:
		// Below 0.8: linear 1:1 response (preserves clean dynamics and punch)
		// Above 0.8: smooth hyperbolic tangent soft-knee (prevents ultra-heavy electronic bass from blowing out)
		const totalIntensity = rawIntensity <= 0.8
			? rawIntensity
			: 0.8 + Math.tanh((rawIntensity - 0.8) * 0.6) * 0.35;

		// Feed dynamics engine spring targets
		this.dynamicsEngine.updateAudio(
			analysis,
			trackedIntensity,
			(this.options.intensityMultiplier ?? 2) * adaptiveIntensityMultiplier
		);

		// Feed it more data so it learns what kind of track this is
		this.songAdaptationController.addAnalysis(analysis, totalIntensity, this.bassSpikeDetector.getSpikeLevel());

		this.updateTargetValues(totalIntensity);
	}

	private calculateBaseIntensity(strongestBass: any, bassAverage: number): number {
		// Broaden real bass range: Electric bass fundamentals span 40Hz (E1) to ~200Hz+ (G3/harmonics).
		// Rock rhythm guitars also have heavy energy between 100-220Hz.
		const freq = strongestBass.frequency;
		let freqWeight: number;

		if (freq >= 20 && freq <= 170) {
			freqWeight = Math.max(0.4, 1 - (freq - 20) / 220);
		} else if (freq > 170 && freq <= 260) {
			freqWeight = 0.4 * Math.max(0.1, 1 - (freq - 170) / 100);
		} else {
			freqWeight = 0.1;
		}

		// Peak magnitude boost:
		// Backend strongestBass.magnitude is normalized by 1/2048 (~0.001 to ~0.012).
		// Scaling by 120 gives real kicks and bass attacks a punchy boost!
		const peakBoost = Math.min(1.2, (strongestBass.magnitude ?? 0) * 120);
		const magnitudeMultiplier = 1 + peakBoost * 1.5;
		const magnitudeIntensity = Math.min(bassAverage * 10000, 1) * magnitudeMultiplier;

		return Math.min(1.2, freqWeight * magnitudeIntensity);
	}

	private updateTargetValues(totalIntensity: number): void {
		this.state.targetVignetteSize = 100 + totalIntensity * 300;
		this.state.targetVignetteBlur = 10 + totalIntensity * 200;
		this.state.targetIntensity = totalIntensity;
		this.state.targetCircleIntensity = totalIntensity;
	}

	private applyLerping(dt: number = 1 / 60): void {
		const getFactor = (current: number, target: number) => {
			const baseFactor = this.getLerpFactor(current, target);
			// Smooth delta-time exponential interpolation: at 60fps (dt = 1/60), effective factor == baseFactor
			// Keeps exact same bass reaction speed while making rendering completely smooth across all refresh rates
			const clampedDt = Math.max(0.001, Math.min(dt, 0.05));
			return 1 - Math.pow(1 - Math.min(baseFactor, 0.99), clampedDt * 60);
		};

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

	public async updateCoverArt(specifiedUrl?: string): Promise<void> {
		const artworkColourEnabled = DataStoreService.vignetteUsesArtworkColourEnabled == true;
		const enhancedBackgroundEnabled = DataStoreService.enhancedBackgroundEnabled == true;

		if (!artworkColourEnabled && !enhancedBackgroundEnabled && this.options.backgroundMode !== 'images') {
			this.cachedVignetteColour = "255, 255, 255";
			this.cachedAtmospherePalette = [];
			this.lastCoverUrl = null;
			return;
		}

		const coverUrl = specifiedUrl || retrieveCoverArt();
		if (!coverUrl || this.isLoadingCoverArt || coverUrl === this.lastCoverUrl) {
			return;
		}

		this.isLoadingCoverArt = true;
		this.lastCoverUrl = coverUrl;

		try {
			const { colour, palette } = await this.fetchCoverArtData(coverUrl);
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
	}

	private applyEffects(frequency: number, dynamics?: { bass: number; energy: number; treble: number; fluidPhase: number }): void {
		const saturation = this.options.colorSaturation ?? 1;
		const vignetteColour = this.applySaturationToRgb(this.cachedVignetteColour, saturation);
		this.apolMusicWannabeEnabled = DataStoreService.apolMusicWannabeEnabled ?? false;

		const effIntensity = dynamics ? Math.min(dynamics.bass, 1.15) : Math.min(this.state.currentIntensity, 1.15);

		// Render multi-layer blur box-shadow ONLY when color changes (not continuous per-frame re-rasterization!)
		if (vignetteColour !== this.lastAppliedVignetteColour) {
			this.lastAppliedVignetteColour = vignetteColour;
			this.elements.vignette.style.boxShadow = `
				inset 0 0 260px 130px rgba(${vignetteColour}, 0.75),
				inset 0 0 180px 90px rgba(${vignetteColour}, 0.55),
				inset 0 0 130px 65px rgba(${vignetteColour}, 0.40),
				inset 100px 0 140px 35px rgba(${vignetteColour}, 0.35),
				inset 0 80px 140px 35px rgba(${vignetteColour}, 0.30)
			`;
		}

		// Modulate instant beat reactivity via GPU opacity compositing (zero paint/raster cost)
		const targetVignetteOpacity = Math.min(0.90, 0.32 + effIntensity * 0.40);
		this.elements.vignette.style.opacity = targetVignetteOpacity.toFixed(3);

		if (vignetteColour !== this.lastAppliedGlowColour) {
			this.lastAppliedGlowColour = vignetteColour;
			this.elements.glowLayer.style.background = `
				radial-gradient(ellipse 140% 120% at 35% 70%,
					rgba(${vignetteColour}, 0.32) 0%,
					rgba(${vignetteColour}, 0.16) 30%,
					transparent 70%
				)
			`;
		}
		const targetGlowOpacity = Math.min(0.72, 0.10 + effIntensity * 0.50);
		this.elements.glowLayer.style.opacity = targetGlowOpacity.toFixed(3);

		if (DataStoreService.enhancedBackgroundEnabled) {
			if (this.cachedAtmospherePalette.length && this.atmosphereCircles.length === 0) {
				this.createAtmosphereCircles(this.cachedAtmospherePalette);
			}
			if (this.atmosphereLayer) {
				this.atmosphereLayer.style.opacity = '1';
			}
			this.updateAtmosphereCircles(dynamics);
		} else if (this.atmosphereLayer) {
			this.atmosphereLayer.style.opacity = '0';
		}
	}



	// The outside API that users can call
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

	public setColorSaturation(saturation: number): void {
		this.options.colorSaturation = Math.max(0, saturation);
		if (this.atmosphereLayer) {
			const targetBlur = this.options.backgroundMode === 'images' ? 45 : 100;
			this.atmosphereLayer.style.filter = `blur(${targetBlur}px) contrast(1.12) brightness(0.52) saturate(${this.options.colorSaturation}) !important`;
		}
		if (this.options.useEnhancedBackground && this.cachedAtmospherePalette.length) {
			this.refreshAtmosphereCircles();
		}
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

	public setApolMusicWannabeEnabled(enabled: boolean): void {
		this.apolMusicWannabeEnabled = enabled;
		if (this.cachedAtmospherePalette.length > 0) {
			this.refreshAtmosphereCircles();
		}
	}

	public refreshAtmosphereCircles(): void {
		if (!this.atmosphereLayer) return;

		this.lastCoverCheckTime = 0;
		this.currentAppliedCoverUrl = '__init__';

		if (this.cachedAtmospherePalette.length > 0) {
			this.createAtmosphereCircles(this.cachedAtmospherePalette);
		}

		if (this.atmosphereLayer) {
			this.atmosphereLayer.style.opacity = this.options.useEnhancedBackground && this.atmosphereCircles.length > 0 ? '1' : '0';
		}
	}

	private memorySweepIntervalId: number | null = null;

	private startMemorySweep(): void {
		// Run a gentle memory sweep every 2 minutes
		this.memorySweepIntervalId = window.setInterval(() => {
			if ('requestIdleCallback' in window) {
				(window as any).requestIdleCallback(() => {
					// 1. Evict expired image cache entries
					const now = Date.now();
					for (const [key, val] of this.imageCache.entries()) {
						if (now - val.timestamp > this.CACHE_TTL) {
							this.imageCache.delete(key);
						}
					}
					// 2. Trigger V8 GC if exposed
					(window as any).gc?.();
				});
			}
		}, 120000);
	}

	private stopMemorySweep(): void {
		if (this.memorySweepIntervalId) {
			clearInterval(this.memorySweepIntervalId);
			this.memorySweepIntervalId = null;
		}
	}

	private onVisibilityChange = () => {
		if (document.hidden) {
			this.stopAnimationLoop();
			// Idle cleanup when window is minimized/hidden
			if ('requestIdleCallback' in window) {
				(window as any).requestIdleCallback(() => {
					(window as any).gc?.();
				});
			}
		} else {
			if (!this.animationFrameId && this.options.isNowPlayingVisible) {
				this.startAnimationLoop();
			}
		}
	};

	private startAnimationLoop(): void {
		let lastTimestamp = performance.now();

		const animate = (timestamp: number) => {
			const dt = Math.max(0.001, Math.min((timestamp - lastTimestamp) * 0.001, 0.1));
			lastTimestamp = timestamp;

			if (this.pendingAudioData) {
				const analysis = this.pendingAudioData;
				this.update(analysis);
				
				if (analysis.bpm && this.options.useDynamicLerp) {
					const targetLerp = this.lerpController.calculateBPMLerp(analysis.bpm);
					const smoothLerp = this.lerpController.update(targetLerp, dt);
					this.setLerpFactor(smoothLerp);
				}
				
				this.pendingAudioData = null;
			}

			// Advance physical spring dynamics
			const dynamics = this.dynamicsEngine.updatePhysics(dt);

			if (this.options.isNowPlayingVisible) {
				this.applyLerping(dt);
				this.applyEffects(this.lastFrequency, dynamics);
			}
			
			// Keep it going
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
		document.removeEventListener('visibilitychange', this.onVisibilityChange);
		this.stopMemorySweep();
		this.disconnect();
		this.stopAnimationLoop();
		this.adaptiveBassTracker?.reset();
		this.dynamicsEngine?.reset();
		if (this.overlayWrapper?.parentNode) {
			this.overlayWrapper.parentNode.removeChild(this.overlayWrapper);
		}
		this.atmosphereCircles = [];
		this.imageCache.clear();
		this.lastCoverUrl = null;
		this.coverSpinner = null;
		this.atmosphereLayer = null;
	}
}

export function createAudioVisualiser(
	container: string | HTMLElement,
	options?: AudioVisualiserOptions
): AudioVisualiserAPI {
	return new AudioVisualiser(container, options);
}

export default createAudioVisualiser;
