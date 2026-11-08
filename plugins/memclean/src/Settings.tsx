import React from "react";
import { LunaSettings, LunaSwitchSetting } from "@luna/ui";
import { ReactiveStore } from "@luna/core";
import {
	setTrimOffscreenImages,
	setHibernateInBackground,
	setTrackChangePurge,
	setPauseBackgroundVideos,
	setPeriodicSweepEnabled,
} from ".";

type BaseSwitchProps = React.ComponentProps<typeof LunaSwitchSetting>;
type AnySwitchProps = Omit<BaseSwitchProps, "onChange"> & {
	onChange: (_: unknown, checked: boolean) => void;
	checked: boolean;
	description?: string;
};

const AnySwitch = LunaSwitchSetting as unknown as React.ComponentType<AnySwitchProps>;

export const DataStoreService = await ReactiveStore.getPluginStorage(
	"memclean",
	{
		trimOffscreenImages: true,
		hibernateInBackground: true,
		trackChangePurge: true,
		pauseBackgroundVideos: true,
		periodicSweepEnabled: true,
	},
);

export const Settings = () => {
	const [trimImages, setTrimImages] = React.useState<boolean>(DataStoreService.trimOffscreenImages);
	const [hibernate, setHibernate] = React.useState<boolean>(DataStoreService.hibernateInBackground);
	const [trackPurge, setTrackPurge] = React.useState<boolean>(DataStoreService.trackChangePurge);
	const [pauseVideos, setPauseVideos] = React.useState<boolean>(DataStoreService.pauseBackgroundVideos);
	const [periodicSweep, setPeriodicSweep] = React.useState<boolean>(DataStoreService.periodicSweepEnabled ?? true);

	const onTrimChange = React.useCallback((_: unknown, checked?: boolean) => {
		const val = !!checked;
		DataStoreService.trimOffscreenImages = val;
		setTrimImages(val);
		setTrimOffscreenImages(val);
	}, []);

	const onHibernateChange = React.useCallback((_: unknown, checked?: boolean) => {
		const val = !!checked;
		DataStoreService.hibernateInBackground = val;
		setHibernate(val);
		setHibernateInBackground(val);
	}, []);

	const onTrackPurgeChange = React.useCallback((_: unknown, checked?: boolean) => {
		const val = !!checked;
		DataStoreService.trackChangePurge = val;
		setTrackPurge(val);
		setTrackChangePurge(val);
	}, []);

	const onPauseVideosChange = React.useCallback((_: unknown, checked?: boolean) => {
		const val = !!checked;
		DataStoreService.pauseBackgroundVideos = val;
		setPauseVideos(val);
		setPauseBackgroundVideos(val);
	}, []);

	const onPeriodicSweepChange = React.useCallback((_: unknown, checked?: boolean) => {
		const val = !!checked;
		DataStoreService.periodicSweepEnabled = val;
		setPeriodicSweep(val);
		setPeriodicSweepEnabled(val);
	}, []);

	return (
		<LunaSettings>
			<AnySwitch
				title="Trim Off-Screen Album Art"
				description="Purges decoded cover images when they scroll out of view. Saves 150-400 MB on long playlists."
				checked={trimImages}
				onChange={onTrimChange}
			/>
			<AnySwitch
				title="Periodic Memory Sweep (Every 2 min)"
				description="Automatically trims stale image decodes and nudges V8 garbage collection every 2 minutes."
				checked={periodicSweep}
				onChange={onPeriodicSweepChange}
			/>
			<AnySwitch
				title="Background Hibernation"
				description="Freezes animations and background video buffers when Tidal is minimized or hidden."
				checked={hibernate}
				onChange={onHibernateChange}
			/>
			<AnySwitch
				title="Track-Change Memory Purge"
				description="Triggers an idle memory sweep between songs to drop lingering track metadata."
				checked={trackPurge}
				onChange={onTrackPurgeChange}
			/>
			<AnySwitch
				title="Pause Videos in Background"
				description="Pauses hardware video decoding framebuffers when Tidal is minimized."
				checked={pauseVideos}
				onChange={onPauseVideosChange}
			/>
		</LunaSettings>
	);
};
