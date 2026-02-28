// native color extraction, no external dependency


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
	canvas.width = imageElement.naturalWidth || imageElement.width;
	canvas.height = imageElement.naturalHeight || imageElement.height;

	if (canvas.width === 0 || canvas.height === 0) {
		console.warn("[reactivo] invalid image dimensions, defaulting to white");
		return "255, 255, 255";
	}

	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) {
		console.warn("[reactivo] failed to get canvas context");
		return "255, 255, 255";
	}

	try {
		ctx.drawImage(imageElement, 0, 0);
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

		// scan the image and sort colors into buckets
		for (let y = 0; y < canvas.height; y += step) {
			for (let x = 0; x < canvas.width; x += step) {
				const idx = (y * canvas.width + x) * 4;
				const r = data[idx];
				const g = data[idx + 1];
				const b = data[idx + 2];
				const a = data[idx + 3];

				if (a < 128) continue;
				if (r < 15 && g < 15 && b < 15) continue; // skip blacks

				const { h, s, v } = rgbToHsv(r, g, b);
				const hueBucket = Math.round(h / 15) * 15;

				totalPixels++;

				// throw everything in the dominant map
				if (!dominantMap.has(hueBucket)) {
					dominantMap.set(hueBucket, {
						r: 0, g: 0, b: 0,
						count: 0,
						totalSat: 0,
						totalVal: 0
					});
				}

				const domBucket = dominantMap.get(hueBucket)!;
				domBucket.r += r;
				domBucket.g += g;
				domBucket.b += b;
				domBucket.count++;
				domBucket.totalSat += s;
				domBucket.totalVal += v;

				// only add to vibrant map if it's actually colorful
				if (s >= 0.3 && v >= 0.2) {
					if (!vibrantMap.has(hueBucket)) {
						vibrantMap.set(hueBucket, {
							r: 0, g: 0, b: 0,
							count: 0,
							totalSat: 0,
							totalVal: 0
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
			}
		}

		// grab the top 3 most common colors
		const topDominant = Array.from(dominantMap.entries())
			.sort((a, b) => b[1].count - a[1].count)
			.slice(0, 3)
			.map(([hue]) => hue);

		// now find the best vibrant color, preferring ones that show up a lot
		let bestBucket: ColorBucket | null = null;
		let bestScore = 0;
		let bestHue = 0;

		for (const [hue, bucket] of vibrantMap.entries()) {
			const avgSat = bucket.totalSat / bucket.count;
			const avgVal = bucket.totalVal / bucket.count;

			// huge boost if this color is in the top 3
			const isDominant = topDominant.includes(hue);
			const dominanceBonus = isDominant ? 2.0 : 0;

			const vibrancy = avgSat * 2.5;
			const brightness = avgVal * 0.5;
			const popularity = Math.log10(bucket.count + 1) * 0.3;

			const score = vibrancy + brightness + popularity + dominanceBonus;

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
		const boostedVal = Math.min(finalHsv.v * 1.15, 1);

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

		const colour = `${finalR}, ${finalG}, ${finalB}`;

		return colour;

	} catch (error) {
		console.error("[reactivo] error extracting color:", error);
		return "255, 255, 255";
	}
}