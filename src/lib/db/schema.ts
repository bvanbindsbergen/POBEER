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
  uniqueIndex,
  real,
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

// Operational strategy enums
export const operationalStrategyStatusEnum = pgEnum(
  "operational_strategy_status",
  ["active", "paused", "stopped"]
);

// Exchange enum (supported exchanges)
export const exchangeEnum = pgEnum("exchange_type", [
  "bybit",
  "binance",
  "okx",
  "kraken",
  "kucoin",
  "gate",
  "bitget",
  "mexc",
]);

// Trading mode enum (paper vs live)
export const tradingModeEnum = pgEnum("trading_mode", ["live", "paper"]);

// Grid strategy mode enum
export const gridStrategyModeEnum = pgEnum("grid_strategy_mode", [
  "arithmetic",
  "geometric",
]);

// AI Assistant enums
export const aiConversationStatusEnum = pgEnum("ai_conversation_status", [
  "active",
  "archived",
]);
export const aiMessageRoleEnum = pgEnum("ai_message_role", [
  "user",
  "assistant",
  "system",
]);
export const backtestStatusEnum = pgEnum("backtest_status", [
  "pending",
  "running",
  "completed",
  "failed",
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
  exchange: exchangeEnum("exchange").notNull().default("bybit"),
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

// AI Conversations
export const aiConversations = pgTable("ai_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  title: varchar("title", { length: 255 }).notNull().default("New Chat"),
  status: aiConversationStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// AI Messages
export const aiMessages = pgTable("ai_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => aiConversations.id, { onDelete: "cascade" }),
  role: aiMessageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  toolCalls: text("tool_calls"), // JSON
  toolResults: text("tool_results"), // JSON
  metadata: text("metadata"), // JSON
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Backtests
export const backtests = pgTable("backtests", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  conversationId: uuid("conversation_id").references(() => aiConversations.id),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  timeframe: varchar("timeframe", { length: 10 }).notNull(),
  startDate: varchar("start_date", { length: 10 }).notNull(),
  endDate: varchar("end_date", { length: 10 }).notNull(),
  strategyConfig: text("strategy_config").notNull(), // JSON
  status: backtestStatusEnum("status").notNull().default("pending"),
  totalPnl: numeric("total_pnl", { precision: 20, scale: 8 }),
  winRate: numeric("win_rate", { precision: 7, scale: 4 }),
  maxDrawdown: numeric("max_drawdown", { precision: 20, scale: 8 }),
  sharpeRatio: numeric("sharpe_ratio", { precision: 10, scale: 4 }),
  profitFactor: numeric("profit_factor", { precision: 10, scale: 4 }),
  totalTrades: integer("total_trades"),
  trades: text("trades"), // JSON
  equityCurve: text("equity_curve"), // JSON
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// OHLCV Cache
export const ohlcvCache = pgTable(
  "ohlcv_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    timeframe: varchar("timeframe", { length: 10 }).notNull(),
    timestamp: timestamp("timestamp").notNull(),
    open: real("open").notNull(),
    high: real("high").notNull(),
    low: real("low").notNull(),
    close: real("close").notNull(),
    volume: real("volume").notNull(),
  },
  (table) => [
    uniqueIndex("ohlcv_symbol_tf_ts_idx").on(
      table.symbol,
      table.timeframe,
      table.timestamp
    ),
  ]
);

// News/Market Data Cache
export const newsCache = pgTable("news_cache", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: varchar("source", { length: 50 }).notNull(),
  cacheKey: varchar("cache_key", { length: 255 }).notNull(),
  data: text("data").notNull(), // JSON
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Strategy Suggestions
export const strategySuggestions = pgTable("strategy_suggestions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  conversationId: uuid("conversation_id").references(() => aiConversations.id),
  name: varchar("name", { length: 255 }).notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  timeframe: varchar("timeframe", { length: 10 }).notNull(),
  strategyConfig: text("strategy_config").notNull(), // JSON
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Operational Strategies (live auto-trading)
export const operationalStrategies = pgTable("operational_strategies", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  backtestId: uuid("backtest_id").references(() => backtests.id),
  name: varchar("name", { length: 255 }).notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  timeframe: varchar("timeframe", { length: 10 }).notNull(),
  strategyConfig: text("strategy_config").notNull(), // JSON
  status: operationalStrategyStatusEnum("status").notNull().default("active"),
  maxCapUsd: real("max_cap_usd").notNull(),
  maxCapPercent: real("max_cap_percent").notNull(),
  dailyLossLimitUsd: real("daily_loss_limit_usd").notNull(),
  inPosition: boolean("in_position").default(false),
  entryPrice: real("entry_price"),
  entryQuantity: real("entry_quantity"),
  highestPriceSinceEntry: real("highest_price_since_entry"), // for trailing stop
  dcaOrdersFilled: integer("dca_orders_filled").default(0), // how many DCA portions placed
  avgEntryPrice: real("avg_entry_price"), // weighted average for DCA
  todayPnl: real("today_pnl").default(0),
  todayPnlDate: varchar("today_pnl_date", { length: 10 }), // "YYYY-MM-DD"
  totalPnl: real("total_pnl").default(0),
  tradesCount: integer("trades_count").default(0),
  lastCheckedAt: timestamp("last_checked_at"),
  activatedAt: timestamp("activated_at").defaultNow(),
  pausedAt: timestamp("paused_at"),
  stoppedAt: timestamp("stopped_at"),
  stoppedReason: text("stopped_reason"), // "manual" / "daily_loss_limit" / "kill_switch"
  // Paper trading mode
  mode: tradingModeEnum("mode").notNull().default("live"),
  paperBalance: real("paper_balance"), // virtual USDT balance for paper mode
  // Multi-target take profit
  remainingQuantity: real("remaining_quantity"), // tracks qty left after partial exits
  tpLevelsFilled: integer("tp_levels_filled").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Operational Strategy Trades (trade log for live strategies)
export const operationalStrategyTrades = pgTable("operational_strategy_trades", {
  id: uuid("id").primaryKey().defaultRandom(),
  strategyId: uuid("strategy_id")
    .notNull()
    .references(() => operationalStrategies.id),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  side: varchar("side", { length: 10 }).notNull(), // "buy" / "sell"
  quantity: real("quantity").notNull(),
  price: real("price").notNull(),
  bybitOrderId: varchar("bybit_order_id", { length: 100 }),
  pnl: real("pnl"),
  reason: varchar("reason", { length: 50 }).notNull(), // "entry_signal" / "exit_signal" / "stop_loss" / "take_profit" / "manual_stop"
  mode: tradingModeEnum("mode").notNull().default("live"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Strategy Idea Feedback (approve/decline with context)
export const strategyFeedback = pgTable("strategy_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  strategyName: varchar("strategy_name", { length: 255 }).notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  timeframe: varchar("timeframe", { length: 10 }).notNull(),
  action: varchar("action", { length: 10 }).notNull(), // "approved" or "declined"
  reason: text("reason"), // user-provided context
  strategyConfig: text("strategy_config"), // JSON snapshot of the idea
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Strategy Equity Snapshots (daily snapshots for portfolio analytics)
export const strategyEquitySnapshots = pgTable("strategy_equity_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  strategyId: uuid("strategy_id")
    .notNull()
    .references(() => operationalStrategies.id),
  equity: real("equity").notNull(),
  unrealizedPnl: real("unrealized_pnl").default(0),
  snapshotDate: varchar("snapshot_date", { length: 10 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Grid Strategies
export const gridStrategies = pgTable("grid_strategies", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  mode: gridStrategyModeEnum("mode").notNull().default("arithmetic"),
  upperBound: real("upper_bound").notNull(),
  lowerBound: real("lower_bound").notNull(),
  gridCount: integer("grid_count").notNull(),
  investmentAmount: real("investment_amount").notNull(),
  status: operationalStrategyStatusEnum("status").notNull().default("active"),
  tradingMode: tradingModeEnum("trading_mode").notNull().default("live"),
  totalPnl: real("total_pnl").default(0),
  completedCycles: integer("completed_cycles").default(0),
  activatedAt: timestamp("activated_at").defaultNow(),
  stoppedAt: timestamp("stopped_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Grid Orders
export const gridOrders = pgTable("grid_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  gridStrategyId: uuid("grid_strategy_id")
    .notNull()
    .references(() => gridStrategies.id),
  gridLevel: integer("grid_level").notNull(),
  price: real("price").notNull(),
  side: varchar("side", { length: 10 }).notNull(),
  quantity: real("quantity").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  bybitOrderId: varchar("bybit_order_id", { length: 100 }),
  filledAt: timestamp("filled_at"),
  pnl: real("pnl"),
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
export type AiConversation = typeof aiConversations.$inferSelect;
export type AiMessage = typeof aiMessages.$inferSelect;
export type Backtest = typeof backtests.$inferSelect;
export type OhlcvCandle = typeof ohlcvCache.$inferSelect;
export type NewsCacheEntry = typeof newsCache.$inferSelect;
export type StrategySuggestion = typeof strategySuggestions.$inferSelect;
export type OperationalStrategy = typeof operationalStrategies.$inferSelect;
export type OperationalStrategyTrade = typeof operationalStrategyTrades.$inferSelect;
export type StrategyEquitySnapshot = typeof strategyEquitySnapshots.$inferSelect;
export type GridStrategy = typeof gridStrategies.$inferSelect;
export type GridOrder = typeof gridOrders.$inferSelect;
export type StrategyFeedback = typeof strategyFeedback.$inferSelect;
