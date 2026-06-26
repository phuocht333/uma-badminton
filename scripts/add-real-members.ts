/**
 * One-off: thêm 8 members thật vào DB (giữ nguyên seed cũ, không động vào ai).
 * Sau khi chạy: vào /admin/members → bấm "Gửi lại email" cho từng người để họ
 * nhận link đặt mật khẩu (passwordHash insert = NULL, đúng flow welcome).
 *
 * Usage:
 *   pnpm tsx scripts/add-real-members.ts --local
 *   pnpm tsx scripts/add-real-members.ts --remote
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const target = process.argv.includes("--remote") ? "--remote" : "--local";
const dbName = "uma_badminton_db";

function ulidish(): string {
  const ts = Date.now().toString(36).padStart(10, "0").toUpperCase();
  const rand = randomBytes(8).toString("hex").toUpperCase();
  return (ts + rand).slice(0, 26);
}

function sqlStr(s: string | null): string {
  if (s === null) return "NULL";
  return `'${s.replace(/'/g, "''")}'`;
}

type Gender = "nam" | "nu";
interface NewMember {
  name: string;
  email: string;
  gender: Gender;
}

const MEMBERS: NewMember[] = [
  { name: "Phát NT", email: "11520277uit@gmail.com",       gender: "nam" },
  { name: "Hiển",    email: "ngochiens269@gmail.com",      gender: "nam" },
  { name: "Trí",     email: "it.daominhtri@gmail.com",     gender: "nam" },
  { name: "Thành",   email: "tranxuanthanh1710@gmail.com", gender: "nam" },
  { name: "Sang",    email: "nguyenminhsang0210@gmail.com",gender: "nam" },
  { name: "Dương",   email: "ttduongtran@gmail.com",       gender: "nu"  },
  { name: "Hùng",    email: "nguyenlemanhhung@gmail.com",  gender: "nam" },
  { name: "Hoà",     email: "hoapt269@gmail.com",          gender: "nam" },
];

const now = Date.now();
const lines: string[] = [];
MEMBERS.forEach((m, idx) => {
  const id = ulidish();
  const createdAt = now + idx;
  lines.push(
    `INSERT INTO users (id, email, name, phone, gender, role, password_hash, qr_image_key, momo_link, is_active, created_at, updated_at)
     VALUES (${sqlStr(id)}, ${sqlStr(m.email.toLowerCase())}, ${sqlStr(m.name)}, NULL, '${m.gender}', 'member', NULL, NULL, NULL, 1, ${createdAt}, ${createdAt});`,
  );
});

const sql = lines.join("\n");

console.log(`\n=== Add ${MEMBERS.length} real members (target: ${target}) ===`);
for (const m of MEMBERS) console.log(`  • ${m.name.padEnd(8)} ${m.gender}  ${m.email}`);

const tmpDir = mkdtempSync(join(tmpdir(), "uma-add-"));
const file = join(tmpDir, "add-real-members.sql");
writeFileSync(file, sql);
console.log(`\n▸ SQL file: ${file}`);

const r = spawnSync(
  "pnpm",
  ["wrangler", "d1", "execute", dbName, target, "--file", file],
  { stdio: ["ignore", "inherit", "inherit"] },
);
if (r.status !== 0) {
  console.error("\n❌ Wrangler exec failed (có thể email đã tồn tại — schema có UNIQUE INDEX trên email).");
  process.exit(1);
}

console.log(`\n✅ Đã insert ${MEMBERS.length} users.`);
console.log(`   Bước cuối: vào /admin/members bấm "Gửi lại email" cho mỗi người để họ nhận link đặt mật khẩu.\n`);
