export type ResolvedQuality = "low" | "medium" | "high";
export type QualityChoice = ResolvedQuality | "auto";

export function resolveQuality(choice: QualityChoice, device = browserQualityDevice()): ResolvedQuality {
  if (choice !== "auto") return choice;
  return device.coarsePointer || (device.memoryGb !== undefined && device.memoryGb <= 4)
    ? "medium" : "high";
}

function browserQualityDevice(): { coarsePointer: boolean; memoryGb?: number } {
  return {
    coarsePointer: typeof window !== "undefined" && Boolean(window.matchMedia?.("(pointer: coarse)").matches),
    memoryGb: typeof navigator === "undefined" ? undefined
      : (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
  };
}
