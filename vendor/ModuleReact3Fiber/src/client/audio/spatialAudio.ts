export interface AudioPoint {
  x: number;
  y: number;
  z: number;
}

export interface ListenerPose {
  position: AudioPoint;
  yaw: number;
  pitch: number;
}

export interface SpatialMix {
  distance: number;
  gain: number;
  pan: number;
  front: number;
  vertical: number;
}

export interface SpatialEmitter {
  id: string;
  position: AudioPoint;
  priority: number;
}

export const AUDIO_LIMITS = {
  audibleRange: 44,
  sharkPresenceRange: 24,
  preyActivityRange: 30,
  listenerUpdateMs: 50,
  worldUpdateMs: 160,
  maxWorldVoices: 16,
  sharkCueMs: 900,
  preyCueMs: 1200,
  swimCueMs: 1200,
  apexCueMs: 1100,
  frenzyCueMs: 1400,
  captionRepeatMs: 3200,
  freshEventTicks: 8,
} as const;

export function audioDistance(a: AudioPoint, b: AudioPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function attenuationForDistance(distance: number, maxDistance: number = AUDIO_LIMITS.audibleRange): number {
  if (!Number.isFinite(distance) || !Number.isFinite(maxDistance) || maxDistance <= 0) return 0;
  const d = Math.max(0, distance);
  if (d >= maxDistance) return 0;
  const remaining = 1 - d / maxDistance;
  return remaining * remaining;
}

export function spatialMix(
  listener: ListenerPose,
  emitter: AudioPoint,
  maxDistance: number = AUDIO_LIMITS.audibleRange,
): SpatialMix {
  const dx = emitter.x - listener.position.x;
  const dy = emitter.y - listener.position.y;
  const dz = emitter.z - listener.position.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 1e-6) return { distance: 0, gain: 1, pan: 0, front: 1, vertical: 0 };

  const cosPitch = Math.cos(listener.pitch);
  const forwardX = Math.cos(listener.yaw) * cosPitch;
  const forwardY = Math.sin(listener.pitch);
  const forwardZ = Math.sin(listener.yaw) * cosPitch;
  const rightX = -Math.sin(listener.yaw);
  const rightZ = Math.cos(listener.yaw);
  const inv = 1 / distance;
  const front = (dx * forwardX + dy * forwardY + dz * forwardZ) * inv;
  const pan = Math.max(-1, Math.min(1, (dx * rightX + dz * rightZ) * inv));
  const vertical = Math.max(-1, Math.min(1, dy * inv));
  const rearDamping = front < -0.2 ? 0.78 : 1;

  return {
    distance,
    gain: attenuationForDistance(distance, maxDistance) * rearDamping,
    pan,
    front,
    vertical,
  };
}

export function selectSpatialEmitters(
  listener: AudioPoint,
  candidates: readonly SpatialEmitter[],
  maxCount: number,
  maxDistance: number,
): SpatialEmitter[] {
  const count = Math.max(0, Math.floor(maxCount));
  if (count === 0) return [];
  return candidates
    .filter((candidate) =>
      Number.isFinite(candidate.position.x)
      && Number.isFinite(candidate.position.y)
      && Number.isFinite(candidate.position.z)
      && audioDistance(listener, candidate.position) <= maxDistance
    )
    .map((candidate) => ({ candidate, distance: audioDistance(listener, candidate.position) }))
    .sort((a, b) =>
      b.candidate.priority - a.candidate.priority
      || a.distance - b.distance
      || a.candidate.id.localeCompare(b.candidate.id)
    )
    .slice(0, count)
    .map(({ candidate }) => candidate);
}

export function directionCaption(listener: ListenerPose, emitter: AudioPoint): string {
  const mix = spatialMix(listener, emitter);
  const parts: string[] = [];
  if (mix.pan <= -0.35) parts.push("left");
  else if (mix.pan >= 0.35) parts.push("right");
  if (mix.vertical >= 0.42) parts.push("above");
  else if (mix.vertical <= -0.42) parts.push("below");
  if (parts.length) return parts.join(" and ");
  return mix.front < -0.25 ? "behind" : "ahead";
}

export function emitterCapForQuality(quality: "low" | "medium" | "high"): number {
  if (quality === "low") return 3;
  if (quality === "medium") return 5;
  return 6;
}

export function isFreshAudioEvent(
  eventTick: number,
  currentTick: number,
  maxAgeTicks: number = AUDIO_LIMITS.freshEventTicks,
): boolean {
  return Number.isFinite(eventTick)
    && Number.isFinite(currentTick)
    && eventTick <= currentTick
    && currentTick - eventTick <= Math.max(0, maxAgeTicks);
}
