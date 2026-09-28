import { Canvas } from "@react-three/fiber";
import { useRef } from "react";
import type { RoomSocket } from "../net/useRoomSocket.js";
import type { Settings } from "../settings/SettingsContext.js";
import { Scene, type SnakeLabel } from "./Scene.js";
import { CAMERA_PROJECTION, resolveSceneQuality } from "./sceneMath.js";
import { useLocalInput, type LocalInput, type StickState } from "./useLocalInput.js";

export interface GameViewportProps {
  socket: RoomSocket;
  settings: Settings;
  inputEnabled: boolean;
  labelsRef?: React.MutableRefObject<SnakeLabel[]>;
  /** Current touch stick remains yaw-only until ST-117; the realtime intent is yaw+pitch. */
  stickRef?: React.MutableRefObject<StickState>;
  touchControls?: boolean;
}

/**
 * The one production gameplay renderer.
 *
 * Authority is still planar for ST-111, but the viewport now owns one modular R3F ocean
 * scene with a perspective chase rig and explicit quality-scaled rendering boundaries.
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
  const inputRef = useRef<LocalInput>({ targetYaw: 0, targetPitch: 0, boosting: false });
  const quality = resolveSceneQuality(settings.graphics.quality);

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
        camera={{
          position: [0, 18, 24],
          fov: CAMERA_PROJECTION.fov,
          near: CAMERA_PROJECTION.near,
          far: CAMERA_PROJECTION.far,
        }}
        dpr={quality.dpr}
        gl={{ alpha: false, antialias: quality.antialias }}
      >
        <Scene socket={socket} settings={settings} labelsRef={labelsRef} inputRef={inputRef} />
      </Canvas>
    </div>
  );
}
