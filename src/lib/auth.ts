import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";
import { sqlite, type SafeUser, type UserRow } from "../db/index.ts";
import { repo } from "./repository.ts";

const COOKIE_NAME = "rhtc_session";
const SECRET =
  process.env.SESSION_SECRET || "rhtc-2-herren-schiedsrichter-secret-2026";

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, keyHex] = storedHash.split(":");
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, "hex");
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function createSessionToken(userId: number): string {
  const exp = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ userId, exp })).toString(
    "base64url"
  );
  const sig = crypto
    .createHmac("sha256", SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySessionToken(token: string): number | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(payload)
    .digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

  try {
    const data = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as { userId?: number; exp?: number };
    if (!data.userId || !data.exp || data.exp < Date.now()) return null;
    return data.userId;
  } catch {
    return null;
  }
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie || "";
  const result: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) result[key] = decodeURIComponent(val);
  }
  return result;
}

export function getSessionUser(req: IncomingMessage): SafeUser | null {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;

  const userId = verifySessionToken(token);
  if (!userId) return null;

  const row = sqlite
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(userId) as UserRow | undefined;
  if (!row) return null;

  const { password_hash: _, ...safeUser } = row;
  return safeUser;
}

const userSessionCache = new Map<number, { user: SafeUser; expiresAt: number }>();

export function invalidateUserSessionCache(userId?: number) {
  if (userId) {
    userSessionCache.delete(userId);
  } else {
    userSessionCache.clear();
  }
}

export async function getSessionUserFromHeader(
  cookieHeader: string | null
): Promise<SafeUser | null> {
  if (!cookieHeader) return null;
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) result[key] = decodeURIComponent(val);
  }
  const token = result[COOKIE_NAME];
  if (!token) return null;

  const userId = verifySessionToken(token);
  if (!userId) return null;

  const now = Date.now();
  const cached = userSessionCache.get(userId);
  if (cached && cached.expiresAt > now) {
    return cached.user;
  }

  const row = await repo.users.findById(userId);
  if (!row) return null;

  const { password_hash: _, ...safeUser } = row;
  userSessionCache.set(userId, { user: safeUser, expiresAt: now + 60_000 });
  return safeUser;
}

export function makeSessionCookieHeader(userId: number): string {
  const token = createSessionToken(userId);
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`;
}

export function makeClearCookieHeader(): string {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}
