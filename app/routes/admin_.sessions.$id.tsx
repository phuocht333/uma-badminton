/**
 * Per-session court editing — focused page so admin can jump straight from a
 * trang-chu session card to "thêm sân / huỷ sân" without scrolling through
 * the whole month view.
 *
 * Intentionally narrow: only the session's courts + pending vãng lai
 * requests + the add-court form. Bills, matrix, audit log live elsewhere.
 */
import {
  json,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/cloudflare";
import { Form, Link, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { and, asc, eq, isNull } from "drizzle-orm";
import { useRef, useState } from "react";
import { ulid } from "ulid";
import { AppShell } from "~/components/app-shell";
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
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { WeekdayDate } from "~/components/weekday-date";
import { formatVND } from "~/lib/format";
import { normalizeHHMM, normalizeTimeBlur } from "~/lib/time-input";
import { getDb, schema } from "~/db/client";
import { requireAdmin } from "~/lib/auth.server";
import { audit, loadSessionAuditEvents } from "~/lib/audit.server";
import { AuditDescription } from "~/components/audit-description";
import { formatDateTime } from "~/lib/dates";
import { getEnv } from "~/lib/env.server";
import { CONFIG_KEYS, getPrices, getString } from "~/lib/config.server";
import {
  approvePendingForSession,
  approveSingleRequest,
  refundPendingPassRequests,
  rejectSingleExtraSlotRequest,
} from "~/lib/extra-slot.server";
import { addCourtToSession, removeCourtFromSession } from "~/lib/court-edit.server";
import {
  approvePassRefund,
  rejectPassRequest,
} from "~/lib/pass-slot.server";
import {
  sendPassSlotRefundedEmail,
  sendPassSlotRejectedEmail,
  sendVangLaiApprovedEmail,
  sendVangLaiRejectedEmail,
} from "~/lib/email.server";

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const user = await requireAdmin(request, context);
  const env = getEnv(context);
  const db = getDb(env.DB);
  const id = params.id ?? "";
  if (!id) throw new Response("Thiếu sessionId", { status: 400 });

  const session = await db.query.playSessions.findFirst({
    where: eq(schema.playSessions.id, id),
  });
  if (!session) throw new Response("Không tìm thấy buổi", { status: 404 });

  const month = await db.query.months.findFirst({
    where: eq(schema.months.id, session.monthId),
  });
  if (!month) throw new Response("Không tìm thấy tháng", { status: 404 });

  const [courts, pendingExtras, choPassVotes, prices, adminQrKey] = await Promise.all([
    db.query.courtAllocations.findMany({
      where: eq(schema.courtAllocations.playSessionId, id),
      orderBy: [asc(schema.courtAllocations.displayOrder)],
    }),
    db.query.extraSlotRequests.findMany({
      where: and(
        eq(schema.extraSlotRequests.playSessionId, id),
        isNull(schema.extraSlotRequests.approvedAt),
        isNull(schema.extraSlotRequests.cancelledAt),
        isNull(schema.extraSlotRequests.rejectedAt),
      ),
      orderBy: [asc(schema.extraSlotRequests.createdAt)],
    }),
    db.query.votes.findMany({
      where: and(
        eq(schema.votes.playSessionId, id),
        eq(schema.votes.status, "cho_pass"),
      ),
    }),
    getPrices(env.DB),
    getString(env.DB, CONFIG_KEYS.ADMIN_QR_IMAGE_KEY, ""),
  ]);
  const adminQrUrl = adminQrKey ? `/qr/${encodeURIComponent(adminQrKey)}` : null;

  const choPassVoteIds = choPassVotes.map((v) => v.id);
  const pendingPassRequests = choPassVoteIds.length
    ? await db.query.passRequests.findMany({
        where: (pr, { inArray }) => inArray(pr.voteId, choPassVoteIds),
        orderBy: [asc(schema.passRequests.createdAt)],
      })
    : [];
  const openPassRequests = pendingPassRequests.filter(
    (pr) => pr.claimedAt == null && pr.rejectedAt == null,
  );

  const userIds = [
    ...pendingExtras.map((r) => r.userId),
    ...openPassRequests.flatMap((pr) => {
      const v = choPassVotes.find((vv) => vv.id === pr.voteId);
      return v ? [v.userId] : [];
    }),
  ];
  const users = userIds.length
    ? await db.query.users.findMany({
        where: (u, { inArray }) => inArray(u.id, userIds),
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u] as const));

  // Audit log scoped to this session — every member + admin action that
  // referenced this session shows up below the court editor.
  const auditEvents = await loadSessionAuditEvents(env.DB, id);

  return json({
    user,
    session: {
      id: session.id,
      date: session.date,
      weekday: session.weekday,
    },
    auditEvents,
    courts: courts.map((c) => ({
      id: c.id,
      courtCode: c.courtCode,
      startTime: c.startTime,
      endTime: c.endTime,
    })),
    pendingExtras: pendingExtras.map((r) => ({
      id: r.id,
      userName: userById.get(r.userId)?.name ?? "?",
      createdAt: r.createdAt,
    })),
    pendingPassSlots: openPassRequests.map((pr) => {
      const vote = choPassVotes.find((v) => v.id === pr.voteId)!;
      const owner = userById.get(vote.userId);
      const tier = pr.originalVoteStatus === "vang_lai" ? "vang_lai" : "thang";
      const gender = owner?.gender ?? "nam";
      return {
        id: pr.id,
        userName: owner?.name ?? "?",
        gender,
        createdAt: pr.createdAt,
        /** Refund amount = what the original voter paid in. */
        refundAmount: prices[tier][gender],
        /** Owner's QR (where admin sends the refund). null if not uploaded. */
        ownerQrUrl: owner?.qrImageKey
          ? `/qr/${encodeURIComponent(owner.qrImageKey)}`
          : null,
      };
    }),
    adminQrUrl,
  });
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  const admin = await requireAdmin(request, context);
  const env = getEnv(context);
  const db = getDb(env.DB);
  const id = params.id ?? "";
  if (!id) return json({ error: "Thiếu sessionId" }, { status: 400 });

  const session = await db.query.playSessions.findFirst({
    where: eq(schema.playSessions.id, id),
  });
  if (!session) return json({ error: "Không tìm thấy buổi" }, { status: 404 });

  // Per spec: admin can ALWAYS edit courts on this page — regardless of the
  // month's status. Court edits only affect the live home card on trang-chu;
  // the /lich matrix is a frozen snapshot for "Đã đặt sân" months so it stays
  // stable. No status guard here.

  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "add-court") {
    const r = await addCourtToSession(env.DB, {
      sessionId: id,
      courtCode: String(form.get("courtCode") || ""),
      startTime: String(form.get("startTime") || ""),
      endTime: String(form.get("endTime") || ""),
      adminUserId: admin.id,
    });
    if ("error" in r) return json({ error: r.error }, { status: r.status ?? 400 });
    return redirect(`/admin/sessions/${id}`);
  }

  if (intent === "remove-court") {
    const courtId = String(form.get("courtId"));
    // Guard: prevent cross-session delete via crafted form.
    const row = await db.query.courtAllocations.findFirst({
      where: eq(schema.courtAllocations.id, courtId),
    });
    if (!row || row.playSessionId !== id) {
      return json({ error: "Không tìm thấy sân" }, { status: 404 });
    }
    const r = await removeCourtFromSession(env.DB, { courtId, adminUserId: admin.id });
    if ("error" in r) return json({ error: r.error }, { status: r.status ?? 400 });
    return redirect(`/admin/sessions/${id}`);
  }

  if (intent === "approve-vang-lai") {
    const requestId = String(form.get("requestId"));
    const ok = await approveSingleRequest(env.DB, requestId, admin.id);
    if (!ok) return json({ error: "Không tìm thấy yêu cầu" }, { status: 404 });
    await emailVangLaiApproved(env, db, requestId);
    return redirect(`/admin/sessions/${id}`);
  }

  if (intent === "approve-all-vang-lai") {
    const pending = await db.query.extraSlotRequests.findMany({
      where: and(
        eq(schema.extraSlotRequests.playSessionId, id),
        isNull(schema.extraSlotRequests.approvedAt),
        isNull(schema.extraSlotRequests.cancelledAt),
        isNull(schema.extraSlotRequests.rejectedAt),
      ),
      orderBy: [asc(schema.extraSlotRequests.createdAt)],
    });
    const requestIds = pending.map((r) => r.id);
    await approvePendingForSession(env.DB, id, admin.id);
    for (const rid of requestIds) await emailVangLaiApproved(env, db, rid);
    return redirect(`/admin/sessions/${id}`);
  }

  if (intent === "reject-vang-lai") {
    const requestId = String(form.get("requestId"));
    const res = await rejectSingleExtraSlotRequest(env.DB, requestId, admin.id);
    if (!res.ok) return json({ error: "Không tìm thấy yêu cầu" }, { status: 404 });
    await emailVangLaiRejected(env, db, res.userId, res.playSessionId);
    return redirect(`/admin/sessions/${id}`);
  }

  if (intent === "refund-pass") {
    const passRequestId = String(form.get("passRequestId"));
    const res = await approvePassRefund(env.DB, passRequestId, admin.id);
    if (!res.ok) return json({ error: "Không hoàn được" }, { status: 400 });
    await emailPassRefunded(env, db, res.userId, res.playSessionId);
    return redirect(`/admin/sessions/${id}`);
  }

  if (intent === "refund-all-pass") {
    const refunded = await refundPendingPassRequests(env.DB, id, admin.id);
    if (refunded > 0) {
      // Email each refunded pass-slotter — re-derive list from current hoan_tien votes.
      const hoanTienVotes = await db.query.votes.findMany({
        where: and(
          eq(schema.votes.playSessionId, id),
          eq(schema.votes.status, "hoan_tien"),
        ),
      });
      for (const v of hoanTienVotes) {
        await emailPassRefunded(env, db, v.userId, v.playSessionId);
      }
    }
    return redirect(`/admin/sessions/${id}`);
  }

  if (intent === "reject-pass") {
    const passRequestId = String(form.get("passRequestId"));
    const res = await rejectPassRequest(env.DB, passRequestId, admin.id);
    if (!res.ok) return json({ error: "Không reject được" }, { status: 400 });
    await emailPassRejected(env, db, res.userId, res.playSessionId);
    return redirect(`/admin/sessions/${id}`);
  }

  return json({ error: "intent không hợp lệ" }, { status: 400 });
}

/* ---------------- Email dispatch helpers ---------------- */

async function emailVangLaiApproved(
  env: ReturnType<typeof getEnv>,
  db: ReturnType<typeof getDb>,
  requestId: string,
): Promise<void> {
  try {
    const req = await db.query.extraSlotRequests.findFirst({
      where: eq(schema.extraSlotRequests.id, requestId),
    });
    if (!req) return;
    const [user, session, prices] = await Promise.all([
      db.query.users.findFirst({ where: eq(schema.users.id, req.userId) }),
      db.query.playSessions.findFirst({
        where: eq(schema.playSessions.id, req.playSessionId),
      }),
      getPrices(env.DB),
    ]);
    if (!user || !session) return;
    await sendVangLaiApprovedEmail(
      env,
      { id: user.id, name: user.name, email: user.email },
      { date: session.date, weekday: session.weekday },
      prices.vang_lai[user.gender],
    );
  } catch (e) {
    console.error("[admin sessions] vang-lai-approved email failed", e);
  }
}

async function emailVangLaiRejected(
  env: ReturnType<typeof getEnv>,
  db: ReturnType<typeof getDb>,
  userId: string,
  playSessionId: string,
): Promise<void> {
  try {
    const [user, session] = await Promise.all([
      db.query.users.findFirst({ where: eq(schema.users.id, userId) }),
      db.query.playSessions.findFirst({ where: eq(schema.playSessions.id, playSessionId) }),
    ]);
    if (!user || !session) return;
    await sendVangLaiRejectedEmail(
      env,
      { id: user.id, name: user.name, email: user.email },
      { date: session.date, weekday: session.weekday },
    );
  } catch (e) {
    console.error("[admin sessions] vang-lai-rejected email failed", e);
  }
}

async function emailPassRefunded(
  env: ReturnType<typeof getEnv>,
  db: ReturnType<typeof getDb>,
  userId: string,
  playSessionId: string,
): Promise<void> {
  try {
    const [user, session, prices] = await Promise.all([
      db.query.users.findFirst({ where: eq(schema.users.id, userId) }),
      db.query.playSessions.findFirst({ where: eq(schema.playSessions.id, playSessionId) }),
      getPrices(env.DB),
    ]);
    if (!user || !session) return;
    // Pass-slotter pre-paid thang of their gender; refund matches that.
    await sendPassSlotRefundedEmail(
      env,
      { id: user.id, name: user.name, email: user.email },
      { date: session.date, weekday: session.weekday },
      prices.thang[user.gender],
    );
  } catch (e) {
    console.error("[admin sessions] pass-refunded email failed", e);
  }
}

async function emailPassRejected(
  env: ReturnType<typeof getEnv>,
  db: ReturnType<typeof getDb>,
  userId: string,
  playSessionId: string,
): Promise<void> {
  try {
    const [user, session] = await Promise.all([
      db.query.users.findFirst({ where: eq(schema.users.id, userId) }),
      db.query.playSessions.findFirst({ where: eq(schema.playSessions.id, playSessionId) }),
    ]);
    if (!user || !session) return;
    await sendPassSlotRejectedEmail(
      env,
      { id: user.id, name: user.name, email: user.email },
      { date: session.date, weekday: session.weekday },
    );
  } catch (e) {
    console.error("[admin sessions] pass-rejected email failed", e);
  }
}

export default function AdminSessionDetail() {
  const data = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const submitting = nav.state === "submitting";
  // Per spec: admin can always edit courts here. The page never goes
  // read-only. Court edits only flow to the live home card; the /lich matrix
  // is snapshot-locked for "Đã đặt sân" months.
  const readOnly = false;

  return (
    <AppShell user={data.user as never}>
    <div className="space-y-4">
      <Link
        to="/trang-chu"
        prefetch="intent"
        className="inline-flex items-center gap-1 text-body-sm text-muted hover:text-ink"
      >
        ← Về trang chủ
      </Link>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Sửa sân buổi{" "}
            <WeekdayDate weekday={data.session.weekday} date={data.session.date} />
          </CardTitle>
          {readOnly && (
            <p className="text-caption text-muted">
              Tháng đã kết thúc — chỉ xem.
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <p className="eyebrow text-muted">Sân đã đặt</p>
            {data.courts.length === 0 ? (
              <p className="text-body-sm text-muted">— Chưa có sân nào —</p>
            ) : (
              <ul className="space-y-1.5">
                {data.courts.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between rounded-md border border-hairline bg-surface-card px-3 py-2 text-body-sm"
                  >
                    <span>
                      <span className="font-mono text-label-mono uppercase tracking-wider text-accent-deep">
                        {c.courtCode}
                      </span>{" "}
                      {c.startTime}–{c.endTime}
                    </span>
                    {!readOnly && (
                      <ConfirmForm
                        fields={{ intent: "remove-court", courtId: c.id }}
                        title="Huỷ sân"
                        description={`Huỷ sân ${c.courtCode} (${c.startTime}–${c.endTime}). Người đang chờ pass slot trên buổi này sẽ tự được hoàn tiền.`}
                        confirmLabel="Huỷ sân"
                        variant="ghost"
                        size="sm"
                        disabled={submitting}
                      >
                        Huỷ sân
                      </ConfirmForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {data.pendingExtras.length > 0 && (
            <div className="rounded-md border border-accent/40 bg-accent-tint p-3 text-body-sm">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-caption text-accent-deep">
                  Chờ duyệt vãng lai ({data.pendingExtras.length})
                </p>
                {!readOnly && (
                  <Form method="post">
                    <input type="hidden" name="intent" value="approve-all-vang-lai" />
                    <Button type="submit" size="sm" variant="primary" disabled={submitting}>
                      Duyệt tất cả
                    </Button>
                  </Form>
                )}
              </div>
              <ul className="space-y-1">
                {data.pendingExtras.map((p) => (
                  <li key={p.id} className="flex items-center justify-between">
                    <span>{p.userName}</span>
                    {!readOnly && (
                      <div className="flex gap-1">
                        <Form method="post">
                          <input type="hidden" name="intent" value="approve-vang-lai" />
                          <input type="hidden" name="requestId" value={p.id} />
                          <Button type="submit" size="sm" variant="outline" disabled={submitting}>
                            Duyệt
                          </Button>
                        </Form>
                        <ConfirmForm
                          fields={{ intent: "reject-vang-lai", requestId: p.id }}
                          title="Từ chối vãng lai"
                          description={`Từ chối đăng ký vãng lai của ${p.userName}. Người này sẽ nhận email báo không thành công.`}
                          confirmLabel="Từ chối"
                          variant="ghost"
                          size="sm"
                          disabled={submitting}
                        >
                          Từ chối
                        </ConfirmForm>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-caption text-muted">
                Admin cần thêm sân trước khi duyệt để đảm bảo đủ chỗ.
              </p>
            </div>
          )}

          {data.pendingPassSlots.length > 0 && (
            <div className="rounded-md border border-semantic-warn/40 bg-surface-strong p-3 text-body-sm">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-caption text-semantic-warn">
                  Pass-slot chưa có người nhận ({data.pendingPassSlots.length})
                </p>
                {!readOnly && (
                  <Form method="post">
                    <input type="hidden" name="intent" value="refund-all-pass" />
                    <Button type="submit" size="sm" variant="primary" disabled={submitting}>
                      Hoàn tiền tất cả
                    </Button>
                  </Form>
                )}
              </div>
              <ul className="space-y-1">
                {data.pendingPassSlots.map((p) => (
                  <li key={p.id} className="flex items-center justify-between">
                    <span>{p.userName}</span>
                    {!readOnly && (
                      <div className="flex gap-1">
                        <RefundPassDialog item={p} disabled={submitting} />
                        <ConfirmForm
                          fields={{ intent: "reject-pass", passRequestId: p.id }}
                          title="Từ chối pass slot"
                          description={`Từ chối yêu cầu pass của ${p.userName}. Vote quay về trạng thái cũ — vẫn tính tiền như đã đánh.`}
                          confirmLabel="Từ chối"
                          variant="ghost"
                          size="sm"
                          disabled={submitting}
                        >
                          Từ chối
                        </ConfirmForm>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!readOnly && <AddCourtForm sessionId={data.session.id} submitting={submitting} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Lịch sử buổi này ({data.auditEvents.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.auditEvents.length === 0 ? (
            <p className="text-body-sm text-muted">— Chưa có thao tác nào —</p>
          ) : (
            <ul className="space-y-2">
              {data.auditEvents.map((e) => (
                <li
                  key={e.id}
                  className="flex items-start justify-between gap-3 border-b border-hairline pb-2 last:border-0 last:pb-0"
                >
                  <p className="text-body-sm text-ink">
                    <AuditDescription event={e} />
                  </p>
                  <p className="shrink-0 text-caption text-muted">
                    {formatDateTime(e.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
    </AppShell>
  );
}

function AddCourtForm({ sessionId, submitting }: { sessionId: string; submitting: boolean }) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState<{ code: string; start: string; end: string } | null>(
    null,
  );

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setPending({
      code: String(fd.get("courtCode") || "").toUpperCase(),
      start: normalizeHHMM(String(fd.get("startTime") || "")),
      end: normalizeHHMM(String(fd.get("endTime") || "")),
    });
  }

  function confirmAdd() {
    if (!pending) return;
    const fd = new FormData();
    fd.set("intent", "add-court");
    fd.set("playSessionId", sessionId);
    fd.set("courtCode", pending.code);
    fd.set("startTime", pending.start);
    fd.set("endTime", pending.end);
    submit(fd, { method: "post" });
    setPending(null);
    formRef.current?.reset();
  }

  return (
    <>
      <div className="space-y-2 rounded-md border border-hairline bg-canvas-soft p-3">
        <p className="eyebrow text-muted">Thêm sân mới</p>
        <form ref={formRef} onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
          <div className="w-20">
            <Label className="text-caption">Sân</Label>
            <Input name="courtCode" placeholder="B1" required />
          </div>
          <div className="w-24">
            <Label className="text-caption">Bắt đầu</Label>
            <Input
              name="startTime"
              placeholder="08:00"
              inputMode="numeric"
              required
              onBlur={normalizeTimeBlur}
            />
          </div>
          <div className="w-24">
            <Label className="text-caption">Kết thúc</Label>
            <Input
              name="endTime"
              placeholder="10:00"
              inputMode="numeric"
              required
              onBlur={normalizeTimeBlur}
            />
          </div>
          <Button type="submit" size="sm" disabled={submitting}>
            + Thêm sân
          </Button>
        </form>
      </div>
      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Xác nhận thêm sân</DialogTitle>
            <DialogDescription>
              {pending && (
                <>
                  Thêm sân <strong>{pending.code}</strong> ({pending.start}–{pending.end}). Người
                  đang chờ vãng lai trên buổi này sẽ tự được duyệt.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="primary" onClick={confirmAdd}>
              Thêm sân
            </Button>
            <Button type="button" variant="ghost" onClick={() => setPending(null)}>
              Huỷ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Admin clicks "Hoàn tiền" on an unclaimed pass-slot. Before confirming the
 * action, we surface the original voter's QR + the amount they paid in —
 * admin scans the QR and transfers the refund externally, then confirms.
 */
function RefundPassDialog({
  item,
  disabled,
}: {
  item: {
    id: string;
    userName: string;
    refundAmount: number;
    ownerQrUrl: string | null;
  };
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        Hoàn tiền
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Hoàn tiền pass slot</DialogTitle>
            <DialogDescription>
              Chuyển <strong>{formatVND(item.refundAmount)}</strong> cho{" "}
              <strong>{item.userName}</strong> qua QR bên dưới, sau đó bấm xác nhận.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {item.ownerQrUrl ? (
              <img
                src={item.ownerQrUrl}
                alt={`QR ${item.userName}`}
                width={220}
                height={220}
                loading="lazy"
                className="mx-auto rounded-md border border-hairline bg-white"
              />
            ) : (
              <p className="rounded-md border border-hairline bg-canvas-soft px-3 py-2 text-body-sm text-muted">
                {item.userName} chưa upload QR. Liên hệ trực tiếp để chuyển tiền.
              </p>
            )}
            <p className="text-caption text-muted">
              Sau khi xác nhận: vote chuyển sang hoan_tien (không tính tiền), pass slot ghi nhận đã hoàn.
            </p>
          </div>
          <DialogFooter>
            <Form method="post" onSubmit={() => setOpen(false)}>
              <input type="hidden" name="intent" value="refund-pass" />
              <input type="hidden" name="passRequestId" value={item.id} />
              <Button type="submit" variant="primary" disabled={disabled}>
                ✓ Tôi đã chuyển — xác nhận hoàn tiền
              </Button>
            </Form>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Huỷ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
