// native color extraction, no external dependency
import { redux, PlayState } from "@luna/lib";


export const GetNPView = function (params?: any): HTMLElement {
	const element =
		document.querySelector<HTMLElement>('[data-test="now-playing"]') ||
		document.getElementById('nowPlaying') ||
		document.querySelector<HTMLElement>('section[class*="_nowPlayingContainer"]');

	if (!element) {
		throw new Error('bleh');
	}

	return element;
};

// Thank you @meowarex!
// https://github.com/meowarex/TidalLuna-Plugins/blob/0a694a5bc0cb98f72506077f63134bcece555e0d/plugins/radiant-lyrics-luna/src/index.ts#L450
export const retrieveCoverArt = function (): string | null {
	// console.log("[reactivo] attempt to fetch cover art element");
	const coverArtImageElement = document.querySelector(
		'figure[class*="_albumImage"] > div > div > div > img'
	) as HTMLImageElement | null;

	let coverArtImageSrc: string | null = null;

	if (coverArtImageElement) {
		// console.log("[reactivo] found cover art image element, src:", coverArtImageElement.src);
		coverArtImageSrc = coverArtImageElement.src;
		coverArtImageSrc = coverArtImageSrc.replace(/\d+x\d+/, "1280x1280");

		if (coverArtImageElement.src !== coverArtImageSrc) {
			coverArtImageElement.src = coverArtImageSrc;
		}
	} else {
		const videoElement = document.querySelector(
			'figure[class*="_albumImage"] > div > div > div > video'
		) as HTMLVideoElement | null;

		if (videoElement) {
			coverArtImageSrc = videoElement.getAttribute("poster");
			if (coverArtImageSrc) {
				coverArtImageSrc = coverArtImageSrc.replace(/\d+x\d+/, "1280x1280");
			}
		} else {
			console.log("[reactivo] no image or video element for cover art");
			return null;
		}
	}

	// console.log("[reactivo] returning cover art URL:", coverArtImageSrc);
	return coverArtImageSrc;
}

export function retrieveCoverArtVibrant(imageElement: HTMLImageElement): string {
	const canvas = document.createElement('canvas');
	let canvasWidth = imageElement.naturalWidth || imageElement.width;
	let canvasHeight = imageElement.naturalHeight || imageElement.height;

	if (canvasWidth === 0 || canvasHeight === 0) {
		console.warn("[reactivo] invalid image dimensions, defaulting to white");
		return "255, 255, 255";
	}

	// Scale down large images to reduce memory usage
	const maxSize = 512;
	if (canvasWidth > maxSize || canvasHeight > maxSize) {
		const scale = Math.min(maxSize / canvasWidth, maxSize / canvasHeight);
		canvasWidth = Math.floor(canvasWidth * scale);
		canvasHeight = Math.floor(canvasHeight * scale);
	}

	canvas.width = canvasWidth;
	canvas.height = canvasHeight;

	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) {
		console.warn("[reactivo] failed to get canvas context");
		return "255, 255, 255";
	}

	try {
		ctx.drawImage(imageElement, 0, 0, canvasWidth, canvasHeight);
		const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
		const data = imageData.data;

		const rgbToHsv = (r: number, g: number, b: number) => {
			r /= 255; g /= 255; b /= 255;
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

		interface ColorBucket {
			r: number;
			g: number;
			b: number;
			count: number;
			totalSat: number;
			totalVal: number;
		}

		// we need two maps here - one for vibrant colors and one for everything
		// this way we can find colors that are both punchy AND actually show up in the image
		const vibrantMap = new Map<number, ColorBucket>();
		const dominantMap = new Map<number, ColorBucket>();
		const step = 6;

		let totalPixels = 0;

		// hues that show up on the border — strong evidence of background color
		const perimeterHues = new Set<number>();

		const samplePixel = (x: number, y: number, isPerimeter: boolean) => {
			const idx = (y * canvas.width + x) * 4;
			const r = data[idx];
			const g = data[idx + 1];
			const b = data[idx + 2];
			const a = data[idx + 3];

			if (a < 128) return;
			if (r < 15 && g < 15 && b < 15) return; // skip blacks

			const { h, s, v } = rgbToHsv(r, g, b);
			const hueBucket = Math.round(h / 15) * 15;

			totalPixels++;

			if (isPerimeter) perimeterHues.add(hueBucket);

			if (!dominantMap.has(hueBucket)) {
				dominantMap.set(hueBucket, { r: 0, g: 0, b: 0, count: 0, totalSat: 0, totalVal: 0 });
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
					vibrantMap.set(hueBucket, { r: 0, g: 0, b: 0, count: 0, totalSat: 0, totalVal: 0 });
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

		// scan the full image at normal step
		for (let y = 0; y < canvas.height; y += step) {
			for (let x = 0; x < canvas.width; x += step) {
				samplePixel(x, y, false);
			}
		}

		// oversample the perimeter — every pixel on the 4 edges
		for (let x = 0; x < canvas.width; x++) {
			samplePixel(x, 0, true);
			samplePixel(x, canvas.height - 1, true);
		}
		for (let y = 1; y < canvas.height - 1; y++) {
			samplePixel(0, y, true);
			samplePixel(canvas.width - 1, y, true);
		}

		// grab the top 3 most common colors
		const topDominant = Array.from(dominantMap.entries())
			.sort((a, b) => b[1].count - a[1].count)
			.slice(0, 3)
			.map(([hue]) => hue);

		// a color needs to cover at least 3% of the image to be a real candidate —
		// this stops tiny vibrant elements (logos, text, gradients) from hijacking the result
		const MIN_COVERAGE = 0.03;

		let bestBucket: ColorBucket | null = null;
		let bestScore = 0;
		let bestHue = 0;

		for (const [hue, bucket] of vibrantMap.entries()) {
			const coverage = bucket.count / totalPixels;
			if (coverage < MIN_COVERAGE) continue;

			const avgSat = bucket.totalSat / bucket.count;
			const avgVal = bucket.totalVal / bucket.count;

			const isDominant = topDominant.includes(hue);
			const dominanceBonus = isDominant ? 2.0 : 0;

			// colors on the perimeter are very likely background — give them a meaningful boost
			const perimeterBonus = perimeterHues.has(hue) ? 1.5 : 0;

			const vibrancy = avgSat * 2.5;
			const brightness = avgVal * 0.5;
			// coverage now scales linearly instead of log — a color at 30% of the image
			// scores ~10x more here than one at 3%, making presence matter a lot more
			const popularity = coverage * 3.0;

			const score = vibrancy + brightness + popularity + dominanceBonus + perimeterBonus;

			if (score > bestScore) {
				bestScore = score;
				bestBucket = bucket;
				bestHue = hue;
			}
		}

		// if we didn't find anything vibrant, just pick the most saturated common color
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

		// average out the winning bucket
		let finalR = Math.round(bestBucket.r / bestBucket.count);
		let finalG = Math.round(bestBucket.g / bestBucket.count);
		let finalB = Math.round(bestBucket.b / bestBucket.count);

		// make it pop a bit more
		const finalHsv = rgbToHsv(finalR, finalG, finalB);
		const boostedSat = Math.min(finalHsv.s * 1.35, 1);

		// if the color came out a bit dark, nudge brightness up just enough to feel present
		// — kept intentionally small so it still reads as the same color from the cover
		const valBoost = finalHsv.v < 0.4 ? 1.75 : 1.15;
		const boostedVal = Math.min(finalHsv.v * valBoost, 1);

		// convert back to RGB
		const hsvToRgb = (h: number, s: number, v: number) => {
			const c = v * s;
			const x = c * (1 - Math.abs((h / 60) % 2 - 1));
			const m = v - c;
			let r = 0, g = 0, b = 0;

			if (h < 60) { r = c; g = x; b = 0; }
			else if (h < 120) { r = x; g = c; b = 0; }
			else if (h < 180) { r = 0; g = c; b = x; }
			else if (h < 240) { r = 0; g = x; b = c; }
			else if (h < 300) { r = x; g = 0; b = c; }
			else { r = c; g = 0; b = x; }

			return {
				r: Math.round((r + m) * 255),
				g: Math.round((g + m) * 255),
				b: Math.round((b + m) * 255)
			};
		};

		const boosted = hsvToRgb(finalHsv.h, boostedSat, boostedVal);
		finalR = boosted.r;
		finalG = boosted.g;
		finalB = boosted.b;

		return `${finalR}, ${finalG}, ${finalB}`;

	} catch (error) {
		console.error("[reactivo] error extracting color:", error);
		return "255, 255, 255";
	}
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
			value
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