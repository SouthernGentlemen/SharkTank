const PUBLIC_BILLING_REDACTED = new Set(["versionId", "bucket"]);

export function publicBillingWindow(value: Record<string, unknown>): Record<string, unknown> {
  return redactDeep(value) as Record<string, unknown>;
}

function redactDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDeep);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (PUBLIC_BILLING_REDACTED.has(key)) continue;
    out[key] = redactDeep(child);
  }
  return out;
}

export function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function publicStatusProjection(data: Record<string, unknown> & { usage?: Record<string, unknown> }) {
  const { billingWindow: _billing, instance: _instance, global: _global, usage = {}, ...publicData } = data;
  const { tankRequests: _requests, auditEvents: _auditEvents, storage: _storage, durableObjects: rawDurableObjects, ...publicUsageRest } = usage;
  const durableObjects = recordValue(rawDurableObjects);
  return {
    publicData,
    publicUsage: {
      ...publicUsageRest,
      durableObjects: {
        tank: numberValue(durableObjects.tank),
        rooms: numberValue(durableObjects.rooms),
        total: numberValue(durableObjects.total),
      },
    },
  };
}
