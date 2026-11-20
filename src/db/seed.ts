import { sqlite } from "./index.ts";
import { hashPassword } from "../lib/auth.ts";

export function ensureSeeded(): void {
  const row = sqlite.prepare("SELECT COUNT(*) as cnt FROM users").get() as {
    cnt: number;
  };
  if (row.cnt > 0) return;

  const now = new Date().toISOString();
  const defaultPass = hashPassword("rhtc2026");

  const seasonRes = sqlite
    .prepare(
      "INSERT INTO seasons (name, is_active, created_at) VALUES (?, 1, ?)"
    )
    .run("Hallensaison 2026/27", now);
  const seasonId = Number(seasonRes.lastInsertRowid);

  const seedUsers = [
    { first: "Lukas", last: "Albers", email: "albers@rhtc.de", role: "PLAYER", exempt: 0 },
    { first: "Tim", last: "Becker", email: "becker@rhtc.de", role: "SCHIEDSRICHTERWART", exempt: 1 },
    { first: "Jan", last: "Claasen", email: "claasen@rhtc.de", role: "PLAYER", exempt: 0 },
    { first: "Moritz", last: "Dierks", email: "dierks@rhtc.de", role: "KASSENWART", exempt: 0 },
    { first: "Felix", last: "Ehlers", email: "ehlers@rhtc.de", role: "PLAYER", exempt: 0 },
    { first: "Niklas", last: "Franke", email: "franke@rhtc.de", role: "VORSTAND", exempt: 1 },
    { first: "Jonas", last: "Grote", email: "grote@rhtc.de", role: "PLAYER", exempt: 0 },
    { first: "Paul", last: "Hansen", email: "hansen@rhtc.de", role: "PLAYER", exempt: 0 },
    { first: "Max", last: "Jansen", email: "jansen@rhtc.de", role: "PLAYER", exempt: 0 },
    { first: "Leon", last: "Kramer", email: "kramer@rhtc.de", role: "PLAYER", exempt: 0 },
    { first: "Simon", last: "Lehmann", email: "lehmann@rhtc.de", role: "PLAYER", exempt: 0 },
    { first: "Tobias", last: "Meyer", email: "meyer@rhtc.de", role: "PLAYER", exempt: 0 },
  ];

  const insertUser = sqlite.prepare(
    "INSERT INTO users (first_name, last_name, email, mobile_number, password_hash, role, is_active_in_list, is_volunteer_exempt, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)"
  );

  const userIds: number[] = [];
  seedUsers.forEach((u, idx) => {
    const mobile = `0171 1000${String(idx + 1).padStart(3, "0")}`;
    const res = insertUser.run(
      u.first,
      u.last,
      u.email,
      mobile,
      defaultPass,
      u.role,
      u.exempt,
      now
    );
    userIds.push(Number(res.lastInsertRowid));
  });

  const dayMs = 24 * 60 * 60 * 1000;
  const baseMs = Date.now();

  const gameDefs = [
    {
      title: "RHTC II vs. Klipper THC II",
      location: "RHTC Halle",
      kickoffAt: new Date(baseMs - 7 * dayMs).toISOString(),
      isFirst: 1,
    },
    {
      title: "RHTC II vs. THK Rissen",
      location: "RHTC Halle",
      kickoffAt: new Date(baseMs + 3 * dayMs).toISOString(),
      isFirst: 0,
    },
    {
      title: "RHTC II vs. Großflottbek II",
      location: "RHTC Halle",
      kickoffAt: new Date(baseMs + 10 * dayMs).toISOString(),
      isFirst: 0,
    },
    {
      title: "RHTC II vs. HTHC III",
      location: "RHTC Halle",
      kickoffAt: new Date(baseMs + 17 * dayMs).toISOString(),
      isFirst: 0,
    },
    {
      title: "RHTC II vs. UHC III",
      location: "RHTC Halle",
      kickoffAt: new Date(baseMs + 24 * dayMs).toISOString(),
      isFirst: 0,
    },
  ];

  const insertGame = sqlite.prepare(
    "INSERT INTO games (season_id, title, location, kickoff_at, is_first_game_of_season, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const gameIds: number[] = [];
  for (const g of gameDefs) {
    const res = insertGame.run(
      seasonId,
      g.title,
      g.location,
      g.kickoffAt,
      g.isFirst,
      now
    );
    gameIds.push(Number(res.lastInsertRowid));
  }

  // Spiel 1: Geloste erste 2 Schiedsrichter (§ 3 Abs. 3) -> Grote & Kramer
  const insertChain = sqlite.prepare(
    `INSERT INTO assignment_chains (game_id, slot_number, ref_code, round_number, status, current_assignee_id, reported_deployed_at, confirmed_deployed_at, confirmed_by_id, created_at)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`
  );
  const insertEvent = sqlite.prepare(
    `INSERT INTO handoff_events (chain_id, game_id, event_type, from_user_id, to_user_id, public_note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  let refSeq = 1;
  const nextRef = () => `SR-${String(refSeq++).padStart(3, "0")}`;

  const g1s1 = Number(
    insertChain.run(
      gameIds[0],
      1,
      nextRef(),
      "CONFIRMED_DEPLOYED",
      userIds[6],
      gameDefs[0].kickoffAt,
      gameDefs[0].kickoffAt,
      userIds[1],
      now
    ).lastInsertRowid
  );
  const g1s2 = Number(
    insertChain.run(
      gameIds[0],
      2,
      nextRef(),
      "CONFIRMED_DEPLOYED",
      userIds[9],
      gameDefs[0].kickoffAt,
      gameDefs[0].kickoffAt,
      userIds[1],
      now
    ).lastInsertRowid
  );

  insertEvent.run(
    g1s1,
    gameIds[0],
    "INITIAL_ASSIGNMENT",
    null,
    userIds[6],
    "Erste Ansetzung der Saison (Losverfahren § 3 Abs. 3)",
    now
  );
  insertEvent.run(
    g1s1,
    gameIds[0],
    "CONFIRMED_DEPLOYED",
    userIds[6],
    null,
    "Einsatz bestätigt (§ 6 Abs. 1)",
    now
  );
  insertEvent.run(
    g1s2,
    gameIds[0],
    "INITIAL_ASSIGNMENT",
    null,
    userIds[9],
    "Erste Ansetzung der Saison (Losverfahren § 3 Abs. 3)",
    now
  );
  insertEvent.run(
    g1s2,
    gameIds[0],
    "CONFIRMED_DEPLOYED",
    userIds[9],
    null,
    "Einsatz bestätigt (§ 6 Abs. 1)",
    now
  );

  // Spiele 2-5 alphabetisch (ohne Grote [6] und Kramer [9])
  const remainingOrder = [0, 1, 2, 3, 4, 5, 7, 8];
  for (let i = 1; i < gameIds.length; i++) {
    const u1 = userIds[remainingOrder[(i - 1) * 2]];
    const u2 = userIds[remainingOrder[(i - 1) * 2 + 1]];

    const c1 = Number(
      insertChain.run(
        gameIds[i],
        1,
        nextRef(),
        "ASSIGNED",
        u1,
        null,
        null,
        null,
        now
      ).lastInsertRowid
    );
    const c2 = Number(
      insertChain.run(
        gameIds[i],
        2,
        nextRef(),
        "ASSIGNED",
        u2,
        null,
        null,
        null,
        now
      ).lastInsertRowid
    );

    insertEvent.run(
      c1,
      gameIds[i],
      "INITIAL_ASSIGNMENT",
      null,
      u1,
      "Saison-Ansetzung alphabetisch (§ 3 Abs. 4)",
      now
    );
    insertEvent.run(
      c2,
      gameIds[i],
      "INITIAL_ASSIGNMENT",
      null,
      u2,
      "Saison-Ansetzung alphabetisch (§ 3 Abs. 4)",
      now
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ensureSeeded();
  console.log("RHTC Datenbank erfolgreich geseedet.");
}
