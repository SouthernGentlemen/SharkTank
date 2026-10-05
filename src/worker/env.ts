export interface Env {
  ASSETS: { fetch: (req: Request) => Promise<Response> };
  ROOM: DurableObjectNamespace;
  ENVIRONMENT?: string;
  SHARKTANK_RELEASE?: string;
  SHARKTANK_RELEASE_REVISION?: string;
}
