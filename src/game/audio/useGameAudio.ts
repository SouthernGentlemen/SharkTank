import { useEffect, useRef, useState } from "react";
import type { NetPrey } from "../../protocol/index.js";
import type { ClientShark } from "../net/clientState.js";
import { audio, SFX_CAPTION, type Sfx } from "./AudioManager.js";
import {
  AUDIO_LIMITS,
  audioDistance,
  directionCaption,
  emitterCapForQuality,
  isFreshAudioEvent,
  isPreyConsumeCandidate,
  selectSpatialEmitters,
  type AudioPoint,
} from "./spatialAudio.js";
import type { RoomSocket } from "../net/useRoomSocket.js";
import type { Settings } from "../settings/SettingsContext.js";

export interface Caption {
  text: string;
  id: number;
}

function headOf(shark: ClientShark): AudioPoint | null {
  const head = shark.position;
  return head ? { x: head.x, y: head.y, z: head.z } : null;
}

function preyPoint(prey: NetPrey): AudioPoint {
  return { x: prey.x, y: prey.y, z: prey.z };
}

export function useGameAudio(socket: RoomSocket, settings: Settings): Caption | null {
  const [caption, setCaption] = useState<Caption | null>(null);
  const capId = useRef(0);
  const captionsOnRef = useRef(settings.audio.captions);
  const lastTick = useRef<number | null>(null);
  const lastFood = useRef(new Map<string, NetPrey>());
  const lastBoost = useRef(false);
  const wasAlive = useRef(false);
  const wasFrenzy = useRef<boolean | null>(null);
  const roundKey = useRef<string | null>(null);
  const seenExplosions = useRef(new Set<string>());
  const nextSharkCueAt = useRef(0);
  const nextPreyCueAt = useRef(0);
  const nextSwimCueAt = useRef(0);
  const nextApexCueAt = useRef(0);
  const nextFrenzyCueAt = useRef(0);
  const lastDirectionalCaptionAt = useRef(-Infinity);

  captionsOnRef.current = settings.audio.captions;

  const emitCaption = useRef((text: string) => {
    if (!captionsOnRef.current) return;
    capId.current += 1;
    setCaption({ text, id: capId.current });
  });

  const cue = useRef((
    type: Sfx,
    options: {
      position?: AudioPoint;
      range?: number;
      key?: string;
      minIntervalMs?: number;
      caption?: string | false;
    } = {},
  ) => {
    const played = options.position
      ? audio.playWorldSfx(type, options.position, {
          range: options.range,
          key: options.key,
          minIntervalMs: options.minIntervalMs,
        })
      : audio.playSfx(type, {
          key: options.key,
          minIntervalMs: options.minIntervalMs,
        });

    // Captions are the visual equivalent of a gameplay-relevant sound, not a receipt
    // from Web Audio. Keep them available when audio is muted, blocked before a user
    // gesture, or unsupported, while still respecting the cue's audible spatial range.
    const captionReachable = !options.position
      || audioDistance(audio.getListenerPose().position, options.position)
        <= (options.range ?? AUDIO_LIMITS.audibleRange);
    const captioned = options.caption !== false && captionsOnRef.current && captionReachable;
    if (captioned) {
      const captionText = typeof options.caption === "string" ? options.caption : SFX_CAPTION[type];
      emitCaption.current(captionText);
    }
    return played || captioned;
  });

  useEffect(() => {
    audio.ensure();
    audio.setVolumes(settings.audio);
    if (settings.audio.master > 0 && settings.audio.sfx > 0) audio.startAmbience();
    if (settings.audio.master > 0 && settings.audio.music > 0) audio.startMusic();
    return () => audio.stopSession();
    // One graph per mounted game session. Live settings are handled by the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    audio.setVolumes(settings.audio);
    if (settings.audio.master > 0 && settings.audio.sfx > 0) audio.startAmbience();
    else audio.stopAmbience();
    if (settings.audio.master > 0 && settings.audio.music > 0) audio.startMusic();
    else audio.stopMusic();
  }, [settings.audio]);

  useEffect(() => {
    if (socket.status === "open") return;
    lastTick.current = null;
    wasFrenzy.current = null;
    roundKey.current = null;
    lastFood.current.clear();
    seenExplosions.current.clear();
  }, [socket.status]);

  useEffect(() => {
    if (socket.death) cue.current("die", { key: "local-death:" + socket.death.tick });
  }, [socket.death]);

  useEffect(() => {
    const id = setInterval(() => {
      if (socket.status !== "open") return;
      const state = socket.stateRef.current;
      if (!state) return;

      const me = state.sharks.find((shark) => shark.id === socket.youId) ?? null;
      const first = lastTick.current === null || state.tick < (lastTick.current ?? 0);
      lastTick.current = state.tick;

      const frenzyOn = state.frenzyUntilTick > state.tick;
      const frenzyChanged = wasFrenzy.current !== null && frenzyOn !== wasFrenzy.current;
      if (first) {
        wasFrenzy.current = frenzyOn;
        if (frenzyOn) cue.current("frenzyStart");
      } else if (frenzyChanged) {
        if (frenzyOn) cue.current("frenzyStart");
        else cue.current("frenzyEnd");
        wasFrenzy.current = frenzyOn;
      }

      const currentRoundKey = state.round.number + ":" + state.round.phase;
      const roundChanged = roundKey.current !== null && roundKey.current !== currentRoundKey;
      if (first) {
        roundKey.current = currentRoundKey;
        if (state.round.phase === "apex") cue.current("apexStart", { key: currentRoundKey });
        else if (state.round.phase === "result") cue.current("roundResult", { key: currentRoundKey });
      } else if (roundChanged) {
        roundKey.current = currentRoundKey;
        if (state.round.phase === "active") cue.current("roundStart", { key: currentRoundKey });
        else if (state.round.phase === "apex") cue.current("apexStart", { key: currentRoundKey });
        else cue.current("roundResult", { key: currentRoundKey });
      }

      if (me) {
        if (first) {
          wasAlive.current = me.alive;
          lastBoost.current = me.lungeTicks > 0;
          if (me.alive) cue.current("spawn", { key: "spawn:" + state.round.number + ":" + state.tick });
        } else {
          if (me.alive && !wasAlive.current) cue.current("spawn", { key: "spawn:" + state.tick });
          wasAlive.current = me.alive;
          const boosting = me.lungeTicks > 0;
          if (boosting && !lastBoost.current) {
            cue.current("boost", { key: "boost", minIntervalMs: 180 });
          }
          lastBoost.current = boosting;
        }
      }

      const nextFood = new Map(state.food.map((prey) => [prey.id, prey]));
      if (!first && !frenzyChanged && !roundChanged && state.round.phase !== "result") {
        let emitted = 0;
        for (const [preyId, previousPrey] of lastFood.current) {
          if (nextFood.has(preyId) || !isPreyConsumeCandidate(previousPrey, state.sharks)) continue;
          cue.current("preyConsume", {
            position: preyPoint(previousPrey),
            range: 30,
            key: "consume:" + preyId,
          });
          emitted += 1;
          if (emitted >= 2) break;
        }
      }
      lastFood.current = nextFood;

      const currentExplosionIds = new Set<string>();
      for (const burst of state.explosions ?? []) {
        currentExplosionIds.add(burst.id);
        if (seenExplosions.current.has(burst.id) || !isFreshAudioEvent(burst.tick, state.tick)) continue;
        seenExplosions.current.add(burst.id);
        const point = { x: burst.x, y: burst.y, z: burst.z };
        if (burst.kind === "bite") {
          cue.current("biteImpact", { position: point, range: 32, key: burst.id });
        } else if (burst.kind === "shark") {
          cue.current("sharkDeath", { position: point, range: 40, key: burst.id });
        } else {
          cue.current("frenzyPulse", { position: point, range: 34, key: burst.id, caption: false });
        }
      }
      seenExplosions.current = new Set(
        [...seenExplosions.current].filter((explosionId) => currentExplosionIds.has(explosionId)),
      );

      const meHead = me ? headOf(me) : null;
      if (!me || !me.alive || !meHead) return;
      const now = performance.now();
      const cameraListener = audio.getListenerPose();
      const listener = {
        position: cameraListener.position,
        yaw: cameraListener.yaw,
        pitch: cameraListener.pitch,
      };
      const emitterCap = emitterCapForQuality(settings.graphics.quality);

      if (now >= nextSwimCueAt.current) {
        nextSwimCueAt.current = now + AUDIO_LIMITS.swimCueMs;
        cue.current("swimRush", { key: "swim", minIntervalMs: AUDIO_LIMITS.swimCueMs, caption: false });
      }

      if (now >= nextSharkCueAt.current) {
        nextSharkCueAt.current = now + AUDIO_LIMITS.sharkCueMs;
        const nearby = selectSpatialEmitters(
          listener.position,
          state.sharks
            .filter((shark) => shark.alive && shark.id !== socket.youId)
            .flatMap((shark) => {
              const position = headOf(shark);
              return position ? [{
                id: shark.id,
                position,
                priority: shark.length + (shark.id === state.round.apexId ? 100 : 0),
              }] : [];
            }),
          Math.min(2, emitterCap),
          AUDIO_LIMITS.sharkPresenceRange,
        );
        nearby.forEach((candidate, index) => {
          const captionAllowed = index === 0
            && now - lastDirectionalCaptionAt.current >= AUDIO_LIMITS.captionRepeatMs;
          const caption = captionAllowed
            ? "Shark nearby — " + directionCaption(listener, candidate.position)
            : false;
          if (cue.current("sharkPresence", {
            position: candidate.position,
            range: AUDIO_LIMITS.sharkPresenceRange,
            key: "presence:" + candidate.id,
            minIntervalMs: AUDIO_LIMITS.sharkCueMs,
            caption,
          }) && captionAllowed) {
            lastDirectionalCaptionAt.current = now;
          }
        });
      }

      if (now >= nextPreyCueAt.current) {
        nextPreyCueAt.current = now + AUDIO_LIMITS.preyCueMs;
        const candidate = selectSpatialEmitters(
          listener.position,
          state.food.map((prey) => ({
            id: prey.id,
            position: preyPoint(prey),
            priority: prey.value,
          })),
          Math.min(1, emitterCap),
          AUDIO_LIMITS.preyActivityRange,
        )[0];
        if (candidate) {
          const captionAllowed = now - lastDirectionalCaptionAt.current >= AUDIO_LIMITS.captionRepeatMs;
          const caption = captionAllowed
            ? "Prey school nearby — " + directionCaption(listener, candidate.position)
            : false;
          if (cue.current("preyActivity", {
            position: candidate.position,
            range: AUDIO_LIMITS.preyActivityRange,
            key: "prey:" + candidate.id,
            minIntervalMs: AUDIO_LIMITS.preyCueMs,
            caption,
          }) && captionAllowed) {
            lastDirectionalCaptionAt.current = now;
          }
        }
      }

      if (state.round.phase === "apex" && state.round.apexId && now >= nextApexCueAt.current) {
        nextApexCueAt.current = now + AUDIO_LIMITS.apexCueMs;
        const apex = state.sharks.find((shark) => shark.id === state.round.apexId);
        const apexHead = apex ? headOf(apex) : null;
        if (apexHead) {
          const captionAllowed = now - lastDirectionalCaptionAt.current >= AUDIO_LIMITS.captionRepeatMs;
          const caption = captionAllowed
            ? "Apex threat — " + directionCaption(listener, apexHead)
            : false;
          if (cue.current("apexPulse", {
            position: apexHead,
            range: AUDIO_LIMITS.audibleRange,
            key: "apex:" + state.round.number,
            minIntervalMs: AUDIO_LIMITS.apexCueMs,
            caption,
          }) && captionAllowed) {
            lastDirectionalCaptionAt.current = now;
          }
        }
      }

      if (frenzyOn && now >= nextFrenzyCueAt.current) {
        nextFrenzyCueAt.current = now + AUDIO_LIMITS.frenzyCueMs;
        cue.current("frenzyPulse", {
          position: { x: 0, y: (state.seabedY + state.surfaceY) / 2, z: 0 },
          range: AUDIO_LIMITS.audibleRange,
          key: "frenzy-pulse:" + state.frenzyUntilTick,
          minIntervalMs: AUDIO_LIMITS.frenzyCueMs,
          caption: false,
        });
      }
    }, AUDIO_LIMITS.worldUpdateMs);
    return () => clearInterval(id);
  }, [socket, settings.graphics.quality]);

  useEffect(() => {
    if (!caption) return;
    const id = setTimeout(() => setCaption(null), 1400);
    return () => clearTimeout(id);
  }, [caption]);

  return caption;
}
