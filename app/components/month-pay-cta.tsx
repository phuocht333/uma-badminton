/**
 * "Chuyển tháng" CTA — button + dialog for marking the monthly registration
 * fee as paid (member self-confirm; the app never reconciles real bank
 * transfers). Renders either a clickable button (when unpaid) or a "✓ Đã
 * chuyển" badge (when paid).
 *
 * Used from both /lich (per-month summary card) and /trang-chu (unpaid-
 * payment reminder banner). The fetcher posts to `/lich` so all monthly-
 * payment writes flow through a single action handler — the route action
 * stays the single source of truth.
 */
import { useEffect, useState } from "react";
import { useFetcher } from "@remix-run/react";
import { Check, QrCode } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { formatMonthYear } from "~/lib/dates";
import { formatVND } from "~/lib/format";

export interface MonthPayCtaProps {
  monthId: string;
  iPaid: boolean;
  amount: number;
  year: number;
  month: number;
  adminQrUrl: string | null;
  quyMomoLink: string | null;
}

export function MonthPayCta({
  monthId,
  iPaid,
  amount,
  year,
  month,
  adminQrUrl,
  quyMomoLink,
}: MonthPayCtaProps) {
  const [open, setOpen] = useState(false);
  // Submit to /lich's action regardless of which route we render in —
  // keeps the mutation handler in one place.
  const fetcher = useFetcher<{ ok?: true; error?: string }>();
  const submitting = fetcher.state !== "idle";
  const succeeded = fetcher.data?.ok === true;
  const isMobile = useIsTouchDevice();
  const canPayViaMomo = !iPaid && !!quyMomoLink && isMobile;

  useEffect(() => {
    if (succeeded) {
      const t = window.setTimeout(() => setOpen(false), 600);
      return () => window.clearTimeout(t);
    }
  }, [succeeded]);

  function submitConfirm() {
    const fd = new FormData();
    fd.set("intent", "mark-month-paid");
    fd.set("monthId", monthId);
    fetcher.submit(fd, { method: "post", action: "/lich" });
  }

  if (iPaid) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-semantic-success/10 px-2 py-1 text-body-sm font-medium text-semantic-success">
        <Check className="h-4 w-4" /> Đã chuyển
      </span>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="accent"
        size="sm"
        onClick={() => setOpen(true)}
      >
        Chuyển tháng
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Chuyển {formatVND(amount)} cho Quỹ chung</DialogTitle>
            <DialogDescription>
              Tiền tháng {formatMonthYear(year, month)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {canPayViaMomo ? (
              <p className="rounded-md border border-hairline bg-canvas-soft p-3 text-body-sm text-muted">
                Bấm <strong>"Thanh toán qua MoMo"</strong> để mở app MoMo. Khi
                app mở thành công, hệ thống sẽ tự ghi nhận đã chuyển.
              </p>
            ) : adminQrUrl ? (
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-caption text-muted">
                  <QrCode className="h-3.5 w-3.5" /> QR chuyển khoản quỹ
                </p>
                <img
                  src={adminQrUrl}
                  alt="QR quỹ chung"
                  width={240}
                  height={240}
                  loading="lazy"
                  className="rounded-md border border-hairline bg-white"
                />
              </div>
            ) : (
              <p className="rounded-md border border-hairline bg-surface-strong p-3 text-body-sm text-muted">
                Admin chưa upload QR quỹ. Liên hệ Admin để lấy thông tin chuyển
                khoản.
              </p>
            )}
          </div>
          {fetcher.data?.error && (
            <p className="text-body-sm text-semantic-error">{fetcher.data.error}</p>
          )}
          <DialogFooter>
            {canPayViaMomo && (
              <Button asChild variant="accent" disabled={submitting || succeeded}>
                <a
                  href={quyMomoLink ?? "#"}
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
            {!canPayViaMomo && (
              <Button
                type="button"
                variant="accent"
                onClick={submitConfirm}
                disabled={submitting || succeeded}
              >
                {submitting ? "Đang xử lý..." : succeeded ? "Đã ghi nhận" : "Tôi đã chuyển"}
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Đóng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
