import React from "react";

import { LunaNumber, LunaNumberSetting, LunaSettings, LunaSwitchSetting } from "@luna/ui";
import { setVignetteIntensity, setDynamicLerpEnabled, } from ".";
import { ReactiveStore } from "@luna/core"

// Thank you @meowarex 
// https://github.com/meowarex/TidalLuna-Plugins/blob/main/plugins/radiant-lyrics-luna/src/Settings.tsx#L138
// ----------------------------------------------------------------------------------------------------------
// Derive props and override onChange to accept a broader first param type
type BaseSwitchProps = React.ComponentProps<typeof LunaSwitchSetting>;
type AnySwitchProps = Omit<BaseSwitchProps, "onChange"> & {
    onChange: (_: unknown, checked: boolean) => void;
    checked: boolean;
};

const AnySwitch = LunaSwitchSetting as unknown as React.ComponentType<AnySwitchProps>;

export const DataStoreService = await ReactiveStore.getPluginStorage("reactivo", {
    vignetteIntensity: 2,
    dynamicLerpEnabled: true,
    dynamicIntensity: false
})

export const Settings = () => {
    const [intensity, setIntensity] = React.useState<number>(DataStoreService.vignetteIntensity);
    const [dynamic, setDynamic] = React.useState<boolean>(DataStoreService.dynamicLerpEnabled);
    

    const onIntensityChange = React.useCallback((val?: any) => {
        if (isNaN(val)) val = 1;
        DataStoreService.vignetteIntensity = val;
        setIntensity(DataStoreService.vignetteIntensity);
        setVignetteIntensity(DataStoreService.vignetteIntensity);
    }, []);

    const onDynamicChange = React.useCallback((_: React.ChangeEvent<HTMLInputElement>, checked?: boolean) => {
        DataStoreService.dynamicLerpEnabled = !!checked;
        setDynamic(DataStoreService.dynamicLerpEnabled);
        setDynamicLerpEnabled(DataStoreService.dynamicLerpEnabled);
    }, []);

    return (
        <LunaSettings>
            <LunaNumberSetting title="Vignette Intensity" value={intensity} min={0} max={5} step={1} desc="Multiplier for vignette intensity (default: 2)" onNumber={onIntensityChange} />
            <AnySwitch title="Dynamic Lerp" checked={dynamic} desc="Enable BPM-driven lerp adjustments" onChange={onDynamicChange} />
        </LunaSettings>
    );
};
