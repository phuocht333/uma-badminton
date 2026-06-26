import { createCookie, redirect, type AppLoadContext } from "@remix-run/cloudflare";
import { eq, and, gt } from "drizzle-orm";
import { ulid } from "ulid";
import { getDb, schema } from "~/db/client";
import { verifyPassword } from "./crypto.server";

const SESSION_COOKIE = "uma_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function sessionCookie(secret: string) {
  return createCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secrets: [secret],
    secure: true,
    maxAge: SESSION_MAX_AGE,
  });
}

export async function getUserFromRequest(
  request: Request,
  context: AppLoadContext,
): Promise<schema.User | null> {
  const env = context.cloudflare.env as Env;
  const cookie = sessionCookie(env.SESSION_SECRET);
  const sessionId = (await cookie.parse(request.headers.get("Cookie"))) as string | null;
  if (!sessionId) return null;

  const db = getDb(env.DB);
  const now = Date.now();
  const rows = await db
    .select({ user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, sessionId), gt(schema.sessions.expiresAt, now)))
    .limit(1);

  const user = rows[0]?.user;
  if (!user || !user.isActive) return null;
  return user;
}

export async function requireUser(
  request: Request,
  context: AppLoadContext,
): Promise<schema.User> {
  const user = await getUserFromRequest(request, context);
  if (!user) throw redirect("/login");
  return user;
}

export async function requireAdmin(
  request: Request,
  context: AppLoadContext,
): Promise<schema.User> {
  const user = await requireUser(request, context);
  if (user.role !== "admin") {
    throw new Response("Bạn không có quyền truy cập trang này.", { status: 403 });
  }
  return user;
}

export async function login(
  email: string,
  password: string,
  context: AppLoadContext,
): Promise<{ user: schema.User; sessionId: string; cookieHeader: string } | { error: string }> {
  const env = context.cloudflare.env as Env;
  const db = getDb(env.DB);
  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, email.toLowerCase().trim()),
  });
  if (!user || !user.passwordHash || !user.isActive) {
    return { error: "Email hoặc mật khẩu không đúng." };
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return { error: "Email hoặc mật khẩu không đúng." };

  const sessionId = ulid();
  const now = Date.now();
  await db.insert(schema.sessions).values({
    id: sessionId,
    userId: user.id,
    expiresAt: now + SESSION_MAX_AGE * 1000,
    createdAt: now,
  });

  const cookie = sessionCookie(env.SESSION_SECRET);
  const cookieHeader = await cookie.serialize(sessionId);
  return { user, sessionId, cookieHeader };
}

/**
 * Invalidate every session for a user. Called when password changes — by
 * member-initiated change in /profile, or by reset-link flow in /set-password.
 * After this, all devices need to re-login.
 */
export async function invalidateAllSessionsForUser(
  context: AppLoadContext,
  userId: string,
): Promise<void> {
  const env = context.cloudflare.env as Env;
  const db = getDb(env.DB);
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
}

export async function logout(
  request: Request,
  context: AppLoadContext,
): Promise<{ cookieHeader: string }> {
  const env = context.cloudflare.env as Env;
  const cookie = sessionCookie(env.SESSION_SECRET);
  const sessionId = (await cookie.parse(request.headers.get("Cookie"))) as string | null;
  if (sessionId) {
    const db = getDb(env.DB);
    await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
  }
  const cookieHeader = await cookie.serialize("", { maxAge: 0 });
  return { cookieHeader };
}

// Convenience env type; mirrors worker.ts but kept loose to avoid circular import.
type Env = {
  DB: D1Database;
  SESSION_SECRET: string;
};
