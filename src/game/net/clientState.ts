import type { Vec3 } from "../../engine/index.js";
import type { NetShark, NetState } from "../../protocol/index.js";

/** Protocol 11 compatibility ends here; presentation uses one shark position. */
export type ClientShark = Omit<NetShark, "segments" | "boosting" | "chargeTicks"> & {
  position: Vec3 | undefined;
};
export type ClientState = Omit<NetState, "snakes"> & { sharks: ClientShark[] };

export function toClientShark(shark: NetShark): ClientShark {
  const { segments, boosting: _boosting, chargeTicks: _chargeTicks, ...fields } = shark;
  return { ...fields, position: segments[0] };
}

export function toClientState(state: NetState): ClientState {
  const { snakes, ...fields } = state;
  return { ...fields, sharks: snakes.map(toClientShark) };
}
