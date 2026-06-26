import { desc, eq, inArray, lt } from "drizzle-orm";
import { ulid } from "ulid";
import { getDb, schema } from "~/db/client";
import type { AuditKind } from "~/db/schema";

export interface EnrichedAuditEvent {
  id: string;
  kind: AuditKind;
  createdAt: number;
  actorName: string | null;
  subjectName: string | null;
  meta: Record<string, unknown> | null;
}

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

interface AuditInput {
  kind: AuditKind;
  actorUserId?: string | null;
  subjectUserId?: string | null;
  playSessionId?: string | null;
  voteId?: string | null;
  meta?: Record<string, unknown>;
}

export async function audit(d1: D1Database, input: AuditInput): Promise<void> {
  try {
    const db = getDb(d1);
    await db.insert(schema.auditLogs).values({
      id: ulid(),
      kind: input.kind,
      actorUserId: input.actorUserId ?? null,
      subjectUserId: input.subjectUserId ?? null,
      playSessionId: input.playSessionId ?? null,
      voteId: input.voteId ?? null,
      meta: input.meta ? JSON.stringify(input.meta) : null,
      createdAt: Date.now(),
    });
  } catch (e) {
    // Auditing must never break the request path.
    console.error("[audit] insert failed", e);
  }
}

/**
 * Audit log for a single play session — used by `/admin/sessions/<id>` and
 * the per-card history sheet on trang-chu. Enriches actor/subject ids with
 * member names + parses `meta` JSON. Newest first.
 */
export async function loadSessionAuditEvents(
  d1: D1Database,
  playSessionId: string,
  limit = 100,
): Promise<EnrichedAuditEvent[]> {
  const db = getDb(d1);
  const rows = await db.query.auditLogs.findMany({
    where: eq(schema.auditLogs.playSessionId, playSessionId),
    orderBy: [desc(schema.auditLogs.createdAt)],
    limit,
  });
  if (rows.length === 0) return [];

  const ids = new Set<string>();
  for (const r of rows) {
    if (r.actorUserId) ids.add(r.actorUserId);
    if (r.subjectUserId) ids.add(r.subjectUserId);
  }
  const users = ids.size
    ? await db.query.users.findMany({
        where: inArray(schema.users.id, Array.from(ids)),
      })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name] as const));

  return rows.map((r) => {
    let meta: Record<string, unknown> | null = null;
    if (r.meta) {
      try {
        meta = JSON.parse(r.meta);
      } catch {
        meta = null;
      }
    }
    return {
      id: r.id,
      kind: r.kind,
      createdAt: r.createdAt,
      actorName: r.actorUserId ? nameById.get(r.actorUserId) ?? null : null,
      subjectName: r.subjectUserId ? nameById.get(r.subjectUserId) ?? null : null,
      meta,
    };
  });
}

/** Delete logs older than 90 days. Called from the monthly close-vote cron. */
export async function cleanupOldLogs(d1: D1Database): Promise<number> {
  const db = getDb(d1);
  const cutoff = Date.now() - RETENTION_MS;
  const result = await db.delete(schema.auditLogs).where(lt(schema.auditLogs.createdAt, cutoff));
  // D1 doesn't return rowsAffected reliably via Drizzle's delete; rely on Wrangler logs.
  return (result as unknown as { rowsAffected?: number }).rowsAffected ?? 0;
}
