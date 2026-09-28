import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { SKINS } from "../../engine/index.js";
import type { RocketProjectile } from "../../protocol/index.js";
import type { RoomSocket } from "../net/useRoomSocket.js";
import type { Settings } from "../settings/SettingsContext.js";
import type { CameraFollowTarget } from "./CameraRig.js";
import { resolveSceneQuality } from "./sceneMath.js";

const MAX_ROCKETS = 64;
const MAX_BURST_PARTICLES = 512;
const INTERP_DELAY_MS = 45;
const EXPLOSION_RENDER_TICKS = 24;
const EDGE_WARNING_RANGE = 14;

const WHITE = new THREE.Color("#ffffff");
const FOOD_CYAN = new THREE.Color("#22e6ff");
const FOOD_YELLOW = new THREE.Color("#ffd54a");
const FOOD_RICH = new THREE.Color("#ff8a1f");
const ROCKET_COLOR = new THREE.Color("#f3f1ff");
const BOUNDARY_SAFE = new THREE.Color("#22e6ff");
const BOUNDARY_DANGER = new THREE.Color("#ff6b6b");
const FRENZY_COLOR = new THREE.Color("#ff8a1f");
const skinBody = new Map(SKINS.map((skin) => [skin.id, new THREE.Color(skin.color)]));

function hash(value: string): number {
  let out = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    out ^= value.charCodeAt(i);
    out = Math.imul(out, 16777619);
  }
  return out >>> 0;
}

export function FxLayer({
  socket,
  settings,
  followRef,
}: {
  socket: RoomSocket;
  settings: Settings;
  followRef: React.MutableRefObject<CameraFollowTarget>;
}) {
  const rocketMesh = useRef<THREE.InstancedMesh>(null);
  const burstMesh = useRef<THREE.InstancedMesh>(null);
  const boundaryRef = useRef<THREE.Mesh>(null);
  const boundaryMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const frenzyRef = useRef<THREE.Mesh>(null);
  const frenzyMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tempColor = useMemo(() => new THREE.Color(), []);
  const prevRocketById = useMemo(() => new Map<string, RocketProjectile>(), []);
  const quality = resolveSceneQuality(settings.graphics.quality);

  useFrame((_, dt) => {
    const rockets = rocketMesh.current;
    const bursts = burstMesh.current;
    if (!rockets || !bursts) return;

    const frame = socket.frameAt(INTERP_DELAY_MS);
    if (!frame) return;
    const state = frame.newer;
    const previous = frame.older;
    const reducedMotion = settings.a11y.motion === "reduced";
    const alpha = reducedMotion ? 1 : frame.alpha;

    prevRocketById.clear();
    for (const rocket of previous.rockets ?? []) prevRocketById.set(rocket.id, rocket);

    if (boundaryRef.current) boundaryRef.current.scale.setScalar(state.arenaRadius);

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

      for (let i = 0; i < particleCount && burstCount < quality.burstParticleBudget; i += 1) {
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
      if (burstCount >= quality.burstParticleBudget) break;
    }
    bursts.count = burstCount;
    bursts.instanceMatrix.needsUpdate = true;
    if (bursts.instanceColor) bursts.instanceColor.needsUpdate = true;

    if (boundaryMaterialRef.current && followRef.current.active) {
      const local = followRef.current.position;
      const margin = state.arenaRadius - Math.hypot(local.x, local.z);
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
  });

  return (
    <>
      <mesh ref={frenzyRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} visible={false}>
        <ringGeometry args={[8, 22, quality.ringSegments]} />
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
        <ringGeometry args={[0.965, 1, quality.ringSegments]} />
        <meshBasicMaterial
          ref={boundaryMaterialRef}
          color={BOUNDARY_SAFE}
          transparent
          opacity={0.62}
          side={THREE.DoubleSide}
        />
      </mesh>

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
