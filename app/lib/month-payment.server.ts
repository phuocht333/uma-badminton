/**
 * Member self-marks "đã đóng tiền tháng" for a `done` month. The app never
 * reconciles real bank transfers — this is a member-managed flag, same posture
 * as vãng lai quỹ payment + pass-slot confirm.
 *
 * Single home for the state transition. Idempotent: re-clicking after marked
 * paid returns `ok: true` (with `alreadyPaid: true` for the caller to skip
 * audit / toast spam).
 *
 * Audit kind `payment_marked` already declared in `schema.AuditKind`; the
 * audit-format helper renders the Vietnamese copy.
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "~/db/client";
import { audit } from "./audit.server";
import { computeMemberTotals } from "./vote.server";

export type MarkMonthPaidResult =
  | { ok: true; alreadyPaid?: boolean }
  | { error: string };

export async function markMonthPaid(
  d1: D1Database,
  userId: string,
  monthId: string,
): Promise<MarkMonthPaidResult> {
  const db = getDb(d1);
  const month = await db.query.months.findFirst({
    where: eq(schema.months.id, monthId),
  });
  if (!month) return { error: "Không tìm thấy tháng." };
  if (month.status !== "done") {
    return { error: "Chỉ chuyển tiền tháng sau khi 'Đã đặt sân'." };
  }

  const existing = await db.query.memberMonthPayments.findFirst({
    where: and(
      eq(schema.memberMonthPayments.userId, userId),
      eq(schema.memberMonthPayments.monthId, monthId),
    ),
  });
  if (existing) return { ok: true, alreadyPaid: true };

  const now = Date.now();
  await db.insert(schema.memberMonthPayments).values({
    userId,
    monthId,
    paidAt: now,
  });
  await audit(d1, {
    kind: "payment_marked",
    actorUserId: userId,
    subjectUserId: userId,
    meta: { monthId },
  });
  return { ok: true };
}

/**
 * Load the set of user IDs that have marked "đã đóng" for the given month.
 * Used by /lich to drive the ✓ glyph on the matrix.
 */
export async function loadPaidUserIds(
  d1: D1Database,
  monthId: string,
): Promise<Set<string>> {
  const db = getDb(d1);
  const rows = await db.query.memberMonthPayments.findMany({
    where: eq(schema.memberMonthPayments.monthId, monthId),
  });
  return new Set(rows.map((r) => r.userId));
}

export interface PendingMonthPayment {
  monthId: string;
  year: number;
  month: number;
  totalFee: number;
}

/**
 * Done months on which the caller owes money and hasn't self-marked paid.
 * Powers the trang-chu reminder banner. Cheap by design: walks `done` months
 * (typically 1–3 at a time) and runs `computeMemberTotals` per one.
 */
export async function loadPendingMonthPayments(
  d1: D1Database,
  userId: string,
): Promise<PendingMonthPayment[]> {
  const db = getDb(d1);
  const doneMonths = await db.query.months.findMany({
    where: eq(schema.months.status, "done"),
  });
  if (doneMonths.length === 0) return [];

  const monthIds = doneMonths.map((m) => m.id);
  const myPayments = await db.query.memberMonthPayments.findMany({
    where: and(
      eq(schema.memberMonthPayments.userId, userId),
      inArray(schema.memberMonthPayments.monthId, monthIds),
    ),
  });
  const paidMonthIds = new Set(myPayments.map((p) => p.monthId));

  const unpaidMonths = doneMonths.filter((m) => !paidMonthIds.has(m.id));
  // Compute fees only for unpaid months so a fully-paid member skips the
  // (votes + prices) query entirely.
  const results: PendingMonthPayment[] = [];
  for (const m of unpaidMonths) {
    const totals = await computeMemberTotals(d1, m.year, m.month);
    const mine = totals.get(userId);
    if (!mine || mine.totalFee <= 0) continue;
    results.push({
      monthId: m.id,
      year: m.year,
      month: m.month,
      totalFee: mine.totalFee,
    });
  }
  // Older month first — oldest debts surface up top.
  return results.sort((a, b) => a.year * 100 + a.month - (b.year * 100 + b.month));
}
