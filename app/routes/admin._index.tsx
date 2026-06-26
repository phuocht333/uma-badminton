import { redirect, type LoaderFunctionArgs } from "@remix-run/cloudflare";
import { requireAdmin } from "~/lib/auth.server";

/**
 * Admin landing → Thanh toán quỹ (first admin tab). Per-session court edits
 * happen via /admin/sessions/<id>, reached from trang-chu home cards.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireAdmin(request, context);
  throw redirect("/admin/payments");
}

export default function AdminIndex() {
  return null;
}
