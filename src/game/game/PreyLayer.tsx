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
  resolvePreyAnimation,
  resolvePreyPresentationQuality,
} from "./preyPresentation.js";
import { interpolateOrientedPose, type OrientedScenePose } from "./sceneMath.js";


const BAIT_COLOR = new THREE.Color("#7ee7ff");
const REEF_COLOR = new THREE.Color("#ffd166");
const CHUM_COLOR = new THREE.Color("#ff9b54");
const CARCASS_COLOR = new THREE.Color("#d88b64");

const preyColor: Record<PreyKind, THREE.Color> = {
  bait: BAIT_COLOR,
  reef: REEF_COLOR,
  chum: CHUM_COLOR,
  carcass: CARCASS_COLOR,
};

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
  const dropMesh = useRef<THREE.InstancedMesh>(null);
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
    const drops = dropMesh.current;
    if (!body || !head || !tail || !drops) return;

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
      const visual = preyVisualFor(actor.kind, actor.value, actor.r);
      const color = preyColor[actor.kind];

      if (visual.mode === "fish" && fishCount < PREY_BUDGET.max) {
        const animation = resolvePreyAnimation({
          tick: current.tick + alpha,
          id: actor.id,
          speed,
          reducedMotion,
        });
        root.position.set(pose.x, pose.y, pose.z);
        root.rotation.set(0, -pose.yaw, pose.pitch);
        root.scale.setScalar(1);
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
        body.setColorAt(fishCount, color);
        head.setColorAt(fishCount, color);
        tail.setColorAt(fishCount, color);
        fishCount += 1;
      } else if (visual.mode === "drop" && dropCount < PREY_BUDGET.max) {
        drop.position.set(pose.x, pose.y, pose.z);
        drop.rotation.set(
          pose.pitch,
          -pose.yaw,
          reducedMotion ? 0 : (current.tick + (actor.id.length % 7)) * 0.025,
        );
        drop.scale.setScalar(visual.dropScale);
        drop.updateMatrix();
        drops.setMatrixAt(dropCount, drop.matrix);
        drops.setColorAt(dropCount, color);
        dropCount += 1;
      }
    }

    commitInstances([body, head, tail], fishCount);
    commitInstances([drops], dropCount);
  });

  return (
    <>
      <instancedMesh ref={bodyMesh} args={[undefined, undefined, PREY_BUDGET.max]} frustumCulled={false}>
        <sphereGeometry args={[1, quality.radialSegments, quality.verticalSegments]} />
        <meshStandardMaterial roughness={0.72} metalness={0.02} />
      </instancedMesh>
      <instancedMesh ref={headMesh} args={[undefined, undefined, PREY_BUDGET.max]} frustumCulled={false}>
        <sphereGeometry args={[1, quality.radialSegments, quality.verticalSegments]} />
        <meshStandardMaterial roughness={0.68} metalness={0.02} />
      </instancedMesh>
      <instancedMesh ref={tailMesh} args={[undefined, undefined, PREY_BUDGET.max]} frustumCulled={false}>
        <coneGeometry args={[1, 1, 3]} />
        <meshStandardMaterial roughness={0.7} metalness={0.02} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={dropMesh} args={[undefined, undefined, PREY_BUDGET.max]} frustumCulled={false}>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial roughness={0.82} metalness={0} />
      </instancedMesh>
    </>
  );
}
