import type { AppLoadContext } from "@remix-run/cloudflare";
import type { Env } from "~/../worker";

/**
 * Returns the typed Cloudflare Env from a Remix load context.
 *
 * Routes used to scatter inline casts of `context.cloudflare.env as {...}`
 * with subtly different shapes per route. Centralising the cast here gives a
 * single seam for the env type and lets routes import the canonical `Env`
 * from `worker.ts` without re-declaring it.
 */
export function getEnv(context: AppLoadContext): Env {
  return context.cloudflare.env as Env;
}
