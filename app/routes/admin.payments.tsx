/**
 * Fund-wide payments view for admin. Same `PendingPaymentItem` shape and
 * sub-components as `/thanh-toan` so the UI stays consistent — only the
 * loader source (fund-wide vs. me-only) and the confirm intent differ.
 *
 * Quỹ cần trả = unpaid refunds owed to members.
 * Quỹ cần thu = vãng-lai → quỹ amounts pending from members.
 */
import { useEffect, useState } from "react";
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { ArrowDownLeft, ArrowUpRight, Copy, Phone, QrCode } from "lucide-react";
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
import { requireAdmin } from "~/lib/auth.server";
import { getEnv } from "~/lib/env.server";
import { formatVND } from "~/lib/format";
import { formatDateTime } from "~/lib/dates";
import { cn } from "~/lib/cn";
import {
  loadFundPayments,
  markRefundPaid,
  type PendingPaymentItem,
} from "~/lib/payment-summary.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireAdmin(request, context);
  const env = getEnv(context);
  const [pending, done] = await Promise.all([
    loadFundPayments(env.DB, { paid: false }),
    loadFundPayments(env.DB, { paid: true }),
  ]);
  return json({ pending, done });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const admin = await requireAdmin(request, context);
  const env = getEnv(context);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const targetId = String(form.get("targetId") || "");
  if (!targetId) return json({ error: "Thiếu tham số" }, { status: 400 });
  if (intent === "fund-mark-refund-paid") {
    const r = await markRefundPaid(env.DB, targetId, admin.id);
    if ("error" in r) return json({ error: r.error }, { status: r.status ?? 400 });
    return json({ ok: true });
  }
  return json({ error: "intent không hợp lệ" }, { status: 400 });
}

type Tab = "pending" | "done";

export default function AdminPaymentsRoute() {
  const data = useLoaderData<typeof loader>();
  const [tab, setTab] = useState<Tab>("pending");
  const current = tab === "pending" ? data.pending : data.done;
  const hasAny = current.outgoing.length > 0 || current.incoming.length > 0;

  return (
    <div>
      <p className="mb-3 rounded-md border border-hairline bg-canvas-soft px-3 py-2 text-caption text-muted">
        Chỉ gồm thanh toán pass slot, vãng lai. Không bao gồm tiền đóng tháng.
      </p>
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
              ? "Quỹ không có giao dịch nào đang chờ."
              : "Chưa có giao dịch nào hoàn tất."}
          </p>
        )}
        {current.outgoing.length > 0 && (
          <Section
            title={tab === "pending" ? "Quỹ cần trả" : "Quỹ đã trả"}
            tone="warn"
            items={current.outgoing}
          />
        )}
        {current.incoming.length > 0 && (
          <Section
            title={tab === "pending" ? "Quỹ cần thu" : "Quỹ đã thu"}
            tone="info"
            items={current.incoming}
          />
        )}
      </div>
    </div>
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
  tone,
  items,
}: {
  title: string;
  tone: "warn" | "info";
  items: PendingPaymentItem[];
}) {
  const eyebrow = tone === "warn" ? "text-[#B45309]" : "text-accent-deep";
  return (
    <section className="space-y-3">
      <header>
        <p className={`eyebrow ${eyebrow}`}>{title}</p>
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
      ? "Đã trả"
      : "Đã thu"
    : item.direction === "out"
      ? "Trả cho"
      : "Thu từ";
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
                {item.direction === "out" ? "Đã trả lúc" : "Đã thu lúc"}{" "}
                {formatDateTime(item.paidAt)}
              </p>
            )}
          </div>
        </div>
        {item.confirm ? (
          <span className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-body-sm font-medium text-accent-on">
            Đánh dấu đã trả
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
      ? `Quỹ đã trả ${formatVND(item.amount)} cho ${item.counterpartyName}`
      : `Quỹ đã thu ${formatVND(item.amount)} từ ${item.counterpartyName}`
    : item.direction === "out"
      ? `Trả ${formatVND(item.amount)} cho ${item.counterpartyName}`
      : `Thu ${formatVND(item.amount)} từ ${item.counterpartyName}`;

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
                : "Hoàn tiền pass slot"}{" "}
            · <WeekdayDate weekday={item.sessionWeekday} date={item.sessionDate} />
          </DialogDescription>
        </DialogHeader>
        {item.direction === "out" ? (
          <div className="space-y-3">
            {canPayViaMomo ? (
              <p className="rounded-md border border-hairline bg-canvas-soft p-3 text-body-sm text-muted">
                Bấm <strong>"Trả qua MoMo"</strong> để mở app MoMo. Khi app mở
                thành công, quỹ sẽ tự ghi nhận đã trả.
              </p>
            ) : item.counterpartyQrUrl ? (
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-caption text-muted">
                  <QrCode className="h-3.5 w-3.5" /> QR nhận tiền của{" "}
                  {item.counterpartyName}
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
              Chờ {item.counterpartyName} chuyển tiền cho quỹ. Khi member tự
              mark "Đã thanh toán" thì khoản này tự biến mất.
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
                    : "Trả qua MoMo →"}
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
              {submitting ? "Đang xử lý..." : succeeded ? "Đã ghi nhận" : "Đã trả"}
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
      // older browsers without clipboard api — ignore silently.
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

function useIsTouchDevice(): boolean {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setTouch(window.matchMedia("(pointer: coarse)").matches);
  }, []);
  return touch;
}

// Suppress eyebrow.warn unused warning when only one tone branch is used.
void Card;
void CardContent;
