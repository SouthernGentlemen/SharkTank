import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import {
  MOVE,
  SKINS,
  TICKS_PER_SECOND,
  shortestYawDelta,
  swimSpeedForLungeTicks,
} from "../../engine/index.js";
import type { NetSnake } from "../../protocol/index.js";
import type { RoomSocket } from "../net/useRoomSocket.js";
import type { Settings } from "../settings/SettingsContext.js";
import type { CameraFollowTarget } from "./CameraRig.js";
import { LocalPredictor } from "./prediction.js";
import {
  advanceBankRoll,
  interpolateOrientedPose,
  type OrientedScenePose,
} from "./sceneMath.js";
import {
  resolveSharkAnimation,
  resolveSharkPresentationQuality,
  sharkScaleForLength,
} from "./sharkPresentation.js";
import type { LocalInput } from "./useLocalInput.js";

const MAX_SHARKS = 32;
const MAX_EYES = MAX_SHARKS * 2;
const INTERP_DELAY_MS = 45;

const WHITE = new THREE.Color("#ffffff");
const FALLBACK = new THREE.Color("#33b679");
const EYE_WHITE = new THREE.Color("#ffffff");
const PUPIL = new THREE.Color("#0b0a14");
const skinBody = new Map(SKINS.map((skin) => [skin.id, new THREE.Color(skin.color)]));

function setPartMatrix(
  mesh: THREE.InstancedMesh,
  index: number,
  rootMatrix: THREE.Matrix4,
  part: THREE.Object3D,
  composed: THREE.Matrix4,
  x: number,
  y: number,
  z: number,
  rotationX: number,
  rotationY: number,
  rotationZ: number,
  scaleX: number,
  scaleY: number,
  scaleZ: number,
): void {
  part.position.set(x, y, z);
  part.rotation.set(rotationX, rotationY, rotationZ);
  part.scale.set(scaleX, scaleY, scaleZ);
  part.updateMatrix();
  composed.multiplyMatrices(rootMatrix, part.matrix);
  mesh.setMatrixAt(index, composed);
}

function setPartColor(
  meshes: readonly THREE.InstancedMesh[],
  index: number,
  color: THREE.Color,
): void {
  for (const mesh of meshes) mesh.setColorAt(index, color);
}

function commitInstances(meshes: readonly THREE.InstancedMesh[], count: number): void {
  for (const mesh of meshes) {
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

export interface SnakeLabel {
  id: string;
  name: string;
  x: number;
  y: number;
  color: string;
  me: boolean;
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
  const bodyMesh = useRef<THREE.InstancedMesh>(null);
  const headMesh = useRef<THREE.InstancedMesh>(null);
  const snoutMesh = useRef<THREE.InstancedMesh>(null);
  const peduncleMesh = useRef<THREE.InstancedMesh>(null);
  const tailFinMesh = useRef<THREE.InstancedMesh>(null);
  const dorsalFinMesh = useRef<THREE.InstancedMesh>(null);
  const pectoralLeftMesh = useRef<THREE.InstancedMesh>(null);
  const pectoralRightMesh = useRef<THREE.InstancedMesh>(null);
  const eyeMesh = useRef<THREE.InstancedMesh>(null);
  const pupilMesh = useRef<THREE.InstancedMesh>(null);
  const predictor = useMemo(() => new LocalPredictor(), []);
  const root = useMemo(() => new THREE.Object3D(), []);
  const part = useMemo(() => new THREE.Object3D(), []);
  const composed = useMemo(() => new THREE.Matrix4(), []);
  const position = useMemo(() => new THREE.Vector3(), []);
  const interpolatedPose = useMemo<OrientedScenePose>(() => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }), []);
  const projected = useMemo(() => new THREE.Vector3(), []);
  const tempColor = useMemo(() => new THREE.Color(), []);
  const prevById = useMemo(() => new Map<string, NetSnake>(), []);
  const motionById = useMemo(() => new Map<string, { yaw: number; roll: number }>(), []);

  useFrame((_, dt) => {
    const body = bodyMesh.current;
    const head = headMesh.current;
    const snout = snoutMesh.current;
    const peduncle = peduncleMesh.current;
    const tailFin = tailFinMesh.current;
    const dorsalFin = dorsalFinMesh.current;
    const pectoralLeft = pectoralLeftMesh.current;
    const pectoralRight = pectoralRightMesh.current;
    const eyes = eyeMesh.current;
    const pupils = pupilMesh.current;
    if (
      !body || !head || !snout || !peduncle || !tailFin || !dorsalFin
      || !pectoralLeft || !pectoralRight || !eyes || !pupils
    ) return;

    const sharkParts = [
      body,
      head,
      snout,
      peduncle,
      tailFin,
      dorsalFin,
      pectoralLeft,
      pectoralRight,
    ] as const;

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
    const predicted = inputRef
      ? predictor.step(authoritativeMe, inputRef.current, dt, staleness, {
          seabedY: state.seabedY,
          surfaceY: state.surfaceY,
          tick: state.tick,
          frenzyUntilTick: state.frenzyUntilTick,
        })
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
      const sharkScale = sharkScaleForLength(shark.length);

      let yaw: number;
      let pitch: number;
      if (usePrediction) {
        position.set(predicted.head.x, predicted.head.y, predicted.head.z);
        yaw = predicted.yaw;
        pitch = predicted.pitch;
      } else {
        const sharkHead = shark.segments[0];
        const priorHead = previousShark?.segments[0] ?? sharkHead;
        interpolateOrientedPose(
          {
            x: priorHead.x,
            y: priorHead.y,
            z: priorHead.z,
            yaw: previousShark?.yaw ?? shark.yaw,
            pitch: previousShark?.pitch ?? shark.pitch,
          },
          {
            x: sharkHead.x,
            y: sharkHead.y,
            z: sharkHead.z,
            yaw: shark.yaw,
            pitch: shark.pitch,
          },
          alpha,
          interpolatedPose,
        );
        position.set(interpolatedPose.x, interpolatedPose.y, interpolatedPose.z);
        yaw = interpolatedPose.yaw;
        pitch = interpolatedPose.pitch;
      }

      const motion = motionById.get(shark.id) ?? { yaw, roll: 0 };
      const yawRate = shortestYawDelta(motion.yaw, yaw) / Math.max(1 / 120, Math.min(0.05, dt));
      motion.roll = advanceBankRoll(motion.roll, yawRate, dt, reducedMotion);
      motion.yaw = yaw;
      motionById.set(shark.id, motion);

      const frenzy = state.frenzyUntilTick > state.tick ? MOVE.FRENZY_SPEED : 1;
      const baseSpeed = MOVE.BASE_SPEED * TICKS_PER_SECOND;
      const boostSpeed = MOVE.BOOST_SPEED * TICKS_PER_SECOND * frenzy;
      const speed = swimSpeedForLungeTicks(shark.lungeTicks) * TICKS_PER_SECOND * frenzy;
      const animation = resolveSharkAnimation({
        tick: state.tick + alpha,
        actorId: shark.id,
        speed,
        baseSpeed,
        boostSpeed,
        boosting: shark.boosting || shark.lungeTicks > 0,
        pitch,
        reducedMotion,
      });

      root.position.copy(position);
      root.rotation.set(motion.roll, -yaw, pitch);
      root.scale.setScalar(sharkScale);
      root.updateMatrix();

      setPartMatrix(
        body, sharkCount, root.matrix, part, composed,
        0, 0, 0,
        0, animation.bodyYaw, 0,
        1.72, 0.58, 0.66,
      );
      setPartMatrix(
        head, sharkCount, root.matrix, part, composed,
        1.42, 0.03, 0,
        0, -animation.bodyYaw * 0.35, 0,
        0.82, 0.59, 0.64,
      );
      setPartMatrix(
        snout, sharkCount, root.matrix, part, composed,
        2.08, -0.04, 0,
        0, -animation.bodyYaw * 0.22, 0,
        0.48, 0.42, 0.52,
      );
      setPartMatrix(
        peduncle, sharkCount, root.matrix, part, composed,
        -1.72, 0, animation.peduncleYaw * 0.18,
        0, animation.peduncleYaw, 0,
        0.76, 0.25, 0.3,
      );
      setPartMatrix(
        tailFin, sharkCount, root.matrix, part, composed,
        -2.45, 0, animation.tailYaw * 0.24,
        0, animation.tailYaw, 0,
        0.23, 0.98, 0.68,
      );
      setPartMatrix(
        dorsalFin, sharkCount, root.matrix, part, composed,
        -0.18, 0.78, 0,
        0, animation.bodyYaw * 0.45, 0,
        0.46, 0.92, 0.25,
      );
      setPartMatrix(
        pectoralLeft, sharkCount, root.matrix, part, composed,
        0.38, -0.2, 0.72,
        Math.PI / 2 - 0.14, 0, -0.22 + animation.pectoralSweep,
        0.36, 0.9, 0.25,
      );
      setPartMatrix(
        pectoralRight, sharkCount, root.matrix, part, composed,
        0.38, -0.2, -0.72,
        -Math.PI / 2 + 0.14, 0, 0.22 - animation.pectoralSweep,
        0.36, 0.9, 0.25,
      );

      const glow = shark.boosting
        ? Math.min(0.72, 0.25 + (shark.chargeTicks ?? 0) * 0.07)
        : isMe ? 0.18 : 0;
      const renderColor = glow ? tempColor.copy(bodyColor).lerp(WHITE, glow) : bodyColor;
      setPartColor(sharkParts, sharkCount, renderColor);
      sharkCount += 1;

      if (eyeCount <= MAX_EYES - 2) {
        for (const sign of [-1, 1] as const) {
          setPartMatrix(
            eyes, eyeCount, root.matrix, part, composed,
            1.74, 0.27, sign * 0.43,
            0, 0, 0,
            0.14, 0.14, 0.14,
          );
          eyes.setColorAt(eyeCount, EYE_WHITE);

          setPartMatrix(
            pupils, eyeCount, root.matrix, part, composed,
            1.86, 0.285, sign * 0.445,
            0, 0, 0,
            0.076, 0.076, 0.076,
          );
          pupils.setColorAt(eyeCount, PUPIL);
          eyeCount += 1;
        }
      }

      if (wantLabels) {
        projected.copy(position);
        projected.y += 1.25 * sharkScale;
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

    commitInstances(sharkParts, sharkCount);
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
      followRef.current.position.y = predicted.head.y;
      followRef.current.position.z = predicted.head.z;
      followRef.current.yaw = predicted.yaw;
      followRef.current.pitch = predicted.pitch;
    } else if (interpolatedMe?.segments[0]) {
      const prior = prevById.get(interpolatedMe.id);
      const sharkHead = interpolatedMe.segments[0];
      const priorHead = prior?.segments[0] ?? sharkHead;
      interpolateOrientedPose(
        {
          x: priorHead.x,
          y: priorHead.y,
          z: priorHead.z,
          yaw: prior?.yaw ?? interpolatedMe.yaw,
          pitch: prior?.pitch ?? interpolatedMe.pitch,
        },
        {
          x: sharkHead.x,
          y: sharkHead.y,
          z: sharkHead.z,
          yaw: interpolatedMe.yaw,
          pitch: interpolatedMe.pitch,
        },
        alpha,
        interpolatedPose,
      );
      followRef.current.active = true;
      followRef.current.position.x = interpolatedPose.x;
      followRef.current.position.y = interpolatedPose.y;
      followRef.current.position.z = interpolatedPose.z;
      followRef.current.yaw = interpolatedPose.yaw;
      followRef.current.pitch = interpolatedPose.pitch;
    } else {
      followRef.current.active = false;
    }

    if (followRef.current.active) {
      const local = authoritativeMe ?? interpolatedMe;
      if (local) {
        const baseSpeed = MOVE.BASE_SPEED * TICKS_PER_SECOND;
        const boostSpeed = MOVE.BOOST_SPEED * TICKS_PER_SECOND;
        const frenzy = state.frenzyUntilTick > state.tick ? MOVE.FRENZY_SPEED : 1;
        followRef.current.sharkScale = sharkScaleForLength(local.length);
        followRef.current.speed = swimSpeedForLungeTicks(local.lungeTicks) * TICKS_PER_SECOND * frenzy;
        followRef.current.baseSpeed = baseSpeed;
        followRef.current.boostSpeed = boostSpeed * frenzy;
        followRef.current.arenaRadius = state.arenaRadius;
        followRef.current.seabedY = state.seabedY;
        followRef.current.surfaceY = state.surfaceY;
      }
    }
  });

  const sharkQuality = resolveSharkPresentationQuality(settings.graphics.quality);

  return (
    <>
      <instancedMesh ref={bodyMesh} args={[undefined, undefined, MAX_SHARKS]} frustumCulled={false}>
        <sphereGeometry args={[1, sharkQuality.radialSegments, sharkQuality.radialSegments]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={headMesh} args={[undefined, undefined, MAX_SHARKS]} frustumCulled={false}>
        <sphereGeometry args={[1, sharkQuality.radialSegments, sharkQuality.radialSegments]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={snoutMesh} args={[undefined, undefined, MAX_SHARKS]} frustumCulled={false}>
        <sphereGeometry args={[1, sharkQuality.radialSegments, sharkQuality.radialSegments]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={peduncleMesh} args={[undefined, undefined, MAX_SHARKS]} frustumCulled={false}>
        <sphereGeometry args={[1, sharkQuality.radialSegments, sharkQuality.radialSegments]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={tailFinMesh} args={[undefined, undefined, MAX_SHARKS]} frustumCulled={false}>
        <coneGeometry args={[1, 1, 3]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={dorsalFinMesh} args={[undefined, undefined, MAX_SHARKS]} frustumCulled={false}>
        <coneGeometry args={[1, 1, 3]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={pectoralLeftMesh} args={[undefined, undefined, MAX_SHARKS]} frustumCulled={false}>
        <coneGeometry args={[1, 1, 3]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={pectoralRightMesh} args={[undefined, undefined, MAX_SHARKS]} frustumCulled={false}>
        <coneGeometry args={[1, 1, 3]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={eyeMesh} args={[undefined, undefined, MAX_EYES]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={pupilMesh} args={[undefined, undefined, MAX_EYES]} frustumCulled={false}>
        <sphereGeometry args={[1, 6, 6]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </>
  );
}
