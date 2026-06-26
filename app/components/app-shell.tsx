import { Link, Form, useFetcher, useLocation, useNavigation } from "@remix-run/react";
import { Calendar, Home, LogOut, User as UserIcon, Settings, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import type { User } from "~/db/schema";
import { cn } from "~/lib/cn";

/**
 * Thin progress strip at the very top of the viewport that lights up while
 * Remix is loading the next route. Sits above sticky header. Auto-fades
 * shortly after navigation settles so quick loads don't flash.
 */
function NavigationProgress() {
  const nav = useNavigation();
  const active = nav.state !== "idle";
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (active) {
      setVisible(true);
      return;
    }
    const t = setTimeout(() => setVisible(false), 200);
    return () => clearTimeout(t);
  }, [active]);
  if (!visible) return null;
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden",
        active ? "opacity-100" : "opacity-0",
      )}
    >
      <div className="h-full w-1/3 animate-[progress_1.2s_ease-in-out_infinite] bg-accent" />
    </div>
  );
}

interface Props {
  user: User;
  children: React.ReactNode;
}

const baseNav = [
  { to: "/trang-chu", label: "Trang chủ", icon: Home },
  { to: "/lich", label: "Lịch", icon: Calendar },
  { to: "/thanh-toan", label: "Thanh toán", icon: Wallet },
  { to: "/profile", label: "Cá nhân", icon: UserIcon },
];

export function AppShell({ user, children }: Props) {
  const loc = useLocation();
  const items =
    user.role === "admin"
      ? [...baseNav, { to: "/admin", label: "Quản trị", icon: Settings }]
      : baseNav;

  // Pull the outstanding-payment count lazily after mount — non-blocking so
  // it never delays first paint. Refetches when the user navigates back to
  // /thanh-toan and the count might have just decremented.
  const countFetcher = useFetcher<{ count: number }>();
  useEffect(() => {
    if (countFetcher.state === "idle" && countFetcher.data === undefined) {
      countFetcher.load("/api/outstanding-count");
    }
  }, [countFetcher]);
  useEffect(() => {
    // After leaving /thanh-toan, the user may have just marked something paid
    // — refresh the badge so it reflects reality.
    if (loc.pathname !== "/thanh-toan" && countFetcher.state === "idle") {
      countFetcher.load("/api/outstanding-count");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname]);
  const outstandingCount = countFetcher.data?.count ?? 0;

  return (
    // pb-28 keeps content clear of the 64px tall fixed nav + 16px safe gap
    <div className="min-h-screen pb-28">
      <NavigationProgress />
      <header className="sticky top-0 z-40 border-b border-hairline bg-canvas-soft/80 backdrop-blur-sm">
        <div className="container-mobile flex h-14 items-center justify-between">
          <Link to="/trang-chu" prefetch="intent" className="font-semibold text-ink">
            🏸 UMABadminton
          </Link>
          <div className="flex items-center gap-2">
            <span className="hidden text-body-sm text-muted sm:inline">{user.name}</span>
            <Form method="post" action="/logout">
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-body-sm text-muted hover:bg-surface-strong hover:text-ink"
                aria-label="Đăng xuất"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Đăng xuất</span>
              </button>
            </Form>
          </div>
        </div>
      </header>
      <main className="container-mobile py-6">{children}</main>
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-hairline bg-canvas-soft shadow-drop-card">
        <div
          className={cn(
            "container-mobile grid",
            user.role === "admin" ? "grid-cols-5" : "grid-cols-4",
          )}
        >
          {items.map((it) => {
            const active =
              it.to === "/trang-chu"
                ? loc.pathname === "/trang-chu" || loc.pathname === "/"
                : loc.pathname.startsWith(it.to);
            const Icon = it.icon;
            const showBadge = it.to === "/thanh-toan" && outstandingCount > 0;
            return (
              <Link
                key={it.to}
                to={it.to}
                prefetch="render"
                className={cn(
                  "flex flex-col items-center justify-center gap-1 py-3 text-[15px] transition sm:py-2 sm:text-caption",
                  active ? "text-accent-deep" : "text-muted hover:text-ink",
                )}
              >
                <span className="relative">
                  <Icon className="h-7 w-7 sm:h-5 sm:w-5" aria-hidden="true" />
                  {showBadge && (
                    <span
                      className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#DC2626] px-1 text-[12px] font-medium leading-none text-white sm:-right-1.5 sm:-top-1.5 sm:h-4 sm:min-w-4 sm:text-[10px]"
                      aria-label={`${outstandingCount} khoản chưa thanh toán`}
                    >
                      {outstandingCount > 9 ? "9+" : outstandingCount}
                    </span>
                  )}
                </span>
                <span className="leading-none">{it.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
