-- ==============================================================================
-- RHTC II Schiedsrichterverwaltung: Schema & Initiale Daten für Supabase (PostgreSQL)
-- ==============================================================================

-- 1. Alte / kollidierende Tabellen bereinigen (vorherige Schiri-UUID-Tabellen)
DROP TABLE IF EXISTS handoff_events CASCADE;
DROP TABLE IF EXISTS assignment_chains CASCADE;
DROP TABLE IF EXISTS handoff_logs CASCADE;
DROP TABLE IF EXISTS voluntary_requests CASCADE;
DROP TABLE IF EXISTS hardship_requests CASCADE;
DROP TABLE IF EXISTS assignments CASCADE;
DROP TABLE IF EXISTS games CASCADE;
DROP TABLE IF EXISTS players CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS seasons CASCADE;

-- 2. Frische rhtc-Tabellen mit BIGSERIAL anlegen
CREATE TABLE seasons (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  mobile_number TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'PLAYER',
  is_active_in_list BOOLEAN NOT NULL DEFAULT TRUE,
  is_volunteer_exempt BOOLEAN NOT NULL DEFAULT FALSE,
  list_order_override INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE games (
  id BIGSERIAL PRIMARY KEY,
  season_id BIGINT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT 'RHTC Halle',
  kickoff_at TIMESTAMPTZ NOT NULL,
  is_first_game_of_season BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE assignment_chains (
  id BIGSERIAL PRIMARY KEY,
  game_id BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  slot_number INTEGER NOT NULL,
  ref_code TEXT,
  round_number INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'UNASSIGNED',
  current_assignee_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  pending_assignee_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  voluntary_requester_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  payout_pool_cents INTEGER NOT NULL DEFAULT 0,
  team_pot_cents INTEGER NOT NULL DEFAULT 0,
  payout_settled BOOLEAN NOT NULL DEFAULT FALSE,
  reported_deployed_at TIMESTAMPTZ,
  confirmed_deployed_at TIMESTAMPTZ,
  confirmed_by_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE handoff_events (
  id BIGSERIAL PRIMARY KEY,
  chain_id BIGINT NOT NULL REFERENCES assignment_chains(id) ON DELETE CASCADE,
  game_id BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  from_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  to_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reason_type TEXT,
  is_short_notice BOOLEAN NOT NULL DEFAULT FALSE,
  public_note TEXT,
  fee_total_cents INTEGER NOT NULL DEFAULT 0,
  team_pot_cents INTEGER NOT NULL DEFAULT 0,
  payout_pool_cents INTEGER NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
  waived_amount_cents INTEGER NOT NULL DEFAULT 0,
  hardship_status TEXT NOT NULL DEFAULT 'NONE',
  hardship_reason_confidential TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. RLS aktivieren & Service-Role-Rechte vergeben
ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_chains ENABLE ROW LEVEL SECURITY;
ALTER TABLE handoff_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_seasons" ON seasons FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_users" ON users FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_games" ON games FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_chains" ON assignment_chains FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_events" ON handoff_events FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_seasons" ON seasons FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_users" ON users FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_games" ON games FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_chains" ON assignment_chains FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_events" ON handoff_events FOR SELECT TO anon USING (true);

-- 4. Initiale Startdaten einfügen
DO $$
DECLARE
  v_season_id BIGINT;
  v_user_becker BIGINT;
  v_user_dierks BIGINT;
  v_user_grote BIGINT;
  v_user_kramer BIGINT;
  v_user_menck BIGINT;
  v_game_id BIGINT;
  v_chain1_id BIGINT;
  v_chain2_id BIGINT;
  v_hash TEXT := '946cfbda45574247d2f50c2e98a2de14:da62a8fa1e86462f4aed6fe4a212fd8b9335aff2479bf64231fcfbc8880681a0e4f95e8cf7389246fd7d9e653ba452642feb8aafdbc3054283c5bce1b2b95df1'; -- Passwort: rhtc2026
BEGIN
  INSERT INTO seasons (name, is_active) VALUES ('Hallensaison 2026/27', TRUE) RETURNING id INTO v_season_id;

  -- Spieler anlegen (inkl. Standard-Zugangsdaten)
  INSERT INTO users (first_name, last_name, email, mobile_number, password_hash, role, is_active_in_list, is_volunteer_exempt)
  VALUES
    ('Lukas', 'Albers', 'albers@rhtc.de', '0171 1000001', v_hash, 'PLAYER', TRUE, FALSE),
    ('Tim', 'Becker', 'becker@rhtc.de', '0171 1000002', v_hash, 'SCHIEDSRICHTERWART', TRUE, TRUE) RETURNING id INTO v_user_becker;

  INSERT INTO users (first_name, last_name, email, mobile_number, password_hash, role, is_active_in_list, is_volunteer_exempt)
  VALUES
    ('Jan', 'Claasen', 'claasen@rhtc.de', '0171 1000003', v_hash, 'PLAYER', TRUE, FALSE),
    ('Moritz', 'Dierks', 'dierks@rhtc.de', '0171 1000004', v_hash, 'KASSENWART', TRUE, FALSE) RETURNING id INTO v_user_dierks;

  INSERT INTO users (first_name, last_name, email, mobile_number, password_hash, role, is_active_in_list, is_volunteer_exempt)
  VALUES
    ('Felix', 'Ehlers', 'ehlers@rhtc.de', '0171 1000005', v_hash, 'PLAYER', TRUE, FALSE),
    ('Niklas', 'Franke', 'franke@rhtc.de', '0171 1000006', v_hash, 'VORSTAND', TRUE, TRUE),
    ('Jonas', 'Grote', 'grote@rhtc.de', '0171 1000007', v_hash, 'PLAYER', TRUE, FALSE) RETURNING id INTO v_user_grote;

  INSERT INTO users (first_name, last_name, email, mobile_number, password_hash, role, is_active_in_list, is_volunteer_exempt)
  VALUES
    ('Paul', 'Hansen', 'hansen@rhtc.de', '0171 1000008', v_hash, 'PLAYER', TRUE, FALSE),
    ('Max', 'Jansen', 'jansen@rhtc.de', '0171 1000009', v_hash, 'PLAYER', TRUE, FALSE),
    ('Leon', 'Kramer', 'kramer@rhtc.de', '0171 1000010', v_hash, 'PLAYER', TRUE, FALSE) RETURNING id INTO v_user_kramer;

  INSERT INTO users (first_name, last_name, email, mobile_number, password_hash, role, is_active_in_list, is_volunteer_exempt)
  VALUES
    ('Simon', 'Lehmann', 'lehmann@rhtc.de', '0171 1000011', v_hash, 'PLAYER', TRUE, FALSE),
    ('Tobias', 'Meyer', 'meyer@rhtc.de', '0171 1000012', v_hash, 'PLAYER', TRUE, FALSE),
    ('Owen', 'Menck', 'menck@rhtc.de', '0171 1000013', v_hash, 'SCHIEDSRICHTERWART', TRUE, FALSE) RETURNING id INTO v_user_menck;

  -- 1. Spiel & initiale Ansetzungen (§ 3 Abs. 3)
  INSERT INTO games (season_id, title, location, kickoff_at, is_first_game_of_season)
  VALUES (v_season_id, 'RHTC II vs. Klipper THC II', 'RHTC Halle', NOW() - INTERVAL '7 days', TRUE) RETURNING id INTO v_game_id;

  INSERT INTO assignment_chains (game_id, slot_number, ref_code, round_number, status, current_assignee_id, reported_deployed_at, confirmed_deployed_at, confirmed_by_id)
  VALUES (v_game_id, 1, 'SR-001', 1, 'CONFIRMED_DEPLOYED', v_user_grote, NOW() - INTERVAL '7 days', NOW() - INTERVAL '7 days', v_user_becker)
  RETURNING id INTO v_chain1_id;

  INSERT INTO assignment_chains (game_id, slot_number, ref_code, round_number, status, current_assignee_id, reported_deployed_at, confirmed_deployed_at, confirmed_by_id)
  VALUES (v_game_id, 2, 'SR-002', 1, 'CONFIRMED_DEPLOYED', v_user_kramer, NOW() - INTERVAL '7 days', NOW() - INTERVAL '7 days', v_user_becker)
  RETURNING id INTO v_chain2_id;

  INSERT INTO handoff_events (chain_id, game_id, event_type, from_user_id, to_user_id, public_note)
  VALUES
    (v_chain1_id, v_game_id, 'INITIAL_ASSIGNMENT', NULL, v_user_grote, 'Ursprüngliche Ansetzung per Los (§ 3 Abs. 3)'),
    (v_chain2_id, v_game_id, 'INITIAL_ASSIGNMENT', NULL, v_user_kramer, 'Ursprüngliche Ansetzung per Los (§ 3 Abs. 3)');

  -- Weitere anstehende Spiele
  INSERT INTO games (season_id, title, location, kickoff_at, is_first_game_of_season) VALUES
    (v_season_id, 'RHTC II vs. THK Rissen', 'RHTC Halle', NOW() + INTERVAL '3 days', FALSE),
    (v_season_id, 'RHTC II vs. Großflottbek II', 'RHTC Halle', NOW() + INTERVAL '10 days', FALSE),
    (v_season_id, 'RHTC II vs. HTHC III', 'RHTC Halle', NOW() + INTERVAL '17 days', FALSE),
    (v_season_id, 'RHTC II vs. UHC III', 'RHTC Halle', NOW() + INTERVAL '24 days', FALSE);
END $$;
