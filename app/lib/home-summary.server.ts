/**
 * Trang-chu loader logic — pulled out of the route file so the loader stays
 * thin and the assembly logic (seat priority dedup, capacity, pass-request
 * bucketing, audit log decoration) can be unit-tested.
 *
 * Stages:
 *   1. `loadHomeMonthBundle` — pure I/O. Reads everything the page needs for
 *      one month, returns raw arrays + maps.
 *   2. `buildHomeMonthSummary` — orchestrates: calls loadHomeMonthBundle,
 *      decorates sessions, applies "past + empty-court" filter, computes my
 *      totals. This is the function the route calls.
 *   3. `decorateHomeSession` (pure, exported for tests) — turns one
 *      PlaySession + its bundle entries into a SessionView.
 */
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "~/db/client";
import { getPrices, type PriceTable } from "./config.server";
import { attributeSeatsBySession } from "./seat-attribution";
import { computeMemberTotals } from "./vote.server";
import type { WeekdayCode } from "./dates";

export interface OpenPassItem {
  requestId: string;
  ownerName: string;
  ownerGender: "nam" | "nu";
  /** Price the claimer must transfer to the original passer. */
  price: number;
  ownerQrUrl: string | null;
  /** True when this pass-slot belongs to the current logged-in user. The UI
   * uses this to render an inline "Huỷ" button instead of the claim CTA. */
  isMe: boolean;
}

export interface MyClaimedItem {
  requestId: string;
  ownerName: string;
  ownerQrUrl: string | null;
  price: number;
}

export interface AuditEvent {
  id: string;
  kind: schema.AuditKind;
  createdAt: number;
  actorName: string | null;
  subjectName: string | null;
  meta: Record<string, unknown> | null;
}

export type MyStatus = schema.Vote["status"] | "extra_pending" | "none";

export interface SessionView {
  id: string;
  date: string;
  weekday: WeekdayCode;
  voteCount: number;
  courts: Array<{ id: string; code: string; start: string; end: string }>;
  players: Array<{ name: string; isMe: boolean; status: schema.Vote["status"]; votedAt: number }>;
  /** Vãng lai requests still pending admin approval (and not auto-matched
   * yet) — shown to every member as "Vãng lai đang chờ". `requestId` is
   * carried so the owner can cancel their own row inline. */
  pendingVangLai: Array<{
    requestId: string;
    name: string;
    isMe: boolean;
    createdAt: number;
  }>;
  myStatus: MyStatus;
  isThisWeek: boolean;
  /** Session is locked from member actions — today or earlier. Pass-slot,
   * vãng lai, claim, and admin edit are all hidden; only the history sheet
   * stays accessible. Strictly past sessions (date < today) are filtered
   * out of `monthSummaries.sessions` entirely. */
  isLocked: boolean;
  extraRequestId: string | null;
  myVoteId: string | null;
  openPassRequests: OpenPassItem[];
  myClaimed: MyClaimedItem[];
  history: AuditEvent[];
  playerCount: number;
}

export interface HomeMonthSummary {
  monthId: string;
  year: number;
  month: number;
  status: schema.Month["status"];
  totalSlots: number;
  totalFee: number;
  sessions: SessionView[];
}

/* ---------------- Public entry point ---------------- */

export async function buildHomeMonthSummary(
  d1: D1Database,
  monthRow: schema.Month,
  memberById: Map<string, schema.User>,
  currentUserId: string,
): Promise<HomeMonthSummary> {
  const bundle = await loadHomeMonthBundle(d1, monthRow.id, currentUserId);
  const sessionViews = bundle.sessions.map((s) =>
    decorateHomeSession(s, bundle, memberById, currentUserId),
  );

  const today = todayVNDateString();
  const week = thisWeekSatSun();
  const isClosed = monthRow.status === "locked" || monthRow.status === "done";
  // Strictly past sessions (date < today) are hidden. Today's session stays
  // visible but flagged `isLocked` so actions are disabled — only history
  // accessible. Future sessions render normally with full actions.
  const visible = sessionViews.filter(
    (s) => s.date >= today && (!isClosed || s.courts.length > 0),
  );
  for (const s of visible) {
    s.isLocked = s.date <= today;
    if (s.date === week.sat || s.date === week.sun) s.isThisWeek = true;
  }

  let totalFee = 0;
  let totalSlots = 0;
  if (isClosed) {
    const totals = await computeMemberTotals(d1, monthRow.year, monthRow.month);
    const mine = totals.get(currentUserId);
    totalFee = mine?.totalFee ?? 0;
    totalSlots = mine?.totalSlots ?? 0;
  }

  return {
    monthId: monthRow.id,
    year: monthRow.year,
    month: monthRow.month,
    status: monthRow.status,
    totalSlots,
    totalFee,
    sessions: visible,
  };
}

/* ---------------- I/O layer ---------------- */

export interface HomeMonthBundle {
  sessions: schema.PlaySession[];
  votesBySession: Map<string, schema.Vote[]>;
  allocsBySession: Map<string, schema.CourtAllocation[]>;
  /** My extra-slot (vãng lai) request per session, if pending. */
  extraBySession: Map<string, schema.ExtraSlotRequest>;
  /** All pending vãng lai requests (any member) keyed by session — for the
   * "Vãng lai đang chờ" list shown on session cards. */
  pendingExtraBySession: Map<string, schema.ExtraSlotRequest[]>;
  /** Map keyed by playSessionId of OPEN pass requests from OTHER members. */
  openPassBySession: Map<string, OpenPassItem[]>;
  /** Pass requests I've claimed but not yet confirmed (this month only). */
  myClaimedBySession: Map<string, MyClaimedItem[]>;
  historyBySession: Map<string, AuditEvent[]>;
  /** Pre-attributed seats per session (matrix + bill + home cards all agree). */
  seatsBySession: ReturnType<typeof attributeSeatsBySession>;
  prices: PriceTable;
}

async function loadHomeMonthBundle(
  d1: D1Database,
  monthId: string,
  currentUserId: string,
): Promise<HomeMonthBundle> {
  const db = getDb(d1);
  const sessions = await db.query.playSessions.findMany({
    where: eq(schema.playSessions.monthId, monthId),
    orderBy: [asc(schema.playSessions.date)],
  });
  const sessionIds = sessions.map((s) => s.id);

  const [allVotes, allocs, allPendingExtra, allOpenPassRequests, prices, allAuditLogs] =
    await Promise.all([
      sessionIds.length
        ? db.query.votes.findMany({ where: inArray(schema.votes.playSessionId, sessionIds) })
        : Promise.resolve([] as schema.Vote[]),
      sessionIds.length
        ? db.query.courtAllocations.findMany({
            where: inArray(schema.courtAllocations.playSessionId, sessionIds),
            orderBy: [asc(schema.courtAllocations.displayOrder)],
          })
        : Promise.resolve([] as schema.CourtAllocation[]),
      sessionIds.length
        ? db.query.extraSlotRequests.findMany({
            where: and(
              inArray(schema.extraSlotRequests.playSessionId, sessionIds),
              isNull(schema.extraSlotRequests.approvedAt),
              isNull(schema.extraSlotRequests.cancelledAt),
              isNull(schema.extraSlotRequests.rejectedAt),
            ),
            orderBy: [asc(schema.extraSlotRequests.createdAt)],
          })
        : Promise.resolve([] as schema.ExtraSlotRequest[]),
      db.query.passRequests.findMany({
        orderBy: [asc(schema.passRequests.createdAt)],
      }),
      getPrices(d1),
      sessionIds.length
        ? db.query.auditLogs.findMany({
            where: inArray(schema.auditLogs.playSessionId, sessionIds),
            orderBy: [desc(schema.auditLogs.createdAt)],
          })
        : Promise.resolve([] as schema.AuditLog[]),
    ]);

  const votesBySession = bucketBy(allVotes, (v) => v.playSessionId);
  const allocsBySession = bucketBy(allocs, (a) => a.playSessionId);
  const pendingExtraBySession = bucketBy(allPendingExtra, (r) => r.playSessionId);
  const myPending = allPendingExtra.filter((r) => r.userId === currentUserId);
  const extraBySession = new Map(myPending.map((r) => [r.playSessionId, r] as const));

  // Fetch members once for audit decoration (caller's memberById may not cover
  // historic users; safe to look up).
  const allMembers = await db.query.users.findMany();
  const memberById = new Map(allMembers.map((u) => [u.id, u] as const));

  // Bucket pass requests by session, splitting open vs my-claimed.
  const voteById = new Map(allVotes.map((v) => [v.id, v] as const));
  const openPassBySession = new Map<string, OpenPassItem[]>();
  const myClaimedBySession = new Map<string, MyClaimedItem[]>();
  for (const r of allOpenPassRequests) {
    const v = voteById.get(r.voteId);
    if (!v) continue;
    if (!sessionIds.includes(v.playSessionId)) continue;
    const owner = memberById.get(v.userId);
    if (!owner) continue;
    if (r.claimedAt && r.confirmedAt) continue;
    const tier = v.status === "vang_lai" ? "vang_lai" : "thang";
    const price = prices[tier][owner.gender];
    const ownerQrUrl = owner.qrImageKey
      ? `/qr/${encodeURIComponent(owner.qrImageKey)}`
      : null;
    if (!r.claimedAt) {
      // Include the user's own pass too — UI renders Huỷ inline instead of
      // the claim CTA on the `isMe` row.
      pushTo(openPassBySession, v.playSessionId, {
        requestId: r.id,
        ownerName: owner.name,
        ownerGender: owner.gender,
        price,
        ownerQrUrl,
        isMe: v.userId === currentUserId,
      });
    } else if (r.claimedByUserId === currentUserId) {
      pushTo(myClaimedBySession, v.playSessionId, {
        requestId: r.id,
        ownerName: owner.name,
        ownerQrUrl,
        price,
      });
    }
  }

  const historyBySession = new Map<string, AuditEvent[]>();
  for (const log of allAuditLogs) {
    if (!log.playSessionId) continue;
    let meta: Record<string, unknown> | null = null;
    if (log.meta) {
      try {
        meta = JSON.parse(log.meta);
      } catch {
        meta = null;
      }
    }
    pushTo(historyBySession, log.playSessionId, {
      id: log.id,
      kind: log.kind,
      createdAt: log.createdAt,
      actorName: log.actorUserId ? memberById.get(log.actorUserId)?.name ?? null : null,
      subjectName: log.subjectUserId
        ? memberById.get(log.subjectUserId)?.name ?? null
        : null,
      meta,
    });
  }

  return {
    sessions,
    votesBySession,
    allocsBySession,
    extraBySession,
    pendingExtraBySession,
    openPassBySession,
    myClaimedBySession,
    historyBySession,
    seatsBySession: attributeSeatsBySession(allVotes),
    prices,
  };
}

/* ---------------- Pure decoration (exported for tests) ---------------- */

/** Sort key — strongest status wins when a user has multiple seat rows. */
const STATUS_PRIORITY: Record<schema.Vote["status"], number> = {
  thang: 4,
  vang_lai: 3,
  cho_pass: 2,
  da_pass: 1,
  hoan_tien: 0,
};

export function decorateHomeSession(
  s: schema.PlaySession,
  bundle: HomeMonthBundle,
  memberById: Map<string, schema.User>,
  currentUserId: string,
): SessionView {
  const sv = bundle.votesBySession.get(s.id) ?? [];
  const myVote = sv.find((v) => v.userId === currentUserId) ?? null;
  const myExtraReq = bundle.extraBySession.get(s.id) ?? null;

  // Players: seat attribution + dedup by userId, strongest status wins.
  // Carry `votedAt` so the caller can sort vãng lai in FIFO order separately
  // from "Đã đăng ký tháng" (which we keep alpha-sorted).
  const voteById = new Map(sv.map((v) => [v.id, v] as const));
  const seenPlayers = new Map<
    string,
    { name: string; isMe: boolean; status: schema.Vote["status"]; votedAt: number }
  >();
  for (const seat of bundle.seatsBySession.get(s.id) ?? []) {
    const u = memberById.get(seat.userId);
    if (!u) continue;
    const existing = seenPlayers.get(seat.userId);
    if (
      !existing ||
      (STATUS_PRIORITY[seat.status] ?? 0) > (STATUS_PRIORITY[existing.status] ?? 0)
    ) {
      const sourceVote = voteById.get(seat.sourceVoteId);
      seenPlayers.set(seat.userId, {
        name: u.name,
        isMe: seat.userId === currentUserId,
        status: seat.status,
        votedAt: sourceVote?.votedAt ?? 0,
      });
    }
  }
  const players = Array.from(seenPlayers.values()).sort((a, b) => {
    // vang_lai: FIFO by registration time; everyone else alpha by name.
    if (a.status === "vang_lai" && b.status === "vang_lai") return a.votedAt - b.votedAt;
    return a.name.localeCompare(b.name, "vi");
  });

  const myStatus: MyStatus = myVote
    ? myVote.status
    : myExtraReq && !myExtraReq.approvedAt && !myExtraReq.cancelledAt
      ? "extra_pending"
      : "none";

  const courts = bundle.allocsBySession.get(s.id) ?? [];
  const playerCount = sv.filter((v) =>
    v.status === "thang" ||
    v.status === "vang_lai" ||
    v.status === "cho_pass" ||
    v.status === "da_pass",
  ).length;

  const myVoteId =
    myVote && (myVote.status === "thang" || myVote.status === "vang_lai" || myVote.status === "cho_pass")
      ? myVote.id
      : null;

  const pendingVangLai = (bundle.pendingExtraBySession.get(s.id) ?? [])
    .map((r) => {
      const u = memberById.get(r.userId);
      if (!u) return null;
      return {
        requestId: r.id,
        name: u.name,
        isMe: r.userId === currentUserId,
        createdAt: r.createdAt,
      };
    })
    .filter(
      (x): x is { requestId: string; name: string; isMe: boolean; createdAt: number } =>
        x !== null,
    );

  return {
    id: s.id,
    date: s.date,
    weekday: s.weekday,
    voteCount: playerCount,
    playerCount,
    courts: courts.map((c) => ({
      id: c.id,
      code: c.courtCode,
      start: c.startTime,
      end: c.endTime,
    })),
    players,
    pendingVangLai,
    myStatus,
    isThisWeek: false,
    isLocked: false,
    extraRequestId:
      myExtraReq && !myExtraReq.approvedAt && !myExtraReq.cancelledAt
        ? myExtraReq.id
        : null,
    myVoteId,
    openPassRequests: bundle.openPassBySession.get(s.id) ?? [],
    myClaimed: bundle.myClaimedBySession.get(s.id) ?? [],
    history: bundle.historyBySession.get(s.id) ?? [],
  };
}

/* ---------------- Tiny pure helpers ---------------- */

function bucketBy<T, K>(arr: readonly T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of arr) {
    const k = key(x);
    const list = m.get(k) ?? [];
    list.push(x);
    m.set(k, list);
  }
  return m;
}

function pushTo<K, V>(m: Map<K, V[]>, key: K, val: V): void {
  const arr = m.get(key) ?? [];
  arr.push(val);
  m.set(key, arr);
}

function todayVN(): Date {
  return new Date(Date.now() + 7 * 60 * 60 * 1000);
}

function fmtDate(d: Date): string {
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${m}-${day}`;
}

function todayVNDateString(): string {
  return fmtDate(todayVN());
}

/** ISO dates of T7 + CN within the current ISO week (Mon-Sun) in VN time. */
function thisWeekSatSun(): { sat: string; sun: string } {
  const t = todayVN();
  const dow = t.getUTCDay();
  const daysSinceMonday = (dow + 6) % 7;
  const mondayMs = t.getTime() - daysSinceMonday * 86_400_000;
  return {
    sat: fmtDate(new Date(mondayMs + 5 * 86_400_000)),
    sun: fmtDate(new Date(mondayMs + 6 * 86_400_000)),
  };
}
