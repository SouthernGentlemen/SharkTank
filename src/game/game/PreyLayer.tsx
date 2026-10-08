import { RemotePose } from "./remotePose.js";
import { REMOTE_INTERP_DELAY_MS } from "../net/snapshotTimeline.js";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { PREY_BUDGET, TICKS_PER_SECOND, type PreyKind } from "../../engine/index.js";
import type { NetPrey } from "../../protocol/index.js";
import type { RoomSocket } from "../net/useRoomSocket.js";
import type { Settings } from "../settings/SettingsContext.js";
import { cadenceDue, resolveClientPerformanceProfile } from "./performance.js";
import {
  preyVisualFor,
  preySizeVariation,
  rayWingFlap,
  resolvePreyAnimation,
  resolvePreyPresentationQuality,
} from "./preyPresentation.js";
import { interpolateOrientedPose, type OrientedScenePose } from "./sceneMath.js";


// Shared instance materials use a bounded palette cache, not per-frame Color allocations.
const colorCache = new Map<string, THREE.Color>();
function colorFor(hex: string): THREE.Color {
  let color = colorCache.get(hex);
  if (!color) { color = new THREE.Color(hex); colorCache.set(hex, color); }
  return color;
}

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

function commitInstances(meshes: readonly THREE.InstancedMesh[], count: number): void {
  for (const mesh of meshes) {
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

export function PreyLayer({ socket, settings }: { socket: RoomSocket; settings: Settings }) {
  const bodyMesh = useRef<THREE.InstancedMesh>(null);
  const headMesh = useRef<THREE.InstancedMesh>(null);
  const tailMesh = useRef<THREE.InstancedMesh>(null);
  const stripeOneMesh = useRef<THREE.InstancedMesh>(null);
  const stripeTwoMesh = useRef<THREE.InstancedMesh>(null);
  const dropMesh = useRef<THREE.InstancedMesh>(null);
  const squidMantleMesh = useRef<THREE.InstancedMesh>(null);
  const squidTentacleMesh = useRef<THREE.InstancedMesh>(null);
  const rayBodyMesh = useRef<THREE.InstancedMesh>(null);
  const rayWingMesh = useRef<THREE.InstancedMesh>(null);
  const rayTailMesh = useRef<THREE.InstancedMesh>(null);
  const goldHaloMesh = useRef<THREE.InstancedMesh>(null);
  const goldSparkleMesh = useRef<THREE.InstancedMesh>(null);
  const root = useMemo(() => new THREE.Object3D(), []);
  const part = useMemo(() => new THREE.Object3D(), []);
  const composed = useMemo(() => new THREE.Matrix4(), []);
  const drop = useMemo(() => new THREE.Object3D(), []);
  const remotePoses = useMemo(() => new Map<string, RemotePose>(), []);
  const pose = useMemo<OrientedScenePose>(() => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }), []);
  const previousById = useMemo(() => new Map<string, NetPrey>(), []);
  const quality = resolvePreyPresentationQuality(settings.graphics.quality);
  const performanceProfile = resolveClientPerformanceProfile(settings.graphics.quality);
  const lastPresentationAt = useRef(-Infinity);

  useFrame(({ clock }) => {
    const nowMs = clock.elapsedTime * 1000;
    if (!cadenceDue(lastPresentationAt.current, nowMs, performanceProfile.preyUpdateMs)) return;
    lastPresentationAt.current = nowMs;
    const body = bodyMesh.current;
    const head = headMesh.current;
    const tail = tailMesh.current;
    const stripeOne = stripeOneMesh.current;
    const stripeTwo = stripeTwoMesh.current;
    const drops = dropMesh.current;
    const squidMantle = squidMantleMesh.current;
    const squidTentacles = squidTentacleMesh.current;
    const rayBody = rayBodyMesh.current;
    const rayWings = rayWingMesh.current;
    const rayTail = rayTailMesh.current;
    const goldHalo = goldHaloMesh.current;
    const goldSparkle = goldSparkleMesh.current;
    if (!body || !head || !tail || !stripeOne || !stripeTwo || !drops ||
      !squidMantle || !squidTentacles || !rayBody || !rayWings || !rayTail || !goldHalo || !goldSparkle) return;

    const frame = socket.frameAt(REMOTE_INTERP_DELAY_MS);
    if (!frame) return;
    const current = frame.newer;
    const activeIds = new Set(current.food.map(actor => actor.id));
    for (const id of remotePoses.keys()) {
      if (!activeIds.has(id)) remotePoses.delete(id);
    }
    const previous = frame.older;
    const reducedMotion = settings.a11y.motion === "reduced";
    const alpha = reducedMotion ? 1 : frame.alpha;
    const tickSpan = Math.max(1, current.tick - previous.tick);

    previousById.clear();
    for (const actor of previous.food) previousById.set(actor.id, actor);

    let fishCount = 0;
    let dropCount = 0;
    let squidCount = 0;
    let rayCount = 0;
    let goldCount = 0;
    for (const actor of current.food) {
      const prior = previousById.get(actor.id) ?? actor;
      interpolateOrientedPose(prior, actor, alpha, pose);
      const dx = actor.x - prior.x;
      const dy = actor.y - prior.y;
      const dz = actor.z - prior.z;
      let remote = remotePoses.get(actor.id);
      if (!remote) { remote = new RemotePose(); remotePoses.set(actor.id, remote); }
      const rate = TICKS_PER_SECOND / tickSpan;
      remote.sample(pose, { x: dx * rate, y: dy * rate, z: dz * rate }, frame.extrapolationMs ?? 0, current.tick, performance.now());
      const speed = Math.hypot(dx, dy, dz) * TICKS_PER_SECOND / tickSpan;
      const visual = preyVisualFor(actor.kind, actor.value, actor.r, actor.species);

      const animation = resolvePreyAnimation({
        seconds: clock.elapsedTime,
        id: actor.id,
        speed,
        reducedMotion,
      });
      if (visual.mode === "fish" && visual.shape !== "squid" && visual.shape !== "ray" && fishCount < PREY_BUDGET.max) {
        root.position.set(pose.x, pose.y + animation.wobbleY, pose.z);
        root.rotation.set(0, -pose.yaw, pose.pitch);
        root.scale.setScalar(preySizeVariation(actor.id));
        root.updateMatrix();

        setPartMatrix(
          body, fishCount, root.matrix, part, composed,
          0, 0, 0,
          0, animation.bodyYaw, 0,
          visual.bodyLength, visual.bodyHeight, visual.bodyWidth,
        );
        setPartMatrix(
          head, fishCount, root.matrix, part, composed,
          visual.bodyLength * 0.72, 0.01, 0,
          0, -animation.bodyYaw * 0.5, 0,
          visual.headScale, visual.headScale * 0.9, visual.headScale,
        );
        setPartMatrix(
          tail, fishCount, root.matrix, part, composed,
          -visual.bodyLength * 0.88, 0, 0,
          0, animation.tailYaw, Math.PI / 2,
          visual.tailScale, visual.tailScale * 0.12, visual.tailScale * 0.72,
        );
        // Bands wrap the fish body; zero-scale unused bands avoid extra draw calls.
        for (const [stripeIndex, stripeMesh] of [stripeOne, stripeTwo].entries()) {
          const visible = stripeIndex < visual.stripeCount;
          const stripeX = visual.stripeCount === 1 ? 0 : (stripeIndex === 0 ? -0.32 : 0.30) * visual.bodyLength;
          setPartMatrix(stripeMesh, fishCount, root.matrix, part, composed,
            stripeX, 0, 0, 0, animation.bodyYaw, 0,
            visible ? visual.bodyLength * (visual.stripeCount === 1 ? 0.17 : 0.13) : 0,
            visible ? visual.bodyHeight * 1.04 : 0,
            visible ? visual.bodyWidth * 1.04 : 0);
          stripeMesh.setColorAt(fishCount, colorFor(visual.stripeColor));
        }
        body.setColorAt(fishCount, colorFor(visual.bodyColor));
        head.setColorAt(fishCount, colorFor(visual.headColor));
        tail.setColorAt(fishCount, colorFor(visual.tailColor));
        if (visual.shape === "golden" && goldCount < 1) {
          // The fish keeps its bright palette; separate light/sparkle batches stay rare.
          setPartMatrix(goldHalo, goldCount, root.matrix, part, composed,
            0, 0, 0, 0, 0, 0, visual.bodyLength * 1.3, visual.bodyHeight * 1.6, visual.bodyWidth * 1.6);
          const spin = reducedMotion ? 0 : clock.elapsedTime * 0.9;
          setPartMatrix(goldSparkle, goldCount, root.matrix, part, composed,
            0, visual.bodyHeight + 0.48, 0, 0, 0, spin, 0.18, 0.32, 0.18);
          goldCount += 1;
        }
        fishCount += 1;
      } else if (visual.shape === "squid" && squidCount < PREY_BUDGET.squid) {
        root.position.set(pose.x, pose.y + animation.wobbleY, pose.z);
        root.rotation.set(0, -pose.yaw, pose.pitch);
        root.scale.setScalar(preySizeVariation(actor.id));
        root.updateMatrix();
        // Pointed mantle faces forward; four narrow tentacles trail behind it.
        setPartMatrix(squidMantle, squidCount, root.matrix, part, composed,
          0.2, 0, 0, 0, 0, -Math.PI / 2, 0.38, 0.98, 0.38);
        for (let strand = 0; strand < 4; strand += 1) {
          const around = strand * Math.PI / 2;
          setPartMatrix(squidTentacles, squidCount * 4 + strand, root.matrix, part, composed,
            -0.66, Math.sin(around) * 0.16, Math.cos(around) * 0.16,
            0, 0, Math.PI / 2 + animation.tailYaw * 0.3, 0.055, 0.85, 0.055);
        }
        squidCount += 1;
      } else if (visual.shape === "ray" && rayCount < 16) {
        root.position.set(pose.x, pose.y + animation.wobbleY, pose.z);
        root.rotation.set(0, -pose.yaw, pose.pitch);
        root.scale.setScalar(preySizeVariation(actor.id));
        root.updateMatrix();
        setPartMatrix(rayBody, rayCount, root.matrix, part, composed,
          0.07, 0, 0, 0, 0, 0, 0.74, 0.12, 0.56);
        const flap = rayWingFlap(clock.elapsedTime, actor.id, reducedMotion);
        for (let wing = 0; wing < 2; wing += 1) {
          const sign = wing === 0 ? -1 : 1;
          setPartMatrix(rayWings, rayCount * 2 + wing, root.matrix, part, composed,
            0.03, 0, sign * 0.66, sign * flap, 0, 0, 0.58, 0.075, 0.83);
        }
        setPartMatrix(rayTail, rayCount, root.matrix, part, composed,
          -0.98, 0, 0, 0, 0, Math.PI / 2, 0.055, 1.10, 0.055);
        rayCount += 1;
      } else if (visual.mode === "drop" && dropCount < PREY_BUDGET.max) {
        drop.position.set(pose.x, pose.y, pose.z);
        drop.rotation.set(
          pose.pitch,
          -pose.yaw,
          reducedMotion ? 0 : (clock.elapsedTime * TICKS_PER_SECOND + (actor.id.length % 7)) * 0.025,
        );
        drop.scale.setScalar(visual.dropScale);
        drop.updateMatrix();
        drops.setMatrixAt(dropCount, drop.matrix);
        drops.setColorAt(dropCount, colorFor(visual.bodyColor));
        dropCount += 1;
      }
    }

    commitInstances([body, head, tail, stripeOne, stripeTwo], fishCount);
    commitInstances([drops], dropCount);
    commitInstances([squidMantle], squidCount);
    commitInstances([squidTentacles], squidCount * 4);
    commitInstances([rayBody, rayTail], rayCount);
    commitInstances([rayWings], rayCount * 2);
    commitInstances([goldHalo, goldSparkle], goldCount);
  });

  return (
    <>
      <instancedMesh ref={bodyMesh} args={[undefined, undefined, PREY_BUDGET.max]} frustumCulled={false}>
        <sphereGeometry args={[1, quality.radialSegments, quality.verticalSegments]} />
        <meshStandardMaterial roughness={0.72} metalness={0.02} emissive="#96aec6" emissiveIntensity={0.09} />
      </instancedMesh>
      <instancedMesh ref={headMesh} args={[undefined, undefined, PREY_BUDGET.max]} frustumCulled={false}>
        <sphereGeometry args={[1, quality.radialSegments, quality.verticalSegments]} />
        <meshStandardMaterial roughness={0.68} metalness={0.02} emissive="#96aec6" emissiveIntensity={0.09} />
      </instancedMesh>
      <instancedMesh ref={tailMesh} args={[undefined, undefined, PREY_BUDGET.max]} frustumCulled={false}>
        <coneGeometry args={[1, 1, 3]} />
        <meshStandardMaterial roughness={0.7} metalness={0.02} emissive="#96aec6" emissiveIntensity={0.09} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={stripeOneMesh} args={[undefined, undefined, PREY_BUDGET.max]} frustumCulled={false}>
        <sphereGeometry args={[1, quality.radialSegments, quality.verticalSegments]} />
        <meshStandardMaterial roughness={0.72} emissive="#96aec6" emissiveIntensity={0.09} />
      </instancedMesh>
      <instancedMesh ref={stripeTwoMesh} args={[undefined, undefined, PREY_BUDGET.max]} frustumCulled={false}>
        <sphereGeometry args={[1, quality.radialSegments, quality.verticalSegments]} />
        <meshStandardMaterial roughness={0.72} emissive="#96aec6" emissiveIntensity={0.09} />
      </instancedMesh>
      <instancedMesh ref={squidMantleMesh} args={[undefined, undefined, PREY_BUDGET.squid]} frustumCulled={false}>
        <coneGeometry args={[1, 2, quality.radialSegments]} />
        <meshStandardMaterial color="#d9cee4" roughness={0.6} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={squidTentacleMesh} args={[undefined, undefined, PREY_BUDGET.squid * 4]} frustumCulled={false}>
        <coneGeometry args={[1, 2, 3]} />
        <meshStandardMaterial color="#aa81b7" roughness={0.7} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={rayBodyMesh} args={[undefined, undefined, 16]} frustumCulled={false}>
        <sphereGeometry args={[1, quality.radialSegments, quality.verticalSegments]} />
        <meshStandardMaterial color="#487c8c" roughness={0.8} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={rayWingMesh} args={[undefined, undefined, 32]} frustumCulled={false}>
        <sphereGeometry args={[1, quality.radialSegments, quality.verticalSegments]} />
        <meshStandardMaterial color="#487c8c" roughness={0.8} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={rayTailMesh} args={[undefined, undefined, 16]} frustumCulled={false}>
        <coneGeometry args={[1, 2, 3]} />
        <meshStandardMaterial color="#365968" roughness={0.82} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={goldHaloMesh} args={[undefined, undefined, 1]} frustumCulled={false}>
        <sphereGeometry args={[1, quality.radialSegments, quality.verticalSegments]} />
        <meshBasicMaterial color="#ffd54d" transparent opacity={0.28} depthWrite={false} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={goldSparkleMesh} args={[undefined, undefined, 1]} frustumCulled={false}>
        <octahedronGeometry args={[1, 0]} />
        <meshBasicMaterial color="#fff3b3" transparent opacity={0.94} depthWrite={false} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={dropMesh} args={[undefined, undefined, PREY_BUDGET.max]} frustumCulled={false}>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial roughness={0.82} metalness={0} />
      </instancedMesh>
    </>
  );
}
