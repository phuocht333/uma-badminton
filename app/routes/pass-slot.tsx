import { redirect, type LoaderFunctionArgs } from "@remix-run/cloudflare";

// Pass-slot UX now lives on every session card on /trang-chu.
// Keep this route as a redirect for old bookmarks/links.
export async function loader(_args: LoaderFunctionArgs) {
  throw redirect("/trang-chu");
}

export default function PassSlotRedirect() {
  return null;
}
