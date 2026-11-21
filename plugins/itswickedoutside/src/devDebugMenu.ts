import type { AudioVisualiserAPI, VisualiserDebugState } from "./giragira";

export interface DevDebugMenuCallbacks {
	getVisualiser: () => AudioVisualiserAPI | null;
	onClose: () => void;
	onSetEnhancedBackground: (v: boolean) => void;
	onSetAppleFluidBackground: (v: boolean) => void;
	onSetBackgroundMode: (m: 'circles' | 'images') => void;
	onSetApolMode: (v: boolean) => void;
	onSetDynamicLerp: (v: boolean) => void;
	onSetDynamicIntensity: (v: boolean) => void;
	onSetIntensity: (v: number) => void;
	onSetSaturation: (v: number) => void;
	onSetDensity: (v: number) => void;
	onSetOpacity: (v: number) => void;
	onSetFluidSpeed: (v: number) => void;
}

interface MeterRef {
	bar: HTMLDivElement;
	val: HTMLSpanElement;
}

interface SliderRef {
	input: HTMLInputElement;
	val: HTMLSpanElement;
	scale: number;
}

/**
 * Floating draggable developer HUD overlay for inspecting live Reactivo WebGL/audio telemetry
 * and tuning parameters interactively without modifying production plugin behavior when off.
 */
export class DevDebugMenu {
	private root: HTMLDivElement;
	private header: HTMLDivElement;
	private body: HTMLDivElement;
	private collapseBtn: HTMLButtonElement;
	private closeBtn: HTMLButtonElement;

	private headerSummary: HTMLSpanElement;
	private wsDot: HTMLSpanElement;

	private statusRenderer!: HTMLSpanElement;
	private statusWs!: HTMLSpanElement;
	private statusNp!: HTMLSpanElement;
	private statusBpm!: HTMLSpanElement;

	private meters!: {
		bass: MeterRef;
		energy: MeterRef;
		treble: MeterRef;
		flow: MeterRef;
	};

	private texStatus!: HTMLSpanElement;
	private vignetteSwatch!: HTMLSpanElement;
	private paletteSwatches: HTMLSpanElement[] = [];

	private toggles!: {
		enhanced: HTMLButtonElement;
		fluid: HTMLButtonElement;
		mode: HTMLButtonElement;
		apol: HTMLButtonElement;
		dynLerp: HTMLButtonElement;
		dynInt: HTMLButtonElement;
	};

	private sliders!: {
		intensity: SliderRef;
		saturation: SliderRef;
		density: SliderRef;
		opacity: SliderRef;
		fluidSpeed: SliderRef;
	};

	private callbacks: DevDebugMenuCallbacks;
	private intervalId: number | null = null;
	private collapsed = false;
	private isDragging = false;
	private dragOffsetX = 0;
	private dragOffsetY = 0;
	private posX = 20;
	private posY = 20;
	private lastState: VisualiserDebugState | null = null;
	private readonly panelWidth = 296;

	constructor(callbacks: DevDebugMenuCallbacks) {
		this.callbacks = callbacks;

		this.root = document.createElement('div');
		this.root.style.cssText = `
			position: fixed;
			left: ${this.posX}px;
			top: ${this.posY}px;
			width: ${this.panelWidth}px;
			z-index: 999999;
			background: rgba(13, 15, 20, 0.88);
			backdrop-filter: blur(14px);
			border: 1px solid rgba(255, 255, 255, 0.14);
			border-radius: 12px;
			color: #eef1f7;
			font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
			font-size: 11px;
			line-height: 1.35;
			box-shadow: 0 12px 32px rgba(0, 0, 0, 0.58);
			user-select: none;
			pointer-events: auto;
			overflow: hidden;
		`;

		// Header
		this.header = document.createElement('div');
		this.header.style.cssText = `
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 8px;
			padding: 8px 10px;
			background: rgba(255, 255, 255, 0.05);
			border-bottom: 1px solid rgba(255, 255, 255, 0.08);
			cursor: grab;
			touch-action: none;
		`;

		const titleGroup = document.createElement('div');
		titleGroup.style.cssText = 'display: flex; align-items: center; gap: 6px; min-width: 0;';

		this.wsDot = document.createElement('span');
		this.wsDot.style.cssText = 'width: 7px; height: 7px; border-radius: 50%; background: #ef4444; flex-shrink: 0;';

		const title = document.createElement('span');
		title.textContent = 'REACTIVO DEV';
		title.style.cssText = 'font-weight: 700; letter-spacing: 0.6px; font-size: 10px; color: #fff;';

		this.headerSummary = document.createElement('span');
		this.headerSummary.textContent = '-- fps';
		this.headerSummary.style.cssText = 'color: rgba(255, 255, 255, 0.58); font-size: 10px;';

		titleGroup.appendChild(this.wsDot);
		titleGroup.appendChild(title);
		titleGroup.appendChild(this.headerSummary);

		const headerActions = document.createElement('div');
		headerActions.style.cssText = 'display: flex; align-items: center; gap: 4px;';

		this.collapseBtn = this.makeHeaderBtn('−', 'Collapse');
		this.closeBtn = this.makeHeaderBtn('×', 'Close Dev Menu');

		this.collapseBtn.addEventListener('click', () => {
			this.collapsed = !this.collapsed;
			this.body.style.display = this.collapsed ? 'none' : 'flex';
			this.collapseBtn.textContent = this.collapsed ? '+' : '−';
		});

		this.closeBtn.addEventListener('click', () => {
			this.callbacks.onClose();
		});

		headerActions.appendChild(this.collapseBtn);
		headerActions.appendChild(this.closeBtn);

		this.header.appendChild(titleGroup);
		this.header.appendChild(headerActions);

		// Body container
		this.body = document.createElement('div');
		this.body.style.cssText = 'display: flex; flex-direction: column; gap: 9px; padding: 9px 10px 10px;';

		this.buildStatusSection();
		this.buildMetersSection();
		this.buildPaletteSection();
		this.buildControlsSection();

		this.root.appendChild(this.header);
		this.root.appendChild(this.body);
		document.body.appendChild(this.root);

		this.attachDragListeners();
		window.addEventListener('resize', this.handleWindowResize);
		this.clampPosition();

		this.refresh();
		this.intervalId = window.setInterval(() => {
			if (!document.hidden) {
				this.refresh();
			}
		}, 100);
	}

	private makeHeaderBtn(label: string, title: string): HTMLButtonElement {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.textContent = label;
		btn.title = title;
		btn.style.cssText = `
			width: 20px;
			height: 20px;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			background: rgba(255, 255, 255, 0.08);
			color: #fff;
			border: 1px solid rgba(255, 255, 255, 0.12);
			border-radius: 5px;
			cursor: pointer;
			font-size: 12px;
			line-height: 1;
			padding: 0;
		`;
		return btn;
	}

	private makeSectionLabel(text: string): HTMLDivElement {
		const el = document.createElement('div');
		el.textContent = text;
		el.style.cssText = 'font-size: 9px; text-transform: uppercase; letter-spacing: 0.8px; color: rgba(255,255,255,0.45); margin-bottom: 3px;';
		return el;
	}

	private buildStatusSection(): void {
		const wrap = document.createElement('div');
		wrap.appendChild(this.makeSectionLabel('Telemetry'));

		const grid = document.createElement('div');
		grid.style.cssText = `
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 4px 8px;
			background: rgba(255,255,255,0.03);
			border: 1px solid rgba(255,255,255,0.06);
			border-radius: 7px;
			padding: 6px 8px;
			font-size: 10px;
		`;

		const makeCell = (label: string): HTMLSpanElement => {
			const cell = document.createElement('div');
			cell.style.cssText = 'display: flex; justify-content: space-between; gap: 4px; overflow: hidden;';
			const k = document.createElement('span');
			k.textContent = label;
			k.style.color = 'rgba(255,255,255,0.5)';
			const v = document.createElement('span');
			v.textContent = '--';
			v.style.cssText = 'color: #eef1f7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
			cell.appendChild(k);
			cell.appendChild(v);
			grid.appendChild(cell);
			return v;
		};

		this.statusRenderer = makeCell('Render');
		this.statusWs = makeCell('WS');
		this.statusNp = makeCell('View');
		this.statusBpm = makeCell('Tempo');

		wrap.appendChild(grid);
		this.body.appendChild(wrap);
	}

	private buildMetersSection(): void {
		const wrap = document.createElement('div');
		wrap.appendChild(this.makeSectionLabel('Audio Physics'));

		const box = document.createElement('div');
		box.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';

		const makeMeter = (label: string, color: string): MeterRef => {
			const row = document.createElement('div');
			row.style.cssText = 'display: grid; grid-template-columns: 44px 1fr 34px; align-items: center; gap: 6px; font-size: 10px;';

			const name = document.createElement('span');
			name.textContent = label;
			name.style.color = 'rgba(255,255,255,0.68)';

			const track = document.createElement('div');
			track.style.cssText = 'height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden;';

			const bar = document.createElement('div');
			bar.style.cssText = `height: 100%; width: 0%; background: ${color}; border-radius: 3px; transition: width 60ms linear;`;
			track.appendChild(bar);

			const val = document.createElement('span');
			val.textContent = '0.00';
			val.style.cssText = 'text-align: right; color: rgba(255,255,255,0.75);';

			row.appendChild(name);
			row.appendChild(track);
			row.appendChild(val);
			box.appendChild(row);
			return { bar, val };
		};

		this.meters = {
			bass: makeMeter('Bass', '#38bdf8'),
			energy: makeMeter('Energy', '#a78bfa'),
			treble: makeMeter('Treble', '#f472b6'),
			flow: makeMeter('Flow', '#34d399'),
		};

		wrap.appendChild(box);
		this.body.appendChild(wrap);
	}

	private buildPaletteSection(): void {
		const wrap = document.createElement('div');
		const row = document.createElement('div');
		row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 6px;';

		const swatchesGroup = document.createElement('div');
		swatchesGroup.style.cssText = 'display: flex; align-items: center; gap: 4px;';

		this.vignetteSwatch = document.createElement('span');
		this.vignetteSwatch.title = 'Vignette RGB';
		this.vignetteSwatch.style.cssText = 'width: 14px; height: 14px; border-radius: 3px; border: 1px solid rgba(255,255,255,0.4); background: rgb(255,255,255);';
		swatchesGroup.appendChild(this.vignetteSwatch);

		for (let i = 0; i < 6; i++) {
			const dot = document.createElement('span');
			dot.style.cssText = 'width: 11px; height: 11px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.08);';
			this.paletteSwatches.push(dot);
			swatchesGroup.appendChild(dot);
		}

		this.texStatus = document.createElement('span');
		this.texStatus.textContent = 'Tex: --';
		this.texStatus.style.cssText = 'font-size: 10px; color: rgba(255,255,255,0.55);';

		row.appendChild(swatchesGroup);
		row.appendChild(this.texStatus);
		wrap.appendChild(this.makeSectionLabel('Artwork & Palette'));
		wrap.appendChild(row);
		this.body.appendChild(wrap);
	}

	private buildControlsSection(): void {
		const wrap = document.createElement('div');
		wrap.appendChild(this.makeSectionLabel('Live Tuning & Actions'));

		// Quick toggle pills
		const pills = document.createElement('div');
		pills.style.cssText = 'display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 7px;';

		const makeToggle = (label: string, onClick: () => void): HTMLButtonElement => {
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.textContent = label;
			btn.style.cssText = `
				padding: 3px 7px;
				font-size: 10px;
				font-family: inherit;
				border-radius: 5px;
				border: 1px solid rgba(255,255,255,0.14);
				background: rgba(255,255,255,0.06);
				color: rgba(255,255,255,0.75);
				cursor: pointer;
			`;
			btn.addEventListener('click', () => {
				onClick();
				this.refresh();
			});
			pills.appendChild(btn);
			return btn;
		};

		this.toggles = {
			enhanced: makeToggle('Enhanced', () => {
				const cur = this.lastState?.visuals.enhancedBackground ?? false;
				this.callbacks.onSetEnhancedBackground(!cur);
			}),
			fluid: makeToggle('Fluid', () => {
				const cur = this.lastState?.visuals.appleFluidBackground ?? false;
				this.callbacks.onSetAppleFluidBackground(!cur);
			}),
			mode: makeToggle('Mode: Mesh', () => {
				const cur = this.lastState?.visuals.backgroundMode ?? 'circles';
				this.callbacks.onSetBackgroundMode(cur === 'images' ? 'circles' : 'images');
			}),
			apol: makeToggle('Apol', () => {
				const cur = this.lastState?.visuals.apolMode ?? false;
				this.callbacks.onSetApolMode(!cur);
			}),
			dynLerp: makeToggle('DynLerp', () => {
				const cur = this.lastState?.visuals.useDynamicLerp ?? true;
				this.callbacks.onSetDynamicLerp(!cur);
			}),
			dynInt: makeToggle('DynInt', () => {
				const cur = this.lastState?.visuals.useDynamicIntensity ?? false;
				this.callbacks.onSetDynamicIntensity(!cur);
			}),
		};

		wrap.appendChild(pills);

		// Compact range sliders
		const slidersBox = document.createElement('div');
		slidersBox.style.cssText = 'display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px;';

		const makeSlider = (
			label: string,
			min: number,
			max: number,
			scale: number,
			onInputVal: (realVal: number) => void
		): SliderRef => {
			const row = document.createElement('div');
			row.style.cssText = 'display: grid; grid-template-columns: 62px 1fr 28px; align-items: center; gap: 6px; font-size: 10px;';

			const name = document.createElement('span');
			name.textContent = label;
			name.style.color = 'rgba(255,255,255,0.68)';

			const input = document.createElement('input');
			input.type = 'range';
			input.min = String(min);
			input.max = String(max);
			input.step = '1';
			input.style.cssText = 'width: 100%; height: 14px; accent-color: #38bdf8; cursor: pointer; margin: 0;';

			const val = document.createElement('span');
			val.textContent = '1.0';
			val.style.cssText = 'text-align: right; color: rgba(255,255,255,0.85);';

			input.addEventListener('input', () => {
				const realVal = Number(input.value) / scale;
				val.textContent = realVal.toFixed(1);
				onInputVal(realVal);
			});

			row.appendChild(name);
			row.appendChild(input);
			row.appendChild(val);
			slidersBox.appendChild(row);
			return { input, val, scale };
		};

		this.sliders = {
			intensity: makeSlider('Intensity', 0, 50, 10, this.callbacks.onSetIntensity),
			saturation: makeSlider('Saturate', 0, 30, 10, this.callbacks.onSetSaturation),
			density: makeSlider('Density', 0, 10, 10, this.callbacks.onSetDensity),
			opacity: makeSlider('Opacity', 0, 10, 10, this.callbacks.onSetOpacity),
			fluidSpeed: makeSlider('Speed', 0, 30, 10, this.callbacks.onSetFluidSpeed),
		};

		wrap.appendChild(slidersBox);

		// Action buttons
		const actions = document.createElement('div');
		actions.style.cssText = 'display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px;';

		const makeAction = (label: string, title: string, onClick: () => void): void => {
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.textContent = label;
			btn.title = title;
			btn.style.cssText = `
				padding: 4px 0;
				font-size: 10px;
				font-family: inherit;
				border-radius: 5px;
				border: 1px solid rgba(255,255,255,0.14);
				background: rgba(255,255,255,0.08);
				color: #eef1f7;
				cursor: pointer;
			`;
			btn.addEventListener('click', onClick);
			actions.appendChild(btn);
		};

		makeAction('Kick', 'Trigger synthetic bass/energy/treble pulse', () => {
			this.callbacks.getVisualiser()?.triggerDebugPulse?.();
		});
		makeAction('Cover', 'Force cover art reload & cache flush', () => {
			this.callbacks.getVisualiser()?.forceCoverArtRefresh?.();
		});
		makeAction('WS', 'Reconnect audio WebSocket', () => {
			this.callbacks.getVisualiser()?.reconnect();
		});
		makeAction('Reset', 'Reset spring & bass trackers', () => {
			this.callbacks.getVisualiser()?.resetPhysics?.();
		});
		makeAction('Log', 'Dump full state to DevTools console', () => {
			console.log('[reactivo dev state]', this.callbacks.getVisualiser()?.getDebugState?.() ?? null);
		});

		wrap.appendChild(actions);
		this.body.appendChild(wrap);
	}

	private setToggleStyle(btn: HTMLButtonElement, active: boolean): void {
		btn.style.background = active ? 'rgba(56, 189, 248, 0.24)' : 'rgba(255, 255, 255, 0.06)';
		btn.style.borderColor = active ? 'rgba(56, 189, 248, 0.7)' : 'rgba(255, 255, 255, 0.14)';
		btn.style.color = active ? '#e0f2fe' : 'rgba(255, 255, 255, 0.65)';
	}

	private updateSliderIfUnfocused(ref: SliderRef, realValue: number): void {
		if (document.activeElement === ref.input) return;
		const scaled = Math.round(realValue * ref.scale);
		ref.input.value = String(scaled);
		ref.val.textContent = (scaled / ref.scale).toFixed(1);
	}

	private refresh(): void {
		const vis = this.callbacks.getVisualiser();
		const state = vis?.getDebugState?.() ?? null;
		this.lastState = state;

		if (!state) {
			this.wsDot.style.background = '#9ca3af';
			this.headerSummary.textContent = 'idle';
			this.statusRenderer.textContent = 'None';
			this.statusWs.textContent = 'No Vis';
			this.statusNp.textContent = 'Hidden';
			this.statusBpm.textContent = '--';
			return;
		}

		this.wsDot.style.background = state.wsConnected ? '#22c55e' : '#ef4444';
		this.headerSummary.textContent = `${state.fps} fps · ${state.renderer.type.toUpperCase()}`;

		this.statusRenderer.textContent = `${state.renderer.type === 'webgl' ? 'GL' : 'CSS'} ${state.renderer.width}x${state.renderer.height}`;
		const ageText = state.lastPacketAgeMs >= 0 ? `${state.lastPacketAgeMs}ms` : '--';
		this.statusWs.textContent = state.wsConnected ? `Open (${ageText})` : 'Closed';
		this.statusNp.textContent = `${state.isNowPlayingVisible ? 'NP' : 'Bg'} · ${state.animationRunning ? 'Run' : 'Stop'}`;
		this.statusBpm.textContent = `${Math.round(state.audio.bpm)} bpm${state.audio.isSustainedBass ? ' *' : ''}`;

		this.setMeter(this.meters.bass, state.audio.bass, 1.1);
		this.setMeter(this.meters.energy, state.audio.energy, 1.0);
		this.setMeter(this.meters.treble, state.audio.treble, 1.0);
		this.setMeter(this.meters.flow, state.audio.flowVelocity, 2.5);

		this.vignetteSwatch.style.background = `rgb(${state.visuals.vignetteRgb})`;
		for (let i = 0; i < this.paletteSwatches.length; i++) {
			const c = state.visuals.palette[i];
			this.paletteSwatches[i].style.background = c ? c : 'rgba(255,255,255,0.06)';
			this.paletteSwatches[i].title = c ?? '';
		}
		this.texStatus.textContent = `Tex:${state.renderer.hasArtwork ? 'OK' : 'No'} C:${state.visuals.cacheEntries}`;

		this.setToggleStyle(this.toggles.enhanced, state.visuals.enhancedBackground);
		this.setToggleStyle(this.toggles.fluid, state.visuals.appleFluidBackground);
		this.toggles.mode.textContent = state.visuals.backgroundMode === 'images' ? 'Mode: Art' : 'Mode: Mesh';
		this.setToggleStyle(this.toggles.mode, state.visuals.backgroundMode === 'images');
		this.setToggleStyle(this.toggles.apol, state.visuals.apolMode);
		this.setToggleStyle(this.toggles.dynLerp, state.visuals.useDynamicLerp);
		this.setToggleStyle(this.toggles.dynInt, state.visuals.useDynamicIntensity);

		this.updateSliderIfUnfocused(this.sliders.intensity, state.visuals.intensityMultiplier);
		this.updateSliderIfUnfocused(this.sliders.saturation, state.visuals.colorSaturation);
		this.updateSliderIfUnfocused(this.sliders.density, state.visuals.circleDensity);
		this.updateSliderIfUnfocused(this.sliders.opacity, state.visuals.circleOpacity);
		this.updateSliderIfUnfocused(this.sliders.fluidSpeed, state.visuals.fluidSpeed);
	}

	private setMeter(ref: MeterRef, value: number, maxVal: number): void {
		const pct = Math.max(0, Math.min(100, (value / maxVal) * 100));
		ref.bar.style.width = `${pct.toFixed(1)}%`;
		ref.val.textContent = value.toFixed(2);
	}

	private attachDragListeners(): void {
		this.header.addEventListener('pointerdown', this.handlePointerDown);
		this.header.addEventListener('pointermove', this.handlePointerMove);
		this.header.addEventListener('pointerup', this.handlePointerUp);
		this.header.addEventListener('pointercancel', this.handlePointerUp);
	}

	private handlePointerDown = (e: PointerEvent): void => {
		const target = e.target as HTMLElement | null;
		if (target?.closest('button, input')) return;
		this.isDragging = true;
		this.dragOffsetX = e.clientX - this.posX;
		this.dragOffsetY = e.clientY - this.posY;
		this.header.style.cursor = 'grabbing';
		try {
			this.header.setPointerCapture(e.pointerId);
		} catch { }
	};

	private handlePointerMove = (e: PointerEvent): void => {
		if (!this.isDragging) return;
		this.posX = e.clientX - this.dragOffsetX;
		this.posY = e.clientY - this.dragOffsetY;
		this.clampPosition();
	};

	private handlePointerUp = (e: PointerEvent): void => {
		if (!this.isDragging) return;
		this.isDragging = false;
		this.header.style.cursor = 'grab';
		try {
			this.header.releasePointerCapture(e.pointerId);
		} catch { }
	};

	private handleWindowResize = (): void => {
		this.clampPosition();
	};

	private clampPosition(): void {
		const maxX = Math.max(8, window.innerWidth - this.panelWidth - 8);
		const maxY = Math.max(8, window.innerHeight - 40);
		this.posX = Math.max(8, Math.min(maxX, this.posX));
		this.posY = Math.max(8, Math.min(maxY, this.posY));
		this.root.style.left = `${this.posX}px`;
		this.root.style.top = `${this.posY}px`;
	}

	public destroy(): void {
		if (this.intervalId !== null) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
		window.removeEventListener('resize', this.handleWindowResize);
		this.header.removeEventListener('pointerdown', this.handlePointerDown);
		this.header.removeEventListener('pointermove', this.handlePointerMove);
		this.header.removeEventListener('pointerup', this.handlePointerUp);
		this.header.removeEventListener('pointercancel', this.handlePointerUp);
		if (this.root.parentNode) {
			this.root.parentNode.removeChild(this.root);
		}
	}
}
