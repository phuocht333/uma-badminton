import { useEffect, useRef, useState } from "react";
import {
  json,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/cloudflare";
import {
  Form,
  Link,
  useFetcher,
  useLoaderData,
  useNavigation,
  useRevalidator,
  useSubmit,
} from "@remix-run/react";
import { Check, Pencil, RefreshCw } from "lucide-react";
import type { WeekdayCode } from "~/lib/dates";
import { cn } from "~/lib/cn";
import { and, asc, eq, gte, inArray, isNull, ne, or } from "drizzle-orm";
import { ulid } from "ulid";
import { AppShell } from "~/components/app-shell";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { getDb, schema } from "~/db/client";
import { requireUser } from "~/lib/auth.server";
import { calculateTotalHours, hoursFromHM } from "~/lib/allocate-courts";
import { CONFIG_KEYS, getAllocateConfig, getString } from "~/lib/config.server";
import { loadPaidUserIds, markMonthPaid } from "~/lib/month-payment.server";
import { getEnv } from "~/lib/env.server";
import { formatDateTime, formatMonthYear, vnYearMonth } from "~/lib/dates";
import { WeekdayDate } from "~/components/weekday-date";
import { formatVND } from "~/lib/format";
import {
  computeMemberTotals,
  forceLockMonth,
  freezeMonthAsBooked,
  unlockMonthForVoting,
} from "~/lib/vote.server";
import { sweepExpiredCutoffs } from "~/lib/cutoff-sweep.server";
import { addCourtToSession, removeCourtFromSession } from "~/lib/court-edit.server";
import { normalizeTimeBlur } from "~/lib/time-input";
import { MonthMatrix, type MatrixRow, type MatrixSession } from "~/components/month-matrix";
import { MonthPayCta } from "~/components/month-pay-cta";
import { buildMonthMatrixData } from "~/lib/month-matrix.server";

interface VotingSessionItem {
  id: string;
  date: string;
  weekday: WeekdayCode;
  voted: boolean;
  /** Total members who voted yes for this session — surfaced on the row so
   * voters see critical-mass before locking in. */
  voteCount: number;
}

interface MonthBlock {
  id: string;
  year: number;
  month: number;
  status: schema.Month["status"];
  totalSlots: number;
  totalFee: number;
  voteCloseAt: number;
  votingSessions: VotingSessionItem[];
  /** All sessions of the month — used for the admin's per-session edit list
   *  on locked cards. Includes empty-court sessions so admin can add courts.
   *  Each session ships its current `court_allocations` so the edit dialog
   *  on /lich can render without an extra round-trip. */
  allSessions: Array<{
    id: string;
    date: string;
    weekday: WeekdayCode;
    voteCount: number;
    courts: Array<{ id: string; courtCode: string; startTime: string; endTime: string }>;
  }>;
  matrix: {
    sessions: MatrixSession[];
    rows: MatrixRow[];
    grandTotal: number;
  } | null;
  /** User IDs (within the matrix's `rows`) that have self-marked đã chuyển
   *  tiền tháng. Only meaningful when `status === "done"`. */
  paidUserIds: string[];
  /** Sum of `totalFee` for users in `paidUserIds`. Pre-computed server-side. */
  paidTotal: number;
  /** Did the current viewer mark themselves paid? Drives the CTA state. */
  iPaid: boolean;
}

const statusBadge: Record<
  schema.Month["status"],
  { text: string; tone: "accent" | "warn" | "muted" | "success" }
> = {
  draft: { text: "Sắp mở vote", tone: "muted" },
  voting: { text: "Đang mở vote", tone: "warn" },
  locked: { text: "Đã khoá", tone: "accent" },
  done: { text: "Đã đặt sân", tone: "success" },
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  const user = await requireUser(request, context);
  const env = getEnv(context);
  const db = getDb(env.DB);
  // Lazy cutoff sweep — pass/vãng lai pending on sessions whose cutoff has
  // passed get resolved here so /lich never shows stale "đang chờ" UI.
  try {
    await sweepExpiredCutoffs(env.DB);
  } catch (e) {
    console.error("[lich/loader] sweepExpiredCutoffs failed", e);
  }
  const { year, month } = vnYearMonth(new Date());

  // /lich shows: current month (done/locked/voting) + every future month in
  // these states. Sort per spec: done(current) → done(others) → locked → voting.
  const fromAge = year * 100 + month;
  const candidates = await db.query.months.findMany({
    where: and(
      ne(schema.months.status, "draft"),
      gte(schema.months.year, year - 1), // safety: don't pull ancient archive
    ),
  });
  const inRange = candidates.filter((m) => m.year * 100 + m.month >= fromAge);
  const sortRank = (m: schema.Month): number => {
    // "Đã đặt sân" (done) for current month = 0; other done = 1; locked = 2; voting = 3.
    const isCurrent = m.year === year && m.month === month;
    if (m.status === "done") return isCurrent ? 0 : 1;
    if (m.status === "locked") return 2;
    if (m.status === "voting") return 3;
    return 9;
  };
  const recentMonths = inRange
    .sort((a, b) => {
      const ra = sortRank(a);
      const rb = sortRank(b);
      if (ra !== rb) return ra - rb;
      return a.year * 100 + a.month - (b.year * 100 + b.month);
    })
    .slice(0, 2);

  // Build each month's block in parallel — recentMonths is up to 2 entries
  // but each one was hitting D1 5+ times sequentially. Going parallel turns
  // ~10 round-trips into 2 batches of 3 (totals, matrix, sessions+courts).
  const [blocks, allocateConfig, adminQrKey, quyMomoLink] = await Promise.all([
    Promise.all(
      recentMonths.map((m) => buildMonthBlock(env.DB, db, m, user.id)),
    ),
    getAllocateConfig(env.DB),
    getString(env.DB, CONFIG_KEYS.ADMIN_QR_IMAGE_KEY, ""),
    getString(env.DB, CONFIG_KEYS.QUY_MOMO_LINK, ""),
  ]);

  return json({
    user,
    blocks,
    peoplePerHour: allocateConfig.peoplePerHour,
    minPeoplePerSession: allocateConfig.minPeoplePerSession,
    adminQrUrl: adminQrKey ? `/qr/${encodeURIComponent(adminQrKey)}` : null,
    quyMomoLink: quyMomoLink || null,
  });
}

async function buildMonthBlock(
  d1: D1Database,
  db: ReturnType<typeof getDb>,
  m: schema.Month,
  userId: string,
): Promise<MonthBlock> {
  // Phase 1: independent queries on the month.
  const [totalsMap, matrix, monthSessions] = await Promise.all([
    computeMemberTotals(d1, m.year, m.month),
    buildMonthMatrixData(d1, m.id, m.status),
    db.query.playSessions.findMany({
      where: eq(schema.playSessions.monthId, m.id),
      orderBy: [asc(schema.playSessions.date)],
    }),
  ]);
  const mine = totalsMap.get(userId);
  const sessionIdList = monthSessions.map((s) => s.id);

  // Phase 2: courts + all votes for the session. Votes loaded for all states
  // (not just voting) because the "Sửa sân" dialog surfaces vote-count
  // warnings on locked months too.
  const [monthCourts, allMonthVotes] = await Promise.all([
    sessionIdList.length
      ? db.query.courtAllocations.findMany({
          where: inArray(schema.courtAllocations.playSessionId, sessionIdList),
          orderBy: [asc(schema.courtAllocations.displayOrder)],
        })
      : Promise.resolve([] as schema.CourtAllocation[]),
    sessionIdList.length
      ? db.query.votes.findMany({
          where: inArray(schema.votes.playSessionId, sessionIdList),
        })
      : Promise.resolve([] as schema.Vote[]),
  ]);

  // Per-session attending-vote count, used both by voting form rows and by
  // the admin "Sửa sân" dialog (warnings on insufficient slots).
  const attendingByMonth = allMonthVotes.filter(
    (v) => v.status === "thang" || v.status === "vang_lai" || v.status === "cho_pass",
  );
  const voteCountBySession = new Map<string, number>();
  for (const v of attendingByMonth) {
    voteCountBySession.set(v.playSessionId, (voteCountBySession.get(v.playSessionId) ?? 0) + 1);
  }

  const courtsBySession = new Map<string, typeof monthCourts>();
  for (const c of monthCourts) {
    const arr = courtsBySession.get(c.playSessionId) ?? [];
    arr.push(c);
    courtsBySession.set(c.playSessionId, arr);
  }
  const allSessions = monthSessions.map((s) => ({
    id: s.id,
    date: s.date,
    weekday: s.weekday,
    voteCount: voteCountBySession.get(s.id) ?? 0,
    courts: (courtsBySession.get(s.id) ?? []).map((c) => ({
      id: c.id,
      courtCode: c.courtCode,
      startTime: c.startTime,
      endTime: c.endTime,
    })),
  }));

  let votingSessions: VotingSessionItem[] = [];
  if (m.status === "voting") {
    const votedSet = new Set(
      allMonthVotes
        .filter(
          (v) =>
            v.userId === userId &&
            (v.status === "thang" || v.status === "vang_lai"),
        )
        .map((v) => v.playSessionId),
    );
    votingSessions = monthSessions.map((s) => ({
      id: s.id,
      date: s.date,
      weekday: s.weekday,
      voted: votedSet.has(s.id),
      voteCount: voteCountBySession.get(s.id) ?? 0,
    }));
  }

  // Monthly payment markers — only meaningful for done months. Skip the round-
  // trip for voting / locked since the UI can't act on them anyway.
  let paidIds = new Set<string>();
  let paidTotal = 0;
  let iPaid = false;
  if (m.status === "done") {
    paidIds = await loadPaidUserIds(d1, m.id);
    if (matrix) {
      for (const row of matrix.rows) {
        if (paidIds.has(row.user.id)) paidTotal += row.totalFee;
      }
    }
    iPaid = paidIds.has(userId);
  }

  return {
    id: m.id,
    year: m.year,
    month: m.month,
    status: m.status,
    totalSlots: mine?.totalSlots ?? 0,
    totalFee: mine?.totalFee ?? 0,
    voteCloseAt: m.voteCloseAt,
    votingSessions,
    allSessions,
    matrix,
    paidUserIds: [...paidIds],
    paidTotal,
    iPaid,
  };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const user = await requireUser(request, context);
  const env = getEnv(context);
  const db = getDb(env.DB);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const monthId = String(form.get("monthId"));
  if (!monthId) return json({ error: "Thiếu monthId" }, { status: 400 });

  const m = await db.query.months.findFirst({ where: eq(schema.months.id, monthId) });
  if (!m) return json({ error: "Không tìm thấy tháng" }, { status: 404 });

  if (intent === "save-vote") {
    if (m.status !== "voting") {
      return json({ error: "Vote đã đóng cho tháng này." }, { status: 400 });
    }
    const sessions = await db.query.playSessions.findMany({
      where: eq(schema.playSessions.monthId, m.id),
    });
    const sessionIds = sessions.map((s) => s.id);
    const selected = new Set(form.getAll("session").map(String));
    const existing = sessionIds.length
      ? await db.query.votes.findMany({
          where: and(
            eq(schema.votes.userId, user.id),
            inArray(schema.votes.playSessionId, sessionIds),
          ),
        })
      : [];
    const existingMap = new Map(existing.map((v) => [v.playSessionId, v] as const));

    const now = Date.now();
    for (const sid of sessionIds) {
      const want = selected.has(sid);
      const has = existingMap.get(sid);
      if (want && !has) {
        await db.insert(schema.votes).values({
          id: ulid(),
          playSessionId: sid,
          userId: user.id,
          status: "thang",
          votedAt: now,
        });
      } else if (!want && has && has.status === "thang") {
        await db.delete(schema.votes).where(eq(schema.votes.id, has.id));
      } else if (want && has && has.status !== "thang" && has.status !== "vang_lai") {
        await db
          .update(schema.votes)
          .set({ status: "thang", votedAt: now })
          .where(eq(schema.votes.id, has.id));
      }
    }
    return json({ ok: true });
  }

  // Admin-only month + court actions.
  if (
    intent === "admin-lock-vote" ||
    intent === "admin-unlock-vote" ||
    intent === "admin-freeze" ||
    intent === "admin-add-court" ||
    intent === "admin-save-courts-bulk" ||
    intent === "admin-remove-court"
  ) {
    if (user.role !== "admin") {
      return json({ error: "Không có quyền." }, { status: 403 });
    }
    // Court edits are frozen once the month is "Đã đặt sân" (done) — snapshot
    // is the immutable bill from that moment.
    if (
      (intent === "admin-add-court" ||
        intent === "admin-save-courts-bulk" ||
        intent === "admin-remove-court") &&
      m.status === "done"
    ) {
      return json(
        { error: "Tháng đã 'Đặt sân', không sửa thông tin sân được nữa." },
        { status: 400 },
      );
    }
    if (intent === "admin-lock-vote") {
      const r = await forceLockMonth(env, m.year, m.month);
      if ("error" in r) return json({ error: r.error }, { status: 400 });
      return json({ ok: true });
    }
    if (intent === "admin-unlock-vote") {
      const r = await unlockMonthForVoting(env, m.year, m.month);
      if ("error" in r) return json({ error: r.error }, { status: 400 });
      return json({ ok: true });
    }
    if (intent === "admin-freeze") {
      const r = await freezeMonthAsBooked(env, m.year, m.month);
      if ("error" in r) return json({ error: r.error }, { status: 400 });
      return json({ ok: true });
    }
    if (intent === "admin-add-court") {
      const sessionId = String(form.get("sessionId"));
      const session = await db.query.playSessions.findFirst({
        where: eq(schema.playSessions.id, sessionId),
      });
      if (!session || session.monthId !== m.id) {
        return json({ error: "Buổi không hợp lệ" }, { status: 400 });
      }
      const r = await addCourtToSession(env.DB, {
        sessionId,
        courtCode: String(form.get("courtCode") || ""),
        startTime: String(form.get("startTime") || ""),
        endTime: String(form.get("endTime") || ""),
        adminUserId: user.id,
      });
      if ("error" in r) return json({ error: r.error }, { status: r.status ?? 400 });
      return json({ ok: true });
    }
    if (intent === "admin-save-courts-bulk") {
      // Body: { courts: Array<{ sessionId, courtCode, startTime, endTime }>,
      //         removeCourtIds: string[] }
      const rawCourts = String(form.get("courts") || "[]");
      const rawRemove = String(form.get("removeCourtIds") || "[]");
      let courts: Array<{ sessionId: string; courtCode: string; startTime: string; endTime: string }>;
      let removeCourtIds: string[];
      try {
        courts = JSON.parse(rawCourts);
        removeCourtIds = JSON.parse(rawRemove);
        if (!Array.isArray(courts) || !Array.isArray(removeCourtIds)) throw new Error("not array");
      } catch {
        return json({ error: "Danh sách sân không hợp lệ" }, { status: 400 });
      }
      // Validate every sessionId in adds belongs to this month before any write.
      const sessionIds = Array.from(new Set(courts.map((c) => c.sessionId)));
      const sessions = sessionIds.length
        ? await db.query.playSessions.findMany({
            where: inArray(schema.playSessions.id, sessionIds),
          })
        : [];
      const validIds = new Set(
        sessions.filter((s) => s.monthId === m.id).map((s) => s.id),
      );
      for (const c of courts) {
        if (!validIds.has(c.sessionId)) {
          return json({ error: "Có buổi không thuộc tháng này" }, { status: 400 });
        }
      }
      // Validate every removeCourtId belongs to a session in this month.
      if (removeCourtIds.length) {
        const rows = await db.query.courtAllocations.findMany({
          where: inArray(schema.courtAllocations.id, removeCourtIds),
        });
        if (rows.length !== removeCourtIds.length) {
          return json({ error: "Có sân không tồn tại" }, { status: 400 });
        }
        const sessIds = Array.from(new Set(rows.map((r) => r.playSessionId)));
        const sessRows = await db.query.playSessions.findMany({
          where: inArray(schema.playSessions.id, sessIds),
        });
        for (const s of sessRows) {
          if (s.monthId !== m.id) {
            return json({ error: "Có sân không thuộc tháng này" }, { status: 400 });
          }
        }
      }
      // Apply removes first (capacity check, cascade refunds), then adds.
      let removed = 0;
      for (const id of removeCourtIds) {
        const r = await removeCourtFromSession(env.DB, { courtId: id, adminUserId: user.id });
        if ("error" in r) {
          return json({ error: r.error }, { status: r.status ?? 400 });
        }
        removed += 1;
      }
      let added = 0;
      for (const c of courts) {
        const r = await addCourtToSession(env.DB, {
          sessionId: c.sessionId,
          courtCode: c.courtCode,
          startTime: c.startTime,
          endTime: c.endTime,
          adminUserId: user.id,
        });
        if ("error" in r) {
          return json({ error: `Lỗi sân ${c.courtCode}: ${r.error}` }, { status: r.status ?? 400 });
        }
        added += 1;
      }
      return json({ ok: true, added, removed });
    }
    if (intent === "admin-remove-court") {
      const courtId = String(form.get("courtId"));
      // Guard: the court must belong to a session in this month — prevents
      // cross-month delete via crafted form.
      const row = await db.query.courtAllocations.findFirst({
        where: eq(schema.courtAllocations.id, courtId),
      });
      if (!row) return json({ error: "Không tìm thấy sân" }, { status: 404 });
      const session = await db.query.playSessions.findFirst({
        where: eq(schema.playSessions.id, row.playSessionId),
      });
      if (!session || session.monthId !== m.id) {
        return json({ error: "Sân không thuộc tháng này" }, { status: 400 });
      }
      const r = await removeCourtFromSession(env.DB, { courtId, adminUserId: user.id });
      if ("error" in r) return json({ error: r.error }, { status: r.status ?? 400 });
      return json({ ok: true });
    }
  }

  if (intent === "mark-month-paid") {
    const r = await markMonthPaid(env.DB, user.id, monthId);
    if ("error" in r) return json({ error: r.error }, { status: 400 });
    return json({ ok: true });
  }

  return json({ error: "intent không hợp lệ" }, { status: 400 });
}


export default function LichPage() {
  const data = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const revalidator = useRevalidator();
  const submitting = nav.state === "submitting";
  const refreshing = revalidator.state === "loading";

  // Per-block matrix refs — used by the "Xuất hình" button on "Đã khoá" cards
  // to capture the rendered table to PNG.
  const matrixRefs = useRef<Record<string, HTMLDivElement | null>>({});
  async function exportMatrixPng(blockId: string, year: number, month: number) {
    const el = matrixRefs.current[blockId];
    if (!el) return;
    const { toPng } = await import("html-to-image");
    const url = await toPng(el, { backgroundColor: "#ffffff", pixelRatio: 2 });
    const a = document.createElement("a");
    a.href = url;
    a.download = `uma-${year}-${String(month).padStart(2, "0")}.png`;
    a.click();
  }

  // Scroll to the month anchored in the URL (e.g. /lich#thang-<monthId>) so
  // the "Vote ngay" link from trang-chu lands on the right card.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [data.blocks.length]);

  return (
    <AppShell user={data.user as never}>
      <div className="space-y-5">
        {data.blocks.length === 0 && (
          <p className="text-body-sm text-muted">Chưa có tháng nào trong hệ thống.</p>
        )}

        {data.blocks.map((b) => (
          <Card key={b.id} id={`thang-${b.id}`}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>
                  Tháng {formatMonthYear(b.year, b.month)}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge tone={statusBadge[b.status].tone}>{statusBadge[b.status].text}</Badge>
                  {b.status === "voting" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => revalidator.revalidate()}
                      disabled={refreshing}
                      aria-label="Refresh vote"
                      title="Tải lại số lượng vote"
                    >
                      <RefreshCw
                        className={"h-4 w-4 " + (refreshing ? "animate-spin" : "")}
                      />
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {b.status === "voting" && <VoteInlineForm month={b} />}
              {(b.status === "locked" || b.status === "done") && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-hairline bg-canvas-soft px-3 py-2">
                  <p className="text-body-sm text-ink">
                    Bạn tham gia:{" "}
                    <strong className="font-semibold">{b.totalSlots} buổi</strong>
                    <span className="text-muted"> - </span>
                    <strong className="font-semibold">{formatVND(b.totalFee)}</strong>
                  </p>
                  {b.status === "done" && b.totalFee > 0 && (
                    <MonthPayCta
                      monthId={b.id}
                      iPaid={b.iPaid}
                      amount={b.totalFee}
                      year={b.year}
                      month={b.month}
                      adminQrUrl={data.adminQrUrl}
                      quyMomoLink={data.quyMomoLink}
                    />
                  )}
                </div>
              )}

              {b.matrix && (
                <details className="mt-2" open>
                  <summary className="cursor-pointer text-caption text-muted hover:text-ink">
                    Bảng vote tháng {formatMonthYear(b.year, b.month)}
                  </summary>
                  <MonthVoteToolbar
                    month={b}
                    isAdmin={data.user.role === "admin"}
                    peoplePerHour={data.peoplePerHour}
                    minPeoplePerSession={data.minPeoplePerSession}
                    onExport={() => exportMatrixPng(b.id, b.year, b.month)}
                  />
                  <div className="mt-3">
                    <MonthMatrix
                      ref={(el) => {
                        matrixRefs.current[b.id] = el;
                      }}
                      year={b.year}
                      month={b.month}
                      sessions={b.matrix.sessions}
                      rows={b.matrix.rows}
                      grandTotal={b.matrix.grandTotal}
                      highlightUserId={data.user.id}
                      monthStatus={b.status}
                      minPeoplePerSession={data.minPeoplePerSession}
                      paidUserIds={new Set(b.paidUserIds)}
                      paidTotal={b.paidTotal}
                    />
                  </div>
                </details>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}

function VoteInlineForm({ month: b }: { month: MonthBlock }) {
  const fetcher = useFetcher<{ ok?: true; error?: string }>();
  const submitting = fetcher.state !== "idle";
  const isOk =
    fetcher.state === "idle" && fetcher.data && "ok" in fetcher.data && fetcher.data.ok === true;
  const errMsg =
    fetcher.state === "idle" && fetcher.data && "error" in fetcher.data
      ? (fetcher.data.error ?? null)
      : null;
  const formRef = useRef<HTMLFormElement>(null);
  // Controlled selection so the row styling can reflect state without
  // peer-checked sibling-selector contortions (Tailwind peer-checked doesn't
  // reach nested children inside the styled row).
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(b.votingSessions.filter((s) => s.voted).map((s) => s.id)),
  );
  // Reset state when the server returns fresh `voted` flags after a save
  // (sync with server-truth).
  useEffect(() => {
    setSelected(new Set(b.votingSessions.filter((s) => s.voted).map((s) => s.id)));
  }, [b.votingSessions]);

  // Top-right toast on save — inline success message used to make the form
  // jump as it appeared/disappeared.
  const [showToast, setShowToast] = useState(false);
  useEffect(() => {
    if (!isOk) return;
    setShowToast(true);
    const t = setTimeout(() => setShowToast(false), 2400);
    return () => clearTimeout(t);
  }, [isOk]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <fetcher.Form method="post" ref={formRef} className="space-y-3">
      <input type="hidden" name="intent" value="save-vote" />
      <input type="hidden" name="monthId" value={b.id} />
      {/* One hidden input per selected session — server reads multiple "session" entries. */}
      {Array.from(selected).map((id) => (
        <input key={id} type="hidden" name="session" value={id} />
      ))}
      <p className="text-body-md text-ink">
        <span aria-hidden>⏰ </span>
        Vote thoải mái nhé! Tự động khoá vote vào lúc{" "}
        <strong className="text-accent-deep">
          {(() => {
            const [time, date] = formatDateTime(b.voteCloseAt).split(" ");
            return `${time} ngày ${date}`;
          })()}
        </strong>
        .
      </p>
      {b.votingSessions.length === 0 ? (
        <p className="text-body-sm text-muted">Không có buổi nào trong tháng này.</p>
      ) : (
        <ul className="space-y-1.5">
          {b.votingSessions.map((s) => {
            const isOn = selected.has(s.id);
            // Optimistic count — adjust server total by the delta between
            // the user's current selection and their persisted vote.
            const displayCount =
              s.voteCount + (isOn ? 1 : 0) - (s.voted ? 1 : 0);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => toggle(s.id)}
                  aria-pressed={isOn}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left transition",
                    isOn
                      ? "border-accent bg-accent-tint shadow-[0_0_0_1px_rgba(124,58,237,0.35)]"
                      : "border-hairline bg-canvas-soft hover:bg-surface-strong",
                  )}
                >
                  <span className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition",
                        isOn
                          ? "border-accent bg-accent"
                          : "border-hairline-strong bg-canvas-soft",
                      )}
                    >
                      {isOn && <Check className="h-3 w-3 text-white" />}
                    </span>
                    <WeekdayDate weekday={s.weekday} date={s.date} className="text-body-md" />
                  </span>
                  <span
                    className={cn(
                      "flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-caption font-mono",
                      isOn ? "bg-accent text-white" : "bg-surface-strong text-muted",
                    )}
                    title={`${displayCount} người đã vote`}
                  >
                    {displayCount}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {showToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed right-4 top-4 z-50 rounded-md border border-[#10B981]/40 bg-[#ECFDF5] px-4 py-2 text-body-sm font-medium text-[#047857] shadow-md"
        >
          ✓ Đã lưu vote
        </div>
      )}
      {errMsg && <p className="text-body-sm text-semantic-error">Lỗi: {errMsg}</p>}
      {b.votingSessions.length > 0 && (
        <Button
          type="submit"
          variant="accent"
          size="lg"
          className="w-full"
          disabled={submitting}
        >
          {submitting ? "Đang lưu..." : "Lưu vote"}
        </Button>
      )}
    </fetcher.Form>
  );
}

/**
 * Inline action toolbar rendered above the matrix table. Replaces the
 * previous month-header dropdown — same items but always visible. Buttons
 * vary by month state + role:
 *   - all: Xuất hình
 *   - voting + admin: Khoá vote, Sửa sân
 *   - locked + admin: Mở lại vote, Chốt đã đặt sân, Sửa sân
 *   - done: Xuất hình only
 */
type MonthDialogId = "lock" | "unlock" | "freeze" | "edit-all";

function MonthVoteToolbar({
  month: b,
  isAdmin,
  peoplePerHour,
  minPeoplePerSession,
  onExport,
}: {
  month: MonthBlock;
  isAdmin: boolean;
  peoplePerHour: number;
  minPeoplePerSession: number;
  onExport: () => void;
}) {
  const [active, setActive] = useState<MonthDialogId | null>(null);
  const open = (id: MonthDialogId) => setActive(id);
  const close = () => setActive(null);
  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onExport}>
          📷 Xuất hình
        </Button>
        {isAdmin && b.status === "voting" && (
          <Button type="button" variant="outline" size="sm" onClick={() => open("lock")}>
            🔒 Khoá vote
          </Button>
        )}
        {isAdmin && b.status === "locked" && (
          <Button type="button" variant="outline" size="sm" onClick={() => open("unlock")}>
            ↺ Mở lại vote
          </Button>
        )}
        {isAdmin && b.status !== "done" && b.allSessions.length > 0 && (
          <Button type="button" variant="outline" size="sm" onClick={() => open("edit-all")}>
            <Pencil className="h-3.5 w-3.5" /> Sửa sân
          </Button>
        )}
        {isAdmin && b.status === "locked" && (
          <Button type="button" variant="outline" size="sm" onClick={() => open("freeze")}>
            ✓ Chốt đã đặt sân
          </Button>
        )}
      </div>

      <ControlledConfirmDialog
        open={active === "lock"}
        onOpenChange={(v) => (v ? open("lock") : close())}
        fields={{ intent: "admin-lock-vote", monthId: b.id }}
        title="Khoá vote?"
        description="Đóng vote, tự gen sân. Member không vote thêm được. Có thể mở lại sau."
        confirmLabel="Khoá vote"
        variant="accent"
      />
      <ControlledConfirmDialog
        open={active === "unlock"}
        onOpenChange={(v) => (v ? open("unlock") : close())}
        fields={{ intent: "admin-unlock-vote", monthId: b.id }}
        title="Mở lại vote?"
        description="Mở lại vote để mọi người tiếp tục vote."
        confirmLabel="Mở lại vote"
        variant="accent"
      />
      <ControlledConfirmDialog
        open={active === "freeze"}
        onOpenChange={(v) => (v ? open("freeze") : close())}
        fields={{ intent: "admin-freeze", monthId: b.id }}
        title="Chốt đã đặt sân"
        description="Khoá vote và thông tin sân vĩnh viễn. Mở pass slot + đăng ký vãng lai cho member. Tự mở vote tháng kế. KHÔNG reverse được."
        confirmLabel="Chốt đã đặt sân"
        variant="accent"
      />
      <AllCourtsEditDialog
        monthId={b.id}
        sessions={b.allSessions}
        peoplePerHour={peoplePerHour}
        minPeoplePerSession={minPeoplePerSession}
        open={active === "edit-all"}
        onOpenChange={(v) => (v ? open("edit-all") : close())}
      />
    </>
  );
}

function ControlledConfirmDialog({
  open,
  onOpenChange,
  fields,
  title,
  description,
  confirmLabel = "Xác nhận",
  variant = "accent",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fields: Record<string, string | number>;
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: "accent" | "ghost" | "outline" | "primary" | "destructive";
}) {
  const submit = useSubmit();
  function handleConfirm() {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
    submit(fd, { method: "post" });
    onOpenChange(false);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant={variant} onClick={handleConfirm}>
            {confirmLabel}
          </Button>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface CourtDraft {
  courtCode: string;
  startTime: string;
  endTime: string;
}

/**
 * Per-session block: existing courts are editable inline (X marks them for
 * removal locally), draft rows the admin is composing, vote-count info,
 * and warnings when
 * total hours fall short of `calculateTotalHours(voteCount, peoplePerHour)`. Disabled (info
 * shown only, no editing) when the session has fewer voters than
 * `minPeoplePerSession` — no court should be booked anyway.
 */
function CourtEditSection({
  session,
  drafts,
  removedIds,
  edits,
  onMarkRemoved,
  onUpdateEdit,
  onAddDraft,
  onRemoveDraft,
  onUpdateDraft,
  peoplePerHour,
  minPeoplePerSession,
}: {
  session: MonthBlock["allSessions"][number];
  drafts: CourtDraft[];
  removedIds: Set<string>;
  edits: Map<string, CourtDraft>;
  onMarkRemoved: (courtId: string) => void;
  onUpdateEdit: (courtId: string, patch: Partial<CourtDraft>, fallback: CourtDraft) => void;
  onAddDraft: () => void;
  onRemoveDraft: (idx: number) => void;
  onUpdateDraft: (idx: number, patch: Partial<CourtDraft>) => void;
  peoplePerHour: number;
  minPeoplePerSession: number;
}) {
  const insufficient = session.voteCount < minPeoplePerSession;
  const visibleCourts = session.courts.filter((c) => !removedIds.has(c.id));

  const existingHours = visibleCourts.reduce((sum, c) => {
    const v = edits.get(c.id);
    return sum + hoursFromHM(v?.startTime ?? c.startTime, v?.endTime ?? c.endTime);
  }, 0);
  const draftHours = drafts.reduce(
    (sum, d) =>
      d.courtCode && d.startTime && d.endTime
        ? sum + hoursFromHM(d.startTime, d.endTime)
        : sum,
    0,
  );
  const totalHours = existingHours + draftHours;
  const requiredHours = calculateTotalHours(session.voteCount, peoplePerHour);
  const needMore = !insufficient && totalHours < requiredHours;

  return (
    <div className={cn("space-y-2", insufficient && "opacity-70")}>
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="text-body-md font-semibold text-ink">
          <WeekdayDate weekday={session.weekday} date={session.date} />
        </p>
        <span className="text-caption text-muted">
          · {session.voteCount} người đã vote
        </span>
      </div>

      {insufficient && (
        <p className="rounded-md border border-[#F59E0B]/40 bg-[#FFFBEB] px-3 py-2 text-body-sm text-[#B45309]">
          ⚠️ Không đủ {minPeoplePerSession} người để đặt sân.
        </p>
      )}
      {needMore && (
        <p className="rounded-md border border-[#F59E0B]/40 bg-[#FFFBEB] px-3 py-2 text-body-sm text-[#B45309]">
          ⚠️ Chưa đủ giờ sân cho {session.voteCount} người đã vote (cần tối thiểu{" "}
          {requiredHours} giờ sân).
        </p>
      )}

      {visibleCourts.map((c) => {
        const fallback: CourtDraft = {
          courtCode: c.courtCode,
          startTime: c.startTime,
          endTime: c.endTime,
        };
        const v = edits.get(c.id) ?? fallback;
        return (
          <div
            key={c.id}
            className="flex flex-wrap items-end gap-2 rounded-md border border-hairline bg-surface-card p-3"
          >
            <div className="w-20">
              <label className="text-caption text-muted">Sân</label>
              <input
                value={v.courtCode}
                onChange={(e) => onUpdateEdit(c.id, { courtCode: e.target.value }, fallback)}
                placeholder="B1"
                disabled={insufficient}
                className="h-9 w-full rounded-md border border-hairline-strong bg-white px-2 text-body-sm"
              />
            </div>
            <div className="w-24">
              <label className="text-caption text-muted">Bắt đầu</label>
              <input
                value={v.startTime}
                onChange={(e) => onUpdateEdit(c.id, { startTime: e.target.value }, fallback)}
                placeholder="08:00"
                inputMode="numeric"
                disabled={insufficient}
                onBlur={(e) => {
                  normalizeTimeBlur(e);
                  onUpdateEdit(c.id, { startTime: e.currentTarget.value }, fallback);
                }}
                className="h-9 w-full rounded-md border border-hairline-strong bg-white px-2 text-body-sm"
              />
            </div>
            <div className="w-24">
              <label className="text-caption text-muted">Kết thúc</label>
              <input
                value={v.endTime}
                onChange={(e) => onUpdateEdit(c.id, { endTime: e.target.value }, fallback)}
                placeholder="10:00"
                inputMode="numeric"
                disabled={insufficient}
                onBlur={(e) => {
                  normalizeTimeBlur(e);
                  onUpdateEdit(c.id, { endTime: e.currentTarget.value }, fallback);
                }}
                className="h-9 w-full rounded-md border border-hairline-strong bg-white px-2 text-body-sm"
              />
            </div>
            {!insufficient && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => onMarkRemoved(c.id)}
                aria-label={`Bỏ sân ${c.courtCode} ${c.startTime}–${c.endTime}`}
              >
                ✕
              </Button>
            )}
          </div>
        );
      })}

      {!insufficient && (
        <>
          {drafts.map((d, idx) => (
            <div
              key={idx}
              className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-hairline-strong bg-canvas-soft p-3"
            >
              <div className="w-20">
                <label className="text-caption text-muted">Sân</label>
                <input
                  value={d.courtCode}
                  onChange={(e) => onUpdateDraft(idx, { courtCode: e.target.value })}
                  placeholder="B1"
                  className="h-9 w-full rounded-md border border-hairline-strong bg-white px-2 text-body-sm"
                />
              </div>
              <div className="w-24">
                <label className="text-caption text-muted">Bắt đầu</label>
                <input
                  value={d.startTime}
                  onChange={(e) => onUpdateDraft(idx, { startTime: e.target.value })}
                  placeholder="08:00"
                  inputMode="numeric"
                  onBlur={(e) => {
                    normalizeTimeBlur(e);
                    onUpdateDraft(idx, { startTime: e.currentTarget.value });
                  }}
                  className="h-9 w-full rounded-md border border-hairline-strong bg-white px-2 text-body-sm"
                />
              </div>
              <div className="w-24">
                <label className="text-caption text-muted">Kết thúc</label>
                <input
                  value={d.endTime}
                  onChange={(e) => onUpdateDraft(idx, { endTime: e.target.value })}
                  placeholder="10:00"
                  inputMode="numeric"
                  onBlur={(e) => {
                    normalizeTimeBlur(e);
                    onUpdateDraft(idx, { endTime: e.currentTarget.value });
                  }}
                  className="h-9 w-full rounded-md border border-hairline-strong bg-white px-2 text-body-sm"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => onRemoveDraft(idx)}
                aria-label="Bỏ dòng này"
              >
                ✕
              </Button>
            </div>
          ))}
          <button
            type="button"
            onClick={onAddDraft}
            className="text-body-sm text-accent underline-offset-4 hover:underline"
          >
            + Thêm sân
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Dialog that lets admin edit courts for every session of a month in one
 * place — opened from the month-level "Sửa sân" menu item. Removes + adds
 * are staged locally and committed together via the "Lưu" button (bulk
 * endpoint).
 */
function AllCourtsEditDialog({
  monthId,
  sessions,
  peoplePerHour,
  minPeoplePerSession,
  open,
  onOpenChange,
}: {
  monthId: string;
  sessions: MonthBlock["allSessions"];
  peoplePerHour: number;
  minPeoplePerSession: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<Map<string, CourtDraft[]>>(new Map());
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Map<string, CourtDraft>>(new Map());
  const fetcher = useFetcher<{ ok?: true; error?: string }>();
  const submitting = fetcher.state !== "idle";
  // Gate auto-close so it only fires after a save initiated from this open
  // cycle — `fetcher.data` is sticky across cycles, so without this the next
  // open would re-close immediately on the stale {ok:true}.
  const pendingSaveRef = useRef(false);

  // Reset staged edits when dialog opens / closes — never carry stale state
  // across open cycles (looks confusing if user reopens after saving).
  useEffect(() => {
    if (!open) {
      setDrafts(new Map());
      setRemoved(new Set());
      setEdits(new Map());
    }
  }, [open]);

  // Auto-close after successful save.
  useEffect(() => {
    if (fetcher.state !== "idle") {
      pendingSaveRef.current = true;
      return;
    }
    if (
      pendingSaveRef.current &&
      fetcher.data &&
      "ok" in fetcher.data &&
      fetcher.data.ok
    ) {
      pendingSaveRef.current = false;
      onOpenChange(false);
    }
  }, [fetcher.state, fetcher.data, onOpenChange]);

  function addDraft(sid: string) {
    setDrafts((prev) => {
      const next = new Map(prev);
      const arr = [...(prev.get(sid) ?? []), { courtCode: "", startTime: "", endTime: "" }];
      next.set(sid, arr);
      return next;
    });
  }
  function removeDraft(sid: string, idx: number) {
    setDrafts((prev) => {
      const next = new Map(prev);
      const arr = [...(prev.get(sid) ?? [])];
      arr.splice(idx, 1);
      if (arr.length === 0) next.delete(sid);
      else next.set(sid, arr);
      return next;
    });
  }
  function updateDraft(sid: string, idx: number, patch: Partial<CourtDraft>) {
    setDrafts((prev) => {
      const next = new Map(prev);
      const arr = [...(prev.get(sid) ?? [])];
      arr[idx] = { ...arr[idx], ...patch };
      next.set(sid, arr);
      return next;
    });
  }
  function markRemoved(courtId: string) {
    setRemoved((prev) => {
      const next = new Set(prev);
      next.add(courtId);
      return next;
    });
    // Drop any in-progress edits for this court — it won't be edited+re-added.
    setEdits((prev) => {
      if (!prev.has(courtId)) return prev;
      const next = new Map(prev);
      next.delete(courtId);
      return next;
    });
  }
  function updateEdit(courtId: string, patch: Partial<CourtDraft>, fallback: CourtDraft) {
    setEdits((prev) => {
      const next = new Map(prev);
      const current = prev.get(courtId) ?? fallback;
      next.set(courtId, { ...current, ...patch });
      return next;
    });
  }

  function handleSave() {
    const courts: Array<{
      sessionId: string;
      courtCode: string;
      startTime: string;
      endTime: string;
    }> = [];
    for (const [sid, arr] of drafts.entries()) {
      for (const d of arr) {
        const code = d.courtCode.trim();
        const start = d.startTime.trim();
        const end = d.endTime.trim();
        if (!code || !start || !end) continue;
        courts.push({ sessionId: sid, courtCode: code, startTime: start, endTime: end });
      }
    }
    const removeCourtIds = new Set(removed);
    // Edits to existing courts: skip removed; emit remove+add when changed.
    for (const s of sessions) {
      for (const c of s.courts) {
        if (removeCourtIds.has(c.id)) continue;
        const v = edits.get(c.id);
        if (!v) continue;
        const code = v.courtCode.trim();
        const start = v.startTime.trim();
        const end = v.endTime.trim();
        if (!code || !start || !end) continue;
        const unchanged =
          code === c.courtCode && start === c.startTime && end === c.endTime;
        if (unchanged) continue;
        removeCourtIds.add(c.id);
        courts.push({ sessionId: s.id, courtCode: code, startTime: start, endTime: end });
      }
    }
    const removeIds = Array.from(removeCourtIds);
    if (courts.length === 0 && removeIds.length === 0) {
      onOpenChange(false);
      return;
    }
    const fd = new FormData();
    fd.set("intent", "admin-save-courts-bulk");
    fd.set("monthId", monthId);
    fd.set("courts", JSON.stringify(courts));
    fd.set("removeCourtIds", JSON.stringify(removeIds));
    fetcher.submit(fd, { method: "post" });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Sửa sân</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 px-1 py-2">
          {sessions.map((s) => (
            <CourtEditSection
              key={s.id}
              session={s}
              drafts={drafts.get(s.id) ?? []}
              removedIds={removed}
              edits={edits}
              onMarkRemoved={markRemoved}
              onUpdateEdit={updateEdit}
              onAddDraft={() => addDraft(s.id)}
              onRemoveDraft={(idx) => removeDraft(s.id, idx)}
              onUpdateDraft={(idx, patch) => updateDraft(s.id, idx, patch)}
              peoplePerHour={peoplePerHour}
              minPeoplePerSession={minPeoplePerSession}
            />
          ))}
        </div>
        {fetcher.data && "error" in fetcher.data && fetcher.data.error && (
          <p className="text-body-sm text-semantic-error">{fetcher.data.error}</p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="accent"
            onClick={handleSave}
            disabled={submitting}
          >
            {submitting ? "Đang lưu..." : "Lưu"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Huỷ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


