import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { redirect } from "@remix-run/cloudflare";
import { requireUser } from "~/lib/auth.server";

export const meta: MetaFunction = () => [{ title: "UMABadminton" }];

export async function loader({ request, context }: LoaderFunctionArgs) {
  const user = await requireUser(request, context).catch(() => null);
  if (!user) throw redirect("/login");
  throw redirect("/trang-chu");
}

export default function Index() {
  return null;
}
