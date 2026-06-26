/**
 * Wipe all test data created by `seed-test.ts`.
 * Identifies test users by email pattern `test-*@uma.local`.
 *
 * Cascades via foreign-key ON DELETE CASCADE for votes, pass_requests,
 * extra_slot_requests, sessions, password_reset_tokens.
 *
 * Does NOT touch the real admin user, config rows, or play_sessions/months.
 *
 * Usage:
 *   pnpm db:clean-test:local
 *   pnpm db:clean-test:remote
 */
import { spawnSync } from "node:child_process";

const target = process.argv.includes("--remote") ? "--remote" : "--local";
const dbName = "uma_badminton_db";

function run(sql: string): void {
  const r = spawnSync(
    "pnpm",
    ["wrangler", "d1", "execute", dbName, target, "--command", sql],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  if (r.status !== 0) throw new Error(`wrangler exec failed: ${sql.slice(0, 80)}...`);
}

console.log(`\n▸ Cleaning test data (target: ${target})...\n`);

run(`DELETE FROM audit_logs WHERE actor_user_id IN (SELECT id FROM users WHERE email LIKE 'test-%@uma.local')
                              OR subject_user_id IN (SELECT id FROM users WHERE email LIKE 'test-%@uma.local');`);
run(`DELETE FROM users WHERE email LIKE 'test-%@uma.local';`);

console.log("✅ Test data cleaned (test-*@uma.local + cascaded).\n");
