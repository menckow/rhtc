import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { setSessionCookie, verifyPassword } from "@/lib/auth";
import { ensureSeeded } from "@/db/seed";

export async function POST(req: Request) {
  ensureSeeded();
  const body = await req.json();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  if (!email || !password) {
    return NextResponse.json(
      { error: "E-Mail und Passwort erforderlich." },
      { status: 400 }
    );
  }

  const user = db.select().from(users).where(eq(users.email, email)).get();
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json(
      { error: "Ungültige E-Mail oder falsches Passwort." },
      { status: 401 }
    );
  }

  await setSessionCookie(user.id);
  const { passwordHash: _, ...safeUser } = user;
  return NextResponse.json({ user: safeUser });
}
