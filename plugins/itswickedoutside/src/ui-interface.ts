// native color extraction, no external dependency
import { redux, PlayState } from "@luna/lib";

const debug = false;

const isNPViewHidden = (el: HTMLElement) =>
	el.className.includes("_nowPlayingHidden");

export const GetNPView = function (): HTMLElement {
	const isPlayerMarket = true; // getFeatureFlag("player-market-ui") === true;

	const selectors = isPlayerMarket
		? ['section[class*="_nowPlayingContainer"]']
		: [
			'[data-test="now-playing"]',
			'section[class*="_nowPlayingContainer"]',
		];

	const element = selectors
		.map((s) => document.querySelector<HTMLElement>(s))
		.find(Boolean);

	if (!element) throw new Error("Couldn't find the place to setup reactivo");

	if (debug) element.style.outline = "2px solid red";

	return element;
};

// Thank you @meowarex!
// https://github.com/meowarex/TidalLuna-Plugins/blob/0a694a5bc0cb98f72506077f63134bcece555e0d/plugins/radiant-lyrics-luna/src/index.ts#L450
const upscaleUrl = (url: string, resolution: string) =>
	url.replace(/\d+x\d+/, resolution);

const retrieveImageSrc = (selector: string): string | null => {
	const el = document.querySelector(selector) as HTMLImageElement | null;
	if (!el) return null;

	const src = upscaleUrl(el.src, "1280x1280");
	if (el.src !== src) el.src = src;
	return src;
};

const retrieveVideoFallbackSrc = (): string | null => {
	const el = document.querySelector(
		'[data-test="current-media-imagery"] [class*="_videoFallback"]',
	) as HTMLImageElement | null;
	if (!el) return null;

	return upscaleUrl(el.src, "1280x720");
};

export const retrieveCoverArt = function (): string | null {
	const isPlayerMarket = true; //getFeatureFlag("player-market-ui") === true;
	const videoElement = document.querySelector('figure[class*="_albumImage"] > div > div > div > video') as HTMLVideoElement;

	const posterSrc = videoElement?.poster ? upscaleUrl(videoElement.poster, "1280x1280") : null;

	const src = isPlayerMarket
		? (retrieveImageSrc(
			'[data-test="creator-content-now-playing-image"]',
		) ??
			retrieveImageSrc('[data-test="now-playing-artwork"]') ??
			posterSrc ??
			retrieveVideoFallbackSrc())
		: (retrieveImageSrc(
			'figure[class*="_albumImage"] > div > div > div > img',
		) ?? posterSrc ?? retrieveVideoFallbackSrc());

	if (!src) console.log("[reactivo] no image or video element for cover art");
	return src ?? null;
};

// Color extraction helpers
const rgbToHsv = (r: number, g: number, b: number) => {
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
};

const hsvToRgb = (h: number, s: number, v: number) => {
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
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const parseRgbString = (rgb: string): { r: number; g: number; b: number } | null => {
	const match = rgb.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
	if (!match) return null;
	return {
		r: Number(match[1]),
		g: Number(match[2]),
		b: Number(match[3]),
	};
};

const softenColor = (rgb: string, saturationFactor = 0.72, valueFactor = 0.92): string => {
	const parsed = parseRgbString(rgb);
	if (!parsed) return rgb;
	const hsv = rgbToHsv(parsed.r, parsed.g, parsed.b);
	const softened = hsvToRgb(
		hsv.h,
		clamp(hsv.s * saturationFactor, 0, 1),
		clamp(hsv.v * valueFactor, 0, 1),
	);
	return `rgb(${softened.r}, ${softened.g}, ${softened.b})`;
};

const scoreVibrantColor = (rgb: string) => {
	const parsed = parseRgbString(rgb);
	if (!parsed) return 0;
	const { s, v } = rgbToHsv(parsed.r, parsed.g, parsed.b);
	if (s < 0.08 || v < 0.18 || v > 0.96) return 0;
	return s * 0.72 + v * 0.22 + (1 - Math.abs(0.5 - v)) * 0.06;
};

const scorePalette = (palette: string[]) => {
	const buckets = palette
		.map(parseRgbString)
		.filter(Boolean) as Array<{ r: number; g: number; b: number }>;
	if (buckets.length === 0) {
		return { score: 0, count: 0, diversity: 0 };
	}

	let totalQuality = 0;
	let saturatedCount = 0;
	const hueGroups = new Set<number>();

	for (const bucket of buckets) {
		const { h, s, v } = rgbToHsv(bucket.r, bucket.g, bucket.b);
		totalQuality += s * 0.6 + v * 0.3;
		if (s >= 0.36) saturatedCount++;
		hueGroups.add(Math.round(h / 45));
	}

	const averageQuality = totalQuality / buckets.length;
	const diversity = hueGroups.size / Math.min(buckets.length, 6);
	const saturationBonus = saturatedCount / buckets.length;
	const score = averageQuality * 0.55 + saturationBonus * 0.25 + diversity * 0.2;

	return { score, count: buckets.length, diversity };
};

const isMostlyDarkCover = (vibrantColor: string, palette: string[]) => {
	const vibrantRgb = parseRgbString(vibrantColor);
	if (!vibrantRgb) return false;
	const vibrantV = rgbToHsv(vibrantRgb.r, vibrantRgb.g, vibrantRgb.b).v;

	const paletteVals = palette
		.map(parseRgbString)
		.filter((rgb): rgb is { r: number; g: number; b: number } => rgb !== null)
		.map((rgb) => rgbToHsv(rgb.r, rgb.g, rgb.b).v);

	if (paletteVals.length === 0) {
		return vibrantV < 0.22;
	}

	const averagePaletteV = paletteVals.reduce((sum, v) => sum + v, 0) / paletteVals.length;
	const darkCount = paletteVals.filter((v) => v < 0.24).length;
	return vibrantV < 0.22 && averagePaletteV < 0.26 && darkCount / paletteVals.length > 0.66;
};

const buildVibrantPalette = (base: string, maxColors: number) => {
	const parsed = parseRgbString(base);
	if (!parsed) return [base];
	const baseHsv = rgbToHsv(parsed.r, parsed.g, parsed.b);
	const variations = [
		{ saturation: baseHsv.s, value: baseHsv.v },
		{ saturation: clamp(baseHsv.s * 0.82, 0.18, 1), value: clamp(baseHsv.v * 0.94, 0.18, 0.98) },
		{ saturation: clamp(baseHsv.s * 0.72, 0.18, 1), value: clamp(baseHsv.v * 0.86, 0.18, 0.96) },
		{ saturation: clamp(baseHsv.s * 0.62, 0.18, 1), value: clamp(baseHsv.v * 0.74, 0.18, 0.92) },
		{ saturation: clamp(baseHsv.s * 0.52, 0.18, 1), value: clamp(baseHsv.v * 0.82, 0.18, 0.98) },
	];

	return Array.from(
		new Set(
			variations
				.slice(0, maxColors)
				.map(({ saturation, value }) => {
					const rgb = hsvToRgb(baseHsv.h, saturation, value);
					return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
				}),
		),
	).slice(0, maxColors);
};

export function retrieveCoverArtColors(
	imageElement: HTMLImageElement,
	maxColors = 7,
) {
	const vibrantColor = retrieveCoverArtVibrant(imageElement);
	const palette = retrieveCoverArtPalette(imageElement, maxColors);

	if (isMostlyDarkCover(vibrantColor, palette)) {
		const mutedPalette = palette
			.slice(0, 2)
			.map((color) => {
				const parsed = parseRgbString(color);
				if (!parsed) return color;
				const { h, s, v } = rgbToHsv(parsed.r, parsed.g, parsed.b);
				const mutedS = clamp(s * 0.24 + 0.05, 0, 0.5);
				const mutedV = clamp(v * 1.05, 0, 0.34);
				const mutedRgb = hsvToRgb(h, mutedS, mutedV);
				return `rgb(${mutedRgb.r}, ${mutedRgb.g}, ${mutedRgb.b})`;
			})
			.filter(Boolean) as string[];

		return {
			colour: vibrantColor,
			palette: mutedPalette.length > 0 ? mutedPalette : [vibrantColor],
			source: 'dark',
		};
	}

	const paletteMetrics = scorePalette(palette);
	const vibrantScore = scoreVibrantColor(vibrantColor);
	const useVibrant = vibrantScore > paletteMetrics.score + 0.12 || paletteMetrics.count < 3;

	let chosenPalette = palette;
	let source: 'palette' | 'vibrant' | 'mixed' = 'palette';

	if (useVibrant) {
		source = 'vibrant';
		chosenPalette = buildVibrantPalette(vibrantColor, maxColors);
		if (paletteMetrics.count > 0 && paletteMetrics.score > 0.25) {
			source = 'mixed';
			chosenPalette = Array.from(new Set([vibrantColor, ...palette])).slice(0, maxColors);
		}
	} else if (palette.length < 3) {
		source = 'mixed';
		chosenPalette = Array.from(new Set([vibrantColor, ...palette])).slice(0, maxColors);
	}

	if (chosenPalette.length === 0) {
		chosenPalette = [vibrantColor];
	}

	return {
		colour: vibrantColor,
		palette: chosenPalette,
		source,
	};
};

const prepareCanvas = (imageElement: HTMLImageElement) => {
	const canvas = document.createElement("canvas");
	let canvasWidth = imageElement.naturalWidth || imageElement.width;
	let canvasHeight = imageElement.naturalHeight || imageElement.height;

	if (canvasWidth === 0 || canvasHeight === 0) {
		console.warn("[reactivo] invalid image dimensions, defaulting to white");
		return null;
	}

	const maxSize = 512;
	if (canvasWidth > maxSize || canvasHeight > maxSize) {
		const scale = Math.min(maxSize / canvasWidth, maxSize / canvasHeight);
		canvasWidth = Math.floor(canvasWidth * scale);
		canvasHeight = Math.floor(canvasHeight * scale);
	}

	canvas.width = canvasWidth;
	canvas.height = canvasHeight;

	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) {
		console.warn("[reactivo] failed to get canvas context");
		return null;
	}

	ctx.drawImage(imageElement, 0, 0, canvasWidth, canvasHeight);
	return { canvas, ctx };
};

const samplePixels = (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => {
	const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
	const step = 6;

	interface ColorBucket {
		r: number;
		g: number;
		b: number;
		count: number;
		totalSat: number;
		totalVal: number;
	}

	const vibrantMap = new Map<number, ColorBucket>();
	const dominantMap = new Map<number, ColorBucket>();
	const perimeterHues = new Set<number>();

	let totalPixels = 0;

	const samplePixel = (x: number, y: number, isPerimeter: boolean) => {
		const idx = (y * canvas.width + x) * 4;
		const r = data[idx];
		const g = data[idx + 1];
		const b = data[idx + 2];
		const a = data[idx + 3];

		if (a < 128) return;
		if (r < 15 && g < 15 && b < 15) return;

		const { h, s, v } = rgbToHsv(r, g, b);
		const hueBucket = Math.round(h / 15) * 15;

		totalPixels++;

		if (isPerimeter) perimeterHues.add(hueBucket);

		if (!dominantMap.has(hueBucket)) {
			dominantMap.set(hueBucket, {
				r: 0,
				g: 0,
				b: 0,
				count: 0,
				totalSat: 0,
				totalVal: 0,
			});
		}

		const domBucket = dominantMap.get(hueBucket)!;
		domBucket.r += r;
		domBucket.g += g;
		domBucket.b += b;
		domBucket.count++;
		domBucket.totalSat += s;
		domBucket.totalVal += v;

		if (s >= 0.3 && v >= 0.2) {
			if (!vibrantMap.has(hueBucket)) {
				vibrantMap.set(hueBucket, {
					r: 0,
					g: 0,
					b: 0,
					count: 0,
					totalSat: 0,
					totalVal: 0,
				});
			}

			const vibBucket = vibrantMap.get(hueBucket)!;
			vibBucket.r += r;
			vibBucket.g += g;
			vibBucket.b += b;
			vibBucket.count++;
			vibBucket.totalSat += s;
			vibBucket.totalVal += v;
		}
	};

	for (let y = 0; y < canvas.height; y += step) {
		for (let x = 0; x < canvas.width; x += step) {
			samplePixel(x, y, false);
		}
	}

	for (let x = 0; x < canvas.width; x++) {
		samplePixel(x, 0, true);
		samplePixel(x, canvas.height - 1, true);
	}
	for (let y = 1; y < canvas.height - 1; y++) {
		samplePixel(0, y, true);
		samplePixel(canvas.width - 1, y, true);
	}

	return { vibrantMap, dominantMap, perimeterHues, totalPixels };
};

const getTopDominantHues = (dominantMap: Map<number, any>, topCount = 3) =>
	Array.from(dominantMap.entries())
		.sort(([, a], [, b]) => b.count - a.count)
		.slice(0, topCount)
		.map(([hue]) => hue);

const findBestColor = (vibrantMap: Map<number, any>, dominantMap: Map<number, any>, perimeterHues: Set<number>, totalPixels: number) => {
	const MIN_COVERAGE = 0.03;
	if (totalPixels <= 0) return "255, 255, 255";
	const topDominantHues = getTopDominantHues(dominantMap, 3);

	let bestBucket: any = null;
	let bestScore = 0;
	let bestHue = 0;

	for (const [hue, bucket] of vibrantMap.entries()) {
		const coverage = bucket.count / totalPixels;
		if (coverage < MIN_COVERAGE) continue;

		const avgSat = bucket.totalSat / bucket.count;
		const avgVal = bucket.totalVal / bucket.count;

		const isDominant = topDominantHues.includes(hue);
		const dominanceBonus = isDominant ? 2.0 : 0;

		const perimeterBonus = perimeterHues.has(hue) ? 1.5 : 0;

		const vibrancy = avgSat * 2.5;
		const brightness = avgVal * 0.5;
		const popularity = coverage * 3.0;

		const score =
			vibrancy +
			brightness +
			popularity +
			dominanceBonus +
			perimeterBonus;

		if (score > bestScore) {
			bestScore = score;
			bestBucket = bucket;
			bestHue = hue;
		}
	}

	if (!bestBucket && dominantMap.size > 0) {
		for (const bucket of dominantMap.values()) {
			const avgSat = bucket.totalSat / bucket.count;
			const avgVal = bucket.totalVal / bucket.count;
			const score = avgSat + avgVal * 0.5;

			if (score > bestScore) {
				bestScore = score;
				bestBucket = bucket;
			}
		}
	}

	if (!bestBucket) {
		return "255, 255, 255";
	}

	let finalR = Math.round(bestBucket.r / bestBucket.count);
	let finalG = Math.round(bestBucket.g / bestBucket.count);
	let finalB = Math.round(bestBucket.b / bestBucket.count);

	const finalHsv = rgbToHsv(finalR, finalG, finalB);
	const boostedSat = Math.min(finalHsv.s * 0.92, 0.86);

	const valBoost = finalHsv.v < 0.28 ? 1.4 : finalHsv.v < 0.6 ? 1.02 : finalHsv.v < 0.85 ? 0.98 : 0.9;
	const boostedVal = Math.min(finalHsv.v * valBoost, 0.9);

	const boosted = hsvToRgb(finalHsv.h, boostedSat, boostedVal);
	finalR = boosted.r;
	finalG = boosted.g;
	finalB = boosted.b;

	return `${finalR}, ${finalG}, ${finalB}`;
};

export function retrieveCoverArtVibrant(imageElement: HTMLImageElement): string {
	const canvasData = prepareCanvas(imageElement);
	if (!canvasData) return "255, 255, 255";

	const { canvas, ctx } = canvasData;
	const { vibrantMap, dominantMap, perimeterHues, totalPixels } = samplePixels(canvas, ctx);

	return findBestColor(vibrantMap, dominantMap, perimeterHues, totalPixels);
}

export function retrieveCoverArtPalette(
	imageElement: HTMLImageElement,
	maxColors = 7,
): string[] {
	const canvasData = prepareCanvas(imageElement);
	if (!canvasData) return ["rgb(255, 255, 255)"];

	const { canvas, ctx } = canvasData;
	const { vibrantMap, dominantMap, totalPixels } = samplePixels(canvas, ctx);
	if (totalPixels <= 0) return ["rgb(255, 255, 255)"];

	const vibrantBuckets = Array.from(vibrantMap.values())
		.map((bucket) => {
			const avgR = Math.round(bucket.r / bucket.count);
			const avgG = Math.round(bucket.g / bucket.count);
			const avgB = Math.round(bucket.b / bucket.count);
			const avgSat = bucket.totalSat / bucket.count;
			const avgVal = bucket.totalVal / bucket.count;
			return {
				avgR,
				avgG,
				avgB,
				avgSat,
				avgVal,
				coverage: bucket.count / totalPixels,
			};
		})
		.filter((bucket) => bucket.coverage >= 0.01)
		.filter(
			(bucket) =>
				!(bucket.avgR < 20 && bucket.avgG < 20 && bucket.avgB < 20),
		)
		.sort((a, b) => {
			const scoreA = a.avgSat * 2.5 + a.avgVal * 1.2 + a.coverage * 2.0;
			const scoreB = b.avgSat * 2.5 + b.avgVal * 1.2 + b.coverage * 2.0;
			return scoreB - scoreA;
		});

	const colors = vibrantBuckets
		.slice(0, maxColors)
		.map((bucket) => {
			const { avgR, avgG, avgB } = bucket;
			const hsv = rgbToHsv(avgR, avgG, avgB);
			if (hsv.v > 0.9) {
				const toned = hsvToRgb(hsv.h, Math.min(hsv.s * 0.95, 1), 0.9);
				return `rgb(${toned.r}, ${toned.g}, ${toned.b})`;
			}
			return `rgb(${avgR}, ${avgG}, ${avgB})`;
		});

	if (colors.length > 0) {
		return colors.map((color) => softenColor(color, 0.78, 0.95));
	}

	const fallback = Array.from(dominantMap.values())
		.sort((a, b) => b.count - a.count)
		.slice(0, maxColors)
		.map((bucket) => {
			const avgR = Math.round(bucket.r / bucket.count);
			const avgG = Math.round(bucket.g / bucket.count);
			const avgB = Math.round(bucket.b / bucket.count);
			return softenColor(`rgb(${avgR}, ${avgG}, ${avgB})`, 0.78, 0.95);
		});

	return fallback.length > 0 ? fallback : ["rgb(255, 255, 255)"];
}

export const bruh = <T>(obj: T): T => {
	return JSON.parse(JSON.stringify(obj));
};

class wTidal {
	public static readonly PlayState = PlayState;
	public static get featureFlags() {
		const { flags, userOverrides } = redux.store.getState().featureFlags;

		const featureFlags = bruh(flags);
		for (const key in userOverrides) {
			featureFlags[key].value = userOverrides[key];
		}
		return featureFlags;
	}
}

export function setFeatureFlag(flagName: string, value: boolean): void {
	const { flags } = redux.store.getState().featureFlags;

	if (flagName in flags && flags[flagName].value !== value) {
		redux.actions["featureFlags/TOGGLE_USER_OVERRIDE"]({
			...flags[flagName],
			value,
		});
	}
}

export function getFeatureFlag(flagName: string): boolean | null {
	const currentFlags = wTidal.featureFlags;

	if (flagName in currentFlags) {
		return currentFlags[flagName].value;
	}

	return null;
}
