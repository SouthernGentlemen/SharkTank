// Bounded, orientation-relative 3D competitive cues derived only from authoritative snapshots.
// Depth, vertical relationship, proximity and
// target identity stay readable without inventing a second client-side game truth.

import { useEffect, useState } from "react";
import type { NetPrey } from "../../protocol/index.js";
import type { ClientState } from "../net/clientState.js";
import type { RoomSocket } from "../net/useRoomSocket.js";
import {
  EDIBILITY_PRESENTATION,
  edibilityFor,
  type Edibility,
} from "./edibility.js";

export type RelativeBearing =
  | "ahead"
  | "ahead-right"
  | "right"
  | "behind-right"
  | "behind"
  | "behind-left"
  | "left"
  | "ahead-left"
  | "centered";
export type VerticalBand = "above" | "level" | "below";
export type ProximityBand = "close" | "near" | "far";
export type DepthCueKind = "apex" | "rival" | "prey" | "frenzy";

export interface RelativeTargetDescription {
  bearing: RelativeBearing;
  vertical: VerticalBand;
  proximity: ProximityBand;
  distance: number;
}

export interface DepthCue extends RelativeTargetDescription {
  id: string;
  kind: DepthCueKind;
  label: string;
  detail: string;
  edibility?: Edibility;
}

export interface DepthNavigationState {
  depth: number;
  apexSelf: boolean;
  cues: DepthCue[];
}

const RIVAL_RANGE = 52;
const PREY_RANGE = 46;
const VERTICAL_DEADBAND = 4;

function wrapRadians(value: number): number {
  const tau = Math.PI * 2;
  const wrapped = (value + Math.PI) % tau;
  return (wrapped < 0 ? wrapped + tau : wrapped) - Math.PI;
}

function bearingFor(relativeYaw: number, horizontalDistance: number): RelativeBearing {
  if (horizontalDistance < 1.5) return "centered";
  const sectors: Exclude<RelativeBearing, "centered">[] = [
    "ahead",
    "ahead-right",
    "right",
    "behind-right",
    "behind",
    "behind-left",
    "left",
    "ahead-left",
  ];
  const raw = Math.round(wrapRadians(relativeYaw) / (Math.PI / 4));
  return sectors[(raw + sectors.length) % sectors.length];
}

export function describeRelativeTarget(
  origin: { x: number; y: number; z: number },
  yaw: number,
  target: { x: number; y: number; z: number },
): RelativeTargetDescription {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dz = target.z - origin.z;
  const horizontal = Math.hypot(dx, dz);
  const distance = Math.hypot(dx, dy, dz);
  const relativeYaw = Math.atan2(dz, dx) - yaw;
  return {
    bearing: bearingFor(relativeYaw, horizontal),
    vertical: dy > VERTICAL_DEADBAND ? "above" : dy < -VERTICAL_DEADBAND ? "below" : "level",
    proximity: distance <= 12 ? "close" : distance <= 30 ? "near" : "far",
    distance: Math.round(distance),
  };
}

function preyName(prey: NetPrey): string {
  if (prey.kind === "chum") return "Frenzy chum";
  if (prey.kind === "carcass") return "Carcass prey";
  if (prey.kind === "reef") return "Reef prey";
  return "Bait prey";
}

function cue(
  id: string,
  kind: DepthCueKind,
  label: string,
  detail: string,
  origin: { x: number; y: number; z: number },
  yaw: number,
  target: { x: number; y: number; z: number },
  edibility?: Edibility,
): DepthCue {
  return { id, kind, label, detail, edibility, ...describeRelativeTarget(origin, yaw, target) };
}

const cuePriority: Record<DepthCueKind, number> = {
  apex: 0,
  frenzy: 1,
  rival: 2,
  prey: 3,
};

const edibilityPriority: Record<Edibility, number> = {
  threat: 0,
  even: 1,
  prey: 2,
};

export function edibilityText(edibility: Edibility): string {
  const presentation = EDIBILITY_PRESENTATION[edibility];
  return `${presentation.glyph} ${presentation.label}`;
}

export function buildDepthNavigation(
  state: ClientState | null,
  youId: string | null,
  compact = false,
): DepthNavigationState {
  const me = state?.sharks.find((shark) => shark.id === youId && shark.alive);
  const head = me?.position;
  if (!state || !me || !head) return { depth: 0, apexSelf: false, cues: [] };

  const cues: DepthCue[] = [];
  const apexId = state.round.phase === "apex" ? state.round.apexId : null;
  let apexSelf = false;

  if (apexId === me.id) {
    apexSelf = true;
  } else if (apexId) {
    const apex = state.sharks.find((shark) => shark.id === apexId && shark.alive && shark.position);
    if (apex?.position) {
      const edibility = edibilityFor(me, apex);
      cues.push(cue(
        apex.id,
        "apex",
        apex.name,
        `${edibilityText(edibility)} · Apex target`,
        head,
        me.yaw,
        apex.position,
        edibility,
      ));
    }
  }

  if (state.frenzyUntilTick > state.tick) {
    cues.push(cue(
      "frenzy-center",
      "frenzy",
      "Central column",
      "Feeding Frenzy objective",
      head,
      me.yaw,
      { x: 0, y: (state.seabedY + state.surfaceY) / 2, z: 0 },
    ));
  }

  const rivals = state.sharks
    .filter((shark) => shark.id !== me.id && shark.id !== apexId && shark.alive && shark.position)
    .map((shark) => ({
      shark,
      relation: describeRelativeTarget(head, me.yaw, shark.position!),
      edibility: edibilityFor(me, shark),
    }))
    .filter(({ relation }) => relation.distance <= RIVAL_RANGE)
    .sort((a, b) => (
      edibilityPriority[a.edibility] - edibilityPriority[b.edibility]
      || a.relation.distance - b.relation.distance
    ))
    .slice(0, compact ? 1 : 2);
  for (const { shark, edibility } of rivals) {
    cues.push(cue(
      shark.id,
      "rival",
      shark.name,
      edibilityText(edibility),
      head,
      me.yaw,
      shark.position!,
      edibility,
    ));
  }

  const prey = state.food
    .map((actor) => ({ actor, relation: describeRelativeTarget(head, me.yaw, actor) }))
    .filter(({ relation }) => relation.distance <= PREY_RANGE)
    .sort((a, b) => a.relation.distance - b.relation.distance || b.actor.value - a.actor.value)
    .slice(0, compact ? 1 : 2);
  for (const { actor } of prey) {
    cues.push(cue(actor.id, "prey", preyName(actor), `${actor.value} point prey`, head, me.yaw, actor));
  }

  cues.sort((a, b) => cuePriority[a.kind] - cuePriority[b.kind] || a.distance - b.distance || a.id.localeCompare(b.id));
  return {
    depth: Math.max(0, Math.round(state.surfaceY - head.y)),
    apexSelf,
    cues: cues.slice(0, compact ? 3 : 5),
  };
}

function directionGlyph(bearing: RelativeBearing): string {
  return ({
    ahead: "↑",
    "ahead-right": "↗",
    right: "→",
    "behind-right": "↘",
    behind: "↓",
    "behind-left": "↙",
    left: "←",
    "ahead-left": "↖",
    centered: "•",
  } satisfies Record<RelativeBearing, string>)[bearing];
}

function markerFor(kind: DepthCueKind): string {
  return ({ apex: "◆", rival: "!", prey: "●", frenzy: "◎" } satisfies Record<DepthCueKind, string>)[kind];
}

function verticalText(vertical: VerticalBand): string {
  if (vertical === "above") return "ABOVE ↑";
  if (vertical === "below") return "BELOW ↓";
  return "LEVEL •";
}

function readableBearing(bearing: RelativeBearing): string {
  return bearing.replace("-", " ");
}

export function cueDescription(cue: DepthCue): string {
  return `${cue.detail}: ${cue.label}, ${readableBearing(cue.bearing)}, ${cue.vertical}, ${cue.proximity}, ${cue.distance} meters.`;
}

export function DepthRadar({
  socket,
  visible,
  compact,
}: {
  socket: RoomSocket;
  visible: boolean;
  compact: boolean;
}) {
  const [navigation, setNavigation] = useState<DepthNavigationState>(() => (
    buildDepthNavigation(socket.stateRef.current, socket.youId, compact)
  ));

  useEffect(() => {
    const update = () => setNavigation(buildDepthNavigation(socket.stateRef.current, socket.youId, compact));
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [socket, compact]);

  const classes = `game-depth-radar${compact ? " game-depth-radar--compact" : ""}${visible ? "" : " game-depth-radar--semantic-only"}`;

  return (
    <aside className={classes} aria-label="3D navigation cues">
      <div className="game-depth-radar__header">
        <strong className="game-depth-radar__heading">3D RADAR</strong>
        <span className="game-depth-radar__depth">Depth {navigation.depth}m</span>
      </div>
      {navigation.apexSelf && <p className="game-depth-radar__self-apex">◆ YOU ARE APEX</p>}
      {navigation.cues.length === 0 ? (
        <p className="game-depth-radar__empty">No tracked threats or objectives nearby.</p>
      ) : (
        <ol className="game-depth-radar__list">
          {navigation.cues.map((item) => (
            <li
              key={item.id}
              className={`game-depth-radar__cue game-depth-radar__cue--${item.kind}`}
              aria-label={cueDescription(item)}
            >
              <span className="game-depth-radar__marker" aria-hidden="true">{markerFor(item.kind)}</span>
              <span className="game-depth-radar__identity" aria-hidden="true">
                {item.label} <span className="game-depth-radar__detail">{item.detail}</span>
              </span>
              <span className="game-depth-radar__vector" aria-hidden="true">
                <span>{directionGlyph(item.bearing)}</span>
                <span className="game-depth-radar__vertical">{verticalText(item.vertical)}</span>
                <span className="game-depth-radar__range">{item.proximity.toUpperCase()} · {item.distance}m</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
