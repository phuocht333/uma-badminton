import { useEffect, useRef, useState } from "react";
import { Link } from "@remix-run/react";
import { CheckCircle2, X } from "lucide-react";
import { formatVND } from "~/lib/format";

interface AutoMatchResultLike {
  passRequestId: string;
  passSlotterUserId: string;
  vangLaiUserId: string;
  payment: {
    toPassSlotter: number;
    toQuyExtra: number;
    fromQuyShortage: number;
  };
}

export interface AutoMatchToastProps {
  /** The auto-match result returned by the action — set when one just happened. */
  autoMatch?: AutoMatchResultLike;
  /** Current user's id — decides which side of the match to render. */
  meUserId: string;
  /** Names looked up server-side and threaded through. */
  passSlotterName?: string;
  vangLaiName?: string;
  /** How long to auto-dismiss in ms. */
  durationMs?: number;
}

const DEFAULT_DURATION_MS = 6000;

/**
 * Bottom-fixed toast that fires once per auto-match event. Two variants based
 * on which side of the match the current user is:
 *
 *   - You triggered request-pass → you are the pass-slotter → toast tells
 *     you who took it and how much they'll send.
 *   - You triggered register-vang-lai → you are the vãng lai → toast tells
 *     you whose slot you got and how much to send (with a link to the QR
 *     in Thanh toán).
 *
 * Idempotent against re-renders: the `passRequestId` is tracked in a ref so
 * the same match never re-toasts (otherwise navigating back to /trang-chu
 * after a match would re-trigger it from the stale actionData).
 */
export function AutoMatchToast({
  autoMatch,
  meUserId,
  passSlotterName,
  vangLaiName,
  durationMs = DEFAULT_DURATION_MS,
}: AutoMatchToastProps) {
  const lastShownIdRef = useRef<string | null>(null);
  const [visible, setVisible] = useState<AutoMatchResultLike | null>(null);

  useEffect(() => {
    if (!autoMatch) return;
    if (lastShownIdRef.current === autoMatch.passRequestId) return;
    lastShownIdRef.current = autoMatch.passRequestId;
    setVisible(autoMatch);
    const t = setTimeout(() => setVisible(null), durationMs);
    return () => clearTimeout(t);
  }, [autoMatch, durationMs]);

  if (!visible) return null;

  const isPassSlotter = visible.passSlotterUserId === meUserId;
  const isVangLai = visible.vangLaiUserId === meUserId;
  if (!isPassSlotter && !isVangLai) return null;

  const amount = formatVND(visible.payment.toPassSlotter);
  const headline = isPassSlotter
    ? `Slot của bạn được ${vangLaiName ?? "thành viên khác"} nhận`
    : `Đã nhận pass slot của ${passSlotterName ?? "thành viên khác"}`;
  const body = isPassSlotter
    ? `${vangLaiName ?? "Họ"} sẽ chuyển ${amount} cho bạn.`
    : `Chuyển ${amount} cho ${passSlotterName ?? "họ"}.`;
  const cta = isPassSlotter ? "Vào Thanh toán" : "Xem QR + xác nhận";

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex justify-center px-4"
    >
      <div className="pointer-events-auto w-full max-w-sm overflow-hidden rounded-xl border border-accent/30 bg-accent-tint shadow-drop-modal">
        <div className="flex items-start gap-3 p-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent-deep" aria-hidden="true" />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-body-md font-medium text-ink">{headline}</p>
            <p className="text-body-sm text-body">{body}</p>
            <Link
              to="/thanh-toan"
              prefetch="intent"
              className="mt-1 inline-block text-body-sm text-accent-deep underline-offset-2 hover:underline"
              onClick={() => setVisible(null)}
            >
              {cta} →
            </Link>
          </div>
          <button
            type="button"
            onClick={() => setVisible(null)}
            aria-label="Đóng thông báo"
            className="shrink-0 rounded-sm p-1 text-muted hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
