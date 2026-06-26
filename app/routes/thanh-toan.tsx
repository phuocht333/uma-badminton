import { useEffect, useState } from "react";
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { ArrowDownLeft, ArrowUpRight, Copy, Phone, QrCode } from "lucide-react";
import { AppShell } from "~/components/app-shell";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { WeekdayDate } from "~/components/weekday-date";
import { requireUser } from "~/lib/auth.server";
import { getEnv } from "~/lib/env.server";
import { formatVND } from "~/lib/format";
import {
  loadDonePayments,
  loadPendingPayments,
  markVangLaiPaid,
  type PendingPaymentItem,
} from "~/lib/payment-summary.server";
import { confirmPass } from "~/lib/pass-slot.server";
import { formatDateTime } from "~/lib/dates";
import { cn } from "~/lib/cn";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const user = await requireUser(request, context);
  const env = getEnv(context);
  const [pending, done] = await Promise.all([
    loadPendingPayments(env.DB, user.id),
    loadDonePayments(env.DB, user.id),
  ]);
  return json({ user, pending, done });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const user = await requireUser(request, context);
  const env = getEnv(context);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const targetId = String(form.get("targetId") || "");
  if (!targetId) return json({ error: "Thiếu tham số" }, { status: 400 });

  if (intent === "confirm-pass-payment") {
    const result = await confirmPass(env.DB, user.id, targetId);
    if ("error" in result) {
      return json({ error: result.error }, { status: result.status ?? 400 });
    }
    return json({ ok: true });
  }
  if (intent === "mark-vang-lai-paid") {
    const result = await markVangLaiPaid(env.DB, user.id, targetId);
    if ("error" in result) {
      return json({ error: result.error }, { status: result.status ?? 400 });
    }
    return json({ ok: true });
  }
  return json({ error: "intent không hợp lệ" }, { status: 400 });
}

type Tab = "pending" | "done";

export default function ThanhToanRoute() {
  const data = useLoaderData<typeof loader>();
  const [tab, setTab] = useState<Tab>("pending");
  const current = tab === "pending" ? data.pending : data.done;
  const hasAny = current.outgoing.length > 0 || current.incoming.length > 0;

  return (
    <AppShell user={data.user as never}>
      <div>
        <div className="border-b">
          <div role="tablist" className="-mb-px flex gap-1 overflow-x-auto">
            <TabButton active={tab === "pending"} onClick={() => setTab("pending")}>
              Đang chờ
            </TabButton>
            <TabButton active={tab === "done"} onClick={() => setTab("done")}>
              Đã xong
            </TabButton>
          </div>
        </div>

        <div className="mt-3 space-y-4 rounded-lg border border-hairline bg-surface-card p-4">
          {!hasAny && (
            <p className="py-6 text-center text-body-sm text-muted">
              {tab === "pending"
                ? "Không có giao dịch nào đang chờ."
                : "Chưa có giao dịch nào hoàn tất."}
            </p>
          )}

          {current.outgoing.length > 0 && (
            <Section
              title={tab === "pending" ? "Cần trả" : "Đã trả"}
              tone="warn"
              items={current.outgoing}
            />
          )}

          {current.incoming.length > 0 && (
            <Section
              title={tab === "pending" ? "Cần thu" : "Đã thu"}
              subtitle={
                tab === "pending"
                  ? `${current.incoming.length} người sẽ chuyển tiền cho bạn — chờ họ xác nhận.`
                  : undefined
              }
              tone="info"
              items={current.incoming}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition",
        active
          ? "border-accent-deep text-accent-deep"
          : "border-transparent text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function Section({
  title,
  subtitle,
  tone,
  items,
}: {
  title: string;
  subtitle?: string;
  tone: "warn" | "info";
  items: PendingPaymentItem[];
}) {
  const eyebrow =
    tone === "warn" ? "text-[#B45309]" : "text-accent-deep";
  return (
    <section className="space-y-3">
      <header className="space-y-0.5">
        <p className={`eyebrow ${eyebrow}`}>{title}</p>
        {subtitle && <p className="text-body-sm text-muted">{subtitle}</p>}
      </header>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id}>
            <PaymentRow item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PaymentRow({ item }: { item: PendingPaymentItem }) {
  const [open, setOpen] = useState(false);
  const done = item.paidAt !== undefined;
  const Icon = item.direction === "out" ? ArrowUpRight : ArrowDownLeft;
  const tone = done
    ? "border-hairline bg-surface-card"
    : item.direction === "out"
      ? "border-[#F59E0B]/40 bg-[#FFFBEB]"
      : "border-accent/30 bg-accent-tint";
  const iconTone = done
    ? "text-muted"
    : item.direction === "out"
      ? "text-[#B45309]"
      : "text-accent-deep";
  const verb = done
    ? item.direction === "out"
      ? "Đã chuyển cho"
      : "Đã nhận từ"
    : item.direction === "out"
      ? "Chuyển cho"
      : "Nhận từ";
  const kindLabel =
    item.kind === "pass_slot"
      ? "Pass slot"
      : item.kind === "vang_lai_quy"
        ? "Vãng lai → quỹ"
        : "Hoàn tiền pass slot";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition hover:shadow-drop-soft ${tone}`}
      >
        <div className="flex items-center gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-canvas-soft ${iconTone}`}
            aria-hidden="true"
          >
            <Icon className="h-4 w-4" />
          </span>
          <div className="space-y-0.5">
            <p className="text-body-md text-ink">
              <span className="font-medium">{formatVND(item.amount)}</span>{" "}
              <span className="text-muted">·</span>{" "}
              <span>
                {verb} <strong>{item.counterpartyName}</strong>
              </span>
            </p>
            <p className="text-caption text-muted">
              {kindLabel} · Buổi{" "}
              <WeekdayDate weekday={item.sessionWeekday} date={item.sessionDate} />
            </p>
            {done && item.paidAt !== undefined && (
              <p className="text-caption text-muted">
                {item.direction === "out" ? "Đã trả lúc" : "Đã nhận lúc"}{" "}
                {formatDateTime(item.paidAt)}
              </p>
            )}
          </div>
        </div>
        {item.confirm ? (
          <span className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-body-sm font-medium text-accent-on">
            Thanh toán
          </span>
        ) : !done ? (
          <span className="shrink-0 text-caption text-muted">Chi tiết →</span>
        ) : null}
      </button>
      <PaymentDialog open={open} onOpenChange={setOpen} item={item} />
    </>
  );
}

function PaymentDialog({
  open,
  onOpenChange,
  item,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item: PendingPaymentItem;
}) {
  const fetcher = useFetcher<{ ok?: true; error?: string }>();
  const submitting = fetcher.state !== "idle";
  const succeeded = fetcher.data?.ok;
  const isMobile = useIsTouchDevice();
  const canPayViaMomo =
    item.direction === "out" && !!item.counterpartyMomoLink && isMobile;

  function submitConfirm() {
    if (!item.confirm) return;
    const fd = new FormData();
    fd.set("intent", item.confirm.intent);
    fd.set("targetId", item.confirm.targetId);
    fetcher.submit(fd, { method: "post" });
  }

  const done = item.paidAt !== undefined;
  const verbPhrase = done
    ? item.direction === "out"
      ? `Đã chuyển ${formatVND(item.amount)} cho ${item.counterpartyName}`
      : `Đã nhận ${formatVND(item.amount)} từ ${item.counterpartyName}`
    : item.direction === "out"
      ? `Chuyển ${formatVND(item.amount)} cho ${item.counterpartyName}`
      : `${item.counterpartyName} sẽ chuyển ${formatVND(item.amount)} cho bạn`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{verbPhrase}</DialogTitle>
          <DialogDescription>
            {item.kind === "pass_slot"
              ? "Pass slot"
              : item.kind === "vang_lai_quy"
                ? "Vãng lai → quỹ"
                : "Hoàn tiền pass slot"} ·{" "}
            <WeekdayDate weekday={item.sessionWeekday} date={item.sessionDate} />
          </DialogDescription>
        </DialogHeader>

        {item.direction === "out" ? (
          <div className="space-y-3">
            {canPayViaMomo ? (
              <p className="rounded-md border border-hairline bg-canvas-soft p-3 text-body-sm text-muted">
                Bấm <strong>"Thanh toán qua MoMo"</strong> để mở app MoMo. Khi
                app mở thành công, hệ thống sẽ tự ghi nhận đã thanh toán.
              </p>
            ) : item.counterpartyQrUrl ? (
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-caption text-muted">
                  <QrCode className="h-3.5 w-3.5" /> QR chuyển khoản
                </p>
                <img
                  src={item.counterpartyQrUrl}
                  alt={`QR ${item.counterpartyName}`}
                  width={240}
                  height={240}
                  loading="lazy"
                  className="rounded-md border border-hairline bg-white"
                />
              </div>
            ) : (
              <p className="rounded-md border border-hairline bg-surface-strong p-3 text-body-sm text-muted">
                {item.counterpartyName} chưa upload QR.
              </p>
            )}
            <PhoneRow phone={item.counterpartyPhone} />
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-body-sm text-body">
              Đang chờ {item.counterpartyName} xác nhận đã chuyển tiền. Khi xong, mục
              này sẽ tự biến mất.
            </p>
            <PhoneRow phone={item.counterpartyPhone} />
          </div>
        )}

        {fetcher.data?.error && (
          <p className="text-body-sm text-semantic-error">{fetcher.data.error}</p>
        )}

        <DialogFooter>
          {item.confirm && canPayViaMomo && (
            <Button asChild variant="accent" disabled={submitting || succeeded}>
              <a
                href={item.counterpartyMomoLink ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  if (submitting || succeeded) {
                    e.preventDefault();
                    return;
                  }
                  submitConfirm();
                }}
              >
                {submitting
                  ? "Đang xử lý..."
                  : succeeded
                    ? "Đã ghi nhận"
                    : "Thanh toán qua MoMo →"}
              </a>
            </Button>
          )}
          {item.confirm && !canPayViaMomo && (
            <Button
              type="button"
              variant="accent"
              onClick={submitConfirm}
              disabled={submitting || succeeded}
            >
              {submitting ? "Đang xử lý..." : succeeded ? "Đã ghi nhận" : "Đã thanh toán"}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Đóng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** True on touch-primary devices (phones, tablets). Defaults to false during
 * SSR / before hydration so the desktop QR layout renders for any non-JS user. */
function useIsTouchDevice(): boolean {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setTouch(window.matchMedia("(pointer: coarse)").matches);
  }, []);
  return touch;
}

function PhoneRow({ phone }: { phone: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!phone) {
    return (
      <p className="flex items-center gap-1.5 text-caption text-muted">
        <Phone className="h-3.5 w-3.5" /> Chưa có số điện thoại.
      </p>
    );
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(phone!);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Older browsers without clipboard API — ignore silently.
    }
  }
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-hairline bg-surface-strong px-3 py-2">
      <span className="flex items-center gap-1.5 text-body-sm">
        <Phone className="h-3.5 w-3.5 text-muted" />
        <a href={`tel:${phone}`} className="font-mono text-ink underline-offset-2 hover:underline">
          {phone}
        </a>
      </span>
      <Button type="button" variant="ghost" size="sm" onClick={copy} className="gap-1">
        <Copy className="h-3.5 w-3.5" />
        {copied ? "Đã chép" : "Chép"}
      </Button>
    </div>
  );
}
