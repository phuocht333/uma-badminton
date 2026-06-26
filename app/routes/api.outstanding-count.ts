import { json, type LoaderFunctionArgs } from "@remix-run/cloudflare";
import { requireUser } from "~/lib/auth.server";
import { getEnv } from "~/lib/env.server";
import { loadOutstandingCount } from "~/lib/payment-summary.server";

/**
 * Lightweight JSON endpoint hit by AppShell on every page mount to drive
 * the "Thanh toán" nav badge. Returns just the integer — no payload weight.
 * Auth required (same session cookie); 401 if not signed in so the badge
 * stays hidden on /login.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const user = await requireUser(request, context);
  const env = getEnv(context);
  const count = await loadOutstandingCount(env.DB, user.id);
  return json({ count });
}
