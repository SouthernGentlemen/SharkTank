// Public client entry for the Shark Arena game module. The host mounts <App/>.
export { App } from "./App.js";
export type { AppProps } from "./App.js";

// Lower-level pieces, exported for embedding/testing.
export { GameScreen } from "./ui/GameScreen.js";
export { GameCanvas } from "./game/GameCanvas.js";
export { Scene } from "./game/Scene.js";
export { useRoomSocket } from "./net/useRoomSocket.js";
export type { RoomSocket } from "./net/useRoomSocket.js";
export { SettingsProvider, useSettings, DEFAULT_SETTINGS } from "./settings/SettingsContext.js";
export type { Settings } from "./settings/SettingsContext.js";
