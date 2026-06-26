import { json, type LoaderFunctionArgs } from "@remix-run/cloudflare";
import { Link, Outlet, useLoaderData, useLocation } from "@remix-run/react";
import { AppShell } from "~/components/app-shell";
import { requireAdmin } from "~/lib/auth.server";
import { cn } from "~/lib/cn";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const user = await requireAdmin(request, context);
  return json({ user });
}

const tabs = [
  { to: "/admin/payments", label: "Thanh toán quỹ" },
  { to: "/admin/members", label: "Thành viên" },
  { to: "/admin/config", label: "Cấu hình" },
];

export default function AdminLayout() {
  const data = useLoaderData<typeof loader>();
  const loc = useLocation();
  return (
    <AppShell user={data.user as never}>
      <div className="space-y-4">
        <div className="border-b">
          <div className="-mb-px flex gap-1 overflow-x-auto">
            {tabs.map((t) => {
              const active = loc.pathname.startsWith(t.to);
              return (
                <Link
                  key={t.to}
                  to={t.to}
                  prefetch="intent"
                  className={cn(
                    "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition",
                    active
                      ? "border-accent-deep text-accent-deep"
                      : "border-transparent text-muted hover:text-ink",
                  )}
                >
                  {t.label}
                </Link>
              );
            })}
          </div>
        </div>
        <Outlet />
      </div>
    </AppShell>
  );
}
