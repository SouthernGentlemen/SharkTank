import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import {
  CAMERA_PROJECTION,
  chaseCameraPose,
  makeChaseCameraPose,
  type SceneVec3,
} from "./sceneMath.js";

export interface CameraFollowTarget {
  active: boolean;
  position: SceneVec3;
  yaw: number;
  pitch: number;
}

export function makeCameraFollowTarget(): CameraFollowTarget {
  return {
    active: false,
    position: { x: 0, y: 0.5, z: 0 },
    yaw: 0,
    pitch: 0,
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
  const pose = useMemo(() => makeChaseCameraPose(), []);
  const goal = useMemo(() => new THREE.Vector3(), []);
  const lookGoal = useMemo(() => new THREE.Vector3(), []);
  const lookCurrent = useMemo(() => new THREE.Vector3(), []);

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
      chaseCameraPose(follow.position, follow.yaw, follow.pitch, pose);
    } else {
      pose.position.x = 0;
      pose.position.y = 18;
      pose.position.z = 24;
      pose.lookAt.x = 0;
      pose.lookAt.y = 0;
      pose.lookAt.z = 0;
    }

    goal.set(pose.position.x, pose.position.y, pose.position.z);
    lookGoal.set(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);

    if (reducedMotion) {
      camera.position.copy(goal);
      lookCurrent.copy(lookGoal);
    } else {
      const positionBlend = 1 - Math.exp(-6 * Math.min(dt, 0.05));
      const lookBlend = 1 - Math.exp(-8 * Math.min(dt, 0.05));
      camera.position.lerp(goal, positionBlend);
      lookCurrent.lerp(lookGoal, lookBlend);
    }
    camera.lookAt(lookCurrent);
  });

  return null;
}
