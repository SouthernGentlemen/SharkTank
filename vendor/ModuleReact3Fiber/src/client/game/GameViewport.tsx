import { Canvas } from "@react-three/fiber";
import { useRef } from "react";
import type { RoomSocket } from "../net/useRoomSocket.js";
import type { Settings } from "../settings/SettingsContext.js";
import { Scene, type SnakeLabel } from "./Scene.js";
import { useLocalInput, type LocalInput, type StickState } from "./useLocalInput.js";

export interface GameViewportProps {
  socket: RoomSocket;
  settings: Settings;
  inputEnabled: boolean;
  labelsRef?: React.MutableRefObject<SnakeLabel[]>;
  /** Live planar thumbstick heading retained until the full-3D input task lands. */
  stickRef?: React.MutableRefObject<StickState>;
  touchControls?: boolean;
}

/**
 * The one production gameplay renderer.
 *
 * ST-110 deliberately keeps the existing planar engine/protocol/input model while moving
 * rendering, prediction and camera ownership onto React Three Fiber. Later tasks can now
 * change world dimensionality without carrying a second Canvas2D game beside the R3F one.
 */
export function GameViewport({
  socket,
  settings,
  inputEnabled,
  labelsRef,
  stickRef,
  touchControls = false,
}: GameViewportProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<LocalInput>({ targetHeading: 0, boosting: false });

  useLocalInput(socket, settings, inputEnabled, inputRef, surfaceRef, stickRef, touchControls);

  const label = touchControls
    ? "Shark Tank. Hold the on-screen stick to swim. The dash and rocket pads sit under your other thumb."
    : "Shark Tank. Steer with the pointer or arrow keys. Space or click dashes. Shift fires a rocket.";

  return (
    <div
      ref={surfaceRef}
      tabIndex={-1}
      role="img"
      aria-label={label}
      className="game-viewport"
    >
      <Canvas
        className="game-webgl-canvas"
        camera={{ position: [0, 42, 18], fov: 55, near: 0.1, far: 500 }}
        dpr={[1, 2]}
        gl={{ alpha: false, antialias: settings.graphics.quality !== "low" }}
      >
        <Scene socket={socket} settings={settings} labelsRef={labelsRef} inputRef={inputRef} />
      </Canvas>
    </div>
  );
}
