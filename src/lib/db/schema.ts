import {
  pgTable,
  pgEnum,
  text,
  varchar,
  timestamp,
  numeric,
  boolean,
  integer,
  uuid,
} from "drizzle-orm/pg-core";

// Enums
export const userRoleEnum = pgEnum("user_role", ["leader", "follower"]);
export const leaderTradeStatusEnum = pgEnum("leader_trade_status", [
  "detected",
  "open",
  "closed",
]);
export const followerTradeStatusEnum = pgEnum("follower_trade_status", [
  "pending",
  "filled",
  "failed",
  "skipped",
]);
export const positionStatusEnum = pgEnum("position_status", [
  "open",
  "closed",
]);
export const feeStatusEnum = pgEnum("fee_status", ["calculated", "settled"]);
export const orderSideEnum = pgEnum("order_side", ["buy", "sell"]);
export const invoiceStatusEnum = pgEnum("invoice_status", [
  "pending",
  "emailed",
  "paid",
  "overdue",
]);
export const transferTypeEnum = pgEnum("transfer_type", [
  "deposit",
  "withdrawal",
]);
export const followModeEnum = pgEnum("follow_mode", ["auto", "manual"]);
export const pendingTradeStatusEnum = pgEnum("pending_trade_status", [
  "pending",
  "approved",
  "rejected",
  "expired",
]);
export const symbolRuleActionEnum = pgEnum("symbol_rule_action", [
  "copy",
  "skip",
  "manual",
]);

// Users
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  role: userRoleEnum("role").notNull().default("follower"),
  // Encrypted API keys (AES-256-GCM)
  apiKeyEncrypted: text("api_key_encrypted"),
  apiSecretEncrypted: text("api_secret_encrypted"),
  // Copy settings
  copyRatioPercent: numeric("copy_ratio_percent", {
    precision: 5,
    scale: 2,
  }).default("10"),
  maxTradeUsd: numeric("max_trade_usd", { precision: 12, scale: 2 }),
  copyingEnabled: boolean("copying_enabled").default(false),
  // Risk controls (Phase 4)
  dailyLossCapUsd: numeric("daily_loss_cap_usd", { precision: 12, scale: 2 }),
  leverageCap: numeric("leverage_cap", { precision: 5, scale: 2 }),
  allowedMarkets: text("allowed_markets"), // JSON string array e.g. '["BTC/USDT","ETH/USDT"]'
  // Manual approval mode (Phase 7)
  followMode: followModeEnum("follow_mode").default("auto"),
  approvalWindowMinutes: integer("approval_window_minutes").default(5),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Leader trades (detected from ByBit WebSocket)
export const leaderTrades = pgTable("leader_trades", {
  id: uuid("id").primaryKey().defaultRandom(),
  bybitOrderId: varchar("bybit_order_id", { length: 100 }).notNull().unique(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  side: orderSideEnum("side").notNull(),
  orderType: varchar("order_type", { length: 20 }).notNull(),
  quantity: numeric("quantity", { precision: 20, scale: 8 }).notNull(),
  price: numeric("price", { precision: 20, scale: 8 }),
  avgFillPrice: numeric("avg_fill_price", { precision: 20, scale: 8 }),
  filledQuantity: numeric("filled_quantity", { precision: 20, scale: 8 }),
  status: leaderTradeStatusEnum("status").notNull().default("detected"),
  positionGroupId: varchar("position_group_id", { length: 100 }),
  rawData: text("raw_data"),
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Follower trades (copies of leader trades)
export const followerTrades = pgTable("follower_trades", {
  id: uuid("id").primaryKey().defaultRandom(),
  leaderTradeId: uuid("leader_trade_id")
    .notNull()
    .references(() => leaderTrades.id),
  followerId: uuid("follower_id")
    .notNull()
    .references(() => users.id),
  bybitOrderId: varchar("bybit_order_id", { length: 100 }),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  side: orderSideEnum("side").notNull(),
  quantity: numeric("quantity", { precision: 20, scale: 8 }),
  avgFillPrice: numeric("avg_fill_price", { precision: 20, scale: 8 }),
  status: followerTradeStatusEnum("status").notNull().default("pending"),
  ratioUsed: numeric("ratio_used", { precision: 5, scale: 2 }),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Positions (open/closed tracking)
export const positions = pgTable("positions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  side: orderSideEnum("side").notNull().default("buy"),
  entryPrice: numeric("entry_price", { precision: 20, scale: 8 }).notNull(),
  entryQuantity: numeric("entry_quantity", { precision: 20, scale: 8 }).notNull(),
  exitPrice: numeric("exit_price", { precision: 20, scale: 8 }),
  exitQuantity: numeric("exit_quantity", { precision: 20, scale: 8 }),
  realizedPnl: numeric("realized_pnl", { precision: 20, scale: 8 }),
  status: positionStatusEnum("status").notNull().default("open"),
  positionGroupId: varchar("position_group_id", { length: 100 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  closedAt: timestamp("closed_at"),
});

// Fees (2% on profitable trades)
export const fees = pgTable("fees", {
  id: uuid("id").primaryKey().defaultRandom(),
  followerId: uuid("follower_id")
    .notNull()
    .references(() => users.id),
  positionId: uuid("position_id")
    .notNull()
    .references(() => positions.id),
  profitAmount: numeric("profit_amount", { precision: 20, scale: 8 }).notNull(),
  feePercent: numeric("fee_percent", { precision: 5, scale: 2 })
    .notNull()
    .default("2"),
  feeAmount: numeric("fee_amount", { precision: 20, scale: 8 }).notNull(),
  status: feeStatusEnum("status").notNull().default("calculated"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Sessions (auth)
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  token: varchar("token", { length: 255 }).notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// System config (key-value store)
export const systemConfig = pgTable("system_config", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Balance snapshots (daily ByBit balance fetch)
export const balanceSnapshots = pgTable("balance_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  balanceUsdt: numeric("balance_usdt", { precision: 20, scale: 8 }).notNull(),
  snapshotDate: varchar("snapshot_date", { length: 10 }).notNull(), // "YYYY-MM-DD"
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Quarterly invoices
export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  followerId: uuid("follower_id")
    .notNull()
    .references(() => users.id),
  quarterLabel: varchar("quarter_label", { length: 10 }).notNull(), // "2026-Q1"
  periodStart: varchar("period_start", { length: 10 }).notNull(), // "YYYY-MM-DD"
  periodEnd: varchar("period_end", { length: 10 }).notNull(),
  avgBalance: numeric("avg_balance", { precision: 20, scale: 8 }).notNull(),
  feePercent: numeric("fee_percent", { precision: 5, scale: 2 }).notNull().default("2"),
  invoiceAmount: numeric("invoice_amount", { precision: 20, scale: 8 }).notNull(),
  daysInQuarter: integer("days_in_quarter").notNull(),
  daysActive: integer("days_active").notNull(),
  // Tiered fee breakdown (Phase 2)
  baseFee: numeric("base_fee", { precision: 12, scale: 2 }),
  bracketFee: numeric("bracket_fee", { precision: 12, scale: 2 }),
  bracketLabel: varchar("bracket_label", { length: 50 }),
  startEquity: numeric("start_equity", { precision: 20, scale: 8 }),
  endEquity: numeric("end_equity", { precision: 20, scale: 8 }),
  netDeposits: numeric("net_deposits", { precision: 20, scale: 8 }),
  netWithdrawals: numeric("net_withdrawals", { precision: 20, scale: 8 }),
  quarterProfit: numeric("quarter_profit", { precision: 20, scale: 8 }),
  status: invoiceStatusEnum("status").notNull().default("pending"),
  paidAt: timestamp("paid_at"),
  paidVia: varchar("paid_via", { length: 20 }),
  paymentToken: varchar("payment_token", { length: 255 }).notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Transfer history (deposits/withdrawals from ByBit)
export const transferHistory = pgTable("transfer_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  transferType: transferTypeEnum("transfer_type").notNull(),
  amount: numeric("amount", { precision: 20, scale: 8 }).notNull(),
  coin: varchar("coin", { length: 20 }).notNull().default("USDT"),
  bybitTxId: varchar("bybit_tx_id", { length: 255 }).unique(),
  occurredAt: timestamp("occurred_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Quarter equity snapshots (start/end equity per follower per quarter)
export const quarterEquitySnapshots = pgTable("quarter_equity_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  quarterLabel: varchar("quarter_label", { length: 10 }).notNull(), // "2026-Q1"
  startEquity: numeric("start_equity", { precision: 20, scale: 8 }),
  endEquity: numeric("end_equity", { precision: 20, scale: 8 }),
  netDeposits: numeric("net_deposits", { precision: 20, scale: 8 }).default("0"),
  netWithdrawals: numeric("net_withdrawals", { precision: 20, scale: 8 }).default("0"),
  profit: numeric("profit", { precision: 20, scale: 8 }),
  bracketLabel: varchar("bracket_label", { length: 50 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Notifications (Phase 6)
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  type: varchar("type", { length: 50 }).notNull(), // "trade_copied", "trade_failed", "invoice_created", etc.
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  metadata: text("metadata"), // JSON string
  read: boolean("read").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Pending trades for manual approval mode (Phase 7)
export const pendingTrades = pgTable("pending_trades", {
  id: uuid("id").primaryKey().defaultRandom(),
  leaderTradeId: uuid("leader_trade_id")
    .notNull()
    .references(() => leaderTrades.id),
  followerId: uuid("follower_id")
    .notNull()
    .references(() => users.id),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  side: orderSideEnum("side").notNull(),
  suggestedQuantity: numeric("suggested_quantity", { precision: 20, scale: 8 }).notNull(),
  suggestedUsdValue: numeric("suggested_usd_value", { precision: 20, scale: 8 }),
  leaderFillPrice: numeric("leader_fill_price", { precision: 20, scale: 8 }),
  status: pendingTradeStatusEnum("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Per-symbol rules (Phase 8)
export const symbolRules = pgTable("symbol_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  action: symbolRuleActionEnum("action").notNull().default("copy"),
  customRatio: numeric("custom_ratio", { precision: 5, scale: 2 }),
  customMaxUsd: numeric("custom_max_usd", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Type exports
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type LeaderTrade = typeof leaderTrades.$inferSelect;
export type FollowerTrade = typeof followerTrades.$inferSelect;
export type Position = typeof positions.$inferSelect;
export type Fee = typeof fees.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type BalanceSnapshot = typeof balanceSnapshots.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type TransferHistoryRecord = typeof transferHistory.$inferSelect;
export type QuarterEquitySnapshot = typeof quarterEquitySnapshots.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type PendingTrade = typeof pendingTrades.$inferSelect;
export type SymbolRule = typeof symbolRules.$inferSelect;
