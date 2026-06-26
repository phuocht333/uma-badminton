/**
 * Comprehensive test-data seed. Builds a realistic snapshot so a tester can
 * see every feature in action immediately after running it.
 *
 * Roster:  16 test members (test-*@uma.local, password 123456) — 8 nam / 8 nu.
 *
 * Months:  4 months are managed by this seed —
 *   - month curM-2 → DONE, fully billed, payments recorded for ~70% of members
 *   - month curM-1 → LOCKED, billed, some paid / some unpaid (recent close)
 *   - month curM   → LOCKED with active pass / vang_lai / refund flows
 *   - month curM+1 → VOTING, ~60% of members have started voting
 *
 * Per month, every Sat + Sun is a session. Court allocation only happens for
 * sessions that reach the minimum people-per-session count (6 by default);
 * the others stay empty so the "drop empty-court sessions" rule is exercised.
 *
 * Re-runs are idempotent: prior test users + their cascades are wiped and the
 * managed months are reseeded from scratch. The admin user is untouched.
 *
 * Usage:
 *   pnpm db:seed-test:local
 *   pnpm db:seed-test:remote
 */
import { spawnSync } from "node:child_process";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import QRCode from "qrcode";

const target = process.argv.includes("--remote") ? "--remote" : "--local";
const dbName = "uma_badminton_db";

const ITER = 100_000;
const KEY_LEN = 32;
function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(pw, salt, ITER, KEY_LEN, "sha256");
  return `pbkdf2$${ITER}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

const ulidish = () => {
  const ts = Date.now().toString(36).padStart(10, "0").toUpperCase();
  const rand = randomBytes(8).toString("hex").toUpperCase();
  return (ts + rand).slice(0, 26);
};

function sqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

function run(sql: string, opts: { capture?: boolean } = {}): string {
  const args = ["wrangler", "d1", "execute", dbName, target, "--command", sql];
  if (opts.capture) args.push("--json");
  const r = spawnSync("pnpm", args, {
    stdio: opts.capture ? ["ignore", "pipe", "inherit"] : ["ignore", "inherit", "inherit"],
    encoding: "utf-8",
  });
  if (r.status !== 0) throw new Error(`wrangler exec failed: ${sql.slice(0, 80)}...`);
  return r.stdout ?? "";
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function dayOfWeek(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun 6=Sat
}
function previousMonth(y: number, m: number): { year: number; month: number } {
  return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
}
function nextMonth(y: number, m: number): { year: number; month: number } {
  return m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 };
}

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const now = Date.now();
const TEST_PASSWORD = "123456";

/* ---------- 0. Wipe prior test data ---------- */
console.log(`\n▸ Wiping prior test data (target: ${target})...`);
run(`DELETE FROM audit_logs WHERE actor_user_id IN (SELECT id FROM users WHERE email LIKE 'test-%@uma.local')
                              OR subject_user_id IN (SELECT id FROM users WHERE email LIKE 'test-%@uma.local');`);
run(`DELETE FROM users WHERE email LIKE 'test-%@uma.local';`);

/* ---------- 1. Test members (16) ---------- */
const TEST_MEMBERS: Array<{ name: string; gender: "nam" | "nu"; email: string }> = [
  // Original 8 — kept for backwards compatibility with prior testing notes
  { name: "Phát", gender: "nam", email: "test-phat@uma.local" },
  { name: "Hằng", gender: "nu", email: "test-hang@uma.local" },
  { name: "Hoà", gender: "nam", email: "test-hoa@uma.local" },
  { name: "Trí", gender: "nam", email: "test-tri@uma.local" },
  { name: "Thanh", gender: "nam", email: "test-thanh@uma.local" },
  { name: "Dương", gender: "nu", email: "test-duong@uma.local" },
  { name: "Hùng", gender: "nam", email: "test-hung@uma.local" },
  { name: "Nhung", gender: "nu", email: "test-nhung@uma.local" },
  // Additional 8 — broader coverage of gender + interaction patterns
  { name: "Anh", gender: "nu", email: "test-anh@uma.local" },
  { name: "Bình", gender: "nam", email: "test-binh@uma.local" },
  { name: "Châu", gender: "nu", email: "test-chau@uma.local" },
  { name: "Đông", gender: "nam", email: "test-dong@uma.local" },
  { name: "Linh", gender: "nu", email: "test-linh@uma.local" },
  { name: "Minh", gender: "nam", email: "test-minh@uma.local" },
  { name: "Vy", gender: "nu", email: "test-vy@uma.local" },
  { name: "Quân", gender: "nam", email: "test-quan@uma.local" },
];

const passwordHash = hashPassword(TEST_PASSWORD);

console.log(`\n▸ Generating sample QR codes + uploading to R2...`);
const tmpQrDir = join(tmpdir(), `uma-qr-${Date.now()}`);
mkdirSync(tmpQrDir, { recursive: true });

function asciiSlug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toLowerCase();
}

async function generateAndUploadQr(name: string, email: string): Promise<string> {
  const payload = `MOMO|0901234567|${name}|TEST PAYMENT|${email}`;
  const slug = asciiSlug(name);
  const filePath = join(tmpQrDir, `${slug}.png`);
  await QRCode.toFile(filePath, payload, {
    width: 400,
    margin: 2,
    color: { dark: "#0A0A0A", light: "#FFFFFF" },
  });
  const r2Key = `qr/sample-${slug}.png`;
  const args = [
    "wrangler",
    "r2",
    "object",
    "put",
    `uma-badminton-qr/${r2Key}`,
    `--file=${filePath}`,
    "--content-type=image/png",
  ];
  if (target === "--local") args.push("--local");
  const r = spawnSync("pnpm", args, { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) throw new Error(`r2 upload failed for ${r2Key}`);
  return r2Key;
}

console.log(`\n▸ Seeding ${TEST_MEMBERS.length} test members + QR keys...`);
const memberIds: Record<string, string> = {};
const memberByName = new Map<string, (typeof TEST_MEMBERS)[number]>();
for (const m of TEST_MEMBERS) {
  const id = ulidish();
  memberIds[m.name] = id;
  memberByName.set(m.name, m);
  const qrKey = await generateAndUploadQr(m.name, m.email);
  run(
    `INSERT INTO users (id, email, name, gender, role, password_hash, qr_image_key, is_active, created_at, updated_at)
     VALUES ('${id}', '${sqlEscape(m.email)}', '${sqlEscape(m.name)}', '${m.gender}', 'member', '${sqlEscape(passwordHash)}', '${sqlEscape(qrKey)}', 1, ${now}, ${now});`,
  );
}

/* ---------- 2. Admin payment QR ---------- */
console.log(`\n▸ Seeding admin QR (config.admin_qr_image_key)...`);
{
  const adminQrPayload = "MOMO|0987654321|Admin Uma BMT|MONTHLY PAYMENT|admin@uma.local";
  const filePath = join(tmpQrDir, `admin.png`);
  await QRCode.toFile(filePath, adminQrPayload, {
    width: 400,
    margin: 2,
    color: { dark: "#7C3AED", light: "#FFFFFF" },
  });
  const r2Key = `qr/admin-payment.png`;
  const args = [
    "wrangler",
    "r2",
    "object",
    "put",
    `uma-badminton-qr/${r2Key}`,
    `--file=${filePath}`,
    "--content-type=image/png",
  ];
  if (target === "--local") args.push("--local");
  const r = spawnSync("pnpm", args, { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) throw new Error(`admin QR upload failed`);
  run(
    `INSERT INTO config (key, value, updated_at)
     VALUES ('admin_qr_image_key', '${sqlEscape(r2Key)}', ${now})
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`,
  );
}

/* ---------- 3. Helpers: months, sessions, votes, courts ---------- */
function vnYearMonthNow(): { year: number; month: number } {
  const d = new Date(Date.now() + VN_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/** Ensure a month row exists with the given status; return its id. */
function upsertMonth(year: number, month: number, status: "voting" | "locked" | "done"): string {
  const prev = previousMonth(year, month);
  const openAt = Date.UTC(prev.year, prev.month - 1, 5, 9, 0, 0) - VN_OFFSET_MS;
  const closeAt = Date.UTC(prev.year, prev.month - 1, 25, 23, 59, 0) - VN_OFFSET_MS;
  const newId = ulidish();
  run(
    `INSERT INTO months (id, year, month, status, vote_open_at, vote_close_at, created_at)
     VALUES ('${newId}', ${year}, ${month}, '${status}', ${openAt}, ${closeAt}, ${now})
     ON CONFLICT(year, month) DO UPDATE SET status = '${status}', vote_open_at = excluded.vote_open_at, vote_close_at = excluded.vote_close_at;`,
  );
  const raw = run(`SELECT id FROM months WHERE year=${year} AND month=${month};`, {
    capture: true,
  });
  try {
    return JSON.parse(raw)[0]?.results?.[0]?.id ?? newId;
  } catch {
    return newId;
  }
}

/** Wipe + create all Sat/Sun sessions for a month, return them ordered by date. */
function createSessions(
  monthId: string,
  year: number,
  month: number,
): Array<{ id: string; date: string; weekday: "T7" | "CN" }> {
  run(`DELETE FROM play_sessions WHERE month_id = '${monthId}';`);
  const out: Array<{ id: string; date: string; weekday: "T7" | "CN" }> = [];
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let d = 1; d <= days; d++) {
    const dow = dayOfWeek(year, month, d);
    if (dow !== 6 && dow !== 0) continue;
    const sid = ulidish();
    const dateStr = `${year}-${pad(month)}-${pad(d)}`;
    const weekday = dow === 6 ? "T7" : "CN";
    out.push({ id: sid, date: dateStr, weekday });
    run(
      `INSERT INTO play_sessions (id, month_id, date, weekday)
       VALUES ('${sid}', '${monthId}', '${dateStr}', '${weekday}');`,
    );
  }
  return out;
}

type VoteStatus = "thang" | "vang_lai" | "cho_pass" | "da_pass" | "hoan_tien";

function addVote(
  sessionId: string,
  userId: string,
  status: VoteStatus = "thang",
  votedAt: number = now,
): string {
  const vid = ulidish();
  run(
    `INSERT INTO votes (id, play_session_id, user_id, status, voted_at, original_voter_id)
     VALUES ('${vid}', '${sessionId}', '${userId}', '${status}', ${votedAt}, NULL);`,
  );
  return vid;
}

function addCourt(
  sessionId: string,
  code: string,
  start: string,
  end: string,
  order: number,
): void {
  run(
    `INSERT INTO court_allocations (id, play_session_id, court_code, start_time, end_time, display_order)
     VALUES ('${ulidish()}', '${sessionId}', '${code}', '${start}', '${end}', ${order});`,
  );
}

function addPassRequest(
  voteId: string,
  opts: {
    claimerId?: string;
    confirmed?: boolean;
    originalStatus?: "thang" | "vang_lai";
    createdAgoMs?: number;
  } = {},
): string {
  const id = ulidish();
  const createdAt = now - (opts.createdAgoMs ?? 60 * 60 * 1000);
  const claimedAt = opts.claimerId ? createdAt + 5 * 60 * 1000 : null;
  const confirmedAt = opts.confirmed ? createdAt + 6 * 60 * 1000 : null;
  run(
    `INSERT INTO pass_requests (id, vote_id, created_at, claimed_by_user_id, claimed_at, confirmed_at, original_vote_status)
     VALUES ('${id}', '${voteId}', ${createdAt},
       ${opts.claimerId ? `'${opts.claimerId}'` : "NULL"},
       ${claimedAt ?? "NULL"},
       ${confirmedAt ?? "NULL"},
       '${opts.originalStatus ?? "thang"}');`,
  );
  return id;
}

function addExtraSlotRequest(
  userId: string,
  sessionId: string,
  opts: { approvedAt?: number; approverId?: string; cancelledAt?: number } = {},
): string {
  const id = ulidish();
  run(
    `INSERT INTO extra_slot_requests (id, user_id, play_session_id, created_at, approved_at, approved_by_user_id, cancelled_at)
     VALUES ('${id}', '${userId}', '${sessionId}', ${now - 30 * 60 * 1000},
       ${opts.approvedAt ?? "NULL"},
       ${opts.approverId ? `'${opts.approverId}'` : "NULL"},
       ${opts.cancelledAt ?? "NULL"});`,
  );
  return id;
}

function addPayment(userId: string, monthId: string, paidAt: number = now): void {
  run(
    `INSERT INTO member_month_payments (user_id, month_id, paid_at)
     VALUES ('${userId}', '${monthId}', ${paidAt})
     ON CONFLICT(user_id, month_id) DO UPDATE SET paid_at = excluded.paid_at;`,
  );
}

function logAudit(
  kind: string,
  opts: {
    actorId?: string;
    subjectId?: string;
    sessionId?: string;
    voteId?: string;
    createdAt?: number;
  },
): void {
  run(
    `INSERT INTO audit_logs (id, kind, actor_user_id, subject_user_id, play_session_id, vote_id, meta, created_at)
     VALUES ('${ulidish()}', '${kind}',
       ${opts.actorId ? `'${opts.actorId}'` : "NULL"},
       ${opts.subjectId ? `'${opts.subjectId}'` : "NULL"},
       ${opts.sessionId ? `'${opts.sessionId}'` : "NULL"},
       ${opts.voteId ? `'${opts.voteId}'` : "NULL"},
       NULL, ${opts.createdAt ?? now});`,
  );
}

/* ---------- 4. Vote-pattern generator: deterministic but varied ---------- */
const MIN_PEOPLE = 6;
const MAX_PER_HOUR = 6;

/** Cycle through member names so each session gets a slightly different roster. */
function generateAttendees(
  sessionIdx: number,
  size: number,
  excludeNames: string[] = [],
): string[] {
  const all = TEST_MEMBERS.map((m) => m.name).filter((n) => !excludeNames.includes(n));
  const start = (sessionIdx * 3) % all.length;
  const out: string[] = [];
  for (let i = 0; i < size && i < all.length; i++) {
    out.push(all[(start + i) % all.length]);
  }
  return out;
}

/** Court layout from spec; only allocate when count meets MIN_PEOPLE. */
function allocateCourts(
  session: { id: string; weekday: "T7" | "CN" },
  attendeeCount: number,
): void {
  if (attendeeCount < MIN_PEOPLE) return;
  const hours = Math.max(1, Math.floor((attendeeCount * 2) / 3) / 2);
  const layout =
    session.weekday === "CN"
      ? [{ code: "B2" }, { code: "B1" }, { code: "B4" }]
      : [{ code: "C3" }, { code: "C4" }, { code: "B4" }];
  let remaining = hours;
  layout.forEach((p, i) => {
    if (remaining <= 0) return;
    const take = Math.min(remaining, 2);
    const endMins = 600; // 10:00
    const startMins = endMins - take * 60;
    const startStr = `${pad(Math.floor(startMins / 60))}:${pad(startMins % 60)}`;
    addCourt(session.id, p.code, startStr, "10:00", i);
    remaining -= take;
  });
  void MAX_PER_HOUR;
}

/* ---------- 5. Build months ---------- */
const { year: curY, month: curM } = vnYearMonthNow();
const prev1 = previousMonth(curY, curM);
const prev2 = previousMonth(prev1.year, prev1.month);
const next1 = nextMonth(curY, curM);

console.log(
  `\n▸ Managed months: ${prev2.month}/${prev2.year} done, ${prev1.month}/${prev1.year} locked, ${curM}/${curY} locked+active, ${next1.month}/${next1.year} voting`,
);

/* === Month prev-prev: DONE, fully billed, payments for ~70% of members === */
{
  const monthId = upsertMonth(prev2.year, prev2.month, "done");
  const sessions = createSessions(monthId, prev2.year, prev2.month);
  console.log(`  • ${prev2.month}/${prev2.year}: ${sessions.length} sessions (done)`);
  sessions.forEach((s, idx) => {
    // Big-attendance pattern (10-13 people) — most sessions full
    const size = 10 + (idx % 4);
    const attendees = generateAttendees(idx, size);
    attendees.forEach((name) => addVote(s.id, memberIds[name], "thang"));
    allocateCourts(s, attendees.length);
  });
  // Payment records — most members paid
  TEST_MEMBERS.slice(0, 11).forEach((m) =>
    addPayment(memberIds[m.name], monthId, now - 10 * 24 * 60 * 60 * 1000),
  );
}

/* === Month prev-1: LOCKED, fresh close, half paid === */
{
  const monthId = upsertMonth(prev1.year, prev1.month, "locked");
  const sessions = createSessions(monthId, prev1.year, prev1.month);
  console.log(`  • ${prev1.month}/${prev1.year}: ${sessions.length} sessions (locked)`);
  sessions.forEach((s, idx) => {
    // Mix: 2 sessions under MIN_PEOPLE so they stay courtless + dropped from views
    const size = idx % 4 === 3 ? 4 : 8 + (idx % 5);
    const attendees = generateAttendees(idx + 7, size);
    attendees.forEach((name) => addVote(s.id, memberIds[name], "thang"));
    allocateCourts(s, attendees.length);
  });
  // 50% paid
  TEST_MEMBERS.slice(0, 8).forEach((m) =>
    addPayment(memberIds[m.name], monthId, now - 2 * 24 * 60 * 60 * 1000),
  );
}

/* === Month current: LOCKED with diverse active flows === */
console.log(`\n▸ Current month ${curM}/${curY}: locked with active passes / vang_lai / refund.`);
const curMonthId = upsertMonth(curY, curM, "locked");
const curSessions = createSessions(curMonthId, curY, curM);
console.log(`  • ${curSessions.length} sessions seeded for current month`);

const todayISO = (() => {
  const d = new Date(Date.now() + VN_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
})();

interface SessionStored {
  id: string;
  date: string;
  weekday: "T7" | "CN";
  attendees: string[];
  voteIds: Map<string, string>;
}
const stored: SessionStored[] = curSessions.map((s, idx) => {
  // Vary sizes deliberately. Index pattern produces some empty (< MIN), some full.
  let size: number;
  if (idx % 5 === 2) size = 4; // intentionally below min → no courts
  else if (idx % 5 === 4) size = 14; // big
  else size = 8 + (idx % 4);
  const attendees = generateAttendees(idx + 11, size);
  const voteIds = new Map<string, string>();
  attendees.forEach((name) => {
    voteIds.set(name, addVote(s.id, memberIds[name], "thang"));
  });
  allocateCourts(s, attendees.length);
  return { ...s, attendees, voteIds };
});

const futureSessions = stored.filter((s) => s.date >= todayISO);
const pastSessions = stored.filter((s) => s.date < todayISO);

console.log(
  `  • future: ${futureSessions.length}, past: ${pastSessions.length} (refund examples target past)`,
);

/* --- 5a. Open pass requests (multiple, FIFO + gender mix) on future sessions --- */
if (futureSessions.length >= 1) {
  const target1 = futureSessions[0];
  // Two nam waiting to pass + one nu waiting to pass (FIFO + gender display)
  const passers = ["Trí", "Hùng", "Nhung"].filter((n) => target1.attendees.includes(n));
  passers.forEach((name, i) => {
    const voteId = target1.voteIds.get(name);
    if (!voteId) return;
    run(`UPDATE votes SET status='cho_pass' WHERE id='${voteId}';`);
    addPassRequest(voteId, {
      originalStatus: "thang",
      createdAgoMs: (i + 1) * 30 * 60 * 1000,
    });
    logAudit("pass_requested", {
      actorId: memberIds[name],
      sessionId: target1.id,
      voteId,
      createdAt: now - (i + 1) * 30 * 60 * 1000,
    });
  });
}

/* --- 5b. Pass + claim + confirm (full settle) on a future session --- */
if (futureSessions.length >= 2) {
  const target = futureSessions[1];
  const passer = ["Hằng", "Dương", "Linh", "Anh"].find((n) => target.attendees.includes(n));
  const claimerCandidate = TEST_MEMBERS.map((m) => m.name).find(
    (n) => !target.attendees.includes(n),
  );
  if (passer && claimerCandidate) {
    const voteId = target.voteIds.get(passer);
    if (voteId) {
      run(`UPDATE votes SET status='da_pass' WHERE id='${voteId}';`);
      addPassRequest(voteId, {
        claimerId: memberIds[claimerCandidate],
        confirmed: true,
        originalStatus: "thang",
        createdAgoMs: 4 * 60 * 60 * 1000,
      });
      logAudit("pass_confirmed", {
        actorId: memberIds[claimerCandidate],
        subjectId: memberIds[passer],
        sessionId: target.id,
        voteId,
        createdAt: now - 3 * 60 * 60 * 1000,
      });
    }
  }
}

/* --- 5c. Vang_lai voter passes their slot (new flow) on a future session --- */
if (futureSessions.length >= 3) {
  const target = futureSessions[2];
  // Pick a member NOT in attendees, register as vang_lai instant, then pass it
  const vlName = TEST_MEMBERS.map((m) => m.name).find((n) => !target.attendees.includes(n));
  if (vlName) {
    const vlVoteId = addVote(target.id, memberIds[vlName], "vang_lai");
    // Convert to cho_pass with original=vang_lai stored
    run(`UPDATE votes SET status='cho_pass' WHERE id='${vlVoteId}';`);
    addPassRequest(vlVoteId, {
      originalStatus: "vang_lai",
      createdAgoMs: 20 * 60 * 1000,
    });
    logAudit("vang_lai_approved", {
      actorId: memberIds[vlName],
      subjectId: memberIds[vlName],
      sessionId: target.id,
      createdAt: now - 60 * 60 * 1000,
    });
    logAudit("pass_requested", {
      actorId: memberIds[vlName],
      sessionId: target.id,
      voteId: vlVoteId,
      createdAt: now - 20 * 60 * 1000,
    });
  }
}

/* --- 5d. Instant vang_lai admission (under capacity) on a future session --- */
if (futureSessions.length >= 4) {
  const target = futureSessions[3];
  const vlName = TEST_MEMBERS.map((m) => m.name).find((n) => !target.attendees.includes(n));
  if (vlName) {
    const vid = addVote(target.id, memberIds[vlName], "vang_lai");
    logAudit("vang_lai_approved", {
      actorId: memberIds[vlName],
      subjectId: memberIds[vlName],
      sessionId: target.id,
      voteId: vid,
      createdAt: now - 45 * 60 * 1000,
    });
  }
}

/* --- 5e. Pending vang_lai request (waiting for admin) --- prefers a session
   not used by 5a-5d so the example is independent, but falls back to any
   future session if the month only has a few weekend dates left. */
{
  const usedIdxs = new Set([0, 1, 2, 3]);
  const targetIdx = futureSessions.findIndex((_, i) => !usedIdxs.has(i));
  const target = targetIdx >= 0 ? futureSessions[targetIdx] : futureSessions[0];
  if (target) {
    const vlName = TEST_MEMBERS.map((m) => m.name).find(
      (n) => !target.attendees.includes(n),
    );
    if (vlName) {
      addExtraSlotRequest(memberIds[vlName], target.id);
      logAudit("vang_lai_requested", {
        actorId: memberIds[vlName],
        sessionId: target.id,
        createdAt: now - 15 * 60 * 1000,
      });
    }
  }
}

/* --- 5f. Refund example (hoan_tien) on a past session (court was cancelled) --- */
if (pastSessions.length >= 1) {
  const target = pastSessions[pastSessions.length - 1];
  const refundName = target.attendees[target.attendees.length - 1];
  if (refundName) {
    const vid = target.voteIds.get(refundName);
    if (vid) {
      run(`UPDATE votes SET status='hoan_tien' WHERE id='${vid}';`);
      logAudit("refund_issued", {
        actorId: memberIds[refundName],
        subjectId: memberIds[refundName],
        sessionId: target.id,
        voteId: vid,
        createdAt: now - 24 * 60 * 60 * 1000,
      });
    }
  }
}

/* --- 5g. Current-month payments: ~30% have already paid --- */
TEST_MEMBERS.slice(0, 5).forEach((m) =>
  addPayment(memberIds[m.name], curMonthId, now - 6 * 60 * 60 * 1000),
);

/* === Month next: VOTING, ~60% have voted partially === */
{
  const monthId = upsertMonth(next1.year, next1.month, "voting");
  const sessions = createSessions(monthId, next1.year, next1.month);
  console.log(`\n▸ Next month ${next1.month}/${next1.year}: ${sessions.length} sessions (voting)`);
  // Each member votes on 0..(N-1) sessions, biased by index — varied participation
  TEST_MEMBERS.forEach((m, mi) => {
    const votedCount = mi % 5 === 0 ? 0 : Math.min(sessions.length, 2 + (mi % 4));
    for (let i = 0; i < votedCount; i++) {
      const s = sessions[i];
      addVote(s.id, memberIds[m.name], "thang");
    }
  });
}

console.log("\n✅ Diverse test data seeded.");
console.log(`   16 members  — login: test-{phat|hang|hoa|...}@uma.local · pw: ${TEST_PASSWORD}`);
console.log(
  `   4 months    — ${prev2.month}/${prev2.year} done · ${prev1.month}/${prev1.year} locked · ${curM}/${curY} locked+active · ${next1.month}/${next1.year} voting`,
);
console.log(`   Current month showcases:`);
console.log(
  `     · 3 open passes on the same session (2 nam FIFO + 1 nu) — for testing claim/disable`,
);
console.log(`     · 1 full pass+claim+confirm settle (da_pass)`);
console.log(`     · 1 vang_lai voter who is passing their slot (originalVoteStatus=vang_lai)`);
console.log(`     · 1 instant vang_lai admission · 1 pending admin-approval vang_lai`);
console.log(`     · 1 hoan_tien refund on a past session`);
console.log(`   Wipe with: pnpm db:clean-test:${target === "--remote" ? "remote" : "local"}\n`);
