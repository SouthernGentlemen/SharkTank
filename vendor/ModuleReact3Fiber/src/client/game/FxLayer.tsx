import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { SKINS } from "../../engine/index.js";
import type { RoomSocket } from "../net/useRoomSocket.js";
import type { Settings } from "../settings/SettingsContext.js";
import { cadenceDue, resolveClientPerformanceProfile } from "./performance.js";
import { resolveSceneQuality } from "./sceneMath.js";

const MAX_BURST_PARTICLES = 512;
const INTERP_DELAY_MS = 45;
const EXPLOSION_RENDER_TICKS = 24;

const WHITE = new THREE.Color("#ffffff");
const FOOD_CYAN = new THREE.Color("#22e6ff");
const FOOD_YELLOW = new THREE.Color("#ffd54a");
const FOOD_RICH = new THREE.Color("#ff8a1f");
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
}: {
  socket: RoomSocket;
  settings: Settings;
}) {
  const burstMesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const seedCache = useMemo(() => new Map<string, number>(), []);
  const quality = resolveSceneQuality(settings.graphics.quality);
  const performanceProfile = resolveClientPerformanceProfile(settings.graphics.quality);
  const lastBurstPassAt = useRef(-Infinity);

  useFrame(({ clock }) => {
    const bursts = burstMesh.current;
    if (!bursts) return;

    const frame = socket.frameAt(INTERP_DELAY_MS);
    if (!frame) return;
    const state = frame.newer;
    const reducedMotion = settings.a11y.motion === "reduced";
    const alpha = reducedMotion ? 1 : frame.alpha;

    const nowMs = clock.elapsedTime * 1000;
    if (cadenceDue(lastBurstPassAt.current, nowMs, performanceProfile.effectUpdateMs)) {
      lastBurstPassAt.current = nowMs;
      let burstCount = 0;
      const renderTick = state.tick + alpha;
      for (const burst of state.explosions ?? []) {
        const life = Math.max(0, Math.min(1, (renderTick - burst.tick) / EXPLOSION_RENDER_TICKS));
        const particleCount = burst.kind === "shark" ? 38 : burst.kind === "bite" ? 12 : 18;
        const baseColor = skinBody.get(burst.skin) ?? (burst.kind === "frenzy" ? FOOD_RICH : FOOD_CYAN);
        let burstSeed = seedCache.get(burst.id);
        if (burstSeed === undefined) {
          if (seedCache.size >= 256) seedCache.clear();
          burstSeed = hash(burst.id);
          seedCache.set(burst.id, burstSeed);
        }

        for (let i = 0; i < particleCount && burstCount < quality.burstParticleBudget; i += 1) {
          let seed = burstSeed ^ Math.imul(i + 1, 0x45d9f3b);
          seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b) >>> 0;
          const angle = (seed % 6283) / 1000;
          const speed = 0.15 + ((seed >>> 9) % 100) / 115;
          const travel = reducedMotion ? 0.35 : life * speed * (burst.kind === "shark" ? 13 : burst.kind === "bite" ? 3.2 : 8);
          const rise = reducedMotion ? 0.15 : life * (((seed >>> 15) % 11) - 5) * 0.09;
          dummy.position.set(
            burst.x + Math.cos(angle) * travel,
            burst.y + rise,
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
    }
  });

  return (
    <instancedMesh ref={burstMesh} args={[undefined, undefined, MAX_BURST_PARTICLES]} frustumCulled={false}>
      <icosahedronGeometry args={[1, 0]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}
