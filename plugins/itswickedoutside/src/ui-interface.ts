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
	// console.log("[reactivo] extracting vibrant colour from image", imageElement.src);

	const canvas = document.createElement('canvas');
	canvas.width = imageElement.naturalWidth || imageElement.width;
	canvas.height = imageElement.naturalHeight || imageElement.height;

	// console.log("[reactivo] canvas dimensions", canvas.width, canvas.height);

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

		// Collect the vibrant colours in buckets
		interface ColorBucket {
			r: number;
			g: number;
			b: number;
			count: number;
			totalSat: number;
			totalVal: number;
		}

		const colorMap = new Map<number, ColorBucket>();
		const step = 6;

		// First pass: Get vibrant colours
		for (let y = 0; y < canvas.height; y += step) {
			for (let x = 0; x < canvas.width; x += step) {
				const idx = (y * canvas.width + x) * 4;
				const r = data[idx];
				const g = data[idx + 1];
				const b = data[idx + 2];
				const a = data[idx + 3];

				if (a < 128) continue;
				if (r < 20 && g < 20 && b < 20) continue;

				const { h, s, v } = rgbToHsv(r, g, b);

				// filter colours iwht good saturation
				if (s < 0.3) continue; // Ignorar dead colours
				if (v < 0.2) continue; // Ignore very darks

				// Group hues every 15°
				const hueBucket = Math.round(h / 15) * 15;

				if (!colorMap.has(hueBucket)) {
					colorMap.set(hueBucket, {
						r: 0, g: 0, b: 0,
						count: 0,
						totalSat: 0,
						totalVal: 0
					});
				}

				const bucket = colorMap.get(hueBucket)!;
				bucket.r += r;
				bucket.g += g;
				bucket.b += b;
				bucket.count++;
				bucket.totalSat += s;
				bucket.totalVal += v;
			}
		}

		if (colorMap.size === 0) {
			// console.warn("[reactivo] no vibrant colors found, using fallback");
			return "255, 255, 255";
		}

		// Second pass: Found the most vibrant bucket
		let bestBucket: ColorBucket | null = null;
		let bestScore = 0;

		for (const bucket of colorMap.values()) {
			const avgSat = bucket.totalSat / bucket.count;
			const avgVal = bucket.totalVal / bucket.count;

			const vibrancy = avgSat * 2; // Priorise sat
			const brightness = avgVal * 0.5;
			const popularity = Math.min(bucket.count / 100, 1) * 0.5; // Bonus the dominant (mmmpppfgh)

			const score = vibrancy + brightness + popularity;

			if (score > bestScore) {
				bestScore = score;
				bestBucket = bucket;
			}
		}

		if (!bestBucket) {
			console.warn("[reactivo] no best bucket found");
			return "255, 255, 255";
		}

		// Gamble
		let finalR = Math.round(bestBucket.r / bestBucket.count);
		let finalG = Math.round(bestBucket.g / bestBucket.count);
		let finalB = Math.round(bestBucket.b / bestBucket.count);

		// Boost saturation
		const finalHsv = rgbToHsv(finalR, finalG, finalB);
		const boostedSat = Math.min(finalHsv.s * 1.3, 1); // +30% sat
		const boostedVal = Math.min(finalHsv.v * 1.1, 1); // +10% brightness

		// Back to RGB
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
		// console.log("[reactivo] picket a colour", colour,
			// `(sat: ${boostedSat.toFixed(2)}, val: ${boostedVal.toFixed(2)}, pixels: ${bestBucket.count})`);

		return colour;

	} catch (error) {
		console.error("[reactivo] error extracting color:", error);
		return "255, 255, 255";
	}
}