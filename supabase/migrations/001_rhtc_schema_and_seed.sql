-- ==============================================================================
-- RHTC II Schiedsrichterverwaltung: Schema & Initiale Daten für Supabase (PostgreSQL)
-- ==============================================================================

-- 1. Alte Tabellen bereinigen
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

-- 2. Tabellen anlegen
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
  iban TEXT,
  paypal TEXT,
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

-- 3. RLS aktivieren & Zugriffsrechte vergeben
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

-- 4. Reines Standard-SQL für Startdaten
INSERT INTO seasons (id, name, is_active)
VALUES (1, 'Hallensaison 2026/27', TRUE);

INSERT INTO users (id, first_name, last_name, email, mobile_number, password_hash, role, is_active_in_list, is_volunteer_exempt)
VALUES
  (1, 'Lukas', 'Albers', 'albers@rhtc.de', '0171 1000001', '946cfbda45574247d2f50c2e98a2de14:da62a8fa1e86462f4aed6fe4a212fd8b9335aff2479bf64231fcfbc8880681a0e4f95e8cf7389246fd7d9e653ba452642feb8aafdbc3054283c5bce1b2b95df1', 'PLAYER', TRUE, FALSE),
  (2, 'Tim', 'Becker', 'becker@rhtc.de', '0171 1000002', '946cfbda45574247d2f50c2e98a2de14:da62a8fa1e86462f4aed6fe4a212fd8b9335aff2479bf64231fcfbc8880681a0e4f95e8cf7389246fd7d9e653ba452642feb8aafdbc3054283c5bce1b2b95df1', 'SCHIEDSRICHTERWART', TRUE, TRUE),
  (3, 'Jan', 'Claasen', 'claasen@rhtc.de', '0171 1000003', '946cfbda45574247d2f50c2e98a2de14:da62a8fa1e86462f4aed6fe4a212fd8b9335aff2479bf64231fcfbc8880681a0e4f95e8cf7389246fd7d9e653ba452642feb8aafdbc3054283c5bce1b2b95df1', 'PLAYER', TRUE, FALSE),
  (4, 'Moritz', 'Dierks', 'dierks@rhtc.de', '0171 1000004', '946cfbda45574247d2f50c2e98a2de14:da62a8fa1e86462f4aed6fe4a212fd8b9335aff2479bf64231fcfbc8880681a0e4f95e8cf7389246fd7d9e653ba452642feb8aafdbc3054283c5bce1b2b95df1', 'KASSENWART', TRUE, FALSE),
  (5, 'Felix', 'Ehlers', 'ehlers@rhtc.de', '0171 1000005', '946cfbda45574247d2f50c2e98a2de14:da62a8fa1e86462f4aed6fe4a212fd8b9335aff2479bf64231fcfbc8880681a0e4f95e8cf7389246fd7d9e653ba452642feb8aafdbc3054283c5bce1b2b95df1', 'PLAYER', TRUE, FALSE),
  (6, 'Niklas', 'Franke', 'franke@rhtc.de', '0171 1000006', '946cfbda45574247d2f50c2e98a2de14:da62a8fa1e86462f4aed6fe4a212fd8b9335aff2479bf64231fcfbc8880681a0e4f95e8cf7389246fd7d9e653ba452642feb8aafdbc3054283c5bce1b2b95df1', 'VORSTAND', TRUE, TRUE),
  (7, 'Jonas', 'Grote', 'grote@rhtc.de', '0171 1000007', '946cfbda45574247d2f50c2e98a2de14:da62a8fa1e86462f4aed6fe4a212fd8b9335aff2479bf64231fcfbc8880681a0e4f95e8cf7389246fd7d9e653ba452642feb8aafdbc3054283c5bce1b2b95df1', 'PLAYER', TRUE, FALSE),
  (8, 'Paul', 'Hansen', 'hansen@rhtc.de', '0171 1000008', '946cfbda45574247d2f50c2e98a2de14:da62a8fa1e86462f4aed6fe4a212fd8b9335aff2479bf64231fcfbc8880681a0e4f95e8cf7389246fd7d9e653ba452642feb8aafdbc3054283c5bce1b2b95df1', 'PLAYER', TRUE, FALSE),
  (9, 'Max', 'Jansen', 'jansen@rhtc.de', '0171 1000009', '946cfbda45574247d2f50c2e98a2de14:da62a8fa1e86462f4aed6fe4a212fd8b9335aff2479bf64231fcfbc8880681a0e4f95e8cf7389246fd7d9e653ba452642feb8aafdbc3054283c5bce1b2b95df1', 'PLAYER', TRUE, FALSE),
  (10, 'Leon', 'Kramer', 'kramer@rhtc.de', '0171 1000010', '946cfbda45574247d2f50c2e98a2de14:da62a8fa1e86462f4aed6fe4a212fd8b9335aff2479bf64231fcfbc8880681a0e4f95e8cf7389246fd7d9e653ba452642feb8aafdbc3054283c5bce1b2b95df1', 'PLAYER', TRUE, FALSE),
  (11, 'Simon', 'Lehmann', 'lehmann@rhtc.de', '0171 1000011', '946cfbda45574247d2f50c2e98a2de14:da62a8fa1e86462f4aed6fe4a212fd8b9335aff2479bf64231fcfbc8880681a0e4f95e8cf7389246fd7d9e653ba452642feb8aafdbc3054283c5bce1b2b95df1', 'PLAYER', TRUE, FALSE),
  (12, 'Tobias', 'Meyer', 'meyer@rhtc.de', '0171 1000012', '946cfbda45574247d2f50c2e98a2de14:da62a8fa1e86462f4aed6fe4a212fd8b9335aff2479bf64231fcfbc8880681a0e4f95e8cf7389246fd7d9e653ba452642feb8aafdbc3054283c5bce1b2b95df1', 'PLAYER', TRUE, FALSE),
  (13, 'Owen', 'Menck', 'menck@rhtc.de', '0171 1000013', '946cfbda45574247d2f50c2e98a2de14:da62a8fa1e86462f4aed6fe4a212fd8b9335aff2479bf64231fcfbc8880681a0e4f95e8cf7389246fd7d9e653ba452642feb8aafdbc3054283c5bce1b2b95df1', 'SCHIEDSRICHTERWART', TRUE, FALSE);

INSERT INTO games (id, season_id, title, location, kickoff_at, is_first_game_of_season)
VALUES
  (1, 1, 'RHTC II vs. Klipper THC II', 'RHTC Halle', NOW() - INTERVAL '7 days', TRUE),
  (2, 1, 'RHTC II vs. THK Rissen', 'RHTC Halle', NOW() + INTERVAL '3 days', FALSE),
  (3, 1, 'RHTC II vs. Großflottbek II', 'RHTC Halle', NOW() + INTERVAL '10 days', FALSE),
  (4, 1, 'RHTC II vs. HTHC III', 'RHTC Halle', NOW() + INTERVAL '17 days', FALSE),
  (5, 1, 'RHTC II vs. UHC III', 'RHTC Halle', NOW() + INTERVAL '24 days', FALSE);

INSERT INTO assignment_chains (id, game_id, slot_number, ref_code, round_number, status, current_assignee_id, reported_deployed_at, confirmed_deployed_at, confirmed_by_id)
VALUES
  (1, 1, 1, 'SR-001', 1, 'CONFIRMED_DEPLOYED', 7, NOW() - INTERVAL '7 days', NOW() - INTERVAL '7 days', 2),
  (2, 1, 2, 'SR-002', 1, 'CONFIRMED_DEPLOYED', 10, NOW() - INTERVAL '7 days', NOW() - INTERVAL '7 days', 2);

INSERT INTO handoff_events (id, chain_id, game_id, event_type, from_user_id, to_user_id, public_note)
VALUES
  (1, 1, 1, 'INITIAL_ASSIGNMENT', NULL, 7, 'Ursprüngliche Ansetzung per Los (§ 3 Abs. 3)'),
  (2, 2, 1, 'INITIAL_ASSIGNMENT', NULL, 10, 'Ursprüngliche Ansetzung per Los (§ 3 Abs. 3)');

-- Sequenzen auf die höchsten IDs setzen
SELECT setval('seasons_id_seq', (SELECT COALESCE(MAX(id), 1) FROM seasons));
SELECT setval('users_id_seq', (SELECT COALESCE(MAX(id), 1) FROM users));
SELECT setval('games_id_seq', (SELECT COALESCE(MAX(id), 1) FROM games));
SELECT setval('assignment_chains_id_seq', (SELECT COALESCE(MAX(id), 1) FROM assignment_chains));
SELECT setval('handoff_events_id_seq', (SELECT COALESCE(MAX(id), 1) FROM handoff_events));
