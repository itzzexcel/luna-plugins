import React from "react";

import { LunaSettings, LunaSwitchSetting } from "@luna/ui";

const DEFAULT_PLATFORMS = {
	spotify: true,
	appleMusic: true,
	youTubeMusic: true,
	amazonMusic: true,
};

const PLATFORM_KEYS = Object.keys(DEFAULT_PLATFORMS) as (keyof typeof DEFAULT_PLATFORMS)[];

export const Settings = () => {
	const [platforms, setPlatforms] = React.useState(() => {
		try {
			const saved = localStorage.getItem("sharePlusPlatforms");
			return saved ? JSON.parse(saved) : DEFAULT_PLATFORMS;
		} catch {
			return DEFAULT_PLATFORMS;
		}
	});

	const handleChange = React.useCallback((key: keyof typeof DEFAULT_PLATFORMS, checked: boolean) => {
		setPlatforms((prev: typeof DEFAULT_PLATFORMS) => {
			const next = { ...prev, [key]: checked };
			localStorage.setItem("sharePlusPlatforms", JSON.stringify(next));
			return next;
		});
	}, []);

	return (
		<LunaSettings>
			{PLATFORM_KEYS.map((key) => {
				const labels: Record<string, string> = {
					spotify:      "Spotify",
					appleMusic:   "Apple Music",
					youTubeMusic: "YouTube Music",
					amazonMusic:  "Amazon Music",
				};
				return (
					<LunaSwitchSetting
						key={key}
						title={labels[key]}
						checked={!!platforms[key]}
						onChange={(_: React.ChangeEvent<HTMLInputElement>, checked?: boolean) => handleChange(key, checked ?? false)}
					/>
				);
			})}
		</LunaSettings>
	);
};