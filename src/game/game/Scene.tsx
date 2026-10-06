// Browser-only React Three Fiber composition for the production full-3D game world.
// It presents authoritative volumetric state without moving gameplay authority into Three.js.

import { useRef } from "react";
import type { RoomSocket } from "../net/useRoomSocket.js";
import type { Settings } from "../settings/SettingsContext.js";
import { ActorLayer, type SharkLabel } from "./ActorLayer.js";
import { CameraRig, makeCameraFollowTarget } from "./CameraRig.js";
import { FxLayer } from "./FxLayer.js";
import { PreyLayer } from "./PreyLayer.js";
import { WorldEnvironment } from "./WorldEnvironment.js";
import type { LocalInput } from "./useLocalInput.js";

export type { SharkLabel } from "./ActorLayer.js";

export function Scene({
  socket,
  settings,
  labelsRef,
  inputRef,
}: {
  socket: RoomSocket;
  settings: Settings;
  labelsRef?: React.MutableRefObject<SharkLabel[]>;
  inputRef?: React.MutableRefObject<LocalInput>;
}) {
  const followRef = useRef(makeCameraFollowTarget());

  return (
    <>
      <WorldEnvironment socket={socket} settings={settings} />
      <ActorLayer
        socket={socket}
        settings={settings}
        labelsRef={labelsRef}
        inputRef={inputRef}
        followRef={followRef}
      />
      <PreyLayer socket={socket} settings={settings} />
      <FxLayer socket={socket} settings={settings} />
      <CameraRig followRef={followRef} reducedMotion={settings.a11y.motion === "reduced"} inputRef={inputRef} />
    </>
  );
}
