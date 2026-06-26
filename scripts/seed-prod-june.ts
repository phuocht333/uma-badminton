/**
 * Production seed for June 2026: wipes ALL operational data (preserves
 * `config` rows and `admin_qr_image_key`) and reseeds with:
 *
 *   • 21 members (8 with real email/phone per image #3 — admins Quyến + Hương —
 *     plus 13 placeholder voters needed to populate the June matrix per image #2)
 *   • Month 6/2026 at status `done` with all 4 Sundays (7, 14, 21, 28) and
 *     their court allocations exactly as drawn in the spreadsheet header
 *   • 61 `thang` votes matching the checkbox grid (totals: 18, 16, 15, 12)
 *   • `member_month_payments` for all 18 attendees (everyone except Minh Sang
 *     who has 0 votes)
 *   • `months.lockedSnapshot` constructed to mirror `buildMonthMatrixData`
 *     output so /lich renders the frozen matrix without re-running the builder
 *   • Month 7/2026 at status `voting` (mirrors what `freezeMonthAsBooked`
 *     auto-creates so trang-chu has a next-month vote target)
 *
 * Common password: 123456.
 *
 * Usage:
 *   pnpm tsx scripts/seed-prod-june.ts --local
 *   pnpm tsx scripts/seed-prod-june.ts --remote
 */
import { spawnSync } from "node:child_process";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const target = process.argv.includes("--remote") ? "--remote" : "--local";
const dbName = "uma_badminton_db";

const tmpDir = mkdtempSync(join(tmpdir(), "uma-seed-"));

const ITER = 100_000;
const KEY_LEN = 32;
function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(pw, salt, ITER, KEY_LEN, "sha256");
  return `pbkdf2$${ITER}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function ulidish(): string {
  const ts = Date.now().toString(36).padStart(10, "0").toUpperCase();
  const rand = randomBytes(8).toString("hex").toUpperCase();
  return (ts + rand).slice(0, 26);
}

function sqlStr(s: string | null | undefined): string {
  if (s === null || s === undefined) return "NULL";
  return `'${s.replace(/'/g, "''")}'`;
}

function runFile(file: string): void {
  const r = spawnSync(
    "pnpm",
    ["wrangler", "d1", "execute", dbName, target, "--file", file],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  if (r.status !== 0) throw new Error(`wrangler exec failed for ${file}`);
}

function writeAndRun(label: string, sql: string): void {
  const file = join(tmpDir, `${label}.sql`);
  writeFileSync(file, sql);
  console.log(`\n▸ ${label} (${target})`);
  runFile(file);
}

const TEST_PASSWORD = "123456";
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const now = Date.now();

/* ============================================================ */
/* 1. WIPE                                                      */
/* ============================================================ */
const wipeSql = `
-- FK-safe delete order. Leaves config rows + admin_qr_image_key intact.
DELETE FROM audit_logs;
DELETE FROM vang_lai_payments;
DELETE FROM refund_payments;
DELETE FROM member_month_payments;
DELETE FROM pass_requests;
DELETE FROM extra_slot_requests;
DELETE FROM votes;
DELETE FROM court_allocations;
DELETE FROM play_sessions;
DELETE FROM months;
DELETE FROM password_reset_tokens;
DELETE FROM sessions;
DELETE FROM users;
`;

/* ============================================================ */
/* 2. CONFIG (idempotent upsert — preserves existing values)    */
/* ============================================================ */
const configRows: Array<[string, unknown]> = [
  ["prices", { thang: { nam: 60000, nu: 50000 }, vang_lai: { nam: 70000, nu: 60000 } }],
  [
    "courts_by_weekday",
    {
      CN: [
        { code: "B1", endTime: "10:00", maxHours: 2 },
        { code: "B2", endTime: "10:00", maxHours: 2 },
        { code: "B4", endTime: "10:00", maxHours: 2 },
      ],
      T7: [
        { code: "C3", endTime: "10:00", maxHours: 2 },
        { code: "C4", endTime: "10:00", maxHours: 2 },
        { code: "B4", endTime: "10:00", maxHours: 2 },
      ],
    },
  ],
  ["people_per_hour", 3],
  ["min_people_per_session", 6],
  ["max_people_per_court_hour", 6],
  ["vote_open_day", 5],
  ["vote_close_day", 25],
];
const configSql = configRows
  .map(([key, val]) => {
    const json = JSON.stringify(val).replace(/'/g, "''");
    return `INSERT INTO config (key, value, updated_at) VALUES ('${key}', '${json}', ${now})
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`;
  })
  .join("\n");

/* ============================================================ */
/* 3. USERS                                                     */
/* ============================================================ */
type Gender = "nam" | "nu";
type Role = "admin" | "member";
interface Member {
  name: string;
  gender: Gender;
  role: Role;
  email: string;
  phone: string | null;
}

/**
 * Order chosen so the matrix (sorted by users.created_at) renders in the same
 * row order as image #2. Non-voters (Thuỳ, Hương) come last — they're filtered
 * out of the matrix anyway since they have no votes this month.
 */
const MEMBERS: Member[] = [
  // Voters in image #2 row order — created_at offset = index
  { name: "Phát", gender: "nam", role: "member", email: "phat@uma.local", phone: null },
  { name: "Hằng", gender: "nu", role: "member", email: "hang@uma.local", phone: null },
  { name: "Hòa", gender: "nam", role: "member", email: "hoa@uma.local", phone: null },
  { name: "Trí", gender: "nam", role: "member", email: "tri@uma.local", phone: null },
  { name: "Thanh", gender: "nam", role: "member", email: "thanh@uma.local", phone: null },
  { name: "Dương", gender: "nu", role: "member", email: "duong@uma.local", phone: null },
  { name: "Hùng", gender: "nam", role: "member", email: "hung@uma.local", phone: null },
  { name: "Nhung", gender: "nu", role: "member", email: "nhung@uma.local", phone: null },
  { name: "Hải", gender: "nam", role: "member", email: "nguyenhoanghai110497@gmail.com", phone: "0374069955" },
  { name: "Linh", gender: "nu", role: "member", email: "plinhuy@gmail.com", phone: null },
  { name: "Hoàng Thịnh", gender: "nam", role: "member", email: "thinhhoang104@gmail.com", phone: null },
  { name: "An", gender: "nam", role: "member", email: "nguyenan8196@gmail.com", phone: "0334923298" },
  // Quyến has no real email — kept as a regular member (placeholder address) so
  // the June matrix matches image #2 exactly; admin role goes to Phước instead.
  { name: "Quyến", gender: "nam", role: "member", email: "quyen@uma.local", phone: null },
  { name: "Cường", gender: "nam", role: "member", email: "cuong@uma.local", phone: null },
  { name: "Hiển", gender: "nam", role: "member", email: "hien@uma.local", phone: null },
  { name: "Minh Sang", gender: "nam", role: "member", email: "minh-sang@uma.local", phone: null },
  { name: "Thành Phát", gender: "nam", role: "member", email: "thanh-phat@uma.local", phone: null },
  { name: "Phước", gender: "nam", role: "admin", email: "phuochtuit@gmail.com", phone: "0966452194" },
  { name: "Xuân Thành", gender: "nam", role: "member", email: "xuan-thanh@uma.local", phone: null },
  // Non-voters (image #3 only) — come last so they don't push the matrix order
  { name: "Thuỳ", gender: "nu", role: "member", email: "daothuyshop@gmail.com", phone: "0975000881" },
  { name: "Hương", gender: "nu", role: "admin", email: "tranhuong13520340@gmail.com", phone: "0372419575" },
];

const memberById = new Map<string, Member & { id: string; createdAt: number }>();
const userSqlLines: string[] = [];
MEMBERS.forEach((m, idx) => {
  const id = ulidish();
  const createdAt = now + idx; // 1ms stride preserves insertion order
  memberById.set(m.name, { ...m, id, createdAt });
  const passwordHash = hashPassword(TEST_PASSWORD);
  userSqlLines.push(
    `INSERT INTO users (id, email, name, phone, gender, role, password_hash, qr_image_key, momo_link, is_active, created_at, updated_at)
     VALUES (${sqlStr(id)}, ${sqlStr(m.email.toLowerCase())}, ${sqlStr(m.name)}, ${sqlStr(m.phone)}, '${m.gender}', '${m.role}', ${sqlStr(passwordHash)}, NULL, NULL, 1, ${createdAt}, ${createdAt});`,
  );
});

/* ============================================================ */
/* 4. JUNE 2026 MONTH + SESSIONS + COURTS                       */
/* ============================================================ */
const Y = 2026;
const M = 6;
// vote_open_at = 5/5/2026 09:00 VN; vote_close_at = 25/5/2026 23:59 VN
const juneOpenAt = Date.UTC(2026, 4, 5, 9, 0, 0) - VN_OFFSET_MS;
const juneCloseAt = Date.UTC(2026, 4, 25, 23, 59, 0) - VN_OFFSET_MS;
const juneMonthId = ulidish();

interface SessionDef {
  id: string;
  date: string;
  courts: Array<{ code: string; startTime: string; endTime: string; order: number }>;
}
const JUNE_SESSIONS: SessionDef[] = [
  {
    id: ulidish(),
    date: "2026-06-07",
    courts: [
      { code: "B1", startTime: "08:00", endTime: "10:00", order: 0 },
      { code: "B2", startTime: "08:00", endTime: "10:00", order: 1 },
      { code: "B4", startTime: "08:00", endTime: "10:00", order: 2 },
    ],
  },
  {
    id: ulidish(),
    date: "2026-06-14",
    courts: [
      { code: "B1", startTime: "08:00", endTime: "10:00", order: 0 },
      { code: "B2", startTime: "08:00", endTime: "10:00", order: 1 },
      { code: "B4", startTime: "08:30", endTime: "09:30", order: 2 },
    ],
  },
  {
    id: ulidish(),
    date: "2026-06-21",
    courts: [
      { code: "B1", startTime: "08:00", endTime: "10:00", order: 0 },
      { code: "B2", startTime: "08:00", endTime: "10:00", order: 1 },
      { code: "B4", startTime: "08:30", endTime: "09:30", order: 2 },
    ],
  },
  {
    id: ulidish(),
    date: "2026-06-28",
    courts: [
      { code: "B1", startTime: "08:00", endTime: "10:00", order: 0 },
      { code: "B2", startTime: "08:00", endTime: "10:00", order: 1 },
    ],
  },
];

/* ============================================================ */
/* 5. VOTE GRID (per image #2)                                  */
/* ============================================================ */
// Order matches MEMBERS array (voter slots only). Cell = true means ✓.
// Column totals must be: 18, 16, 15, 12.
const VOTES: Record<string, [boolean, boolean, boolean, boolean]> = {
  "Phát":        [true, true, true, true],
  "Hằng":        [true, true, true, true],
  "Hòa":         [true, true, true, true],
  "Trí":         [true, true, false, false],
  "Thanh":       [true, true, true, true],
  "Dương":       [true, true, true, true],
  "Hùng":        [true, true, true, true],
  "Nhung":       [true, true, true, true],
  "Hải":         [true, false, true, false],
  "Linh":        [true, true, true, true],
  "Hoàng Thịnh": [true, true, true, true],
  "An":          [true, true, false, true],
  "Quyến":       [true, true, true, true],
  "Cường":       [true, false, true, false],
  "Hiển":        [true, true, false, false],
  "Minh Sang":   [false, false, false, false],
  "Thành Phát":  [true, true, true, true],
  "Phước":       [true, true, true, false],
  "Xuân Thành":  [true, true, true, false],
};

// Self-check: column totals
const colTotals = [0, 0, 0, 0];
for (const v of Object.values(VOTES)) v.forEach((c, i) => (colTotals[i] += c ? 1 : 0));
const expected = [18, 16, 15, 12];
colTotals.forEach((t, i) => {
  if (t !== expected[i]) {
    throw new Error(`Column ${i} total ${t} ≠ expected ${expected[i]}`);
  }
});

/* ============================================================ */
/* 6. PRICES + SNAPSHOT                                         */
/* ============================================================ */
const PRICES = { thang: { nam: 60000, nu: 50000 }, vang_lai: { nam: 70000, nu: 60000 } };

function hoursOf(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return Math.max(0, (eh * 60 + em - sh * 60 - sm) / 60);
}

interface MatrixCellSnap {
  status: "thang" | null;
}
interface MatrixRowSnap {
  user: { id: string; name: string; gender: Gender };
  cells: MatrixCellSnap[];
  totalSlots: number;
  totalFee: number;
}
interface MatrixSessionSnap {
  id: string;
  date: string;
  weekday: "CN";
  voteCount: number;
  totalHours: number;
  courts: Array<{ id: string; courtCode: string; startTime: string; endTime: string }>;
}
interface MonthSnapshotJson {
  matrix: {
    sessions: MatrixSessionSnap[];
    rows: MatrixRowSnap[];
    grandTotal: number;
  };
}

// Court IDs (used by snapshot too)
const courtIds = new Map<string, string>(); // sessionId|courtCode -> id
for (const s of JUNE_SESSIONS) {
  for (const c of s.courts) {
    courtIds.set(`${s.id}|${c.code}`, ulidish());
  }
}

const snapshotSessions: MatrixSessionSnap[] = JUNE_SESSIONS.map((s) => {
  // voteCount = number of voters who have ✓ on this session
  const idx = JUNE_SESSIONS.indexOf(s);
  let voteCount = 0;
  for (const v of Object.values(VOTES)) if (v[idx]) voteCount++;
  const totalHours = s.courts.reduce((sum, c) => sum + hoursOf(c.startTime, c.endTime), 0);
  return {
    id: s.id,
    date: s.date,
    weekday: "CN",
    voteCount,
    totalHours,
    courts: s.courts.map((c) => ({
      id: courtIds.get(`${s.id}|${c.code}`)!,
      courtCode: c.code,
      startTime: c.startTime,
      endTime: c.endTime,
    })),
  };
});

// Rows: every member, but matrix builder filters out users with zero votes.
const snapshotRows: MatrixRowSnap[] = [];
for (const m of MEMBERS) {
  const votes = VOTES[m.name];
  if (!votes) continue; // non-voters (Thuỳ, Hương)
  if (!votes.some((v) => v)) continue; // Minh Sang
  const user = memberById.get(m.name)!;
  const cells: MatrixCellSnap[] = votes.map((v) => ({ status: v ? "thang" : null }));
  const totalSlots = votes.filter((v) => v).length;
  const totalFee = totalSlots * PRICES.thang[m.gender];
  snapshotRows.push({
    user: { id: user.id, name: m.name, gender: m.gender },
    cells,
    totalSlots,
    totalFee,
  });
}
const grandTotal = snapshotRows.reduce((sum, r) => sum + r.totalFee, 0);
if (grandTotal !== 3_500_000) {
  throw new Error(`Snapshot grandTotal ${grandTotal} ≠ expected 3500000`);
}

const snapshotJson: MonthSnapshotJson = {
  matrix: { sessions: snapshotSessions, rows: snapshotRows, grandTotal },
};

/* ============================================================ */
/* 7. BUILD SQL                                                  */
/* ============================================================ */
const monthSql: string[] = [];

monthSql.push(
  `INSERT INTO months (id, year, month, status, vote_open_at, vote_close_at, created_at, locked_snapshot)
   VALUES ('${juneMonthId}', ${Y}, ${M}, 'done', ${juneOpenAt}, ${juneCloseAt}, ${now}, '${JSON.stringify(snapshotJson).replace(/'/g, "''")}');`,
);

// July 2026 — created in `draft`. `transitionToVoting` (called lazily from
// trang-chu / nightly cron) flips it to `voting` only once `voteOpenAt`
// (5/6/2026 09:00 VN) is reached. Seeding it as `voting` directly would
// prematurely surface the next-month vote banner.
{
  const julyId = ulidish();
  const openAt = Date.UTC(2026, 5, 5, 9, 0, 0) - VN_OFFSET_MS;
  const closeAt = Date.UTC(2026, 5, 25, 23, 59, 0) - VN_OFFSET_MS;
  monthSql.push(
    `INSERT INTO months (id, year, month, status, vote_open_at, vote_close_at, created_at)
     VALUES ('${julyId}', 2026, 7, 'draft', ${openAt}, ${closeAt}, ${now});`,
  );
}

// Sessions
for (const s of JUNE_SESSIONS) {
  monthSql.push(
    `INSERT INTO play_sessions (id, month_id, date, weekday) VALUES ('${s.id}', '${juneMonthId}', '${s.date}', 'CN');`,
  );
}

// Court allocations
for (const s of JUNE_SESSIONS) {
  for (const c of s.courts) {
    const id = courtIds.get(`${s.id}|${c.code}`)!;
    monthSql.push(
      `INSERT INTO court_allocations (id, play_session_id, court_code, start_time, end_time, display_order)
       VALUES ('${id}', '${s.id}', '${c.code}', '${c.startTime}', '${c.endTime}', ${c.order});`,
    );
  }
}

// Votes
const voteSql: string[] = [];
for (const m of MEMBERS) {
  const votes = VOTES[m.name];
  if (!votes) continue;
  const user = memberById.get(m.name)!;
  votes.forEach((v, idx) => {
    if (!v) return;
    const sessionId = JUNE_SESSIONS[idx].id;
    const voteId = ulidish();
    voteSql.push(
      `INSERT INTO votes (id, play_session_id, user_id, status, voted_at, original_voter_id)
       VALUES ('${voteId}', '${sessionId}', '${user.id}', 'thang', ${now}, NULL);`,
    );
  });
}

// Payments: every voter who has ≥1 vote (i.e., owes money) is marked đã chuyển.
const paymentSql: string[] = [];
for (const m of MEMBERS) {
  const votes = VOTES[m.name];
  if (!votes || !votes.some((v) => v)) continue;
  const user = memberById.get(m.name)!;
  paymentSql.push(
    `INSERT INTO member_month_payments (user_id, month_id, paid_at)
     VALUES ('${user.id}', '${juneMonthId}', ${now});`,
  );
}

/* ============================================================ */
/* 8. EXECUTE                                                    */
/* ============================================================ */
console.log(`\n=== Production seed for June 2026 (target: ${target}) ===`);
console.log(`Members: ${MEMBERS.length} (${MEMBERS.filter((m) => m.role === "admin").length} admin)`);
console.log(`Sessions: ${JUNE_SESSIONS.length}`);
console.log(`Votes: ${voteSql.length} (column totals: ${colTotals.join(", ")})`);
console.log(`Payments: ${paymentSql.length}`);
console.log(`Snapshot grandTotal: ${grandTotal.toLocaleString("de-DE")}đ`);

writeAndRun("01_wipe", wipeSql);
writeAndRun("02_config", configSql);
writeAndRun("03_users", userSqlLines.join("\n"));
writeAndRun("04_month_sessions_courts", monthSql.join("\n"));
writeAndRun("05_votes", voteSql.join("\n"));
writeAndRun("06_payments", paymentSql.join("\n"));

console.log("\n✅ Done.");
console.log(`   Admins: Quyến (quyen@uma.local), Hương (tranhuong13520340@gmail.com)`);
console.log(`   Pass:   ${TEST_PASSWORD}`);
console.log(`   June 2026: status=done, snapshot grandTotal=${grandTotal.toLocaleString("de-DE")}đ\n`);
