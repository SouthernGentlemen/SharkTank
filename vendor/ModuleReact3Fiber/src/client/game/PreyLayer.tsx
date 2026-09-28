import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { RoomSocket } from "../net/useRoomSocket.js";

const MAX_FOOD = 620;
const FOOD_CYAN = new THREE.Color("#22e6ff");
const FOOD_YELLOW = new THREE.Color("#ffd54a");
const FOOD_RICH = new THREE.Color("#ff8a1f");

export function PreyLayer({ socket }: { socket: RoomSocket }) {
  const foodMesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(() => {
    const food = foodMesh.current;
    if (!food) return;
    const frame = socket.frameAt(45);
    if (!frame) return;

    let foodCount = 0;
    for (let i = 0; i < frame.newer.food.length && foodCount < MAX_FOOD; i += 1) {
      const pellet = frame.newer.food[i];
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
  });

  return (
    <instancedMesh ref={foodMesh} args={[undefined, undefined, MAX_FOOD]} frustumCulled={false}>
      <icosahedronGeometry args={[1, 0]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}
