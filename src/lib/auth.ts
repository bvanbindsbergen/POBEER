import { db } from "./db";
import { sessions, users } from "./db/schema";
import { eq, and, gt } from "drizzle-orm";
import crypto from "crypto";
import { cookies } from "next/headers";

const SESSION_COOKIE = "pobeer_session";
const SESSION_DURATION_DAYS = 30;

export async function createSession(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_DURATION_DAYS);

  await db.insert(sessions).values({ userId, token, expiresAt });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  return token;
}

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const result = await db
    .select({
      session: sessions,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (result.length === 0) return null;

  return {
    session: result[0].session,
    user: result[0].user,
  };
}

export async function requireAuth() {
  const auth = await getSession();
  if (!auth) {
    throw new Error("Unauthorized");
  }
  return auth;
}

export async function requireRole(role: "leader" | "follower") {
  const auth = await requireAuth();
  if (auth.user.role !== role) {
    throw new Error("Forbidden");
  }
  return auth;
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.token, token));
  }
  cookieStore.delete(SESSION_COOKIE);
}
