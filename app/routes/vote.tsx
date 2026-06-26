import { redirect, type LoaderFunctionArgs } from "@remix-run/cloudflare";

/**
 * Legacy /vote route — the standalone vote page has been merged into /lich,
 * where each voting month renders its form inline next to its bill and matrix.
 *
 * Kept as a redirect so existing email links (`${APP_BASE_URL}/vote`) stay
 * valid. New code should link to /lich (optionally with `#thang-<monthId>`).
 */
export async function loader(_args: LoaderFunctionArgs) {
  throw redirect("/lich");
}

export default function VoteRedirect() {
  return null;
}
