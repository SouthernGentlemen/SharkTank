import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { RoomSocket } from "../net/useRoomSocket.js";
import type { Settings } from "../settings/SettingsContext.js";
import { frenzyVolumeFor, REEF_SITES, reefSitesFor } from "../../engine/index.js";
import {
  CORAL_KINDS,
  ENVIRONMENT_LANDMARKS,
  makeCoralPlacements,
  makeEnvironmentSeeds,
  resolveOceanArenaCues,
  resolveOceanEnvironmentQuality,
} from "./oceanArena.js";
import { cadenceDue, resolveClientPerformanceProfile } from "./performance.js";
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
const REEF_PLATE = "#527b68";
const REEF_FAN = "#7d607b";
const REEF_TUBE = "#477a80";
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
  const fallbackFrenzy = frenzyVolumeFor({
    radius: fallback.radius,
    seabedY: fallback.seabedY,
    surfaceY: fallback.surfaceY,
  });

  const surfaceRef = useRef<THREE.Mesh>(null);
  const seabedRef = useRef<THREE.Mesh>(null);
  const seabedCuesRef = useRef<THREE.Group>(null);
  const surfaceBandsRef = useRef<THREE.Group>(null);
  const lowerBoundaryRef = useRef<THREE.Mesh>(null);
  const middleBoundaryRef = useRef<THREE.Mesh>(null);
  const upperBoundaryRef = useRef<THREE.Mesh>(null);
  const boundaryMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const boundaryMarkerRef = useRef<THREE.InstancedMesh>(null);
  const reefBaseRef = useRef<THREE.InstancedMesh>(null);
  const reefSpireRef = useRef<THREE.InstancedMesh>(null);
  const reefRockRef = useRef<THREE.InstancedMesh>(null);
  const reefFanRef = useRef<THREE.InstancedMesh>(null);
  const reefTubeRef = useRef<THREE.InstancedMesh>(null);
  const wreckRef = useRef<THREE.Group>(null);
  const frenzyGroupRef = useRef<THREE.Group>(null);
  const frenzyBeamRef = useRef<THREE.Mesh>(null);
  const frenzyMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const lightShaftRef = useRef<THREE.InstancedMesh>(null);
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
  const wreck = useMemo(
    () => ENVIRONMENT_LANDMARKS.find((landmark) => landmark.kind === "wreck"),
    [],
  );
  const maxCoralPerKind = REEF_SITES.length * environmentQuality.coralPerKindPerSite;
  const performanceProfile = resolveClientPerformanceProfile(settings.graphics.quality);
  const lastEnvironmentPassAt = useRef(-Infinity);
  const arenaDimensionsRef = useRef({ radius: Number.NaN, seabedY: Number.NaN, surfaceY: Number.NaN });
  const layoutQualityRef = useRef<Settings["graphics"]["quality"] | null>(null);
  const cuesRef = useRef(fallback);
  const frenzyVolumeRef = useRef(fallbackFrenzy);

  useFrame(({ clock }) => {
    const state = socket.stateRef.current;
    const radius = state?.arenaRadius ?? fallback.radius;
    const seabedY = state?.seabedY ?? fallback.seabedY;
    const surfaceY = state?.surfaceY ?? fallback.surfaceY;
    const dimensions = arenaDimensionsRef.current;
    const layoutChanged =
      dimensions.radius !== radius
      || dimensions.seabedY !== seabedY
      || dimensions.surfaceY !== surfaceY
      || layoutQualityRef.current !== settings.graphics.quality;

    if (layoutChanged) {
      dimensions.radius = radius;
      dimensions.seabedY = seabedY;
      dimensions.surfaceY = surfaceY;
      layoutQualityRef.current = settings.graphics.quality;
      cuesRef.current = resolveOceanArenaCues({ arenaRadius: radius, seabedY, surfaceY });
      frenzyVolumeRef.current = frenzyVolumeFor({
        radius: cuesRef.current.radius,
        seabedY: cuesRef.current.seabedY,
        surfaceY: cuesRef.current.surfaceY,
      });
    }

    const cues = cuesRef.current;
    const frenzyVolume = frenzyVolumeRef.current;
    const t = reducedMotion ? 0 : clock.elapsedTime;
    const nowMs = clock.elapsedTime * 1000;
    const updateEnvironment = layoutChanged
      || cadenceDue(lastEnvironmentPassAt.current, nowMs, performanceProfile.environmentUpdateMs);

    if (layoutChanged) {
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
      }
      if (seabedCuesRef.current) {
        seabedCuesRef.current.position.y = cues.seabedY + 0.045;
        seabedCuesRef.current.scale.set(cues.radius, cues.radius, 1);
      }

      const boundaryMeshes = [
        [lowerBoundaryRef.current, cues.seabedY + cues.height * 0.17],
        [middleBoundaryRef.current, cues.midY],
        [upperBoundaryRef.current, cues.surfaceY - cues.height * 0.17],
      ] as const;
      for (const [mesh, y] of boundaryMeshes) {
        if (!mesh) continue;
        mesh.position.y = y;
        mesh.scale.set(cues.radius, cues.radius, 1);
      }

      const boundaryMarkers = boundaryMarkerRef.current;
      if (boundaryMarkers) {
        for (let index = 0; index < BOUNDARY_MARKER_COUNT; index += 1) {
          const angle = (index / BOUNDARY_MARKER_COUNT) * Math.PI * 2;
          dummy.position.set(
            Math.cos(angle) * 0.91 * cues.radius,
            cues.midY,
            Math.sin(angle) * 0.91 * cues.radius,
          );
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(1, cues.height * 0.32, 1);
          dummy.updateMatrix();
          boundaryMarkers.setMatrixAt(index, dummy.matrix);
        }
        boundaryMarkers.count = BOUNDARY_MARKER_COUNT;
        boundaryMarkers.instanceMatrix.needsUpdate = true;
      }

      const coralMeshes = [
        reefBaseRef.current,
        reefSpireRef.current,
        reefRockRef.current,
        reefFanRef.current,
        reefTubeRef.current,
      ];
      const placements = makeCoralPlacements(
        reefSitesFor({ radius: cues.radius, seabedY: cues.seabedY, surfaceY: cues.surfaceY }),
        environmentQuality.coralPerKindPerSite,
      );
      for (let kindIndex = 0; kindIndex < CORAL_KINDS.length; kindIndex += 1) {
        const mesh = coralMeshes[kindIndex];
        if (!mesh) continue;
        let count = 0;
        for (const piece of placements) {
          if (piece.kind !== CORAL_KINDS[kindIndex]) continue;
          dummy.position.set(piece.position.x, piece.position.y, piece.position.z);
          dummy.rotation.set(0, piece.rotationY, 0);
          dummy.scale.setScalar(piece.scale);
          dummy.updateMatrix();
          mesh.setMatrixAt(count, dummy.matrix);
          count += 1;
        }
        mesh.count = count;
        mesh.instanceMatrix.needsUpdate = true;
      }

      if (wreck) {
        placeRadial(wreckRef.current, wreck.angle, wreck.radialShare, cues.radius, cues.seabedY + 0.25);
      }
      if (frenzyGroupRef.current) {
        frenzyGroupRef.current.position.y = frenzyVolume.center.y;
        frenzyGroupRef.current.scale.set(frenzyVolume.radius, 1, frenzyVolume.radius);
      }
      if (frenzyBeamRef.current) {
        frenzyBeamRef.current.scale.set(
          1 / Math.max(1, frenzyVolume.radius),
          frenzyVolume.halfHeight * 2,
          1 / Math.max(1, frenzyVolume.radius),
        );
      }
    }

    if (updateEnvironment) {
      lastEnvironmentPassAt.current = nowMs;
      if (surfaceBandsRef.current) surfaceBandsRef.current.rotation.z = t * 0.018;
      if (seabedCuesRef.current) seabedCuesRef.current.rotation.z = -t * 0.004;

      const lightShafts = lightShaftRef.current;
      if (lightShafts) {
        for (let index = 0; index < environmentQuality.lightShaftCount; index += 1) {
          const shaft = LIGHT_SHAFT_LAYOUT[index];
          const angle = shaft.angle + (reducedMotion ? 0 : Math.sin(t * 0.08 + index) * 0.05);
          dummy.position.set(
            Math.cos(angle) * shaft.radialShare * cues.radius,
            cues.midY,
            Math.sin(angle) * shaft.radialShare * cues.radius,
          );
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(shaft.scale, cues.height * 0.9, shaft.scale);
          dummy.updateMatrix();
          lightShafts.setMatrixAt(index, dummy.matrix);
        }
        lightShafts.count = environmentQuality.lightShaftCount;
        lightShafts.instanceMatrix.needsUpdate = true;
      }

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
    }

    const frenzyOn = Boolean(state && state.frenzyUntilTick > state.tick);
    if (frenzyGroupRef.current) {
      frenzyGroupRef.current.rotation.y = frenzyOn && !reducedMotion ? t * 0.08 : 0;
    }
    if (frenzyMaterialRef.current) {
      frenzyMaterialRef.current.color.set(frenzyOn ? FRENZY_ACTIVE : FRENZY);
      frenzyMaterialRef.current.opacity = frenzyOn
        ? reducedMotion ? 0.32 : 0.3 + Math.sin(t * 3.2) * 0.08
        : 0.13;
    }

    const local = state?.sharks.find((shark) => shark.id === socket.youId)?.position;
    const boundaryDanger = local && state
      ? Math.max(0, Math.min(1, 1 - (state.arenaRadius - Math.hypot(local.x, local.z)) / 14))
      : 0;
    if (boundaryMaterialRef.current) {
      boundaryMaterialRef.current.color.copy(
        boundaryColor.copy(boundarySafeColor).lerp(boundaryDangerColor, boundaryDanger),
      );
      boundaryMaterialRef.current.opacity = 0.2 + boundaryDanger * 0.3;
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

      <instancedMesh
        ref={boundaryMarkerRef}
        args={[undefined, undefined, BOUNDARY_MARKER_COUNT]}
        frustumCulled={false}
      >
        <cylinderGeometry args={[0.08, 0.08, 1, 6]} />
        <meshBasicMaterial color={BOUNDARY} transparent opacity={0.34} />
      </instancedMesh>

      <instancedMesh ref={reefBaseRef} args={[undefined, undefined, maxCoralPerKind]} frustumCulled={false}>
        <dodecahedronGeometry args={[1.55, 1]} />
        <meshStandardMaterial color={REEF} roughness={0.92} metalness={0} />
      </instancedMesh>
      <instancedMesh ref={reefSpireRef} args={[undefined, undefined, maxCoralPerKind]} frustumCulled={false}>
        <coneGeometry args={[0.78, 3.5, 5]} />
        <meshStandardMaterial color={REEF_ACCENT} roughness={0.9} metalness={0} />
      </instancedMesh>
      <instancedMesh ref={reefRockRef} args={[undefined, undefined, maxCoralPerKind]} frustumCulled={false}>
        <cylinderGeometry args={[2.4, 1.8, 0.65, 10]} />
        <meshStandardMaterial color={REEF_PLATE} roughness={0.96} metalness={0} />
      </instancedMesh>
      <instancedMesh ref={reefFanRef} args={[undefined, undefined, maxCoralPerKind]} frustumCulled={false}>
        <circleGeometry args={[2.2, 10, 0, Math.PI]} />
        <meshStandardMaterial color={REEF_FAN} side={THREE.DoubleSide} roughness={0.94} metalness={0} />
      </instancedMesh>
      <instancedMesh ref={reefTubeRef} args={[undefined, undefined, maxCoralPerKind]} frustumCulled={false}>
        <cylinderGeometry args={[0.65, 0.78, 2.8, 10, 1, true]} />
        <meshStandardMaterial color={REEF_TUBE} side={THREE.DoubleSide} roughness={0.93} metalness={0} />
      </instancedMesh>

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

      <group
        ref={frenzyGroupRef}
        position={[0, fallbackFrenzy.center.y, 0]}
        scale={[fallbackFrenzy.radius, 1, fallbackFrenzy.radius]}
      >
        <mesh>
          <cylinderGeometry args={[0.09, 0.14, 4, 10]} />
          <meshStandardMaterial color={FRENZY} emissive={FRENZY} emissiveIntensity={0.22} roughness={0.42} />
        </mesh>
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
        {[0.34, 0.62, 0.9].slice(0, environmentQuality.frenzyRingCount).map((radius, index) => (
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

      <instancedMesh
        ref={lightShaftRef}
        args={[undefined, undefined, LIGHT_SHAFT_LAYOUT.length]}
        frustumCulled={false}
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
      </instancedMesh>

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
