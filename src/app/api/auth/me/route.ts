import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensureSeeded } from "@/db/seed";

export async function GET() {
  ensureSeeded();
  const user = await getSessionUser();
  return NextResponse.json({ user });
}
