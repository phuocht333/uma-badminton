import { useEffect, useRef, useState } from "react";
import { History, Pencil } from "lucide-react";
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/cloudflare";
import { Form, Link, useActionData, useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { AppShell } from "~/components/app-shell";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ConfirmForm } from "~/components/confirm-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import { getDb, schema } from "~/db/client";
import { requireUser } from "~/lib/auth.server";
import { getEnv } from "~/lib/env.server";
import {
  approvePendingForSession,
  cancelExtraSlotRequest,
  registerVangLai,
} from "~/lib/extra-slot.server";
import {
  sendPassSlotRefundedEmail,
  sendVangLaiApprovedEmail,
} from "~/lib/email.server";
import { addCourtToSession, removeCourtFromSession } from "~/lib/court-edit.server";
import { normalizeTimeBlur } from "~/lib/time-input";
import {
  approvePassRefund,
  cancelPass,
  claimAndConfirm,
  requestPass,
  type IntentResult,
} from "~/lib/pass-slot.server";
import { CONFIG_KEYS, getAllocateConfig, getPrices, getString } from "~/lib/config.server";
import { calculateTotalHours, hoursFromHM } from "~/lib/allocate-courts";
import { formatDateTime, formatMonthYear, nextMonth, vnYearMonth, type WeekdayCode } from "~/lib/dates";
import { formatVND } from "~/lib/format";
import {
  sendAutoMatchPassSlotterEmail,
  sendAutoMatchVangLaiEmail,
} from "~/lib/email.server";
import type { AutoMatchResult } from "~/lib/auto-match.server";
import { ensureUpcomingVotingMonths } from "~/lib/vote.server";
import { AuditDescription } from "~/components/audit-description";
import { loadPendingPayments } from "~/lib/payment-summary.server";
import { loadPendingMonthPayments } from "~/lib/month-payment.server";
import { MonthPayCta } from "~/components/month-pay-cta";
import {
  buildHomeMonthSummary,
  type AuditEvent,
  type MyClaimedItem,
  type MyStatus,
  type OpenPassItem,
  type SessionView,
} from "~/lib/home-summary.server";
import { WeekdayDate } from "~/components/weekday-date";
import { AutoMatchToast } from "~/components/auto-match-toast";

const memberStatusBadge: Record<
  MyStatus,
  { text: string; tone: "accent" | "warn" | "muted" | "success" | "neutral" }
> = {
  thang: { text: "Đã đăng ký tháng", tone: "accent" },
  vang_lai: { text: "Vãng lai", tone: "warn" },
  cho_pass: { text: "Chờ pass", tone: "warn" },
  da_pass: { text: "Đã pass", tone: "muted" },
  // hoan_tien = vote refunded; from the member's perspective the current
  // state is simply "not attending this session".
  hoan_tien: { text: "Không tham gia", tone: "muted" },
  extra_pending: { text: "Chờ duyệt VL", tone: "warn" },
  none: { text: "Không tham gia", tone: "muted" },
};

export async function action({ request, context }: ActionFunctionArgs) {
  const user = await requireUser(request, context);
  const env = getEnv(context);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  if (intent === "request-vang-lai") {
    const playSessionId = String(form.get("playSessionId"));
    if (!playSessionId) return json({ error: "Thiếu buổi" }, { status: 400 });
    const result = await registerVangLai(env.DB, user.id, playSessionId);
    if ("error" in result) {
      return json({ error: result.error }, { status: 400 });
    }
    const autoMatch = result.autoMatch
      ? await dispatchAutoMatch(env, result.autoMatch)
      : null;
    return json({ ok: true, autoMatch });
  }
  if (intent === "cancel-vang-lai-request") {
    const requestId = String(form.get("requestId"));
    const ok = await cancelExtraSlotRequest(env.DB, user.id, requestId);
    if (!ok) return json({ error: "Không hợp lệ" }, { status: 400 });
    return json({ ok: true });
  }
  if (intent === "approve-all-vang-lai") {
    if (user.role !== "admin") {
      return json({ error: "Không có quyền." }, { status: 403 });
    }
    const playSessionId = String(form.get("playSessionId"));
    if (!playSessionId) return json({ error: "Thiếu buổi" }, { status: 400 });
    const db = getDb(env.DB);
    const pending = await db.query.extraSlotRequests.findMany({
      where: and(
        eq(schema.extraSlotRequests.playSessionId, playSessionId),
        isNull(schema.extraSlotRequests.approvedAt),
        isNull(schema.extraSlotRequests.cancelledAt),
        isNull(schema.extraSlotRequests.rejectedAt),
      ),
    });
    const requestIds = pending.map((r) => r.id);
    await approvePendingForSession(env.DB, playSessionId, user.id);
    // Fire emails per approved request — re-fetch each row freshly to ensure
    // it really got approved (race-safe vs. our pre-snapshot).
    const prices = await getPrices(env.DB);
    const session = await db.query.playSessions.findFirst({
      where: eq(schema.playSessions.id, playSessionId),
    });
    if (session) {
      for (const rid of requestIds) {
        try {
          const req = await db.query.extraSlotRequests.findFirst({
            where: eq(schema.extraSlotRequests.id, rid),
          });
          if (!req || !req.approvedAt) continue;
          const member = await db.query.users.findFirst({
            where: eq(schema.users.id, req.userId),
          });
          if (!member) continue;
          await sendVangLaiApprovedEmail(
            env,
            { id: member.id, name: member.name, email: member.email },
            { date: session.date, weekday: session.weekday },
            prices.vang_lai[member.gender],
          );
        } catch (e) {
          console.error("[trang-chu/action] vang-lai-approved email failed", e);
        }
      }
    }
    return json({ ok: true, approved: requestIds.length });
  }
  if (intent === "approve-pass-refund") {
    if (user.role !== "admin") return json({ error: "Không có quyền." }, { status: 403 });
    const requestId = String(form.get("requestId"));
    if (!requestId) return json({ error: "Thiếu request" }, { status: 400 });
    const res = await approvePassRefund(env.DB, requestId, user.id);
    if (!res.ok) return json({ error: "Không duyệt được" }, { status: 400 });
    try {
      const db = getDb(env.DB);
      const [member, session, refund] = await Promise.all([
        db.query.users.findFirst({ where: eq(schema.users.id, res.userId) }),
        db.query.playSessions.findFirst({
          where: eq(schema.playSessions.id, res.playSessionId),
        }),
        db.query.refundPayments.findFirst({
          where: eq(schema.refundPayments.voteId, res.voteId),
        }),
      ]);
      if (member && session && refund) {
        await sendPassSlotRefundedEmail(
          env,
          { id: member.id, name: member.name, email: member.email },
          { date: session.date, weekday: session.weekday },
          refund.amount,
        );
      }
    } catch (e) {
      console.error("[trang-chu/action] pass-refund email failed", e);
    }
    return json({ ok: true });
  }
  if (intent === "admin-add-court") {
    if (user.role !== "admin") return json({ error: "Không có quyền." }, { status: 403 });
    const r = await addCourtToSession(env.DB, {
      sessionId: String(form.get("playSessionId") || ""),
      courtCode: String(form.get("courtCode") || ""),
      startTime: String(form.get("startTime") || ""),
      endTime: String(form.get("endTime") || ""),
      adminUserId: user.id,
    });
    if ("error" in r) return json({ error: r.error }, { status: r.status ?? 400 });
    return json({ ok: true });
  }
  if (intent === "admin-remove-court") {
    if (user.role !== "admin") return json({ error: "Không có quyền." }, { status: 403 });
    const r = await removeCourtFromSession(env.DB, {
      courtId: String(form.get("courtId") || ""),
      adminUserId: user.id,
    });
    if ("error" in r) return json({ error: r.error }, { status: r.status ?? 400 });
    return json({ ok: true });
  }
  // Pass-slot intents — surfaced inline on each session card. The
  // post-auto-match "Đã thanh toán" action moved to /thanh-toan (see that
  // route's `confirm-pass-payment` intent).
  const passIntents: Record<string, (a: string) => Promise<IntentResult>> = {
    "request-pass": (voteId) => requestPass(env.DB, user.id, voteId),
    "cancel-pass": (voteId) => cancelPass(env.DB, user.id, voteId),
    "claim-and-confirm": (requestId) => claimAndConfirm(env.DB, user.id, requestId),
  };
  if (intent in passIntents) {
    const arg = String(form.get("voteId") || form.get("requestId") || "");
    if (!arg) return json({ error: "Thiếu tham số" }, { status: 400 });
    const result = await passIntents[intent](arg);
    if ("error" in result) {
      return json({ error: result.error }, { status: result.status ?? 400 });
    }
    const autoMatch = result.autoMatch
      ? await dispatchAutoMatch(env, result.autoMatch)
      : null;
    return json({ ...result, autoMatch });
  }
  return json({ error: "intent không hợp lệ" }, { status: 400 });
}

/**
 * Side-effects of an auto-match: send the two notification emails AND enrich
 * the result with counterparty names so the client can render the toast.
 * Failures in email dispatch are logged but never block the user's action —
 * the DB write is already committed and admin can chase missed notifications
 * via Zalo.
 */
export interface EnrichedAutoMatch extends AutoMatchResult {
  passSlotterName?: string;
  vangLaiName?: string;
}

async function dispatchAutoMatch(
  env: ReturnType<typeof getEnv>,
  match: AutoMatchResult,
): Promise<EnrichedAutoMatch> {
  let passSlotterName: string | undefined;
  let vangLaiName: string | undefined;
  try {
    const db = getDb(env.DB);
    const [payer, payee, session] = await Promise.all([
      db.query.users.findFirst({ where: eq(schema.users.id, match.vangLaiUserId) }),
      db.query.users.findFirst({ where: eq(schema.users.id, match.passSlotterUserId) }),
      db.query.playSessions.findFirst({ where: eq(schema.playSessions.id, match.playSessionId) }),
    ]);
    vangLaiName = payer?.name;
    passSlotterName = payee?.name;
    if (payer && payee && session) {
      const sessionRef = { date: session.date, weekday: session.weekday };
      await Promise.all([
        sendAutoMatchVangLaiEmail(
          env,
          { id: payer.id, name: payer.name, email: payer.email },
          { name: payee.name },
          sessionRef,
          match.payment,
        ),
        sendAutoMatchPassSlotterEmail(
          env,
          { id: payee.id, name: payee.name, email: payee.email },
          { name: payer.name },
          sessionRef,
          match.payment,
        ),
      ]);
    }
  } catch (e) {
    console.error("[trang-chu/action] auto-match side-effects failed", e);
  }
  return { ...match, passSlotterName, vangLaiName };
}

interface VotingMonthFullDetail {
  id: string;
  year: number;
  month: number;
  voteCloseAt: number;
  unvotedCount: number;
  sessions: Array<{ id: string; date: string; weekday: WeekdayCode; voted: boolean }>;
}

/**
 * Hydrate the "Đang mở vote" cards with each session + whether I've voted.
 * Extracted so the trang-chu loader can launch it in parallel with
 * buildHomeMonthSummary — both depend on phase-1 reads but not each other.
 */
async function loadVotingMonthDetails(
  db: ReturnType<typeof getDb>,
  userId: string,
  votingMonths: schema.Month[],
): Promise<VotingMonthFullDetail[]> {
  if (votingMonths.length === 0) return [];
  const monthIds = votingMonths.map((m) => m.id);
  const allVotingSessions = await db.query.playSessions.findMany({
    where: inArray(schema.playSessions.monthId, monthIds),
    orderBy: (s, { asc }) => [asc(s.date)],
  });
  const sessionIds = allVotingSessions.map((s) => s.id);
  const myVotes = sessionIds.length
    ? await db.query.votes.findMany({
        where: and(
          eq(schema.votes.userId, userId),
          inArray(schema.votes.playSessionId, sessionIds),
        ),
      })
    : [];
  const votedSet = new Set(
    myVotes
      .filter((v) => v.status === "thang" || v.status === "vang_lai")
      .map((v) => v.playSessionId),
  );
  const sessionsByMonth = new Map<string, schema.PlaySession[]>();
  for (const s of allVotingSessions) {
    const arr = sessionsByMonth.get(s.monthId) ?? [];
    arr.push(s);
    sessionsByMonth.set(s.monthId, arr);
  }
  return votingMonths.map((vm) => {
    const sess = sessionsByMonth.get(vm.id) ?? [];
    const unvoted = sess.filter((s) => !votedSet.has(s.id)).length;
    return {
      id: vm.id,
      year: vm.year,
      month: vm.month,
      voteCloseAt: vm.voteCloseAt,
      unvotedCount: unvoted,
      sessions: sess.map((s) => ({
        id: s.id,
        date: s.date,
        weekday: s.weekday as WeekdayCode,
        voted: votedSet.has(s.id),
      })),
    };
  });
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const user = await requireUser(request, context);
  const env = getEnv(context);

  // Setup mutations (idempotent): ensure months exist AND sweep cutoffs.
  // Both run on the same D1, no interdependency.
  await Promise.all([
    ensureUpcomingVotingMonths(env, new Date()).catch((e) =>
      console.error("[trang-chu/loader] ensureUpcomingVotingMonths failed", e),
    ),
    (async () => {
      try {
        const { sweepExpiredCutoffs } = await import("~/lib/cutoff-sweep.server");
        await sweepExpiredCutoffs(env.DB);
      } catch (e) {
        console.error("[trang-chu/loader] sweepExpiredCutoffs failed", e);
      }
    })(),
  ]);

  const db = getDb(env.DB);
  const { year, month } = vnYearMonth(new Date());
  const nextCal = nextMonth(year, month);
  const currentMonthKey = year * 100 + month;

  // Read phase 1: independent queries run in parallel — done-month list
  // (current + future), members, next-month voting candidates, admin QR,
  // prices, and the outstanding-payment count.
  const [
    candidateDoneMonths,
    members,
    votingMonths,
    adminQrKey,
    quyMomoLink,
    prices,
    pendingPayments,
    pendingMonthPayments,
    allocateConfig,
  ] = await Promise.all([
    // ALL done months — filter to (year, month) >= today's calendar month
    // below. (D1 doesn't compose this without a year*100+month expression so
    // we filter in-memory.)
    db.query.months.findMany({
      where: eq(schema.months.status, "done"),
    }),
    db.query.users.findMany({
      where: eq(schema.users.isActive, true),
      orderBy: [asc(schema.users.name)],
    }),
    // Trang-chu only surfaces the IMMEDIATE next calendar month, and only
    // when that month is in voting state. If the next calendar month has
    // already advanced to locked/done, the "Đang mở vote" banner stays
    // hidden — users shouldn't be sent to vote for a month that's two ahead.
    db.query.months.findMany({
      where: and(
        eq(schema.months.year, nextCal.year),
        eq(schema.months.month, nextCal.month),
        eq(schema.months.status, "voting"),
      ),
      limit: 1,
    }),
    getString(env.DB, CONFIG_KEYS.ADMIN_QR_IMAGE_KEY, ""),
    getString(env.DB, CONFIG_KEYS.QUY_MOMO_LINK, ""),
    getPrices(env.DB),
    loadPendingPayments(env.DB, user.id),
    loadPendingMonthPayments(env.DB, user.id),
    getAllocateConfig(env.DB),
  ]);
  const memberById = new Map(members.map((u) => [u.id, u] as const));

  // Show every "done" month from the current calendar month onwards, sorted
  // ascending. Past months drop off naturally — sessions with `date < today`
  // also drop off inside `buildHomeMonthSummary`.
  const doneMonths = candidateDoneMonths
    .filter((m) => m.year * 100 + m.month >= currentMonthKey)
    .sort((a, b) => a.year * 100 + a.month - (b.year * 100 + b.month));

  // Read phase 2: build one HomeMonthSummary per done month in parallel +
  // voting-month detail (independent of monthSummaries).
  const [monthSummariesRaw, pendingVoteMonths] = await Promise.all([
    Promise.all(
      doneMonths.map((m) => buildHomeMonthSummary(env.DB, m, memberById, user.id)),
    ),
    loadVotingMonthDetails(db, user.id, votingMonths),
  ]);
  // Drop months that ended up with no upcoming sessions (everything in the
  // past or no courts) — don't render empty section headers.
  const monthSummaries = monthSummariesRaw.filter((s) => s.sessions.length > 0);

  return json({
    user,
    monthSummaries,
    pendingVoteMonths,
    pendingMonthPayments,
    quyMomoLink: quyMomoLink || null,
    adminQrUrl: adminQrKey ? `/qr/${encodeURIComponent(adminQrKey)}` : null,
    outstandingCount: pendingPayments.outgoing.length,
    outstandingAmount: pendingPayments.outgoing.reduce((sum, p) => sum + p.amount, 0),
    incomingCount: pendingPayments.incoming.length,
    incomingAmount: pendingPayments.incoming.reduce((sum, p) => sum + p.amount, 0),
    // Prices needed for the claim-slot gender-cross popup. From config — admin
    // can edit in /admin/config.
    thangPrices: prices.thang,
    vangLaiPrices: prices.vang_lai,
    peoplePerHour: allocateConfig.peoplePerHour,
    minPeoplePerSession: allocateConfig.minPeoplePerSession,
  });
}

export default function TrangChu() {
  const data = useLoaderData<typeof loader>();
  // Action responses sent via useSubmit (ConfirmForm — request-pass) land in
  // useActionData. Fetcher-based submissions (VangLaiDialog) bubble their
  // autoMatch up via the callback below. AutoMatchToast picks whichever is
  // newest (refs ensure each match toasts once even on re-render).
  const actionData = useActionData() as { autoMatch?: EnrichedAutoMatch | null } | undefined;
  const [fetcherAutoMatch, setFetcherAutoMatch] = useState<EnrichedAutoMatch | null>(null);
  const liveAutoMatch = fetcherAutoMatch ?? actionData?.autoMatch ?? null;

  return (
    <AppShell user={data.user as never}>
      <div className="space-y-5">
        {(data.outstandingCount > 0 || data.incomingCount > 0) && (
          <OutstandingPaymentsCard
            outstandingAmount={data.outstandingAmount}
            incomingAmount={data.incomingAmount}
            incomingCount={data.incomingCount}
          />
        )}
        {data.pendingVoteMonths.length > 0 && (
          <VoteOpenCard months={data.pendingVoteMonths} />
        )}

        {data.pendingMonthPayments.length > 0 && (
          <PendingMonthPaymentsBanner
            months={data.pendingMonthPayments}
            adminQrUrl={data.adminQrUrl}
            quyMomoLink={data.quyMomoLink}
          />
        )}

        {data.monthSummaries.map((ms) => (
          <section key={ms.monthId} className="space-y-3">
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-title-md text-ink">
                Tháng {formatMonthYear(ms.year, ms.month)}
              </h2>
              <Link
                to="/lich"
                className="text-body-sm text-accent underline-offset-4 hover:underline"
              >
                Lịch đã vote →
              </Link>
            </header>
            <div className="grid gap-3 sm:grid-cols-2">
              {ms.sessions.map((s) => (
                <Card
                  key={s.id}
                  id={`session-${s.id}`}
                  tone={s.isThisWeek ? "accent" : "default"}
                  className={
                    s.isThisWeek
                      ? "scroll-mt-20 ring-1 ring-accent/40"
                      : "scroll-mt-20"
                  }
                >
                  <CardContent className="space-y-3 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 text-title-md">
                          <WeekdayDate weekday={s.weekday} date={s.date} />
                          {s.isThisWeek && (
                            <span className="rounded-sm bg-accent-tint px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent-deep">
                              Tuần này
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <Badge tone={memberStatusBadge[s.myStatus].tone}>
                          {memberStatusBadge[s.myStatus].text}
                        </Badge>
                        <SessionMenu
                          session={s}
                          isAdmin={data.user.role === "admin"}
                          monthStatus={ms.status}
                        />
                      </div>
                    </div>

                    {s.courts.length > 0 && (
                      <ul className="space-y-0.5 text-body-sm">
                        {s.courts.map((c, i) => (
                          <li key={i} className="flex items-center gap-2">
                            <span className="font-mono text-body-sm font-semibold uppercase text-accent-deep">
                              {c.code}
                            </span>
                            <span className="text-muted">
                              {c.start}–{c.end}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {(() => {
                      // Two member-only summary buckets remain ("Đã đăng ký
                      // tháng", "Vãng lai thành công"). The pass-slot list
                      // is rendered separately inside SessionActions because
                      // each row carries an action (claim or huỷ).
                      const thangPlayers = s.players.filter((p) => p.status === "thang");
                      const vangLaiPlayers = s.players.filter((p) => p.status === "vang_lai");
                      return (
                        <>
                          {thangPlayers.length > 0 && (
                            <details className="text-body-sm">
                              <summary className="cursor-pointer text-muted hover:text-ink">
                                Đã đăng ký tháng ({thangPlayers.length})
                              </summary>
                              <ul className="mt-2 grid grid-cols-2 gap-1">
                                {thangPlayers.map((p, i) => (
                                  <li key={i} className="flex items-center gap-1.5">
                                    <span className={p.isMe ? "font-medium text-accent-deep" : ""}>
                                      {p.name}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                          {vangLaiPlayers.length > 0 && (
                            <details className="text-body-sm">
                              <summary className="cursor-pointer text-muted hover:text-ink">
                                Vãng lai thành công ({vangLaiPlayers.length})
                              </summary>
                              <ul className="mt-2 grid grid-cols-2 gap-1">
                                {vangLaiPlayers.map((p, i) => (
                                  <li key={i} className="flex items-center gap-1.5">
                                    <span className={p.isMe ? "font-medium text-accent-deep" : ""}>
                                      {p.name}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                          {s.pendingVangLai.length > 0 && (
                            <details className="text-body-sm">
                              <summary className="cursor-pointer text-muted hover:text-ink">
                                <span className="inline-flex items-center gap-2">
                                  Vãng lai đang chờ ({s.pendingVangLai.length})
                                  {data.user.role === "admin" && (
                                    <ApproveVangLaiButton
                                      session={s}
                                      peoplePerHour={data.peoplePerHour}
                                    />
                                  )}
                                </span>
                              </summary>
                              <ul className="mt-2 space-y-1">
                                {s.pendingVangLai.map((p) => (
                                  <li
                                    key={p.requestId}
                                    className="flex items-center justify-between gap-2"
                                  >
                                    <span className={p.isMe ? "font-medium text-accent-deep" : ""}>
                                      {p.name}
                                    </span>
                                    {p.isMe && (
                                      <Form method="post">
                                        <input
                                          type="hidden"
                                          name="intent"
                                          value="cancel-vang-lai-request"
                                        />
                                        <input
                                          type="hidden"
                                          name="requestId"
                                          value={p.requestId}
                                        />
                                        <Button type="submit" variant="ghost" size="sm">
                                          Huỷ
                                        </Button>
                                      </Form>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </>
                      );
                    })()}

                    {!s.isLocked && (
                      <SessionActions
                        session={s}
                        meGender={data.user.gender as "nam" | "nu"}
                        thangPrices={data.thangPrices}
                        vangLaiPrices={data.vangLaiPrices}
                        adminQrUrl={data.adminQrUrl}
                        isAdmin={data.user.role === "admin"}
                        onAutoMatch={setFetcherAutoMatch}
                      />
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        ))}

      </div>
      <AutoMatchToast
        autoMatch={liveAutoMatch ?? undefined}
        meUserId={data.user.id}
        passSlotterName={liveAutoMatch?.passSlotterName}
        vangLaiName={liveAutoMatch?.vangLaiName}
      />
    </AppShell>
  );
}


interface VotingMonthCard {
  id: string;
  year: number;
  month: number;
  voteCloseAt: number;
  unvotedCount: number;
  sessions: Array<{ id: string; date: string; weekday: WeekdayCode; voted: boolean }>;
}

/**
 * Inline per-session actions stacked on the right side of the card —
 * replaces the previous 3-dot dropdown. Shows direct text+icon buttons so
 * the user sees the action without an extra click.
 */
function SessionMenu({
  session,
  isAdmin,
  monthStatus,
}: {
  session: SessionView;
  isAdmin: boolean;
  monthStatus: schema.Month["status"];
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  // Admin có thể sửa sân ở trạng thái locked hoặc done — done tháng vẫn cần
  // mở để add sân cho các duyệt vãng lai phát sinh sau. Buổi đã qua
  // (s.isLocked) thì khoá.
  const showEdit =
    isAdmin && (monthStatus === "locked" || monthStatus === "done") && !session.isLocked;
  const showHistory = session.history.length > 0;
  if (!showEdit && !showHistory) return null;
  return (
    <>
      <div className="flex items-center gap-3 text-caption">
        {showEdit && (
          <Link
            to={`/admin/sessions/${session.id}`}
            className="inline-flex items-center gap-1 text-ink hover:text-accent-deep"
          >
            <Pencil className="h-3.5 w-3.5" /> Sửa sân
          </Link>
        )}
        {showHistory && (
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="inline-flex items-center gap-1 text-ink hover:text-accent-deep"
          >
            <History className="h-3.5 w-3.5" /> Xem lịch sử
          </button>
        )}
      </div>
      {showHistory && (
        <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>
                Lịch sử <WeekdayDate weekday={session.weekday} date={session.date} />
              </SheetTitle>
            </SheetHeader>
            <SheetBody className="space-y-2">
              {session.history.map((e) => (
                <div
                  key={e.id}
                  className="flex items-start justify-between gap-3 rounded-md border border-hairline px-3 py-2 text-body-sm"
                >
                  <div className="space-y-0.5">
                    <p className="text-ink">
                      <AuditDescription event={e} />
                    </p>
                    <p className="text-caption text-muted">{formatDateTime(e.createdAt)}</p>
                  </div>
                </div>
              ))}
            </SheetBody>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}

/**
 * Reminder banner for done months on which the caller still owes money. After
 * the user confirms payment via the MonthPayCta dialog, Remix revalidates the
 * loader and the paid month drops out — the row disappears automatically.
 */
function PendingMonthPaymentsBanner({
  months,
  adminQrUrl,
  quyMomoLink,
}: {
  months: Array<{ monthId: string; year: number; month: number; totalFee: number }>;
  adminQrUrl: string | null;
  quyMomoLink: string | null;
}) {
  return (
    <Card tone="accent">
      <CardContent className="space-y-2 py-4">
        {months.map((m) => (
          <div
            key={m.monthId}
            className="flex flex-wrap items-center justify-between gap-3"
          >
            <p className="text-body-sm text-ink">
              Sân tháng <strong>{formatMonthYear(m.year, m.month)}</strong> đã đặt,
              bạn cần thanh toán:{" "}
              <strong className="font-semibold">{formatVND(m.totalFee)}</strong>
            </p>
            <MonthPayCta
              monthId={m.monthId}
              iPaid={false}
              amount={m.totalFee}
              year={m.year}
              month={m.month}
              adminQrUrl={adminQrUrl}
              quyMomoLink={quyMomoLink}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function VoteOpenCard({ months }: { months: VotingMonthCard[] }) {
  // Redirect into /lich and anchor on the voting month card — vote is filled
  // in-place below each month so members see context (date list + bill) while
  // voting. We pick the earliest voting month for the anchor; users can scroll
  // to the others if there are multiple.
  const firstId = months[0]?.id;
  // "Sửa vote" once the user has at least one yes vote in any open month —
  // otherwise the prompt is the initial "Vote ngay" CTA.
  const hasVoted = months.some((m) => m.sessions.some((s) => s.voted));
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 py-4">
        <div>
          <p className="eyebrow text-accent-deep">Đang mở vote</p>
          <p className="mt-0.5 text-body-md text-ink">
            {months.map((m) => formatMonthYear(m.year, m.month)).join(" · ")}
          </p>
        </div>
        <Link to={firstId ? `/lich#thang-${firstId}` : "/lich"} prefetch="intent">
          <Button variant="accent" size="sm">
            {hasVoted ? "Đổi vote →" : "Vote ngay →"}
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

function SessionActions({
  session,
  meGender,
  thangPrices,
  vangLaiPrices,
  adminQrUrl,
  isAdmin,
  onAutoMatch,
}: {
  session: SessionView;
  meGender: "nam" | "nu";
  thangPrices: { nam: number; nu: number };
  vangLaiPrices: { nam: number; nu: number };
  adminQrUrl: string | null;
  isAdmin: boolean;
  onAutoMatch: (m: EnrichedAutoMatch | null) => void;
}) {
  const nav = useNavigation();
  const submitting = nav.state === "submitting";
  // Suppress vãng lai registration when this session already has open passes —
  // the user should claim an existing pass instead of queueing for a new seat.
  const hasOpenPass = session.openPassRequests.length > 0;
  const showVangLai =
    !hasOpenPass &&
    (session.myStatus === "none" || session.myStatus === "extra_pending");
  // Both thang AND vang_lai voters can pass their slot — they're "in" already.
  const showRequestPass =
    !!session.myVoteId &&
    (session.myStatus === "thang" || session.myStatus === "vang_lai");
  // I'm already attached to a seat on this session — claiming someone else's
  // pass would create a conflict. Disable the Nhận slot button.
  const hasSeatHere =
    session.myStatus === "thang" ||
    session.myStatus === "vang_lai" ||
    session.myStatus === "cho_pass";
  const [expanded, setExpanded] = useState(false);

  const filtered = session.openPassRequests;
  // Single FIFO: only the oldest open slot can be claimed at any moment.
  // The viewer's own slot can't be claimed by them (Huỷ instead) but it
  // still occupies the head-of-line spot for everyone else.
  const headOfLineId = filtered[0]?.requestId ?? null;

  return (
    <div className="space-y-2 border-t border-hairline pt-3">
      {/* Unified "Đang pass slot" list — owner's row gets Huỷ inline; other
          rows get Nhận slot (head-of-line) or Đang chờ (queued). */}
      {filtered.length > 0 && (
        <details
          className="text-body-sm"
          open={expanded || filtered.some((p) => p.isMe)}
          onToggle={(e) => setExpanded((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer text-muted hover:text-ink">
            Đang pass slot ({filtered.length})
          </summary>
          <div className="mt-2 space-y-1.5">
            {filtered.map((p) => {
              return (
                <div
                  key={p.requestId}
                  className="flex items-center justify-between gap-2 rounded-md border border-hairline bg-canvas-soft px-3 py-2"
                >
                  <span
                    className={
                      p.isMe ? "font-medium text-[#B45309]" : "font-medium text-ink"
                    }
                  >
                    {p.ownerName}
                  </span>
                  <div className="flex items-center gap-2">
                    {isAdmin && (
                      <ApproveRefundButton
                        requestId={p.requestId}
                        ownerName={p.ownerName}
                        amount={thangPrices[p.ownerGender]}
                      />
                    )}
                    {p.isMe ? (
                      !session.isLocked && session.myVoteId ? (
                        <ConfirmForm
                          fields={{ intent: "cancel-pass", voteId: session.myVoteId }}
                          title="Huỷ pass slot?"
                          description="Slot trở về như cũ, bạn vẫn đi đánh buổi này."
                          confirmLabel="Huỷ pass"
                          variant="outline"
                          size="sm"
                          disabled={submitting}
                        >
                          Huỷ
                        </ConfirmForm>
                      ) : null
                    ) : hasSeatHere ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled
                        title={
                          session.myStatus === "cho_pass"
                            ? "Bạn đang chờ pass slot — không nhận thêm slot khác"
                            : "Bạn đã có slot cho buổi này"
                        }
                      >
                        Nhận slot
                      </Button>
                    ) : p.requestId === headOfLineId ? (
                      <ClaimSlotDialog
                        item={p}
                        meGender={meGender}
                        thangPrices={thangPrices}
                        adminQrUrl={adminQrUrl}
                        disabled={submitting}
                      />
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled
                        title="Slot cũ nhất phải được nhận trước"
                      >
                        Đang chờ
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      )}

      {/* My actions row */}
      <div className="flex flex-wrap gap-2">
        {showRequestPass && (
          <ConfirmForm
            fields={{ intent: "request-pass", voteId: session.myVoteId! }}
            title="Pass slot này?"
            description="Chờ người nhận slot hoặc Admin duyệt nhé. Có thể huỷ trước đó."
            confirmLabel="Pass slot"
            variant="accent"
            size="sm"
            disabled={submitting}
          >
            Pass slot
          </ConfirmForm>
        )}
        {showVangLai && session.myStatus === "none" && (
          <VangLaiDialog session={session} disabled={submitting} onAutoMatch={onAutoMatch} />
        )}
      </div>
    </div>
  );
}


/* ---------- Claim-slot dialog: gender-cross instructions ---------- */
interface ClaimDialogItem {
  requestId: string;
  ownerName: string;
  ownerGender: "nam" | "nu";
  ownerQrUrl: string | null;
}

/**
 * Centered modal: single-step "nhận + xác nhận đã chuyển". The user reads the
 * instructions + QR, then clicks one button that atomically claims the slot
 * AND marks it confirmed. The seat moves to them immediately; an inline toast
 * confirms the action before the dialog auto-closes.
 */
function ClaimSlotDialog({
  item,
  meGender,
  thangPrices,
  adminQrUrl,
  disabled,
  triggerLabel = "Nhận slot",
}: {
  item: ClaimDialogItem;
  meGender: "nam" | "nu";
  thangPrices: { nam: number; nu: number };
  adminQrUrl: string | null;
  disabled: boolean;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const fetcher = useFetcher<{ ok?: true; error?: string }>();
  const submitting = fetcher.state !== "idle";
  const succeeded = fetcher.state === "idle" && fetcher.data && "ok" in fetcher.data && fetcher.data.ok;

  // Auto-close shortly after success so the user sees the toast first.
  useEffect(() => {
    if (succeeded) {
      const t = setTimeout(() => setOpen(false), 1400);
      return () => clearTimeout(t);
    }
  }, [succeeded]);

  const ownerPrice = thangPrices[item.ownerGender];
  const mePrice = thangPrices[meGender];
  const sameGender = meGender === item.ownerGender;
  const fundExtra = !sameGender && mePrice > ownerPrice ? mePrice - ownerPrice : 0;
  const refundDue = !sameGender && mePrice < ownerPrice ? ownerPrice - mePrice : 0;

  function doConfirm() {
    const fd = new FormData();
    fd.set("intent", "claim-and-confirm");
    fd.set("requestId", item.requestId);
    fetcher.submit(fd, { method: "post" });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="accent" size="sm" disabled={disabled}>
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nhận slot — chuyển tiền + xác nhận</DialogTitle>
          <DialogDescription>
            Chuyển tiền theo QR bên dưới, xong bấm <strong>Tôi đã chuyển</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-accent/40 bg-accent-tint p-3">
            <p className="text-caption text-accent-deep">Chuyển cho người pass</p>
            <p className="mt-1 text-body-sm">
              Chuyển <strong>{formatVND(ownerPrice)}</strong> cho{" "}
              <strong>{item.ownerName}</strong>
            </p>
            {item.ownerQrUrl ? (
              <img
                src={item.ownerQrUrl}
                alt={`QR ${item.ownerName}`}
                width={220}
                height={220}
                loading="lazy"
                className="mt-2 rounded-md border border-hairline bg-white"
              />
            ) : (
              <p className="mt-1 text-caption text-muted">
                {item.ownerName} chưa upload QR — liên hệ trực tiếp.
              </p>
            )}
          </div>

          {fundExtra > 0 && (
            <div className="rounded-md border border-hairline p-3">
              <p className="text-caption text-accent-deep">Chuyển thêm cho quỹ</p>
              <p className="mt-1 text-body-sm">
                Bạn Nam nhận slot của {item.ownerName} (Nữ) — chênh lệch{" "}
                <strong>{formatVND(fundExtra)}</strong> chuyển vào quỹ chung.
              </p>
              {adminQrUrl ? (
                <img
                  src={adminQrUrl}
                  alt="QR quỹ"
                  width={220}
                  height={220}
                  loading="lazy"
                  className="mt-2 rounded-md border border-hairline bg-white"
                />
              ) : (
                <p className="mt-1 text-caption text-muted">
                  Admin chưa upload QR quỹ — nhắn Admin để chuyển.
                </p>
              )}
            </div>
          )}

          {refundDue > 0 && (
            <div className="rounded-md border border-hairline p-3">
              <p className="text-caption text-accent-deep">Nhận lại tiền dư</p>
              <p className="mt-1 text-body-sm">
                Bạn Nữ nhận slot của {item.ownerName} (Nam) — sau khi chuyển{" "}
                <strong>{formatVND(ownerPrice)}</strong>, dùng MoMo request lại{" "}
                <strong>{formatVND(refundDue)}</strong> từ {item.ownerName}.
              </p>
            </div>
          )}

          {succeeded && (
            <p className="rounded-md border border-[#10B981]/40 bg-[#ECFDF5] px-3 py-2 text-body-sm text-[#047857]">
              ✓ Đã nhận slot từ {item.ownerName}
            </p>
          )}
          {fetcher.data?.error && (
            <p className="text-body-sm text-semantic-error">{fetcher.data.error}</p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="accent" onClick={doConfirm} disabled={submitting || succeeded}>
            {submitting ? "Đang xử lý..." : succeeded ? "Đã ghi nhận" : "Tôi đã chuyển"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Huỷ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Đăng ký vãng lai dialog — single flow: submit one pending request and wait
 * for admin approval (or auto-match against an open pass-slot on the same
 * session). Payment instructions live in /thanh-toan post-approval.
 */
function VangLaiDialog({
  session,
  disabled,
  onAutoMatch,
}: {
  session: SessionView;
  disabled: boolean;
  onAutoMatch?: (m: EnrichedAutoMatch | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const fetcher = useFetcher<{ ok?: true; error?: string; autoMatch?: EnrichedAutoMatch | null }>();
  const submitting = fetcher.state !== "idle";
  const succeeded = fetcher.state === "idle" && fetcher.data && "ok" in fetcher.data && fetcher.data.ok;

  useEffect(() => {
    if (succeeded) {
      const t = setTimeout(() => setOpen(false), 1500);
      return () => clearTimeout(t);
    }
  }, [succeeded]);

  // Bubble auto-match outcome up so the trang-chu toast can render. Only fires
  // when the server actually returned a match (server returns null when no
  // counterpart was waiting).
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.autoMatch) {
      onAutoMatch?.(fetcher.data.autoMatch);
    }
  }, [fetcher.state, fetcher.data, onAutoMatch]);

  function submit() {
    const fd = new FormData();
    fd.set("intent", "request-vang-lai");
    fd.set("playSessionId", session.id);
    fetcher.submit(fd, { method: "post" });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          Đăng ký vãng lai
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Đăng ký vãng lai — <WeekdayDate weekday={session.weekday} date={session.date} />
          </DialogTitle>
          <DialogDescription>
            Sau khi đăng ký, chờ người khác pass slot hoặc admin duyệt.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {succeeded && (
            <p className="rounded-md border border-[#F59E0B]/40 bg-[#FFFBEB] px-3 py-2 text-body-sm text-[#B45309]">
              ✓ Đã gửi yêu cầu — chờ Admin duyệt
            </p>
          )}
          {fetcher.data?.error && (
            <p className="text-body-sm text-semantic-error">{fetcher.data.error}</p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="accent"
            onClick={submit}
            disabled={submitting || !!succeeded}
          >
            {submitting ? "Đang gửi..." : succeeded ? "Đã gửi" : "Gửi yêu cầu"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Huỷ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Compact homepage reminder pointing at /thanh-toan. Replaces the previous
 * in-place PendingPaymentsBanner: the auto-match moment is now covered by a
 * 6s toast; this card is the persistent "you still have unpaid items" hook
 * that lives on the homepage until everything clears.
 */
function OutstandingPaymentsCard({
  outstandingAmount,
  incomingAmount,
  incomingCount,
}: {
  outstandingAmount: number;
  incomingAmount: number;
  incomingCount: number;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-[#F59E0B]/40 bg-[#FFFBEB] p-3">
      {outstandingAmount > 0 && (
        <div>
          <p className="eyebrow text-[#B45309]">Cần trả</p>
          <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2">
            <p className="text-body-md text-ink">
              Bạn chưa thanh toán <strong>{formatVND(outstandingAmount)}</strong>
            </p>
            <Button asChild variant="accent" size="sm">
              <Link to="/thanh-toan" prefetch="intent">Thanh toán →</Link>
            </Button>
          </div>
        </div>
      )}
      {incomingCount > 0 && (
        <div>
          <p className="eyebrow text-accent-deep">Cần thu</p>
          <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2">
            <p className="text-body-md text-ink">
              {incomingCount} người sẽ chuyển{" "}
              <strong>{formatVND(incomingAmount)}</strong> cho bạn
            </p>
            <Button asChild variant="outline" size="sm">
              <Link to="/thanh-toan" prefetch="intent">Chi tiết →</Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Admin: duyệt all pending vãng lai for a session ---------- */
function ApproveVangLaiButton({
  session,
  peoplePerHour,
}: {
  session: SessionView;
  peoplePerHour: number;
}) {
  const [open, setOpen] = useState(false);
  const fetcher = useFetcher<{ ok?: true; error?: string; approved?: number }>();
  const submitting = fetcher.state !== "idle";
  const succeeded = fetcher.data?.ok;
  const submittedRef = useRef(false);

  // Auto-close once the approval actually lands — same gating pattern as
  // AllCourtsEditDialog so a stale {ok:true} on reopen doesn't slam it shut.
  useEffect(() => {
    if (fetcher.state !== "idle") {
      submittedRef.current = true;
      return;
    }
    if (submittedRef.current && succeeded) {
      submittedRef.current = false;
      setOpen(false);
    }
  }, [fetcher.state, succeeded]);

  const pendingCount = session.pendingVangLai.length;
  const currentPlayers = session.playerCount;
  const newPlayers = currentPlayers + pendingCount;
  const currentHours = session.courts.reduce(
    (sum, c) => sum + hoursFromHM(c.start, c.end),
    0,
  );
  const requiredHours = calculateTotalHours(newPlayers, peoplePerHour);
  const enough = currentHours >= requiredHours;

  function submit() {
    const fd = new FormData();
    fd.set("intent", "approve-all-vang-lai");
    fd.set("playSessionId", session.id);
    fetcher.submit(fd, { method: "post" });
  }

  return (
    <>
      <Button
        type="button"
        variant="accent"
        size="sm"
        onClick={(e) => {
          // Don't toggle the surrounding <details>.
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        Duyệt
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Duyệt {pendingCount} vãng lai —{" "}
              <WeekdayDate weekday={session.weekday} date={session.date} />
            </DialogTitle>
            <DialogDescription>
              Khi duyệt, các thành viên này sẽ vào danh sách "Vãng lai thành công".
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-body-sm">
            <ul className="space-y-0.5 rounded-md border border-hairline bg-canvas-soft p-3">
              <li>
                Người đang đánh: <strong>{currentPlayers}</strong>
              </li>
              <li>
                Sau khi duyệt: <strong>{newPlayers}</strong> người
              </li>
              <li>
                Giờ sân hiện có: <strong>{currentHours}</strong> tiếng
              </li>
              <li>
                Tối thiểu cần: <strong>{requiredHours}</strong> tiếng
              </li>
            </ul>
            {enough ? (
              <p className="rounded-md border border-[#10B981]/40 bg-[#ECFDF5] px-3 py-2 text-[#047857]">
                Đủ giờ sân cho tất cả.
              </p>
            ) : (
              <p className="rounded-md border border-[#F59E0B]/40 bg-[#FFFBEB] px-3 py-2 text-[#B45309]">
                ⚠️ Chưa đủ giờ sân, cần thêm sân.
              </p>
            )}
            <CourtEditInline session={session} />
            {fetcher.data?.error && (
              <p className="text-semantic-error">{fetcher.data.error}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="accent"
              onClick={submit}
              disabled={submitting || succeeded}
            >
              {submitting ? "Đang duyệt..." : succeeded ? "Đã duyệt" : "Duyệt"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Huỷ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ---------- Admin: duyệt hoàn tiền for an unclaimed pass slot ---------- */
function ApproveRefundButton({
  requestId,
  ownerName,
  amount,
}: {
  requestId: string;
  ownerName: string;
  amount: number;
}) {
  return (
    <ConfirmForm
      fields={{ intent: "approve-pass-refund", requestId }}
      title="Duyệt hoàn tiền?"
      description={`Quỹ sẽ trả lại ${formatVND(amount)} cho ${ownerName}. Sau khi duyệt, khoản này hiện trong "Quỹ cần trả".`}
      confirmLabel="Duyệt hoàn tiền"
      variant="accent"
      size="sm"
    >
      Duyệt
    </ConfirmForm>
  );
}

/* ---------- Inline court editor used inside the Duyệt popup ---------- */
function CourtEditInline({ session }: { session: SessionView }) {
  const removeFetcher = useFetcher<{ ok?: true; error?: string }>();
  const addFetcher = useFetcher<{ ok?: true; error?: string }>();
  const [code, setCode] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  // Reset the add form once a submission lands successfully.
  useEffect(() => {
    if (addFetcher.state === "idle" && addFetcher.data && "ok" in addFetcher.data && addFetcher.data.ok) {
      setCode("");
      setStart("");
      setEnd("");
    }
  }, [addFetcher.state, addFetcher.data]);

  function submitRemove(courtId: string) {
    const fd = new FormData();
    fd.set("intent", "admin-remove-court");
    fd.set("courtId", courtId);
    removeFetcher.submit(fd, { method: "post" });
  }

  function submitAdd() {
    const fd = new FormData();
    fd.set("intent", "admin-add-court");
    fd.set("playSessionId", session.id);
    fd.set("courtCode", code);
    fd.set("startTime", start);
    fd.set("endTime", end);
    addFetcher.submit(fd, { method: "post" });
  }

  const adding = addFetcher.state !== "idle";
  const removing = removeFetcher.state !== "idle";

  return (
    <div className="space-y-2 rounded-md border border-hairline bg-surface-card p-3">
      <p className="eyebrow text-muted">Sửa sân</p>
      {session.courts.length === 0 && (
        <p className="text-caption text-muted">Chưa có sân nào.</p>
      )}
      {session.courts.length > 0 && (
        <ul className="space-y-1">
          {session.courts.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-2 rounded-md border border-hairline px-2 py-1.5 text-body-sm"
            >
              <span>
                <span className="font-mono text-label-mono uppercase tracking-wider text-accent-deep">
                  {c.code}
                </span>{" "}
                {c.start}–{c.end}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={removing}
                onClick={() => submitRemove(c.id)}
                aria-label={`Bỏ sân ${c.code}`}
              >
                ✕
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-hairline-strong bg-canvas-soft p-2">
        <div className="w-20">
          <label className="text-caption text-muted">Sân</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="B1"
            className="h-9 w-full rounded-md border border-hairline-strong bg-white px-2 text-body-sm"
          />
        </div>
        <div className="w-24">
          <label className="text-caption text-muted">Bắt đầu</label>
          <input
            value={start}
            onChange={(e) => setStart(e.target.value)}
            onBlur={(e) => {
              normalizeTimeBlur(e);
              setStart(e.currentTarget.value);
            }}
            placeholder="08:00"
            inputMode="numeric"
            className="h-9 w-full rounded-md border border-hairline-strong bg-white px-2 text-body-sm"
          />
        </div>
        <div className="w-24">
          <label className="text-caption text-muted">Kết thúc</label>
          <input
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            onBlur={(e) => {
              normalizeTimeBlur(e);
              setEnd(e.currentTarget.value);
            }}
            placeholder="10:00"
            inputMode="numeric"
            className="h-9 w-full rounded-md border border-hairline-strong bg-white px-2 text-body-sm"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={adding || !code.trim() || !start.trim() || !end.trim()}
          onClick={submitAdd}
        >
          {adding ? "Đang thêm..." : "Thêm sân"}
        </Button>
      </div>
      {(removeFetcher.data?.error || addFetcher.data?.error) && (
        <p className="text-caption text-semantic-error">
          {removeFetcher.data?.error || addFetcher.data?.error}
        </p>
      )}
    </div>
  );
}

/* ---------- Helper: submit via fetcher-like pattern ---------- */
function useSubmitFetcher() {
  const f = useFetcher();
  return (intent: string, requestId: string) => {
    const fd = new FormData();
    fd.set("intent", intent);
    fd.set("requestId", requestId);
    f.submit(fd, { method: "post" });
  };
}

