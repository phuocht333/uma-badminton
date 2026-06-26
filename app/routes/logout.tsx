import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/cloudflare";
import { logout } from "~/lib/auth.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const { cookieHeader } = await logout(request, context);
  return redirect("/login", { headers: { "Set-Cookie": cookieHeader } });
}

export async function loader(_args: LoaderFunctionArgs) {
  return redirect("/");
}
