import { AdaptiveResolution } from "./AdaptiveResolution.js";
import { Canvas } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import type { RoomSocket } from "../net/useRoomSocket.js";
import { keyLabel, type Settings } from "../settings/SettingsContext.js";
import { Scene, type SharkLabel } from "./Scene.js";
import { resolveRenderDpr } from "./performance.js";
import { CAMERA_PROJECTION, resolveSceneQuality } from "./sceneMath.js";
import type { TwinStickState } from "./mobileControls.js";
import { useLocalInput, type LocalInput } from "./useLocalInput.js";

export interface GameViewportProps {
  socket: RoomSocket;
  settings: Settings;
  inputEnabled: boolean;
  labelsRef?: React.MutableRefObject<SharkLabel[]>;
  touchInputRef?: React.MutableRefObject<TwinStickState>;
  touchControls?: boolean;
}

/**
 * The one production gameplay renderer.
 *
 * The viewport renders authoritative full X/Y/Z snapshots through one modular R3F ocean
 * scene. Local prediction and camera presentation stay client-side; competitive authority
 * remains in the Room Durable Object.
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

  const k = settings.controls.keybinds;
  const label = touchControls
    ? settings.controls.touchScheme === "simple"
      ? "Shark Tank 3D gameplay view. Simple steering: start a floating flight stick anywhere in the flight half to pitch and yaw. The camera recentres automatically. Dash and bite are separate touch controls. Gameplay status and navigation cues are in the surrounding DOM interface."
      : "Shark Tank 3D gameplay view. The flight stick pitches and yaws. The opposite stick looks around. Dash and bite remain separate touch controls. Gameplay status, leaderboard, and 3D navigation cues are available in the surrounding DOM interface."
    : `Shark Tank 3D gameplay view. ${keyLabel(k.pitchUp)} and ${keyLabel(k.pitchDown)} pitch up or down; ${keyLabel(k.yawLeft)} and ${keyLabel(k.yawRight)} yaw left or right. ${keyLabel(k.lookUp)}, ${keyLabel(k.lookDown)}, ${keyLabel(k.lookLeft)}, and ${keyLabel(k.lookRight)} look around. ${keyLabel(k.boost)} bursts, ${keyLabel(k.bite)} bites, ${keyLabel(k.pause)} pauses, and mouse look is optional. Gameplay status, leaderboard, and 3D navigation cues are available in the surrounding DOM interface.`;

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
        <AdaptiveResolution cap={renderDpr} />
        <Scene socket={socket} settings={settings} labelsRef={labelsRef} inputRef={inputRef} />
      </Canvas>
    </div>
  );
}
