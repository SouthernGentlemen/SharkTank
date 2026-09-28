// Browser-only React Three Fiber composition for the production game world.
// Authority is volumetric from ST-112 onward; later tasks replace the temporary planar input adapter and tune final 3D behavior.

import { useRef } from "react";
import type { RoomSocket } from "../net/useRoomSocket.js";
import type { Settings } from "../settings/SettingsContext.js";
import { ActorLayer, type SnakeLabel } from "./ActorLayer.js";
import { CameraRig, makeCameraFollowTarget } from "./CameraRig.js";
import { FxLayer } from "./FxLayer.js";
import { PreyLayer } from "./PreyLayer.js";
import { WorldEnvironment } from "./WorldEnvironment.js";
import type { LocalInput } from "./useLocalInput.js";

export type { SnakeLabel } from "./ActorLayer.js";

export function Scene({
  socket,
  settings,
  labelsRef,
  inputRef,
}: {
  socket: RoomSocket;
  settings: Settings;
  labelsRef?: React.MutableRefObject<SnakeLabel[]>;
  inputRef?: React.MutableRefObject<LocalInput>;
}) {
  const followRef = useRef(makeCameraFollowTarget());

  return (
    <>
      <WorldEnvironment settings={settings} />
      <ActorLayer
        socket={socket}
        settings={settings}
        labelsRef={labelsRef}
        inputRef={inputRef}
        followRef={followRef}
      />
      <PreyLayer socket={socket} />
      <FxLayer socket={socket} settings={settings} followRef={followRef} />
      <CameraRig followRef={followRef} reducedMotion={settings.a11y.motion === "reduced"} />
    </>
  );
}
