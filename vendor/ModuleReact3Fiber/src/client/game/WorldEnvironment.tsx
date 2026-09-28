import * as THREE from "three";
import type { Settings } from "../settings/SettingsContext.js";
import { OCEAN_CUES, resolveSceneQuality } from "./sceneMath.js";

const BACKGROUND = "#06131f";
const FOG = "#0b2432";
const SEABED = "#13202a";
const SURFACE = "#6bb7c8";
const DEPTH_REFERENCE = "#3e6675";

function DepthReference({ x, z }: { x: number; z: number }) {
  const height = OCEAN_CUES.surfaceY - OCEAN_CUES.seabedY;
  return (
    <group position={[x, 0, z]}>
      <mesh>
        <cylinderGeometry args={[0.06, 0.06, height, 8]} />
        <meshBasicMaterial color={DEPTH_REFERENCE} transparent opacity={0.32} />
      </mesh>
      {[-8, -4, 0, 4, 8].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.65, 0.72, 16]} />
          <meshBasicMaterial color={DEPTH_REFERENCE} transparent opacity={0.42} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

export function WorldEnvironment({ settings }: { settings: Settings }) {
  const quality = resolveSceneQuality(settings.graphics.quality);
  const radius = OCEAN_CUES.horizontalRadius;
  const refs = OCEAN_CUES.depthReferenceRadius;

  return (
    <>
      <color attach="background" args={[BACKGROUND]} />
      <fog attach="fog" args={[FOG, quality.fogNear, quality.fogFar]} />
      <ambientLight intensity={0.72} />
      <directionalLight position={[18, 28, 12]} intensity={0.78} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, OCEAN_CUES.seabedY, 0]}>
        <circleGeometry args={[radius, quality.ringSegments]} />
        <meshStandardMaterial color={SEABED} roughness={1} metalness={0} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, OCEAN_CUES.surfaceY, 0]}>
        <circleGeometry args={[radius, quality.ringSegments]} />
        <meshBasicMaterial
          color={SURFACE}
          transparent
          opacity={0.08}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {settings.graphics.showGrid && settings.a11y.motion !== "reduced" && (
        <gridHelper
          args={[radius * 2, 80, "#315363", "#1d3440"]}
          position={[0, OCEAN_CUES.seabedY + 0.03, 0]}
        />
      )}

      <DepthReference x={refs} z={0} />
      <DepthReference x={-refs} z={0} />
      <DepthReference x={0} z={refs} />
      <DepthReference x={0} z={-refs} />
    </>
  );
}
