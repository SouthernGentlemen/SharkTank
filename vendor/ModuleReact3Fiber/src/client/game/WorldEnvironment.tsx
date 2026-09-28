import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { RoomSocket } from "../net/useRoomSocket.js";
import type { Settings } from "../settings/SettingsContext.js";
import {
  ENVIRONMENT_LANDMARKS,
  makeEnvironmentSeeds,
  resolveOceanArenaCues,
  resolveOceanEnvironmentQuality,
} from "./oceanArena.js";
import { OCEAN_CUES, resolveSceneQuality } from "./sceneMath.js";

const BACKGROUND = "#042737";
const FOG = "#0b4a5a";
const SEABED = "#174b4f";
const SEABED_ACCENT = "#2d7b72";
const SURFACE = "#7ee6ee";
const SURFACE_ACCENT = "#c2fbf7";
const BOUNDARY = "#45e7e0";
const BOUNDARY_DANGER = "#ff8d66";
const PARTICULATE = "#9ee7dd";
const BUBBLE = "#c8fbff";
const REEF = "#245d58";
const REEF_ACCENT = "#3e8d76";
const WRECK = "#704f42";
const WRECK_ACCENT = "#c07c57";
const FRENZY = "#ffb347";
const FRENZY_ACTIVE = "#ffe46b";

const BOUNDARY_MARKER_COUNT = 12;
const LIGHT_SHAFT_LAYOUT = [
  { angle: -0.9, radialShare: 0.35, scale: 1.1 },
  { angle: 1.75, radialShare: 0.48, scale: 0.88 },
  { angle: 0.4, radialShare: 0.62, scale: 0.72 },
] as const;

function placeRadial(
  object: THREE.Object3D | null,
  angle: number,
  radialShare: number,
  radius: number,
  y: number,
): void {
  if (!object) return;
  object.position.set(
    Math.cos(angle) * radius * radialShare,
    y,
    Math.sin(angle) * radius * radialShare,
  );
}

function ReefFormation() {
  return (
    <group>
      <mesh position={[-2.6, 1.6, -1.2]} rotation={[0.1, 0.2, -0.08]}>
        <dodecahedronGeometry args={[3.5, 0]} />
        <meshStandardMaterial color={REEF} roughness={0.92} metalness={0} />
      </mesh>
      <mesh position={[1.7, 2.6, 0.5]} rotation={[0.15, -0.5, 0.05]}>
        <coneGeometry args={[2.6, 6.5, 7]} />
        <meshStandardMaterial color={REEF_ACCENT} roughness={0.9} metalness={0} />
      </mesh>
      <mesh position={[3.9, 1.2, -1.3]} rotation={[0.35, 0.4, 0.2]}>
        <dodecahedronGeometry args={[2.2, 0]} />
        <meshStandardMaterial color={REEF} roughness={1} metalness={0} />
      </mesh>
    </group>
  );
}

function WreckLandmark() {
  return (
    <group rotation={[0.06, -0.38, -0.08]}>
      <mesh position={[0, 1.1, 0]}>
        <boxGeometry args={[11, 2.2, 4.4]} />
        <meshStandardMaterial color={WRECK} roughness={0.88} metalness={0.08} />
      </mesh>
      <mesh position={[-1.2, 4.7, 0]}>
        <boxGeometry args={[0.45, 7.4, 0.45]} />
        <meshStandardMaterial color={WRECK_ACCENT} roughness={0.8} metalness={0.06} />
      </mesh>
      <mesh position={[-1.2, 6.8, 0]} rotation={[0, 0, Math.PI / 2]}>
        <boxGeometry args={[5.2, 0.32, 0.32]} />
        <meshStandardMaterial color={WRECK_ACCENT} roughness={0.8} metalness={0.06} />
      </mesh>
      {[-4.3, -2.2, 0, 2.2, 4.3].map((x) => (
        <mesh key={x} position={[x, 2.5, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[2.25, 0.24, 6, 12, Math.PI]} />
          <meshStandardMaterial color={WRECK_ACCENT} roughness={0.82} metalness={0.05} />
        </mesh>
      ))}
    </group>
  );
}

export function WorldEnvironment({ socket, settings }: { socket: RoomSocket; settings: Settings }) {
  const sceneQuality = resolveSceneQuality(settings.graphics.quality);
  const environmentQuality = resolveOceanEnvironmentQuality(settings.graphics.quality);
  const reducedMotion = settings.a11y.motion === "reduced";
  const fallback = resolveOceanArenaCues({
    arenaRadius: OCEAN_CUES.horizontalRadius,
    seabedY: OCEAN_CUES.seabedY,
    surfaceY: OCEAN_CUES.surfaceY,
  });

  const surfaceRef = useRef<THREE.Mesh>(null);
  const seabedRef = useRef<THREE.Mesh>(null);
  const seabedCuesRef = useRef<THREE.Group>(null);
  const surfaceBandsRef = useRef<THREE.Group>(null);
  const lowerBoundaryRef = useRef<THREE.Mesh>(null);
  const middleBoundaryRef = useRef<THREE.Mesh>(null);
  const upperBoundaryRef = useRef<THREE.Mesh>(null);
  const boundaryMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const boundaryMarkers = useRef<Array<THREE.Mesh | null>>([]);
  const reefRefs = useRef<Array<THREE.Group | null>>([]);
  const wreckRef = useRef<THREE.Group>(null);
  const frenzyGroupRef = useRef<THREE.Group>(null);
  const frenzyBeamRef = useRef<THREE.Mesh>(null);
  const frenzyMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const lightShaftRefs = useRef<Array<THREE.Mesh | null>>([]);
  const particulateRef = useRef<THREE.InstancedMesh>(null);
  const bubbleRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const boundaryColor = useMemo(() => new THREE.Color(), []);
  const boundarySafeColor = useMemo(() => new THREE.Color(BOUNDARY), []);
  const boundaryDangerColor = useMemo(() => new THREE.Color(BOUNDARY_DANGER), []);
  const particulates = useMemo(
    () => makeEnvironmentSeeds(environmentQuality.particulateBudget, 118),
    [environmentQuality.particulateBudget],
  );
  const bubbles = useMemo(
    () => makeEnvironmentSeeds(environmentQuality.bubbleBudget, 7118),
    [environmentQuality.bubbleBudget],
  );
  const reefs = ENVIRONMENT_LANDMARKS.filter((landmark) => landmark.kind === "reef");
  const wreck = ENVIRONMENT_LANDMARKS.find((landmark) => landmark.kind === "wreck");

  useFrame(({ clock }, dt) => {
    const state = socket.stateRef.current;
    const cues = resolveOceanArenaCues(state
      ? {
          arenaRadius: state.arenaRadius,
          seabedY: state.seabedY,
          surfaceY: state.surfaceY,
        }
      : fallback);
    const t = reducedMotion ? 0 : clock.elapsedTime;

    if (surfaceRef.current) {
      surfaceRef.current.position.y = cues.surfaceY;
      surfaceRef.current.scale.set(cues.radius * 1.025, cues.radius * 1.025, 1);
    }
    if (seabedRef.current) {
      seabedRef.current.position.y = cues.seabedY;
      seabedRef.current.scale.set(cues.radius * 1.04, cues.radius * 1.04, 1);
    }
    if (surfaceBandsRef.current) {
      surfaceBandsRef.current.position.y = cues.surfaceY - 0.06;
      surfaceBandsRef.current.scale.set(cues.radius, cues.radius, 1);
      if (!reducedMotion) surfaceBandsRef.current.rotation.z += dt * 0.018;
    }
    if (seabedCuesRef.current) {
      seabedCuesRef.current.position.y = cues.seabedY + 0.045;
      seabedCuesRef.current.scale.set(cues.radius, cues.radius, 1);
      if (!reducedMotion) seabedCuesRef.current.rotation.z -= dt * 0.004;
    }

    for (const [mesh, y] of [
      [lowerBoundaryRef.current, cues.seabedY + cues.height * 0.17],
      [middleBoundaryRef.current, cues.midY],
      [upperBoundaryRef.current, cues.surfaceY - cues.height * 0.17],
    ] as const) {
      if (!mesh) continue;
      mesh.position.y = y;
      mesh.scale.set(cues.radius, cues.radius, 1);
    }

    for (let i = 0; i < BOUNDARY_MARKER_COUNT; i += 1) {
      const marker = boundaryMarkers.current[i];
      if (!marker) continue;
      const angle = (i / BOUNDARY_MARKER_COUNT) * Math.PI * 2;
      placeRadial(marker, angle, 0.91, cues.radius, cues.midY);
      marker.scale.y = cues.height * 0.32;
    }

    reefs.forEach((landmark, index) => {
      const ref = reefRefs.current[index];
      placeRadial(ref, landmark.angle, landmark.radialShare, cues.radius, cues.seabedY + 0.1);
      if (ref) {
        const scale = Math.max(0.8, Math.min(1.5, cues.radius / 82));
        ref.scale.setScalar(scale);
      }
    });
    if (wreck) {
      placeRadial(wreckRef.current, wreck.angle, wreck.radialShare, cues.radius, cues.seabedY + 0.25);
    }

    if (frenzyGroupRef.current) {
      frenzyGroupRef.current.position.y = cues.midY;
      frenzyGroupRef.current.scale.set(cues.frenzyRadius, 1, cues.frenzyRadius);
      if (!reducedMotion) frenzyGroupRef.current.rotation.y += dt * 0.08;
    }
    if (frenzyBeamRef.current) {
      frenzyBeamRef.current.scale.set(
        1 / Math.max(1, cues.frenzyRadius),
        cues.height * 0.72,
        1 / Math.max(1, cues.frenzyRadius),
      );
    }
    const frenzyOn = Boolean(state && state.frenzyUntilTick > state.tick);
    if (frenzyMaterialRef.current) {
      frenzyMaterialRef.current.color.set(frenzyOn ? FRENZY_ACTIVE : FRENZY);
      frenzyMaterialRef.current.opacity = frenzyOn
        ? reducedMotion ? 0.32 : 0.3 + Math.sin(t * 3.2) * 0.08
        : 0.13;
    }

    const local = state?.snakes.find((shark) => shark.id === socket.youId)?.segments[0];
    const boundaryDanger = local
      ? Math.max(0, Math.min(1, 1 - (state!.arenaRadius - Math.hypot(local.x, local.z)) / 14))
      : 0;
    if (boundaryMaterialRef.current) {
      boundaryMaterialRef.current.color.copy(
        boundaryColor.copy(boundarySafeColor).lerp(boundaryDangerColor, boundaryDanger),
      );
      boundaryMaterialRef.current.opacity = 0.2 + boundaryDanger * 0.3;
    }

    LIGHT_SHAFT_LAYOUT.slice(0, environmentQuality.lightShaftCount).forEach((shaft, index) => {
      const mesh = lightShaftRefs.current[index];
      if (!mesh) return;
      placeRadial(mesh, shaft.angle + (reducedMotion ? 0 : Math.sin(t * 0.08 + index) * 0.05), shaft.radialShare, cues.radius, cues.midY);
      mesh.scale.set(shaft.scale, cues.height * 0.9, shaft.scale);
    });

    const particulateMesh = particulateRef.current;
    if (particulateMesh) {
      particulates.forEach((seed, index) => {
        const yShare = (seed.depthShare + t * seed.speed) % 1;
        dummy.position.set(
          Math.cos(seed.angle) * seed.radialShare * cues.radius,
          cues.seabedY + yShare * cues.height,
          Math.sin(seed.angle) * seed.radialShare * cues.radius,
        );
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(seed.size);
        dummy.updateMatrix();
        particulateMesh.setMatrixAt(index, dummy.matrix);
      });
      particulateMesh.count = particulates.length;
      particulateMesh.instanceMatrix.needsUpdate = true;
    }

    const bubbleMesh = bubbleRef.current;
    if (bubbleMesh) {
      bubbles.forEach((seed, index) => {
        const yShare = (seed.depthShare + t * seed.speed * 2.3) % 1;
        const drift = reducedMotion ? 0 : Math.sin(t * 0.45 + seed.angle) * 0.012 * cues.radius;
        dummy.position.set(
          Math.cos(seed.angle) * seed.radialShare * cues.radius + drift,
          cues.seabedY + yShare * cues.height,
          Math.sin(seed.angle) * seed.radialShare * cues.radius,
        );
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(seed.size * 1.65);
        dummy.updateMatrix();
        bubbleMesh.setMatrixAt(index, dummy.matrix);
      });
      bubbleMesh.count = bubbles.length;
      bubbleMesh.instanceMatrix.needsUpdate = true;
    }
  });

  const seabedCueOpacity = settings.graphics.showGrid ? 0.2 : 0.11;

  return (
    <>
      <color attach="background" args={[BACKGROUND]} />
      <fog attach="fog" args={[FOG, sceneQuality.fogNear, sceneQuality.fogFar]} />
      <ambientLight intensity={0.78} />
      <hemisphereLight args={[SURFACE_ACCENT, SEABED, 0.68]} />
      <directionalLight position={[18, 34, 12]} intensity={0.92} color={SURFACE_ACCENT} />

      <mesh ref={seabedRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, fallback.seabedY, 0]}>
        <circleGeometry args={[1, sceneQuality.ringSegments]} />
        <meshStandardMaterial color={SEABED} roughness={0.96} metalness={0} />
      </mesh>

      <group ref={seabedCuesRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, fallback.seabedY + 0.045, 0]}>
        {Array.from({ length: environmentQuality.causticBands }, (_, index) => {
          const inner = 0.11 + index * (0.72 / environmentQuality.causticBands);
          return (
            <mesh key={inner}>
              <ringGeometry args={[inner, inner + 0.009, sceneQuality.ringSegments]} />
              <meshBasicMaterial
                color={SEABED_ACCENT}
                transparent
                opacity={seabedCueOpacity}
                depthWrite={false}
                side={THREE.DoubleSide}
              />
            </mesh>
          );
        })}
      </group>

      <mesh ref={surfaceRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, fallback.surfaceY, 0]}>
        <circleGeometry args={[1, sceneQuality.ringSegments]} />
        <meshBasicMaterial
          color={SURFACE}
          transparent
          opacity={0.2}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      <group ref={surfaceBandsRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, fallback.surfaceY - 0.06, 0]}>
        {[0.22, 0.46, 0.7, 0.9].map((radius) => (
          <mesh key={radius}>
            <ringGeometry args={[radius, radius + 0.008, sceneQuality.ringSegments]} />
            <meshBasicMaterial
              color={SURFACE_ACCENT}
              transparent
              opacity={0.24}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        ))}
      </group>

      <mesh ref={lowerBoundaryRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.985, 1, sceneQuality.ringSegments]} />
        <meshBasicMaterial ref={boundaryMaterialRef} color={BOUNDARY} transparent opacity={0.2} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={middleBoundaryRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.985, 1, sceneQuality.ringSegments]} />
        <meshBasicMaterial color={BOUNDARY} transparent opacity={0.22} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={upperBoundaryRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.985, 1, sceneQuality.ringSegments]} />
        <meshBasicMaterial color={BOUNDARY} transparent opacity={0.2} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>

      {Array.from({ length: BOUNDARY_MARKER_COUNT }, (_, index) => (
        <mesh
          key={index}
          ref={(mesh) => { boundaryMarkers.current[index] = mesh; }}
        >
          <cylinderGeometry args={[0.08, 0.08, 1, 6]} />
          <meshBasicMaterial color={BOUNDARY} transparent opacity={0.34} />
        </mesh>
      ))}

      {reefs.map((landmark, index) => (
        <group
          key={landmark.id}
          ref={(group) => { reefRefs.current[index] = group; }}
          position={[
            Math.cos(landmark.angle) * fallback.radius * landmark.radialShare,
            fallback.seabedY,
            Math.sin(landmark.angle) * fallback.radius * landmark.radialShare,
          ]}
        >
          <ReefFormation />
        </group>
      ))}

      {wreck && (
        <group
          ref={wreckRef}
          position={[
            Math.cos(wreck.angle) * fallback.radius * wreck.radialShare,
            fallback.seabedY,
            Math.sin(wreck.angle) * fallback.radius * wreck.radialShare,
          ]}
        >
          <WreckLandmark />
        </group>
      )}

      <group ref={frenzyGroupRef} position={[0, fallback.midY, 0]}>
        <mesh ref={frenzyBeamRef}>
          <cylinderGeometry args={[0.12, 0.4, 1, 12, 1, true]} />
          <meshBasicMaterial
            ref={frenzyMaterialRef}
            color={FRENZY}
            transparent
            opacity={0.13}
            depthWrite={false}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        {[0.34, 0.62, 0.9].map((radius, index) => (
          <mesh key={radius} rotation={[-Math.PI / 2, 0, 0]} position={[0, (index - 1) * 0.22, 0]}>
            <ringGeometry args={[radius, radius + 0.025, sceneQuality.ringSegments]} />
            <meshBasicMaterial
              color={FRENZY}
              transparent
              opacity={0.46 - index * 0.08}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        ))}
      </group>

      {LIGHT_SHAFT_LAYOUT.slice(0, environmentQuality.lightShaftCount).map((shaft, index) => (
        <mesh
          key={index}
          ref={(mesh) => { lightShaftRefs.current[index] = mesh; }}
          position={[
            Math.cos(shaft.angle) * fallback.radius * shaft.radialShare,
            fallback.midY,
            Math.sin(shaft.angle) * fallback.radius * shaft.radialShare,
          ]}
        >
          <coneGeometry args={[3.4, 1, 10, 1, true]} />
          <meshBasicMaterial
            color={SURFACE_ACCENT}
            transparent
            opacity={0.055}
            depthWrite={false}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}

      <instancedMesh
        ref={particulateRef}
        args={[undefined, undefined, environmentQuality.particulateBudget]}
        frustumCulled={false}
      >
        <icosahedronGeometry args={[1, 0]} />
        <meshBasicMaterial color={PARTICULATE} transparent opacity={0.38} depthWrite={false} />
      </instancedMesh>

      <instancedMesh
        ref={bubbleRef}
        args={[undefined, undefined, environmentQuality.bubbleBudget]}
        frustumCulled={false}
      >
        <sphereGeometry args={[1, 6, 6]} />
        <meshBasicMaterial color={BUBBLE} wireframe transparent opacity={0.24} depthWrite={false} />
      </instancedMesh>
    </>
  );
}
