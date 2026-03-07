import { db } from "../lib/db";
import {
  operationalStrategies,
  operationalStrategyTrades,
  systemConfig,
  type User,
} from "../lib/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "../lib/crypto";
import { createExchange, fetchUsdtBalance, placeMarketOrder } from "../lib/exchange/client";
import { fetchCandles } from "../lib/ai/data/candles";
import { cacheIndicator, checkConditions } from "../lib/ai/backtest/conditions";
import type { StrategyConfig } from "../lib/ai/backtest/types";
import { createNotification } from "../lib/notifications";

const TICK_INTERVAL = 60_000; // 60 seconds

export class StrategyExecutor {
  private leader: User | null = null;
  private timer: NodeJS.Timeout | null = null;
  private evaluatingSet = new Set<string>();

  start(leader: User) {
    this.leader = leader;
    console.log("[StrategyExecutor] Started, checking every 60s");
    this.timer = setInterval(() => this.tick(), TICK_INTERVAL);
    // Run first tick after 10s delay to let other services initialize
    setTimeout(() => this.tick(), 10_000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log("[StrategyExecutor] Stopped");
  }

  private async tick() {
    if (!this.leader) return;

    try {
      // Check kill switch
      const [killSwitch] = await db
        .select()
        .from(systemConfig)
        .where(eq(systemConfig.key, "strategy_kill_switch"))
        .limit(1);

      if (killSwitch?.value === "true") {
        return;
      }

      // Load all active strategies
      const strategies = await db
        .select()
        .from(operationalStrategies)
        .where(eq(operationalStrategies.status, "active"));

      if (strategies.length === 0) return;

      console.log(`[StrategyExecutor] Evaluating ${strategies.length} active strategies`);

      for (const strategy of strategies) {
        if (this.evaluatingSet.has(strategy.id)) continue;
        this.evaluatingSet.add(strategy.id);
        try {
          await this.evaluateStrategy(strategy);
        } catch (err) {
          console.error(`[StrategyExecutor] Error evaluating ${strategy.name}:`, err);
        } finally {
          this.evaluatingSet.delete(strategy.id);
        }
      }
    } catch (err) {
      console.error("[StrategyExecutor] Tick error:", err);
    }
  }

  private async evaluateStrategy(strategy: typeof operationalStrategies.$inferSelect) {
    if (!this.leader) return;

    const today = new Date().toISOString().split("T")[0];

    // Reset daily PnL if new day
    if (strategy.todayPnlDate !== today) {
      await db
        .update(operationalStrategies)
        .set({ todayPnl: 0, todayPnlDate: today, updatedAt: new Date() })
        .where(eq(operationalStrategies.id, strategy.id));
      strategy.todayPnl = 0;
      strategy.todayPnlDate = today;
    }

    // Fetch candles (7 days for indicator warmup)
    let candles;
    try {
      candles = await fetchCandles(strategy.symbol, strategy.timeframe, 7);
    } catch (err) {
      console.error(`[StrategyExecutor] Failed to fetch candles for ${strategy.symbol}:`, err);
      return;
    }

    if (candles.length < 2) return;

    // Parse strategy config
    let config: StrategyConfig;
    try {
      config = JSON.parse(strategy.strategyConfig);
    } catch {
      console.error(`[StrategyExecutor] Invalid config for ${strategy.name}`);
      return;
    }

    // Compute indicators
    const indicatorCache = new Map<string, (number | undefined)[]>();
    const allConditions = [...config.entryConditions, ...config.exitConditions];

    for (const cond of allConditions) {
      cacheIndicator(indicatorCache, cond.indicator, cond.params, cond.field, candles);
      if (typeof cond.value === "object") {
        cacheIndicator(indicatorCache, cond.value.indicator, cond.value.params, cond.value.field, candles);
      }
    }

    const lastIndex = candles.length - 1;
    const lastPrice = candles[lastIndex].close;

    // Update last checked
    await db
      .update(operationalStrategies)
      .set({ lastCheckedAt: new Date(), updatedAt: new Date() })
      .where(eq(operationalStrategies.id, strategy.id));

    if (!strategy.inPosition) {
      // Check entry conditions
      if (checkConditions(config.entryConditions, lastIndex, indicatorCache)) {
        await this.enterPosition(strategy, config, lastPrice);
      }
    } else {
      // Check exit conditions (SL, TP, signal)
      await this.checkExit(strategy, config, lastIndex, indicatorCache, lastPrice);
    }
  }

  private async enterPosition(
    strategy: typeof operationalStrategies.$inferSelect,
    config: StrategyConfig,
    currentPrice: number
  ) {
    if (!this.leader) return;

    try {
      // Create exchange instance for leader
      const apiKey = decrypt(this.leader.apiKeyEncrypted!);
      const apiSecret = decrypt(this.leader.apiSecretEncrypted!);
      const exchange = createExchange({ apiKey, apiSecret });

      try {
        // Fetch balance
        const balance = await fetchUsdtBalance(exchange);
        const capFromPercent = balance.free * (strategy.maxCapPercent / 100);
        const effectiveCap = Math.min(strategy.maxCapUsd, capFromPercent);

        if (effectiveCap < 10) {
          console.log(`[StrategyExecutor] ${strategy.name}: Effective cap too low ($${effectiveCap.toFixed(2)})`);
          return;
        }

        // Calculate quantity
        const quantity = effectiveCap / currentPrice;

        // Place market BUY
        console.log(`[StrategyExecutor] ${strategy.name}: ENTRY BUY ${quantity.toFixed(6)} ${strategy.symbol} @ ~$${currentPrice.toFixed(2)}`);
        const order = await placeMarketOrder(exchange, strategy.symbol, "buy", quantity);

        const fillPrice = order.average || order.price || currentPrice;
        const fillQty = order.filled || quantity;

        // Update DB
        await db
          .update(operationalStrategies)
          .set({
            inPosition: true,
            entryPrice: fillPrice,
            entryQuantity: fillQty,
            updatedAt: new Date(),
          })
          .where(eq(operationalStrategies.id, strategy.id));

        // Record trade
        await db.insert(operationalStrategyTrades).values({
          strategyId: strategy.id,
          symbol: strategy.symbol,
          side: "buy",
          quantity: fillQty,
          price: fillPrice,
          bybitOrderId: order.id,
          reason: "entry_signal",
        });

        // Notification
        await createNotification(
          strategy.userId,
          "strategy_entry",
          `Strategy Entry: ${strategy.name}`,
          `Bought ${fillQty.toFixed(6)} ${strategy.symbol} at $${fillPrice.toFixed(2)}`,
          { strategyId: strategy.id, orderId: order.id }
        );

        console.log(`[StrategyExecutor] ${strategy.name}: Entry filled at $${fillPrice.toFixed(2)}`);
      } finally {
        await exchange.close();
      }
    } catch (err) {
      console.error(`[StrategyExecutor] ${strategy.name}: Entry order failed:`, err);
    }
  }

  private async checkExit(
    strategy: typeof operationalStrategies.$inferSelect,
    config: StrategyConfig,
    lastIndex: number,
    indicatorCache: Map<string, (number | undefined)[]>,
    currentPrice: number
  ) {
    if (!strategy.entryPrice || !strategy.entryQuantity) return;

    const pnlPercent = ((currentPrice - strategy.entryPrice) / strategy.entryPrice) * 100;
    let exitReason: string | null = null;

    // Check stop loss
    if (config.stopLossPercent && pnlPercent <= -config.stopLossPercent) {
      exitReason = "stop_loss";
    }
    // Check take profit
    else if (config.takeProfitPercent && pnlPercent >= config.takeProfitPercent) {
      exitReason = "take_profit";
    }
    // Check exit signal conditions
    else if (checkConditions(config.exitConditions, lastIndex, indicatorCache)) {
      exitReason = "exit_signal";
    }

    if (exitReason) {
      await this.exitPosition(strategy, currentPrice, exitReason);
    }
  }

  private async exitPosition(
    strategy: typeof operationalStrategies.$inferSelect,
    currentPrice: number,
    reason: string
  ) {
    if (!this.leader || !strategy.entryPrice || !strategy.entryQuantity) return;

    try {
      const apiKey = decrypt(this.leader.apiKeyEncrypted!);
      const apiSecret = decrypt(this.leader.apiSecretEncrypted!);
      const exchange = createExchange({ apiKey, apiSecret });

      try {
        // Place market SELL
        console.log(`[StrategyExecutor] ${strategy.name}: EXIT SELL ${strategy.entryQuantity.toFixed(6)} ${strategy.symbol} (${reason})`);
        const order = await placeMarketOrder(exchange, strategy.symbol, "sell", strategy.entryQuantity);

        const fillPrice = order.average || order.price || currentPrice;
        const pnl = (fillPrice - strategy.entryPrice) * strategy.entryQuantity;
        const newTodayPnl = (strategy.todayPnl || 0) + pnl;
        const newTotalPnl = (strategy.totalPnl || 0) + pnl;
        const newTradesCount = (strategy.tradesCount || 0) + 1;

        // Check daily loss limit
        let newStatus: "active" | "paused" | "stopped" = "active";
        let stoppedReason: string | null = null;
        if (newTodayPnl <= -strategy.dailyLossLimitUsd) {
          newStatus = "stopped";
          stoppedReason = "daily_loss_limit";
          console.log(`[StrategyExecutor] ${strategy.name}: STOPPED - Daily loss limit breached ($${newTodayPnl.toFixed(2)})`);
        }

        // Update DB
        await db
          .update(operationalStrategies)
          .set({
            inPosition: false,
            entryPrice: null,
            entryQuantity: null,
            todayPnl: newTodayPnl,
            totalPnl: newTotalPnl,
            tradesCount: newTradesCount,
            status: newStatus,
            stoppedAt: newStatus === "stopped" ? new Date() : undefined,
            stoppedReason,
            updatedAt: new Date(),
          })
          .where(eq(operationalStrategies.id, strategy.id));

        // Record trade
        await db.insert(operationalStrategyTrades).values({
          strategyId: strategy.id,
          symbol: strategy.symbol,
          side: "sell",
          quantity: strategy.entryQuantity,
          price: fillPrice,
          bybitOrderId: order.id,
          pnl,
          reason,
        });

        // Notification
        const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
        await createNotification(
          strategy.userId,
          "strategy_exit",
          `Strategy Exit: ${strategy.name}`,
          `Sold ${strategy.entryQuantity.toFixed(6)} ${strategy.symbol} at $${fillPrice.toFixed(2)} (${reason}) P&L: ${pnlStr}`,
          { strategyId: strategy.id, orderId: order.id, pnl, reason }
        );

        if (newStatus === "stopped") {
          await createNotification(
            strategy.userId,
            "strategy_stopped",
            `Strategy Stopped: ${strategy.name}`,
            `Auto-stopped due to daily loss limit. Today P&L: $${newTodayPnl.toFixed(2)}`,
            { strategyId: strategy.id, reason: stoppedReason }
          );
        }

        console.log(`[StrategyExecutor] ${strategy.name}: Exit at $${fillPrice.toFixed(2)}, PnL: ${pnlStr}`);
      } finally {
        await exchange.close();
      }
    } catch (err) {
      console.error(`[StrategyExecutor] ${strategy.name}: Exit order failed:`, err);
    }
  }

  async forceClosePosition(strategyId: string) {
    if (!this.leader) return;

    const [strategy] = await db
      .select()
      .from(operationalStrategies)
      .where(eq(operationalStrategies.id, strategyId))
      .limit(1);

    if (!strategy || !strategy.inPosition || !strategy.entryPrice || !strategy.entryQuantity) return;

    // Fetch current price
    const candles = await fetchCandles(strategy.symbol, strategy.timeframe, 1);
    const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : strategy.entryPrice;

    await this.exitPosition(strategy, currentPrice, "manual_stop");
  }
}
