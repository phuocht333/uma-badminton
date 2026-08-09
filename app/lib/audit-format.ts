/**
 * Audit log display — Vietnamese copy in one place.
 *
 * Two forms:
 *   - `kindLabel`: short label for tables / filter chips (e.g. "Pass xong").
 *   - `describeEvent`: full sentence for per-session history sheets
 *     (e.g. "Phát đã lấy slot của Hùng").
 *
 * Null `actorName` ⇒ system-triggered (cron sweep / auto-instant), not a
 * member or admin action. Several events differentiate copy on that.
 */
import type { AuditKind } from "~/db/schema";

export const kindLabel: Record<AuditKind, string> = {
  pass_requested: "Đăng pass slot",
  pass_cancelled: "Huỷ pass slot",
  pass_locked: "Giữ slot",
  pass_unlocked: "Huỷ giữ slot",
  pass_confirmed: "Lấy slot xong",
  court_added: "Thêm sân",
  court_removed: "Huỷ sân",
  vang_lai_requested: "Đăng ký vãng lai",
  vang_lai_cancelled: "Huỷ đăng ký vãng lai",
  vang_lai_approved: "Duyệt vãng lai",
  vang_lai_rejected: "Từ chối vãng lai",
  pass_rejected: "Từ chối pass slot",
  auto_matched: "Auto-match",
  cutoff_locked: "Khoá đăng ký (cutoff — bỏ)",
  refund_issued: "Hoàn tiền",
  payment_marked: "Đánh dấu đã đóng",
  payment_unmarked: "Huỷ đánh dấu đã đóng",
};

export interface DescribableEvent {
  kind: AuditKind;
  actorName: string | null;
  subjectName: string | null;
  meta: Record<string, unknown> | null;
}

/** Format VND amount inline for audit text — "50.000đ" → "50k" style. */
function shortVnd(amount: number): string {
  if (!amount) return "0";
  if (amount % 1000 === 0) return `${amount / 1000}k`;
  return new Intl.NumberFormat("vi-VN").format(amount) + "đ";
}

export function describeEvent(e: DescribableEvent): string {
  const actor = e.actorName;
  const who = actor ?? "Hệ thống";
  const subject = e.subjectName;
  switch (e.kind) {
    case "pass_requested":
      return `${who} đã pass slot`;
    case "pass_cancelled":
      // Null actor = legacy rows from the removed cutoff sweep (B34). Nothing
      // writes these any more; kept so old history still renders.
      if (actor == null) return "Hệ thống huỷ pass slot (quá hạn cutoff)";
      return `${who} huỷ pass slot`;
    case "pass_locked":
      return `${who} đang giữ slot${subject ? ` của ${subject}` : ""}`;
    case "pass_unlocked":
      return `${who} huỷ giữ slot${subject ? ` của ${subject}` : ""}`;
    case "pass_confirmed": {
      // Item #4 in spec: "A xác nhận đã chuyển 50k cho B [và đã chuyển 10k
      // cho quỹ]" / "A xác nhận đã chuyển 60k cho quỹ". Meta amounts are
      // optional — if absent, fall back to the simpler "đã nhận slot của Y"
      // (manual claim, no breakdown).
      const toOwner = e.meta?.toPassSlotter as number | undefined;
      const toQuy = e.meta?.toQuyExtra as number | undefined;
      const onlyQuy = e.meta?.toQuyOnly as number | undefined;
      if (onlyQuy != null) {
        return `${who} xác nhận đã chuyển ${shortVnd(onlyQuy)} cho quỹ`;
      }
      if (toOwner != null && subject) {
        const parts = [`${who} xác nhận đã chuyển ${shortVnd(toOwner)} cho ${subject}`];
        if (toQuy != null && toQuy > 0) parts.push(`và đã chuyển ${shortVnd(toQuy)} cho quỹ`);
        return parts.join(" ");
      }
      return `${who} đã nhận slot${subject ? ` của ${subject}` : ""}`;
    }
    case "vang_lai_requested":
      return `${who} đã đăng ký vãng lai và đang chờ được pass slot hoặc admin duyệt`;
    case "vang_lai_cancelled":
      return `${who} huỷ đăng ký vãng lai`;
    case "vang_lai_approved":
      // Null actor = auto-instant (under-capacity). Admin actor = manual duyệt.
      if (actor == null) {
        return `Hệ thống tự duyệt vãng lai cho ${subject ?? "thành viên"} (đủ chỗ)`;
      }
      return `${who} đã duyệt đăng ký vãng lai của ${subject ?? "thành viên"}, ${subject ?? "thành viên"} đăng ký vãng lai thành công`;
    case "vang_lai_rejected":
      // Null actor = legacy rows from the removed cutoff sweep (B34).
      if (actor == null) {
        return `Hệ thống từ chối vãng lai của ${subject ?? "thành viên"} (quá hạn cutoff)`;
      }
      return `${who} đã từ chối đăng ký vãng lai của ${subject ?? "thành viên"}, ${subject ?? "thành viên"} đăng ký vãng lai thất bại`;
    case "pass_rejected":
      return `${who} đã từ chối pass slot của ${subject ?? "thành viên"}`;
    case "auto_matched": {
      // Item #3 in spec: "B đã pass slot cho A thành công". Here actor is the
      // claimer (vãng lai) and subject is the original passer.
      const claimer = e.meta?.payerName as string | undefined;
      if (subject && claimer) return `${subject} đã pass slot cho ${claimer} thành công`;
      return `Auto-match thành công${subject ? ` (pass từ ${subject})` : ""}`;
    }
    // Legacy kind — the cutoff was removed in B34, nothing writes this now.
    case "cutoff_locked":
      return "Khoá đăng ký (trước buổi 24h)";
    case "court_added": {
      const code = (e.meta?.courtCode as string) ?? "?";
      const s = (e.meta?.startTime as string) ?? "";
      const en = (e.meta?.endTime as string) ?? "";
      return `${who} thêm sân ${code} ${s}–${en}`;
    }
    case "court_removed": {
      const code = (e.meta?.courtCode as string) ?? "?";
      return `${who} huỷ sân ${code}`;
    }
    case "refund_issued": {
      const reason = (e.meta?.reason as string) ?? null;
      if (reason === "court_removed") {
        return `${subject ?? "Thành viên"} được hoàn tiền (sân bị huỷ)`;
      }
      // Item #7 in spec: admin-initiated pass refund.
      if (actor) return `${who} đã hoàn tiền cho ${subject ?? "thành viên"} từ tiền quỹ`;
      return `${subject ?? "Thành viên"} được hoàn tiền pass slot`;
    }
    case "payment_marked":
      return `${who} đánh dấu đã đóng tiền tháng`;
    case "payment_unmarked":
      return `${who} huỷ đánh dấu đã đóng tiền tháng`;
    default: {
      const _exhaustive: never = e.kind;
      void _exhaustive;
      return String(e.kind);
    }
  }
}
