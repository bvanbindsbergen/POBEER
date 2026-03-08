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
import { simulateMarketOrder } from "./paper-simulator";

const TICK_INTERVAL = 60_000; // 60 seconds

export class StrategyExecutor {
  private leader: User | null = null;
  private timer: NodeJS.Timeout | null = null;
  private evaluatingSet = new Set<string>();

  start(leader: User) {
    this.leader = leader;
    console.log("[StrategyExecutor] Started, checking every 60s");
    this.timer = setInterval(() => this.tick(), TICK_INTERVAL);
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
      const [killSwitch] = await db
        .select()
        .from(systemConfig)
        .where(eq(systemConfig.key, "strategy_kill_switch"))
        .limit(1);

      if (killSwitch?.value === "true") return;

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

    if (strategy.todayPnlDate !== today) {
      await db
        .update(operationalStrategies)
        .set({ todayPnl: 0, todayPnlDate: today, updatedAt: new Date() })
        .where(eq(operationalStrategies.id, strategy.id));
      strategy.todayPnl = 0;
      strategy.todayPnlDate = today;
    }

    let candles;
    try {
      candles = await fetchCandles(strategy.symbol, strategy.timeframe, 7);
    } catch (err) {
      console.error(`[StrategyExecutor] Failed to fetch candles for ${strategy.symbol}:`, err);
      return;
    }

    if (candles.length < 2) return;

    let config: StrategyConfig;
    try {
      config = JSON.parse(strategy.strategyConfig);
    } catch {
      console.error(`[StrategyExecutor] Invalid config for ${strategy.name}`);
      return;
    }

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
      // Update trailing stop high-water mark
      if (config.trailingStopPercent && lastPrice > (strategy.highestPriceSinceEntry || 0)) {
        await db
          .update(operationalStrategies)
          .set({ highestPriceSinceEntry: lastPrice, updatedAt: new Date() })
          .where(eq(operationalStrategies.id, strategy.id));
        strategy.highestPriceSinceEntry = lastPrice;
      }

      // Check DCA: if DCA enabled and more portions available, check if price dropped enough
      if (config.dcaEnabled && config.dcaOrders && config.dcaDropPercent) {
        const filledSoFar = strategy.dcaOrdersFilled || 1;
        if (filledSoFar < config.dcaOrders) {
          const lastBuyPrice = strategy.avgEntryPrice || strategy.entryPrice || lastPrice;
          const dropFromLastBuy = ((lastBuyPrice - lastPrice) / lastBuyPrice) * 100;
          if (dropFromLastBuy >= config.dcaDropPercent) {
            await this.placeDcaOrder(strategy, config, lastPrice);
          }
        }
      }

      // Check exit conditions (trailing stop, SL, TP, signal)
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
      const isPaper = strategy.mode === "paper";
      const dcaOrders = config.dcaEnabled && config.dcaOrders ? config.dcaOrders : 1;

      let order: { id: string; average: number | undefined; price: number | undefined; filled: number };
      let quantity: number;

      if (isPaper) {
        // Paper mode: use paperBalance as available funds
        const balance = strategy.paperBalance ?? strategy.maxCapUsd;
        const effectiveCap = Math.min(strategy.maxCapUsd, balance);

        if (effectiveCap < 10) {
          console.log(`[StrategyExecutor] ${strategy.name}: Paper balance too low ($${effectiveCap.toFixed(2)})`);
          return;
        }

        const portionCap = effectiveCap / dcaOrders;
        quantity = portionCap / currentPrice;

        console.log(`[StrategyExecutor] ${strategy.name}: [PAPER] ENTRY BUY ${quantity.toFixed(6)} ${strategy.symbol} @ ~$${currentPrice.toFixed(2)}${dcaOrders > 1 ? ` (DCA 1/${dcaOrders})` : ""}`);
        order = simulateMarketOrder(strategy.symbol, "buy", quantity, currentPrice);
      } else {
        // Live mode: use real exchange
        const apiKey = decrypt(this.leader.apiKeyEncrypted!);
        const apiSecret = decrypt(this.leader.apiSecretEncrypted!);
        const exchange = createExchange({ apiKey, apiSecret }, false, this.leader?.exchange || "bybit");

        try {
          const balance = await fetchUsdtBalance(exchange);
          const capFromPercent = balance.free * (strategy.maxCapPercent / 100);
          const effectiveCap = Math.min(strategy.maxCapUsd, capFromPercent);

          if (effectiveCap < 10) {
            console.log(`[StrategyExecutor] ${strategy.name}: Effective cap too low ($${effectiveCap.toFixed(2)})`);
            return;
          }

          const portionCap = effectiveCap / dcaOrders;
          quantity = portionCap / currentPrice;

          console.log(`[StrategyExecutor] ${strategy.name}: ENTRY BUY ${quantity.toFixed(6)} ${strategy.symbol} @ ~$${currentPrice.toFixed(2)}${dcaOrders > 1 ? ` (DCA 1/${dcaOrders})` : ""}`);
          order = await placeMarketOrder(exchange, strategy.symbol, "buy", quantity);
        } finally {
          await exchange.close();
        }
      }

      const fillPrice = order.average || order.price || currentPrice;
      const fillQty = order.filled || quantity;

      // Deduct from paper balance if paper mode
      const paperBalanceUpdate = isPaper
        ? { paperBalance: (strategy.paperBalance ?? strategy.maxCapUsd) - fillQty * fillPrice }
        : {};

      await db
        .update(operationalStrategies)
        .set({
          inPosition: true,
          entryPrice: fillPrice,
          entryQuantity: fillQty,
          remainingQuantity: fillQty,
          tpLevelsFilled: 0,
          avgEntryPrice: fillPrice,
          highestPriceSinceEntry: fillPrice,
          dcaOrdersFilled: 1,
          updatedAt: new Date(),
          ...paperBalanceUpdate,
        })
        .where(eq(operationalStrategies.id, strategy.id));

      await db.insert(operationalStrategyTrades).values({
        strategyId: strategy.id,
        symbol: strategy.symbol,
        side: "buy",
        quantity: fillQty,
        price: fillPrice,
        bybitOrderId: order.id,
        reason: "entry_signal",
        mode: strategy.mode,
      });

      const modeLabel = isPaper ? " [PAPER]" : "";
      await createNotification(
        strategy.userId,
        "strategy_entry",
        `Strategy Entry: ${strategy.name}${modeLabel}`,
        `Bought ${fillQty.toFixed(6)} ${strategy.symbol} at $${fillPrice.toFixed(2)}${dcaOrders > 1 ? ` (DCA 1/${dcaOrders})` : ""}`,
        { strategyId: strategy.id, orderId: order.id }
      );

      console.log(`[StrategyExecutor] ${strategy.name}:${modeLabel} Entry filled at $${fillPrice.toFixed(2)}`);
    } catch (err) {
      console.error(`[StrategyExecutor] ${strategy.name}: Entry order failed:`, err);
    }
  }

  private async placeDcaOrder(
    strategy: typeof operationalStrategies.$inferSelect,
    config: StrategyConfig,
    currentPrice: number
  ) {
    if (!this.leader) return;

    try {
      const isPaper = strategy.mode === "paper";
      const dcaOrders = config.dcaOrders || 1;
      const filledSoFar = strategy.dcaOrdersFilled || 1;
      const newFilled = filledSoFar + 1;

      let order: { id: string; average: number | undefined; price: number | undefined; filled: number };
      let quantity: number;

      if (isPaper) {
        // Paper mode: use paperBalance
        const balance = strategy.paperBalance ?? 0;
        const effectiveCap = Math.min(strategy.maxCapUsd, balance);
        const portionCap = effectiveCap / dcaOrders;
        quantity = portionCap / currentPrice;

        if (portionCap < 10) return;

        console.log(`[StrategyExecutor] ${strategy.name}: [PAPER] DCA BUY ${quantity.toFixed(6)} ${strategy.symbol} @ ~$${currentPrice.toFixed(2)} (${newFilled}/${dcaOrders})`);
        order = simulateMarketOrder(strategy.symbol, "buy", quantity, currentPrice);
      } else {
        // Live mode: use real exchange
        const apiKey = decrypt(this.leader.apiKeyEncrypted!);
        const apiSecret = decrypt(this.leader.apiSecretEncrypted!);
        const exchange = createExchange({ apiKey, apiSecret }, false, this.leader?.exchange || "bybit");

        try {
          const balance = await fetchUsdtBalance(exchange);
          const capFromPercent = balance.free * (strategy.maxCapPercent / 100);
          const effectiveCap = Math.min(strategy.maxCapUsd, capFromPercent);
          const portionCap = effectiveCap / dcaOrders;
          quantity = portionCap / currentPrice;

          if (portionCap < 10) return;

          console.log(`[StrategyExecutor] ${strategy.name}: DCA BUY ${quantity.toFixed(6)} ${strategy.symbol} @ ~$${currentPrice.toFixed(2)} (${newFilled}/${dcaOrders})`);
          order = await placeMarketOrder(exchange, strategy.symbol, "buy", quantity);
        } finally {
          await exchange.close();
        }
      }

      const fillPrice = order.average || order.price || currentPrice;
      const fillQty = order.filled || quantity;

      // Calculate new weighted average entry
      const oldQty = strategy.entryQuantity || 0;
      const oldAvg = strategy.avgEntryPrice || strategy.entryPrice || 0;
      const totalQty = oldQty + fillQty;
      const newAvg = totalQty > 0 ? ((oldAvg * oldQty) + (fillPrice * fillQty)) / totalQty : fillPrice;

      // Deduct from paper balance if paper mode
      const paperBalanceUpdate = isPaper
        ? { paperBalance: (strategy.paperBalance ?? 0) - fillQty * fillPrice }
        : {};

      await db
        .update(operationalStrategies)
        .set({
          entryQuantity: totalQty,
          remainingQuantity: totalQty,
          avgEntryPrice: newAvg,
          dcaOrdersFilled: newFilled,
          updatedAt: new Date(),
          ...paperBalanceUpdate,
        })
        .where(eq(operationalStrategies.id, strategy.id));

      await db.insert(operationalStrategyTrades).values({
        strategyId: strategy.id,
        symbol: strategy.symbol,
        side: "buy",
        quantity: fillQty,
        price: fillPrice,
        bybitOrderId: order.id,
        reason: "entry_signal",
        mode: strategy.mode,
      });

      const modeLabel = isPaper ? " [PAPER]" : "";
      await createNotification(
        strategy.userId,
        "strategy_dca",
        `DCA Buy: ${strategy.name}${modeLabel}`,
        `DCA ${newFilled}/${dcaOrders}: Bought ${fillQty.toFixed(6)} ${strategy.symbol} at $${fillPrice.toFixed(2)} | Avg: $${newAvg.toFixed(2)}`,
        { strategyId: strategy.id, orderId: order.id, dcaOrder: newFilled }
      );
    } catch (err) {
      console.error(`[StrategyExecutor] ${strategy.name}: DCA order failed:`, err);
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

    // Use avgEntryPrice for PnL calculation if DCA is active
    const refPrice = strategy.avgEntryPrice || strategy.entryPrice;
    const pnlPercent = ((currentPrice - refPrice) / refPrice) * 100;
    let exitReason: string | null = null;

    // Check trailing stop first (highest priority)
    if (config.trailingStopPercent && strategy.highestPriceSinceEntry) {
      const dropFromHigh = ((strategy.highestPriceSinceEntry - currentPrice) / strategy.highestPriceSinceEntry) * 100;
      if (dropFromHigh >= config.trailingStopPercent) {
        exitReason = "trailing_stop";
      }
    }

    // Check fixed stop loss
    if (!exitReason && config.stopLossPercent && pnlPercent <= -config.stopLossPercent) {
      exitReason = "stop_loss";
    }

    // Check multi-target take profit levels
    if (!exitReason && config.takeProfitLevels?.length) {
      const nextLevel = config.takeProfitLevels[strategy.tpLevelsFilled || 0];
      if (nextLevel && pnlPercent >= nextLevel.percent) {
        const sellQty = (strategy.entryQuantity || 0) * (nextLevel.sellPercent / 100);
        await this.partialExit(strategy, currentPrice, sellQty, "take_profit", (strategy.tpLevelsFilled || 0) + 1);
        return; // Don't check other exit conditions after partial exit
      }
    }

    // Check single take profit (only if multi-target not configured)
    if (!exitReason && !config.takeProfitLevels?.length && config.takeProfitPercent && pnlPercent >= config.takeProfitPercent) {
      exitReason = "take_profit";
    }
    // Check exit signal conditions
    if (!exitReason && checkConditions(config.exitConditions, lastIndex, indicatorCache)) {
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
      const isPaper = strategy.mode === "paper";
      const sellQty = strategy.remainingQuantity || strategy.entryQuantity;

      let order: { id: string; average: number | undefined; price: number | undefined; filled: number };

      if (isPaper) {
        console.log(`[StrategyExecutor] ${strategy.name}: [PAPER] EXIT SELL ${sellQty.toFixed(6)} ${strategy.symbol} (${reason})`);
        order = simulateMarketOrder(strategy.symbol, "sell", sellQty, currentPrice);
      } else {
        const apiKey = decrypt(this.leader.apiKeyEncrypted!);
        const apiSecret = decrypt(this.leader.apiSecretEncrypted!);
        const exchange = createExchange({ apiKey, apiSecret }, false, this.leader?.exchange || "bybit");

        try {
          console.log(`[StrategyExecutor] ${strategy.name}: EXIT SELL ${sellQty.toFixed(6)} ${strategy.symbol} (${reason})`);
          order = await placeMarketOrder(exchange, strategy.symbol, "sell", sellQty);
        } finally {
          await exchange.close();
        }
      }

      const fillPrice = order.average || order.price || currentPrice;
      const refPrice = strategy.avgEntryPrice || strategy.entryPrice;
      const pnl = (fillPrice - refPrice) * sellQty;
      const newTodayPnl = (strategy.todayPnl || 0) + pnl;
      const newTotalPnl = (strategy.totalPnl || 0) + pnl;
      const newTradesCount = (strategy.tradesCount || 0) + 1;

      let newStatus: "active" | "paused" | "stopped" = "active";
      let stoppedReason: string | null = null;
      if (newTodayPnl <= -strategy.dailyLossLimitUsd) {
        newStatus = "stopped";
        stoppedReason = "daily_loss_limit";
        console.log(`[StrategyExecutor] ${strategy.name}: STOPPED - Daily loss limit breached ($${newTodayPnl.toFixed(2)})`);
      }

      // Add proceeds back to paper balance if paper mode
      const paperBalanceUpdate = isPaper
        ? { paperBalance: (strategy.paperBalance ?? 0) + sellQty * fillPrice }
        : {};

      await db
        .update(operationalStrategies)
        .set({
          inPosition: false,
          entryPrice: null,
          entryQuantity: null,
          remainingQuantity: null,
          tpLevelsFilled: 0,
          avgEntryPrice: null,
          highestPriceSinceEntry: null,
          dcaOrdersFilled: 0,
          todayPnl: newTodayPnl,
          totalPnl: newTotalPnl,
          tradesCount: newTradesCount,
          status: newStatus,
          stoppedAt: newStatus === "stopped" ? new Date() : undefined,
          stoppedReason,
          updatedAt: new Date(),
          ...paperBalanceUpdate,
        })
        .where(eq(operationalStrategies.id, strategy.id));

      await db.insert(operationalStrategyTrades).values({
        strategyId: strategy.id,
        symbol: strategy.symbol,
        side: "sell",
        quantity: sellQty,
        price: fillPrice,
        bybitOrderId: order.id,
        pnl,
        reason,
        mode: strategy.mode,
      });

      const modeLabel = isPaper ? " [PAPER]" : "";
      const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
      await createNotification(
        strategy.userId,
        "strategy_exit",
        `Strategy Exit: ${strategy.name}${modeLabel}`,
        `Sold ${sellQty.toFixed(6)} ${strategy.symbol} at $${fillPrice.toFixed(2)} (${reason}) P&L: ${pnlStr}`,
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

      console.log(`[StrategyExecutor] ${strategy.name}:${modeLabel} Exit at $${fillPrice.toFixed(2)}, PnL: ${pnlStr}`);
    } catch (err) {
      console.error(`[StrategyExecutor] ${strategy.name}: Exit order failed:`, err);
    }
  }

  private async partialExit(
    strategy: typeof operationalStrategies.$inferSelect,
    currentPrice: number,
    qty: number,
    reason: string,
    levelIndex: number
  ) {
    if (!this.leader) return;

    const DUST_THRESHOLD = 0.000001;

    try {
      const isPaper = strategy.mode === "paper";
      let fillPrice: number;
      let orderId: string;

      if (isPaper) {
        const order = simulateMarketOrder(strategy.symbol, "sell", qty, currentPrice);
        fillPrice = order.average || order.price || currentPrice;
        orderId = order.id;
        // Add proceeds back to paper balance
        const proceeds = qty * fillPrice;
        const newPaperBalance = (strategy.paperBalance || 0) + proceeds;
        await db.update(operationalStrategies).set({ paperBalance: newPaperBalance }).where(eq(operationalStrategies.id, strategy.id));
      } else {
        const apiKey = decrypt(this.leader.apiKeyEncrypted!);
        const apiSecret = decrypt(this.leader.apiSecretEncrypted!);
        const exchange = createExchange({ apiKey, apiSecret }, false, this.leader?.exchange || "bybit");
        try {
          const order = await placeMarketOrder(exchange, strategy.symbol, "sell", qty);
          fillPrice = order.average || order.price || currentPrice;
          orderId = order.id;
        } finally {
          await exchange.close();
        }
      }

      const refPrice = strategy.avgEntryPrice || strategy.entryPrice || 0;
      const pnl = (fillPrice - refPrice) * qty;
      const newRemaining = (strategy.remainingQuantity || strategy.entryQuantity || 0) - qty;
      const newTodayPnl = (strategy.todayPnl || 0) + pnl;
      const newTotalPnl = (strategy.totalPnl || 0) + pnl;

      await db.update(operationalStrategies).set({
        remainingQuantity: newRemaining,
        tpLevelsFilled: levelIndex,
        todayPnl: newTodayPnl,
        totalPnl: newTotalPnl,
        updatedAt: new Date(),
      }).where(eq(operationalStrategies.id, strategy.id));

      await db.insert(operationalStrategyTrades).values({
        strategyId: strategy.id,
        symbol: strategy.symbol,
        side: "sell",
        quantity: qty,
        price: fillPrice,
        bybitOrderId: orderId,
        pnl,
        reason,
        mode: strategy.mode,
      });

      // Update local strategy state
      strategy.remainingQuantity = newRemaining;
      strategy.tpLevelsFilled = levelIndex;
      strategy.todayPnl = newTodayPnl;
      strategy.totalPnl = newTotalPnl;

      // If all filled or dust remaining, fully close
      if (newRemaining < DUST_THRESHOLD) {
        await this.closeRemainingPosition(strategy, currentPrice);
      }

      const modeLabel = isPaper ? " [PAPER]" : "";
      await createNotification(
        strategy.userId,
        "strategy_partial_exit",
        `Partial Exit: ${strategy.name}${modeLabel}`,
        `TP Level ${levelIndex}: Sold ${qty.toFixed(6)} ${strategy.symbol} at $${fillPrice.toFixed(2)} | P&L: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`,
        { strategyId: strategy.id, level: levelIndex, pnl }
      );
    } catch (err) {
      console.error(`[StrategyExecutor] ${strategy.name}: Partial exit failed:`, err);
    }
  }

  private async closeRemainingPosition(
    strategy: typeof operationalStrategies.$inferSelect,
    currentPrice: number
  ) {
    const newTradesCount = (strategy.tradesCount || 0) + 1;
    let newStatus: "active" | "paused" | "stopped" = "active";
    let stoppedReason: string | null = null;

    if ((strategy.todayPnl || 0) <= -strategy.dailyLossLimitUsd) {
      newStatus = "stopped";
      stoppedReason = "daily_loss_limit";
    }

    await db.update(operationalStrategies).set({
      inPosition: false,
      entryPrice: null,
      entryQuantity: null,
      avgEntryPrice: null,
      highestPriceSinceEntry: null,
      dcaOrdersFilled: 0,
      remainingQuantity: null,
      tpLevelsFilled: 0,
      tradesCount: newTradesCount,
      status: newStatus,
      stoppedAt: newStatus === "stopped" ? new Date() : undefined,
      stoppedReason,
      updatedAt: new Date(),
    }).where(eq(operationalStrategies.id, strategy.id));
  }

  async forceClosePosition(strategyId: string) {
    if (!this.leader) return;

    const [strategy] = await db
      .select()
      .from(operationalStrategies)
      .where(eq(operationalStrategies.id, strategyId))
      .limit(1);

    if (!strategy || !strategy.inPosition || !strategy.entryPrice || !strategy.entryQuantity) return;

    const candles = await fetchCandles(strategy.symbol, strategy.timeframe, 1);
    const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : strategy.entryPrice;

    await this.exitPosition(strategy, currentPrice, "manual_stop");
  }
}
