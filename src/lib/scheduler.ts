import {
  sqlite,
  type ChainRow,
  type EventRow,
  type GameRow,
  type SafeUser,
  type UserRow,
} from "../db/index.ts";
import { repo } from "./repository.ts";

export function formatEuro(cents: number): string {
  return (cents / 100).toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
  });
}

export function formatDateTimeDE(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Prüft die 48-Stunden-Frist nach § 4 Abs. 2.
 */
export function isShortNotice48h(kickoffAt: string): boolean {
  const kickoffMs = new Date(kickoffAt).getTime();
  const diffHours = (kickoffMs - Date.now()) / (1000 * 60 * 60);
  return diffHours < 48;
}

export function sortPlayersList(users: UserRow[]): SafeUser[] {
  return users
    .map(({ password_hash: _, ...u }) => u)
    .sort((a, b) => {
      const ovA = a.list_order_override ?? Number.MAX_SAFE_INTEGER;
      const ovB = b.list_order_override ?? Number.MAX_SAFE_INTEGER;
      if (ovA !== ovB) return ovA - ovB;
      const lastCmp = a.last_name.localeCompare(b.last_name, "de", {
        sensitivity: "base",
      });
      if (lastCmp !== 0) return lastCmp;
      return a.first_name.localeCompare(b.first_name, "de", {
        sensitivity: "base",
      });
    });
}

export async function getSortedActivePlayersAsync(): Promise<SafeUser[]> {
  const users = await repo.users.listActive();
  return sortPlayersList(users);
}

/**
 * Liefert die aktive Schiedsrichterliste sortiert nach § 2 Abs. 2 & 4.
 */
export function getSortedActivePlayers(): SafeUser[] {
  const rows = sqlite
    .prepare("SELECT * FROM users WHERE is_active_in_list = 1")
    .all() as unknown as UserRow[];
  return sortPlayersList(rows);
}

export function findNextFreePlayerWithData(
  allActivePlayers: SafeUser[],
  allChains: ChainRow[],
  skippedUserIds: number[],
  options: {
    excludeUserIds?: number[];
    gameIdToAvoidSameGameDouble?: number;
    excludeVolunteerExempt?: boolean;
    restrictToMinDeployed?: boolean;
    deployedOverrides?: Record<string, number>;
  } = {}
): { player: SafeUser | null; roundNumber: number } {
  const sortedPlayers = options.excludeVolunteerExempt
    ? allActivePlayers.filter((p) => !p.is_volunteer_exempt)
    : allActivePlayers;
  if (sortedPlayers.length === 0) {
    return { player: null, roundNumber: 1 };
  }

  const excludeSet = new Set<number>(options.excludeUserIds ?? []);

  if (options.gameIdToAvoidSameGameDouble) {
    const sameGameChains = allChains.filter(
      (c) => c.game_id === options.gameIdToAvoidSameGameDouble
    );
    for (const c of sameGameChains) {
      if (c.current_assignee_id) excludeSet.add(c.current_assignee_id);
      if (c.pending_assignee_id) excludeSet.add(c.pending_assignee_id);
    }
    for (const uid of skippedUserIds) {
      excludeSet.add(uid);
    }
  }

  // Zähle tatsächliche Einsätze (CONFIRMED_DEPLOYED) und laufende Ansetzungen pro Spieler
  const deployedCounts = new Map<number, number>();
  const activeAssignedCounts = new Map<number, number>();
  for (const p of sortedPlayers) {
    const rawOv = options.deployedOverrides
      ? options.deployedOverrides[String(p.id)]
      : undefined;
    deployedCounts.set(p.id, rawOv !== undefined ? Number(rawOv) : 0);
    activeAssignedCounts.set(p.id, 0);
  }

  for (const c of allChains) {
    if (c.status === "CONFIRMED_DEPLOYED" && c.current_assignee_id) {
      const isOverridden = options.deployedOverrides &&
        options.deployedOverrides[String(c.current_assignee_id)] !== undefined;
      if (deployedCounts.has(c.current_assignee_id) && !isOverridden) {
        deployedCounts.set(
          c.current_assignee_id,
          (deployedCounts.get(c.current_assignee_id) ?? 0) + 1
        );
      }
    } else if (c.status !== "UNASSIGNED") {
      if (
        c.current_assignee_id &&
        activeAssignedCounts.has(c.current_assignee_id)
      ) {
        activeAssignedCounts.set(
          c.current_assignee_id,
          (activeAssignedCounts.get(c.current_assignee_id) ?? 0) + 1
        );
      }
      if (
        c.pending_assignee_id &&
        activeAssignedCounts.has(c.pending_assignee_id)
      ) {
        activeAssignedCounts.set(
          c.pending_assignee_id,
          (activeAssignedCounts.get(c.pending_assignee_id) ?? 0) + 1
        );
      }
    }
  }

  const minDeployed = Math.min(
    ...sortedPlayers.map((p) => deployedCounts.get(p.id) ?? 0)
  );
  const roundNumber = minDeployed + 1;

  // 1. Priorität: Noch nicht in dieser Einsatz-Runde eingesetzt UND aktuell nicht anderweitig angesetzt
  let candidate = sortedPlayers.find(
    (p) =>
      (deployedCounts.get(p.id) ?? 0) === minDeployed &&
      (activeAssignedCounts.get(p.id) ?? 0) === 0 &&
      !excludeSet.has(p.id)
  );
  if (candidate) {
    return { player: candidate, roundNumber };
  }

  // 2. Priorität: Noch nicht in dieser Einsatz-Runde eingesetzt (auch wenn bereits für ein späteres Spiel angesetzt)
  candidate = sortedPlayers.find(
    (p) =>
      (deployedCounts.get(p.id) ?? 0) === minDeployed &&
      !excludeSet.has(p.id)
  );
  if (candidate) {
    return { player: candidate, roundNumber };
  }

  if (options.restrictToMinDeployed) {
    return { player: null, roundNumber };
  }

  // 3. Priorität: Aktuell nicht anderweitig angesetzt (sortiert nach wenigsten Einsätzen, dann A-Z)
  const byDeployed = [...sortedPlayers].sort(
    (a, b) => (deployedCounts.get(a.id) ?? 0) - (deployedCounts.get(b.id) ?? 0)
  );
  candidate = byDeployed.find(
    (p) => (activeAssignedCounts.get(p.id) ?? 0) === 0 && !excludeSet.has(p.id)
  );
  if (candidate) {
    return { player: candidate, roundNumber };
  }

  // 4. Fallback: Wenigste Einsätze, nicht in excludeSet
  candidate = byDeployed.find((p) => !excludeSet.has(p.id));
  return { player: candidate ?? null, roundNumber };
}

export async function findNextFreePlayerAsync(
  seasonId: number,
  options: {
    excludeUserIds?: number[];
    gameIdToAvoidSameGameDouble?: number;
    excludeVolunteerExempt?: boolean;
    restrictToMinDeployed?: boolean;
    deployedOverrides?: Record<string, number>;
  } = {}
): Promise<{ player: SafeUser | null; roundNumber: number }> {
  let deployedOverrides = options.deployedOverrides;
  if (!deployedOverrides) {
    try {
      const raw = await repo.settings.get("deployed_count_overrides");
      if (raw) deployedOverrides = JSON.parse(raw);
    } catch {}
  }
  const [activePlayers, seasonGames] = await Promise.all([
    getSortedActivePlayersAsync(),
    repo.games.listBySeason(seasonId),
  ]);
  const gameIds = seasonGames.map((g) => g.id);
  const [chains, events] = await Promise.all([
    repo.chains.listByGameIds(gameIds),
    options.gameIdToAvoidSameGameDouble
      ? repo.events.listByGameIds([options.gameIdToAvoidSameGameDouble])
      : Promise.resolve([]),
  ]);
  const skippedUserIds = events
    .filter((e) => e.event_type === "HANDOFF_SKIPPED_UNAVAILABLE" && e.from_user_id)
    .map((e) => e.from_user_id as number);

  return findNextFreePlayerWithData(activePlayers, chains, skippedUserIds, {
    ...options,
    deployedOverrides,
  });
}

export async function getNextSeasonRefCodeAsync(seasonId: number): Promise<string> {
  const seasonGames = await repo.games.listBySeason(seasonId);
  const chains = await repo.chains.listByGameIds(seasonGames.map((g) => g.id));
  let maxNum = 0;
  for (const c of chains) {
    if (c.ref_code) {
      const m = c.ref_code.match(/^SR-(\d+)$/);
      if (m) {
        const n = Number(m[1]);
        if (n > maxNum) maxNum = n;
      }
    }
  }
  return `SR-${String(maxNum + 1).padStart(3, "0")}`;
}

/**
 * Ermittelt gemäß § 1 Abs. 5, § 3 Abs. 4 & 7 die alphabetisch nächste freie Person:
 * Spieler, die bereits eingesetzt wurden (CONFIRMED_DEPLOYED), werden erst dann
 * wieder zugeordnet, wenn alle anderen aktiven Spieler ebenfalls eingesetzt wurden.
 */
export function findNextFreePlayer(
  seasonId: number,
  options: {
    excludeUserIds?: number[];
    gameIdToAvoidSameGameDouble?: number;
    excludeVolunteerExempt?: boolean;
    restrictToMinDeployed?: boolean;
    deployedOverrides?: Record<string, number>;
  } = {}
): { player: SafeUser | null; roundNumber: number } {
  let deployedOverrides = options.deployedOverrides;
  if (!deployedOverrides) {
    try {
      const row = sqlite
        .prepare("SELECT value FROM app_settings WHERE key = 'deployed_count_overrides'")
        .get() as { value: string } | undefined;
      if (row?.value) deployedOverrides = JSON.parse(row.value);
    } catch {}
  }
  const allActive = getSortedActivePlayers();
  const seasonGames = sqlite
    .prepare("SELECT id FROM games WHERE season_id = ?")
    .all(seasonId) as unknown as Array<{ id: number }>;

  let allChains: ChainRow[] = [];
  if (seasonGames.length > 0) {
    const placeholders = seasonGames.map(() => "?").join(",");
    allChains = sqlite
      .prepare(
        `SELECT * FROM assignment_chains WHERE game_id IN (${placeholders})`
      )
      .all(...seasonGames.map((g) => g.id)) as unknown as ChainRow[];
  }

  let skippedUserIds: number[] = [];
  if (options.gameIdToAvoidSameGameDouble) {
    const skippedEvents = sqlite
      .prepare(
        "SELECT from_user_id FROM handoff_events WHERE game_id = ? AND event_type = 'HANDOFF_SKIPPED_UNAVAILABLE'"
      )
      .all(options.gameIdToAvoidSameGameDouble) as unknown as Array<{
      from_user_id: number | null;
    }>;
    skippedUserIds = skippedEvents
      .filter((e) => e.from_user_id)
      .map((e) => e.from_user_id as number);
  }

  return findNextFreePlayerWithData(allActive, allChains, skippedUserIds, {
    ...options,
    deployedOverrides,
  });
}

export function getNextSeasonRefCode(seasonId: number): string {
  const rows = sqlite
    .prepare(
      `SELECT ac.ref_code FROM assignment_chains ac
       JOIN games g ON g.id = ac.game_id
       WHERE g.season_id = ? AND ac.ref_code IS NOT NULL`
    )
    .all(seasonId) as Array<{ ref_code: string }>;

  let maxNum = 0;
  for (const r of rows) {
    const m = r.ref_code.match(/^SR-(\d+)$/);
    if (m) {
      const n = Number(m[1]);
      if (n > maxNum) maxNum = n;
    }
  }
  return `SR-${String(maxNum + 1).padStart(3, "0")}`;
}

export function buildGroupChatMessage(params: {
  type:
    | "REGULAR_HANDOFF"
    | "HANDOFF_ACCEPTED"
    | "HANDOFF_SKIPPED"
    | "SQUAD_NOMINATION"
    | "VOLUNTEER_EXEMPT"
    | "HARDSHIP"
    | "VOLUNTARY_REQUEST"
    | "VOLUNTARY_APPROVED"
    | "REPORTED_DEPLOYED"
    | "CONFIRMED_DEPLOYED";
  gameTitle: string;
  kickoffAt: string;
  slotNumber: number;
  refCode?: string | null;
  fromName?: string;
  toName?: string;
  isShortNotice?: boolean;
  payoutPoolCents?: number;
  laterGameTitle?: string;
  laterToName?: string;
}): string {
  const dateStr = formatDateTimeDE(params.kickoffAt);
  const slotLabel = params.refCode
    ? `${params.refCode}, Schiri-Slot ${params.slotNumber}`
    : `Schiri-Slot ${params.slotNumber}`;
  const fristHinweis = params.isShortNotice ? " (kurzfristig < 48h)" : "";

  switch (params.type) {
    case "REGULAR_HANDOFF":
      return `📣 Schiri-Weitergabe (§ 4)${fristHinweis}\nSpiel: ${params.gameTitle} (${dateStr}, ${slotLabel})\n${params.fromName} gibt ab (15,00 €: 5 € Kasse / 10 € Topf).\nNächste freie Person laut Liste: ${params.toName} – bitte kurz in der App bestätigen oder als verhindert markieren.`;
    case "HANDOFF_ACCEPTED":
      return `✅ Schiri-Ansetzung bestätigt\nSpiel: ${params.gameTitle} (${dateStr}, ${slotLabel})\n${params.toName} hat die Weitergabe angenommen und ist nun angesetzt.`;
    case "HANDOFF_SKIPPED":
      return `⏭️ Nächste freie Person verhindert (§ 4 Abs. 5)\nSpiel: ${params.gameTitle} (${dateStr}, ${slotLabel})\n${params.fromName} ist verhindert und wird übersprungen. Nächste freie Person: ${params.toName ?? "offen (keine freie Person)"}.`;
    case "SQUAD_NOMINATION":
      return `🏑 Kaderberufung (§ 3 Abs. 5)\nSpiel: ${params.gameTitle} (${dateStr}, ${slotLabel})\n${params.fromName} wurde in den Spieltagskader berufen (keine Zahlung). Weitergabe an nächste freie Person: ${params.toName}.`;
    case "VOLUNTEER_EXEMPT":
      return `🤝 Ehrenamtliche Befreiung (§ 7)\nSpiel: ${params.gameTitle} (${dateStr}, ${slotLabel})\n${params.fromName} gibt aufgrund anerkannter ehrenamtlicher Tätigkeit im RHTC ohne Zahlung ab an: ${params.toName}.`;
    case "HARDSHIP":
      return `ℹ️ Weitergabe mit Härtefallantrag (§ 8)\nSpiel: ${params.gameTitle} (${dateStr}, ${slotLabel})\n${params.fromName} gibt an die nächste freie Person ${params.toName} weiter (Härtefallprüfung vertraulich beim Kassenwart).`;
    case "VOLUNTARY_REQUEST":
      return `🙋 Freiwillige vorgezogene Übernahme angefragt (§ 5)\nSpiel: ${params.gameTitle} (${dateStr}, ${slotLabel})\n${params.toName} möchte das Spiel freiwillig von ${params.fromName} übernehmen. Zustimmung von ${params.fromName} steht noch aus.`;
    case "VOLUNTARY_APPROVED": {
      const laterPart = params.laterGameTitle
        ? `\nDas spätere Spiel (${params.laterGameTitle}) von ${params.toName} geht ohne Zahlung weiter an: ${params.laterToName ?? "offen"}.`
        : "";
      return `✅ Freiwillige Übernahme bestätigt (§ 5)\nSpiel: ${params.gameTitle} (${dateStr}, ${slotLabel})\n${params.fromName} stimmt zu: ${params.toName} übernimmt! (Aktueller Auszahlungstopf: ${formatEuro(params.payoutPoolCents ?? 0)})${laterPart}`;
    }
    case "REPORTED_DEPLOYED":
      return `⏱️ Schiri-Einsatz gemeldet (§ 6 Abs. 2)\nSpiel: ${params.gameTitle} (${dateStr}, ${slotLabel})\n${params.fromName} hat das Spiel gepfiffen. Bestätigung durch den Schiedsrichterwart folgt.`;
    case "CONFIRMED_DEPLOYED":
      return `🏁 Schiri-Einsatz dokumentiert (§ 6 Abs. 1)\nSpiel: ${params.gameTitle} (${dateStr}, ${slotLabel})\n${params.fromName} ist offiziell als eingesetzt verbucht.`;
  }
}

export function getUserById(id: number): SafeUser | null {
  const row = sqlite
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(id) as UserRow | undefined;
  if (!row) return null;
  const { password_hash: _, ...safe } = row;
  return safe;
}

export function getFullName(u: SafeUser | null | undefined): string {
  if (!u) return "Unbekannt";
  return `${u.first_name} ${u.last_name}`;
}
