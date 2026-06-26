import { sqliteTable, text, integer, uniqueIndex, index, primaryKey } from "drizzle-orm/sqlite-core";

/* ---------- Users ---------- */
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    gender: text("gender", { enum: ["nam", "nu"] }).notNull(),
    role: text("role", { enum: ["admin", "member"] })
      .notNull()
      .default("member"),
    passwordHash: text("password_hash"),
    qrImageKey: text("qr_image_key"),
    momoLink: text("momo_link"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    emailIdx: uniqueIndex("users_email_idx").on(t.email),
  }),
);

export const passwordResetTokens = sqliteTable("password_reset_tokens", {
  token: text("token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    userIdx: index("sessions_user_idx").on(t.userId),
  }),
);

/* ---------- Months & sessions ---------- */
export const months = sqliteTable(
  "months",
  {
    id: text("id").primaryKey(),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    status: text("status", {
      enum: ["draft", "voting", "locked", "done"],
    }).notNull(),
    voteOpenAt: integer("vote_open_at").notNull(),
    voteCloseAt: integer("vote_close_at").notNull(),
    createdAt: integer("created_at").notNull(),
    /**
     * JSON-serialised matrix snapshot written at lock time. Once present,
     * /lich matrix + bill totals read from this instead of live tables — so
     * post-lock court edits via /admin/sessions/<id> affect only the live
     * home cards, not the historic record.
     */
    lockedSnapshot: text("locked_snapshot"),
  },
  (t) => ({
    yearMonthIdx: uniqueIndex("months_year_month_idx").on(t.year, t.month),
  }),
);

export const playSessions = sqliteTable(
  "play_sessions",
  {
    id: text("id").primaryKey(),
    monthId: text("month_id")
      .notNull()
      .references(() => months.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // 'YYYY-MM-DD'
    weekday: text("weekday", {
      enum: ["T2", "T3", "T4", "T5", "T6", "T7", "CN"],
    }).notNull(),
  },
  (t) => ({
    monthIdx: index("play_sessions_month_idx").on(t.monthId),
    dateIdx: uniqueIndex("play_sessions_date_idx").on(t.date),
  }),
);

export const votes = sqliteTable(
  "votes",
  {
    id: text("id").primaryKey(),
    playSessionId: text("play_session_id")
      .notNull()
      .references(() => playSessions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["thang", "vang_lai", "cho_pass", "da_pass", "hoan_tien"],
    }).notNull(),
    votedAt: integer("voted_at").notNull(),
    originalVoterId: text("original_voter_id").references(() => users.id),
  },
  (t) => ({
    sessionUserIdx: uniqueIndex("votes_session_user_idx").on(t.playSessionId, t.userId),
    userIdx: index("votes_user_idx").on(t.userId),
  }),
);

export const courtAllocations = sqliteTable(
  "court_allocations",
  {
    id: text("id").primaryKey(),
    playSessionId: text("play_session_id")
      .notNull()
      .references(() => playSessions.id, { onDelete: "cascade" }),
    courtCode: text("court_code").notNull(),
    startTime: text("start_time").notNull(), // 'HH:mm'
    endTime: text("end_time").notNull(),
    displayOrder: integer("display_order").notNull(),
  },
  (t) => ({
    sessionIdx: index("court_alloc_session_idx").on(t.playSessionId),
  }),
);

/**
 * Pass-slot lifecycle is two-step:
 *   1. `claimed_at` set when someone reserves the slot ("Nhận slot")
 *   2. `confirmed_at` set when they confirm money transferred ("Đã chuyển xong")
 * Only at step 2 does the underlying vote flip to `da_pass` + a new
 * `vang_lai` vote get created for the claimer.
 *
 * A row with claimed_at but no confirmed_at is "locked, awaiting confirm" —
 * other members cannot claim it. The claimer can cancel their reservation.
 */
export const passRequests = sqliteTable(
  "pass_requests",
  {
    id: text("id").primaryKey(),
    voteId: text("vote_id")
      .notNull()
      .references(() => votes.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    claimedByUserId: text("claimed_by_user_id").references(() => users.id),
    claimedAt: integer("claimed_at"),
    confirmedAt: integer("confirmed_at"),
    // Vote status before requestPass flipped it to cho_pass. cancelPass uses
    // this to restore correctly — thang voters return to thang, vang_lai to
    // vang_lai.
    originalVoteStatus: text("original_vote_status", {
      enum: ["thang", "vang_lai"],
    })
      .notNull()
      .default("thang"),
    rejectedAt: integer("rejected_at"),
    rejectedByUserId: text("rejected_by_user_id").references(() => users.id),
  },
  (t) => ({
    voteIdx: uniqueIndex("pass_req_vote_idx").on(t.voteId),
  }),
);

/**
 * Member opt-in request: "I want to play this session as vãng lai" — used when
 * no pass-slot is available. Admin fulfils by adding an extra court for that
 * session; the existing court_added action auto-approves all pending requests.
 */
export const extraSlotRequests = sqliteTable(
  "extra_slot_requests",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playSessionId: text("play_session_id")
      .notNull()
      .references(() => playSessions.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    approvedAt: integer("approved_at"),
    approvedByUserId: text("approved_by_user_id").references(() => users.id),
    cancelledAt: integer("cancelled_at"),
    rejectedAt: integer("rejected_at"),
    rejectedByUserId: text("rejected_by_user_id").references(() => users.id),
  },
  (t) => ({
    userSessionIdx: uniqueIndex("extra_slot_user_session_idx").on(t.userId, t.playSessionId),
    sessionIdx: index("extra_slot_session_idx").on(t.playSessionId),
  }),
);

/**
 * Member self-marks "đã chuyển tiền cho quỹ" for an approved vãng lai vote so
 * the Thanh toán tab can clear the reminder. Money handling is external — this
 * is just a UI flag set by the member, not a real ledger.
 */
export const vangLaiPayments = sqliteTable(
  "vang_lai_payments",
  {
    voteId: text("vote_id")
      .primaryKey()
      .references(() => votes.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    paidAt: integer("paid_at").notNull(),
  },
  (t) => ({
    userIdx: index("vang_lai_pay_user_idx").on(t.userId),
  }),
);

/**
 * Refund obligation from quỹ → member, created when admin approves a pass-slot
 * refund (vote becomes `hoan_tien`). `paidAt` flips when admin transfers.
 * `amount` snapshots the price at refund time so later price tweaks don't
 * rewrite history.
 */
export const refundPayments = sqliteTable(
  "refund_payments",
  {
    voteId: text("vote_id")
      .primaryKey()
      .references(() => votes.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    createdAt: integer("created_at").notNull(),
    paidByUserId: text("paid_by_user_id").references(() => users.id),
    paidAt: integer("paid_at"),
  },
);

export type RefundPayment = typeof refundPayments.$inferSelect;

/**
 * Member self-marks "đã đóng" per month so /lich can show paid status.
 * The app does NOT reconcile real bank transfers — this is a member-managed flag.
 */
export const memberMonthPayments = sqliteTable(
  "member_month_payments",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    monthId: text("month_id")
      .notNull()
      .references(() => months.id, { onDelete: "cascade" }),
    paidAt: integer("paid_at").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.monthId] }),
  }),
);

export const config = sqliteTable("config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // JSON string
  updatedAt: integer("updated_at").notNull(),
});

/* ---------- Audit log (90-day retention) ---------- */
export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    kind: text("kind", {
      enum: [
        "pass_requested",
        "pass_cancelled",
        "pass_locked",
        "pass_unlocked",
        "pass_confirmed",
        "court_added",
        "court_removed",
        "vang_lai_requested",
        "vang_lai_cancelled",
        "vang_lai_approved",
        "vang_lai_rejected",
        "pass_rejected",
        "auto_matched",
        "cutoff_locked",
        "refund_issued",
        "payment_marked",
        "payment_unmarked",
      ],
    }).notNull(),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    subjectUserId: text("subject_user_id").references(() => users.id, { onDelete: "set null" }),
    playSessionId: text("play_session_id").references(() => playSessions.id, { onDelete: "set null" }),
    voteId: text("vote_id").references(() => votes.id, { onDelete: "set null" }),
    meta: text("meta"), // JSON
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    createdIdx: index("audit_logs_created_idx").on(t.createdAt),
    kindIdx: index("audit_logs_kind_idx").on(t.kind),
  }),
);

/* ---------- Types ---------- */
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Month = typeof months.$inferSelect;
export type PlaySession = typeof playSessions.$inferSelect;
export type Vote = typeof votes.$inferSelect;
export type CourtAllocation = typeof courtAllocations.$inferSelect;
export type PassRequest = typeof passRequests.$inferSelect;
export type ExtraSlotRequest = typeof extraSlotRequests.$inferSelect;
export type VangLaiPayment = typeof vangLaiPayments.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type AuditKind = AuditLog["kind"];
