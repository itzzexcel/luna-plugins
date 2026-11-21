import type { EngineStatus, KaraokeMode } from "./bridgeClient";

export interface KaraokeUiCallbacks {
	onToggleEnabled: (enabled: boolean) => void;
	onChangeVocalGainPct: (pct: number) => void;
	onChangeMode: (mode: KaraokeMode) => void;
	onDownloadModel: (model: "karaoke" | "instrumental") => void;
	onReconnect: () => void;
	getInitialState: () => {
		enabled: boolean;
		vocalGainPct: number;
		mode: KaraokeMode;
		port: number;
	};
}

const STYLE_ID = "karaoke-geist-styles";

const GEIST_CSS = `
	.krk-mic-btn,
	.krk-mic-btn:hover,
	.krk-mic-btn:active,
	.krk-mic-btn:focus,
	.krk-mic-btn:focus-visible,
	.krk-mic-btn[data-active="true"],
	.krk-mic-btn[data-active="true"]:hover {
		background: transparent !important;
		background-color: transparent !important;
		border-color: transparent !important;
		box-shadow: none !important;
	}
	.krk-mic-btn {
		position: relative;
		width: 28px;
		height: 28px;
		border-radius: 6px;
		border: none;
		background: transparent !important;
		color: rgba(255, 255, 255, 0.62);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		margin: 0 2px;
		padding: 0;
		flex-shrink: 0;
		transition: color 120ms ease;
	}
	.krk-mic-btn:hover {
		color: #ededed;
	}
	.krk-mic-btn[data-active="true"] {
		color: #ededed;
	}
	.krk-pop button:focus-visible,
	.krk-slider:focus-visible {
		outline: 1px solid #ededed;
		outline-offset: 1px;
	}
	.krk-mic-dot {
		position: absolute;
		bottom: 3px;
		left: 50%;
		width: 4px;
		height: 4px;
		margin-left: -2px;
		border-radius: 999px;
		background: #ededed;
		opacity: 0;
		pointer-events: none;
		transition: opacity 120ms ease;
	}
	.krk-mic-btn[data-active="true"] .krk-mic-dot {
		opacity: 1;
	}

	.krk-pop {
		position: fixed;
		right: 24px;
		bottom: 84px;
		width: 248px;
		z-index: 999990;
		display: none;
		flex-direction: column;
		background: #0a0a0a;
		border: 1px solid #262626;
		border-radius: 10px;
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.72);
		color: #ededed;
		font-family: "Geist", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
		font-variant-numeric: tabular-nums;
		-webkit-font-smoothing: antialiased;
		user-select: none;
		overflow: hidden;
	}

	.krk-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 12px 12px 10px;
		border-bottom: 1px solid #1a1a1a;
	}
	.krk-title-wrap {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.krk-title {
		font-size: 13px;
		font-weight: 500;
		line-height: 1.25;
		letter-spacing: -0.01em;
		color: #ededed;
	}
	.krk-status {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		font-weight: 400;
		line-height: 1.3;
		color: #888888;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.krk-status-dot {
		width: 6px;
		height: 6px;
		border-radius: 999px;
		background: #525252;
		flex-shrink: 0;
	}

	.krk-switch {
		position: relative;
		width: 32px;
		height: 18px;
		padding: 0;
		border: 1px solid #2e2e2e;
		border-radius: 999px;
		background: #262626;
		cursor: pointer;
		flex-shrink: 0;
		transition: background 140ms ease, border-color 140ms ease;
	}
	.krk-switch[aria-checked="true"] {
		background: #ededed;
		border-color: #ededed;
	}
	.krk-switch-thumb {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 12px;
		height: 12px;
		border-radius: 999px;
		background: #888888;
		transition: transform 140ms ease, background 140ms ease;
		pointer-events: none;
	}
	.krk-switch[aria-checked="true"] .krk-switch-thumb {
		transform: translateX(14px);
		background: #0a0a0a;
	}

	.krk-level-sec {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		border-bottom: 1px solid #1a1a1a;
	}
	.krk-level-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.krk-label {
		font-size: 11px;
		font-weight: 400;
		color: #888888;
	}
	.krk-val {
		font-size: 12px;
		font-weight: 500;
		color: #ededed;
	}

	.krk-slider {
		position: relative;
		height: 24px;
		display: flex;
		align-items: center;
		cursor: pointer;
		touch-action: none;
		border-radius: 4px;
	}
	.krk-slider-rail {
		position: relative;
		width: 100%;
		height: 3px;
		border-radius: 999px;
		background: #262626;
	}
	.krk-slider-fill {
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 15%;
		border-radius: 999px;
		background: #ededed;
		pointer-events: none;
	}
	.krk-slider-thumb {
		position: absolute;
		top: 50%;
		left: 15%;
		width: 12px;
		height: 12px;
		margin-left: -6px;
		margin-top: -6px;
		border-radius: 999px;
		background: #ededed;
		border: 1px solid #0a0a0a;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
		pointer-events: none;
		transition: transform 90ms ease;
	}
	.krk-slider:hover .krk-slider-thumb,
	.krk-slider[data-dragging="true"] .krk-slider-thumb {
		transform: scale(1.12);
	}

	.krk-chips {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 4px;
	}
	.krk-chip {
		height: 24px;
		padding: 0;
		border-radius: 6px;
		border: 1px solid #222222;
		background: #141414;
		color: #888888;
		font-family: inherit;
		font-size: 11px;
		font-weight: 400;
		cursor: pointer;
		transition: background 110ms ease, border-color 110ms ease, color 110ms ease;
	}
	.krk-chip:hover {
		background: #1c1c1c;
		color: #ededed;
	}
	.krk-chip[data-active="true"] {
		background: #ededed;
		border-color: #ededed;
		color: #0a0a0a;
		font-weight: 500;
	}

	.krk-foot {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px 12px 12px;
	}
	.krk-seg {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 2px;
		padding: 2px;
		border-radius: 7px;
		background: #141414;
		border: 1px solid #222222;
	}
	.krk-seg-btn {
		height: 24px;
		padding: 0 4px;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: #777777;
		font-family: inherit;
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		transition: background 110ms ease, color 110ms ease;
	}
	.krk-seg-btn:hover {
		color: #d4d4d4;
	}
	.krk-seg-btn[data-active="true"] {
		background: #262626;
		color: #ededed;
	}

	.krk-dl {
		display: none;
		flex-direction: column;
		gap: 6px;
	}
	.krk-dl-btn {
		height: 28px;
		padding: 0 10px;
		border-radius: 6px;
		border: 1px solid #2a2a2a;
		background: #141414;
		color: #ededed;
		font-family: inherit;
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		transition: background 110ms ease, border-color 110ms ease;
	}
	.krk-dl-btn:hover:not(:disabled) {
		background: #1c1c1c;
		border-color: #3a3a3a;
	}
	.krk-dl-btn:disabled {
		color: #888888;
		cursor: default;
	}
	.krk-dl-track {
		display: none;
		height: 2px;
		border-radius: 999px;
		background: #262626;
		overflow: hidden;
	}
	.krk-dl-bar {
		height: 100%;
		width: 0%;
		background: #ededed;
		transition: width 120ms linear;
	}

	.krk-offline {
		display: none;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 6px 8px;
		border-radius: 6px;
		background: #141414;
		border: 1px solid #262626;
		font-size: 11px;
		color: #888888;
	}
	.krk-retry-btn {
		height: 22px;
		padding: 0 8px;
		border-radius: 5px;
		border: none;
		background: #ededed;
		color: #0a0a0a;
		font-family: inherit;
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		flex-shrink: 0;
		transition: opacity 110ms ease;
	}
	.krk-retry-btn:hover {
		opacity: 0.88;
	}
`;

/**
 * Minimal Vercel / Geist vocal control footer button and popover.
 */
export class KaraokeUi {
	private callbacks: KaraokeUiCallbacks;
	private styleEl: HTMLStyleElement;
	private micButton: HTMLButtonElement;
	private popover: HTMLDivElement;

	private enableToggle!: HTMLButtonElement;
	private statusDot!: HTMLSpanElement;
	private statusText!: HTMLSpanElement;
	private modeButtons!: Record<KaraokeMode, HTMLButtonElement>;

	private sliderEl!: HTMLDivElement;
	private sliderFill!: HTMLDivElement;
	private sliderThumb!: HTMLDivElement;
	private sliderValueLabel!: HTMLSpanElement;
	private presetButtons: HTMLButtonElement[] = [];

	private downloadBox!: HTMLDivElement;
	private downloadBtn!: HTMLButtonElement;
	private downloadTrack!: HTMLDivElement;
	private downloadBar!: HTMLDivElement;
	private offlineBanner!: HTMLDivElement;

	private domObserver: MutationObserver | null = null;
	private mountCheckTimer: number | null = null;
	private isOpen = false;
	private isDraggingSlider = false;
	private destroyed = false;

	private currentEnabled = false;
	private currentVocalGainPct = 15;
	private currentMode: KaraokeMode = "karaoke";
	private latestStatus: EngineStatus | null = null;
	private latestConnected = false;

	constructor(callbacks: KaraokeUiCallbacks) {
		this.callbacks = callbacks;
		const init = callbacks.getInitialState();
		this.currentEnabled = init.enabled;
		this.currentVocalGainPct = init.vocalGainPct;
		this.currentMode = init.mode;

		this.styleEl = this.ensureStyles();
		this.micButton = this.createMicButton();
		this.popover = this.createPopover();

		document.body.appendChild(this.popover);
		document.addEventListener("pointerdown", this.handleOutsidePointerDown, true);
		document.addEventListener("keydown", this.handleKeyDown, true);

		this.ensureMounted();
		if (typeof MutationObserver !== "undefined") {
			this.domObserver = new MutationObserver(() => {
				if (this.mountCheckTimer !== null) return;
				this.mountCheckTimer = window.setTimeout(() => {
					this.mountCheckTimer = null;
					this.ensureMounted();
				}, 300);
			});
			this.domObserver.observe(document.body, { childList: true, subtree: true });
		}

		this.render();
	}

	private ensureStyles(): HTMLStyleElement {
		const existing = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
		const style = existing ?? document.createElement("style");
		style.id = STYLE_ID;
		style.textContent = GEIST_CSS;
		if (!existing) document.head.appendChild(style);
		return style;
	}

	private createMicButton(): HTMLButtonElement {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "krk-mic-btn";
		btn.title = "Vocals";
		btn.setAttribute("data-test", "karaoke-sing-toggle");
		btn.setAttribute("data-active", "false");
		btn.innerHTML = `
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
				<path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
				<line x1="12" x2="12" y1="19" y2="22"/>
			</svg>
			<span class="krk-mic-dot" aria-hidden="true"></span>
		`;
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.togglePopover();
		});
		return btn;
	}

	private createPopover(): HTMLDivElement {
		const pop = document.createElement("div");
		pop.className = "krk-pop";

		// Header row
		const header = document.createElement("div");
		header.className = "krk-head";

		const titleCol = document.createElement("div");
		titleCol.className = "krk-title-wrap";

		const title = document.createElement("span");
		title.className = "krk-title";
		title.textContent = "Vocals";

		const statusRow = document.createElement("span");
		statusRow.className = "krk-status";
		this.statusDot = document.createElement("span");
		this.statusDot.className = "krk-status-dot";
		this.statusText = document.createElement("span");
		this.statusText.textContent = "Connecting";
		statusRow.appendChild(this.statusDot);
		statusRow.appendChild(this.statusText);

		titleCol.appendChild(title);
		titleCol.appendChild(statusRow);

		this.enableToggle = document.createElement("button");
		this.enableToggle.type = "button";
		this.enableToggle.className = "krk-switch";
		this.enableToggle.setAttribute("role", "switch");
		this.enableToggle.setAttribute("aria-label", "Toggle live vocal control");
		this.enableToggle.setAttribute("aria-checked", String(this.currentEnabled));
		const thumb = document.createElement("span");
		thumb.className = "krk-switch-thumb";
		this.enableToggle.appendChild(thumb);
		this.enableToggle.addEventListener("click", () => {
			this.currentEnabled = !this.currentEnabled;
			this.callbacks.onToggleEnabled(this.currentEnabled);
			this.render();
		});

		header.appendChild(titleCol);
		header.appendChild(this.enableToggle);
		pop.appendChild(header);

		// Level slider section
		const levelSec = document.createElement("div");
		levelSec.className = "krk-level-sec";

		const levelRow = document.createElement("div");
		levelRow.className = "krk-level-row";

		const levelLabel = document.createElement("span");
		levelLabel.className = "krk-label";
		levelLabel.textContent = "Level";

		this.sliderValueLabel = document.createElement("span");
		this.sliderValueLabel.className = "krk-val";
		this.sliderValueLabel.textContent = `${this.currentVocalGainPct}%`;

		levelRow.appendChild(levelLabel);
		levelRow.appendChild(this.sliderValueLabel);
		levelSec.appendChild(levelRow);

		this.sliderEl = document.createElement("div");
		this.sliderEl.className = "krk-slider";
		this.sliderEl.tabIndex = 0;
		this.sliderEl.setAttribute("role", "slider");
		this.sliderEl.setAttribute("aria-label", "Vocal level");
		this.sliderEl.setAttribute("aria-valuemin", "0");
		this.sliderEl.setAttribute("aria-valuemax", "100");
		this.sliderEl.setAttribute("aria-valuenow", String(this.currentVocalGainPct));

		const rail = document.createElement("div");
		rail.className = "krk-slider-rail";

		this.sliderFill = document.createElement("div");
		this.sliderFill.className = "krk-slider-fill";

		this.sliderThumb = document.createElement("div");
		this.sliderThumb.className = "krk-slider-thumb";

		rail.appendChild(this.sliderFill);
		rail.appendChild(this.sliderThumb);
		this.sliderEl.appendChild(rail);
		this.attachSliderHandlers();
		levelSec.appendChild(this.sliderEl);

		const chips = document.createElement("div");
		chips.className = "krk-chips";
		for (const pct of [0, 15, 50, 100]) {
			const cBtn = document.createElement("button");
			cBtn.type = "button";
			cBtn.className = "krk-chip";
			cBtn.dataset.pct = String(pct);
			cBtn.textContent = `${pct}%`;
			cBtn.addEventListener("click", () => this.commitVocalGain(pct));
			this.presetButtons.push(cBtn);
			chips.appendChild(cBtn);
		}
		levelSec.appendChild(chips);
		pop.appendChild(levelSec);

		// Footer: segmented mode + optional download/offline row
		const foot = document.createElement("div");
		foot.className = "krk-foot";

		const modeBar = document.createElement("div");
		modeBar.className = "krk-seg";
		const makeModeBtn = (mode: KaraokeMode, label: string): HTMLButtonElement => {
			const b = document.createElement("button");
			b.type = "button";
			b.className = "krk-seg-btn";
			b.textContent = label;
			b.addEventListener("click", () => {
				this.currentMode = mode;
				this.callbacks.onChangeMode(mode);
				this.render();
			});
			modeBar.appendChild(b);
			return b;
		};
		this.modeButtons = {
			karaoke: makeModeBtn("karaoke", "Karaoke"),
			instrumental: makeModeBtn("instrumental", "Inst"),
			dsp: makeModeBtn("dsp", "DSP"),
		};
		foot.appendChild(modeBar);

		this.downloadBox = document.createElement("div");
		this.downloadBox.className = "krk-dl";

		this.downloadBtn = document.createElement("button");
		this.downloadBtn.type = "button";
		this.downloadBtn.className = "krk-dl-btn";
		this.downloadBtn.textContent = "Download model (~65 MB)";
		this.downloadBtn.addEventListener("click", () => {
			const target = this.currentMode === "instrumental" ? "instrumental" : "karaoke";
			this.callbacks.onDownloadModel(target);
		});

		this.downloadTrack = document.createElement("div");
		this.downloadTrack.className = "krk-dl-track";
		this.downloadBar = document.createElement("div");
		this.downloadBar.className = "krk-dl-bar";
		this.downloadTrack.appendChild(this.downloadBar);

		this.downloadBox.appendChild(this.downloadBtn);
		this.downloadBox.appendChild(this.downloadTrack);
		foot.appendChild(this.downloadBox);

		this.offlineBanner = document.createElement("div");
		this.offlineBanner.className = "krk-offline";
		const offlineText = document.createElement("span");
		offlineText.textContent = `Engine offline · :${this.callbacks.getInitialState().port}`;
		const actionsWrap = document.createElement("div");
		actionsWrap.style.display = "flex";
		actionsWrap.style.alignItems = "center";
		actionsWrap.style.gap = "4px";

		const getBtn = document.createElement("a");
		getBtn.className = "krk-retry-btn";
		getBtn.style.textDecoration = "none";
		getBtn.style.display = "inline-flex";
		getBtn.style.alignItems = "center";
		getBtn.style.background = "#262626";
		getBtn.style.color = "#ededed";
		getBtn.href = "https://github.com/itzzexcel/karaoke-engine/releases/latest";
		getBtn.target = "_blank";
		getBtn.rel = "noopener noreferrer";
		getBtn.textContent = "Get .exe";

		const retryBtn = document.createElement("button");
		retryBtn.type = "button";
		retryBtn.className = "krk-retry-btn";
		retryBtn.textContent = "Retry";
		retryBtn.addEventListener("click", () => this.callbacks.onReconnect());

		actionsWrap.appendChild(getBtn);
		actionsWrap.appendChild(retryBtn);
		this.offlineBanner.appendChild(offlineText);
		this.offlineBanner.appendChild(actionsWrap);
		foot.appendChild(this.offlineBanner);

		pop.appendChild(foot);
		return pop;
	}

	private commitVocalGain(pct: number): void {
		const clamped = Math.max(0, Math.min(100, Math.round(pct)));
		this.currentVocalGainPct = clamped;
		this.callbacks.onChangeVocalGainPct(clamped);
		this.render();
	}

	private attachSliderHandlers(): void {
		const updateFromClientX = (clientX: number) => {
			const rect = this.sliderEl.getBoundingClientRect();
			if (rect.width <= 0) return;
			const ratio = (clientX - rect.left) / rect.width;
			this.commitVocalGain(ratio * 100);
		};

		this.sliderEl.addEventListener("pointerdown", (e) => {
			this.isDraggingSlider = true;
			this.sliderEl.setAttribute("data-dragging", "true");
			try { this.sliderEl.setPointerCapture(e.pointerId); } catch { }
			updateFromClientX(e.clientX);
		});
		this.sliderEl.addEventListener("pointermove", (e) => {
			if (this.isDraggingSlider) updateFromClientX(e.clientX);
		});
		const endDrag = (e: PointerEvent) => {
			if (!this.isDraggingSlider) return;
			this.isDraggingSlider = false;
			this.sliderEl.removeAttribute("data-dragging");
			try { this.sliderEl.releasePointerCapture(e.pointerId); } catch { }
		};
		this.sliderEl.addEventListener("pointerup", endDrag);
		this.sliderEl.addEventListener("pointercancel", endDrag);

		this.sliderEl.addEventListener("wheel", (e) => {
			e.preventDefault();
			const mag = e.shiftKey ? 2 : 5;
			const dir = e.deltaY < 0 || e.deltaX > 0 ? 1 : -1;
			this.commitVocalGain(this.currentVocalGainPct + dir * mag);
		}, { passive: false });

		this.sliderEl.addEventListener("keydown", (e) => {
			const step = e.shiftKey ? 10 : 5;
			if (e.key === "ArrowRight" || e.key === "ArrowUp") {
				e.preventDefault();
				this.commitVocalGain(this.currentVocalGainPct + step);
			} else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
				e.preventDefault();
				this.commitVocalGain(this.currentVocalGainPct - step);
			} else if (e.key === "Home") {
				e.preventDefault();
				this.commitVocalGain(0);
			} else if (e.key === "End") {
				e.preventDefault();
				this.commitVocalGain(100);
			}
		});
	}

	private ensureMounted(): void {
		if (this.destroyed) return;
		if (this.micButton.isConnected) return;

		const footer = document.querySelector<HTMLElement>('[data-test="footer-player"]');
		if (!footer) return;

		const nowPlayingBtn = footer.querySelector<HTMLElement>('[data-test="mp-toggle-now-playing"]');
		if (nowPlayingBtn?.parentElement) {
			nowPlayingBtn.parentElement.insertBefore(this.micButton, nowPlayingBtn);
			return;
		}

		const queueBtn = footer.querySelector<HTMLElement>('[data-test="play-queue-button"]');
		if (queueBtn?.parentElement) {
			queueBtn.parentElement.insertBefore(this.micButton, queueBtn);
			return;
		}

		footer.appendChild(this.micButton);
	}

	private togglePopover(): void {
		this.isOpen = !this.isOpen;
		if (this.isOpen) {
			const rect = this.micButton.getBoundingClientRect();
			if (rect.width > 0) {
				const right = Math.max(12, window.innerWidth - rect.right - 12);
				const bottom = Math.max(76, window.innerHeight - rect.top + 10);
				this.popover.style.right = `${right}px`;
				this.popover.style.bottom = `${bottom}px`;
			}
			this.popover.style.display = "flex";
		} else {
			this.popover.style.display = "none";
		}
	}

	private handleOutsidePointerDown = (e: PointerEvent): void => {
		if (!this.isOpen) return;
		const target = e.target as Node | null;
		if (!target) return;
		if (this.popover.contains(target) || this.micButton.contains(target)) return;
		this.isOpen = false;
		this.popover.style.display = "none";
	};

	private handleKeyDown = (e: KeyboardEvent): void => {
		if (this.isOpen && e.key === "Escape") {
			this.isOpen = false;
			this.popover.style.display = "none";
		}
	};

	public syncExternalConfig(enabled: boolean, vocalGainPct: number, mode: KaraokeMode): void {
		this.currentEnabled = enabled;
		this.currentVocalGainPct = vocalGainPct;
		this.currentMode = mode;
		this.render();
	}

	public updateStatus(status: EngineStatus | null, connected: boolean): void {
		this.latestStatus = status;
		this.latestConnected = connected;
		this.render();
	}

	private render(): void {
		this.micButton.setAttribute("data-active", String(this.currentEnabled));
		this.enableToggle.setAttribute("aria-checked", String(this.currentEnabled));

		const pct = this.currentVocalGainPct;
		this.sliderFill.style.width = `${pct}%`;
		this.sliderFill.style.background = this.currentEnabled ? "#ededed" : "#525252";
		this.sliderThumb.style.left = `${pct}%`;
		this.sliderThumb.style.background = this.currentEnabled ? "#ededed" : "#888888";
		this.sliderEl.setAttribute("aria-valuenow", String(pct));
		this.sliderValueLabel.textContent = `${pct}%`;

		for (const pBtn of this.presetButtons) {
			const active = Number(pBtn.dataset.pct) === pct;
			pBtn.setAttribute("data-active", String(active));
		}

		(["karaoke", "instrumental", "dsp"] as KaraokeMode[]).forEach((m) => {
			this.modeButtons[m].setAttribute("data-active", String(this.currentMode === m));
		});

		if (!this.latestConnected) {
			this.statusDot.style.background = "#ef4444";
			this.statusText.textContent = "Offline";
			this.offlineBanner.style.display = "flex";
			this.downloadBox.style.display = "none";
			return;
		}

		this.offlineBanner.style.display = "none";
		const st = this.latestStatus;
		if (!st) {
			this.statusDot.style.background = "#525252";
			this.statusText.textContent = "Connected";
			return;
		}

		if (st.error) {
			this.statusDot.style.background = "#ef4444";
			this.statusText.textContent = st.error.slice(0, 28);
		} else if (!st.enabled) {
			this.statusDot.style.background = "#525252";
			this.statusText.textContent = "Ready";
		} else if (st.state === "loading") {
			this.statusDot.style.background = "#eab308";
			this.statusText.textContent = st.separatedPct > 0 ? `Preparing · ${st.separatedPct}%` : "Preparing...";
		} else if (st.state === "ai_active") {
			this.statusDot.style.background = "#22c55e";
			const label = st.fromCache ? "Cached" : st.provider;
			this.statusText.textContent = `${label} · ${st.separatedPct}%`;
		} else if (this.currentMode === "dsp") {
			this.statusDot.style.background = "#ededed";
			this.statusText.textContent = "DSP";
		} else {
			this.statusDot.style.background = "#eab308";
			this.statusText.textContent = `DSP · ${st.separatedPct}%`;
		}

		const needsModel =
			(this.currentMode === "karaoke" && !st.modelInstalled.karaoke) ||
			(this.currentMode === "instrumental" && !st.modelInstalled.instrumental);

		if (needsModel) {
			this.downloadBox.style.display = "flex";
			if (st.downloadProgress >= 0) {
				const dlPct = Math.round(st.downloadProgress * 100);
				this.downloadTrack.style.display = "block";
				this.downloadBar.style.width = `${dlPct}%`;
				this.downloadBtn.textContent = `Downloading · ${dlPct}%`;
				this.downloadBtn.disabled = true;
			} else {
				this.downloadTrack.style.display = "none";
				this.downloadBtn.textContent = "Download model (~65 MB)";
				this.downloadBtn.disabled = false;
			}
		} else {
			this.downloadBox.style.display = "none";
		}
	}

	public destroy(): void {
		this.destroyed = true;
		if (this.mountCheckTimer !== null) {
			clearTimeout(this.mountCheckTimer);
			this.mountCheckTimer = null;
		}
		this.domObserver?.disconnect();
		this.domObserver = null;
		document.removeEventListener("pointerdown", this.handleOutsidePointerDown, true);
		document.removeEventListener("keydown", this.handleKeyDown, true);
		this.micButton.remove();
		this.popover.remove();
		this.styleEl.remove();
	}
}
