CREATE TYPE "public"."ai_conversation_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."ai_message_role" AS ENUM('user', 'assistant', 'system');--> statement-breakpoint
CREATE TYPE "public"."backtest_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."fee_status" AS ENUM('calculated', 'settled');--> statement-breakpoint
CREATE TYPE "public"."follow_mode" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."follower_trade_status" AS ENUM('pending', 'filled', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."grid_strategy_mode" AS ENUM('arithmetic', 'geometric');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('pending', 'emailed', 'paid', 'overdue');--> statement-breakpoint
CREATE TYPE "public"."leader_trade_status" AS ENUM('detected', 'open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."operational_strategy_status" AS ENUM('active', 'paused', 'stopped');--> statement-breakpoint
CREATE TYPE "public"."order_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."pending_trade_status" AS ENUM('pending', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."position_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."symbol_rule_action" AS ENUM('copy', 'skip', 'manual');--> statement-breakpoint
CREATE TYPE "public"."trading_mode" AS ENUM('live', 'paper');--> statement-breakpoint
CREATE TYPE "public"."transfer_type" AS ENUM('deposit', 'withdrawal');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('leader', 'follower');--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(255) DEFAULT 'New Chat' NOT NULL,
	"status" "ai_conversation_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "ai_message_role" NOT NULL,
	"content" text NOT NULL,
	"tool_calls" text,
	"tool_results" text,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backtests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid,
	"symbol" varchar(20) NOT NULL,
	"timeframe" varchar(10) NOT NULL,
	"start_date" varchar(10) NOT NULL,
	"end_date" varchar(10) NOT NULL,
	"strategy_config" text NOT NULL,
	"status" "backtest_status" DEFAULT 'pending' NOT NULL,
	"total_pnl" numeric(20, 8),
	"win_rate" numeric(7, 4),
	"max_drawdown" numeric(20, 8),
	"sharpe_ratio" numeric(10, 4),
	"profit_factor" numeric(10, 4),
	"total_trades" integer,
	"trades" text,
	"equity_curve" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "balance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"balance_usdt" numeric(20, 8) NOT NULL,
	"snapshot_date" varchar(10) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"follower_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"profit_amount" numeric(20, 8) NOT NULL,
	"fee_percent" numeric(5, 2) DEFAULT '2' NOT NULL,
	"fee_amount" numeric(20, 8) NOT NULL,
	"status" "fee_status" DEFAULT 'calculated' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follower_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"leader_trade_id" uuid NOT NULL,
	"follower_id" uuid NOT NULL,
	"bybit_order_id" varchar(100),
	"symbol" varchar(20) NOT NULL,
	"side" "order_side" NOT NULL,
	"quantity" numeric(20, 8),
	"avg_fill_price" numeric(20, 8),
	"status" "follower_trade_status" DEFAULT 'pending' NOT NULL,
	"ratio_used" numeric(5, 2),
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grid_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grid_strategy_id" uuid NOT NULL,
	"grid_level" integer NOT NULL,
	"price" real NOT NULL,
	"side" varchar(10) NOT NULL,
	"quantity" real NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"bybit_order_id" varchar(100),
	"filled_at" timestamp,
	"pnl" real,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grid_strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"mode" "grid_strategy_mode" DEFAULT 'arithmetic' NOT NULL,
	"upper_bound" real NOT NULL,
	"lower_bound" real NOT NULL,
	"grid_count" integer NOT NULL,
	"investment_amount" real NOT NULL,
	"status" "operational_strategy_status" DEFAULT 'active' NOT NULL,
	"trading_mode" "trading_mode" DEFAULT 'live' NOT NULL,
	"total_pnl" real DEFAULT 0,
	"completed_cycles" integer DEFAULT 0,
	"activated_at" timestamp DEFAULT now(),
	"stopped_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"follower_id" uuid NOT NULL,
	"quarter_label" varchar(10) NOT NULL,
	"period_start" varchar(10) NOT NULL,
	"period_end" varchar(10) NOT NULL,
	"avg_balance" numeric(20, 8) NOT NULL,
	"fee_percent" numeric(5, 2) DEFAULT '2' NOT NULL,
	"invoice_amount" numeric(20, 8) NOT NULL,
	"days_in_quarter" integer NOT NULL,
	"days_active" integer NOT NULL,
	"base_fee" numeric(12, 2),
	"bracket_fee" numeric(12, 2),
	"bracket_label" varchar(50),
	"start_equity" numeric(20, 8),
	"end_equity" numeric(20, 8),
	"net_deposits" numeric(20, 8),
	"net_withdrawals" numeric(20, 8),
	"quarter_profit" numeric(20, 8),
	"status" "invoice_status" DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp,
	"paid_via" varchar(20),
	"payment_token" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_payment_token_unique" UNIQUE("payment_token")
);
--> statement-breakpoint
CREATE TABLE "leader_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bybit_order_id" varchar(100) NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"side" "order_side" NOT NULL,
	"order_type" varchar(20) NOT NULL,
	"quantity" numeric(20, 8) NOT NULL,
	"price" numeric(20, 8),
	"avg_fill_price" numeric(20, 8),
	"filled_quantity" numeric(20, 8),
	"status" "leader_trade_status" DEFAULT 'detected' NOT NULL,
	"position_group_id" varchar(100),
	"raw_data" text,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "leader_trades_bybit_order_id_unique" UNIQUE("bybit_order_id")
);
--> statement-breakpoint
CREATE TABLE "news_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" varchar(50) NOT NULL,
	"cache_key" varchar(255) NOT NULL,
	"data" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"metadata" text,
	"read" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ohlcv_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"timeframe" varchar(10) NOT NULL,
	"timestamp" timestamp NOT NULL,
	"open" real NOT NULL,
	"high" real NOT NULL,
	"low" real NOT NULL,
	"close" real NOT NULL,
	"volume" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"backtest_id" uuid,
	"name" varchar(255) NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"timeframe" varchar(10) NOT NULL,
	"strategy_config" text NOT NULL,
	"status" "operational_strategy_status" DEFAULT 'active' NOT NULL,
	"max_cap_usd" real NOT NULL,
	"max_cap_percent" real NOT NULL,
	"daily_loss_limit_usd" real NOT NULL,
	"in_position" boolean DEFAULT false,
	"entry_price" real,
	"entry_quantity" real,
	"highest_price_since_entry" real,
	"dca_orders_filled" integer DEFAULT 0,
	"avg_entry_price" real,
	"today_pnl" real DEFAULT 0,
	"today_pnl_date" varchar(10),
	"total_pnl" real DEFAULT 0,
	"trades_count" integer DEFAULT 0,
	"last_checked_at" timestamp,
	"activated_at" timestamp DEFAULT now(),
	"paused_at" timestamp,
	"stopped_at" timestamp,
	"stopped_reason" text,
	"mode" "trading_mode" DEFAULT 'live' NOT NULL,
	"paper_balance" real,
	"remaining_quantity" real,
	"tp_levels_filled" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_strategy_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" uuid NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"side" varchar(10) NOT NULL,
	"quantity" real NOT NULL,
	"price" real NOT NULL,
	"bybit_order_id" varchar(100),
	"pnl" real,
	"reason" varchar(50) NOT NULL,
	"mode" "trading_mode" DEFAULT 'live' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"leader_trade_id" uuid NOT NULL,
	"follower_id" uuid NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"side" "order_side" NOT NULL,
	"suggested_quantity" numeric(20, 8) NOT NULL,
	"suggested_usd_value" numeric(20, 8),
	"leader_fill_price" numeric(20, 8),
	"status" "pending_trade_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"side" "order_side" DEFAULT 'buy' NOT NULL,
	"entry_price" numeric(20, 8) NOT NULL,
	"entry_quantity" numeric(20, 8) NOT NULL,
	"exit_price" numeric(20, 8),
	"exit_quantity" numeric(20, 8),
	"realized_pnl" numeric(20, 8),
	"status" "position_status" DEFAULT 'open' NOT NULL,
	"position_group_id" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "quarter_equity_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"quarter_label" varchar(10) NOT NULL,
	"start_equity" numeric(20, 8),
	"end_equity" numeric(20, 8),
	"net_deposits" numeric(20, 8) DEFAULT '0',
	"net_withdrawals" numeric(20, 8) DEFAULT '0',
	"profit" numeric(20, 8),
	"bracket_label" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" varchar(255) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "strategy_equity_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" uuid NOT NULL,
	"equity" real NOT NULL,
	"unrealized_pnl" real DEFAULT 0,
	"snapshot_date" varchar(10) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategy_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid,
	"name" varchar(255) NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"timeframe" varchar(10) NOT NULL,
	"strategy_config" text NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "symbol_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"action" "symbol_rule_action" DEFAULT 'copy' NOT NULL,
	"custom_ratio" numeric(5, 2),
	"custom_max_usd" numeric(12, 2),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_config" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfer_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"transfer_type" "transfer_type" NOT NULL,
	"amount" numeric(20, 8) NOT NULL,
	"coin" varchar(20) DEFAULT 'USDT' NOT NULL,
	"bybit_tx_id" varchar(255),
	"occurred_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "transfer_history_bybit_tx_id_unique" UNIQUE("bybit_tx_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"name" varchar(100) NOT NULL,
	"role" "user_role" DEFAULT 'follower' NOT NULL,
	"api_key_encrypted" text,
	"api_secret_encrypted" text,
	"copy_ratio_percent" numeric(5, 2) DEFAULT '10',
	"max_trade_usd" numeric(12, 2),
	"copying_enabled" boolean DEFAULT false,
	"daily_loss_cap_usd" numeric(12, 2),
	"leverage_cap" numeric(5, 2),
	"allowed_markets" text,
	"follow_mode" "follow_mode" DEFAULT 'auto',
	"approval_window_minutes" integer DEFAULT 5,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtests" ADD CONSTRAINT "backtests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtests" ADD CONSTRAINT "backtests_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_snapshots" ADD CONSTRAINT "balance_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees" ADD CONSTRAINT "fees_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees" ADD CONSTRAINT "fees_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follower_trades" ADD CONSTRAINT "follower_trades_leader_trade_id_leader_trades_id_fk" FOREIGN KEY ("leader_trade_id") REFERENCES "public"."leader_trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follower_trades" ADD CONSTRAINT "follower_trades_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grid_orders" ADD CONSTRAINT "grid_orders_grid_strategy_id_grid_strategies_id_fk" FOREIGN KEY ("grid_strategy_id") REFERENCES "public"."grid_strategies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grid_strategies" ADD CONSTRAINT "grid_strategies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_strategies" ADD CONSTRAINT "operational_strategies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_strategies" ADD CONSTRAINT "operational_strategies_backtest_id_backtests_id_fk" FOREIGN KEY ("backtest_id") REFERENCES "public"."backtests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_strategy_trades" ADD CONSTRAINT "operational_strategy_trades_strategy_id_operational_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."operational_strategies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_trades" ADD CONSTRAINT "pending_trades_leader_trade_id_leader_trades_id_fk" FOREIGN KEY ("leader_trade_id") REFERENCES "public"."leader_trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_trades" ADD CONSTRAINT "pending_trades_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarter_equity_snapshots" ADD CONSTRAINT "quarter_equity_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_equity_snapshots" ADD CONSTRAINT "strategy_equity_snapshots_strategy_id_operational_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."operational_strategies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_suggestions" ADD CONSTRAINT "strategy_suggestions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_suggestions" ADD CONSTRAINT "strategy_suggestions_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "symbol_rules" ADD CONSTRAINT "symbol_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_history" ADD CONSTRAINT "transfer_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ohlcv_symbol_tf_ts_idx" ON "ohlcv_cache" USING btree ("symbol","timeframe","timestamp");