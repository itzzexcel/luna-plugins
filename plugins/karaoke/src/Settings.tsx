import React from "react";
import { LunaButtonSetting, LunaNumberSetting, LunaSettings, LunaSwitchSetting } from "@luna/ui";
import { ReactiveStore } from "@luna/core";
import {
	setKaraokeEnabled,
	setVocalGainPct,
	setKaraokeMode,
	setUseGpu,
	setAutoPreload,
	setSyncOffsetMs,
	setWsPort,
	setUseLossless,
	setCacheMaxMb,
	clearStemCache,
	type KaraokeMode,
} from ".";

type BaseSwitchProps = React.ComponentProps<typeof LunaSwitchSetting>;
type AnySwitchProps = Omit<BaseSwitchProps, "onChange"> & {
	onChange: (_: unknown, checked: boolean) => void;
	checked: boolean;
};

const AnySwitch = LunaSwitchSetting as unknown as React.ComponentType<AnySwitchProps>;

export const DataStoreService = await ReactiveStore.getPluginStorage("karaoke", {
	enabled: false,
	vocalGain: 15,
	mode: "karaoke" as KaraokeMode,
	useGpu: true,
	autoPreload: true,
	useLossless: false,
	syncOffsetMs: 0,
	cacheMaxMb: 2048,
	wsPort: 5445,
});

export const Settings = () => {
	const [enabled, setEnabledState] = React.useState<boolean>(DataStoreService.enabled ?? false);
	const [vocalGain, setVocalGainState] = React.useState<number>(DataStoreService.vocalGain ?? 15);
	const [mode, setModeState] = React.useState<KaraokeMode>((DataStoreService.mode as KaraokeMode) || "karaoke");
	const [useGpu, setUseGpuState] = React.useState<boolean>(DataStoreService.useGpu ?? true);
	const [autoPreload, setAutoPreloadState] = React.useState<boolean>(DataStoreService.autoPreload ?? true);
	const [useLossless, setUseLosslessState] = React.useState<boolean>(DataStoreService.useLossless ?? false);
	const [syncOffsetMs, setSyncOffsetState] = React.useState<number>(DataStoreService.syncOffsetMs ?? 0);
	const [cacheMaxMb, setCacheMaxMbState] = React.useState<number>(DataStoreService.cacheMaxMb ?? 2048);
	const [wsPort, setWsPortState] = React.useState<number>(DataStoreService.wsPort ?? 5445);

	const onEnabledChange = React.useCallback((_: unknown, checked?: boolean) => {
		const val = !!checked;
		DataStoreService.enabled = val;
		setEnabledState(val);
		setKaraokeEnabled(val);
	}, []);

	const onVocalGainChange = React.useCallback((val?: any) => {
		const num = Number.isFinite(Number(val)) ? Number(val) : 15;
		const clamped = Math.max(0, Math.min(100, Math.round(num)));
		DataStoreService.vocalGain = clamped;
		setVocalGainState(clamped);
		setVocalGainPct(clamped);
	}, []);

	const onFullInstrumentalChange = React.useCallback((_: unknown, checked?: boolean) => {
		const nextMode: KaraokeMode = checked ? "instrumental" : "karaoke";
		DataStoreService.mode = nextMode;
		setModeState(nextMode);
		setKaraokeMode(nextMode);
	}, []);

	const onDspOnlyChange = React.useCallback((_: unknown, checked?: boolean) => {
		const nextMode: KaraokeMode = checked ? "dsp" : "karaoke";
		DataStoreService.mode = nextMode;
		setModeState(nextMode);
		setKaraokeMode(nextMode);
	}, []);

	const onUseGpuChange = React.useCallback((_: unknown, checked?: boolean) => {
		const val = !!checked;
		DataStoreService.useGpu = val;
		setUseGpuState(val);
		setUseGpu(val);
	}, []);

	const onAutoPreloadChange = React.useCallback((_: unknown, checked?: boolean) => {
		const val = !!checked;
		DataStoreService.autoPreload = val;
		setAutoPreloadState(val);
		setAutoPreload(val);
	}, []);

	const onUseLosslessChange = React.useCallback((_: unknown, checked?: boolean) => {
		const val = !!checked;
		DataStoreService.useLossless = val;
		setUseLosslessState(val);
		setUseLossless(val);
	}, []);

	const onSyncOffsetChange = React.useCallback((val?: any) => {
		const num = Number.isFinite(Number(val)) ? Number(val) : 0;
		const clamped = Math.max(-200, Math.min(200, Math.round(num)));
		DataStoreService.syncOffsetMs = clamped;
		setSyncOffsetState(clamped);
		setSyncOffsetMs(clamped);
	}, []);

	const onWsPortChange = React.useCallback((val?: any) => {
		const num = Number.isFinite(Number(val)) ? Number(val) : 5445;
		const clamped = Math.max(1024, Math.min(65535, Math.round(num)));
		DataStoreService.wsPort = clamped;
		setWsPortState(clamped);
		setWsPort(clamped);
	}, []);

	const onCacheMaxMbChange = React.useCallback((val?: any) => {
		const num = Number.isFinite(Number(val)) ? Number(val) : 2048;
		const clamped = Math.max(256, Math.min(16384, Math.round(num)));
		DataStoreService.cacheMaxMb = clamped;
		setCacheMaxMbState(clamped);
		setCacheMaxMb(clamped);
	}, []);

	const onClearCache = React.useCallback(() => {
		clearStemCache();
	}, []);

	return (
		<LunaSettings>
			<AnySwitch
				title="Enable Karaoke Mode"
				desc="Intercepts TIDALPlayer cleanly in Windows via karaoke-engine (ws://127.0.0.1:5445) for live vocal volume adjustment."
				checked={enabled}
				onChange={onEnabledChange}
			/>
			<LunaNumberSetting
				title="Vocal Volume (%)"
				value={vocalGain}
				min={0}
				max={100}
				step={1}
				desc="Live vocal stem volume: 0 = full karaoke mute, 15 = subtle guide vocal (Apple Sing style), 100 = original mix."
				onNumber={onVocalGainChange}
			/>
			<AnySwitch
				title="Remove All Vocals (Pure Instrumental)"
				desc="Uses Inst_HQ_3 instead of Karaoke_2 when active (removes backing harmonies/ad-libs as well as lead vocals)."
				checked={mode === "instrumental"}
				onChange={onFullInstrumentalChange}
			/>
			<AnySwitch
				title="Fast DSP Only Mode (Zero AI / Zero VRAM)"
				desc="Uses instant spectral Mid-Side vocal suppression without loading any ONNX neural model."
				checked={mode === "dsp"}
				onChange={onDspOnlyChange}
			/>
			<AnySwitch
				title="GPU Acceleration (DirectML)"
				desc="Run real-time ONNX vocal separation on your Windows GPU via DirectML (recommended for 30x+ lookahead speed)."
				checked={useGpu}
				onChange={onUseGpuChange}
			/>
			<AnySwitch
				title="Preload Next Track Stems"
				desc="Pre-separates the opening chunk of queued tracks ahead of transitions for gapless Karaoke playback."
				checked={autoPreload}
				onChange={onAutoPreloadChange}
			/>
			<AnySwitch
				title="Use Lossless FLAC Stream"
				desc="Off (Recommended): streams fast 320 kbps AAC (~5 MB, instant load). On: streams full Lossless FLAC (~30 MB)."
				checked={useLossless}
				onChange={onUseLosslessChange}
			/>
			<LunaNumberSetting
				title="Audio Sync Offset (ms)"
				value={syncOffsetMs}
				min={-200}
				max={200}
				step={5}
				desc="Fine-tune synchronization with Tidal lyrics (-200 to +200 ms, default: 0)."
				onNumber={onSyncOffsetChange}
			/>
			<LunaNumberSetting
				title="Karaoke Engine Port"
				value={wsPort}
				min={1024}
				max={65535}
				step={1}
				desc="Local WebSocket control port for Windows karaoke-engine.exe (default: 5445)."
				onNumber={onWsPortChange}
			/>
			<LunaNumberSetting
				title="Stem Disk Cache Limit (MB)"
				value={cacheMaxMb}
				min={256}
				max={16384}
				step={256}
				desc="Maximum disk space in %LOCALAPPDATA%\\karaoke-engine\\cache for instant cached stems (256–16384 MB)."
				onNumber={onCacheMaxMbChange}
			/>
			<LunaButtonSetting
				title="Clear Stem Cache"
				desc="Remove all cached decoded tracks and AI instrumental stems from disk."
				onClick={onClearCache}
			>
				Clear Cache
			</LunaButtonSetting>
		</LunaSettings>
	);
};
