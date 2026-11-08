/**
 * Image Trimmer for Tidal (MemClean)
 * Automatically purges uncompressed decoded bitmaps from RAM when album art
 * and artist banners scroll off-screen, and seamlessly restores them when approaching the viewport.
 */

const BLANK_PIXEL = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3C/svg%3E";

export class ImageTrimmer {
	private intersectionObserver: IntersectionObserver | null = null;
	private mutationObserver: MutationObserver | null = null;
	private observedImages = new WeakSet<HTMLImageElement>();
	private enabled = true;

	constructor(enabled = true) {
		this.enabled = enabled;
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

	public start(): void {
		if (this.intersectionObserver) return;

		// 350px rootMargin gives plenty of time to re-hydrate images before they enter view
		this.intersectionObserver = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const img = entry.target as HTMLImageElement;
					if (entry.isIntersecting) {
						this.restoreImage(img);
					} else {
						this.trimImage(img);
					}
				}
			},
			{
				rootMargin: "350px 0px 350px 0px",
				threshold: 0,
			}
		);

		// Observe existing images in the DOM
		this.scanAndObserve();

		// Watch for newly added images as user scrolls or navigates
		this.mutationObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				for (let i = 0; i < mutation.addedNodes.length; i++) {
					const node = mutation.addedNodes[i];
					if (node.nodeType === Node.ELEMENT_NODE) {
						const el = node as HTMLElement;
						if (el.tagName === "IMG") {
							this.maybeObserveImage(el as HTMLImageElement);
						} else if (el.querySelectorAll) {
							const imgs = el.querySelectorAll<HTMLImageElement>("img");
							imgs.forEach((img) => this.maybeObserveImage(img));
						}
					}
				}
			}
		});

		this.mutationObserver.observe(document.body, {
			childList: true,
			subtree: true,
		});
	}

	public stop(): void {
		if (this.mutationObserver) {
			this.mutationObserver.disconnect();
			this.mutationObserver = null;
		}

		if (this.intersectionObserver) {
			this.intersectionObserver.disconnect();
			this.intersectionObserver = null;
		}

		// Restore all trimmed images back to their original sources
		document.querySelectorAll<HTMLImageElement>("img[data-memclean-src]").forEach((img) => {
			this.restoreImage(img);
		});
	}

	/**
	 * Actively audits the DOM and trims any off-screen images that escaped the observer.
	 */
	public trimAllOffscreen(): void {
		if (!this.enabled) return;
		const windowH = window.innerHeight;
		const imgs = document.querySelectorAll<HTMLImageElement>("img");
		imgs.forEach((img) => {
			if (!this.isCandidateImage(img)) return;
			const rect = img.getBoundingClientRect();
			if (rect.bottom < -350 || rect.top > windowH + 350) {
				this.trimImage(img);
			}
		});
	}

	private isCandidateImage(img: HTMLImageElement): boolean {
		// Do not touch active playback imagery in the bottom bar
		if (img.closest('[data-test="current-media-imagery"], [class*="playControls"]')) {
			return false;
		}

		const src = img.src || img.dataset.memcleanSrc || "";
		if (!src) return false;

		// Target Tidal CDN covers, thumbnails, artist banners, and grid items
		return (
			src.includes("tidal.com") ||
			src.includes("resources.tidal.com") ||
			img.matches('[data-test*="image"], [class*="mediaImagery"] img, [class*="imageContainer"] img')
		);
	}

	private maybeObserveImage(img: HTMLImageElement): void {
		if (this.observedImages.has(img)) return;
		if (!this.isCandidateImage(img)) return;

		this.observedImages.add(img);
		this.intersectionObserver?.observe(img);
	}

	private scanAndObserve(): void {
		const imgs = document.querySelectorAll<HTMLImageElement>("img");
		imgs.forEach((img) => this.maybeObserveImage(img));
	}

	private trimImage(img: HTMLImageElement): void {
		const currentSrc = img.src;
		if (!currentSrc || currentSrc.startsWith("data:") || currentSrc === BLANK_PIXEL) {
			return;
		}

		// Preserve dimensions to prevent any layout shift or scroll jump
		if (!img.style.aspectRatio && img.naturalWidth && img.naturalHeight) {
			img.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
		}

		img.dataset.memcleanSrc = currentSrc;
		// Assigning blank SVG clears the uncompressed decoded bitmap from Chromium's ImageDecoder
		img.src = BLANK_PIXEL;
	}

	private restoreImage(img: HTMLImageElement): void {
		const originalSrc = img.dataset.memcleanSrc;
		if (originalSrc) {
			delete img.dataset.memcleanSrc;
			img.src = originalSrc;
		}
	}
}

