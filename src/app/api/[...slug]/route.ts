import fs from "node:fs";
import nodePath from "node:path";
import { NextResponse } from "next/server";
import { repo } from "@/lib/repository";
import {
  createCalendarToken,
  createSessionToken,
  getSessionUserFromHeader,
  hashPassword,
  invalidateUserSessionCache,
  makeClearCookieHeader,
  makeSessionCookieHeader,
  verifyCalendarToken,
  verifyPassword,
} from "@/lib/auth";
import { generateIcalCalendar } from "@/lib/calendar";
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

function isGenuineWaiver(ev: EventRow): boolean {
  return (
    ev.hardship_status === "APPROVED_FULL" ||
    ev.hardship_status === "APPROVED_PARTIAL" ||
    ev.payment_status === "WAIVED_FULL" ||
    ev.payment_status === "WAIVED_PARTIAL"
  );
}

function normalizeEventAmounts(
  ev: EventRow,
  creditOffsets: Record<string, number>
): { actualWaivedCents: number; creditOffsetCents: number } {
  const genuineWaived = isGenuineWaiver(ev) ? (ev.waived_amount_cents || 0) : 0;
  // Rückwärtskompatibilität: Ältere Teilverrechnungen hatten waived_amount_cents ohne Härtefall gesetzt
  const legacyOffset =
    !isGenuineWaiver(ev) && (ev.waived_amount_cents || 0) > 0
      ? ev.waived_amount_cents || 0
      : 0;
  const storedOffset = Number(creditOffsets[String(ev.id)] ?? creditOffsets[ev.id] ?? 0) || 0;
  const creditOffsetCents = Math.max(storedOffset, legacyOffset);
  return { actualWaivedCents: genuineWaived, creditOffsetCents };
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

  // 1a. /api/satzung (Dynamisch aus satzung_schiri.md geladen, für alle angemeldeten Nutzer)
  if (path === "/satzung") {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    }
    try {
      const mdPath = nodePath.join(process.cwd(), "satzung_schiri.md");
      const [markdown, stat] = await Promise.all([
        fs.promises.readFile(mdPath, "utf8"),
        fs.promises.stat(mdPath),
      ]);
      return NextResponse.json(
        {
          markdown,
          updatedAt: stat.mtime.toISOString(),
          sourceFile: "satzung_schiri.md",
        },
        {
          headers: {
            "Cache-Control": "no-store, max-age=0",
          },
        }
      );
    } catch {
      return NextResponse.json(
        { error: "Die Datei satzung_schiri.md konnte nicht gelesen werden." },
        { status: 404 }
      );
    }
  }

  // 1b. /api/calendar/feed/:token (oder :token.ics)
  const calFeedMatch = path.match(/^\/calendar\/feed\/([^/]+?)(\.ics)?$/);
  if (calFeedMatch) {
    const rawToken = calFeedMatch[1];
    const token = rawToken.replace(/\.ics$/, "");
    const targetUserId = verifyCalendarToken(token);
    if (!targetUserId) {
      return new NextResponse("Ungültiger oder abgelaufener Kalender-Token.", {
        status: 401,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    const targetUser = await repo.users.findById(targetUserId);
    if (!targetUser) {
      return new NextResponse("Benutzer nicht gefunden.", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const allSeasons = await repo.seasons.listAll();
    const activeSeason = allSeasons.find((s) => s.is_active) || allSeasons[0];
    const seasonGames = activeSeason ? await repo.games.listBySeason(activeSeason.id) : [];
    const gameIds = seasonGames.map((g) => g.id);

    const allChains = gameIds.length > 0 ? await repo.chains.listByGameIds(gameIds) : [];
    const allUsers = await repo.users.listAll();
    const userMap = new Map(allUsers.map((u) => [u.id, u]));

    const myChains = allChains.filter(
      (c) => c.current_assignee_id === targetUserId || c.pending_assignee_id === targetUserId
    );

    const items = myChains
      .map((c) => {
        const game = seasonGames.find((g) => g.id === c.game_id)!;
        const partnerChain = allChains.find(
          (other) => other.game_id === c.game_id && other.id !== c.id
        );
        const partnerId = partnerChain?.current_assignee_id || partnerChain?.pending_assignee_id;
        const partner = partnerId ? userMap.get(partnerId) : null;
        return { game, chain: c, partner };
      })
      .filter((item) => Boolean(item.game));

    const icsContent = generateIcalCalendar(items, targetUser);
    return new NextResponse(icsContent, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `inline; filename="rhtc-schiri-${targetUserId}.ics"`,
        "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
      },
    });
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
    const seasonParam = url.searchParams.get("seasonId");
    const isAllTime = seasonParam === "all";
    const reqSeasonId = seasonParam && !isAllTime ? Number(seasonParam) : null;
    const season = isAllTime
      ? { id: "all", name: "Ewige Tabelle (Alle Saisons)", is_active: 0 } as any
      : (reqSeasonId ? allSeasons.find((s) => s.id === reqSeasonId) : undefined) ??
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

    const targetSeasonKey = isAllTime ? "all" : String(season.id);
    const [seasonGames, rawOverrides, rawStatsOverrides, rawCreditOffsets, treasuryIban, treasuryRecipient, treasuryPaypal] = await Promise.all([
      isAllTime ? repo.games.listAll() : repo.games.listBySeason(Number(season.id)),
      repo.settings.get("deployed_count_overrides"),
      repo.settings.get("player_stats_overrides"),
      repo.settings.get("event_credit_offsets"),
      repo.settings.get("treasury_iban"),
      repo.settings.get("treasury_recipient"),
      repo.settings.get("treasury_paypal"),
    ]);

    let creditOffsets: Record<string, number> = {};
    if (rawCreditOffsets) {
      try {
        creditOffsets = JSON.parse(rawCreditOffsets);
      } catch {}
    }

    // Deployed overrides: unterstützt saisonspezifisch { [seasonId]: { [userId]: number } } mit Fallback auf flaches Format { [userId]: number }
    let deployedOverrides: Record<string, number> = {};
    if (rawOverrides) {
      try {
        const parsed = JSON.parse(rawOverrides);
        if (parsed[targetSeasonKey] && typeof parsed[targetSeasonKey] === "object") {
          deployedOverrides = parsed[targetSeasonKey];
        } else if (!isAllTime) {
          deployedOverrides = parsed;
        }
      } catch {}
    }

    // Stats overrides: unterstützt saisonspezifisch { [seasonId]: { [userId]: { earnedPayoutCents?: number, takeoverCount?: number, handoffCount?: number } } }
    // mit Fallback auf flaches Format
    let statsOverrides: Record<string, { earnedPayoutCents?: number; takeoverCount?: number; handoffCount?: number }> = {};
    if (rawStatsOverrides) {
      try {
        const parsed = JSON.parse(rawStatsOverrides);
        if (parsed[targetSeasonKey] && typeof parsed[targetSeasonKey] === "object") {
          statsOverrides = parsed[targetSeasonKey];
        } else if (!isAllTime) {
          statsOverrides = parsed;
        }
      } catch {}
    }
    const gameIds = seasonGames.map((g) => g.id);
    const [chains, events] = await Promise.all([
      repo.chains.listByGameIds(gameIds),
      repo.events.listByGameIds(gameIds),
    ]);

    const isTreasurer = user.role === "KASSENWART";
    const sanitizedEvents = events.map((ev) => {
      const { actualWaivedCents, creditOffsetCents } = normalizeEventAmounts(ev, creditOffsets);
      return {
        ...ev,
        waived_amount_cents: actualWaivedCents,
        credit_offset_cents: creditOffsetCents,
        fromUser: ev.from_user_id ? userMap.get(ev.from_user_id) ?? null : null,
        toUser: ev.to_user_id ? userMap.get(ev.to_user_id) ?? null : null,
        hardship_reason_confidential: isTreasurer
          ? ev.hardship_reason_confidential
          : null,
      };
    });

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
      const calculatedDeployed = chains.filter(
        (c) =>
          c.current_assignee_id === p.id && c.status === "CONFIRMED_DEPLOYED"
      ).length;
      const ov = deployedOverrides[String(p.id)] ?? deployedOverrides[p.id];
      const hasOverride = ov !== undefined && ov !== null;
      const deployedCount = hasOverride ? Number(ov) : calculatedDeployed;
      const pEvents = sanitizedEvents.filter((e) => e.from_user_id === p.id);
      const openPaymentCents = pEvents
        .filter((e) => e.payment_status === "OPEN")
        .reduce(
          (acc, e) =>
            acc + Math.max(0, e.fee_total_cents - e.waived_amount_cents - (e.credit_offset_cents || 0)),
          0
        );
      const paidCents = pEvents.reduce((acc, e) => {
        const netFee = Math.max(0, e.fee_total_cents - e.waived_amount_cents);
        if (e.payment_status === "PAID") return acc + netFee;
        if (e.payment_status === "OPEN" && (e.credit_offset_cents || 0) > 0) {
          return acc + Math.min(netFee, e.credit_offset_cents || 0);
        }
        return acc;
      }, 0);

      const calculatedEarnedPayoutCents = chains
        .filter(
          (c) =>
            c.current_assignee_id === p.id &&
            (c.status === "CONFIRMED_DEPLOYED" || Boolean(c.payout_settled)) &&
            c.payout_pool_cents > 0
        )
        .reduce((acc, c) => acc + c.payout_pool_cents, 0);

      const calculatedTakeoverCount = sanitizedEvents.filter(
        (e) =>
          e.to_user_id === p.id &&
          (e.event_type === "HANDOFF_ACCEPTED" || e.event_type === "VOLUNTEER_APPROVED") &&
          e.from_user_id !== p.id
      ).length;

      const calculatedHandoffCount = sanitizedEvents.filter(
        (e) =>
          e.from_user_id === p.id &&
          ["REGULAR_HANDOFF", "HARDSHIP", "VOLUNTEER_EXEMPT", "SQUAD_NOMINATION", "VOLUNTEER_AUTO_FORWARD"].includes(e.event_type)
      ).length;

      const pStatsOv = statsOverrides[String(p.id)] ?? statsOverrides[p.id];
      const hasEarnedOverride = pStatsOv?.earnedPayoutCents !== undefined && pStatsOv?.earnedPayoutCents !== null;
      const hasTakeoverOverride = pStatsOv?.takeoverCount !== undefined && pStatsOv?.takeoverCount !== null;
      const hasHandoffOverride = pStatsOv?.handoffCount !== undefined && pStatsOv?.handoffCount !== null;

      const earnedPayoutCents = hasEarnedOverride ? Number(pStatsOv.earnedPayoutCents) : calculatedEarnedPayoutCents;
      const takeoverCount = hasTakeoverOverride ? Number(pStatsOv.takeoverCount) : calculatedTakeoverCount;
      const handoffCount = hasHandoffOverride ? Number(pStatsOv.handoffCount) : calculatedHandoffCount;

      return {
        ...p,
        activeAssigned,
        deployedCount,
        isDeployedOverridden: hasOverride,
        openPaymentCents,
        paidCents,
        earnedPayoutCents,
        isEarnedOverridden: hasEarnedOverride,
        takeoverCount,
        isTakeoverOverridden: hasTakeoverOverride,
        handoffCount,
        isHandoffOverridden: hasHandoffOverride,
      };
    });

    const totalTeamPotCents = events.reduce(
      (acc, e) => acc + (e.team_pot_cents || 0),
      0
    );
    const totalOpenPaymentsCents = sanitizedEvents
      .filter((e) => e.payment_status === "OPEN")
      .reduce(
        (acc, e) =>
          acc + Math.max(0, e.fee_total_cents - e.waived_amount_cents - (e.credit_offset_cents || 0)),
        0
      );
    const totalPaidCents = sanitizedEvents.reduce((acc, e) => {
      const netFee = Math.max(0, e.fee_total_cents - e.waived_amount_cents);
      if (e.payment_status === "PAID") return acc + netFee;
      if (e.payment_status === "OPEN" && (e.credit_offset_cents || 0) > 0) {
        return acc + Math.min(netFee, e.credit_offset_cents || 0);
      }
      return acc;
    }, 0);
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
      treasurySettings: {
        iban: treasuryIban || "",
        recipient: treasuryRecipient || "RHTC 2. Herren Kasse",
        paypal: treasuryPaypal || "",
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
    const iban = body.iban !== undefined ? String(body.iban).trim() || null : null;
    const paypal = body.paypal !== undefined ? String(body.paypal).trim() || null : null;
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
      iban,
      paypal,
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
      const iban = String(r.iban || "").trim() || null;
      const paypal = String(r.paypal || "").trim() || null;
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
        iban,
        paypal,
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
    const shouldAssign = body.assignPlayers !== undefined ? Boolean(body.assignPlayers) : true;
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
    const [activePlayers, inMemoryChains, rawOverrides] = await Promise.all([
      getSortedActivePlayersAsync(),
      repo.chains.listByGameIds(existingGames.map((g) => g.id)),
      repo.settings.get("deployed_count_overrides"),
    ]);
    let deployedOverrides: Record<string, number> = {};
    if (rawOverrides) {
      try {
        deployedOverrides = JSON.parse(rawOverrides);
      } catch {}
    }

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
      if (shouldAssign) {
        if (isFirst && randomFirstGame) {
          if (activePlayers.length >= 2) {
            const shuffled = [...activePlayers].sort(() => Math.random() - 0.5);
            ref1Id = shuffled[0].id;
            ref2Id = shuffled[1].id;
          }
        }
      }

      for (const slot of [1, 2]) {
        let chosenId: number | null = shouldAssign ? (slot === 1 ? ref1Id : ref2Id) : null;
        let roundNumber = 1;
        const note = isFirst
          ? "Erste Ansetzung der Saison (CSV-Import / Losverfahren § 3 Abs. 3)"
          : "Saison-Ansetzung alphabetisch (CSV-Import § 3 Abs. 4)";

        if (shouldAssign && !chosenId) {
          const next = findNextFreePlayerWithData(activePlayers, inMemoryChains, [], {
            gameIdToAvoidSameGameDouble: game.id,
            deployedOverrides,
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
    const assignPlayers = body.assignPlayers !== undefined ? Boolean(body.assignPlayers) : true;
    const randomDraw = Boolean(body.randomDraw);
    let ref1Id = body.ref1Id ? Number(body.ref1Id) : null;
    let ref2Id = body.ref2Id ? Number(body.ref2Id) : null;

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

    const activePlayers = assignPlayers ? await getSortedActivePlayersAsync() : [];
    if (assignPlayers && isFirst && randomDraw && (!ref1Id || !ref2Id)) {
      if (activePlayers.length >= 2) {
        const shuffled = [...activePlayers].sort(() => Math.random() - 0.5);
        if (!ref1Id) ref1Id = shuffled[0].id;
        if (!ref2Id) ref2Id = shuffled[1].id;
      }
    }

    const existingSeasonGames = assignPlayers ? await repo.games.listBySeason(seasonId) : [];
    const inMemoryChains = assignPlayers ? await repo.chains.listByGameIds(existingSeasonGames.map((g) => g.id)) : [];
    const rawOverrides = assignPlayers ? await repo.settings.get("deployed_count_overrides") : null;
    let deployedOverrides: Record<string, number> = {};
    if (rawOverrides) {
      try {
        deployedOverrides = JSON.parse(rawOverrides);
      } catch {}
    }

    for (let slot = 1; slot <= 2; slot++) {
      let chosenId: number | null = assignPlayers ? (slot === 1 ? ref1Id : ref2Id) : null;
      let roundNumber = 1;
      const note = isFirst
        ? "Erste Ansetzung der Saison (§ 3 Abs. 3)"
        : "Saison-Ansetzung alphabetisch (§ 3 Abs. 4)";

      if (assignPlayers && !chosenId) {
        const next = findNextFreePlayerWithData(activePlayers, inMemoryChains, [], {
          gameIdToAvoidSameGameDouble: game.id,
          deployedOverrides,
        });
        chosenId = next.player ? next.player.id : null;
        roundNumber = next.roundNumber;
      }

      const refCode = await getNextSeasonRefCodeAsync(seasonId);
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
    const isPendingMode = chain.status === "PENDING_HANDOFF";
    const responsibleUserId = isPendingMode
      ? chain.pending_assignee_id
      : chain.current_assignee_id;
    const isAuthorized =
      responsibleUserId === user.id ||
      user.role === "SCHIEDSRICHTERWART" ||
      user.role === "ADMIN";
    if (!isAuthorized) {
      return NextResponse.json(
        { error: "Nur die aktuell angesetzte/vorgeschlagene Person oder der Schiedsrichterwart darf weitergeben." },
        { status: 403 }
      );
    }
    const currentAssigneeId = responsibleUserId || user.id;
    const fromUser = (await repo.users.findById(currentAssigneeId)) || user;
    const game = (await repo.games.findById(chain.game_id))!;
    const reasonType = String(body.reasonType || body.reason_type || "REGULAR");
    const publicNote = String(body.publicNote || body.note || "").trim();
    const hardshipReasonConfidential = String(
      body.hardshipReasonConfidential || body.hardship_reason_confidential || ""
    ).trim();

    if (reasonType === "VOLUNTEER_EXEMPT" && !fromUser.is_volunteer_exempt) {
      return NextResponse.json({
        error: "Ehrenamtliche Befreiung (§ 7) erfordert die Freigabe durch den Vorstand im Spielerprofil.",
      }, { status: 400 });
    }
    if (reasonType === "HARDSHIP" && !hardshipReasonConfidential) {
      return NextResponse.json({
        error: "Für einen Härtefallantrag (§ 8) ist eine vertrauliche Begründung für den Kassenwart erforderlich.",
      }, { status: 400 });
    }

    const isShortNotice = isShortNotice48h(game.kickoff_at);
    if (isShortNotice && reasonType === "REGULAR" && !publicNote) {
      return NextResponse.json({
        error: "Kurzfristige Verhinderung (< 48h nach § 4 Abs. 2): Bitte kurzen Verhinderungsgrund angeben.",
      }, { status: 400 });
    }

    const previousEvents = await repo.events.listByChainId(chainId);
    const previousFromIds = previousEvents
      .map((e) => e.from_user_id)
      .filter((id): id is number => id !== null && id !== undefined);
    const excludeIds = [fromUser.id, ...previousFromIds];

    let nextPlayer: SafeUser | null = null;
    const targetUserId = body.targetUserId || body.target_user_id ? Number(body.targetUserId || body.target_user_id) : null;

    if (targetUserId && (user.role === "SCHIEDSRICHTERWART" || user.role === "ADMIN")) {
      const explicitTarget = await repo.users.findById(targetUserId);
      if (!explicitTarget) {
        return NextResponse.json({ error: "Ausgewählter Spieler nicht gefunden." }, { status: 404 });
      }
      nextPlayer = explicitTarget;
    } else {
      const res1 = await findNextFreePlayerAsync(game.season_id, {
        excludeUserIds: excludeIds,
        gameIdToAvoidSameGameDouble: game.id,
        excludeVolunteerExempt: true,
        restrictToMinDeployed: true,
      });
      nextPlayer = res1.player;

      if (!nextPlayer) {
        const res2 = await findNextFreePlayerAsync(game.season_id, {
          excludeUserIds: [fromUser.id],
          gameIdToAvoidSameGameDouble: game.id,
          excludeVolunteerExempt: true,
          restrictToMinDeployed: true,
        });
        nextPlayer = res2.player;
      }

      if (!nextPlayer) {
        const res3 = await findNextFreePlayerAsync(game.season_id, {
          excludeUserIds: [fromUser.id],
          gameIdToAvoidSameGameDouble: game.id,
          excludeVolunteerExempt: true,
        });
        nextPlayer = res3.player;
      }
    }

    if (!nextPlayer) {
      return NextResponse.json({
        error: "Keine freie Person mehr auf der Mannschaftsliste verfügbar. Bitte Schiedsrichterwart kontaktieren.",
      }, { status: 400 });
    }

    const isPaidHandoff = reasonType === "REGULAR" || reasonType === "HARDSHIP";
    const feeTotal = isPaidHandoff ? 1500 : 0;
    const teamPot = isPaidHandoff ? 500 : 0;
    const payoutPool = isPaidHandoff ? 1000 : 0;
    const paymentStatus = isPaidHandoff ? "OPEN" : "NOT_APPLICABLE";
    const hardshipStatus = reasonType === "HARDSHIP" ? "PENDING" : "NONE";
    const eventType = reasonType === "SQUAD_NOMINATION" ? "SQUAD_NOMINATION" : "REGULAR_HANDOFF";

    await repo.chains.update(chainId, {
      status: "PENDING_HANDOFF",
      current_assignee_id: fromUser.id,
      pending_assignee_id: nextPlayer.id,
      voluntary_requester_id: null,
      payout_pool_cents: chain.payout_pool_cents + payoutPool,
      team_pot_cents: chain.team_pot_cents + teamPot,
    });

    const event = await repo.events.create({
      chain_id: chainId,
      game_id: game.id,
      event_type: eventType,
      from_user_id: fromUser.id,
      to_user_id: nextPlayer.id,
      reason_type: reasonType,
      is_short_notice: isShortNotice,
      public_note: publicNote || null,
      fee_total_cents: feeTotal,
      team_pot_cents: teamPot,
      payout_pool_cents: payoutPool,
      payment_status: paymentStatus,
      hardship_status: hardshipStatus,
      hardship_reason_confidential: reasonType === "HARDSHIP" ? hardshipReasonConfidential : null,
    });

    const chatType =
      reasonType === "SQUAD_NOMINATION"
        ? "SQUAD_NOMINATION"
        : reasonType === "VOLUNTEER_EXEMPT"
        ? "VOLUNTEER_EXEMPT"
        : reasonType === "HARDSHIP"
        ? "HARDSHIP"
        : "REGULAR_HANDOFF";

    const chatMessage = buildGroupChatMessage({
      type: chatType as any,
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
    if (chain.status !== "PENDING_HANDOFF" && chain.status !== "ASSIGNED") {
      return NextResponse.json(
        { error: "Keine unbestätigte Ansetzung oder Weitergabe vorhanden." },
        { status: 400 }
      );
    }

    const targetUserId =
      chain.status === "PENDING_HANDOFF"
        ? chain.pending_assignee_id
        : chain.current_assignee_id;

    const isAuthorized =
      targetUserId === user.id ||
      user.role === "SCHIEDSRICHTERWART" ||
      user.role === "ADMIN";

    if (!isAuthorized) {
      return NextResponse.json(
        { error: "Nur die vorgeschlagene Person oder der Schiedsrichterwart darf die Ansetzung annehmen." },
        { status: 403 }
      );
    }

    const action = String(body.action || "").toUpperCase();
    const game = (await repo.games.findById(chain.game_id))!;
    const acceptedUserId = targetUserId || user.id;
    const acceptedUser = (await repo.users.findById(acceptedUserId)) || user;

    if (action === "ACCEPT") {
      await repo.chains.update(chainId, {
        current_assignee_id: acceptedUser.id,
        pending_assignee_id: null,
        voluntary_requester_id: null,
        status: "CONFIRMED",
      });
      await repo.events.create({
        chain_id: chainId,
        game_id: game.id,
        event_type: "HANDOFF_ACCEPTED",
        from_user_id: chain.current_assignee_id,
        to_user_id: acceptedUser.id,
        public_note: "Ansetzung angenommen und bestätigt",
      });
      const chatMessage = buildGroupChatMessage({
        type: "HANDOFF_ACCEPTED",
        gameTitle: game.title,
        kickoffAt: game.kickoff_at,
        slotNumber: chain.slot_number,
        refCode: chain.ref_code,
        toName: getFullName(acceptedUser),
      });
      return NextResponse.json({ ok: true, status: "CONFIRMED", chatMessage });
    } else if (action === "DECLINE") {
      await repo.events.create({
        chain_id: chainId,
        game_id: game.id,
        event_type: "HANDOFF_SKIPPED_UNAVAILABLE",
        from_user_id: acceptedUserId,
        to_user_id: null,
        public_note: body.reason ? String(body.reason).trim() : "Verhindert.",
      });
      const { player: nextPlayer } = await findNextFreePlayerAsync(game.season_id, {
        excludeUserIds: [chain.current_assignee_id!, acceptedUserId],
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
      const chatMessage = buildGroupChatMessage({
        type: "HANDOFF_SKIPPED",
        gameTitle: game.title,
        kickoffAt: game.kickoff_at,
        slotNumber: chain.slot_number,
        refCode: chain.ref_code,
        fromName: getFullName(acceptedUser),
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
    const responsibleUserId = chain.pending_assignee_id ?? chain.current_assignee_id;
    if (responsibleUserId === user.id) {
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
      from_user_id: user.id,
      to_user_id: responsibleUserId,
      public_note: `Freiwillige Übernahme angefragt durch ${user.first_name} ${user.last_name}`,
    });
    const game = (await repo.games.findById(chain.game_id))!;
    const fromUser = await repo.users.findById(responsibleUserId!);
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
    const responsibleUserId = chain.pending_assignee_id ?? chain.current_assignee_id;
    const isAuthorized =
      responsibleUserId === user.id ||
      user.role === "SCHIEDSRICHTERWART" ||
      user.role === "ADMIN";
    if (!isAuthorized) {
      return NextResponse.json({ error: "Nur die zuletzt vorgeschlagene Person oder der Schiedsrichterwart darf über die Übernahme entscheiden." }, { status: 403 });
    }
    const action = String(body.action || (body.approved ? "APPROVE" : "REJECT")).toUpperCase();
    const volunteerId = chain.voluntary_requester_id;
    if (!volunteerId) {
      return NextResponse.json({ error: "Keine freiwillige Anfrage vorhanden." }, { status: 400 });
    }
    const game = (await repo.games.findById(chain.game_id))!;
    const volunteer = await repo.users.findById(volunteerId);

    if (action === "REJECT") {
      await repo.chains.update(chainId, {
        current_assignee_id: responsibleUserId,
        pending_assignee_id: null,
        status: "CONFIRMED",
        voluntary_requester_id: null,
      });
      await repo.events.create({
        chain_id: chainId,
        game_id: game.id,
        event_type: "VOLUNTEER_REJECTED",
        from_user_id: responsibleUserId,
        to_user_id: volunteerId,
        public_note: "Übernahme abgelehnt – zugewiesener Spieler automatisch als bestätigt gesetzt",
      });
      return NextResponse.json({ ok: true, status: "REJECTED" });
    }

    if (action === "APPROVE" && volunteer) {
      await repo.chains.update(chainId, {
        current_assignee_id: volunteer.id,
        pending_assignee_id: null,
        voluntary_requester_id: null,
        status: "CONFIRMED",
      });
      await repo.events.create({
        chain_id: chainId,
        game_id: game.id,
        event_type: "VOLUNTEER_APPROVED",
        from_user_id: responsibleUserId,
        to_user_id: volunteer.id,
        reason_type: "VOLUNTARY_TAKEOVER",
        public_note: "Übernahme bestätigt",
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

      const fromUser = await repo.users.findById(responsibleUserId || chain.current_assignee_id!);
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
    }

    return NextResponse.json({ error: "Ungültige Aktion." }, { status: 400 });
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
      const waivedCents =
        decision === "REJECTED"
          ? 0
          : Number(body.waivedAmountCents ?? body.waived_amount_cents ?? (decision === "APPROVED_FULL" ? 1500 : 0));
      const newPaymentStatus =
        decision === "APPROVED_FULL"
          ? "WAIVED_FULL"
          : decision === "APPROVED_PARTIAL"
          ? "OPEN"
          : "OPEN";
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
    if (chain.status !== "CONFIRMED_DEPLOYED") {
      return NextResponse.json(
        { error: "Auszahlung kann erst erfolgen, nachdem das Spiel gepfiffen und der Einsatz offiziell bestätigt wurde." },
        { status: 400 }
      );
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

  // 19. /api/treasury/settle-player (Sammelabwicklung & Verrechnung für einen Spieler)
  if (path === "/treasury/settle-player") {
    if (user.role !== "KASSENWART" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
    }
    const playerId = Number(body.playerId);
    const offsetOpenFees = Boolean(body.offsetOpenFees); // Ob offene Gebühren verrechnet werden sollen
    const seasonIdParam = body.seasonId; // Optional: Begrenzung auf eine Saison ("all" oder number)

    if (!playerId) {
      return NextResponse.json({ error: "Keine Spieler-ID angegeben." }, { status: 400 });
    }
    const targetPlayer = await repo.users.findById(playerId);
    if (!targetPlayer) {
      return NextResponse.json({ error: "Spieler nicht gefunden." }, { status: 404 });
    }

    // 1. Finde alle berechtigten, noch nicht ausgezahlten Töpfe des Spielers
    // (CONFIRMED_DEPLOYED, payout_settled != 1, payout_pool_cents > 0)
    let candidateGames: GameRow[] = [];
    if (seasonIdParam && seasonIdParam !== "all") {
      candidateGames = await repo.games.listBySeason(Number(seasonIdParam));
    } else {
      candidateGames = await repo.games.listAll();
    }
    const candidateGameIds = new Set(candidateGames.map((g) => g.id));

    const allChains = candidateGameIds.size > 0 ? await repo.chains.listByGameIds(Array.from(candidateGameIds)) : [];
    const readyChains = allChains.filter(
      (c) =>
        c.current_assignee_id === playerId &&
        c.status === "CONFIRMED_DEPLOYED" &&
        !c.payout_settled &&
        c.payout_pool_cents > 0
    );

    const totalPayoutCreditCents = readyChains.reduce(
      (acc, c) => acc + (c.payout_pool_cents || 0),
      0
    );

    // 2. Finde alle offenen Weitergabe-Gebühren des Spielers (innerhalb der Saison-Spiele)
    const [allEvents, rawCreditOffsets] = await Promise.all([
      candidateGameIds.size > 0 ? repo.events.listByGameIds(Array.from(candidateGameIds)) : Promise.resolve([]),
      repo.settings.get("event_credit_offsets"),
    ]);
    let creditOffsets: Record<string, number> = {};
    if (rawCreditOffsets) {
      try {
        creditOffsets = JSON.parse(rawCreditOffsets);
      } catch {}
    }

    const openFeeEvents = allEvents
      .filter((e) => e.from_user_id === playerId && e.payment_status === "OPEN")
      .sort((a, b) => a.id - b.id); // Älteste zuerst

    const totalOpenFeeCents = openFeeEvents.reduce((acc, e) => {
      const { actualWaivedCents, creditOffsetCents } = normalizeEventAmounts(e, creditOffsets);
      return acc + Math.max(0, (e.fee_total_cents || 0) - actualWaivedCents - creditOffsetCents);
    }, 0);

    if (readyChains.length === 0 && openFeeEvents.length === 0) {
      return NextResponse.json({ error: "Keine offenen Posten für diesen Spieler vorhanden." }, { status: 400 });
    }

    let settledPoolCount = 0;
    let paidFeeCount = 0;
    let totalOffsetAmountCents = 0;
    let netPayoutCents = totalPayoutCreditCents;

    // A: Falls Verrechnung gewünscht und Guthaben vorhanden ist (ohne waived_amount_cents / Erlass zu verändern!)
    if (offsetOpenFees && totalPayoutCreditCents > 0 && openFeeEvents.length > 0) {
      let remainingCredit = totalPayoutCreditCents;
      let offsetsChanged = false;

      for (const ev of openFeeEvents) {
        const { actualWaivedCents, creditOffsetCents } = normalizeEventAmounts(ev, creditOffsets);
        const feeDue = Math.max(0, (ev.fee_total_cents || 0) - actualWaivedCents - creditOffsetCents);
        if (feeDue <= 0) continue;

        if (remainingCredit >= feeDue) {
          // Gebühr vollständig durch Guthaben beglichen (Gesamtbetrag bleibt erhalten, kein Erlass!)
          await repo.events.update(ev.id, { payment_status: "PAID" });
          creditOffsets[String(ev.id)] = creditOffsetCents + feeDue;
          offsetsChanged = true;
          remainingCredit -= feeDue;
          totalOffsetAmountCents += feeDue;
          paidFeeCount++;
        } else {
          // Teilverrechnung: Speichere angerechnetes Guthaben separat (kein Erlass!)
          creditOffsets[String(ev.id)] = creditOffsetCents + remainingCredit;
          offsetsChanged = true;
          totalOffsetAmountCents += remainingCredit;
          remainingCredit = 0;
          break;
        }
      }
      if (offsetsChanged) {
        await repo.settings.set("event_credit_offsets", JSON.stringify(creditOffsets));
      }
      netPayoutCents = Math.max(0, totalPayoutCreditCents - totalOffsetAmountCents);
    }

    // B: Alle berechtigten Töpfe als ausgezahlt markieren (jeweils genau EIN Event pro Kette, kein Duplikat!)
    const targetName = `${targetPlayer.first_name} ${targetPlayer.last_name}`.trim();
    for (const ch of readyChains) {
      await repo.chains.update(ch.id, { payout_settled: 1 });
      const noteDetail =
        offsetOpenFees && totalOffsetAmountCents > 0
          ? `Topf-Auszahlung von ${(ch.payout_pool_cents / 100).toFixed(2)} € an ${targetName} (Sammelabwicklung: ${(totalOffsetAmountCents / 100).toFixed(2)} € mit offenen Gebühren verrechnet, Netto: ${(netPayoutCents / 100).toFixed(2)} €)`
          : `Topf-Auszahlung von ${(ch.payout_pool_cents / 100).toFixed(2)} € an ${targetName} (Sammelabwicklung)`;
      await repo.events.create({
        chain_id: ch.id,
        game_id: ch.game_id,
        event_type: "PAYOUT_SETTLED",
        from_user_id: user.id,
        to_user_id: playerId,
        public_note: noteDetail,
      });
      settledPoolCount++;
    }

    return NextResponse.json({
      ok: true,
      settledPoolCount,
      paidFeeCount,
      totalPayoutCreditCents,
      totalOffsetAmountCents,
      netPayoutCents,
    });
  }

  // 20. /api/treasury/settings (Hinterlegen von IBAN, Empfänger & PayPal)
  if (path === "/treasury/settings") {
    if (user.role !== "KASSENWART" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
    }
    const iban = String(body.iban || "").trim();
    const recipient = String(body.recipient || "").trim();
    const paypal = String(body.paypal || "").trim();

    await Promise.all([
      repo.settings.set("treasury_iban", iban),
      repo.settings.set("treasury_recipient", recipient),
      repo.settings.set("treasury_paypal", paypal),
    ]);

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
    const iban = body.iban !== undefined ? String(body.iban).trim() || null : existing.iban;
    const paypal = body.paypal !== undefined ? String(body.paypal).trim() || null : existing.paypal;

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
      iban,
      paypal,
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
    if (user.role !== "SCHIEDSRICHTERWART" && user.role !== "ADMIN" && user.role !== "VORSTAND") {
      return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
    }
    const targetId = Number(userMatch[1]);
    const existing = await repo.users.findById(targetId);
    if (!existing) {
      return NextResponse.json({ error: "Spieler nicht gefunden." }, { status: 404 });
    }

    const updates: Record<string, any> = {};

    const firstName = body.firstName !== undefined ? String(body.firstName).trim() : body.first_name !== undefined ? String(body.first_name).trim() : undefined;
    if (firstName !== undefined) {
      if (!firstName) return NextResponse.json({ error: "Vorname darf nicht leer sein." }, { status: 400 });
      updates.first_name = firstName;
    }

    const lastName = body.lastName !== undefined ? String(body.lastName).trim() : body.last_name !== undefined ? String(body.last_name).trim() : undefined;
    if (lastName !== undefined) {
      if (!lastName) return NextResponse.json({ error: "Nachname darf nicht leer sein." }, { status: 400 });
      updates.last_name = lastName;
    }

    const email = body.email !== undefined ? String(body.email).trim().toLowerCase() : undefined;
    if (email !== undefined) {
      if (!email || !email.includes("@")) {
        return NextResponse.json({ error: "Bitte eine gültige E-Mail-Adresse angeben." }, { status: 400 });
      }
      if (email !== existing.email) {
        const dup = await repo.users.findByEmail(email);
        if (dup && dup.id !== targetId) {
          return NextResponse.json({ error: "Diese E-Mail wird bereits von einem anderen Spieler verwendet." }, { status: 400 });
        }
      }
      updates.email = email;
    }

    const mobile = body.mobileNumber !== undefined ? body.mobileNumber : body.mobile_number;
    if (mobile !== undefined) {
      updates.mobile_number = String(mobile).trim() || null;
    }

    const iban = body.iban !== undefined ? body.iban : body.payment_info;
    if (iban !== undefined) {
      updates.iban = String(iban).trim() || null;
    }

    const paypal = body.paypal !== undefined ? body.paypal : body.paypal_me;
    if (paypal !== undefined) {
      updates.paypal = String(paypal).trim() || null;
    }

    const allowedRoles = ["PLAYER", "SCHIEDSRICHTERWART", "KASSENWART", "VORSTAND", "ADMIN"];
    if (body.role !== undefined) {
      const rawRole = String(body.role).trim();
      if (allowedRoles.includes(rawRole)) {
        updates.role = rawRole;
      }
    }

    const activeInList = body.isActiveInList !== undefined ? body.isActiveInList : body.is_active_in_list;
    if (activeInList !== undefined) {
      updates.is_active_in_list = activeInList ? 1 : 0;
    }

    const volunteerExempt = body.isVolunteerExempt !== undefined ? body.isVolunteerExempt : body.is_volunteer_exempt;
    if (volunteerExempt !== undefined) {
      updates.is_volunteer_exempt = volunteerExempt ? 1 : 0;
    }

    const orderOverride = body.listOrderOverride !== undefined ? body.listOrderOverride : body.list_order_override;
    if (orderOverride !== undefined) {
      updates.list_order_override = (orderOverride === null || orderOverride === "" || Number.isNaN(Number(orderOverride)))
        ? null
        : Number(orderOverride);
    }

    if (body.password && String(body.password).trim().length > 0) {
      updates.password_hash = hashPassword(String(body.password).trim());
    }

    // Ermittle Ziel-Saison für Overrides (aus body.seasonId oder aktuell aktiver Saison)
    let overrideSeasonId: string = "active";
    if (body.seasonId !== undefined && body.seasonId !== null) {
      overrideSeasonId = String(body.seasonId);
    } else {
      const activeSeasonObj = await repo.seasons.getActive();
      if (activeSeasonObj) overrideSeasonId = String(activeSeasonObj.id);
    }

    const deployedVal = body.deployedCount !== undefined ? body.deployedCount : body.deployed_count;
    if (deployedVal !== undefined && (user.role === "SCHIEDSRICHTERWART" || user.role === "ADMIN")) {
      const rawOverrides = await repo.settings.get("deployed_count_overrides");
      let overridesData: Record<string, any> = {};
      if (rawOverrides) {
        try {
          overridesData = JSON.parse(rawOverrides);
        } catch {}
      }

      // Falls overridesData noch ein flaches Objekt ist, migriere bzw. ordne der Saison zu
      let seasonOverrides: Record<string, number> = {};
      if (overridesData[overrideSeasonId] && typeof overridesData[overrideSeasonId] === "object") {
        seasonOverrides = overridesData[overrideSeasonId];
      } else {
        // Prüfe ob overridesData flach ist (enthält userId Keys)
        const isFlat = Object.keys(overridesData).some((k) => typeof overridesData[k] === "number");
        if (isFlat) {
          seasonOverrides = { ...overridesData };
        }
      }

      if (deployedVal === null || deployedVal === "") {
        delete seasonOverrides[String(targetId)];
        delete seasonOverrides[targetId];
      } else {
        seasonOverrides[String(targetId)] = Math.max(0, parseInt(String(deployedVal), 10) || 0);
      }

      overridesData[overrideSeasonId] = seasonOverrides;
      await repo.settings.set("deployed_count_overrides", JSON.stringify(overridesData));
    }

    // Zusätzliche Statistik-Korrekturen (Topf-Prämie, Gerettet/Übernahmen, Weitergegeben)
    const earnedVal = body.earnedPayoutCents !== undefined ? body.earnedPayoutCents : body.earned_payout_cents;
    const takeoverVal = body.takeoverCount !== undefined ? body.takeoverCount : body.takeover_count;
    const handoffVal = body.handoffCount !== undefined ? body.handoffCount : body.handoff_count;

    if (
      (earnedVal !== undefined || takeoverVal !== undefined || handoffVal !== undefined) &&
      (user.role === "SCHIEDSRICHTERWART" || user.role === "ADMIN")
    ) {
      const rawStatsOverrides = await repo.settings.get("player_stats_overrides");
      let allStatsData: Record<string, any> = {};
      if (rawStatsOverrides) {
        try {
          allStatsData = JSON.parse(rawStatsOverrides);
        } catch {}
      }

      let seasonStatsOverrides: Record<string, { earnedPayoutCents?: number; takeoverCount?: number; handoffCount?: number }> = {};
      if (allStatsData[overrideSeasonId] && typeof allStatsData[overrideSeasonId] === "object") {
        seasonStatsOverrides = allStatsData[overrideSeasonId];
      } else {
        const isFlat = Object.keys(allStatsData).some((k) => allStatsData[k] && (allStatsData[k].earnedPayoutCents !== undefined || allStatsData[k].takeoverCount !== undefined || allStatsData[k].handoffCount !== undefined));
        if (isFlat) {
          seasonStatsOverrides = { ...allStatsData };
        }
      }

      const pKey = String(targetId);
      const current = seasonStatsOverrides[pKey] || {};

      if (earnedVal !== undefined) {
        if (earnedVal === null || earnedVal === "") {
          delete current.earnedPayoutCents;
        } else {
          current.earnedPayoutCents = Math.max(0, Math.round(Number(earnedVal)) || 0);
        }
      }

      if (takeoverVal !== undefined) {
        if (takeoverVal === null || takeoverVal === "") {
          delete current.takeoverCount;
        } else {
          current.takeoverCount = Math.max(0, parseInt(String(takeoverVal), 10) || 0);
        }
      }

      if (handoffVal !== undefined) {
        if (handoffVal === null || handoffVal === "") {
          delete current.handoffCount;
        } else {
          current.handoffCount = Math.max(0, parseInt(String(handoffVal), 10) || 0);
        }
      }

      if (Object.keys(current).length === 0) {
        delete seasonStatsOverrides[pKey];
      } else {
        seasonStatsOverrides[pKey] = current;
      }

      allStatsData[overrideSeasonId] = seasonStatsOverrides;
      await repo.settings.set("player_stats_overrides", JSON.stringify(allStatsData));
    }

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

  // 1. /api/seasons/:id
  const seasonMatch = path.match(/^\/seasons\/(\d+)$/);
  if (seasonMatch) {
    if (user.role !== "SCHIEDSRICHTERWART" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
    }
    const seasonId = Number(seasonMatch[1]);
    await repo.seasons.delete(seasonId);
    return NextResponse.json({ ok: true });
  }

  // 2. /api/games/:id
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
