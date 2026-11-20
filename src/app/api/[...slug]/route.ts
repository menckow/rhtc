import { NextResponse } from "next/server";
import { repo } from "@/lib/repository";
import {
  createSessionToken,
  getSessionUserFromHeader,
  hashPassword,
  invalidateUserSessionCache,
  makeClearCookieHeader,
  makeSessionCookieHeader,
  verifyPassword,
} from "@/lib/auth";
import {
  buildGroupChatMessage,
  findNextFreePlayerAsync,
  findNextFreePlayerWithData,
  getFullName,
  getNextSeasonRefCodeAsync,
  getSortedActivePlayersAsync,
  isShortNotice48h,
  sortPlayersList,
} from "@/lib/scheduler";
import type { ChainRow, EventRow, GameRow, SafeUser, SeasonRow, UserRow } from "@/db/index";

function parseCsv(content: string, delimiter = ";"): string[][] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.map((line) => line.split(delimiter).map((c) => c.trim()));
}

async function getAuthUser(req: Request): Promise<SafeUser | null> {
  const cookieHeader = req.headers.get("cookie");
  return getSessionUserFromHeader(cookieHeader);
}

// ---------------------------------------------------------------------------
// GET Handlers
// ---------------------------------------------------------------------------
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  try {
    const { slug } = await params;
    const path = "/" + slug.join("/");
    const url = new URL(req.url);

  // 1. /api/auth/me
  if (path === "/auth/me") {
    const user = await getAuthUser(req);
    return NextResponse.json({ user });
  }

  // Für alle nachfolgenden Routen ist Authentifizierung erforderlich
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  // 2. /api/dashboard
  if (path === "/dashboard") {
    const [allSeasons, allUsersRaw] = await Promise.all([
      repo.seasons.listAll(),
      repo.users.listAll(),
    ]);
    const reqSeasonId = url.searchParams.get("seasonId")
      ? Number(url.searchParams.get("seasonId"))
      : null;
    const season =
      (reqSeasonId ? allSeasons.find((s) => s.id === reqSeasonId) : undefined) ??
      allSeasons.find((s) => s.is_active) ??
      allSeasons[0] ??
      null;

    if (!season) {
      return NextResponse.json({
        user,
        season: null,
        seasons: allSeasons,
        players: [],
        games: [],
        events: [],
        summary: {
          totalTeamPotCents: 0,
          totalOpenPaymentsCents: 0,
          totalPaidCents: 0,
          totalPayoutPoolOpenCents: 0,
        },
      });
    }

    const userMap = new Map<number, SafeUser>(
      allUsersRaw.map(({ password_hash: _, ...u }) => [u.id, u])
    );
    const sortedActive = sortPlayersList(
      allUsersRaw.filter((u) => u.is_active_in_list)
    );
    const inactiveUsers = sortPlayersList(
      allUsersRaw.filter((u) => !u.is_active_in_list)
    );

    const seasonGames = await repo.games.listBySeason(season.id);
    const gameIds = seasonGames.map((g) => g.id);
    const [chains, events] = await Promise.all([
      repo.chains.listByGameIds(gameIds),
      repo.events.listByGameIds(gameIds),
    ]);

    const isTreasurer = user.role === "KASSENWART";
    const sanitizedEvents = events.map((ev) => ({
      ...ev,
      fromUser: ev.from_user_id ? userMap.get(ev.from_user_id) ?? null : null,
      toUser: ev.to_user_id ? userMap.get(ev.to_user_id) ?? null : null,
      hardship_reason_confidential: isTreasurer
        ? ev.hardship_reason_confidential
        : null,
    }));

    const gamesWithChains = seasonGames.map((g) => ({
      ...g,
      chains: chains
        .filter((c) => c.game_id === g.id)
        .map((c) => ({
          ...c,
          currentAssignee: c.current_assignee_id
            ? userMap.get(c.current_assignee_id) ?? null
            : null,
          pendingAssignee: c.pending_assignee_id
            ? userMap.get(c.pending_assignee_id) ?? null
            : null,
          voluntaryRequester: c.voluntary_requester_id
            ? userMap.get(c.voluntary_requester_id) ?? null
            : null,
          events: sanitizedEvents.filter((e) => e.chain_id === c.id),
        })),
    }));

    const playerStats = [...sortedActive, ...inactiveUsers].map((p) => {
      const activeAssigned = chains.filter(
        (c) =>
          (c.current_assignee_id === p.id || c.pending_assignee_id === p.id) &&
          c.status !== "CONFIRMED_DEPLOYED" &&
          c.status !== "UNASSIGNED"
      ).length;
      const deployedCount = chains.filter(
        (c) =>
          c.current_assignee_id === p.id && c.status === "CONFIRMED_DEPLOYED"
      ).length;
      const pEvents = sanitizedEvents.filter((e) => e.from_user_id === p.id);
      const openPaymentCents = pEvents
        .filter((e) => e.payment_status === "OPEN")
        .reduce((acc, e) => acc + (e.fee_total_cents - e.waived_amount_cents), 0);
      const paidCents = pEvents
        .filter((e) => e.payment_status === "PAID")
        .reduce((acc, e) => acc + (e.fee_total_cents - e.waived_amount_cents), 0);

      return {
        ...p,
        activeAssigned,
        deployedCount,
        openPaymentCents,
        paidCents,
      };
    });

    const totalTeamPotCents = events.reduce(
      (acc, e) => acc + (e.team_pot_cents || 0),
      0
    );
    const totalOpenPaymentsCents = events
      .filter((e) => e.payment_status === "OPEN")
      .reduce((acc, e) => acc + (e.fee_total_cents - e.waived_amount_cents), 0);
    const totalPaidCents = events
      .filter((e) => e.payment_status === "PAID")
      .reduce((acc, e) => acc + (e.fee_total_cents - e.waived_amount_cents), 0);
    const totalPayoutPoolOpenCents = chains
      .filter((c) => !c.payout_settled && c.payout_pool_cents > 0)
      .reduce((acc, c) => acc + c.payout_pool_cents, 0);

    return NextResponse.json({
      user,
      season,
      seasons: allSeasons,
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

  return NextResponse.json({ error: "Route nicht gefunden." }, { status: 404 });
  } catch (err: any) {
    console.error("DELETE error:", err);
    return NextResponse.json({ error: err.message || "Anfrage fehlgeschlagen" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST Handlers
// ---------------------------------------------------------------------------
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  try {
    const { slug } = await params;
  const path = "/" + slug.join("/");
  const body = await req.json().catch(() => ({}));

  // 1. /api/auth/login
  if (path === "/auth/login") {
    const email = String(body.email || "").trim();
    const password = String(body.password || "");
    const userRow = await repo.users.findByEmail(email);

    if (!userRow || !verifyPassword(password, userRow.password_hash)) {
      return NextResponse.json(
        { error: "Ungültige E-Mail oder falsches Passwort." },
        { status: 401 }
      );
    }
    const { password_hash: _, ...safeUser } = userRow;
    const token = createSessionToken(userRow.id);
    const res = NextResponse.json({ user: safeUser });
    res.cookies.set({
      name: "rhtc_session",
      value: token,
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      maxAge: 2592000,
    });
    return res;
  }

  // 2. /api/auth/logout
  if (path === "/auth/logout") {
    invalidateUserSessionCache();
    const res = NextResponse.json({ ok: true });
    res.cookies.delete("rhtc_session");
    res.cookies.set({
      name: "rhtc_session",
      value: "",
      httpOnly: true,
      path: "/",
      maxAge: 0,
    });
    return res;
  }

  // Für alle nachfolgenden Routen ist Authentifizierung erforderlich
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  // 3. /api/seasons
  if (path === "/seasons") {
    if (user.role !== "SCHIEDSRICHTERWART" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
    }
    const name = String(body.name || "").trim();
    if (!name) {
      return NextResponse.json({ error: "Name ist erforderlich." }, { status: 400 });
    }
    const season = await repo.seasons.create(name);
    if (body.setActive) {
      await repo.seasons.activate(season.id);
      season.is_active = 1;
    }
    return NextResponse.json({ season, id: season.id, ok: true });
  }

  // 4. /api/seasons/:id/activate
  const seasonActivateMatch = path.match(/^\/seasons\/(\d+)\/activate$/);
  if (seasonActivateMatch) {
    if (user.role !== "SCHIEDSRICHTERWART" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
    }
    const targetSeasonId = Number(seasonActivateMatch[1]);
    await repo.seasons.activate(targetSeasonId);
    return NextResponse.json({ ok: true });
  }

  // 5. /api/users
  if (path === "/users") {
    if (user.role !== "SCHIEDSRICHTERWART" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
    }
    const firstName = String(body.first_name || body.firstName || "").trim();
    const lastName = String(body.last_name || body.lastName || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const mobileNumber = body.mobile_number || body.mobileNumber || null;
    const role = String(body.role || "PLAYER").trim();
    const isVolunteerExempt = body.is_volunteer_exempt ?? body.isVolunteerExempt ?? 0;
    const isActiveInList = body.is_active_in_list ?? body.isActiveInList ?? 1;

    if (!firstName || !lastName || !email) {
      return NextResponse.json(
        { error: "Vorname, Nachname und E-Mail erforderlich." },
        { status: 400 }
      );
    }
    const dup = await repo.users.findByEmail(email);
    if (dup) {
      return NextResponse.json(
        { error: "Ein Benutzer mit dieser E-Mail existiert bereits." },
        { status: 400 }
      );
    }
    const defaultPassword = hashPassword("rhtc2026");
    const created = await repo.users.create({
      first_name: firstName,
      last_name: lastName,
      email,
      mobile_number: mobileNumber ? String(mobileNumber).trim() : null,
      password_hash: defaultPassword,
      role,
      is_volunteer_exempt: isVolunteerExempt,
      is_active_in_list: isActiveInList,
    });
    const { password_hash: _, ...safe } = created;
    return NextResponse.json({ user: safe });
  }

  // 6. /api/users/bulk-delete
  if (path === "/users/bulk-delete") {
    if (user.role !== "SCHIEDSRICHTERWART" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
    }
    const ids = Array.isArray(body.ids) ? body.ids.map(Number) : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: "Keine IDs angegeben." }, { status: 400 });
    }
    const filteredIds = ids.filter((id: number) => id !== user.id);
    await repo.users.bulkDelete(filteredIds);
    return NextResponse.json({ ok: true, deletedCount: filteredIds.length });
  }

  // 7. /api/users/import
  if (path === "/users/import") {
    if (user.role !== "SCHIEDSRICHTERWART" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
    }
    const rawRows = Array.isArray(body.rows) ? body.rows : [];
    if (rawRows.length === 0) {
      return NextResponse.json({ error: "Keine Import-Zeilen übergeben." }, { status: 400 });
    }

    const allowedRoles = [
      "PLAYER",
      "SCHIEDSRICHTERWART",
      "KASSENWART",
      "VORSTAND",
      "ADMIN",
    ];

    const allExisting = await repo.users.listAll();
    const existingEmails = new Set(allExisting.map((u) => u.email.toLowerCase()));

    let createdCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i] as Record<string, unknown>;
      const firstName = String(r.firstName || "").trim();
      const lastName = String(r.lastName || "").trim();
      const email = String(r.email || "").trim().toLowerCase();
      const mobileNumber = String(r.mobileNumber || "").trim() || null;
      const password = String(r.password || "rhtc2026").trim() || "rhtc2026";
      const rawRole = String(r.role || "PLAYER").trim().toUpperCase();
      const role = allowedRoles.includes(rawRole) ? rawRole : "PLAYER";
      const isExempt = r.isVolunteerExempt ? 1 : 0;

      if (!firstName || !lastName || !email || !email.includes("@")) {
        skippedCount++;
        errors.push(`Zeile ${i + 1}: Vorname, Nachname oder gültige E-Mail fehlt.`);
        continue;
      }
      if (existingEmails.has(email)) {
        skippedCount++;
        errors.push(`Zeile ${i + 1} (${email}): E-Mail existiert bereits.`);
        continue;
      }

      await repo.users.create({
        first_name: firstName,
        last_name: lastName,
        email,
        mobile_number: mobileNumber,
        password_hash: hashPassword(password),
        role,
        is_active_in_list: 1,
        is_volunteer_exempt: isExempt,
      });
      existingEmails.add(email);
      createdCount++;
    }

    return NextResponse.json({ ok: true, createdCount, skippedCount, errors });
  }

  // 7b. /api/games/import
  if (path === "/games/import") {
    if (user.role !== "SCHIEDSRICHTERWART" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
    }
    const allSeasons = await repo.seasons.listAll();
    const reqSeasonId = body.seasonId ? Number(body.seasonId) : null;
    const season =
      (reqSeasonId ? allSeasons.find((s) => s.id === reqSeasonId) : undefined) ??
      allSeasons.find((s) => s.is_active) ??
      allSeasons[0];

    if (!season) {
      return NextResponse.json({ error: "Keine gültige Saison gefunden." }, { status: 400 });
    }

    const rawRows = Array.isArray(body.rows) ? body.rows : [];
    if (rawRows.length === 0) {
      return NextResponse.json({ error: "Keine Spiel-Zeilen übergeben." }, { status: 400 });
    }

    const randomFirstGame = Boolean(body.randomFirstGame);
    const existingGames = await repo.games.listBySeason(season.id);
    const existingGamesCount = existingGames.length;

    const validRows: Array<{ title: string; kickoffAt: string; location: string }> = [];
    const seenKeys = new Set<string>();
    for (const eg of existingGames) {
      seenKeys.add(`${eg.title.toLowerCase()}|${eg.kickoff_at}`);
    }
    const errors: string[] = [];
    let skippedCount = 0;

    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i] as Record<string, unknown>;
      const title = String(r.title || "").trim();
      const kickoffRaw = String(r.kickoffAt || "").trim();
      const location = String(r.location || "RHTC Halle").trim() || "RHTC Halle";
      const dt = new Date(kickoffRaw);
      if (!title || !kickoffRaw || Number.isNaN(dt.getTime())) {
        skippedCount++;
        errors.push(`Zeile ${i + 1}: Ungültiger Titel oder ungültiges Datum/Uhrzeit.`);
        continue;
      }
      const kickoffAt = dt.toISOString();
      const key = `${title.toLowerCase()}|${kickoffAt}`;
      if (seenKeys.has(key)) {
        skippedCount++;
        continue;
      }
      seenKeys.add(key);
      validRows.push({ title, kickoffAt, location });
    }

    // Chronologisch sortieren für korrekte alphabetische Reihenfolge (§ 3 Abs. 4)
    validRows.sort(
      (a, b) =>
        new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime()
    );

    // Initialisiere Scheduler-Daten einmalig im Speicher für maximale Geschwindigkeit
    const [activePlayers, inMemoryChains] = await Promise.all([
      getSortedActivePlayersAsync(),
      repo.chains.listByGameIds(existingGames.map((g) => g.id)),
    ]);

    let maxRefNum = 0;
    for (const c of inMemoryChains) {
      if (c.ref_code) {
        const m = c.ref_code.match(/^SR-(\d+)$/);
        if (m) {
          const n = Number(m[1]);
          if (n > maxRefNum) maxRefNum = n;
        }
      }
    }

    let createdCount = 0;

    for (let idx = 0; idx < validRows.length; idx++) {
      const item = validRows[idx];
      const isFirst = existingGamesCount === 0 && idx === 0;
      const game = await repo.games.create({
        season_id: season.id,
        title: item.title,
        location: item.location,
        kickoff_at: item.kickoffAt,
        is_first_game_of_season: isFirst ? 1 : 0,
      });

      let ref1Id: number | null = null;
      let ref2Id: number | null = null;
      if (isFirst && randomFirstGame) {
        if (activePlayers.length >= 2) {
          const shuffled = [...activePlayers].sort(() => Math.random() - 0.5);
          ref1Id = shuffled[0].id;
          ref2Id = shuffled[1].id;
        }
      }

      for (const slot of [1, 2]) {
        let chosenId: number | null = slot === 1 ? ref1Id : ref2Id;
        let roundNumber = 1;
        const note = isFirst
          ? "Erste Ansetzung der Saison (CSV-Import / Losverfahren § 3 Abs. 3)"
          : "Saison-Ansetzung alphabetisch (CSV-Import § 3 Abs. 4)";

        if (!chosenId) {
          const next = findNextFreePlayerWithData(activePlayers, inMemoryChains, [], {
            gameIdToAvoidSameGameDouble: game.id,
          });
          chosenId = next.player ? next.player.id : null;
          roundNumber = next.roundNumber;
        }

        maxRefNum++;
        const refCode = `SR-${String(maxRefNum).padStart(3, "0")}`;
        const chain = await repo.chains.create({
          game_id: game.id,
          slot_number: slot,
          ref_code: refCode,
          round_number: roundNumber,
          status: chosenId ? "ASSIGNED" : "UNASSIGNED",
          current_assignee_id: chosenId,
        });
        inMemoryChains.push(chain);

        if (chosenId) {
          await repo.events.create({
            chain_id: chain.id,
            game_id: game.id,
            event_type: "INITIAL_ASSIGNMENT",
            to_user_id: chosenId,
            public_note: note,
          });
        }
      }
      createdCount++;
    }

    return NextResponse.json({ ok: true, createdCount, skippedCount, errors });
  }

  // 8. /api/games
  if (path === "/games") {
    if (user.role !== "SCHIEDSRICHTERWART" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
    }
    const title = String(body.title || "").trim();
    const location = String(body.location || "RHTC Halle").trim();
    const kickoffAt = String(body.kickoff_at || body.kickoffAt || "").trim();
    const isFirst = body.is_first_game_of_season || body.isFirstGameOfSeason ? 1 : 0;
    const seasonId = Number(body.season_id || body.seasonId);

    if (!title || !kickoffAt || !seasonId) {
      return NextResponse.json({ error: "Titel, Anpfiff und Saison-ID erforderlich." }, { status: 400 });
    }
    const game = await repo.games.create({
      season_id: seasonId,
      title,
      location,
      kickoff_at: kickoffAt,
      is_first_game_of_season: isFirst,
    });
    for (let slot = 1; slot <= 2; slot++) {
      const refCode = await getNextSeasonRefCodeAsync(seasonId);
      await repo.chains.create({
        game_id: game.id,
        slot_number: slot,
        ref_code: refCode,
        status: "UNASSIGNED",
      });
    }
    return NextResponse.json({ game });
  }

  // 9. /api/chains/:id/manual-assign
  const manualMatch = path.match(/^\/chains\/(\d+)\/manual-assign$/);
  if (manualMatch) {
    if (user.role !== "SCHIEDSRICHTERWART" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
    }
    const chainId = Number(manualMatch[1]);
    const targetUserId = Number(body.user_id || body.userId);
    const targetUser = await repo.users.findById(targetUserId);
    if (!targetUser) {
      return NextResponse.json({ error: "Spieler nicht gefunden." }, { status: 404 });
    }
    const chain = await repo.chains.findById(chainId);
    if (!chain) {
      return NextResponse.json({ error: "Slot nicht gefunden." }, { status: 404 });
    }
    await repo.chains.update(chainId, {
      current_assignee_id: targetUserId,
      pending_assignee_id: null,
      status: "ASSIGNED",
    });
    await repo.events.create({
      chain_id: chainId,
      game_id: chain.game_id,
      event_type: "INITIAL_ASSIGNMENT",
      from_user_id: user.id,
      to_user_id: targetUserId,
      public_note: `Manuelle Ansetzung durch ${user.first_name} ${user.last_name}`,
    });
    return NextResponse.json({ ok: true });
  }

  // 10. /api/chains/:id/handoff
  const handoffMatch = path.match(/^\/chains\/(\d+)\/handoff$/);
  if (handoffMatch) {
    const chainId = Number(handoffMatch[1]);
    const chain = await repo.chains.findById(chainId);
    if (!chain) {
      return NextResponse.json({ error: "Slot nicht gefunden." }, { status: 404 });
    }
    const isAssignee = chain.current_assignee_id === user.id;
    const isAdmin = user.role === "SCHIEDSRICHTERWART" || user.role === "ADMIN";
    if (!isAssignee && !isAdmin) {
      return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
    }
    const currentAssigneeId = chain.current_assignee_id || user.id;
    const game = (await repo.games.findById(chain.game_id))!;
    const reasonType = String(body.reason_type || "REGULAR");
    const isShortNotice = isShortNotice48h(game.kickoff_at);

    const { player: nextPlayer, roundNumber } = await findNextFreePlayerAsync(game.season_id, {
      excludeUserIds: [currentAssigneeId],
      gameIdToAvoidSameGameDouble: game.id,
      excludeVolunteerExempt: reasonType === "VOLUNTEER_EXEMPT",
    });
    if (!nextPlayer) {
      return NextResponse.json({ error: "Keine freie Person in der Mannschaftsliste gefunden." }, { status: 400 });
    }

    let feeTotal = 1500;
    let teamPot = 500;
    let payoutPool = 1000;
    let paymentStatus = "OPEN";

    if (reasonType === "SQUAD_NOMINATION" || reasonType === "VOLUNTEER_EXEMPT") {
      feeTotal = 0;
      teamPot = 0;
      payoutPool = 0;
      paymentStatus = "NOT_APPLICABLE";
    }

    await repo.chains.update(chainId, {
      pending_assignee_id: nextPlayer.id,
      status: "PENDING_HANDOFF",
      payout_pool_cents: chain.payout_pool_cents + payoutPool,
      team_pot_cents: chain.team_pot_cents + teamPot,
    });

    const event = await repo.events.create({
      chain_id: chainId,
      game_id: game.id,
      event_type: "REGULAR_HANDOFF",
      from_user_id: currentAssigneeId,
      to_user_id: nextPlayer.id,
      reason_type: reasonType,
      is_short_notice: isShortNotice,
      public_note: body.note ? String(body.note).trim() : null,
      fee_total_cents: feeTotal,
      team_pot_cents: teamPot,
      payout_pool_cents: payoutPool,
      payment_status: paymentStatus,
    });

    const fromUser = await repo.users.findById(currentAssigneeId);
    const chatMessage = buildGroupChatMessage({
      type: "REGULAR_HANDOFF",
      gameTitle: game.title,
      kickoffAt: game.kickoff_at,
      slotNumber: chain.slot_number,
      refCode: chain.ref_code,
      fromName: getFullName(fromUser),
      toName: getFullName(nextPlayer),
      isShortNotice,
    });

    return NextResponse.json({ ok: true, event, nextPlayer, chatMessage });
  }

  // 11. /api/chains/:id/handoff-response
  const respMatch = path.match(/^\/chains\/(\d+)\/handoff-response$/);
  if (respMatch) {
    const chainId = Number(respMatch[1]);
    const chain = await repo.chains.findById(chainId);
    if (!chain) {
      return NextResponse.json({ error: "Slot nicht gefunden." }, { status: 404 });
    }
    const isPending = chain.pending_assignee_id === user.id;
    const isAdmin = user.role === "SCHIEDSRICHTERWART" || user.role === "ADMIN";
    if (!isPending && !isAdmin) {
      return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
    }
    const action = String(body.action || "").toUpperCase();
    const game = (await repo.games.findById(chain.game_id))!;
    const respondingUserId = chain.pending_assignee_id || user.id;

    if (action === "ACCEPT") {
      await repo.chains.update(chainId, {
        current_assignee_id: respondingUserId,
        pending_assignee_id: null,
        status: "ASSIGNED",
      });
      await repo.events.create({
        chain_id: chainId,
        game_id: game.id,
        event_type: "HANDOFF_ACCEPTED",
        from_user_id: chain.current_assignee_id,
        to_user_id: respondingUserId,
        public_note: "Weitergabe akzeptiert.",
      });
      const toUser = await repo.users.findById(respondingUserId);
      const chatMessage = buildGroupChatMessage({
        type: "HANDOFF_ACCEPTED",
        gameTitle: game.title,
        kickoffAt: game.kickoff_at,
        slotNumber: chain.slot_number,
        refCode: chain.ref_code,
        toName: getFullName(toUser),
      });
      return NextResponse.json({ ok: true, status: "ASSIGNED", chatMessage });
    } else if (action === "DECLINE") {
      await repo.events.create({
        chain_id: chainId,
        game_id: game.id,
        event_type: "HANDOFF_SKIPPED_UNAVAILABLE",
        from_user_id: respondingUserId,
        to_user_id: null,
        public_note: body.reason ? String(body.reason).trim() : "Verhindert.",
      });
      const { player: nextPlayer } = await findNextFreePlayerAsync(game.season_id, {
        excludeUserIds: [chain.current_assignee_id!, respondingUserId],
        gameIdToAvoidSameGameDouble: game.id,
      });
      if (nextPlayer) {
        await repo.chains.update(chainId, {
          pending_assignee_id: nextPlayer.id,
          status: "PENDING_HANDOFF",
        });
      } else {
        await repo.chains.update(chainId, {
          pending_assignee_id: null,
          status: "ASSIGNED",
        });
      }
      const skippedUser = await repo.users.findById(respondingUserId);
      const chatMessage = buildGroupChatMessage({
        type: "HANDOFF_SKIPPED",
        gameTitle: game.title,
        kickoffAt: game.kickoff_at,
        slotNumber: chain.slot_number,
        refCode: chain.ref_code,
        fromName: getFullName(skippedUser),
        toName: nextPlayer ? getFullName(nextPlayer) : "offen (keine freie Person)",
      });
      return NextResponse.json({ ok: true, nextPlayer, chatMessage });
    }
    return NextResponse.json({ error: "Ungültige Aktion." }, { status: 400 });
  }

  // 12. /api/chains/:id/volunteer
  const volReqMatch = path.match(/^\/chains\/(\d+)\/volunteer$/);
  if (volReqMatch) {
    const chainId = Number(volReqMatch[1]);
    const chain = await repo.chains.findById(chainId);
    if (!chain) {
      return NextResponse.json({ error: "Slot nicht gefunden." }, { status: 404 });
    }
    if (chain.current_assignee_id === user.id) {
      return NextResponse.json({ error: "Du bist für dieses Spiel bereits angesetzt." }, { status: 400 });
    }
    await repo.chains.update(chainId, {
      voluntary_requester_id: user.id,
      status: "VOLUNTARY_REQUESTED",
    });
    await repo.events.create({
      chain_id: chainId,
      game_id: chain.game_id,
      event_type: "VOLUNTEER_REQUEST",
      from_user_id: chain.current_assignee_id,
      to_user_id: user.id,
      public_note: `Freiwillige Übernahme angefragt durch ${user.first_name} ${user.last_name}`,
    });
    const game = (await repo.games.findById(chain.game_id))!;
    const fromUser = await repo.users.findById(chain.current_assignee_id!);
    const chatMessage = buildGroupChatMessage({
      type: "VOLUNTARY_REQUEST",
      gameTitle: game.title,
      kickoffAt: game.kickoff_at,
      slotNumber: chain.slot_number,
      refCode: chain.ref_code,
      fromName: getFullName(fromUser),
      toName: `${user.first_name} ${user.last_name}`,
    });
    return NextResponse.json({ ok: true, chatMessage });
  }

  // 13. /api/chains/:id/volunteer-decision
  const volDecMatch = path.match(/^\/chains\/(\d+)\/volunteer-decision$/);
  if (volDecMatch) {
    const chainId = Number(volDecMatch[1]);
    const chain = await repo.chains.findById(chainId);
    if (!chain) {
      return NextResponse.json({ error: "Slot nicht gefunden." }, { status: 404 });
    }
    const isAssignee = chain.current_assignee_id === user.id;
    const isAdmin = user.role === "SCHIEDSRICHTERWART" || user.role === "ADMIN";
    if (!isAssignee && !isAdmin) {
      return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
    }
    const approved = Boolean(body.approved);
    const volunteerId = chain.voluntary_requester_id;
    if (!volunteerId) {
      return NextResponse.json({ error: "Keine freiwillige Anfrage vorhanden." }, { status: 400 });
    }
    const game = (await repo.games.findById(chain.game_id))!;
    const volunteer = await repo.users.findById(volunteerId);

    if (approved) {
      await repo.chains.update(chainId, {
        current_assignee_id: volunteerId,
        voluntary_requester_id: null,
        status: "ASSIGNED",
      });
      await repo.events.create({
        chain_id: chainId,
        game_id: game.id,
        event_type: "VOLUNTEER_APPROVED",
        from_user_id: chain.current_assignee_id,
        to_user_id: volunteerId,
        public_note: "Freiwillige Übernahme bestätigt.",
      });

      // Spätere Ansetzung des Freiwilligen suchen & automatisch kostenlos weitergeben (§ 5 Abs. 5)
      const allSeasonGames = await repo.games.listBySeason(game.season_id);
      const futureGameIds = allSeasonGames
        .filter((g) => new Date(g.kickoff_at).getTime() > new Date(game.kickoff_at).getTime())
        .map((g) => g.id);

      let laterGameTitle = "";
      let laterToName = "";
      if (futureGameIds.length > 0) {
        const futureChains = await repo.chains.listByGameIds(futureGameIds);
        const laterChain = futureChains.find(
          (c) => c.current_assignee_id === volunteerId && c.status !== "CONFIRMED_DEPLOYED"
        );
        if (laterChain) {
          const laterGame = allSeasonGames.find((g) => g.id === laterChain.game_id)!;
          const { player: nextFree } = await findNextFreePlayerAsync(game.season_id, {
            excludeUserIds: [volunteerId],
            gameIdToAvoidSameGameDouble: laterGame.id,
          });
          if (nextFree) {
            await repo.chains.update(laterChain.id, {
              current_assignee_id: nextFree.id,
              pending_assignee_id: null,
              status: "ASSIGNED",
            });
            await repo.events.create({
              chain_id: laterChain.id,
              game_id: laterGame.id,
              event_type: "VOLUNTEER_AUTO_FORWARD",
              from_user_id: volunteerId,
              to_user_id: nextFree.id,
              public_note: "Kostenlose Weitergabe wegen vorgezogener Übernahme (§ 5 Abs. 5)",
            });
            laterGameTitle = laterGame.title;
            laterToName = getFullName(nextFree);
          }
        }
      }

      const fromUser = await repo.users.findById(chain.current_assignee_id!);
      const chatMessage = buildGroupChatMessage({
        type: "VOLUNTARY_APPROVED",
        gameTitle: game.title,
        kickoffAt: game.kickoff_at,
        slotNumber: chain.slot_number,
        refCode: chain.ref_code,
        fromName: getFullName(fromUser),
        toName: getFullName(volunteer),
        payoutPoolCents: chain.payout_pool_cents,
        laterGameTitle,
        laterToName,
      });
      return NextResponse.json({ ok: true, chatMessage });
    } else {
      await repo.chains.update(chainId, {
        voluntary_requester_id: null,
        status: "ASSIGNED",
      });
      await repo.events.create({
        chain_id: chainId,
        game_id: game.id,
        event_type: "VOLUNTEER_REJECTED",
        from_user_id: chain.current_assignee_id,
        to_user_id: volunteerId,
        public_note: "Freiwillige Übernahme abgelehnt.",
      });
      return NextResponse.json({ ok: true, status: "REJECTED" });
    }
  }

  // 14. /api/chains/:id/report-deployed
  const repMatch = path.match(/^\/chains\/(\d+)\/report-deployed$/);
  if (repMatch) {
    const chainId = Number(repMatch[1]);
    const chain = await repo.chains.findById(chainId);
    if (!chain) {
      return NextResponse.json({ error: "Slot nicht gefunden." }, { status: 404 });
    }
    const isAssignee = chain.current_assignee_id === user.id;
    const isAdmin = user.role === "SCHIEDSRICHTERWART" || user.role === "ADMIN";
    if (!isAssignee && !isAdmin) {
      return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
    }
    const now = new Date().toISOString();
    await repo.chains.update(chainId, {
      status: "REPORTED_DEPLOYED",
      reported_deployed_at: now,
    });
    await repo.events.create({
      chain_id: chainId,
      game_id: chain.game_id,
      event_type: "REPORTED_DEPLOYED",
      from_user_id: chain.current_assignee_id,
      to_user_id: null,
      public_note: `Einsatz gemeldet durch ${user.first_name} ${user.last_name}`,
    });
    const game = (await repo.games.findById(chain.game_id))!;
    const assignee = await repo.users.findById(chain.current_assignee_id!);
    const chatMessage = buildGroupChatMessage({
      type: "REPORTED_DEPLOYED",
      gameTitle: game.title,
      kickoffAt: game.kickoff_at,
      slotNumber: chain.slot_number,
      refCode: chain.ref_code,
      fromName: getFullName(assignee),
    });
    return NextResponse.json({ ok: true, chatMessage });
  }

  // 15. /api/chains/:id/confirm-deployed
  const confMatch = path.match(/^\/chains\/(\d+)\/confirm-deployed$/);
  if (confMatch) {
    if (user.role !== "SCHIEDSRICHTERWART" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
    }
    const chainId = Number(confMatch[1]);
    const chain = await repo.chains.findById(chainId);
    if (!chain) {
      return NextResponse.json({ error: "Slot nicht gefunden." }, { status: 404 });
    }
    const now = new Date().toISOString();
    await repo.chains.update(chainId, {
      status: "CONFIRMED_DEPLOYED",
      confirmed_deployed_at: now,
      confirmed_by_id: user.id,
    });
    await repo.events.create({
      chain_id: chainId,
      game_id: chain.game_id,
      event_type: "CONFIRMED_DEPLOYED",
      from_user_id: chain.current_assignee_id,
      to_user_id: user.id,
      public_note: `Offiziell bestätigt durch Schiedsrichterwart ${user.first_name} ${user.last_name}`,
    });
    const game = (await repo.games.findById(chain.game_id))!;
    const assignee = await repo.users.findById(chain.current_assignee_id!);
    const chatMessage = buildGroupChatMessage({
      type: "CONFIRMED_DEPLOYED",
      gameTitle: game.title,
      kickoffAt: game.kickoff_at,
      slotNumber: chain.slot_number,
      refCode: chain.ref_code,
      fromName: getFullName(assignee),
    });
    return NextResponse.json({ ok: true, chatMessage });
  }

  // 16. /api/events/:id/payment
  const payMatch = path.match(/^\/events\/(\d+)\/payment$/);
  if (payMatch) {
    if (user.role !== "KASSENWART" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
    }
    const eventId = Number(payMatch[1]);
    const status = String(body.status || "PAID");
    await repo.events.update(eventId, { payment_status: status });
    return NextResponse.json({ ok: true });
  }

  // 17. /api/events/:id/hardship
  const hardMatch = path.match(/^\/events\/(\d+)\/hardship$/);
  if (hardMatch) {
    const eventId = Number(hardMatch[1]);
    const event = await repo.events.findById(eventId);
    if (!event) {
      return NextResponse.json({ error: "Vorgang nicht gefunden." }, { status: 404 });
    }
    if (body.apply) {
      // Spieler stellt Härtefallantrag
      if (event.from_user_id !== user.id && user.role !== "ADMIN") {
        return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
      }
      const reason = String(body.reason || "").trim();
      await repo.events.update(eventId, {
        hardship_status: "PENDING",
        hardship_reason_confidential: reason,
      });
      return NextResponse.json({ ok: true, status: "PENDING" });
    } else {
      // Kassenwart entscheidet
      if (user.role !== "KASSENWART" && user.role !== "ADMIN") {
        return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
      }
      const decision = String(body.decision || "APPROVED_FULL");
      const waivedCents = Number(body.waived_amount_cents || (decision === "APPROVED_FULL" ? 1500 : 0));
      const newPaymentStatus = decision === "APPROVED_FULL" ? "WAIVED_FULL" : "OPEN";
      await repo.events.update(eventId, {
        hardship_status: decision,
        waived_amount_cents: waivedCents,
        payment_status: newPaymentStatus,
      });
      return NextResponse.json({ ok: true, decision });
    }
  }

  // 18. /api/chains/:id/settle-payout
  const settleMatch = path.match(/^\/chains\/(\d+)\/settle-payout$/);
  if (settleMatch) {
    if (user.role !== "KASSENWART" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
    }
    const chainId = Number(settleMatch[1]);
    const chain = await repo.chains.findById(chainId);
    if (!chain) {
      return NextResponse.json({ error: "Slot nicht gefunden." }, { status: 404 });
    }
    await repo.chains.update(chainId, { payout_settled: 1 });
    await repo.events.create({
      chain_id: chainId,
      game_id: chain.game_id,
      event_type: "PAYOUT_SETTLED",
      from_user_id: user.id,
      to_user_id: chain.current_assignee_id,
      public_note: `Pott-Auszahlung von ${chain.payout_pool_cents / 100} € als erledigt markiert`,
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Route nicht gefunden." }, { status: 404 });
  } catch (err: any) {
    console.error("POST error:", err);
    return NextResponse.json({ error: err.message || "Anfrage fehlgeschlagen" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH Handlers
// ---------------------------------------------------------------------------
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  try {
    const { slug } = await params;
  const path = "/" + slug.join("/");
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));

  // 1. /api/auth/profile
  if (path === "/auth/profile") {
    const existing = await repo.users.findById(user.id);
    if (!existing) {
      return NextResponse.json({ error: "Benutzer nicht gefunden." }, { status: 404 });
    }
    const email = body.email !== undefined ? String(body.email).trim().toLowerCase() : existing.email;
    const mobileNumber = body.mobileNumber !== undefined ? String(body.mobileNumber).trim() || null : existing.mobile_number;

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Bitte eine gültige E-Mail-Adresse angeben." }, { status: 400 });
    }
    if (email !== existing.email) {
      const dup = await repo.users.findByEmail(email);
      if (dup && dup.id !== user.id) {
        return NextResponse.json({ error: "Diese E-Mail-Adresse wird bereits verwendet." }, { status: 400 });
      }
    }
    const newPasswordHash = body.password && String(body.password).trim().length > 0
      ? hashPassword(String(body.password).trim())
      : existing.password_hash;

    await repo.users.update(user.id, {
      email,
      mobile_number: mobileNumber,
      password_hash: newPasswordHash,
    });
    invalidateUserSessionCache(user.id);
    return NextResponse.json({ ok: true });
  }

  // 2. /api/seasons/:id
  const seasonEditMatch = path.match(/^\/seasons\/(\d+)$/);
  if (seasonEditMatch) {
    if (user.role !== "SCHIEDSRICHTERWART" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
    }
    const targetSeasonId = Number(seasonEditMatch[1]);
    const name = String(body.name || "").trim();
    if (!name) {
      return NextResponse.json({ error: "Name ist erforderlich." }, { status: 400 });
    }
    await repo.seasons.update(targetSeasonId, name);
    return NextResponse.json({ ok: true });
  }

  // 3. /api/users/:id
  const userMatch = path.match(/^\/users\/(\d+)$/);
  if (userMatch) {
    if (user.role !== "SCHIEDSRICHTERWART" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
    }
    const targetId = Number(userMatch[1]);
    const updates: Record<string, any> = {};
    if (body.role !== undefined) updates.role = String(body.role);
    if (body.is_active_in_list !== undefined) updates.is_active_in_list = body.is_active_in_list ? 1 : 0;
    if (body.is_volunteer_exempt !== undefined) updates.is_volunteer_exempt = body.is_volunteer_exempt ? 1 : 0;
    if (body.list_order_override !== undefined) updates.list_order_override = body.list_order_override;
    if (body.mobile_number !== undefined) updates.mobile_number = String(body.mobile_number).trim() || null;

    await repo.users.update(targetId, updates);
    invalidateUserSessionCache(targetId);
    return NextResponse.json({ ok: true });
  }

  // 4. /api/games/:id
  const gameMatch = path.match(/^\/games\/(\d+)$/);
  if (gameMatch) {
    if (user.role !== "SCHIEDSRICHTERWART" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
    }
    const gameId = Number(gameMatch[1]);
    const updates: Record<string, any> = {};
    if (body.title !== undefined) updates.title = String(body.title).trim();
    if (body.location !== undefined) updates.location = String(body.location).trim();
    if (body.kickoff_at !== undefined) updates.kickoff_at = String(body.kickoff_at).trim();
    if (body.is_first_game_of_season !== undefined) {
      updates.is_first_game_of_season = body.is_first_game_of_season ? 1 : 0;
    }
    await repo.games.update(gameId, updates);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Route nicht gefunden." }, { status: 404 });
  } catch (err: any) {
    console.error("PATCH error:", err);
    return NextResponse.json({ error: err.message || "Anfrage fehlgeschlagen" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE Handlers
// ---------------------------------------------------------------------------
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  try {
    const { slug } = await params;
  const path = "/" + slug.join("/");
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  const gameMatch = path.match(/^\/games\/(\d+)$/);
  if (gameMatch) {
    if (user.role !== "SCHIEDSRICHTERWART" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
    }
    const gameId = Number(gameMatch[1]);
    await repo.games.delete(gameId);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Route nicht gefunden." }, { status: 404 });
  } catch (err: any) {
    console.error("DELETE error:", err);
    return NextResponse.json({ error: err.message || "Anfrage fehlgeschlagen" }, { status: 500 });
  }
}
