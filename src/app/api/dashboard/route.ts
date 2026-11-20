import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensureSeeded } from "@/db/seed";
import { db } from "@/db/index";
import {
  assignmentChains,
  games,
  handoffEvents,
  seasons,
  users,
} from "@/db/schema";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { getSortedActivePlayers } from "@/lib/scheduler";

export async function GET() {
  ensureSeeded();
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  const season = db
    .select()
    .from(seasons)
    .where(eq(seasons.isActive, true))
    .get();

  if (!season) {
    return NextResponse.json({ user, season: null, players: [], games: [] });
  }

  const allUsersRaw = db.select().from(users).all();
  const userMap = new Map(
    allUsersRaw.map(({ passwordHash: _, ...u }) => [u.id, u])
  );
  const sortedActive = getSortedActivePlayers();
  const inactiveUsers = allUsersRaw
    .filter((u) => !u.isActiveInList)
    .map(({ passwordHash: _, ...u }) => u);

  const seasonGames = db
    .select()
    .from(games)
    .where(eq(games.seasonId, season.id))
    .orderBy(asc(games.kickoffAt))
    .all();

  const gameIds = seasonGames.map((g) => g.id);
  const chains =
    gameIds.length > 0
      ? db
          .select()
          .from(assignmentChains)
          .where(inArray(assignmentChains.gameId, gameIds))
          .orderBy(asc(assignmentChains.slotNumber))
          .all()
      : [];

  const events =
    gameIds.length > 0
      ? db
          .select()
          .from(handoffEvents)
          .where(inArray(handoffEvents.gameId, gameIds))
          .orderBy(desc(handoffEvents.id))
          .all()
      : [];

  const isTreasurer = user.role === "KASSENWART";

  const sanitizedEvents = events.map((ev) => ({
    ...ev,
    fromUser: ev.fromUserId ? userMap.get(ev.fromUserId) ?? null : null,
    toUser: ev.toUserId ? userMap.get(ev.toUserId) ?? null : null,
    hardshipReasonConfidential: isTreasurer
      ? ev.hardshipReasonConfidential
      : null,
  }));

  const gamesWithChains = seasonGames.map((g) => {
    const gChains = chains
      .filter((c) => c.gameId === g.id)
      .map((c) => ({
        ...c,
        currentAssignee: c.currentAssigneeId
          ? userMap.get(c.currentAssigneeId) ?? null
          : null,
        pendingAssignee: c.pendingAssigneeId
          ? userMap.get(c.pendingAssigneeId) ?? null
          : null,
        voluntaryRequester: c.voluntaryRequesterId
          ? userMap.get(c.voluntaryRequesterId) ?? null
          : null,
        events: sanitizedEvents.filter((e) => e.chainId === c.id),
      }));
    return {
      ...g,
      chains: gChains,
    };
  });

  // Spieler-Statistiken berechnen
  const playerStats = [...sortedActive, ...inactiveUsers].map((p) => {
    const activeAssigned = chains.filter(
      (c) =>
        (c.currentAssigneeId === p.id || c.pendingAssigneeId === p.id) &&
        c.status !== "CONFIRMED_DEPLOYED" &&
        c.status !== "UNASSIGNED"
    ).length;
    const deployedCount = chains.filter(
      (c) =>
        c.currentAssigneeId === p.id && c.status === "CONFIRMED_DEPLOYED"
    ).length;
    const playerEvents = sanitizedEvents.filter((e) => e.fromUserId === p.id);
    const openPaymentCents = playerEvents
      .filter((e) => e.paymentStatus === "OPEN")
      .reduce((acc, e) => acc + (e.feeTotalCents - e.waivedAmountCents), 0);
    const paidCents = playerEvents
      .filter((e) => e.paymentStatus === "PAID")
      .reduce((acc, e) => acc + (e.feeTotalCents - e.waivedAmountCents), 0);
    const earnedPayoutCents = chains
      .filter(
        (c) =>
          c.currentAssigneeId === p.id &&
          c.status === "CONFIRMED_DEPLOYED" &&
          c.payoutPoolCents > 0
      )
      .reduce((acc, c) => acc + c.payoutPoolCents, 0);

    return {
      ...p,
      activeAssigned,
      deployedCount,
      openPaymentCents,
      paidCents,
      earnedPayoutCents,
    };
  });

  const totalTeamPotCents = chains.reduce((acc, c) => acc + c.teamPotCents, 0);
  const totalOpenPaymentsCents = sanitizedEvents
    .filter((e) => e.paymentStatus === "OPEN")
    .reduce((acc, e) => acc + (e.feeTotalCents - e.waivedAmountCents), 0);
  const totalPaidCents = sanitizedEvents
    .filter((e) => e.paymentStatus === "PAID")
    .reduce((acc, e) => acc + (e.feeTotalCents - e.waivedAmountCents), 0);
  const totalPayoutPoolOpenCents = chains
    .filter((c) => !c.payoutSettled && c.payoutPoolCents > 0)
    .reduce((acc, c) => acc + c.payoutPoolCents, 0);

  return NextResponse.json({
    user,
    season,
    players: playerStats,
    games: gamesWithChains,
    events: sanitizedEvents,
    summary: {
      totalTeamPotCents,
      totalOpenPaymentsCents,
      totalPaidCents,
      totalPayoutPoolOpenCents,
    },
  });
}
