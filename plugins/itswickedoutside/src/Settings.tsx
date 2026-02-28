import React from "react";

import { LunaNumber, LunaNumberSetting, LunaSettings, LunaSwitchSetting } from "@luna/ui";
import { setVignetteIntensity, setDynamicLerpEnabled, setDynamicIntensityEnabled, setDynamicColourArt } from ".";
import { ReactiveStore } from "@luna/core"

// Thank you @meowarex 
// https://github.com/meowarex/TidalLuna-Plugins/blob/0a694a5bc0cb98f72506077f63134bcece555e0d/plugins/radiant-lyrics-luna/src/Settings.tsx#L138
// ----------------------------------------------------------------------------------------------------------
// Derive props and override onChange to accept a broader first param type
type BaseSwitchProps = React.ComponentProps<typeof LunaSwitchSetting>;
type AnySwitchProps = Omit<BaseSwitchProps, "onChange"> & {
	onChange: (_: unknown, checked: boolean) => void;
	checked: boolean;
};

const AnySwitch = LunaSwitchSetting as unknown as React.ComponentType<AnySwitchProps>;

export const DataStoreService = await ReactiveStore.getPluginStorage("reactivo", {
	vignetteIntensity: 1,
	dynamicLerpEnabled: true,
	dynamicIntensityEnabled: false,
	vignetteUsesArtworkColourEnabled: true,
	isFirstRan: false
})

export const Settings = () => {
	const [intensity, setIntensity] = React.useState<number>(DataStoreService.vignetteIntensity);
	const [dynamic, setDynamic] = React.useState<boolean>(DataStoreService.dynamicLerpEnabled);
	const [dynamicIntensity, setDynamicIntensityState] = React.useState<boolean>(DataStoreService.dynamicIntensityEnabled);
	const [artworkColourVignette, setArtVignetteChange] = React.useState<boolean>(DataStoreService.vignetteUsesArtworkColourEnabled);

	const onIntensityChange = React.useCallback((val?: any) => {
		if (isNaN(val)) val = 1;
		DataStoreService.vignetteIntensity = val;
		setIntensity(DataStoreService.vignetteIntensity);
		setVignetteIntensity(DataStoreService.vignetteIntensity);
	}, []);

	const onDynamicChange = React.useCallback((_: unknown, checked?: boolean) => {
		DataStoreService.dynamicLerpEnabled = !!checked;
		setDynamic(DataStoreService.dynamicLerpEnabled);
		setDynamicLerpEnabled(DataStoreService.dynamicLerpEnabled);
	}, []);

	const onDynamicIntensityChange = React.useCallback((_: unknown, checked?: boolean) => {
		DataStoreService.dynamicIntensityEnabled = !!checked;
		setDynamicIntensityState(DataStoreService.dynamicIntensityEnabled);
		setDynamicIntensityEnabled(DataStoreService.dynamicIntensityEnabled);
	}, []);

	const onArtVignetteChange = React.useCallback((_: unknown, checked?: boolean) => {
		DataStoreService.vignetteUsesArtworkColourEnabled = !!checked;
		setArtVignetteChange(DataStoreService.vignetteUsesArtworkColourEnabled);
		setDynamicColourArt(DataStoreService.vignetteUsesArtworkColourEnabled);
	}, []);

	return (
		<LunaSettings>
			<LunaNumberSetting title="Vignette Intensity" value={intensity} min={0} max={5} step={1} desc="Multiplier for vignette intensity (default: 2)" onNumber={onIntensityChange} />
			<AnySwitch title="Dynamic Lerp" checked={dynamic} desc="Enable BPM-driven lerp adjustments" onChange={onDynamicChange} />
			<AnySwitch title="Dynamic Intensity (WIP)" checked={dynamicIntensity} desc="Scales intensity based on audio content (works better with low-bass songs)" onChange={onDynamicIntensityChange} />
			<AnySwitch title="Vignette Colour uses Artwork Colours" checked={artworkColourVignette} desc="Changes the vignette colour to the most vibrant colour of the currently playing song artwork." onChange={onArtVignetteChange} />
		</LunaSettings>
	);
};