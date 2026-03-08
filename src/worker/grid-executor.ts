import { db } from "../lib/db";
import {
  gridStrategies,
  gridOrders,
  systemConfig,
  type User,
} from "../lib/db/schema";
import { eq, and } from "drizzle-orm";
import { decrypt } from "../lib/crypto";
import { createExchange, placeLimitOrder, fetchOrderStatus } from "../lib/exchange/client";
import { fetchCandles } from "../lib/ai/data/candles";

const TICK_INTERVAL = 30_000; // 30 seconds

export class GridExecutor {
  private leader: User | null = null;
  private timer: NodeJS.Timeout | null = null;
  private evaluatingSet = new Set<string>();

  start(leader: User) {
    this.leader = leader;
    console.log("[GridExecutor] Started, checking every 30s");
    this.timer = setInterval(() => this.tick(), TICK_INTERVAL);
    setTimeout(() => this.tick(), 15_000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log("[GridExecutor] Stopped");
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

      if (killSwitch?.value === "true") return;

      const strategies = await db
        .select()
        .from(gridStrategies)
        .where(eq(gridStrategies.status, "active"));

      if (strategies.length === 0) return;

      console.log(`[GridExecutor] Evaluating ${strategies.length} active grid strategies`);

      for (const strategy of strategies) {
        if (this.evaluatingSet.has(strategy.id)) continue;
        this.evaluatingSet.add(strategy.id);
        try {
          // Check if grid has been initialized (has orders)
          const existingOrders = await db
            .select()
            .from(gridOrders)
            .where(eq(gridOrders.gridStrategyId, strategy.id))
            .limit(1);

          if (existingOrders.length === 0) {
            await this.initializeGrid(strategy);
          } else {
            await this.evaluateGrid(strategy);
          }
        } catch (err) {
          console.error(`[GridExecutor] Error evaluating grid ${strategy.id}:`, err);
        } finally {
          this.evaluatingSet.delete(strategy.id);
        }
      }
    } catch (err) {
      console.error("[GridExecutor] Tick error:", err);
    }
  }

  private calculateGridLevels(
    mode: "arithmetic" | "geometric",
    lower: number,
    upper: number,
    gridCount: number
  ): number[] {
    const levels: number[] = [];
    if (mode === "arithmetic") {
      const step = (upper - lower) / gridCount;
      for (let i = 0; i <= gridCount; i++) {
        levels.push(lower + i * step);
      }
    } else {
      // geometric
      const ratio = Math.pow(upper / lower, 1 / gridCount);
      for (let i = 0; i <= gridCount; i++) {
        levels.push(lower * Math.pow(ratio, i));
      }
    }
    return levels;
  }

  private async initializeGrid(strategy: typeof gridStrategies.$inferSelect) {
    if (!this.leader) return;

    const isPaper = strategy.tradingMode === "paper";
    const levels = this.calculateGridLevels(
      strategy.mode,
      strategy.lowerBound,
      strategy.upperBound,
      strategy.gridCount
    );

    // Get current price
    let currentPrice: number;
    try {
      const candles = await fetchCandles(strategy.symbol, "5m", 1);
      if (candles.length === 0) {
        console.error(`[GridExecutor] No candles for ${strategy.symbol}`);
        return;
      }
      currentPrice = candles[candles.length - 1].close;
    } catch (err) {
      console.error(`[GridExecutor] Failed to fetch candles for ${strategy.symbol}:`, err);
      return;
    }

    // Calculate quantity per grid level
    const quantityPerLevel = strategy.investmentAmount / strategy.gridCount / currentPrice;

    let exchange: ReturnType<typeof createExchange> | null = null;
    if (!isPaper) {
      const apiKey = decrypt(this.leader.apiKeyEncrypted!);
      const apiSecret = decrypt(this.leader.apiSecretEncrypted!);
      exchange = createExchange({ apiKey, apiSecret }, false, this.leader?.exchange || "bybit");
    }

    try {
      for (let i = 0; i < levels.length; i++) {
        const price = levels[i];

        // Skip levels too close to current price (within 0.1%)
        const priceDiff = Math.abs(price - currentPrice) / currentPrice;
        if (priceDiff < 0.001) continue;

        const side = price < currentPrice ? "buy" : "sell";
        let bybitOrderId: string | null = null;

        if (!isPaper && exchange) {
          try {
            const orderResult = await placeLimitOrder(
              exchange,
              strategy.symbol,
              side,
              quantityPerLevel,
              price
            );
            bybitOrderId = orderResult.id;
          } catch (err) {
            console.error(`[GridExecutor] Failed to place limit order at level ${i}:`, err);
            continue;
          }
        }

        await db.insert(gridOrders).values({
          gridStrategyId: strategy.id,
          gridLevel: i,
          price,
          side,
          quantity: quantityPerLevel,
          status: "open",
          bybitOrderId,
        });
      }

      console.log(
        `[GridExecutor] Grid initialized for ${strategy.symbol}: ${levels.length} levels, ` +
        `range $${strategy.lowerBound.toFixed(2)} - $${strategy.upperBound.toFixed(2)}, ` +
        `current price $${currentPrice.toFixed(2)}${isPaper ? " [PAPER]" : ""}`
      );
    } finally {
      if (exchange) {
        await exchange.close();
      }
    }
  }

  private async evaluateGrid(strategy: typeof gridStrategies.$inferSelect) {
    if (!this.leader) return;

    const isPaper = strategy.tradingMode === "paper";

    // Get current price
    let currentPrice: number;
    try {
      const candles = await fetchCandles(strategy.symbol, "5m", 1);
      if (candles.length === 0) return;
      currentPrice = candles[candles.length - 1].close;
    } catch (err) {
      console.error(`[GridExecutor] Failed to fetch candles for ${strategy.symbol}:`, err);
      return;
    }

    // Load open orders
    const openOrders = await db
      .select()
      .from(gridOrders)
      .where(
        and(
          eq(gridOrders.gridStrategyId, strategy.id),
          eq(gridOrders.status, "open")
        )
      );

    if (openOrders.length === 0) return;

    let exchange: ReturnType<typeof createExchange> | null = null;
    if (!isPaper) {
      const apiKey = decrypt(this.leader.apiKeyEncrypted!);
      const apiSecret = decrypt(this.leader.apiSecretEncrypted!);
      exchange = createExchange({ apiKey, apiSecret }, false, this.leader?.exchange || "bybit");
    }

    try {
      // Calculate all grid levels for reference
      const levels = this.calculateGridLevels(
        strategy.mode,
        strategy.lowerBound,
        strategy.upperBound,
        strategy.gridCount
      );

      for (const order of openOrders) {
        let isFilled = false;

        if (isPaper) {
          // Paper mode: check if current price has crossed the grid level
          if (order.side === "buy" && currentPrice <= order.price) {
            isFilled = true;
          } else if (order.side === "sell" && currentPrice >= order.price) {
            isFilled = true;
          }
        } else if (exchange && order.bybitOrderId) {
          // Live mode: check order status via exchange
          try {
            const status = await fetchOrderStatus(exchange, order.bybitOrderId, strategy.symbol);
            if (status.status === "closed") {
              isFilled = true;
            }
          } catch (err) {
            console.error(`[GridExecutor] Failed to check order ${order.bybitOrderId}:`, err);
            continue;
          }
        }

        if (!isFilled) continue;

        // Mark order as filled
        await db
          .update(gridOrders)
          .set({ status: "filled", filledAt: new Date() })
          .where(eq(gridOrders.id, order.id));

        console.log(
          `[GridExecutor] ${strategy.symbol}: ${order.side.toUpperCase()} filled at level ${order.gridLevel} ` +
          `($${order.price.toFixed(2)})${isPaper ? " [PAPER]" : ""}`
        );

        // Place counter order
        const quantityPerLevel = strategy.investmentAmount / strategy.gridCount / currentPrice;

        if (order.side === "buy") {
          // Buy filled -> place sell at the next level up
          const nextLevel = order.gridLevel + 1;
          if (nextLevel < levels.length) {
            const sellPrice = levels[nextLevel];
            let bybitOrderId: string | null = null;

            if (!isPaper && exchange) {
              try {
                const orderResult = await placeLimitOrder(
                  exchange,
                  strategy.symbol,
                  "sell",
                  order.quantity,
                  sellPrice
                );
                bybitOrderId = orderResult.id;
              } catch (err) {
                console.error(`[GridExecutor] Failed to place counter sell:`, err);
                continue;
              }
            }

            await db.insert(gridOrders).values({
              gridStrategyId: strategy.id,
              gridLevel: nextLevel,
              price: sellPrice,
              side: "sell",
              quantity: order.quantity,
              status: "open",
              bybitOrderId,
            });

            // Calculate PnL for this cycle (sell price - buy price) * quantity
            const cyclePnl = (sellPrice - order.price) * order.quantity;
            await db.insert(gridOrders).values({
              gridStrategyId: strategy.id,
              gridLevel: order.gridLevel,
              price: order.price,
              side: "buy",
              quantity: order.quantity,
              status: "pending",
              pnl: cyclePnl,
            });

            // Update strategy PnL (we count the PnL when the sell counter is placed)
            // Actual PnL credited when sell fills
          }
        } else if (order.side === "sell") {
          // Sell filled -> place buy at the level below
          const prevLevel = order.gridLevel - 1;
          if (prevLevel >= 0) {
            const buyPrice = levels[prevLevel];
            let bybitOrderId: string | null = null;

            if (!isPaper && exchange) {
              try {
                const orderResult = await placeLimitOrder(
                  exchange,
                  strategy.symbol,
                  "buy",
                  quantityPerLevel,
                  buyPrice
                );
                bybitOrderId = orderResult.id;
              } catch (err) {
                console.error(`[GridExecutor] Failed to place counter buy:`, err);
                continue;
              }
            }

            await db.insert(gridOrders).values({
              gridStrategyId: strategy.id,
              gridLevel: prevLevel,
              price: buyPrice,
              side: "buy",
              quantity: quantityPerLevel,
              status: "open",
              bybitOrderId,
            });
          }

          // A completed sell means a buy-sell cycle is done
          // Find matching buy at a lower level to calculate PnL
          // The buy was at this level or below - use current level's price difference
          const buyLevel = order.gridLevel - 1;
          if (buyLevel >= 0) {
            const buyPrice = levels[buyLevel];
            const cyclePnl = (order.price - buyPrice) * order.quantity;

            const newTotalPnl = (strategy.totalPnl || 0) + cyclePnl;
            const newCompletedCycles = (strategy.completedCycles || 0) + 1;

            await db
              .update(gridStrategies)
              .set({
                totalPnl: newTotalPnl,
                completedCycles: newCompletedCycles,
                updatedAt: new Date(),
              })
              .where(eq(gridStrategies.id, strategy.id));

            // Update local ref
            strategy.totalPnl = newTotalPnl;
            strategy.completedCycles = newCompletedCycles;

            console.log(
              `[GridExecutor] ${strategy.symbol}: Cycle complete! PnL: $${cyclePnl.toFixed(4)}, ` +
              `Total: $${newTotalPnl.toFixed(4)}, Cycles: ${newCompletedCycles}${isPaper ? " [PAPER]" : ""}`
            );
          }
        }
      }
    } finally {
      if (exchange) {
        await exchange.close();
      }
    }
  }
}
