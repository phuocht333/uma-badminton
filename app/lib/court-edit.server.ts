/**
 * Add / remove courts on a single session — shared between `/lich`'s
 * CourtEditDialog and `/admin/sessions/<id>`. Encapsulates the validation,
 * audit emission, and downstream cascade (remove → FIFO refund pending
 * pass requests) so both routes stay thin.
 *
 * Add is deliberately decoupled from vãng lai approval (per decision B28):
 * admin must approve each pending vãng lai request explicitly after adding
 * a court.
 */
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { getDb, schema } from "~/db/client";
import { audit } from "./audit.server";
import { refundPendingPassRequests } from "./extra-slot.server";
import { normalizeHHMM } from "./time-input";

export type CourtEditResult = { ok: true } | { error: string; status?: number };

const HHMM = /^\d{2}:\d{2}$/;

export async function addCourtToSession(
  d1: D1Database,
  args: {
    sessionId: string;
    courtCode: string;
    startTime: string;
    endTime: string;
    adminUserId: string;
  },
): Promise<CourtEditResult> {
  const courtCode = args.courtCode.trim().toUpperCase();
  // Accept lenient input ("8" / "8:00" / "08:00") and normalise to strict
  // HH:mm before storage. Server-side normalisation defends against direct
  // API calls that skip the client-side normaliser.
  const startTime = normalizeHHMM(args.startTime);
  const endTime = normalizeHHMM(args.endTime);
  if (!args.sessionId || !courtCode || !HHMM.test(startTime) || !HHMM.test(endTime)) {
    return { error: "Thông tin sân không hợp lệ", status: 400 };
  }
  const db = getDb(d1);
  const session = await db.query.playSessions.findFirst({
    where: eq(schema.playSessions.id, args.sessionId),
  });
  if (!session) return { error: "Không tìm thấy buổi", status: 404 };

  const existing = await db.query.courtAllocations.findMany({
    where: eq(schema.courtAllocations.playSessionId, args.sessionId),
  });
  await db.insert(schema.courtAllocations).values({
    id: ulid(),
    playSessionId: args.sessionId,
    courtCode,
    startTime,
    endTime,
    displayOrder: existing.length,
  });
  await audit(d1, {
    kind: "court_added",
    actorUserId: args.adminUserId,
    playSessionId: args.sessionId,
    meta: { courtCode, startTime, endTime },
  });
  return { ok: true };
}

export async function removeCourtFromSession(
  d1: D1Database,
  args: { courtId: string; adminUserId: string },
): Promise<CourtEditResult> {
  const db = getDb(d1);
  const row = await db.query.courtAllocations.findFirst({
    where: eq(schema.courtAllocations.id, args.courtId),
  });
  if (!row) return { error: "Không tìm thấy sân", status: 404 };

  await db.delete(schema.courtAllocations).where(eq(schema.courtAllocations.id, args.courtId));
  await audit(d1, {
    kind: "court_removed",
    actorUserId: args.adminUserId,
    playSessionId: row.playSessionId,
    meta: { courtCode: row.courtCode, startTime: row.startTime, endTime: row.endTime },
  });

  // Capacity dropped — refund the oldest cho_pass voter on this session
  // (FIFO). They didn't get a seat after all.
  await refundPendingPassRequests(d1, row.playSessionId, args.adminUserId);
  return { ok: true };
}
