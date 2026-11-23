import path from "node:path";

let _sqliteInstance: any = null;

function initSqlite() {
  if (_sqliteInstance) return _sqliteInstance;

  let DatabaseSync: any;
  try {
    const sqliteModule = require("node:sqlite");
    DatabaseSync = sqliteModule.DatabaseSync;
  } catch {
    return null;
  }

  const defaultDbPath = process.env.VERCEL
    ? "/tmp/rhtc.db"
    : path.join(
        path.dirname(new URL(import.meta.url).pathname),
        "../../rhtc.db"
      );
  const dbPath = process.env.RHTC_DB_PATH || defaultDbPath;
  _sqliteInstance = new DatabaseSync(dbPath);

  try {
    _sqliteInstance.exec("PRAGMA journal_mode = WAL;");
    _sqliteInstance.exec("PRAGMA foreign_keys = ON;");

    _sqliteInstance.exec(`
      CREATE TABLE IF NOT EXISTS seasons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        mobile_number TEXT,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'PLAYER',
        is_active_in_list INTEGER NOT NULL DEFAULT 1,
        is_volunteer_exempt INTEGER NOT NULL DEFAULT 0,
        list_order_override INTEGER,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        season_id INTEGER NOT NULL REFERENCES seasons(id),
        title TEXT NOT NULL,
        location TEXT NOT NULL DEFAULT 'RHTC Halle',
        kickoff_at TEXT NOT NULL,
        is_first_game_of_season INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assignment_chains (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id INTEGER NOT NULL REFERENCES games(id),
        slot_number INTEGER NOT NULL,
        ref_code TEXT,
        round_number INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'UNASSIGNED',
        current_assignee_id INTEGER REFERENCES users(id),
        pending_assignee_id INTEGER REFERENCES users(id),
        voluntary_requester_id INTEGER REFERENCES users(id),
        payout_pool_cents INTEGER NOT NULL DEFAULT 0,
        team_pot_cents INTEGER NOT NULL DEFAULT 0,
        payout_settled INTEGER NOT NULL DEFAULT 0,
        reported_deployed_at TEXT,
        confirmed_deployed_at TEXT,
        confirmed_by_id INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS handoff_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chain_id INTEGER NOT NULL REFERENCES assignment_chains(id),
        game_id INTEGER NOT NULL REFERENCES games(id),
        event_type TEXT NOT NULL,
        from_user_id INTEGER REFERENCES users(id),
        to_user_id INTEGER REFERENCES users(id),
        reason_type TEXT,
        is_short_notice INTEGER NOT NULL DEFAULT 0,
        public_note TEXT,
        fee_total_cents INTEGER NOT NULL DEFAULT 0,
        team_pot_cents INTEGER NOT NULL DEFAULT 0,
        payout_pool_cents INTEGER NOT NULL DEFAULT 0,
        payment_status TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
        waived_amount_cents INTEGER NOT NULL DEFAULT 0,
        hardship_status TEXT NOT NULL DEFAULT 'NONE',
        hardship_reason_confidential TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Migrationen falls nötig
    const userCols = _sqliteInstance
      .prepare("PRAGMA table_info(users)")
      .all() as Array<{ name: string }>;
    if (!userCols.some((c) => c.name === "mobile_number")) {
      _sqliteInstance.exec("ALTER TABLE users ADD COLUMN mobile_number TEXT;");
    }
    const chainCols = _sqliteInstance
      .prepare("PRAGMA table_info(assignment_chains)")
      .all() as Array<{ name: string }>;
    if (!chainCols.some((c) => c.name === "ref_code")) {
      _sqliteInstance.exec("ALTER TABLE assignment_chains ADD COLUMN ref_code TEXT;");
    }
  } catch (e) {
    console.warn("SQLite lazy init:", e);
  }

  return _sqliteInstance;
}

export const sqlite = new Proxy({} as any, {
  get(_target, prop) {
    const inst = initSqlite();
    if (!inst) throw new Error("SQLite is not available");
    const val = inst[prop];
    return typeof val === "function" ? val.bind(inst) : val;
  },
});

export interface SeasonRow {
  id: number;
  name: string;
  is_active: number;
  created_at: string;
}

export interface UserRow {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  mobile_number: string | null;
  password_hash: string;
  role: "PLAYER" | "SCHIEDSRICHTERWART" | "KASSENWART" | "VORSTAND" | "ADMIN";
  is_active_in_list: number;
  is_volunteer_exempt: number;
  list_order_override: number | null;
  created_at: string;
}

export type SafeUser = Omit<UserRow, "password_hash"> & { cal_token?: string };

export interface GameRow {
  id: number;
  season_id: number;
  title: string;
  location: string;
  kickoff_at: string;
  is_first_game_of_season: number;
  created_at: string;
}

export interface ChainRow {
  id: number;
  game_id: number;
  slot_number: number;
  ref_code: string | null;
  round_number: number;
  status:
    | "UNASSIGNED"
    | "ASSIGNED"
    | "PENDING_HANDOFF"
    | "CONFIRMED"
    | "VOLUNTARY_REQUESTED"
    | "REPORTED_DEPLOYED"
    | "CONFIRMED_DEPLOYED";
  current_assignee_id: number | null;
  pending_assignee_id: number | null;
  voluntary_requester_id: number | null;
  payout_pool_cents: number;
  team_pot_cents: number;
  payout_settled: number;
  reported_deployed_at: string | null;
  confirmed_deployed_at: string | null;
  confirmed_by_id: number | null;
  created_at: string;
}

export interface EventRow {
  id: number;
  chain_id: number;
  game_id: number;
  event_type: string;
  from_user_id: number | null;
  to_user_id: number | null;
  reason_type: string | null;
  is_short_notice: number;
  public_note: string | null;
  fee_total_cents: number;
  team_pot_cents: number;
  payout_pool_cents: number;
  payment_status: string;
  waived_amount_cents: number;
  hardship_status: string;
  hardship_reason_confidential: string | null;
  created_at: string;
}
