// Bridges game events → audio + captions. Starts/stops the music loop with the game
// screen, tracks the local shark to fire SFX (eat on score-up, dash on dash-start,
// spawn on (re)spawn), and death SFX from the socket. Returns the latest caption so a
// visual captions layer can render it (WCAG 1.2 — non-audio alternative for sound cues).

import { useEffect, useRef, useState } from "react";
import { audio, SFX_CAPTION, type Sfx } from "./AudioManager.js";
import type { RoomSocket } from "../net/useRoomSocket.js";
import type { Settings } from "../settings/SettingsContext.js";

export interface Caption {
  text: string;
  id: number;
}

export function useGameAudio(socket: RoomSocket, settings: Settings): Caption | null {
  const [caption, setCaption] = useState<Caption | null>(null);
  const capId = useRef(0);
  const lastScore = useRef(0);
  const lastBoost = useRef(false);
  const wasAlive = useRef(false);
  const wasFrenzy = useRef<boolean | null>(null);
  const captionsOn = settings.audio.captions;

  // Emit a caption (only when the player asked for captions).
  const cue = useRef((type: Sfx) => {
    audio.playSfx(type);
    if (captionsOnRef.current) {
      capId.current += 1;
      setCaption({ text: SFX_CAPTION[type], id: capId.current });
    }
  });
  const captionsOnRef = useRef(captionsOn);
  captionsOnRef.current = captionsOn;

  // Start audio + music with the game screen; stop on leave.
  useEffect(() => {
    audio.ensure();
    audio.setVolumes(settings.audio);
    if (settings.audio.music > 0 && settings.audio.master > 0) audio.startMusic();
    return () => audio.stopMusic();
    // Intentionally run once per game screen mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live volume changes.
  useEffect(() => {
    audio.setVolumes(settings.audio);
    if (settings.audio.music > 0 && settings.audio.master > 0) audio.startMusic();
    else audio.stopMusic();
  }, [settings.audio]);

  // Death SFX.
  useEffect(() => {
    if (socket.death) cue.current("die");
  }, [socket.death]);

  // Poll the local shark for eat / dash / spawn transitions.
  useEffect(() => {
    const id = setInterval(() => {
      const s = socket.stateRef.current;
      if (!s) return;
      const frenzyOn = s.frenzyUntilTick > s.tick;
      if (wasFrenzy.current === null) {
        if (frenzyOn) cue.current("frenzyStart");
      } else if (frenzyOn !== wasFrenzy.current) {
        cue.current(frenzyOn ? "frenzyStart" : "frenzyEnd");
      }
      wasFrenzy.current = frenzyOn;
      const me = s.snakes.find((x) => x.id === socket.youId);
      if (!me) return;
      if (me.alive && !wasAlive.current) {
        cue.current("spawn");
        lastScore.current = me.score;
      }
      wasAlive.current = me.alive;
      if (!me.alive) return;
      if (me.score > lastScore.current) cue.current("eat");
      lastScore.current = me.score;
      const dashing = me.lungeTicks > 0;
      if (dashing && !lastBoost.current) cue.current("boost");
      lastBoost.current = dashing;
    }, 150);
    return () => clearInterval(id);
  }, [socket]);

  // Auto-clear the caption a moment after it shows.
  useEffect(() => {
    if (!caption) return;
    const id = setTimeout(() => setCaption(null), 1100);
    return () => clearTimeout(id);
  }, [caption]);

  return caption;
}
