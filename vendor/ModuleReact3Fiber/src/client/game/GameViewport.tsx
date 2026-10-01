import { Canvas } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import type { RoomSocket } from "../net/useRoomSocket.js";
import type { Settings } from "../settings/SettingsContext.js";
import { Scene, type SnakeLabel } from "./Scene.js";
import { resolveRenderDpr } from "./performance.js";
import { CAMERA_PROJECTION, resolveSceneQuality } from "./sceneMath.js";
import type { TwinStickState } from "./mobileControls.js";
import { useLocalInput, type LocalInput } from "./useLocalInput.js";

export interface GameViewportProps {
  socket: RoomSocket;
  settings: Settings;
  inputEnabled: boolean;
  labelsRef?: React.MutableRefObject<SnakeLabel[]>;
  touchInputRef?: React.MutableRefObject<TwinStickState>;
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
  touchInputRef,
  touchControls = false,
}: GameViewportProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<LocalInput>({
    targetYaw: 0,
    targetPitch: 0,
    boosting: false,
    cameraLookYaw: 0,
    cameraLookPitch: 0,
  });
  const quality = resolveSceneQuality(settings.graphics.quality);
  const [deviceDpr, setDeviceDpr] = useState(() => (
    typeof window === "undefined" ? 1 : window.devicePixelRatio
  ));
  useEffect(() => {
    const updateDpr = () => {
      const next = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
        ? window.devicePixelRatio
        : 1;
      setDeviceDpr((previous) => Math.abs(previous - next) < 0.01 ? previous : next);
    };
    window.addEventListener("resize", updateDpr);
    window.visualViewport?.addEventListener("resize", updateDpr);
    return () => {
      window.removeEventListener("resize", updateDpr);
      window.visualViewport?.removeEventListener("resize", updateDpr);
    };
  }, []);
  const renderDpr = resolveRenderDpr(settings.graphics.quality, touchControls, deviceDpr);

  useLocalInput(socket, settings, inputEnabled, inputRef, surfaceRef, touchInputRef, touchControls);

  const label = touchControls
    ? "Shark Tank. The flight stick pitches and yaws. The opposite stick looks around. Dash and primary attack remain separate touch controls."
    : "Shark Tank. W and S climb or dive; A and D turn. Arrow keys look around. Space bursts, F uses the current primary attack, Escape pauses, and mouse look is optional.";

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
        dpr={renderDpr}
        gl={{ alpha: false, antialias: quality.antialias }}
      >
        <Scene socket={socket} settings={settings} labelsRef={labelsRef} inputRef={inputRef} />
      </Canvas>
    </div>
  );
}
