import type { NetShark, NetState } from "../../protocol/index.js";

export type ClientShark = NetShark;
export type ClientState = NetState;

export function toClientShark(shark: NetShark): ClientShark {
  return shark;
}
export function toClientState(state: NetState): ClientState {
  return state;
}
