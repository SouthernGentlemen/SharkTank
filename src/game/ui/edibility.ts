export type Edibility = "prey" | "even" | "threat";

export interface EdibilityPresentation {
  color: string;
  glyph: "▼" | "■" | "▲";
  label: "eat" | "even" | "danger";
}

export const EDIBILITY_PRESENTATION = {
  prey: { color: "#6ff0a3", glyph: "▼", label: "eat" },
  even: { color: "#ffd54a", glyph: "■", label: "even" },
  threat: { color: "#ff8f8f", glyph: "▲", label: "danger" },
} as const satisfies Record<Edibility, EdibilityPresentation>;

export function edibilityFor(
  me: { length: number },
  other: { length: number },
): Edibility {
  if (me.length >= other.length * 1.5) return "prey";
  if (other.length >= me.length * 1.5) return "threat";
  return "even";
}
