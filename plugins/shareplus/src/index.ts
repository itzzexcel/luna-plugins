import { LunaUnload } from "@luna/core";
import { MediaItem, redux } from "@luna/lib";

export { Settings } from "./Settings";
export const unloads = new Set<LunaUnload>();

const SHARE_SUBMENU_MARKER = "Music shared from TIDAL can be opened on other services";
const INJECT_FLAG = "data-luna-dsp-links";
const FONTAWESOME_URL = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css";
const TOKEN_TIMEOUT_MS = 10_000;

type DspLinks = {
	spotify?: { href: string };
	appleMusic?: { href: string };
	youTubeMusic?: { href: string };
	amazonMusic?: { href: string };
};

type DspSharingLinksResponse = {
	data: Array<{ id: string; type: "dspSharingLinks"; attributes: DspLinks }>;
};

const PLATFORM_META: Record<keyof DspLinks, { label: string; icon: string }> = {
	spotify:      { label: "Spotify",       icon: "fa-brands fa-spotify" },
	appleMusic:   { label: "Apple Music",   icon: "fa-brands fa-apple" },
	youTubeMusic: { label: "YouTube Music", icon: "fa-brands fa-youtube" },
	amazonMusic:  { label: "Amazon Music",  icon: "fa-brands fa-amazon" },
};

const PLATFORM_KEYS = Object.keys(PLATFORM_META) as (keyof DspLinks)[];

const log = {
	msg: (...args: unknown[]) => console.log("[SharePlus]", ...args),
	err: (...args: unknown[]) => console.error("[SharePlus]", ...args),
};

let capturedToken: string | null = null;
let currentTrackId: number | null = null;

const linksCache = new Map<number, DspLinks>();
let fontAwesomePromise: Promise<void> | null = null;

const restoreFetch = (() => {
	const originalFetch = window.fetch;

	window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
		try {
			const headers = new Headers(
				init?.headers ?? (input instanceof Request ? input.headers : undefined)
			);
			const auth = headers.get("authorization");
			if (auth?.startsWith("Bearer ")) {
				const next = auth.slice(7);
				if (next !== capturedToken) capturedToken = next;
			}
		} catch {}
		return originalFetch.apply(window, [input, init]);
	} as typeof fetch;

	return () => {
		window.fetch = originalFetch;
	};
})();
unloads.add(restoreFetch);

async function waitForToken(timeoutMs = TOKEN_TIMEOUT_MS): Promise<string | null> {
	if (capturedToken) return capturedToken;
	const start = Date.now();
	while (!capturedToken && Date.now() - start < timeoutMs) {
		await new Promise((r) => setTimeout(r, 100));
	}
	return capturedToken;
}

async function fetchSongPlatforms(id: number): Promise<DspLinks | null> {
	const cached = linksCache.get(id);
	if (cached) return cached;

	const token = await waitForToken();
	if (!token) {
		log.err("Failed to capture TIDAL token");
		return null;
	}

	const url = `https://openapi.tidal.com/v2/dspSharingLinks?filter%5Bsubject.id%5D=${id}&filter%5Bsubject.type%5D=tracks`;

	try {
		const res = await fetch(url, {
			headers: {
				accept: "application/vnd.api+json",
				authorization: `Bearer ${token}`,
			},
			credentials: "include",
		});

		if (!res.ok) {
			if (res.status === 401) capturedToken = null;
			return null;
		}

		const json: DspSharingLinksResponse = await res.json();
		const attrs = json?.data?.[0]?.attributes ?? null;
		if (attrs) linksCache.set(id, attrs);
		return attrs;
	} catch (e) {
		log.err("fetchSongPlatforms failed:", e);
		return null;
	}
}

function getCurrentTrackId(): number | null {
	try {
		const state: any = redux.store.getState();
		const item = state?.playbackControls?.currentMediaItem;
		return item?.id ? Number(item.id) : null;
	} catch {
		return null;
	}
}

function getShareSubMenu(): HTMLElement | null {
	let marker = document.querySelector<HTMLElement>(
		`[title="${CSS.escape(SHARE_SUBMENU_MARKER)}"]`
	);

	if (!marker) {
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
			acceptNode(node) {
				const el = node as HTMLElement;
				const own = Array.from(el.childNodes)
					.filter((n) => n.nodeType === Node.TEXT_NODE)
					.map((n) => n.textContent?.trim())
					.join("");
				return own === SHARE_SUBMENU_MARKER
					? NodeFilter.FILTER_ACCEPT
					: NodeFilter.FILTER_SKIP;
			},
		});
		marker = walker.nextNode() as HTMLElement | null;
	}

	if (!marker) return null;

	let parent: HTMLElement | null = marker.parentElement;
	while (parent) {
		const cn =
			typeof parent.className === "string"
				? parent.className
				: (parent.className as unknown as SVGAnimatedString)?.baseVal ?? "";
		if (cn.includes("_subMenu_")) return parent;
		parent = parent.parentElement;
	}
	return null;
}

function showCopied(btn: HTMLButtonElement): void {
	const labelEl = btn.querySelector("span:last-child");
	if (!labelEl) return;
	const original = labelEl.textContent ?? "";
	labelEl.textContent = "Copied!";
	setTimeout(() => (labelEl.textContent = original), 1200);
}

async function copyToClipboard(text: string, btn: HTMLButtonElement): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		showCopied(btn);
		return;
	} catch {}

	try {
		const textarea = document.createElement("textarea");
		textarea.value = text;
		textarea.style.cssText = "position:fixed;top:-9999px;left:-9999px;";
		textarea.setAttribute("readonly", "");
		document.body.appendChild(textarea);
		textarea.select();
		textarea.setSelectionRange(0, text.length);
		const ok = document.execCommand("copy");
		document.body.removeChild(textarea);
		if (ok) showCopied(btn);
		else log.err("execCommand copy returned false");
	} catch (e) {
		log.err("copy fallback failed:", e);
	}
}

function ensureFontAwesome(): Promise<void> {
	if (fontAwesomePromise) return fontAwesomePromise;

	if (document.querySelector('link[href*="font-awesome"]')) {
		fontAwesomePromise = Promise.resolve();
		return fontAwesomePromise;
	}

	fontAwesomePromise = new Promise<void>((resolve) => {
		const link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = FONTAWESOME_URL;
		link.onload = () => resolve();
		link.onerror = () => resolve();
		document.head.appendChild(link);
	});

	return fontAwesomePromise;
}

function buildLinkItem(url: string, label: string, iconClass: string): HTMLLIElement {
	const template = document.querySelector<HTMLElement>('[data-test="copy-share-link"]');
	const templateLi = template?.closest("li") as HTMLLIElement | null;

	const li = templateLi
		? (templateLi.cloneNode(true) as HTMLLIElement)
		: document.createElement("li");

	li.setAttribute(INJECT_FLAG, "true");
	[
		"data-track--icon-clicked",
		"data-tracktype--icon-clicked",
		"data-track--icon-placement",
		"data-tracktype--icon-placement",
	].forEach((a) => li.removeAttribute(a));

	const svgIcon = li.querySelector("svg");
	if (svgIcon) {
		svgIcon.outerHTML = `<i class="${iconClass}" style="margin-right:2px;text-align:center;"></i>`;
	}

	const button = li.querySelector("button");
	if (!button) return li;

	button.setAttribute("data-test", `luna-dsp-${label.toLowerCase().replace(/\s+/g, "-")}`);

	const labelEl = button.querySelector("span:last-child");
	if (labelEl) labelEl.textContent = label;

	button.addEventListener("click", (e) => {
		e.stopPropagation();
		void copyToClipboard(url, button);
	});

	return li;
}

async function injectLinks(links: DspLinks | null): Promise<void> {
	if (!links) return;

	const subMenu = getShareSubMenu();
	if (!subMenu) return;

	const ul = subMenu.querySelector("ul");
	if (!ul) return;

	ul.querySelectorAll(`[${INJECT_FLAG}]`).forEach((n) => n.remove());

	await ensureFontAwesome();

	for (const key of PLATFORM_KEYS) {
		const href = links[key]?.href;
		if (!href) continue;
		ul.appendChild(buildLinkItem(href, PLATFORM_META[key].label, PLATFORM_META[key].icon));
	}
}

MediaItem.onMediaTransition(unloads, async (mediaItem: MediaItem) => {
	if (!mediaItem) return;
	currentTrackId = Number(mediaItem.id);

	const links = await fetchSongPlatforms(currentTrackId);
	if (links && document.querySelector('[class*="_subMenu_"]')) {
		void injectLinks(links);
	}
});

const observer = new MutationObserver(async (mutations) => {
	const addedSubMenu = mutations.some((m) =>
		Array.from(m.addedNodes).some(
			(n) =>
				n instanceof HTMLElement &&
				((typeof n.className === "string" && n.className.includes("_subMenu_")) ||
					n.querySelector?.('[class*="_subMenu_"]'))
		)
	);
	if (!addedSubMenu) return;

	const id = currentTrackId ?? getCurrentTrackId();
	if (!id) return;

	const links = await fetchSongPlatforms(id);
	void injectLinks(links);
});

observer.observe(document.body, { childList: true, subtree: true });
unloads.add(() => observer.disconnect());

(window as any).__sharePlus = {
	getShareSubMenu,
	injectLinks,
	fetchSongPlatforms,
	getCurrentTrackId,
	waitForToken,
	get capturedToken() { return capturedToken; },
	get currentTrackId() { return currentTrackId; },
};