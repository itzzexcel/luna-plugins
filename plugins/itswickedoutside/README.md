# Reactivo — Now Playing Audio Visualiser for TidaLuna

>A lightweight audio visualiser plugin for TidaLuna that overlays reactive glow/vignette/pulse effects on the Now Playing view. It receives analysis data from a WebSocket source and animates the UI in response to low-frequency/bass information.

## Features
- Animated glow, vignette and pulse ring synced to audio analysis
- Optional on-screen connection status and numeric stats (BPM, bass, frequency)
- Auto-reconnect to a local or remote WebSocket audio-analysis server
- Minimal styling and non-intrusive overlay (pointer-events disabled)

## Installation

Install the plugin through your Luna plugin workflow (or drop the built files into your plugins directory). If developing locally inside this monorepo you can run the repo build/watch commands — otherwise install from releases if published.

Make sure the plugin can reach an analysis WebSocket at the configured URL (default: `ws://localhost:5343`). The visualiser expects messages as JSON arrays where the first item is an object matching the shape:

```json
[{
  "bass": {
    "strongest": { "frequency": 42, "magnitude": 0.85 },
    "average": 0.00012,
    "max": 0.0004,
    "frequency": 42
  },
  "bpm": 128,
  "utime": 1234567890
}]
```

## Usage

Once enabled, Reactivo overlays the Now Playing container and attempts a WebSocket connection to the configured address. If a connection is present and messages follow the expected format, visual effects are applied automatically.

Controls and behaviors:
- The visualiser initialises automatically when the Now Playing view loads.
- It will attempt to reconnect when the WebSocket connection is lost (configurable).
- The visualiser can be programmatically controlled via the exported helpers in the plugin code (see `src/index.ts`).

## Settings

This plugin exposes an example settings UI. You can view or extend the settings in [src/Settings.tsx](src/Settings.tsx).

### Runtime options
The internal visualiser supports the following options (defaults shown):

- `wsUrl` (string) — default `ws://localhost:5343`
- `autoReconnect` (boolean) — default `true`
- `maxReconnectAttempts` (number) — default `5` (visualiser tries progressively)
- `reconnectDelay` (number ms) — default `2000`
- `lerpFactor` (number 0..1) — default `0.5` (smoothness of transitions)
- `showStats` (boolean) — default `false`
- `showStatus` (boolean) — default `false`
- `zIndex` (number) — default `-3`

To change options, edit the code that instantiates the visualiser in [src/index.ts](src/index.ts).

The audio analysis server used by Reactivo is maintained in a separate project: https://github.com/itzzexcel/reactivo. If you want the analysis server source, example agents, or platform builds, check that repo.

## Development

Files to note:
- [src/index.ts](src/index.ts) — plugin lifecycle and connection logic
- [src/giragira.ts](src/giragira.ts) — visualiser core, DOM/CSS logic and WS handling
- [src/Settings.tsx](src/Settings.tsx) — plugin settings UI
- [src/ui-interface.ts](src/ui-interface.ts) — helper to locate the Now Playing container

If you develop locally in this monorepo, use the top-level watch/build scripts (see repository README) to rebuild the plugin and test changes in the Luna app.

### Bundled helper (Windows)
This plugin includes a small helper executable bundled for Windows at `src/net9.0-windows.zip`. You can unzip and run the contained installer to install a local analysis helper — the binary is provided to simplify testing on Windows, but the full analyser source and other platform builds are in the external repo above.

## Troubleshooting

- Visual effects not appearing: check the browser devtools console for errors and ensure the plugin can find the Now Playing container (look at `GetNPView` in `src/ui-interface.ts`).
- No connection / disconnected status: verify a compatible WebSocket audio analysis server is running and listening at `ws://localhost:5343` (or change `wsUrl`).