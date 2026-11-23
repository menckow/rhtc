import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  sqlite,
  type ChainRow,
  type EventRow,
  type GameRow,
  type SafeUser,
  type SeasonRow,
  type UserRow,
} from "../db/index.ts";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false },
      })
    : null;

export const isUsingSupabase = Boolean(supabase);

// Hilfsfunktionen zur Konvertierung zwischen SQLite (0/1) und Postgres (true/false)
function mapUserFromPg(r: any): UserRow {
  return {
    ...r,
    id: Number(r.id),
    is_active_in_list: r.is_active_in_list ? 1 : 0,
    is_volunteer_exempt: r.is_volunteer_exempt ? 1 : 0,
    list_order_override: r.list_order_override !== null ? Number(r.list_order_override) : null,
  };
}

function mapSeasonFromPg(r: any): SeasonRow {
  return {
    ...r,
    id: Number(r.id),
    is_active: r.is_active ? 1 : 0,
  };
}

function mapGameFromPg(r: any): GameRow {
  return {
    ...r,
    id: Number(r.id),
    season_id: Number(r.season_id),
    is_first_game_of_season: r.is_first_game_of_season ? 1 : 0,
  };
}

function mapChainFromPg(r: any): ChainRow {
  return {
    ...r,
    id: Number(r.id),
    game_id: Number(r.game_id),
    slot_number: Number(r.slot_number),
    round_number: Number(r.round_number || 1),
    payout_pool_cents: Number(r.payout_pool_cents || 0),
    team_pot_cents: Number(r.team_pot_cents || 0),
    payout_settled: r.payout_settled ? 1 : 0,
    current_assignee_id: r.current_assignee_id ? Number(r.current_assignee_id) : null,
    pending_assignee_id: r.pending_assignee_id ? Number(r.pending_assignee_id) : null,
    voluntary_requester_id: r.voluntary_requester_id ? Number(r.voluntary_requester_id) : null,
    confirmed_by_id: r.confirmed_by_id ? Number(r.confirmed_by_id) : null,
  };
}

function mapEventFromPg(r: any): EventRow {
  return {
    ...r,
    id: Number(r.id),
    chain_id: Number(r.chain_id),
    game_id: Number(r.game_id),
    from_user_id: r.from_user_id ? Number(r.from_user_id) : null,
    to_user_id: r.to_user_id ? Number(r.to_user_id) : null,
    is_short_notice: r.is_short_notice ? 1 : 0,
    fee_total_cents: Number(r.fee_total_cents || 0),
    team_pot_cents: Number(r.team_pot_cents || 0),
    payout_pool_cents: Number(r.payout_pool_cents || 0),
    waived_amount_cents: Number(r.waived_amount_cents || 0),
  };
}

export const repo = {
  users: {
    async findByEmail(email: string): Promise<UserRow | undefined> {
      const clean = email.trim().toLowerCase();
      if (!clean) return undefined;

      if (supabase) {
        // 1. Exakte E-Mail
        const { data: byEmail } = await supabase
          .from("users")
          .select("*")
          .ilike("email", clean)
          .maybeSingle();
        if (byEmail) return mapUserFromPg(byEmail);

        // 2. Ohne @ -> z. B. "menck" -> menck@rhtc.de oder Nachname
        if (!clean.includes("@")) {
          const { data: byDomain } = await supabase
            .from("users")
            .select("*")
            .ilike("email", `${clean}@rhtc.de`)
            .maybeSingle();
          if (byDomain) return mapUserFromPg(byDomain);

          const { data: byLast } = await supabase
            .from("users")
            .select("*")
            .ilike("last_name", clean)
            .maybeSingle();
          if (byLast) return mapUserFromPg(byLast);
        }

        // 3. Fallback: Nachname im E-Mail-Präfix (z. B. "owen.menck@gmail.com" -> menck)
        if (clean.includes("menck")) {
          const { data: menckUser } = await supabase
            .from("users")
            .select("*")
            .ilike("last_name", "menck")
            .maybeSingle();
          if (menckUser) return mapUserFromPg(menckUser);
        }

        return undefined;
      }
      return sqlite
        .prepare("SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(last_name) = ? OR LOWER(email) = ?")
        .get(clean, clean, `${clean}@rhtc.de`) as UserRow | undefined;
    },

    async findById(id: number): Promise<UserRow | undefined> {
      if (supabase) {
        const { data, error } = await supabase
          .from("users")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (error || !data) return undefined;
        return mapUserFromPg(data);
      }
      return sqlite.prepare("SELECT * FROM users WHERE id = ?").get(id) as
        | UserRow
        | undefined;
    },

    async listAll(): Promise<UserRow[]> {
      if (supabase) {
        const { data, error } = await supabase.from("users").select("*");
        if (error || !data) return [];
        return data.map(mapUserFromPg);
      }
      return sqlite.prepare("SELECT * FROM users").all() as unknown as UserRow[];
    },

    async listActive(): Promise<UserRow[]> {
      if (supabase) {
        const { data, error } = await supabase
          .from("users")
          .select("*")
          .eq("is_active_in_list", true);
        if (error || !data) return [];
        return data.map(mapUserFromPg);
      }
      return sqlite
        .prepare("SELECT * FROM users WHERE is_active_in_list = 1")
        .all() as unknown as UserRow[];
    },

    async create(user: {
      first_name: string;
      last_name: string;
      email: string;
      mobile_number?: string | null;
      password_hash: string;
      role?: string;
      is_active_in_list?: number | boolean;
      is_volunteer_exempt?: number | boolean;
      list_order_override?: number | null;
    }): Promise<UserRow> {
      const now = new Date().toISOString();
      if (supabase) {
        const { data, error } = await supabase
          .from("users")
          .insert({
            first_name: user.first_name,
            last_name: user.last_name,
            email: user.email.trim().toLowerCase(),
            mobile_number: user.mobile_number || null,
            password_hash: user.password_hash,
            role: user.role || "PLAYER",
            is_active_in_list: Boolean(user.is_active_in_list ?? true),
            is_volunteer_exempt: Boolean(user.is_volunteer_exempt ?? false),
            list_order_override: user.list_order_override ?? null,
            created_at: now,
          })
          .select()
          .single();
        if (error) throw new Error(error.message);
        return mapUserFromPg(data);
      }
      const res = sqlite
        .prepare(
          `INSERT INTO users (first_name, last_name, email, mobile_number, password_hash, role, is_active_in_list, is_volunteer_exempt, list_order_override, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          user.first_name,
          user.last_name,
          user.email.trim().toLowerCase(),
          user.mobile_number || null,
          user.password_hash,
          user.role || "PLAYER",
          user.is_active_in_list ? 1 : 0,
          user.is_volunteer_exempt ? 1 : 0,
          user.list_order_override ?? null,
          now
        );
      return (await repo.users.findById(Number(res.lastInsertRowid)))!;
    },

    async update(id: number, data: Record<string, any>): Promise<void> {
      if (supabase) {
        const payload: Record<string, any> = { ...data };
        if ("is_active_in_list" in payload) payload.is_active_in_list = Boolean(payload.is_active_in_list);
        if ("is_volunteer_exempt" in payload) payload.is_volunteer_exempt = Boolean(payload.is_volunteer_exempt);
        const { error } = await supabase.from("users").update(payload).eq("id", id);
        if (error) throw new Error(error.message);
        return;
      }
      const sets: string[] = [];
      const vals: any[] = [];
      for (const [k, v] of Object.entries(data)) {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
      vals.push(id);
      sqlite.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
    },

    async delete(id: number): Promise<void> {
      if (supabase) {
        const { error } = await supabase.from("users").delete().eq("id", id);
        if (error) throw new Error(error.message);
        return;
      }
      sqlite.prepare("DELETE FROM users WHERE id = ?").run(id);
    },

    async bulkDelete(ids: number[]): Promise<void> {
      if (ids.length === 0) return;
      if (supabase) {
        const { error } = await supabase.from("users").delete().in("id", ids);
        if (error) throw new Error(error.message);
        return;
      }
      const ph = ids.map(() => "?").join(",");
      sqlite.prepare(`DELETE FROM users WHERE id IN (${ph})`).run(...ids);
    },
  },

  seasons: {
    async getActive(): Promise<SeasonRow | undefined> {
      if (supabase) {
        const { data, error } = await supabase
          .from("seasons")
          .select("*")
          .eq("is_active", true)
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error || !data) return undefined;
        return mapSeasonFromPg(data);
      }
      return sqlite
        .prepare("SELECT * FROM seasons WHERE is_active = 1 ORDER BY id DESC LIMIT 1")
        .get() as SeasonRow | undefined;
    },

    async listAll(): Promise<SeasonRow[]> {
      if (supabase) {
        const { data, error } = await supabase
          .from("seasons")
          .select("*")
          .order("is_active", { ascending: false })
          .order("id", { ascending: false });
        if (error || !data) return [];
        return data.map(mapSeasonFromPg);
      }
      return sqlite
        .prepare("SELECT * FROM seasons ORDER BY is_active DESC, id DESC")
        .all() as unknown as SeasonRow[];
    },

    async findById(id: number): Promise<SeasonRow | undefined> {
      if (supabase) {
        const { data, error } = await supabase
          .from("seasons")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (error || !data) return undefined;
        return mapSeasonFromPg(data);
      }
      return sqlite.prepare("SELECT * FROM seasons WHERE id = ?").get(id) as SeasonRow | undefined;
    },

    async create(name: string): Promise<SeasonRow> {
      const now = new Date().toISOString();
      if (supabase) {
        const { data, error } = await supabase
          .from("seasons")
          .insert({ name, is_active: false, created_at: now })
          .select()
          .single();
        if (error) throw new Error(error.message);
        return mapSeasonFromPg(data);
      }
      const res = sqlite
        .prepare("INSERT INTO seasons (name, is_active, created_at) VALUES (?, 0, ?)")
        .run(name, now);
      return (await repo.seasons.findById(Number(res.lastInsertRowid)))!;
    },

    async activate(id: number): Promise<void> {
      if (supabase) {
        await supabase.from("seasons").update({ is_active: false }).neq("id", id);
        const { error } = await supabase.from("seasons").update({ is_active: true }).eq("id", id);
        if (error) throw new Error(error.message);
        return;
      }
      sqlite.exec("UPDATE seasons SET is_active = 0;");
      sqlite.prepare("UPDATE seasons SET is_active = 1 WHERE id = ?").run(id);
    },

    async update(id: number, name: string): Promise<void> {
      if (supabase) {
        const { error } = await supabase.from("seasons").update({ name }).eq("id", id);
        if (error) throw new Error(error.message);
        return;
      }
      sqlite.prepare("UPDATE seasons SET name = ? WHERE id = ?").run(name, id);
    },

    async delete(id: number): Promise<void> {
      if (supabase) {
        const { data: seasonGames } = await supabase
          .from("games")
          .select("id")
          .eq("season_id", id);
        const gameIds = (seasonGames || []).map((g) => g.id);

        if (gameIds.length > 0) {
          await supabase.from("handoff_events").delete().in("game_id", gameIds);
          await supabase.from("assignment_chains").delete().in("game_id", gameIds);
          await supabase.from("games").delete().eq("season_id", id);
        }
        const { error } = await supabase.from("seasons").delete().eq("id", id);
        if (error) throw new Error(error.message);

        const remaining = await repo.seasons.listAll();
        if (remaining.length > 0 && !remaining.some((s) => s.is_active)) {
          await repo.seasons.activate(remaining[0].id);
        }
        return;
      }

      const games = sqlite
        .prepare("SELECT id FROM games WHERE season_id = ?")
        .all(id) as Array<{ id: number }>;
      for (const g of games) {
        sqlite.prepare("DELETE FROM handoff_events WHERE game_id = ?").run(g.id);
        sqlite.prepare("DELETE FROM assignment_chains WHERE game_id = ?").run(g.id);
      }
      sqlite.prepare("DELETE FROM games WHERE season_id = ?").run(id);
      sqlite.prepare("DELETE FROM seasons WHERE id = ?").run(id);

      const remaining = sqlite
        .prepare("SELECT * FROM seasons ORDER BY id DESC")
        .all() as unknown as SeasonRow[];
      if (remaining.length > 0 && !remaining.some((s) => s.is_active)) {
        await repo.seasons.activate(remaining[0].id);
      }
    },
  },

  games: {
    async listAll(): Promise<GameRow[]> {
      if (supabase) {
        const { data, error } = await supabase
          .from("games")
          .select("*")
          .order("kickoff_at", { ascending: true });
        if (error || !data) return [];
        return data.map(mapGameFromPg);
      }
      return sqlite
        .prepare("SELECT * FROM games ORDER BY kickoff_at ASC")
        .all() as unknown as GameRow[];
    },

    async listBySeason(seasonId: number): Promise<GameRow[]> {
      if (supabase) {
        const { data, error } = await supabase
          .from("games")
          .select("*")
          .eq("season_id", seasonId)
          .order("kickoff_at", { ascending: true });
        if (error || !data) return [];
        return data.map(mapGameFromPg);
      }
      return sqlite
        .prepare("SELECT * FROM games WHERE season_id = ? ORDER BY kickoff_at ASC")
        .all(seasonId) as unknown as GameRow[];
    },

    async findById(id: number): Promise<GameRow | undefined> {
      if (supabase) {
        const { data, error } = await supabase
          .from("games")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (error || !data) return undefined;
        return mapGameFromPg(data);
      }
      return sqlite.prepare("SELECT * FROM games WHERE id = ?").get(id) as GameRow | undefined;
    },

    async create(game: {
      season_id: number;
      title: string;
      location?: string;
      kickoff_at: string;
      is_first_game_of_season?: number | boolean;
    }): Promise<GameRow> {
      const now = new Date().toISOString();
      if (supabase) {
        const { data, error } = await supabase
          .from("games")
          .insert({
            season_id: game.season_id,
            title: game.title,
            location: game.location || "RHTC Halle",
            kickoff_at: game.kickoff_at,
            is_first_game_of_season: Boolean(game.is_first_game_of_season ?? false),
            created_at: now,
          })
          .select()
          .single();
        if (error) throw new Error(error.message);
        return mapGameFromPg(data);
      }
      const res = sqlite
        .prepare(
          `INSERT INTO games (season_id, title, location, kickoff_at, is_first_game_of_season, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          game.season_id,
          game.title,
          game.location || "RHTC Halle",
          game.kickoff_at,
          game.is_first_game_of_season ? 1 : 0,
          now
        );
      return (await repo.games.findById(Number(res.lastInsertRowid)))!;
    },

    async update(id: number, data: Record<string, any>): Promise<void> {
      if (supabase) {
        const payload: Record<string, any> = { ...data };
        if ("is_first_game_of_season" in payload) {
          payload.is_first_game_of_season = Boolean(payload.is_first_game_of_season);
        }
        const { error } = await supabase.from("games").update(payload).eq("id", id);
        if (error) throw new Error(error.message);
        return;
      }
      const sets: string[] = [];
      const vals: any[] = [];
      for (const [k, v] of Object.entries(data)) {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
      vals.push(id);
      sqlite.prepare(`UPDATE games SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
    },

    async delete(id: number): Promise<void> {
      if (supabase) {
        await supabase.from("handoff_events").delete().eq("game_id", id);
        await supabase.from("assignment_chains").delete().eq("game_id", id);
        const { error } = await supabase.from("games").delete().eq("id", id);
        if (error) throw new Error(error.message);
        return;
      }
      sqlite.prepare("DELETE FROM handoff_events WHERE game_id = ?").run(id);
      sqlite.prepare("DELETE FROM assignment_chains WHERE game_id = ?").run(id);
      sqlite.prepare("DELETE FROM games WHERE id = ?").run(id);
    },
  },

  chains: {
    async listByGameIds(gameIds: number[]): Promise<ChainRow[]> {
      if (gameIds.length === 0) return [];
      if (supabase) {
        const { data, error } = await supabase
          .from("assignment_chains")
          .select("*")
          .in("game_id", gameIds)
          .order("slot_number", { ascending: true });
        if (error || !data) return [];
        return data.map(mapChainFromPg);
      }
      const ph = gameIds.map(() => "?").join(",");
      return sqlite
        .prepare(`SELECT * FROM assignment_chains WHERE game_id IN (${ph}) ORDER BY slot_number ASC`)
        .all(...gameIds) as unknown as ChainRow[];
    },

    async findById(id: number): Promise<ChainRow | undefined> {
      if (supabase) {
        const { data, error } = await supabase
          .from("assignment_chains")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (error || !data) return undefined;
        return mapChainFromPg(data);
      }
      return sqlite.prepare("SELECT * FROM assignment_chains WHERE id = ?").get(id) as
        | ChainRow
        | undefined;
    },

    async create(chain: {
      game_id: number;
      slot_number: number;
      ref_code?: string | null;
      round_number?: number;
      status?: string;
      current_assignee_id?: number | null;
      pending_assignee_id?: number | null;
      reported_deployed_at?: string | null;
      confirmed_deployed_at?: string | null;
      confirmed_by_id?: number | null;
    }): Promise<ChainRow> {
      const now = new Date().toISOString();
      if (supabase) {
        const { data, error } = await supabase
          .from("assignment_chains")
          .insert({
            game_id: chain.game_id,
            slot_number: chain.slot_number,
            ref_code: chain.ref_code || null,
            round_number: chain.round_number || 1,
            status: chain.status || "UNASSIGNED",
            current_assignee_id: chain.current_assignee_id || null,
            pending_assignee_id: chain.pending_assignee_id || null,
            reported_deployed_at: chain.reported_deployed_at || null,
            confirmed_deployed_at: chain.confirmed_deployed_at || null,
            confirmed_by_id: chain.confirmed_by_id || null,
            created_at: now,
          })
          .select()
          .single();
        if (error) throw new Error(error.message);
        return mapChainFromPg(data);
      }
      const res = sqlite
        .prepare(
          `INSERT INTO assignment_chains (game_id, slot_number, ref_code, round_number, status, current_assignee_id, pending_assignee_id, reported_deployed_at, confirmed_deployed_at, confirmed_by_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          chain.game_id,
          chain.slot_number,
          chain.ref_code || null,
          chain.round_number || 1,
          chain.status || "UNASSIGNED",
          chain.current_assignee_id || null,
          chain.pending_assignee_id || null,
          chain.reported_deployed_at || null,
          chain.confirmed_deployed_at || null,
          chain.confirmed_by_id || null,
          now
        );
      return (await repo.chains.findById(Number(res.lastInsertRowid)))!;
    },

    async update(id: number, data: Record<string, any>): Promise<void> {
      if (supabase) {
        const payload: Record<string, any> = { ...data };
        if ("payout_settled" in payload) payload.payout_settled = Boolean(payload.payout_settled);
        const { error } = await supabase.from("assignment_chains").update(payload).eq("id", id);
        if (error) throw new Error(error.message);
        return;
      }
      const sets: string[] = [];
      const vals: any[] = [];
      for (const [k, v] of Object.entries(data)) {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
      vals.push(id);
      sqlite.prepare(`UPDATE assignment_chains SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
    },
  },

  events: {
    async listByGameIds(gameIds: number[]): Promise<EventRow[]> {
      if (gameIds.length === 0) return [];
      if (supabase) {
        const { data, error } = await supabase
          .from("handoff_events")
          .select("*")
          .in("game_id", gameIds)
          .order("id", { ascending: false });
        if (error || !data) return [];
        return data.map(mapEventFromPg);
      }
      const ph = gameIds.map(() => "?").join(",");
      return sqlite
        .prepare(`SELECT * FROM handoff_events WHERE game_id IN (${ph}) ORDER BY id DESC`)
        .all(...gameIds) as unknown as EventRow[];
    },

    async listByChainId(chainId: number): Promise<EventRow[]> {
      if (supabase) {
        const { data, error } = await supabase
          .from("handoff_events")
          .select("*")
          .eq("chain_id", chainId)
          .order("id", { ascending: false });
        if (error || !data) return [];
        return data.map(mapEventFromPg);
      }
      return sqlite
        .prepare("SELECT * FROM handoff_events WHERE chain_id = ? ORDER BY id DESC")
        .all(chainId) as unknown as EventRow[];
    },

    async findById(id: number): Promise<EventRow | undefined> {
      if (supabase) {
        const { data, error } = await supabase
          .from("handoff_events")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (error || !data) return undefined;
        return mapEventFromPg(data);
      }
      return sqlite.prepare("SELECT * FROM handoff_events WHERE id = ?").get(id) as EventRow | undefined;
    },

    async create(event: {
      chain_id: number;
      game_id: number;
      event_type: string;
      from_user_id?: number | null;
      to_user_id?: number | null;
      reason_type?: string | null;
      is_short_notice?: number | boolean;
      public_note?: string | null;
      fee_total_cents?: number;
      team_pot_cents?: number;
      payout_pool_cents?: number;
      payment_status?: string;
      waived_amount_cents?: number;
      hardship_status?: string;
      hardship_reason_confidential?: string | null;
    }): Promise<EventRow> {
      const now = new Date().toISOString();
      if (supabase) {
        const { data, error } = await supabase
          .from("handoff_events")
          .insert({
            chain_id: event.chain_id,
            game_id: event.game_id,
            event_type: event.event_type,
            from_user_id: event.from_user_id || null,
            to_user_id: event.to_user_id || null,
            reason_type: event.reason_type || null,
            is_short_notice: Boolean(event.is_short_notice ?? false),
            public_note: event.public_note || null,
            fee_total_cents: event.fee_total_cents ?? 0,
            team_pot_cents: event.team_pot_cents ?? 0,
            payout_pool_cents: event.payout_pool_cents ?? 0,
            payment_status: event.payment_status || "NOT_APPLICABLE",
            waived_amount_cents: event.waived_amount_cents ?? 0,
            hardship_status: event.hardship_status || "NONE",
            hardship_reason_confidential: event.hardship_reason_confidential || null,
            created_at: now,
          })
          .select()
          .single();
        if (error) throw new Error(error.message);
        return mapEventFromPg(data);
      }
      const res = sqlite
        .prepare(
          `INSERT INTO handoff_events (chain_id, game_id, event_type, from_user_id, to_user_id, reason_type, is_short_notice, public_note, fee_total_cents, team_pot_cents, payout_pool_cents, payment_status, waived_amount_cents, hardship_status, hardship_reason_confidential, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          event.chain_id,
          event.game_id,
          event.event_type,
          event.from_user_id || null,
          event.to_user_id || null,
          event.reason_type || null,
          event.is_short_notice ? 1 : 0,
          event.public_note || null,
          event.fee_total_cents ?? 0,
          event.team_pot_cents ?? 0,
          event.payout_pool_cents ?? 0,
          event.payment_status || "NOT_APPLICABLE",
          event.waived_amount_cents ?? 0,
          event.hardship_status || "NONE",
          event.hardship_reason_confidential || null,
          now
        );
      return (await repo.events.findById(Number(res.lastInsertRowid)))!;
    },

    async update(id: number, data: Record<string, any>): Promise<void> {
      if (supabase) {
        const payload: Record<string, any> = { ...data };
        if ("is_short_notice" in payload) payload.is_short_notice = Boolean(payload.is_short_notice);
        const { error } = await supabase.from("handoff_events").update(payload).eq("id", id);
        if (error) throw new Error(error.message);
        return;
      }
      const sets: string[] = [];
      const vals: any[] = [];
      for (const [k, v] of Object.entries(data)) {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
      vals.push(id);
      sqlite.prepare(`UPDATE handoff_events SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
    },
  },

  settings: {
    async get(key: string): Promise<string | null> {
      if (supabase) {
        const { data } = await supabase
          .from("app_settings")
          .select("value")
          .eq("key", key)
          .maybeSingle();
        return data?.value ?? null;
      }
      try {
        const row = sqlite
          .prepare("SELECT value FROM app_settings WHERE key = ?")
          .get(key) as { value: string } | undefined;
        return row ? row.value : null;
      } catch {
        return null;
      }
    },

    async set(key: string, value: string): Promise<void> {
      if (supabase) {
        const { error } = await supabase
          .from("app_settings")
          .upsert({ key, value }, { onConflict: "key" });
        if (error) throw new Error(error.message);
        return;
      }
      sqlite
        .prepare(
          `INSERT INTO app_settings (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        )
        .run(key, value);
    },
  },
};
