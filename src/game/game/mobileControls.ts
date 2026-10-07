export type TouchStickKind = "flight" | "look";
export type TouchScheme = "simple" | "dual";
export type TouchSide = "left" | "right";

export interface TouchStickState {
  pointerId: number | null;
  x: number;
  y: number;
}

export interface TwinStickState {
  flight: TouchStickState;
  look: TouchStickState;
}

export interface TouchAxes {
  yaw: number;
  pitch: number;
  lookYaw: number;
  lookPitch: number;
}

export interface TouchLayout {
  flight: TouchSide;
  look: TouchSide;
  actions: TouchSide;
}

export const TOUCH_STICK = {
  radius: 56,
  deadZone: 0.16,
  responseExponent: 1.35,
} as const;

function blankStick(): TouchStickState {
  return { pointerId: null, x: 0, y: 0 };
}

export function makeTwinStickState(): TwinStickState {
  return { flight: blankStick(), look: blankStick() };
}

function otherKind(kind: TouchStickKind): TouchStickKind {
  return kind === "flight" ? "look" : "flight";
}

export function beginStickPointer(
  state: TwinStickState,
  kind: TouchStickKind,
  pointerId: number,
): boolean {
  const stick = state[kind];
  if (!Number.isFinite(pointerId) || stick.pointerId !== null) return false;
  if (state[otherKind(kind)].pointerId === pointerId) return false;
  stick.pointerId = pointerId;
  stick.x = 0;
  stick.y = 0;
  return true;
}

export function radialStickVector(
  dx: number,
  dy: number,
  radius = TOUCH_STICK.radius,
  deadZone = TOUCH_STICK.deadZone,
  responseExponent = TOUCH_STICK.responseExponent,
): { x: number; y: number } {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(radius) || radius <= 0) {
    return { x: 0, y: 0 };
  }
  const distance = Math.hypot(dx, dy);
  const normalized = Math.min(1, distance / radius);
  const dead = Math.max(0, Math.min(0.95, deadZone));
  if (normalized <= dead || distance === 0) return { x: 0, y: 0 };
  const live = (normalized - dead) / (1 - dead);
  const curved = Math.pow(live, Math.max(0.1, responseExponent));
  return {
    x: (dx / distance) * curved,
    y: (dy / distance) * curved,
  };
}

export function moveStickPointer(
  state: TwinStickState,
  kind: TouchStickKind,
  pointerId: number,
  dx: number,
  dy: number,
  radius = TOUCH_STICK.radius,
): { x: number; y: number } | null {
  const stick = state[kind];
  if (stick.pointerId !== pointerId) return null;
  const vector = radialStickVector(dx, dy, radius);
  stick.x = vector.x;
  stick.y = vector.y;
  return vector;
}

export function endStickPointer(
  state: TwinStickState,
  kind: TouchStickKind,
  pointerId: number,
): boolean {
  const stick = state[kind];
  if (stick.pointerId !== pointerId) return false;
  stick.pointerId = null;
  stick.x = 0;
  stick.y = 0;
  return true;
}

export function releaseAllTouchInput(state: TwinStickState | undefined): void {
  if (!state) return;
  state.flight.pointerId = null;
  state.flight.x = 0;
  state.flight.y = 0;
  state.look.pointerId = null;
  state.look.x = 0;
  state.look.y = 0;
}

export function touchAxesForState(
  state: TwinStickState,
  turnAssist = false,
  invertSteer = false,
  scheme: TouchScheme = "dual",
): TouchAxes {
  const assist = turnAssist ? 0.6 : 1;
  const yawDirection = invertSteer ? -1 : 1;
  return {
    yaw: state.flight.x * assist * yawDirection,
    // Browser Y grows downward. Stick-up is therefore negative Y but positive pitch.
    pitch: -state.flight.y * assist,
    lookYaw: scheme === "dual" ? state.look.x : 0,
    // Desktop look-up is negative camera pitch, so screen-up maps naturally to negative Y.
    lookPitch: scheme === "dual" ? state.look.y : 0,
  };
}

export function canUseAbilityPointer(state: TwinStickState, pointerId: number): boolean {
  return pointerId !== state.flight.pointerId && pointerId !== state.look.pointerId;
}

export function touchLayoutForFlightSide(flight: TouchSide): TouchLayout {
  const other: TouchSide = flight === "left" ? "right" : "left";
  return { flight, look: other, actions: other };
}

export function touchNeedsLandscape(width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
  return height > width;
}
