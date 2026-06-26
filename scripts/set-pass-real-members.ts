/**
 * One-off: set password "123456" cho 8 member real vừa insert.
 * Dùng cùng pbkdf2 format như seed cũ → flow login auth.server.ts xài được.
 *
 * Usage:
 *   pnpm tsx scripts/set-pass-real-members.ts --local
 *   pnpm tsx scripts/set-pass-real-members.ts --remote
 */
import { spawnSync } from "node:child_process";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const target = process.argv.includes("--remote") ? "--remote" : "--local";
const dbName = "uma_badminton_db";

const ITER = 100_000;
const KEY_LEN = 32;
function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(pw, salt, ITER, KEY_LEN, "sha256");
  return `pbkdf2$${ITER}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

const EMAILS = [
  "11520277uit@gmail.com",
  "ngochiens269@gmail.com",
  "it.daominhtri@gmail.com",
  "tranxuanthanh1710@gmail.com",
  "nguyenminhsang0210@gmail.com",
  "ttduongtran@gmail.com",
  "nguyenlemanhhung@gmail.com",
  "hoapt269@gmail.com",
];

const now = Date.now();
const lines = EMAILS.map((email) => {
  const hash = hashPassword("123456").replace(/'/g, "''");
  return `UPDATE users SET password_hash = '${hash}', updated_at = ${now} WHERE email = '${email}';`;
});

const tmpDir = mkdtempSync(join(tmpdir(), "uma-setpass-"));
const file = join(tmpDir, "set-pass.sql");
writeFileSync(file, lines.join("\n"));

console.log(`\n=== Set password "123456" cho ${EMAILS.length} users (target: ${target}) ===`);
console.log(`▸ SQL file: ${file}\n`);

const r = spawnSync(
  "pnpm",
  ["wrangler", "d1", "execute", dbName, target, "--file", file],
  { stdio: ["ignore", "inherit", "inherit"] },
);
if (r.status !== 0) {
  console.error("\n❌ Wrangler exec failed");
  process.exit(1);
}
console.log(`\n✅ Đã set password. 8 user login bằng email + "123456".\n`);
