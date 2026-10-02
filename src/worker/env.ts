export interface Env {
  ASSETS: { fetch: (req: Request) => Promise<Response> };
  ROOM: DurableObjectNamespace;
  LOBBY: DurableObjectNamespace;
  ENVIRONMENT?: string;
  SHARKTANK_RELEASE?: string;
  SHARKTANK_RELEASE_REVISION?: string;
  OPS_USERNAME?: string;
  OPS_TOKEN?: string;
  AUDIT_GENERATION?: string;
  CF_VERSION_METADATA?: WorkerVersionMetadata;
  /** Object storage. Bound in wrangler.jsonc; holds the state copies runBackup writes. */
  R2_ASSETS?: R2Bucket;
  R2_PREFIX?: string;
}

export interface MaintenanceState { enabled: boolean; changedAt: number; reason: string }
