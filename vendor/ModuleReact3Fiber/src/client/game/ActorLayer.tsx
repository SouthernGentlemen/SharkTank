import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { SKINS } from "../../engine/index.js";
import type { NetSnake } from "../../protocol/index.js";
import type { RoomSocket } from "../net/useRoomSocket.js";
import type { Settings } from "../settings/SettingsContext.js";
import type { CameraFollowTarget } from "./CameraRig.js";
import { LocalPredictor } from "./prediction.js";
import { resolveSceneQuality } from "./sceneMath.js";
import type { LocalInput } from "./useLocalInput.js";

const MAX_SHARKS = 32;
const MAX_EYES = MAX_SHARKS * 2;
const INTERP_DELAY_MS = 45;

const WHITE = new THREE.Color("#ffffff");
const FALLBACK = new THREE.Color("#33b679");
const EYE_WHITE = new THREE.Color("#ffffff");
const PUPIL = new THREE.Color("#0b0a14");
const skinBody = new Map(SKINS.map((skin) => [skin.id, new THREE.Color(skin.color)]));

export interface SnakeLabel {
  id: string;
  name: string;
  x: number;
  y: number;
  color: string;
  me: boolean;
}

function lerpHead(prev: NetSnake | undefined, cur: NetSnake, alpha: number, out: THREE.Vector3): void {
  const current = cur.segments[0];
  const prior = prev?.segments[0] ?? current;
  out.set(
    prior.x + (current.x - prior.x) * alpha,
    0.5,
    prior.z + (current.z - prior.z) * alpha,
  );
}

export function ActorLayer({
  socket,
  settings,
  labelsRef,
  inputRef,
  followRef,
}: {
  socket: RoomSocket;
  settings: Settings;
  labelsRef?: React.MutableRefObject<SnakeLabel[]>;
  inputRef?: React.MutableRefObject<LocalInput>;
  followRef: React.MutableRefObject<CameraFollowTarget>;
}) {
  const { camera, size } = useThree();
  const sharkMesh = useRef<THREE.InstancedMesh>(null);
  const eyeMesh = useRef<THREE.InstancedMesh>(null);
  const pupilMesh = useRef<THREE.InstancedMesh>(null);
  const predictor = useMemo(() => new LocalPredictor(), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const position = useMemo(() => new THREE.Vector3(), []);
  const projected = useMemo(() => new THREE.Vector3(), []);
  const tempColor = useMemo(() => new THREE.Color(), []);
  const prevById = useMemo(() => new Map<string, NetSnake>(), []);

  useFrame((_, dt) => {
    const sharks = sharkMesh.current;
    const eyes = eyeMesh.current;
    const pupils = pupilMesh.current;
    if (!sharks || !eyes || !pupils) return;

    const frame = socket.frameAt(INTERP_DELAY_MS);
    if (!frame) {
      followRef.current.active = false;
      return;
    }

    const state = frame.newer;
    const previous = frame.older;
    const reducedMotion = settings.a11y.motion === "reduced";
    const alpha = reducedMotion ? 1 : frame.alpha;

    prevById.clear();
    for (const shark of previous.snakes) prevById.set(shark.id, shark);

    const authoritativeMe = socket.stateRef.current?.snakes.find((shark) => shark.id === socket.youId) ?? null;
    const staleness = Math.max(0, (performance.now() - socket.newestAtRef.current) / 1000);
    const predicted = !reducedMotion && inputRef
      ? predictor.step(authoritativeMe, inputRef.current, dt, staleness)
      : null;

    const labels: SnakeLabel[] = [];
    const wantLabels = settings.a11y.colorblindLabels && labelsRef;
    let sharkCount = 0;
    let eyeCount = 0;

    for (const shark of state.snakes) {
      const isMe = shark.id === socket.youId;
      const usePrediction = isMe && predicted != null;
      if (!usePrediction && (!shark.alive || !shark.segments[0])) continue;
      if (sharkCount >= MAX_SHARKS) break;

      const previousShark = prevById.get(shark.id);
      const bodyColor = skinBody.get(shark.skin) ?? FALLBACK;
      const sharkScale = Math.min(2.5, 0.72 + Math.sqrt(shark.length) * 0.12);

      if (usePrediction) {
        position.set(predicted.head.x, 0.5, predicted.head.z);
      } else {
        lerpHead(previousShark, shark, alpha, position);
      }
      const heading = usePrediction ? predicted.heading : shark.heading;

      dummy.position.copy(position);
      dummy.rotation.set(0, -heading, 0);
      dummy.scale.set(sharkScale * 1.75, sharkScale * 0.62, sharkScale * 0.82);
      dummy.updateMatrix();
      sharks.setMatrixAt(sharkCount, dummy.matrix);

      const glow = shark.boosting
        ? Math.min(0.72, 0.25 + (shark.chargeTicks ?? 0) * 0.07)
        : isMe ? 0.18 : 0;
      sharks.setColorAt(
        sharkCount,
        glow ? tempColor.copy(bodyColor).lerp(WHITE, glow) : bodyColor,
      );
      sharkCount += 1;

      if (eyeCount <= MAX_EYES - 2) {
        const forwardX = Math.cos(heading);
        const forwardZ = Math.sin(heading);
        const sideX = -forwardZ;
        const sideZ = forwardX;
        for (const sign of [-1, 1] as const) {
          const eyeX = position.x + forwardX * 0.34 + sideX * sign * 0.34;
          const eyeZ = position.z + forwardZ * 0.34 + sideZ * sign * 0.34;

          dummy.position.set(eyeX, 1.15, eyeZ);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.setScalar(0.26 * sharkScale);
          dummy.updateMatrix();
          eyes.setMatrixAt(eyeCount, dummy.matrix);
          eyes.setColorAt(eyeCount, EYE_WHITE);

          dummy.position.set(eyeX + forwardX * 0.16, 1.24, eyeZ + forwardZ * 0.16);
          dummy.scale.setScalar(0.2);
          dummy.updateMatrix();
          pupils.setMatrixAt(eyeCount, dummy.matrix);
          pupils.setColorAt(eyeCount, PUPIL);
          eyeCount += 1;
        }
      }

      if (wantLabels) {
        projected.copy(position);
        projected.y = 2;
        projected.project(camera);
        if (projected.z < 1) {
          const x = (projected.x * 0.5 + 0.5) * size.width;
          const y = (-projected.y * 0.5 + 0.5) * size.height;
          if (x > -60 && y > -60 && x < size.width + 60 && y < size.height + 60) {
            labels.push({
              id: shark.id,
              name: isMe ? `${shark.name} (you)` : shark.name,
              x: Math.max(52, Math.min(size.width - 52, x)),
              y: Math.max(52, Math.min(size.height - 6, y)),
              color: `#${bodyColor.getHexString()}`,
              me: isMe,
            });
          }
        }
      }
    }

    sharks.count = sharkCount;
    sharks.instanceMatrix.needsUpdate = true;
    if (sharks.instanceColor) sharks.instanceColor.needsUpdate = true;
    eyes.count = eyeCount;
    eyes.instanceMatrix.needsUpdate = true;
    if (eyes.instanceColor) eyes.instanceColor.needsUpdate = true;
    pupils.count = eyeCount;
    pupils.instanceMatrix.needsUpdate = true;
    if (pupils.instanceColor) pupils.instanceColor.needsUpdate = true;

    if (wantLabels && labelsRef) {
      if (labels.length > 11) {
        const middleX = size.width / 2;
        const middleY = size.height / 2;
        labels.sort((a, b) => (
          a.me ? -1
            : b.me ? 1
              : Math.hypot(a.x - middleX, a.y - middleY) - Math.hypot(b.x - middleX, b.y - middleY)
        ));
        labels.length = 11;
      }
      labelsRef.current = labels;
    } else if (labelsRef && labelsRef.current.length) {
      labelsRef.current = [];
    }

    const interpolatedMe = state.snakes.find((shark) => shark.id === socket.youId && shark.alive);
    if (predicted) {
      followRef.current.active = true;
      followRef.current.position.x = predicted.head.x;
      followRef.current.position.y = 0.5;
      followRef.current.position.z = predicted.head.z;
      followRef.current.yaw = predicted.heading;
      followRef.current.pitch = 0;
    } else if (interpolatedMe?.segments[0]) {
      lerpHead(prevById.get(interpolatedMe.id), interpolatedMe, alpha, position);
      followRef.current.active = true;
      followRef.current.position.x = position.x;
      followRef.current.position.y = position.y;
      followRef.current.position.z = position.z;
      followRef.current.yaw = interpolatedMe.heading;
      followRef.current.pitch = 0;
    } else {
      followRef.current.active = false;
    }
  });

  const detail = resolveSceneQuality(settings.graphics.quality).geometryDetail;

  return (
    <>
      <instancedMesh ref={sharkMesh} args={[undefined, undefined, MAX_SHARKS]} frustumCulled={false}>
        <sphereGeometry args={[1, detail, detail]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={eyeMesh} args={[undefined, undefined, MAX_EYES]} frustumCulled={false}>
        <sphereGeometry args={[1, 10, 10]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={pupilMesh} args={[undefined, undefined, MAX_EYES]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </>
  );
}
