import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { FrameTimeMonitor } from "./performance.js";

export function AdaptiveResolution({ cap }: { cap: number }) {
  const setDpr = useThree((state) => state.setDpr);
  const monitor = useRef(new FrameTimeMonitor(cap, cap));
  useEffect(() => {
    monitor.current = new FrameTimeMonitor(cap, cap);
    setDpr(cap);
  }, [cap, setDpr]);
  useFrame((_, delta) => {
    const previous = monitor.current.dpr;
    const next = monitor.current.sample(delta * 1000);
    if (next !== previous) setDpr(next);
  });
  return null;
}
