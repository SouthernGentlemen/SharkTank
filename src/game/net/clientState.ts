import type { Vec3 } from "../../engine/index.js";
import type { NetSnake, NetState } from "../../protocol/index.js";

/** Protocol 11 compatibility ends here; presentation uses one shark position. */
export type ClientSnake = Omit<NetSnake, "segments" | "boosting" | "chargeTicks"> & {
  position: Vec3 | undefined;
};
export type ClientState = Omit<NetState, "snakes"> & { snakes: ClientSnake[] };

export function toClientSnake(shark: NetSnake): ClientSnake {
  const { segments, boosting: _boosting, chargeTicks: _chargeTicks, ...fields } = shark;
  return { ...fields, position: segments[0] };
}

export function toClientState(state: NetState): ClientState {
  return { ...state, snakes: state.snakes.map(toClientSnake) };
}
