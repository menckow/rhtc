import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const seasons = sqliteTable("seasons", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
});

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", {
    enum: ["PLAYER", "SCHIEDSRICHTERWART", "KASSENWART", "VORSTAND"],
  })
    .notNull()
    .default("PLAYER"),
  isActiveInList: integer("is_active_in_list", { mode: "boolean" })
    .notNull()
    .default(true),
  isVolunteerExempt: integer("is_volunteer_exempt", { mode: "boolean" })
    .notNull()
    .default(false),
  listOrderOverride: integer("list_order_override"),
  createdAt: text("created_at").notNull(),
});

export const games = sqliteTable("games", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  seasonId: integer("season_id")
    .notNull()
    .references(() => seasons.id),
  title: text("title").notNull(),
  location: text("location").notNull().default("RHTC Halle"),
  kickoffAt: text("kickoff_at").notNull(),
  isFirstGameOfSeason: integer("is_first_game_of_season", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("created_at").notNull(),
});

export const assignmentChains = sqliteTable("assignment_chains", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  gameId: integer("game_id")
    .notNull()
    .references(() => games.id),
  slotNumber: integer("slot_number").notNull(), // 1 oder 2 (§ 3 Abs. 2)
  roundNumber: integer("round_number").notNull().default(1), // § 3 Abs. 7
  status: text("status", {
    enum: [
      "UNASSIGNED",
      "ASSIGNED",
      "PENDING_HANDOFF",
      "VOLUNTARY_REQUESTED",
      "REPORTED_DEPLOYED",
      "CONFIRMED_DEPLOYED",
    ],
  })
    .notNull()
    .default("UNASSIGNED"),
  currentAssigneeId: integer("current_assignee_id").references(() => users.id),
  pendingAssigneeId: integer("pending_assignee_id").references(() => users.id),
  voluntaryRequesterId: integer("voluntary_requester_id").references(
    () => users.id
  ),
  payoutPoolCents: integer("payout_pool_cents").notNull().default(0),
  teamPotCents: integer("team_pot_cents").notNull().default(0),
  payoutSettled: integer("payout_settled", { mode: "boolean" })
    .notNull()
    .default(false),
  reportedDeployedAt: text("reported_deployed_at"),
  confirmedDeployedAt: text("confirmed_deployed_at"),
  confirmedById: integer("confirmed_by_id").references(() => users.id),
  createdAt: text("created_at").notNull(),
});

export const handoffEvents = sqliteTable("handoff_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  chainId: integer("chain_id")
    .notNull()
    .references(() => assignmentChains.id),
  gameId: integer("game_id")
    .notNull()
    .references(() => games.id),
  eventType: text("event_type", {
    enum: [
      "INITIAL_ASSIGNMENT",
      "REGULAR_HANDOFF",
      "HANDOFF_ACCEPTED",
      "HANDOFF_SKIPPED_UNAVAILABLE",
      "SQUAD_NOMINATION",
      "VOLUNTEER_REQUEST",
      "VOLUNTEER_APPROVED",
      "VOLUNTEER_REJECTED",
      "VOLUNTEER_AUTO_FORWARD",
      "REPORTED_DEPLOYED",
      "CONFIRMED_DEPLOYED",
      "PAYOUT_SETTLED",
    ],
  }).notNull(),
  fromUserId: integer("from_user_id").references(() => users.id),
  toUserId: integer("to_user_id").references(() => users.id),
  reasonType: text("reason_type", {
    enum: [
      "REGULAR",
      "SHORT_NOTICE",
      "SQUAD_NOMINATION",
      "VOLUNTEER_EXEMPT",
      "HARDSHIP",
      "VOLUNTARY_TAKEOVER",
      "UNAVAILABLE_SKIP",
    ],
  }),
  isShortNotice: integer("is_short_notice", { mode: "boolean" })
    .notNull()
    .default(false),
  publicNote: text("public_note"),
  feeTotalCents: integer("fee_total_cents").notNull().default(0),
  teamPotCents: integer("team_pot_cents").notNull().default(0),
  payoutPoolCents: integer("payout_pool_cents").notNull().default(0),
  paymentStatus: text("payment_status", {
    enum: ["NOT_APPLICABLE", "OPEN", "PAID", "WAIVED_FULL", "WAIVED_PARTIAL"],
  })
    .notNull()
    .default("NOT_APPLICABLE"),
  waivedAmountCents: integer("waived_amount_cents").notNull().default(0),
  hardshipStatus: text("hardship_status", {
    enum: ["NONE", "PENDING", "APPROVED_FULL", "APPROVED_PARTIAL", "REJECTED"],
  })
    .notNull()
    .default("NONE"),
  hardshipReasonConfidential: text("hardship_reason_confidential"),
  createdAt: text("created_at").notNull(),
});

export type Season = typeof seasons.$inferSelect;
export type User = typeof users.$inferSelect;
export type Game = typeof games.$inferSelect;
export type AssignmentChain = typeof assignmentChains.$inferSelect;
export type HandoffEvent = typeof handoffEvents.$inferSelect;
