import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import {
  CAMERA_PROJECTION,
  cameraFovForSpeed,
  chaseCameraPose,
  makeChaseCameraPose,
  smoothChaseCameraPose,
  type SceneVec3,
} from "./sceneMath.js";

export interface CameraFollowTarget {
  active: boolean;
  position: SceneVec3;
  yaw: number;
  pitch: number;
  sharkScale: number;
  speed: number;
  baseSpeed: number;
  boostSpeed: number;
  arenaRadius: number;
  seabedY: number;
  surfaceY: number;
}

export function makeCameraFollowTarget(): CameraFollowTarget {
  return {
    active: false,
    position: { x: 0, y: 0.5, z: 0 },
    yaw: 0,
    pitch: 0,
    sharkScale: 1,
    speed: 11,
    baseSpeed: 11,
    boostSpeed: 28,
    arenaRadius: 82,
    seabedY: -12,
    surfaceY: 12,
  };
}

export function CameraRig({
  followRef,
  reducedMotion,
}: {
  followRef: React.MutableRefObject<CameraFollowTarget>;
  reducedMotion: boolean;
}) {
  const { camera } = useThree();
  const goal = useMemo(() => makeChaseCameraPose(), []);
  const current = useMemo(() => makeChaseCameraPose(), []);

  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    camera.fov = CAMERA_PROJECTION.fov;
    camera.near = CAMERA_PROJECTION.near;
    camera.far = CAMERA_PROJECTION.far;
    camera.updateProjectionMatrix();
  }, [camera]);

  useFrame((_, dt) => {
    const follow = followRef.current;
    if (follow.active) {
      chaseCameraPose(follow.position, follow.yaw, follow.pitch, goal, {
        sharkScale: follow.sharkScale,
        speed: follow.speed,
        baseSpeed: follow.baseSpeed,
        boostSpeed: follow.boostSpeed,
        arenaRadius: follow.arenaRadius,
        seabedY: follow.seabedY,
        surfaceY: follow.surfaceY,
        reducedMotion,
      });
    } else {
      goal.position.x = 0;
      goal.position.y = 18;
      goal.position.z = 24;
      goal.lookAt.x = 0;
      goal.lookAt.y = 0;
      goal.lookAt.z = 0;
    }

    smoothChaseCameraPose(current, goal, dt, reducedMotion, current);
    camera.position.set(current.position.x, current.position.y, current.position.z);
    camera.lookAt(current.lookAt.x, current.lookAt.y, current.lookAt.z);

    if (camera instanceof THREE.PerspectiveCamera) {
      const targetFov = follow.active
        ? cameraFovForSpeed(follow.speed, follow.baseSpeed, follow.boostSpeed, reducedMotion)
        : CAMERA_PROJECTION.fov;
      const blend = reducedMotion ? 1 : 1 - Math.exp(-5 * Math.min(dt, 0.05));
      const nextFov = camera.fov + (targetFov - camera.fov) * blend;
      if (Math.abs(nextFov - camera.fov) > 0.001) {
        camera.fov = nextFov;
        camera.updateProjectionMatrix();
      }
    }
  });

  return null;
}
