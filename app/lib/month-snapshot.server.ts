/**
 * Month snapshot — serialise the matrix at lock time so the historic /lich
 * bill never moves when admin makes post-lock court adjustments via the
 * session detail page. Home cards remain live (they always read
 * `court_allocations` directly).
 *
 * The snapshot is the exact shape `MonthMatrixData` returns — when present,
 * the matrix builder + bill calculator deserialise instead of re-querying.
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "~/db/client";
import type { MonthMatrixData } from "./month-matrix.server";

export interface MonthSnapshot {
  matrix: MonthMatrixData;
}

export function parseMonthSnapshot(raw: string | null): MonthSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as MonthSnapshot;
    if (parsed && typeof parsed === "object" && parsed.matrix) return parsed;
    return null;
  } catch {
    return null;
  }
}

export async function writeMonthSnapshot(
  d1: D1Database,
  monthId: string,
  snapshot: MonthSnapshot,
): Promise<void> {
  const db = getDb(d1);
  await db
    .update(schema.months)
    .set({ lockedSnapshot: JSON.stringify(snapshot) })
    .where(eq(schema.months.id, monthId));
}
