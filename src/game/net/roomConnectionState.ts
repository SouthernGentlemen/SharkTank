export const FULL_RETRY_MS = 5_000;
export const UNREACHABLE_ATTEMPTS = 3;

export type ConnectionStatus =
  | "connecting"
  | "reconnecting"
  | "open"
  | "full"
  | "unreachable"
  | "incompatible";

export interface ConnectionTransition {
  status: ConnectionStatus;
  failedAttempts: number;
  retryInMs: number | null;
}

export function connectionAfterClose(code: number, reason: string, failedAttempts: number): ConnectionTransition {
  if (code === 1013 && reason === "room full") {
    return { status: "full", failedAttempts: 0, retryInMs: FULL_RETRY_MS };
  }
  const failures = failedAttempts + 1;
  if (failures >= UNREACHABLE_ATTEMPTS) {
    return { status: "unreachable", failedAttempts: failures, retryInMs: null };
  }
  return {
    status: "reconnecting",
    failedAttempts: failures,
    retryInMs: Math.min(4_000, 250 * 2 ** failures),
  };
}

export function connectionAfterWelcome(): ConnectionTransition {
  return { status: "open", failedAttempts: 0, retryInMs: null };
}
