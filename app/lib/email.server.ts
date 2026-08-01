/**
 * Email service — sends via SendGrid (free tier, single sender verification).
 *
 * Plumbing lives in sendgrid.server.ts; this file builds Vietnamese templates
 * and hands them to the sender. Falls back to `console.log` when SendGrid
 * isn't configured (local dev without secret).
 */

import { getDb, schema } from "~/db/client";
import { randomToken } from "./crypto.server";
import { formatVND, formatDateVN, formatDateString } from "./format";
import { formatMonthYear, type WeekdayCode } from "./dates";
import {
  isSendGridConfigured,
  sendViaSendGrid,
  type SendGridEnv,
} from "./sendgrid.server";

// Re-export client-safe formatters for convenience
export { formatVND, formatDateVN, formatDateString } from "./format";

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  /** Optional plain-text fallback. Generated from html if omitted. */
  text?: string;
}

interface EmailEnv extends SendGridEnv {
  EMAIL_FROM_ADDRESS: string;
  EMAIL_FROM_NAME: string;
  APP_BASE_URL: string;
  DB: D1Database;
}

export async function sendEmail(env: EmailEnv, args: SendArgs): Promise<void> {
  if (!isSendGridConfigured(env)) {
    console.log(`[email DRY-RUN — SendGrid not configured] to=${args.to} subject=${args.subject}`);
    return;
  }
  try {
    await sendViaSendGrid(env, {
      fromName: env.EMAIL_FROM_NAME,
      fromAddress: env.EMAIL_FROM_ADDRESS,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text ?? stripHtml(args.html),
    });
  } catch (e) {
    console.error(`[email] send failed to=${args.to} reason=`, e);
    throw new Error(`Email send failed: ${(e as Error).message ?? "unknown"}`);
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------- Token helpers ---------- */

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export async function createPasswordResetToken(env: EmailEnv, userId: string): Promise<string> {
  const db = getDb(env.DB);
  const token = randomToken(32);
  await db.insert(schema.passwordResetTokens).values({
    token,
    userId,
    expiresAt: Date.now() + SEVEN_DAYS_MS,
  });
  return token;
}

/* ---------- Templates (Vietnamese) ---------- */

const baseStyle = `font-family:-apple-system,Inter,Segoe UI,Arial,sans-serif;line-height:1.6;color:#0A0A0A;max-width:560px;margin:0 auto;padding:24px;`;

function wrap(title: string, body: string): string {
  return `<!doctype html><html lang="vi"><body style="${baseStyle}">
    <h1 style="font-size:20px;margin:0 0 16px">${escape(title)}</h1>
    ${body}
    <hr style="border:none;border-top:1px solid #E5E5E5;margin:24px 0">
    <p style="font-size:12px;color:#737373">UMABadminton — email tự động, vui lòng không trả lời.</p>
  </body></html>`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface MemberInfo {
  id: string;
  name: string;
  email: string;
}

export async function sendWelcomeWithSetPassword(
  env: EmailEnv,
  member: MemberInfo,
): Promise<void> {
  const token = await createPasswordResetToken(env, member.id);
  const url = `${env.APP_BASE_URL}/set-password?token=${encodeURIComponent(token)}`;
  const html = wrap(
    "Chào mừng bạn đến với UMABadminton",
    `<p>Xin chào ${escape(member.name)},</p>
     <p>Tài khoản của bạn đã được tạo. Đặt mật khẩu trong vòng <strong>7 ngày</strong>:</p>
     <p style="margin:24px 0">
       <a href="${url}" style="display:inline-block;background:#7C3AED;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px">Đặt mật khẩu</a>
     </p>
     <p style="font-size:13px;color:#737373">Hoặc dán link sau vào trình duyệt:<br>${url}</p>`,
  );
  await sendEmail(env, { to: member.email, subject: "Đặt mật khẩu tài khoản UMABadminton", html });
}

/**
 * Sent when an Admin creates the account *and* sets the initial password
 * themselves. Deliberately does NOT contain the password — the Admin hands it
 * over out-of-band (Zalo). No set-password link either: one already exists via
 * "Quên mật khẩu" and mailing a live reset link would undercut the password
 * the Admin just set.
 */
export async function sendWelcomeWithAdminPassword(
  env: EmailEnv,
  member: MemberInfo,
): Promise<void> {
  const url = `${env.APP_BASE_URL}/login`;
  const html = wrap(
    "Chào mừng bạn đến với UMABadminton",
    `<p>Xin chào ${escape(member.name)},</p>
     <p>Tài khoản của bạn đã được tạo với email <strong>${escape(member.email)}</strong>. Admin sẽ gửi mật khẩu cho bạn riêng.</p>
     <p style="margin:24px 0">
       <a href="${url}" style="display:inline-block;background:#7C3AED;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px">Đăng nhập</a>
     </p>
     <p style="font-size:13px;color:#737373">Sau khi đăng nhập, bạn nên đổi mật khẩu trong trang Cá nhân.</p>`,
  );
  await sendEmail(env, { to: member.email, subject: "Tài khoản UMABadminton đã sẵn sàng", html });
}

export async function sendPasswordResetEmail(env: EmailEnv, member: MemberInfo): Promise<void> {
  const token = await createPasswordResetToken(env, member.id);
  const url = `${env.APP_BASE_URL}/set-password?token=${encodeURIComponent(token)}`;
  const html = wrap(
    "Đặt lại mật khẩu UMABadminton",
    `<p>Xin chào ${escape(member.name)},</p>
     <p>Bạn đã yêu cầu đặt lại mật khẩu. Link có hiệu lực trong <strong>7 ngày</strong>:</p>
     <p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#7C3AED;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px">Đặt lại mật khẩu</a></p>
     <p style="font-size:13px;color:#737373">Nếu không phải bạn, hãy bỏ qua email này.</p>`,
  );
  await sendEmail(env, { to: member.email, subject: "Đặt lại mật khẩu UMABadminton", html });
}

export async function sendVoteOpenEmail(
  env: EmailEnv,
  member: MemberInfo,
  yearMonth: { year: number; month: number; closeAt: Date },
): Promise<void> {
  const url = `${env.APP_BASE_URL}/vote`;
  const closeStr = formatDateVN(yearMonth.closeAt);
  const html = wrap(
    `Mở vote tháng ${formatMonthYear(yearMonth.year, yearMonth.month)}`,
    `<p>Xin chào ${escape(member.name)},</p>
     <p>Đã mở form vote cho tháng <strong>${formatMonthYear(yearMonth.year, yearMonth.month)}</strong>.</p>
     <p>Vote các buổi T7/CN bạn đi đánh <strong>trước ${closeStr}</strong>.</p>
     <p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#7C3AED;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px">Vào vote ngay</a></p>`,
  );
  await sendEmail(env, {
    to: member.email,
    subject: `[Uma] Mở vote tháng ${formatMonthYear(yearMonth.year, yearMonth.month)}`,
    html,
  });
}

export interface VoteCloseSummary {
  year: number;
  month: number;
  totalSlots: number;
  totalFee: number;
  adminQrUrl?: string;
  sessions: Array<{ date: string; weekday: WeekdayCode }>;
}

/* ---------- Auto-match + admin queue templates ---------- */

interface SessionRef {
  date: string;
  weekday: WeekdayCode;
}

function sessionLine(s: SessionRef): string {
  return `${s.weekday} ngày ${formatDateString(s.date)}`;
}

export interface AutoMatchEmailPayment {
  toPassSlotter: number;
  toQuyExtra: number;
  fromQuyShortage: number;
  payerTotal: number;
  payeeTotal: number;
}

/**
 * Vãng lai user → "you just got matched, please transfer X to pass-slotter +
 * optional Y to quỹ". Cross-gender shortage cases include a heads-up that the
 * pass-slotter will follow up with admin to claim the quỹ bù.
 */
export async function sendAutoMatchVangLaiEmail(
  env: EmailEnv,
  vangLai: MemberInfo,
  passSlotter: { name: string },
  session: SessionRef,
  payment: AutoMatchEmailPayment,
): Promise<void> {
  const url = `${env.APP_BASE_URL}/trang-chu`;
  const lines: string[] = [
    `<p>Xin chào ${escape(vangLai.name)},</p>`,
    `<p>Bạn đã match với <strong>${escape(passSlotter.name)}</strong> cho buổi <strong>${sessionLine(session)}</strong>.</p>`,
    `<p>Bạn cần chuyển:</p><ul>`,
    `<li><strong>${formatVND(payment.toPassSlotter)}</strong> cho ${escape(passSlotter.name)}</li>`,
  ];
  if (payment.toQuyExtra > 0) {
    lines.push(`<li><strong>${formatVND(payment.toQuyExtra)}</strong> vào quỹ chung (chênh lệch khác giới)</li>`);
  }
  lines.push(`</ul><p>Tổng cộng: <strong>${formatVND(payment.payerTotal)}</strong>.</p>`);
  if (payment.fromQuyShortage > 0) {
    lines.push(`<p style="color:#737373">Quỹ sẽ bù thêm ${formatVND(payment.fromQuyShortage)} cho ${escape(passSlotter.name)} — bạn không phải lo phần này.</p>`);
  }
  lines.push(`<p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#7C3AED;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px">Xem QR / thông tin chuyển khoản</a></p>`);
  const html = wrap("Đã match slot — vui lòng chuyển khoản", lines.join(""));
  await sendEmail(env, {
    to: vangLai.email,
    subject: `[Uma] Đã match slot ${sessionLine(session)}`,
    html,
  });
}

/**
 * Pass-slotter → "your slot was picked up, you'll receive X". Cross-gender
 * shortage cases include the "ping admin via Zalo" reminder so they know to
 * claim the quỹ bù.
 */
export async function sendAutoMatchPassSlotterEmail(
  env: EmailEnv,
  passSlotter: MemberInfo,
  vangLai: { name: string },
  session: SessionRef,
  payment: AutoMatchEmailPayment,
): Promise<void> {
  const lines: string[] = [
    `<p>Xin chào ${escape(passSlotter.name)},</p>`,
    `<p><strong>${escape(vangLai.name)}</strong> đã nhận slot bạn pass cho buổi <strong>${sessionLine(session)}</strong>.</p>`,
    `<p>Bạn sẽ nhận:</p><ul>`,
    `<li><strong>${formatVND(payment.toPassSlotter)}</strong> từ ${escape(vangLai.name)}</li>`,
  ];
  if (payment.fromQuyShortage > 0) {
    lines.push(`<li><strong>${formatVND(payment.fromQuyShortage)}</strong> từ quỹ chung (chênh lệch khác giới)</li>`);
    lines.push(`</ul><p>Tổng nhận: <strong>${formatVND(payment.payeeTotal)}</strong>.</p>`);
    lines.push(`<p style="color:#737373">Nhắn Admin trên Zalo group để nhận ${formatVND(payment.fromQuyShortage)} từ quỹ.</p>`);
  } else {
    lines.push(`</ul><p>Tổng nhận: <strong>${formatVND(payment.toPassSlotter)}</strong>.</p>`);
  }
  if (payment.toQuyExtra > 0) {
    lines.push(`<p style="color:#737373">${escape(vangLai.name)} sẽ trả thêm ${formatVND(payment.toQuyExtra)} vào quỹ — bạn không nhận phần này.</p>`);
  }
  const html = wrap("Slot pass của bạn đã có người nhận", lines.join(""));
  await sendEmail(env, {
    to: passSlotter.email,
    subject: `[Uma] Đã match pass slot ${sessionLine(session)}`,
    html,
  });
}

/** Admin-approved vãng lai (after cutoff queue) → "you're in, here's QR". */
export async function sendVangLaiApprovedEmail(
  env: EmailEnv,
  member: MemberInfo,
  session: SessionRef,
  amount: number,
): Promise<void> {
  const url = `${env.APP_BASE_URL}/trang-chu`;
  const html = wrap(
    "Admin đã duyệt đăng ký vãng lai",
    `<p>Xin chào ${escape(member.name)},</p>
     <p>Admin đã duyệt đăng ký vãng lai của bạn cho buổi <strong>${sessionLine(session)}</strong>.</p>
     <p>Bạn cần chuyển <strong>${formatVND(amount)}</strong> cho Admin theo QR.</p>
     <p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#7C3AED;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px">Xem QR / thông tin chuyển khoản</a></p>`,
  );
  await sendEmail(env, {
    to: member.email,
    subject: `[Uma] Đã duyệt vãng lai ${sessionLine(session)}`,
    html,
  });
}

/** Admin-rejected vãng lai → "sorry, no room". */
export async function sendVangLaiRejectedEmail(
  env: EmailEnv,
  member: MemberInfo,
  session: SessionRef,
): Promise<void> {
  const html = wrap(
    "Đăng ký vãng lai không thành công",
    `<p>Xin chào ${escape(member.name)},</p>
     <p>Rất tiếc, Admin không thể bố trí thêm sân cho buổi <strong>${sessionLine(session)}</strong> — đăng ký vãng lai của bạn không được duyệt.</p>
     <p>Bạn không phải chuyển tiền cho buổi này. Hẹn lần sau!</p>`,
  );
  await sendEmail(env, {
    to: member.email,
    subject: `[Uma] Vãng lai không thành công — ${sessionLine(session)}`,
    html,
  });
}

/** Admin-refunded pass-slot → "your pass got refunded". */
export async function sendPassSlotRefundedEmail(
  env: EmailEnv,
  member: MemberInfo,
  session: SessionRef,
  refundAmount: number,
): Promise<void> {
  const html = wrap(
    "Hoàn tiền pass slot",
    `<p>Xin chào ${escape(member.name)},</p>
     <p>Pass slot của bạn cho buổi <strong>${sessionLine(session)}</strong> không tìm được người nhận. Admin đã duyệt hoàn tiền <strong>${formatVND(refundAmount)}</strong>.</p>
     <p style="color:#737373">Tiền hoàn sẽ được Admin chuyển khoản trực tiếp — vui lòng kiểm tra Zalo group nếu chưa nhận trong 1-2 ngày.</p>`,
  );
  await sendEmail(env, {
    to: member.email,
    subject: `[Uma] Hoàn tiền pass slot ${sessionLine(session)}`,
    html,
  });
}

/** Admin-rejected pass-slot → "no refund, you still pay". */
export async function sendPassSlotRejectedEmail(
  env: EmailEnv,
  member: MemberInfo,
  session: SessionRef,
): Promise<void> {
  const html = wrap(
    "Pass slot không thành công",
    `<p>Xin chào ${escape(member.name)},</p>
     <p>Pass slot của bạn cho buổi <strong>${sessionLine(session)}</strong> không tìm được người nhận, và Admin không thể bớt sân.</p>
     <p>Bạn vẫn được tính tiền buổi này như bình thường.</p>
     <p style="color:#737373">Nếu có thắc mắc, vui lòng nhắn Admin trên Zalo group.</p>`,
  );
  await sendEmail(env, {
    to: member.email,
    subject: `[Uma] Pass slot không thành công — ${sessionLine(session)}`,
    html,
  });
}

export interface CutoffDigestSession {
  date: string;
  weekday: WeekdayCode;
  pendingVangLai: number;
  pendingPassSlot: number;
}

/** Admin digest at cutoff → "session X has N pending in queue". */
export async function sendAdminCutoffDigestEmail(
  env: EmailEnv,
  admin: MemberInfo,
  sessions: CutoffDigestSession[],
): Promise<void> {
  const url = `${env.APP_BASE_URL}/admin/sessions`;
  const rows = sessions
    .map(
      (s) =>
        `<li>${sessionLine({ date: s.date, weekday: s.weekday })} — ${s.pendingVangLai} vãng lai + ${s.pendingPassSlot} pass-slot cần duyệt</li>`,
    )
    .join("");
  const html = wrap(
    `${sessions.length} buổi đang chờ duyệt`,
    `<p>Xin chào ${escape(admin.name)},</p>
     <p>Các buổi sau vừa qua cutoff (trước buổi 24h) và còn pending trong hàng đợi:</p>
     <ul>${rows}</ul>
     <p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#7C3AED;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px">Vào duyệt</a></p>`,
  );
  await sendEmail(env, {
    to: admin.email,
    subject: `[Uma] ${sessions.length} buổi chờ duyệt (cutoff)`,
    html,
  });
}

export async function sendVoteClosedSummaryEmail(
  env: EmailEnv,
  member: MemberInfo,
  s: VoteCloseSummary,
): Promise<void> {
  const url = `${env.APP_BASE_URL}/lich`;
  const list = s.sessions
    .map((x) => `<li>${x.weekday} ${formatDateString(x.date)}</li>`)
    .join("");
  const qrBlock = s.adminQrUrl
    ? `<p>QR chuyển tiền:</p><p><img src="${s.adminQrUrl}" alt="QR" style="max-width:220px"></p>`
    : `<p style="color:#737373">Admin chưa upload QR — sẽ thông báo riêng.</p>`;
  const html = wrap(
    `Kết quả vote tháng ${formatMonthYear(s.year, s.month)}`,
    `<p>Xin chào ${escape(member.name)},</p>
     <p>Vote tháng <strong>${formatMonthYear(s.year, s.month)}</strong> đã đóng. Tổng kết của bạn:</p>
     <ul>
       <li>Tổng số buổi: <strong>${s.totalSlots}</strong></li>
       <li>Tổng tiền: <strong>${formatVND(s.totalFee)}</strong></li>
     </ul>
     ${s.sessions.length ? `<p>Các buổi bạn tham gia:</p><ul>${list}</ul>` : ""}
     ${qrBlock}
     <p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#7C3AED;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px">Xem lịch chi tiết</a></p>`,
  );
  await sendEmail(env, {
    to: member.email,
    subject: `[Uma] Kết quả vote tháng ${formatMonthYear(s.year, s.month)}`,
    html,
  });
}
