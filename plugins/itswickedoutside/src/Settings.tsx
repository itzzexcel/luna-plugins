import React from "react";

import {
	LunaNumber,
	LunaNumberSetting,
	LunaSettings,
	LunaSwitchSetting,
} from "@luna/ui";
import {
	setVignetteIntensity,
	setDynamicLerpEnabled,
	setDynamicIntensityEnabled,
	setDynamicColourArt,
	setEnhancedBackground,
	setBackgroundMode,
	setApolMusicWannabeEnabled,
	setColorSaturation,
	setCircleDensity,
	setCircleOpacity,
} from ".";
import { ReactiveStore } from "@luna/core";

// Thank you @meowarex
// https://github.com/meowarex/TidalLuna-Plugins/blob/0a694a5bc0cb98f72506077f63134bcece555e0d/plugins/radiant-lyrics-luna/src/Settings.tsx#L138
// ----------------------------------------------------------------------------------------------------------
// Derive props and override onChange to accept a broader first param type
type BaseSwitchProps = React.ComponentProps<typeof LunaSwitchSetting>;
type AnySwitchProps = Omit<BaseSwitchProps, "onChange"> & {
	onChange: (_: unknown, checked: boolean) => void;
	checked: boolean;
};

const AnySwitch =
	LunaSwitchSetting as unknown as React.ComponentType<AnySwitchProps>;

export const DataStoreService = await ReactiveStore.getPluginStorage(
	"reactivo",
	{
		vignetteIntensity: 20,
		colorSaturation: 10,
		dynamicLerpEnabled: true,
		dynamicIntensityEnabled: false,
		vignetteUsesArtworkColourEnabled: true,
		enhancedBackgroundEnabled: false,
		backgroundMode: 'circles',
		apolMusicWannabeEnabled: false,
		circleDensity: 10,
		circleOpacity: 10,
		scale10xMigrated: false,
		isFirstRan: false,
		updateNeeded_1: true
	},
);

// One-time migration from old decimal/small-int scale to 10x integer scale (1 = 0.1, 10 = 1.0)
if (!DataStoreService.scale10xMigrated) {
	if ((DataStoreService.vignetteIntensity ?? 20) <= 5) {
		DataStoreService.vignetteIntensity = Math.round((DataStoreService.vignetteIntensity ?? 2) * 10);
	}
	if ((DataStoreService.colorSaturation ?? 10) <= 3) {
		DataStoreService.colorSaturation = Math.round((DataStoreService.colorSaturation ?? 1) * 10);
	}
	if ((DataStoreService.circleDensity ?? 10) <= 1) {
		DataStoreService.circleDensity = Math.round((DataStoreService.circleDensity ?? 1) * 10);
	}
	if ((DataStoreService.circleOpacity ?? 10) <= 1) {
		DataStoreService.circleOpacity = Math.round((DataStoreService.circleOpacity ?? 1) * 10);
	}
	DataStoreService.scale10xMigrated = true;
}

export const Settings = () => {
	const [intensity, setIntensity] = React.useState<number>(
		DataStoreService.vignetteIntensity ?? 20,
	);
	const [colorSaturation, setColorSaturationState] = React.useState<number>(
		DataStoreService.colorSaturation ?? 10,
	);
	const [dynamic, setDynamic] = React.useState<boolean>(
		DataStoreService.dynamicLerpEnabled,
	);
	const [dynamicIntensity, setDynamicIntensityState] =
		React.useState<boolean>(DataStoreService.dynamicIntensityEnabled);
	const [artworkColourVignette, setArtVignetteChange] =
		React.useState<boolean>(
			DataStoreService.vignetteUsesArtworkColourEnabled,
		);
	const [enhancedBackgroundEnabled, setEnhancedBackgroundState] =
		React.useState<boolean>(
			DataStoreService.enhancedBackgroundEnabled,
		);
	const [backgroundMode, setBackgroundModeState] =
		React.useState<'circles' | 'images'>(
			(DataStoreService.backgroundMode as 'circles' | 'images') || 'circles',
		);
	const [apolMusicWannabeEnabled, setApolMusicWannabeState] =
		React.useState<boolean>(
			DataStoreService.apolMusicWannabeEnabled ?? false,
		);
	const [circleDensity, setCircleDensityState] = React.useState<number>(
		DataStoreService.circleDensity ?? 10,
	);
	const [circleOpacity, setCircleOpacityState] = React.useState<number>(
		DataStoreService.circleOpacity ?? 10,
	);

	const onIntensityChange = React.useCallback((val?: any) => {
		if (isNaN(val)) val = 20;
		const clamped = Math.max(0, Math.min(50, Math.round(Number(val))));
		DataStoreService.vignetteIntensity = clamped;
		setIntensity(clamped);
		setVignetteIntensity(clamped / 10);
	}, []);

	const onColorSaturationChange = React.useCallback((val?: any) => {
		if (isNaN(val)) val = 10;
		const clamped = Math.max(0, Math.min(30, Math.round(Number(val))));
		DataStoreService.colorSaturation = clamped;
		setColorSaturationState(clamped);
		setColorSaturation(clamped / 10);
	}, []);

	const onDynamicChange = React.useCallback(
		(_: unknown, checked?: boolean) => {
			DataStoreService.dynamicLerpEnabled = !!checked;
			setDynamic(DataStoreService.dynamicLerpEnabled);
			setDynamicLerpEnabled(DataStoreService.dynamicLerpEnabled);
		},
		[],
	);

	const onDynamicIntensityChange = React.useCallback(
		(_: unknown, checked?: boolean) => {
			DataStoreService.dynamicIntensityEnabled = !!checked;
			setDynamicIntensityState(DataStoreService.dynamicIntensityEnabled);
			setDynamicIntensityEnabled(
				DataStoreService.dynamicIntensityEnabled,
			);
		},
		[],
	);

	const onArtVignetteChange = React.useCallback(
		(_: unknown, checked?: boolean) => {
			DataStoreService.vignetteUsesArtworkColourEnabled = !!checked;
			setArtVignetteChange(
				DataStoreService.vignetteUsesArtworkColourEnabled,
			);
			setDynamicColourArt(
				DataStoreService.vignetteUsesArtworkColourEnabled,
			);
		},
		[],
	);

	const onEnhancedBackgroundChange = React.useCallback(
		(_: unknown, checked?: boolean) => {
			DataStoreService.enhancedBackgroundEnabled = !!checked;
			setEnhancedBackgroundState(
				DataStoreService.enhancedBackgroundEnabled,
			);
			setEnhancedBackground(
				DataStoreService.enhancedBackgroundEnabled,
			);
		},
		[],
	);

	const onBackgroundModeChange = React.useCallback(
		(_: unknown, checked?: boolean) => {
			DataStoreService.backgroundMode = checked ? 'images' : 'circles';
			setBackgroundModeState(
				DataStoreService.backgroundMode as 'circles' | 'images',
			);
			setBackgroundMode(
				DataStoreService.backgroundMode as 'circles' | 'images',
			);
		},
		[],
	);

	const onApolMusicWannabeChange = React.useCallback(
		(_: unknown, checked?: boolean) => {
			DataStoreService.apolMusicWannabeEnabled = !!checked;
			setApolMusicWannabeState(
				DataStoreService.apolMusicWannabeEnabled,
			);
			setApolMusicWannabeEnabled(
				DataStoreService.apolMusicWannabeEnabled,
			);
		},
		[],
	);

	const onCircleDensityChange = React.useCallback((val?: any) => {
		if (isNaN(val)) val = 10;
		const clamped = Math.max(0, Math.min(10, Math.round(Number(val))));
		DataStoreService.circleDensity = clamped;
		setCircleDensityState(clamped);
		setCircleDensity(clamped / 10);
	}, []);

	const onCircleOpacityChange = React.useCallback((val?: any) => {
		if (isNaN(val)) val = 10;
		const clamped = Math.max(0, Math.min(10, Math.round(Number(val))));
		DataStoreService.circleOpacity = clamped;
		setCircleOpacityState(clamped);
		setCircleOpacity(clamped / 10);
	}, []);

	return (
		<LunaSettings>
			<LunaNumberSetting
				title="Vignette Intensity"
				value={intensity}
				min={0}
				max={50}
				step={1}
				desc="Multiplier for vignette intensity (1 = 0.1, 10 = 1.0, default: 20)"
				onNumber={onIntensityChange}
			/>
			<LunaNumberSetting
				title="Colour Saturation"
				value={colorSaturation}
				min={0}
				max={30}
				step={1}
				desc="Multiplier for colour saturation of visual effects and atmosphere (1 = 0.1, 10 = 1.0, default: 10)"
				onNumber={onColorSaturationChange}
			/>
			<AnySwitch
				title="Dynamic Intensity (WIP)"
				checked={dynamicIntensity}
				desc="Scales intensity based on audio content (works better with low-bass songs)"
				onChange={onDynamicIntensityChange}
			/>

			<AnySwitch
				title="Dynamic Lerp"
				checked={dynamic}
				desc="Enable BPM-driven lerp adjustments"
				onChange={onDynamicChange}
			/>

			<AnySwitch
				title="Vignette Colour uses Artwork Colours"
				checked={artworkColourVignette}
				desc="Changes the vignette colour to the most vibrant colour of the currently playing song artwork."
				onChange={onArtVignetteChange}
			/>

			<AnySwitch
				title="Enhanced Background"
				checked={enhancedBackgroundEnabled}
				desc="Create large blurred circles from the cover art palette behind the visualiser."
				onChange={onEnhancedBackgroundChange}
			/>
			<AnySwitch
				title="Use cover images for background"
				checked={backgroundMode === 'images'}
				desc="Use distorted album artwork fragments instead of plain gradient blobs."
				onChange={onBackgroundModeChange}
			/>
			<AnySwitch
				title="Apol Music wannabe"
				checked={apolMusicWannabeEnabled}
				desc="Makes Enhanced Background circles shrink on bass instead of expanding."
				onChange={onApolMusicWannabeChange}
			/>
			<LunaNumberSetting
				title="Circle Density"
				value={circleDensity}
				min={0}
				max={10}
				step={1}
				desc="Controls how many Enhanced Background circles are rendered (0 = none, 1 = 0.1, 10 = 1.0, default: 10)"
				onNumber={onCircleDensityChange}
			/>
			<LunaNumberSetting
				title="Circle Opacity"
				value={circleOpacity}
				min={0}
				max={10}
				step={1}
				desc="Controls the opacity of Enhanced Background circles (0 = transparent, 1 = 0.1, 10 = 1.0, default: 10)"
				onNumber={onCircleOpacityChange}
			/>
		</LunaSettings>
	);
};
