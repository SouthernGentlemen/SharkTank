// The production React Three Fiber world. ST-110 intentionally preserves the current
// planar X/Z mechanics while moving every gameplay rendering cue off Canvas2D. The
// server remains authoritative; this scene only predicts the local shark and interpolates
// snapshots for presentation.

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { SKINS } from "../../engine/index.js";
import type { NetSnake, RocketProjectile } from "../../protocol/index.js";
import type { RoomSocket } from "../net/useRoomSocket.js";
import type { Settings } from "../settings/SettingsContext.js";
import { LocalPredictor } from "./prediction.js";
import type { LocalInput } from "./useLocalInput.js";

const MAX_SHARKS = 32;
const MAX_FOOD = 620;
const MAX_EYES = MAX_SHARKS * 2;
const MAX_ROCKETS = 64;
const MAX_BURST_PARTICLES = 512;
const INTERP_DELAY_MS = 45;
const EXPLOSION_RENDER_TICKS = 24;
const EDGE_WARNING_RANGE = 14;

const WHITE = new THREE.Color("#ffffff");
const FALLBACK = new THREE.Color("#33b679");
const EYE_WHITE = new THREE.Color("#ffffff");
const PUPIL = new THREE.Color("#0b0a14");
const FOOD_CYAN = new THREE.Color("#22e6ff");
const FOOD_YELLOW = new THREE.Color("#ffd54a");
const FOOD_RICH = new THREE.Color("#ff8a1f");
const ROCKET_COLOR = new THREE.Color("#f3f1ff");
const BOUNDARY_SAFE = new THREE.Color("#22e6ff");
const BOUNDARY_DANGER = new THREE.Color("#ff6b6b");
const FRENZY_COLOR = new THREE.Color("#ff8a1f");
const skinBody = new Map(SKINS.map((skin) => [skin.id, new THREE.Color(skin.color)]));

/** Projected on-screen label for a shark head (colorblind name cue). */
export interface SnakeLabel {
  id: string;
  name: string;
  x: number;
  y: number;
  color: string;
  me: boolean;
}

function lerpSeg(prev: NetSnake | undefined, cur: NetSnake, i: number, alpha: number, out: THREE.Vector3): void {
  const current = cur.segments[i];
  const prior = prev?.segments[i] ?? current;
  out.set(
    prior.x + (current.x - prior.x) * alpha,
    0.5,
    prior.z + (current.z - prior.z) * alpha,
  );
}

function hash(value: string): number {
  let out = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    out ^= value.charCodeAt(i);
    out = Math.imul(out, 16777619);
  }
  return out >>> 0;
}

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
  const { camera, size } = useThree();
  const sharkMesh = useRef<THREE.InstancedMesh>(null);
  const foodMesh = useRef<THREE.InstancedMesh>(null);
  const eyeMesh = useRef<THREE.InstancedMesh>(null);
  const pupilMesh = useRef<THREE.InstancedMesh>(null);
  const rocketMesh = useRef<THREE.InstancedMesh>(null);
  const burstMesh = useRef<THREE.InstancedMesh>(null);
  const boundaryRef = useRef<THREE.Mesh>(null);
  const boundaryMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const frenzyRef = useRef<THREE.Mesh>(null);
  const frenzyMaterialRef = useRef<THREE.MeshBasicMaterial>(null);

  const predictor = useMemo(() => new LocalPredictor(), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const camTarget = useMemo(() => new THREE.Vector3(), []);
  const position = useMemo(() => new THREE.Vector3(), []);
  const projected = useMemo(() => new THREE.Vector3(), []);
  const tempColor = useMemo(() => new THREE.Color(), []);
  const prevById = useMemo(() => new Map<string, NetSnake>(), []);
  const prevRocketById = useMemo(() => new Map<string, RocketProjectile>(), []);

  useFrame((_, dt) => {
    const sharks = sharkMesh.current;
    const food = foodMesh.current;
    const eyes = eyeMesh.current;
    const pupils = pupilMesh.current;
    const rockets = rocketMesh.current;
    const bursts = burstMesh.current;
    if (!sharks || !food || !eyes || !pupils || !rockets || !bursts) return;

    const frame = socket.frameAt(INTERP_DELAY_MS);
    if (!frame) return;

    const state = frame.newer;
    const previous = frame.older;
    const reducedMotion = settings.a11y.motion === "reduced";
    const alpha = reducedMotion ? 1 : frame.alpha;

    prevById.clear();
    for (const shark of previous.snakes) prevById.set(shark.id, shark);
    prevRocketById.clear();
    for (const rocket of previous.rockets ?? []) prevRocketById.set(rocket.id, rocket);

    if (boundaryRef.current) boundaryRef.current.scale.setScalar(state.arenaRadius);

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
        lerpSeg(previousShark, shark, 0, alpha, position);
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

    let foodCount = 0;
    for (let i = 0; i < state.food.length && foodCount < MAX_FOOD; i += 1) {
      const pellet = state.food[i];
      dummy.position.set(pellet.x, 0.4, pellet.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(Math.max(0.22, pellet.r * 0.85));
      dummy.updateMatrix();
      food.setMatrixAt(foodCount, dummy.matrix);
      food.setColorAt(
        foodCount,
        pellet.value > 1 ? FOOD_RICH : i % 3 === 0 ? FOOD_CYAN : FOOD_YELLOW,
      );
      foodCount += 1;
    }
    food.count = foodCount;
    food.instanceMatrix.needsUpdate = true;
    if (food.instanceColor) food.instanceColor.needsUpdate = true;

    let rocketCount = 0;
    for (const rocket of state.rockets ?? []) {
      if (rocketCount >= MAX_ROCKETS) break;
      const prior = prevRocketById.get(rocket.id) ?? rocket;
      const x = prior.x + (rocket.x - prior.x) * alpha;
      const z = prior.z + (rocket.z - prior.z) * alpha;
      dummy.position.set(x, 0.7, z);
      dummy.rotation.set(0, -rocket.heading, 0);
      dummy.scale.set(1.05, 1, 1);
      dummy.updateMatrix();
      rockets.setMatrixAt(rocketCount, dummy.matrix);
      rockets.setColorAt(rocketCount, ROCKET_COLOR);
      rocketCount += 1;
    }
    rockets.count = rocketCount;
    rockets.instanceMatrix.needsUpdate = true;
    if (rockets.instanceColor) rockets.instanceColor.needsUpdate = true;

    let burstCount = 0;
    const renderTick = state.tick + alpha;
    for (const burst of state.explosions ?? []) {
      const life = Math.max(0, Math.min(1, (renderTick - burst.tick) / EXPLOSION_RENDER_TICKS));
      const particleCount = burst.kind === "shark" ? 38 : 18;
      const baseColor = skinBody.get(burst.skin) ?? (burst.kind === "rocket" ? FOOD_RICH : FOOD_CYAN);

      for (let i = 0; i < particleCount && burstCount < MAX_BURST_PARTICLES; i += 1) {
        const seed = hash(`${burst.id}-${i}`);
        const angle = (seed % 6283) / 1000;
        const speed = 0.15 + ((seed >>> 9) % 100) / 115;
        const travel = reducedMotion ? 2.2 : life * speed * (burst.kind === "shark" ? 13 : 8);
        const rise = reducedMotion ? 0.15 : life * (((seed >>> 15) % 11) - 5) * 0.09;
        dummy.position.set(
          burst.x + Math.cos(angle) * travel,
          0.7 + rise,
          burst.z + Math.sin(angle) * travel,
        );
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(Math.max(0.05, (1 - life) * (0.16 + (seed % 5) * 0.035)));
        dummy.updateMatrix();
        bursts.setMatrixAt(burstCount, dummy.matrix);
        const highlight = i % 4 === 0 ? WHITE : i % 3 === 0 ? FOOD_YELLOW : baseColor;
        bursts.setColorAt(burstCount, highlight);
        burstCount += 1;
      }
      if (burstCount >= MAX_BURST_PARTICLES) break;
    }
    bursts.count = burstCount;
    bursts.instanceMatrix.needsUpdate = true;
    if (bursts.instanceColor) bursts.instanceColor.needsUpdate = true;

    const latestLocal = predicted?.head ?? authoritativeMe?.segments[0] ?? null;
    if (boundaryMaterialRef.current && latestLocal) {
      const margin = state.arenaRadius - Math.hypot(latestLocal.x, latestLocal.z);
      const danger = Math.max(0, Math.min(1, 1 - margin / EDGE_WARNING_RANGE));
      boundaryMaterialRef.current.color.copy(tempColor.copy(BOUNDARY_SAFE).lerp(BOUNDARY_DANGER, danger));
      boundaryMaterialRef.current.opacity = 0.58 + danger * 0.42;
    }

    const frenzyOn = state.frenzyUntilTick > state.tick;
    if (frenzyRef.current) {
      frenzyRef.current.visible = frenzyOn;
      if (frenzyOn && !reducedMotion) frenzyRef.current.rotation.z += dt * 0.24;
    }
    if (frenzyMaterialRef.current) {
      frenzyMaterialRef.current.opacity = frenzyOn
        ? reducedMotion ? 0.14 : 0.1 + Math.sin(performance.now() / 260) * 0.04
        : 0;
    }

    const interpolatedMe = state.snakes.find((shark) => shark.id === socket.youId && shark.alive);
    if (predicted) {
      position.set(predicted.head.x, 0.5, predicted.head.z);
    } else if (interpolatedMe?.segments[0]) {
      lerpSeg(prevById.get(interpolatedMe.id), interpolatedMe, 0, alpha, position);
    }

    if (predicted || interpolatedMe?.segments[0]) {
      camTarget.set(position.x, 26, position.z + 12);
      camera.position.lerp(camTarget, reducedMotion ? 1 : 0.12);
      camera.lookAt(position.x, 0, position.z);
    } else {
      camTarget.set(0, 42, 18);
      camera.position.lerp(camTarget, reducedMotion ? 1 : 0.05);
      camera.lookAt(0, 0, 0);
    }
  });

  const quality = settings.graphics.quality;
  const detail = quality === "low" ? 6 : quality === "medium" ? 8 : 12;

  return (
    <>
      <color attach="background" args={["#050d16"]} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[10, 20, 6]} intensity={0.6} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <circleGeometry args={[400, 64]} />
        <meshBasicMaterial color="#0c0b18" />
      </mesh>

      {settings.graphics.showGrid && settings.a11y.motion !== "reduced" && (
        <gridHelper args={[400, 80, "#312c58", "#1c1836"]} position={[0, 0, 0]} />
      )}

      <mesh ref={frenzyRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} visible={false}>
        <ringGeometry args={[8, 22, 96]} />
        <meshBasicMaterial
          ref={frenzyMaterialRef}
          color={FRENZY_COLOR}
          transparent
          opacity={0}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      <mesh ref={boundaryRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[0.965, 1, 128]} />
        <meshBasicMaterial
          ref={boundaryMaterialRef}
          color={BOUNDARY_SAFE}
          transparent
          opacity={0.62}
          side={THREE.DoubleSide}
        />
      </mesh>

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

      <instancedMesh ref={foodMesh} args={[undefined, undefined, MAX_FOOD]} frustumCulled={false}>
        <icosahedronGeometry args={[1, 0]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      <instancedMesh ref={rocketMesh} args={[undefined, undefined, MAX_ROCKETS]} frustumCulled={false}>
        <boxGeometry args={[2.2, 0.45, 0.7]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      <instancedMesh ref={burstMesh} args={[undefined, undefined, MAX_BURST_PARTICLES]} frustumCulled={false}>
        <icosahedronGeometry args={[1, 0]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </>
  );
}
