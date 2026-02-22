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

// Type exports
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type LeaderTrade = typeof leaderTrades.$inferSelect;
export type FollowerTrade = typeof followerTrades.$inferSelect;
export type Position = typeof positions.$inferSelect;
export type Fee = typeof fees.$inferSelect;
export type Session = typeof sessions.$inferSelect;
