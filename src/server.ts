import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {
  sqlite,
  type ChainRow,
  type EventRow,
  type GameRow,
  type SafeUser,
  type SeasonRow,
  type UserRow,
} from "./db/index.ts";
import { ensureSeeded } from "./db/seed.ts";
import {
  getSessionUser,
  hashPassword,
  makeClearCookieHeader,
  makeSessionCookieHeader,
  verifyPassword,
} from "./lib/auth.ts";
import {
  buildGroupChatMessage,
  findNextFreePlayer,
  getFullName,
  getNextSeasonRefCode,
  getSortedActivePlayers,
  getUserById,
  isShortNotice48h,
} from "./lib/scheduler.ts";

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "../public"
);

function sendJson(
  res: http.ServerResponse,
  status: number,
  data: unknown,
  extraHeaders: Record<string, string> = {}
) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
  res.end(body);
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function getActiveSeason(): SeasonRow | undefined {
  return sqlite
    .prepare("SELECT * FROM seasons WHERE is_active = 1 LIMIT 1")
    .get() as SeasonRow | undefined;
}

function serveStatic(reqPath: string, res: http.ServerResponse): boolean {
  const cleanPath = reqPath === "/" ? "/index.html" : reqPath;
  const resolved = path.normalize(path.join(PUBLIC_DIR, cleanPath));
  if (!resolved.startsWith(PUBLIC_DIR)) return false;
  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    return false;
  }

  const ext = path.extname(resolved);
  const mimeMap: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
  };
  res.writeHead(200, {
    "Content-Type": mimeMap[ext] || "application/octet-stream",
  });
  fs.createReadStream(resolved).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  ensureSeeded();
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const method = req.method || "GET";
  const pathname = url.pathname;

  try {
    // --- AUTH ---
    if (method === "POST" && pathname === "/api/auth/login") {
      const body = await readJsonBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const row = sqlite
        .prepare("SELECT * FROM users WHERE email = ?")
        .get(email) as UserRow | undefined;

      if (!row || !verifyPassword(password, row.password_hash)) {
        return sendJson(res, 401, {
          error: "Ungültige E-Mail oder falsches Passwort.",
        });
      }
      const { password_hash: _, ...safeUser } = row;
      return sendJson(
        res,
        200,
        { user: safeUser },
        { "Set-Cookie": makeSessionCookieHeader(row.id) }
      );
    }

    if (method === "POST" && pathname === "/api/auth/logout") {
      return sendJson(
        res,
        200,
        { ok: true },
        { "Set-Cookie": makeClearCookieHeader() }
      );
    }

    if (method === "GET" && pathname === "/api/auth/me") {
      const user = getSessionUser(req);
      return sendJson(res, 200, { user });
    }

    // --- PROTECTED API ---
    if (pathname.startsWith("/api/")) {
      const user = getSessionUser(req);
      if (!user) {
        return sendJson(res, 401, { error: "Nicht angemeldet." });
      }

      // --- OWN PROFILE UPDATE (any logged-in user) ---
      if (method === "PATCH" && pathname === "/api/auth/profile") {
        const body = await readJsonBody(req);
        const existing = sqlite
          .prepare("SELECT * FROM users WHERE id = ?")
          .get(user.id) as UserRow | undefined;
        if (!existing) {
          return sendJson(res, 404, { error: "Benutzer nicht gefunden." });
        }

        const email =
          body.email !== undefined
            ? String(body.email).trim().toLowerCase()
            : existing.email;
        const mobileNumber =
          body.mobileNumber !== undefined
            ? String(body.mobileNumber).trim() || null
            : existing.mobile_number;

        if (!email || !email.includes("@")) {
          return sendJson(res, 400, {
            error: "Bitte eine gültige E-Mail-Adresse angeben.",
          });
        }
        if (email !== existing.email) {
          const dup = sqlite
            .prepare("SELECT id FROM users WHERE email = ? AND id != ?")
            .get(email, user.id);
          if (dup) {
            return sendJson(res, 400, {
              error: "Diese E-Mail-Adresse wird bereits verwendet.",
            });
          }
        }

        const newPasswordHash =
          body.password && String(body.password).trim().length > 0
            ? hashPassword(String(body.password).trim())
            : existing.password_hash;

        sqlite
          .prepare(
            "UPDATE users SET email = ?, mobile_number = ?, password_hash = ? WHERE id = ?"
          )
          .run(email, mobileNumber, newPasswordHash, user.id);

        return sendJson(res, 200, { ok: true });
      }

      // --- SATZUNG (aus satzung_schiri.md) ---
      if (method === "GET" && pathname === "/api/satzung") {
        try {
          const mdPath = path.join(PUBLIC_DIR, "../satzung_schiri.md");
          const markdown = fs.readFileSync(mdPath, "utf8");
          const stat = fs.statSync(mdPath);
          return sendJson(
            res,
            200,
            {
              markdown,
              updatedAt: stat.mtime.toISOString(),
              sourceFile: "satzung_schiri.md",
            },
            { "Cache-Control": "no-store, max-age=0" }
          );
        } catch {
          return sendJson(res, 404, {
            error: "Die Datei satzung_schiri.md konnte nicht gelesen werden.",
          });
        }
      }

      // --- DASHBOARD ---
      if (method === "GET" && pathname === "/api/dashboard") {
        const allSeasons = sqlite
          .prepare("SELECT * FROM seasons ORDER BY is_active DESC, id DESC")
          .all() as unknown as SeasonRow[];
        const reqSeasonId = url.searchParams.get("seasonId")
          ? Number(url.searchParams.get("seasonId"))
          : null;
        const season =
          (reqSeasonId
            ? allSeasons.find((s) => s.id === reqSeasonId)
            : undefined) ?? getActiveSeason();
        if (!season) {
          return sendJson(res, 200, {
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

        const allUsersRaw = sqlite
          .prepare("SELECT * FROM users")
          .all() as unknown as UserRow[];
        const userMap = new Map<number, SafeUser>(
          allUsersRaw.map(({ password_hash: _, ...u }) => [u.id, u])
        );
        const sortedActive = getSortedActivePlayers();
        const inactiveUsers = allUsersRaw
          .filter((u) => !u.is_active_in_list)
          .map(({ password_hash: _, ...u }) => u);

        const seasonGames = sqlite
          .prepare(
            "SELECT * FROM games WHERE season_id = ? ORDER BY kickoff_at ASC"
          )
          .all(season.id) as unknown as GameRow[];

        const gameIds = seasonGames.map((g) => g.id);
        let chains: ChainRow[] = [];
        let events: EventRow[] = [];

        if (gameIds.length > 0) {
          const ph = gameIds.map(() => "?").join(",");
          chains = sqlite
            .prepare(
              `SELECT * FROM assignment_chains WHERE game_id IN (${ph}) ORDER BY slot_number ASC`
            )
            .all(...gameIds) as unknown as ChainRow[];
          events = sqlite
            .prepare(
              `SELECT * FROM handoff_events WHERE game_id IN (${ph}) ORDER BY id DESC`
            )
            .all(...gameIds) as unknown as EventRow[];
        }

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

        let deployedOverrides: Record<string, number> = {};
        try {
          const row = sqlite
            .prepare("SELECT value FROM app_settings WHERE key = 'deployed_count_overrides'")
            .get() as { value: string } | undefined;
          if (row?.value) deployedOverrides = JSON.parse(row.value);
        } catch {}

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
            .reduce((acc, e) => acc + (e.fee_total_cents - e.waived_amount_cents), 0);
          const paidCents = pEvents
            .filter((e) => e.payment_status === "PAID")
            .reduce((acc, e) => acc + (e.fee_total_cents - e.waived_amount_cents), 0);
          const earnedPayoutCents = chains
            .filter(
              (c) =>
                c.current_assignee_id === p.id &&
                (c.status === "CONFIRMED_DEPLOYED" || Boolean(c.payout_settled)) &&
                c.payout_pool_cents > 0
            )
            .reduce((acc, c) => acc + c.payout_pool_cents, 0);

          const takeoverCount = sanitizedEvents.filter(
            (e) =>
              e.to_user_id === p.id &&
              (e.event_type === "HANDOFF_ACCEPTED" || e.event_type === "VOLUNTEER_APPROVED") &&
              e.from_user_id !== p.id
          ).length;

          const handoffCount = sanitizedEvents.filter(
            (e) =>
              e.from_user_id === p.id &&
              ["REGULAR_HANDOFF", "HARDSHIP", "VOLUNTEER_EXEMPT", "SQUAD_NOMINATION", "VOLUNTEER_AUTO_FORWARD"].includes(e.event_type)
          ).length;

          return {
            ...p,
            activeAssigned,
            deployedCount,
            isDeployedOverridden: hasOverride,
            openPaymentCents,
            paidCents,
            earnedPayoutCents,
            takeoverCount,
            handoffCount,
          };
        });

        const totalTeamPotCents = chains.reduce(
          (acc, c) => acc + c.team_pot_cents,
          0
        );
        const totalOpenPaymentsCents = sanitizedEvents
          .filter((e) => e.payment_status === "OPEN")
          .reduce((acc, e) => acc + (e.fee_total_cents - e.waived_amount_cents), 0);
        const totalPaidCents = sanitizedEvents
          .filter((e) => e.payment_status === "PAID")
          .reduce((acc, e) => acc + (e.fee_total_cents - e.waived_amount_cents), 0);
        const totalPayoutPoolOpenCents = chains
          .filter((c) => !c.payout_settled && c.payout_pool_cents > 0)
          .reduce((acc, c) => acc + c.payout_pool_cents, 0);

        return sendJson(res, 200, {
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

      // --- SEASONS: CREATE & ACTIVATE ---
      if (method === "POST" && pathname === "/api/seasons") {
        if (user.role !== "SCHIEDSRICHTERWART" && user.role !== "ADMIN") {
          return sendJson(res, 403, {
            error: "Nur der Schiedsrichterwart oder Admin darf Saisons anlegen.",
          });
        }
        const body = await readJsonBody(req);
        const name = String(body.name || "").trim();
        const setActive = body.setActive !== false;
        if (!name) {
          return sendJson(res, 400, { error: "Saisonname ist erforderlich." });
        }
        if (setActive) {
          sqlite.prepare("UPDATE seasons SET is_active = 0").run();
        }
        const resSeason = sqlite
          .prepare(
            "INSERT INTO seasons (name, is_active, created_at) VALUES (?, ?, ?)"
          )
          .run(name, setActive ? 1 : 0, new Date().toISOString());
        return sendJson(res, 201, { id: Number(resSeason.lastInsertRowid) });
      }

      const seasonActivateMatch = pathname.match(
        /^\/api\/seasons\/(\d+)\/activate$/
      );
      if (method === "POST" && seasonActivateMatch) {
        if (user.role !== "SCHIEDSRICHTERWART" && user.role !== "ADMIN") {
          return sendJson(res, 403, {
            error: "Nur der Schiedsrichterwart oder Admin darf die aktive Saison wechseln.",
          });
        }
        const targetSeasonId = Number(seasonActivateMatch[1]);
        const target = sqlite
          .prepare("SELECT * FROM seasons WHERE id = ?")
          .get(targetSeasonId) as SeasonRow | undefined;
        if (!target) {
          return sendJson(res, 404, { error: "Saison nicht gefunden." });
        }
        sqlite.prepare("UPDATE seasons SET is_active = 0").run();
        sqlite
          .prepare("UPDATE seasons SET is_active = 1 WHERE id = ?")
          .run(targetSeasonId);
        return sendJson(res, 200, { ok: true });
      }

      const seasonEditMatch = pathname.match(/^\/api\/seasons\/(\d+)$/);
      if (method === "PATCH" && seasonEditMatch) {
        if (user.role !== "SCHIEDSRICHTERWART" && user.role !== "ADMIN") {
          return sendJson(res, 403, {
            error: "Nur der Schiedsrichterwart oder Admin darf den Saisonnamen ändern.",
          });
        }
        const targetSeasonId = Number(seasonEditMatch[1]);
        const target = sqlite
          .prepare("SELECT * FROM seasons WHERE id = ?")
          .get(targetSeasonId) as SeasonRow | undefined;
        if (!target) {
          return sendJson(res, 404, { error: "Saison nicht gefunden." });
        }
        const body = await readJsonBody(req);
        const name = String(body.name || "").trim();
        if (!name) {
          return sendJson(res, 400, { error: "Saisonname darf nicht leer sein." });
        }
        sqlite
          .prepare("UPDATE seasons SET name = ? WHERE id = ?")
          .run(name, targetSeasonId);
        return sendJson(res, 200, { ok: true });
      }

      // --- CREATE USER (Schiedsrichterwart) ---
      if (method === "POST" && pathname === "/api/users") {
        if (user.role !== "SCHIEDSRICHTERWART") {
          return sendJson(res, 403, {
            error: "Nur der Schiedsrichterwart darf Spieler anlegen.",
          });
        }
        const body = await readJsonBody(req);
        const firstName = String(body.firstName || "").trim();
        const lastName = String(body.lastName || "").trim();
        const email = String(body.email || "").trim().toLowerCase();
        const mobileNumber = String(body.mobileNumber || "").trim() || null;
        const password = String(body.password || "rhtc2026");
        const role = String(body.role || "PLAYER");
        const isVolunteerExempt = body.isVolunteerExempt ? 1 : 0;

        if (!firstName || !lastName || !email) {
          return sendJson(res, 400, {
            error: "Vorname, Nachname und E-Mail sind erforderlich.",
          });
        }
        const existing = sqlite
          .prepare("SELECT id FROM users WHERE email = ?")
          .get(email);
        if (existing) {
          return sendJson(res, 400, {
            error: "Diese E-Mail existiert bereits.",
          });
        }

        const now = new Date().toISOString();
        const resInsert = sqlite
          .prepare(
            "INSERT INTO users (first_name, last_name, email, mobile_number, password_hash, role, is_active_in_list, is_volunteer_exempt, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)"
          )
          .run(
            firstName,
            lastName,
            email,
            mobileNumber,
            hashPassword(password),
            role,
            isVolunteerExempt,
            now
          );
        return sendJson(res, 201, { id: Number(resInsert.lastInsertRowid) });
      }

      // --- CSV IMPORT USERS (Schiedsrichterwart / Admin) ---
      if (method === "POST" && pathname === "/api/users/import") {
        if (user.role !== "SCHIEDSRICHTERWART" && user.role !== "ADMIN") {
          return sendJson(res, 403, {
            error: "Nur der Schiedsrichterwart oder Admin darf Spieler importieren.",
          });
        }
        const body = await readJsonBody(req);
        const rows = Array.isArray(body.rows) ? body.rows : [];
        if (rows.length === 0) {
          return sendJson(res, 400, { error: "Keine Import-Zeilen übergeben." });
        }

        const allowedRoles = [
          "PLAYER",
          "SCHIEDSRICHTERWART",
          "KASSENWART",
          "VORSTAND",
          "ADMIN",
        ];
        const now = new Date().toISOString();
        const insertStmt = sqlite.prepare(
          "INSERT INTO users (first_name, last_name, email, mobile_number, password_hash, role, is_active_in_list, is_volunteer_exempt, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)"
        );
        const checkEmailStmt = sqlite.prepare(
          "SELECT id FROM users WHERE email = ?"
        );

        let createdCount = 0;
        let skippedCount = 0;
        const errors: string[] = [];

        for (let i = 0; i < rows.length; i++) {
          const r = rows[i] as Record<string, unknown>;
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
          if (checkEmailStmt.get(email)) {
            skippedCount++;
            errors.push(`Zeile ${i + 1} (${email}): E-Mail existiert bereits.`);
            continue;
          }

          insertStmt.run(
            firstName,
            lastName,
            email,
            mobileNumber,
            hashPassword(password),
            role,
            isExempt,
            now
          );
          createdCount++;
        }

        return sendJson(res, 200, { createdCount, skippedCount, errors });
      }

      // --- BULK DELETE USERS (Schiedsrichterwart / Admin) ---
      if (method === "POST" && pathname === "/api/users/bulk-delete") {
        if (user.role !== "SCHIEDSRICHTERWART" && user.role !== "ADMIN") {
          return sendJson(res, 403, {
            error: "Nur der Schiedsrichterwart oder Admin darf Spieler löschen.",
          });
        }
        const body = await readJsonBody(req);
        const ids = Array.isArray(body.ids)
          ? body.ids.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0)
          : [];
        if (ids.length === 0) {
          return sendJson(res, 400, { error: "Keine Spieler-IDs ausgewählt." });
        }
        if (ids.includes(user.id)) {
          return sendJson(res, 400, {
            error: "Du kannst deinen eigenen Account nicht löschen.",
          });
        }

        let deletedCount = 0;
        for (const targetId of ids) {
          sqlite
            .prepare(
              `UPDATE assignment_chains
               SET status = CASE WHEN current_assignee_id = ? AND status IN ('ASSIGNED', 'CONFIRMED', 'VOLUNTARY_REQUESTED') THEN 'UNASSIGNED' ELSE status END,
                   current_assignee_id = CASE WHEN current_assignee_id = ? THEN NULL ELSE current_assignee_id END,
                   pending_assignee_id = CASE WHEN pending_assignee_id = ? THEN NULL ELSE pending_assignee_id END,
                   voluntary_requester_id = CASE WHEN voluntary_requester_id = ? THEN NULL ELSE voluntary_requester_id END,
                   confirmed_by_id = CASE WHEN confirmed_by_id = ? THEN NULL ELSE confirmed_by_id END
               WHERE current_assignee_id = ? OR pending_assignee_id = ? OR voluntary_requester_id = ? OR confirmed_by_id = ?`
            )
            .run(
              targetId,
              targetId,
              targetId,
              targetId,
              targetId,
              targetId,
              targetId,
              targetId,
              targetId
            );

          sqlite
            .prepare(
              `UPDATE handoff_events
               SET from_user_id = CASE WHEN from_user_id = ? THEN NULL ELSE from_user_id END,
                   to_user_id = CASE WHEN to_user_id = ? THEN NULL ELSE to_user_id END
               WHERE from_user_id = ? OR to_user_id = ?`
            )
            .run(targetId, targetId, targetId, targetId);

          const resDel = sqlite
            .prepare("DELETE FROM users WHERE id = ?")
            .run(targetId);
          deletedCount += Number(resDel.changes || 0);
        }

        return sendJson(res, 200, { ok: true, deletedCount });
      }

      // --- UPDATE USER (§ 2 Abs. 4 / § 7) ---
      const userMatch = pathname.match(/^\/api\/users\/(\d+)$/);
      if (method === "PATCH" && userMatch) {
        if (user.role !== "SCHIEDSRICHTERWART" && user.role !== "ADMIN" && user.role !== "VORSTAND") {
          return sendJson(res, 403, {
            error: "Keine Berechtigung zur Listenpflege.",
          });
        }
        const targetId = Number(userMatch[1]);
        const body = await readJsonBody(req);
        const existing = sqlite
          .prepare("SELECT * FROM users WHERE id = ?")
          .get(targetId) as UserRow | undefined;
        if (!existing) {
          return sendJson(res, 404, { error: "Spieler nicht gefunden." });
        }

        const firstName =
          body.firstName !== undefined
            ? String(body.firstName).trim()
            : existing.first_name;
        const lastName =
          body.lastName !== undefined
            ? String(body.lastName).trim()
            : existing.last_name;
        const email =
          body.email !== undefined
            ? String(body.email).trim().toLowerCase()
            : existing.email;
        const mobileNumber =
          body.mobileNumber !== undefined
            ? String(body.mobileNumber).trim() || null
            : existing.mobile_number;
        const allowedRoles = [
          "PLAYER",
          "SCHIEDSRICHTERWART",
          "KASSENWART",
          "VORSTAND",
          "ADMIN",
        ];
        const role =
          (user.role === "SCHIEDSRICHTERWART" || user.role === "ADMIN") &&
          body.role !== undefined &&
          allowedRoles.includes(String(body.role))
            ? String(body.role)
            : existing.role;

        if (!firstName || !lastName || !email) {
          return sendJson(res, 400, {
            error: "Vorname, Nachname und E-Mail dürfen nicht leer sein.",
          });
        }
        if (email !== existing.email) {
          const dup = sqlite
            .prepare("SELECT id FROM users WHERE email = ? AND id != ?")
            .get(email, targetId);
          if (dup) {
            return sendJson(res, 400, {
              error: "Diese E-Mail wird bereits von einem anderen Spieler verwendet.",
            });
          }
        }

        const isActiveInList =
          body.isActiveInList !== undefined
            ? body.isActiveInList
              ? 1
              : 0
            : existing.is_active_in_list;
        const isVolunteerExempt =
          body.isVolunteerExempt !== undefined
            ? body.isVolunteerExempt
              ? 1
              : 0
            : existing.is_volunteer_exempt;
        const listOrderOverride =
          body.listOrderOverride !== undefined
            ? body.listOrderOverride === null || body.listOrderOverride === ""
              ? null
              : Number(body.listOrderOverride)
            : existing.list_order_override;

        const newPasswordHash =
          (user.role === "SCHIEDSRICHTERWART" || user.role === "ADMIN") &&
          body.password &&
          String(body.password).trim().length > 0
            ? hashPassword(String(body.password).trim())
            : existing.password_hash;

        sqlite
          .prepare(
            `UPDATE users
             SET first_name = ?, last_name = ?, email = ?, mobile_number = ?, role = ?, password_hash = ?,
                 is_active_in_list = ?, is_volunteer_exempt = ?, list_order_override = ?
             WHERE id = ?`
          )
          .run(
            firstName,
            lastName,
            email,
            mobileNumber,
            role,
            newPasswordHash,
            isActiveInList,
            isVolunteerExempt,
            listOrderOverride,
            targetId
          );

        const deployedVal =
          body.deployedCount !== undefined
            ? body.deployedCount
            : body.deployed_count;
        if (
          deployedVal !== undefined &&
          (user.role === "SCHIEDSRICHTERWART" || user.role === "ADMIN")
        ) {
          let overrides: Record<string, number> = {};
          try {
            const row = sqlite
              .prepare(
                "SELECT value FROM app_settings WHERE key = 'deployed_count_overrides'"
              )
              .get() as { value: string } | undefined;
            if (row?.value) overrides = JSON.parse(row.value);
          } catch {}
          if (deployedVal === null || deployedVal === "") {
            delete overrides[String(targetId)];
            delete overrides[targetId];
          } else {
            overrides[String(targetId)] = Math.max(
              0,
              parseInt(String(deployedVal), 10) || 0
            );
          }
          sqlite
            .prepare(
              `INSERT INTO app_settings (key, value) VALUES ('deployed_count_overrides', ?)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value`
            )
            .run(JSON.stringify(overrides));
        }

        return sendJson(res, 200, { ok: true });
      }

      // --- CREATE GAME & AUTO-ASSIGN (§ 3) ---
      if (method === "POST" && pathname === "/api/games") {
        if (user.role !== "SCHIEDSRICHTERWART") {
          return sendJson(res, 403, {
            error: "Nur der Schiedsrichterwart darf Spiele ansetzen.",
          });
        }
        const body = await readJsonBody(req);
        const season = body.seasonId
          ? (sqlite
              .prepare("SELECT * FROM seasons WHERE id = ?")
              .get(Number(body.seasonId)) as SeasonRow | undefined)
          : getActiveSeason();
        if (!season) {
          return sendJson(res, 400, { error: "Keine gültige Saison gefunden." });
        }
        const title = String(body.title || "").trim();
        const location = String(body.location || "RHTC Halle").trim();
        const kickoffAt = String(body.kickoffAt || "").trim();
        const isFirstGame = Boolean(body.isFirstGameOfSeason);
        const randomDraw = Boolean(body.randomDraw);
        let ref1Id = body.ref1Id ? Number(body.ref1Id) : null;
        let ref2Id = body.ref2Id ? Number(body.ref2Id) : null;

        if (!title || !kickoffAt) {
          return sendJson(res, 400, {
            error: "Spieltitel und Anpfiffzeit sind erforderlich.",
          });
        }

        const now = new Date().toISOString();
        const gameRes = sqlite
          .prepare(
            "INSERT INTO games (season_id, title, location, kickoff_at, is_first_game_of_season, created_at) VALUES (?, ?, ?, ?, ?, ?)"
          )
          .run(season.id, title, location, kickoffAt, isFirstGame ? 1 : 0, now);
        const gameId = Number(gameRes.lastInsertRowid);

        if (isFirstGame && randomDraw) {
          const active = getSortedActivePlayers();
          if (active.length >= 2) {
            const shuffled = [...active].sort(() => Math.random() - 0.5);
            ref1Id = shuffled[0].id;
            ref2Id = shuffled[1].id;
          }
        }

        for (const slot of [1, 2]) {
          let chosenId: number | null = slot === 1 ? ref1Id : ref2Id;
          let roundNumber = 1;
          let note = isFirstGame
            ? "Erste Ansetzung der Saison (§ 3 Abs. 3)"
            : "Saison-Ansetzung alphabetisch (§ 3 Abs. 4)";

          if (!chosenId) {
            const next = findNextFreePlayer(season.id, {
              gameIdToAvoidSameGameDouble: gameId,
            });
            chosenId = next.player ? next.player.id : null;
            roundNumber = next.roundNumber;
          }

          const refCode = getNextSeasonRefCode(season.id);
          const chainRes = sqlite
            .prepare(
              `INSERT INTO assignment_chains (game_id, slot_number, ref_code, round_number, status, current_assignee_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              gameId,
              slot,
              refCode,
              roundNumber,
              chosenId ? "ASSIGNED" : "UNASSIGNED",
              chosenId,
              now
            );
          const chainId = Number(chainRes.lastInsertRowid);

          if (chosenId) {
            sqlite
              .prepare(
                `INSERT INTO handoff_events (chain_id, game_id, event_type, to_user_id, public_note, created_at)
                 VALUES (?, ?, 'INITIAL_ASSIGNMENT', ?, ?, ?)`
              )
              .run(chainId, gameId, chosenId, note, now);
          }
        }

        return sendJson(res, 201, { gameId });
      }

      // --- CSV IMPORT GAMES (§ 3) ---
      if (method === "POST" && pathname === "/api/games/import") {
        if (user.role !== "SCHIEDSRICHTERWART" && user.role !== "ADMIN") {
          return sendJson(res, 403, {
            error: "Nur der Schiedsrichterwart oder Admin darf Spielpläne importieren.",
          });
        }
        const body = await readJsonBody(req);
        const season = body.seasonId
          ? (sqlite
              .prepare("SELECT * FROM seasons WHERE id = ?")
              .get(Number(body.seasonId)) as SeasonRow | undefined)
          : getActiveSeason();
        if (!season) {
          return sendJson(res, 400, { error: "Keine gültige Saison gefunden." });
        }

        const rawRows = Array.isArray(body.rows) ? body.rows : [];
        if (rawRows.length === 0) {
          return sendJson(res, 400, { error: "Keine Spiel-Zeilen übergeben." });
        }

        const randomFirstGame = Boolean(body.randomFirstGame);
        const existingGamesCount = (
          sqlite
            .prepare("SELECT COUNT(*) as cnt FROM games WHERE season_id = ?")
            .get(season.id) as { cnt: number }
        ).cnt;

        const validRows: Array<{ title: string; kickoffAt: string; location: string }> = [];
        const seenKeys = new Set<string>();
        const existingGames = sqlite
          .prepare("SELECT title, kickoff_at FROM games WHERE season_id = ?")
          .all(season.id) as Array<{ title: string; kickoff_at: string }>;
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

        const now = new Date().toISOString();
        let createdCount = 0;

        for (let idx = 0; idx < validRows.length; idx++) {
          const item = validRows[idx];
          const isFirst = existingGamesCount === 0 && idx === 0;
          const gameRes = sqlite
            .prepare(
              "INSERT INTO games (season_id, title, location, kickoff_at, is_first_game_of_season, created_at) VALUES (?, ?, ?, ?, ?, ?)"
            )
            .run(
              season.id,
              item.title,
              item.location,
              item.kickoffAt,
              isFirst ? 1 : 0,
              now
            );
          const gameId = Number(gameRes.lastInsertRowid);

          let ref1Id: number | null = null;
          let ref2Id: number | null = null;
          if (isFirst && randomFirstGame) {
            const active = getSortedActivePlayers();
            if (active.length >= 2) {
              const shuffled = [...active].sort(() => Math.random() - 0.5);
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
              const next = findNextFreePlayer(season.id, {
                gameIdToAvoidSameGameDouble: gameId,
              });
              chosenId = next.player ? next.player.id : null;
              roundNumber = next.roundNumber;
            }

            const refCode = getNextSeasonRefCode(season.id);
            const chainRes = sqlite
              .prepare(
                `INSERT INTO assignment_chains (game_id, slot_number, ref_code, round_number, status, current_assignee_id, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
              )
              .run(
                gameId,
                slot,
                refCode,
                roundNumber,
                chosenId ? "ASSIGNED" : "UNASSIGNED",
                chosenId,
                now
              );
            const chainId = Number(chainRes.lastInsertRowid);

            if (chosenId) {
              sqlite
                .prepare(
                  `INSERT INTO handoff_events (chain_id, game_id, event_type, to_user_id, public_note, created_at)
                   VALUES (?, ?, 'INITIAL_ASSIGNMENT', ?, ?, ?)`
                )
                .run(chainId, gameId, chosenId, note, now);
            }
          }
          createdCount++;
        }

        return sendJson(res, 200, { createdCount, skippedCount, errors });
      }

      // --- UPDATE / DELETE GAME (Schiedsrichterwart / Admin) ---
      const gameMatch = pathname.match(/^\/api\/games\/(\d+)$/);
      if (gameMatch && (method === "PATCH" || method === "DELETE")) {
        if (user.role !== "SCHIEDSRICHTERWART" && user.role !== "ADMIN") {
          return sendJson(res, 403, {
            error: "Nur der Schiedsrichterwart oder Admin darf Spiele ändern oder löschen.",
          });
        }
        const gameId = Number(gameMatch[1]);
        const existingGame = sqlite
          .prepare("SELECT * FROM games WHERE id = ?")
          .get(gameId) as GameRow | undefined;
        if (!existingGame) {
          return sendJson(res, 404, { error: "Spiel nicht gefunden." });
        }

        if (method === "PATCH") {
          const body = await readJsonBody(req);
          const title = String(body.title ?? existingGame.title).trim();
          const location = String(body.location ?? existingGame.location).trim();
          const kickoffAt = String(body.kickoffAt ?? existingGame.kickoff_at).trim();
          if (!title || !kickoffAt) {
            return sendJson(res, 400, {
              error: "Spieltitel und Anpfiffzeit dürfen nicht leer sein.",
            });
          }
          sqlite
            .prepare(
              "UPDATE games SET title = ?, location = ?, kickoff_at = ? WHERE id = ?"
            )
            .run(title, location, kickoffAt, gameId);
          return sendJson(res, 200, { ok: true });
        }

        if (method === "DELETE") {
          sqlite.prepare("DELETE FROM handoff_events WHERE game_id = ?").run(gameId);
          sqlite.prepare("DELETE FROM assignment_chains WHERE game_id = ?").run(gameId);
          sqlite.prepare("DELETE FROM games WHERE id = ?").run(gameId);
          return sendJson(res, 200, { ok: true });
        }
      }

      // --- MANUAL SLOT ASSIGNMENT (Schiedsrichterwart / Admin) ---
      const manualMatch = pathname.match(/^\/api\/chains\/(\d+)\/manual-assign$/);
      if (method === "POST" && manualMatch) {
        if (user.role !== "SCHIEDSRICHTERWART" && user.role !== "ADMIN") {
          return sendJson(res, 403, {
            error: "Nur der Schiedsrichterwart oder Admin darf manuell zuweisen.",
          });
        }
        const chainId = Number(manualMatch[1]);
        const chain = sqlite
          .prepare("SELECT * FROM assignment_chains WHERE id = ?")
          .get(chainId) as ChainRow | undefined;
        if (!chain) {
          return sendJson(res, 404, { error: "Ansetzung nicht gefunden." });
        }
        const body = await readJsonBody(req);
        const targetUserId = body.userId ? Number(body.userId) : null;
        const targetStatus =
          body.status === "CONFIRMED" ? "CONFIRMED" : "ASSIGNED";
        const note = String(body.note || "").trim();

        if (!targetUserId) {
          return sendJson(res, 400, { error: "Bitte einen Spieler auswählen." });
        }
        const targetUser = getUserById(targetUserId);
        if (!targetUser) {
          return sendJson(res, 404, { error: "Spieler nicht gefunden." });
        }

        const now = new Date().toISOString();
        sqlite
          .prepare(
            `UPDATE assignment_chains
             SET current_assignee_id = ?, pending_assignee_id = NULL, voluntary_requester_id = NULL, status = ?
             WHERE id = ?`
          )
          .run(targetUserId, targetStatus, chainId);

        sqlite
          .prepare(
            `INSERT INTO handoff_events (chain_id, game_id, event_type, from_user_id, to_user_id, public_note, created_at)
             VALUES (?, ?, 'INITIAL_ASSIGNMENT', ?, ?, ?, ?)`
          )
          .run(
            chainId,
            chain.game_id,
            chain.current_assignee_id,
            targetUserId,
            note
              ? `Manuelle Zuweisung (§ 2 Abs. 4): ${note}`
              : "Manuelle Zuweisung durch Schiedsrichterwart (§ 2 Abs. 4)",
            now
          );

        return sendJson(res, 200, { ok: true });
      }

      // --- REGULAR HANDOFF & EXEMPTIONS (§ 3 Abs. 5, § 4, § 7, § 8) ---
      const handoffMatch = pathname.match(/^\/api\/chains\/(\d+)\/handoff$/);
      if (method === "POST" && handoffMatch) {
        const chainId = Number(handoffMatch[1]);
        const chain = sqlite
          .prepare("SELECT * FROM assignment_chains WHERE id = ?")
          .get(chainId) as ChainRow | undefined;
        if (!chain) {
          return sendJson(res, 404, { error: "Ansetzung nicht gefunden." });
        }

        const isPendingMode = chain.status === "PENDING_HANDOFF";
        const responsibleUserId = isPendingMode
          ? chain.pending_assignee_id
          : chain.current_assignee_id;

        if (
          responsibleUserId !== user.id &&
          user.role !== "SCHIEDSRICHTERWART"
        ) {
          return sendJson(res, 403, {
            error: "Nur die angesetzte/vorgeschlagene Person oder der Schiedsrichterwart darf weitergeben.",
          });
        }
        if (
          chain.status !== "ASSIGNED" &&
          chain.status !== "CONFIRMED" &&
          chain.status !== "VOLUNTARY_REQUESTED" &&
          chain.status !== "PENDING_HANDOFF"
        ) {
          return sendJson(res, 400, {
            error: "In diesem Status ist keine Weitergabe möglich.",
          });
        }

        const game = sqlite
          .prepare("SELECT * FROM games WHERE id = ?")
          .get(chain.game_id) as unknown as GameRow;
        const fromUser = responsibleUserId
          ? getUserById(responsibleUserId)
          : null;
        if (!fromUser) {
          return sendJson(res, 400, { error: "Kein aktueller Schiedsrichter." });
        }

        const body = await readJsonBody(req);
        const reasonType = String(body.reasonType || "REGULAR") as
          | "REGULAR"
          | "SQUAD_NOMINATION"
          | "VOLUNTEER_EXEMPT"
          | "HARDSHIP";
        const publicNote = String(body.publicNote || "").trim();
        const hardshipReasonConfidential = String(
          body.hardshipReasonConfidential || ""
        ).trim();

        if (reasonType === "VOLUNTEER_EXEMPT" && !fromUser.is_volunteer_exempt) {
          return sendJson(res, 400, {
            error:
              "Ehrenamtliche Befreiung (§ 7) erfordert die Freigabe durch den Vorstand im Spielerprofil.",
          });
        }
        if (reasonType === "HARDSHIP" && !hardshipReasonConfidential) {
          return sendJson(res, 400, {
            error:
              "Für einen Härtefallantrag (§ 8) ist eine vertrauliche Begründung für den Kassenwart erforderlich.",
          });
        }

        const shortNotice = isShortNotice48h(game.kickoff_at);
        if (shortNotice && reasonType === "REGULAR" && !publicNote) {
          return sendJson(res, 400, {
            error:
              "Kurzfristige Verhinderung (< 48h nach § 4 Abs. 2): Bitte kurzen Verhinderungsgrund angeben.",
          });
        }

        const previousFromRows = sqlite
          .prepare(
            "SELECT from_user_id FROM handoff_events WHERE chain_id = ? AND from_user_id IS NOT NULL"
          )
          .all(chainId) as Array<{ from_user_id: number }>;
        const excludeIds = [
          fromUser.id,
          ...previousFromRows.map((r) => r.from_user_id),
        ];

        let next = findNextFreePlayer(game.season_id, {
          excludeUserIds: excludeIds,
          gameIdToAvoidSameGameDouble: game.id,
          excludeVolunteerExempt: true,
          restrictToMinDeployed: true,
        });

        // Falls alle noch nicht eingesetzten Spieler in diesem Strang bereits weitergegeben haben:
        // Erneut am Anfang der noch nicht eingesetzten Spieler beginnen (niemals bereits eingesetzte vorziehen!)
        if (!next.player) {
          next = findNextFreePlayer(game.season_id, {
            excludeUserIds: [fromUser.id],
            gameIdToAvoidSameGameDouble: game.id,
            excludeVolunteerExempt: true,
            restrictToMinDeployed: true,
          });
        }

        // Nur falls überhaupt kein anderer noch nicht eingesetzter Spieler verfügbar ist (z. B. nur 1 Person übrig)
        if (!next.player) {
          next = findNextFreePlayer(game.season_id, {
            excludeUserIds: [fromUser.id],
            gameIdToAvoidSameGameDouble: game.id,
            excludeVolunteerExempt: true,
          });
        }

        if (!next.player) {
          return sendJson(res, 400, {
            error:
              "Keine freie Person mehr auf der Mannschaftsliste verfügbar. Bitte Schiedsrichterwart kontaktieren.",
          });
        }

        const isPaidHandoff =
          reasonType === "REGULAR" || reasonType === "HARDSHIP";
        const feeTotalCents = isPaidHandoff ? 1500 : 0;
        const teamPotCents = isPaidHandoff ? 500 : 0;
        const payoutPoolCents = isPaidHandoff ? 1000 : 0;
        const paymentStatus = isPaidHandoff ? "OPEN" : "NOT_APPLICABLE";
        const hardshipStatus = reasonType === "HARDSHIP" ? "PENDING" : "NONE";
        const eventType =
          reasonType === "SQUAD_NOMINATION"
            ? "SQUAD_NOMINATION"
            : "REGULAR_HANDOFF";

        const now = new Date().toISOString();

        sqlite
          .prepare(
            `UPDATE assignment_chains
             SET status = 'PENDING_HANDOFF',
                 current_assignee_id = ?,
                 pending_assignee_id = ?,
                 voluntary_requester_id = NULL,
                 round_number = ?,
                 team_pot_cents = team_pot_cents + ?,
                 payout_pool_cents = payout_pool_cents + ?
             WHERE id = ?`
          )
          .run(
            isPendingMode ? null : chain.current_assignee_id,
            next.player.id,
            next.roundNumber,
            teamPotCents,
            payoutPoolCents,
            chainId
          );

        sqlite
          .prepare(
            `INSERT INTO handoff_events (
               chain_id, game_id, event_type, from_user_id, to_user_id, reason_type,
               is_short_notice, public_note, fee_total_cents, team_pot_cents, payout_pool_cents,
               payment_status, hardship_status, hardship_reason_confidential, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            chainId,
            game.id,
            eventType,
            fromUser.id,
            next.player.id,
            reasonType,
            shortNotice ? 1 : 0,
            publicNote || null,
            feeTotalCents,
            teamPotCents,
            payoutPoolCents,
            paymentStatus,
            hardshipStatus,
            reasonType === "HARDSHIP" ? hardshipReasonConfidential : null,
            now
          );

        const chatType =
          reasonType === "SQUAD_NOMINATION"
            ? "SQUAD_NOMINATION"
            : reasonType === "VOLUNTEER_EXEMPT"
            ? "VOLUNTEER_EXEMPT"
            : reasonType === "HARDSHIP"
            ? "HARDSHIP"
            : "REGULAR_HANDOFF";

        const chatMessage = buildGroupChatMessage({
          type: chatType,
          gameTitle: game.title,
          kickoffAt: game.kickoff_at,
          slotNumber: chain.slot_number,
          refCode: chain.ref_code,
          fromName: getFullName(fromUser),
          toName: getFullName(next.player),
          isShortNotice: shortNotice,
        });

        return sendJson(res, 200, {
          ok: true,
          nextAssignee: next.player,
          chatMessage,
        });
      }

      // --- HANDOFF / ASSIGNMENT RESPONSE (ACCEPT -> CONFIRMED) ---
      const respMatch = pathname.match(
        /^\/api\/chains\/(\d+)\/handoff-response$/
      );
      if (method === "POST" && respMatch) {
        const chainId = Number(respMatch[1]);
        const chain = sqlite
          .prepare("SELECT * FROM assignment_chains WHERE id = ?")
          .get(chainId) as ChainRow | undefined;
        if (
          !chain ||
          (chain.status !== "PENDING_HANDOFF" && chain.status !== "ASSIGNED")
        ) {
          return sendJson(res, 400, {
            error: "Keine unbestätigte Ansetzung oder Weitergabe vorhanden.",
          });
        }

        const targetUserId =
          chain.status === "PENDING_HANDOFF"
            ? chain.pending_assignee_id
            : chain.current_assignee_id;

        if (
          targetUserId !== user.id &&
          user.role !== "SCHIEDSRICHTERWART"
        ) {
          return sendJson(res, 403, {
            error: "Nur die zugewiesene/vorgeschlagene Person oder der Schiedsrichterwart darf annehmen.",
          });
        }

        const game = sqlite
          .prepare("SELECT * FROM games WHERE id = ?")
          .get(chain.game_id) as unknown as GameRow;
        const acceptedUser = targetUserId ? getUserById(targetUserId) : null;
        if (!acceptedUser) {
          return sendJson(res, 400, { error: "Zugewiesene Person fehlt." });
        }

        const body = await readJsonBody(req);
        const action = String(body.action || "");
        const now = new Date().toISOString();

        if (action === "ACCEPT") {
          sqlite
            .prepare(
              `UPDATE assignment_chains
               SET current_assignee_id = ?, pending_assignee_id = NULL, status = 'CONFIRMED'
               WHERE id = ?`
            )
            .run(acceptedUser.id, chainId);

          sqlite
            .prepare(
              `INSERT INTO handoff_events (chain_id, game_id, event_type, to_user_id, public_note, created_at)
               VALUES (?, ?, 'HANDOFF_ACCEPTED', ?, 'Ansetzung angenommen und bestätigt', ?)`
            )
            .run(chainId, game.id, acceptedUser.id, now);

          const chatMessage = buildGroupChatMessage({
            type: "HANDOFF_ACCEPTED",
            gameTitle: game.title,
            kickoffAt: game.kickoff_at,
            slotNumber: chain.slot_number,
            toName: getFullName(acceptedUser),
          });
          return sendJson(res, 200, { ok: true, chatMessage });
        }

        return sendJson(res, 400, {
          error:
            "Ungültige Aktion. Zum Weitergeben bitte eine der Optionen (Ehrenamt, Härtefall oder 15,00 € Zahlung) wählen.",
        });
      }

      // --- VOLUNTARY TAKEOVER OF UNCONFIRMED GAME ---
      const volReqMatch = pathname.match(/^\/api\/chains\/(\d+)\/volunteer$/);
      if (method === "POST" && volReqMatch) {
        const chainId = Number(volReqMatch[1]);
        const chain = sqlite
          .prepare("SELECT * FROM assignment_chains WHERE id = ?")
          .get(chainId) as ChainRow | undefined;
        if (
          !chain ||
          (chain.status !== "ASSIGNED" && chain.status !== "PENDING_HANDOFF")
        ) {
          return sendJson(res, 400, {
            error: "Es können nur unbestätigte Spiele übernommen werden.",
          });
        }
        const responsibleUserId =
          chain.pending_assignee_id ?? chain.current_assignee_id;
        if (responsibleUserId === user.id) {
          return sendJson(res, 400, {
            error: "Du bist bereits für dieses Spiel zugewiesen.",
          });
        }

        const targetGame = sqlite
          .prepare("SELECT * FROM games WHERE id = ?")
          .get(chain.game_id) as unknown as GameRow;

        const now = new Date().toISOString();
        sqlite
          .prepare(
            `UPDATE assignment_chains
             SET status = 'VOLUNTARY_REQUESTED', voluntary_requester_id = ?
             WHERE id = ?`
          )
          .run(user.id, chainId);

        sqlite
          .prepare(
            `INSERT INTO handoff_events (chain_id, game_id, event_type, from_user_id, to_user_id, reason_type, public_note, created_at)
             VALUES (?, ?, 'VOLUNTEER_REQUEST', ?, ?, 'VOLUNTARY_TAKEOVER', 'Übernahme eines unbestätigten Spiels angefragt', ?)`
          )
          .run(chainId, targetGame.id, responsibleUserId, user.id, now);

        const fromUser = responsibleUserId
          ? getUserById(responsibleUserId)
          : null;
        const chatMessage = buildGroupChatMessage({
          type: "VOLUNTARY_REQUEST",
          gameTitle: targetGame.title,
          kickoffAt: targetGame.kickoff_at,
          slotNumber: chain.slot_number,
          fromName: getFullName(fromUser),
          toName: getFullName(user),
        });
        return sendJson(res, 200, { ok: true, chatMessage });
      }

      // --- VOLUNTARY DECISION ---
      const volDecMatch = pathname.match(
        /^\/api\/chains\/(\d+)\/volunteer-decision$/
      );
      if (method === "POST" && volDecMatch) {
        const chainId = Number(volDecMatch[1]);
        const chain = sqlite
          .prepare("SELECT * FROM assignment_chains WHERE id = ?")
          .get(chainId) as ChainRow | undefined;
        if (
          !chain ||
          chain.status !== "VOLUNTARY_REQUESTED" ||
          !chain.voluntary_requester_id
        ) {
          return sendJson(res, 400, {
            error: "Keine offene Übernahmeanfrage vorhanden.",
          });
        }
        const responsibleUserId =
          chain.pending_assignee_id ?? chain.current_assignee_id;
        if (
          responsibleUserId !== user.id &&
          user.role !== "SCHIEDSRICHTERWART"
        ) {
          return sendJson(res, 403, {
            error: "Nur der aktuell zugewiesene Schiedsrichter entscheidet.",
          });
        }

        const body = await readJsonBody(req);
        const action = String(body.action || "");
        const targetGame = sqlite
          .prepare("SELECT * FROM games WHERE id = ?")
          .get(chain.game_id) as unknown as GameRow;
        const fromUser = responsibleUserId
          ? getUserById(responsibleUserId)
          : null;
        const volunteer = getUserById(chain.voluntary_requester_id);
        const now = new Date().toISOString();

        if (action === "REJECT") {
          sqlite
            .prepare(
              `UPDATE assignment_chains
               SET current_assignee_id = ?, pending_assignee_id = NULL, status = 'CONFIRMED', voluntary_requester_id = NULL
               WHERE id = ?`
            )
            .run(responsibleUserId, chainId);
          sqlite
            .prepare(
              `INSERT INTO handoff_events (chain_id, game_id, event_type, from_user_id, to_user_id, public_note, created_at)
               VALUES (?, ?, 'VOLUNTEER_REJECTED', ?, ?, 'Übernahme abgelehnt – zugewiesener Spieler automatisch als bestätigt gesetzt', ?)`
            )
            .run(chainId, targetGame.id, responsibleUserId, volunteer?.id ?? null, now);
          return sendJson(res, 200, { ok: true });
        }

        if (action === "APPROVE" && volunteer) {
          sqlite
            .prepare(
              `UPDATE assignment_chains
               SET current_assignee_id = ?, pending_assignee_id = NULL, voluntary_requester_id = NULL, status = 'CONFIRMED'
               WHERE id = ?`
            )
            .run(volunteer.id, chainId);

          sqlite
            .prepare(
              `INSERT INTO handoff_events (chain_id, game_id, event_type, from_user_id, to_user_id, reason_type, public_note, created_at)
               VALUES (?, ?, 'VOLUNTEER_APPROVED', ?, ?, 'VOLUNTARY_TAKEOVER', 'Übernahme bestätigt', ?)`
            )
            .run(chainId, targetGame.id, responsibleUserId, volunteer.id, now);

          // Spätere Ansetzung des Freiwilligen automatisch ohne Zahlung weitergeben (§ 5 Abs. 5)
          const laterChain = sqlite
            .prepare(
              `SELECT ac.*, g.title as g_title FROM assignment_chains ac
               JOIN games g ON g.id = ac.game_id
               WHERE g.season_id = ? AND g.kickoff_at > ? AND ac.current_assignee_id = ? AND ac.status IN ('ASSIGNED', 'CONFIRMED')
               ORDER BY g.kickoff_at ASC LIMIT 1`
            )
            .get(
              targetGame.season_id,
              targetGame.kickoff_at,
              volunteer.id
            ) as (ChainRow & { g_title: string }) | undefined;

          let laterGameTitle: string | undefined;
          let laterToName: string | undefined;

          if (laterChain) {
            laterGameTitle = laterChain.g_title;
            const nextForLater = findNextFreePlayer(targetGame.season_id, {
              excludeUserIds: [volunteer.id],
              gameIdToAvoidSameGameDouble: laterChain.game_id,
              excludeVolunteerExempt: true,
            });

            if (nextForLater.player) {
              laterToName = getFullName(nextForLater.player);
              sqlite
                .prepare(
                  `UPDATE assignment_chains
                   SET status = 'PENDING_HANDOFF', pending_assignee_id = ?, round_number = ?
                   WHERE id = ?`
                )
                .run(nextForLater.player.id, nextForLater.roundNumber, laterChain.id);

              sqlite
                .prepare(
                  `INSERT INTO handoff_events (chain_id, game_id, event_type, from_user_id, to_user_id, public_note, created_at)
                   VALUES (?, ?, 'VOLUNTEER_AUTO_FORWARD', ?, ?, 'Spätere Ansetzung nach § 5 Abs. 5 ohne Zahlung weitergegeben', ?)`
                )
                .run(
                  laterChain.id,
                  laterChain.game_id,
                  volunteer.id,
                  nextForLater.player.id,
                  now
                );
            }
          }

          const chatMessage = buildGroupChatMessage({
            type: "VOLUNTARY_APPROVED",
            gameTitle: targetGame.title,
            kickoffAt: targetGame.kickoff_at,
            slotNumber: chain.slot_number,
            fromName: getFullName(fromUser),
            toName: getFullName(volunteer),
            payoutPoolCents: chain.payout_pool_cents,
            laterGameTitle,
            laterToName,
          });
          return sendJson(res, 200, { ok: true, chatMessage });
        }

        return sendJson(res, 400, { error: "Ungültige Aktion." });
      }

      // --- REPORT DEPLOYED (§ 6 Abs. 2) ---
      const repMatch = pathname.match(
        /^\/api\/chains\/(\d+)\/report-deployed$/
      );
      if (method === "POST" && repMatch) {
        const chainId = Number(repMatch[1]);
        const chain = sqlite
          .prepare("SELECT * FROM assignment_chains WHERE id = ?")
          .get(chainId) as ChainRow | undefined;
        if (
          !chain ||
          (chain.status !== "ASSIGNED" && chain.status !== "CONFIRMED")
        ) {
          return sendJson(res, 400, {
            error: "Einsatz kann nur im Status 'Zugewiesen' oder 'Bestätigt' gemeldet werden.",
          });
        }
        if (
          chain.current_assignee_id !== user.id &&
          user.role !== "SCHIEDSRICHTERWART"
        ) {
          return sendJson(res, 403, { error: "Nicht berechtigt." });
        }

        const game = sqlite
          .prepare("SELECT * FROM games WHERE id = ?")
          .get(chain.game_id) as unknown as GameRow;
        if (
          user.role !== "SCHIEDSRICHTERWART" &&
          user.role !== "ADMIN" &&
          new Date(game.kickoff_at).getTime() > Date.now()
        ) {
          return sendJson(res, 400, {
            error:
              "Einsatz kann erst ab Spielbeginn als gepfiffen gemeldet werden (§ 1 Abs. 4).",
          });
        }
        const assignee = chain.current_assignee_id
          ? getUserById(chain.current_assignee_id)
          : null;
        const now = new Date().toISOString();

        sqlite
          .prepare(
            `UPDATE assignment_chains
             SET status = 'REPORTED_DEPLOYED', reported_deployed_at = ?
             WHERE id = ?`
          )
          .run(now, chainId);

        sqlite
          .prepare(
            `INSERT INTO handoff_events (chain_id, game_id, event_type, from_user_id, public_note, created_at)
             VALUES (?, ?, 'REPORTED_DEPLOYED', ?, 'Einsatz als gepfiffen gemeldet (§ 6 Abs. 2)', ?)`
          )
          .run(chainId, game.id, chain.current_assignee_id, now);

        const chatMessage = buildGroupChatMessage({
          type: "REPORTED_DEPLOYED",
          gameTitle: game.title,
          kickoffAt: game.kickoff_at,
          slotNumber: chain.slot_number,
          fromName: getFullName(assignee),
        });
        return sendJson(res, 200, { ok: true, chatMessage });
      }

      // --- CONFIRM DEPLOYED (§ 1 Abs. 4, § 6 Abs. 1) ---
      const confMatch = pathname.match(
        /^\/api\/chains\/(\d+)\/confirm-deployed$/
      );
      if (method === "POST" && confMatch) {
        if (user.role !== "SCHIEDSRICHTERWART") {
          return sendJson(res, 403, {
            error: "Nur der Schiedsrichterwart bestätigt den tatsächlichen Einsatz.",
          });
        }
        const chainId = Number(confMatch[1]);
        const chain = sqlite
          .prepare("SELECT * FROM assignment_chains WHERE id = ?")
          .get(chainId) as ChainRow | undefined;
        if (
          !chain ||
          (chain.status !== "ASSIGNED" &&
            chain.status !== "CONFIRMED" &&
            chain.status !== "REPORTED_DEPLOYED")
        ) {
          return sendJson(res, 400, {
            error: "Einsatz kann in diesem Status nicht bestätigt werden.",
          });
        }

        const game = sqlite
          .prepare("SELECT * FROM games WHERE id = ?")
          .get(chain.game_id) as unknown as GameRow;
        if (
          user.role !== "SCHIEDSRICHTERWART" &&
          user.role !== "ADMIN" &&
          new Date(game.kickoff_at).getTime() > Date.now()
        ) {
          return sendJson(res, 400, {
            error:
              "Einsatz kann erst ab Spielbeginn als gepfiffen gemeldet werden (§ 1 Abs. 4).",
          });
        }
        const assignee = chain.current_assignee_id
          ? getUserById(chain.current_assignee_id)
          : null;
        const now = new Date().toISOString();

        sqlite
          .prepare(
            `UPDATE assignment_chains
             SET status = 'CONFIRMED_DEPLOYED', confirmed_deployed_at = ?, confirmed_by_id = ?
             WHERE id = ?`
          )
          .run(now, user.id, chainId);

        sqlite
          .prepare(
            `INSERT INTO handoff_events (chain_id, game_id, event_type, from_user_id, public_note, created_at)
             VALUES (?, ?, 'CONFIRMED_DEPLOYED', ?, 'Tatsächlicher Einsatz bestätigt (§ 1 Abs. 4, § 6 Abs. 1)', ?)`
          )
          .run(chainId, game.id, chain.current_assignee_id, now);

        const chatMessage = buildGroupChatMessage({
          type: "CONFIRMED_DEPLOYED",
          gameTitle: game.title,
          kickoffAt: game.kickoff_at,
          slotNumber: chain.slot_number,
          fromName: getFullName(assignee),
        });
        return sendJson(res, 200, { ok: true, chatMessage });
      }

      // --- TREASURER: MARK PAYMENT PAID (§ 6 Abs. 1 & 3) ---
      const payMatch = pathname.match(/^\/api\/events\/(\d+)\/payment$/);
      if (method === "POST" && payMatch) {
        if (user.role !== "KASSENWART") {
          return sendJson(res, 403, {
            error: "Nur der Mannschaftskassenwart darf Zahlungen verbuchen.",
          });
        }
        const eventId = Number(payMatch[1]);
        sqlite
          .prepare(
            "UPDATE handoff_events SET payment_status = 'PAID' WHERE id = ? AND payment_status IN ('OPEN', 'WAIVED_PARTIAL')"
          )
          .run(eventId);
        return sendJson(res, 200, { ok: true });
      }

      // --- TREASURER: HARDSHIP DECISION (§ 8) ---
      const hardMatch = pathname.match(/^\/api\/events\/(\d+)\/hardship$/);
      if (method === "POST" && hardMatch) {
        if (user.role !== "KASSENWART") {
          return sendJson(res, 403, {
            error: "Nur der Mannschaftskassenwart entscheidet über Härtefälle (§ 8 Abs. 3).",
          });
        }
        const eventId = Number(hardMatch[1]);
        const ev = sqlite
          .prepare("SELECT * FROM handoff_events WHERE id = ?")
          .get(eventId) as EventRow | undefined;
        if (!ev || ev.hardship_status !== "PENDING") {
          return sendJson(res, 400, {
            error: "Kein offener Härtefallantrag gefunden.",
          });
        }

        const body = await readJsonBody(req);
        const decision = String(body.decision || "");

        if (decision === "APPROVED_FULL") {
          sqlite
            .prepare(
              `UPDATE handoff_events
               SET hardship_status = 'APPROVED_FULL',
                   payment_status = 'WAIVED_FULL',
                   waived_amount_cents = fee_total_cents,
                   public_note = 'Anerkannter Härtefall (§ 8 Abs. 4 – vollständiger Verzicht)'
               WHERE id = ?`
            )
            .run(eventId);

          sqlite
            .prepare(
              `UPDATE assignment_chains
               SET team_pot_cents = MAX(0, team_pot_cents - ?),
                   payout_pool_cents = MAX(0, payout_pool_cents - ?)
               WHERE id = ?`
            )
            .run(ev.team_pot_cents, ev.payout_pool_cents, ev.chain_id);

          return sendJson(res, 200, { ok: true });
        }

        if (decision === "APPROVED_PARTIAL") {
          const waivedCents = Math.min(
            ev.fee_total_cents,
            Math.max(100, Number(body.waivedAmountCents || 500))
          );
          sqlite
            .prepare(
              `UPDATE handoff_events
               SET hardship_status = 'APPROVED_PARTIAL',
                   payment_status = 'OPEN',
                   waived_amount_cents = ?,
                   public_note = 'Anerkannter Härtefall (§ 8 Abs. 4 – Teilverzicht)'
               WHERE id = ?`
            )
            .run(waivedCents, eventId);
          return sendJson(res, 200, { ok: true });
        }

        if (decision === "REJECTED") {
          sqlite
            .prepare(
              `UPDATE handoff_events
               SET hardship_status = 'REJECTED'
               WHERE id = ?`
            )
            .run(eventId);
          return sendJson(res, 200, { ok: true });
        }

        return sendJson(res, 400, { error: "Ungültige Entscheidung." });
      }

      // --- TREASURER: SETTLE PAYOUT POOL ---
      const settleMatch = pathname.match(
        /^\/api\/chains\/(\d+)\/settle-payout$/
      );
      if (method === "POST" && settleMatch) {
        if (user.role !== "KASSENWART") {
          return sendJson(res, 403, {
            error: "Nur der Kassenwart darf Auszahlungen verbuchen.",
          });
        }
        const chainId = Number(settleMatch[1]);
        const chain = sqlite
          .prepare("SELECT * FROM assignment_chains WHERE id = ?")
          .get(chainId) as ChainRow | undefined;
        if (!chain || chain.status !== "CONFIRMED_DEPLOYED") {
          return sendJson(res, 400, {
            error: "Auszahlung erst nach bestätigtem Einsatz möglich (§ 5 Abs. 4).",
          });
        }
        sqlite
          .prepare("UPDATE assignment_chains SET payout_settled = 1 WHERE id = ?")
          .run(chainId);
        sqlite
          .prepare(
            `INSERT INTO handoff_events (chain_id, game_id, event_type, to_user_id, payout_pool_cents, public_note, created_at)
             VALUES (?, ?, 'PAYOUT_SETTLED', ?, ?, 'Auszahlungsbetrag an Schiedsrichter ausgezahlt', ?)`
          )
          .run(
            chainId,
            chain.game_id,
            chain.current_assignee_id,
            chain.payout_pool_cents,
            new Date().toISOString()
          );
        return sendJson(res, 200, { ok: true });
      }

      return sendJson(res, 404, { error: "API-Endpunkt nicht gefunden." });
    }

    // --- STATIC UI ---
    if (serveStatic(pathname, res)) return;
    if (serveStatic("/index.html", res)) return;
    res.writeHead(404);
    res.end("Not found");
  } catch (err) {
    console.error("Server error:", err);
    sendJson(res, 500, { error: "Interner Serverfehler." });
  }
});

server.listen(PORT, () => {
  console.log(`RHTC II Schiedsrichter-App läuft auf http://localhost:${PORT}`);
});
