import React from "react";

import { LunaSettings, LunaSwitchSetting } from "@luna/ui";

export const Settings = () => {
	const [checked, setChecked] = React.useState(false);
	const onChange = React.useCallback((_: React.ChangeEvent<HTMLInputElement>, checked?: boolean) => {
		setChecked(checked ?? false);
	}, []);
	return (
		<LunaSettings>
			<LunaSwitchSetting title="Example Switch" checked={checked} desc="This is an example switch" onChange={onChange} />
		</LunaSettings>
	);
};