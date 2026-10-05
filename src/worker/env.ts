import type { EdgeEnv } from "../../platform/wg-edge/index.d.ts";

export interface Env extends EdgeEnv {
  ASSETS: { fetch: (req: Request) => Promise<Response> };
  ROOM: DurableObjectNamespace;
}
