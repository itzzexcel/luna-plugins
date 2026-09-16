import { LunaUnload } from "@luna/core";
import { MediaItem, redux } from "@luna/lib";

export { Settings } from "./Settings";
export const unloads = new Set<LunaUnload>();

const INJECT_FLAG = "data-luna-dsp-links";
const INJECT_KEY_DATASET = "lunaDspKey"; // -> data-luna-dsp-key
const FONTAWESOME_URL = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css";
const TOKEN_TIMEOUT_MS = 10_000;

/** Un elemento cuenta como "fila" si matchea alguno de estos. */
const ROW_SELECTOR = [
	'[data-type="mediaItem"]',
	"[data-track--content-id]",
	'[data-test="tracklist-row"]',
].join(", ");

/** Cualquier evento con target dentro de esto NO es un trigger de apertura de menú. */
const OPEN_MENU_SELECTOR = '[data-test="contextmenu"], [class*="_subMenu_"]';

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

const getEnabledPlatforms = (): (keyof DspLinks)[] => {
	try {
		const saved = localStorage.getItem("sharePlusPlatforms");
		if (!saved) return PLATFORM_KEYS;
		const enabled = JSON.parse(saved) as Record<string, boolean>;
		return PLATFORM_KEYS.filter((key) => enabled[key] !== false);
	} catch {
		return PLATFORM_KEYS;
	}
};

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

type TriggerSource = "row" | "global";

type Trigger = {
	seq: number;
	trackId: number | null;
	source: TriggerSource;
};

let triggerSeq = 0;
let pendingTrigger: Trigger | null = null;
let lastScannedSeq = -1;

const menuStamps = new WeakMap<HTMLElement, Trigger>();

function getCurrentTrackId(): number | null {
	try {
		const state: any = redux.store.getState();
		const item = state?.playbackControls?.currentMediaItem;
		return item?.id ? Number(item.id) : null;
	} catch {
		return null;
	}
}

function readTrackIdFrom(el: Element | null | undefined): number | null {
	if (!el) return null;
	const raw =
		el.getAttribute("data-track--content-id") ??
		el.getAttribute("data-track-id") ??
		el.getAttribute("data-id");
	if (!raw) return null;
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? n : null;
}

function captureTrigger(e: Event): void {
	const target = e.target as HTMLElement | null;
	if (!target || typeof target.closest !== "function") return;
	if (target.closest(OPEN_MENU_SELECTOR)) return;

	const row = target.closest<HTMLElement>(ROW_SELECTOR);
	const rowId =
		readTrackIdFrom(row) ??
		readTrackIdFrom(target.closest<HTMLElement>('[data-test="context-menu-button"]'));

	pendingTrigger = {
		seq: ++triggerSeq,
		trackId: rowId ?? getCurrentTrackId(),
		source: rowId ? "row" : "global",
	};

	if (pendingTrigger.trackId) void fetchSongPlatforms(pendingTrigger.trackId);
}

for (const type of ["pointerdown", "mousedown", "contextmenu"] as const) {
	document.addEventListener(type, captureTrigger, true);
}
unloads.add(() => {
	for (const type of ["pointerdown", "mousedown", "contextmenu"] as const) {
		document.removeEventListener(type, captureTrigger, true);
	}
});

function resolveTriggerForMenu(menu: HTMLElement): Trigger | null {
	const stamp = menuStamps.get(menu);
	if (pendingTrigger && (!stamp || pendingTrigger.seq > stamp.seq)) {
		menuStamps.set(menu, pendingTrigger);
		return pendingTrigger;
	}
	return stamp ?? null;
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

function buildLinkItem(
	subMenu: HTMLElement,
	url: string,
	label: string,
	iconClass: string
): HTMLLIElement {
	const template = subMenu.querySelector<HTMLElement>('[data-test="copy-share-link"]');
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

async function injectLinks(links: DspLinks | null, subMenu: HTMLElement): Promise<void> {
	if (!links) return;

	const ul = subMenu.querySelector("ul");
	if (!ul) return;

	ul.querySelectorAll(`[${INJECT_FLAG}]`).forEach((n) => n.remove());

	await ensureFontAwesome();
	if (!document.contains(subMenu)) return;

	for (const key of getEnabledPlatforms()) {
		const href = links[key]?.href;
		if (!href) continue;
		ul.appendChild(buildLinkItem(subMenu, href, PLATFORM_META[key].label, PLATFORM_META[key].icon));
	}
}

function isShareSubMenu(el: HTMLElement): boolean {
	return !!el.querySelector('[data-test="copy-share-link"]');
}

async function processSubMenu(subMenu: HTMLElement): Promise<void> {
	if (!isShareSubMenu(subMenu)) return;

	const menu = subMenu.closest<HTMLElement>('[data-test="contextmenu"]');
	if (!menu) return;

	const trigger = resolveTriggerForMenu(menu);
	const id = trigger?.trackId ?? getCurrentTrackId();
	if (!id) return;

	const key = `${trigger?.seq ?? 0}:${id}`;
	if (subMenu.dataset[INJECT_KEY_DATASET] === key) return;
	subMenu.dataset[INJECT_KEY_DATASET] = key;

	log.msg(`submenu -> source=${trigger?.source ?? "fallback"} id=${id}`);

	const links = await fetchSongPlatforms(id);

	if (!document.contains(subMenu) || subMenu.dataset[INJECT_KEY_DATASET] !== key) return;

	if (!links) {
		delete subMenu.dataset[INJECT_KEY_DATASET]; 
		return;
	}

	await injectLinks(links, subMenu);
}

function collectAddedSubMenus(mutations: MutationRecord[]): HTMLElement[] {
	const found = new Set<HTMLElement>();

	for (const m of mutations) {
		for (const node of Array.from(m.addedNodes)) {
			if (!(node instanceof HTMLElement)) continue;

			const cn = typeof node.className === "string" ? node.className : "";
			if (cn.includes("_subMenu_")) found.add(node);

			node.querySelectorAll?.<HTMLElement>('[class*="_subMenu_"]').forEach((el) => found.add(el));
		}
	}

	return Array.from(found);
}

const observer = new MutationObserver((mutations) => {
	let subMenus = collectAddedSubMenus(mutations);

	if (subMenus.length === 0 && pendingTrigger && pendingTrigger.seq !== lastScannedSeq) {
		lastScannedSeq = pendingTrigger.seq;
		subMenus = Array.from(document.querySelectorAll<HTMLElement>('[class*="_subMenu_"]'));
	}

	for (const subMenu of subMenus) void processSubMenu(subMenu);
});

observer.observe(document.body, { childList: true, subtree: true });
unloads.add(() => observer.disconnect());

MediaItem.onMediaTransition(unloads, async (mediaItem: MediaItem) => {
	if (!mediaItem) return;
	currentTrackId = Number(mediaItem.id);
	void fetchSongPlatforms(currentTrackId);
});

/* ------------------------------------------------------------------ */
/* Debug                                                               */
/* ------------------------------------------------------------------ */

(window as any).__sharePlus = {
	injectLinks,
	fetchSongPlatforms,
	getCurrentTrackId,
	processSubMenu,
	waitForToken,
	get capturedToken() { return capturedToken; },
	get currentTrackId() { return currentTrackId; },
	get pendingTrigger() { return pendingTrigger; },
	stampFor: (menu: HTMLElement) => menuStamps.get(menu),
};