import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { requireUser } from "~/lib/auth.server";
import { getEnv } from "~/lib/env.server";

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  // Require auth so QR images aren't public
  await requireUser(request, context);
  const key = decodeURIComponent(params.key ?? "");
  if (!key) throw new Response("Not found", { status: 404 });
  const env = getEnv(context);
  const obj = await env.R2.get(key);
  if (!obj) throw new Response("Not found", { status: 404 });
  const headers = new Headers();
  headers.set("Content-Type", obj.httpMetadata?.contentType || "image/png");
  headers.set("Cache-Control", "private, max-age=300");
  return new Response(obj.body as ReadableStream, { headers });
}
