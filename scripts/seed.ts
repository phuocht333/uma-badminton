/**
 * Local/remote seed script. Inserts default config rows + a bootstrap admin
 * user with a working password hash (default: 123456).
 *
 * Usage:
 *   pnpm db:seed:local
 *   pnpm db:seed:remote   (requires `wrangler login`)
 *
 * The script shells out to `wrangler d1 execute` with parameterized SQL so it
 * works for both local (--local) and remote (--remote) D1 databases.
 *
 * Override admin defaults via env:
 *   ADMIN_EMAIL    (default: phuochtuit@gmail.com)
 *   ADMIN_NAME     (default: Phuoc)
 *   ADMIN_GENDER   (default: nam)
 *   ADMIN_PASSWORD (default: 123456)
 */
import { spawnSync } from "node:child_process";
import { pbkdf2Sync, randomBytes } from "node:crypto";

const target = process.argv.includes("--remote") ? "--remote" : "--local";
const dbName = "uma_badminton_db";

const adminEmail = (process.env.ADMIN_EMAIL || "phuochtuit@gmail.com").toLowerCase();
const adminName = process.env.ADMIN_NAME || "Phuoc";
const adminGender = (process.env.ADMIN_GENDER || "nam").toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || "123456";

/* ---------- Hash password using same format as app/lib/crypto.server.ts ---------- */
// Format: pbkdf2$iter$saltBase64$hashBase64  (SHA-256, 100k iter, 32-byte key)
const ITER = 100_000;
const KEY_LEN = 32;
const salt = randomBytes(16);
const hash = pbkdf2Sync(adminPassword, salt, ITER, KEY_LEN, "sha256");
const passwordHash = `pbkdf2$${ITER}$${salt.toString("base64")}$${hash.toString("base64")}`;

/* ---------- ULID-ish (avoid extra deps in Node script) ---------- */
const ulidish = () => {
  const ts = Date.now().toString(36).padStart(10, "0").toUpperCase();
  const rand = randomBytes(8).toString("hex").toUpperCase();
  return (ts + rand).slice(0, 26);
};

function sqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

function run(sql: string): void {
  const r = spawnSync(
    "pnpm",
    ["wrangler", "d1", "execute", dbName, target, "--command", sql],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  if (r.status !== 0) throw new Error(`wrangler exec failed: ${sql.slice(0, 80)}...`);
}

const now = Date.now();

/* ---------- Seed config ---------- */
const configRows: Array<[string, unknown]> = [
  ["prices", { thang: { nam: 60000, nu: 50000 }, vang_lai: { nam: 70000, nu: 60000 } }],
  [
    "courts_by_weekday",
    {
      CN: [
        { code: "B2", endTime: "10:00", maxHours: 2 },
        { code: "B1", endTime: "10:00", maxHours: 2 },
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

console.log(`\n▸ Seeding config (target: ${target})...`);
for (const [key, val] of configRows) {
  const json = sqlEscape(JSON.stringify(val));
  run(
    `INSERT INTO config (key, value, updated_at) VALUES ('${key}', '${json}', ${now}) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`,
  );
}

/* ---------- Seed admin ---------- */
console.log(`\n▸ Seeding admin user (${adminEmail})...`);
const adminId = ulidish();
run(
  `INSERT INTO users (id, email, name, gender, role, password_hash, qr_image_key, is_active, created_at, updated_at)
     VALUES ('${adminId}', '${sqlEscape(adminEmail)}', '${sqlEscape(adminName)}', '${adminGender}', 'admin', '${sqlEscape(passwordHash)}', NULL, 1, ${now}, ${now})
     ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at;`,
);

console.log("\n✅ Seed done.");
console.log(`   Admin email:    ${adminEmail}`);
console.log(`   Admin password: ${adminPassword}  (đổi sau khi đăng nhập tại /profile)`);
console.log(`   Login URL:      <APP_BASE_URL>/login\n`);
