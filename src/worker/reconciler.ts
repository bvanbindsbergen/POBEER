import { db } from "../lib/db";
import { leaderTrades, type User } from "../lib/db/schema";
import { decrypt } from "../lib/crypto";
import { createExchange } from "../lib/exchange/client";
import { eq } from "drizzle-orm";
import { PositionTracker } from "./position-tracker";
import { TradeCopier } from "./trade-copier";
import { FeeCalculator } from "./fee-calculator";
import * as ccxt from "ccxt";

export class Reconciler {
  private positionTracker: PositionTracker;
  private tradeCopier: TradeCopier;
  private feeCalculator: FeeCalculator;

  constructor(
    positionTracker: PositionTracker,
    tradeCopier: TradeCopier,
    feeCalculator: FeeCalculator
  ) {
    this.positionTracker = positionTracker;
    this.tradeCopier = tradeCopier;
    this.feeCalculator = feeCalculator;
  }

  async reconcile(leader: User) {
    if (!leader.apiKeyEncrypted || !leader.apiSecretEncrypted) {
      console.log("[Reconciler] Leader has no API keys, skipping");
      return;
    }

    const apiKey = decrypt(leader.apiKeyEncrypted);
    const apiSecret = decrypt(leader.apiSecretEncrypted);
    const exchange = createExchange({ apiKey, apiSecret });

    try {
      // 1. Fetch recent open orders
      console.log("[Reconciler] Fetching open orders...");
      const openOrders = await exchange.fetchOpenOrders(undefined, undefined, 100);
      console.log(`[Reconciler] Found ${openOrders.length} open orders`);

      // 2. Fetch recent closed orders (last 24h)
      const since = Date.now() - 24 * 60 * 60 * 1000;
      console.log("[Reconciler] Fetching recent closed orders...");

      let closedOrders: ccxt.Order[] = [];
      try {
        closedOrders = await exchange.fetchClosedOrders(
          undefined,
          since,
          100
        );
      } catch {
        console.log(
          "[Reconciler] Could not fetch closed orders (may not be supported for all symbols)"
        );
      }
      console.log(
        `[Reconciler] Found ${closedOrders.length} recent closed orders`
      );

      // 3. Process any orders we haven't seen
      const allOrders = [...openOrders, ...closedOrders];
      let newOrders = 0;

      for (const order of allOrders) {
        const existing = await db
          .select()
          .from(leaderTrades)
          .where(eq(leaderTrades.bybitOrderId, order.id))
          .limit(1);

        if (existing.length === 0) {
          // New order we missed during downtime
          const side = order.side as "buy" | "sell";
          const positionGroupId = `${order.symbol}_${order.timestamp || Date.now()}`;

          await db.insert(leaderTrades).values({
            bybitOrderId: order.id,
            symbol: order.symbol,
            side,
            orderType: order.type || "market",
            quantity: String(order.amount),
            price: order.price ? String(order.price) : null,
            avgFillPrice: order.average ? String(order.average) : null,
            filledQuantity: String(order.filled || 0),
            status:
              order.status === "closed"
                ? "closed"
                : order.status === "open"
                  ? "open"
                  : "detected",
            positionGroupId,
            rawData: JSON.stringify(order),
          });

          newOrders++;

          // If filled, track position (but don't copy — missed trades are logged only)
          if (
            order.status === "closed" &&
            order.filled &&
            order.filled > 0 &&
            order.average
          ) {
            if (side === "buy") {
              await this.positionTracker.openPosition(
                leader.id,
                order.symbol,
                order.average,
                order.filled,
                positionGroupId
              );
            } else {
              await this.positionTracker.closePosition(
                leader.id,
                order.symbol,
                order.average,
                order.filled
              );
            }
          }

          console.log(
            `[Reconciler] Recovered missed order: ${order.side} ${order.symbol} (${order.id})`
          );
        }
      }

      console.log(
        `[Reconciler] Reconciliation done. ${newOrders} new orders discovered.`
      );
    } catch (err) {
      console.error("[Reconciler] Error during reconciliation:", err);
    } finally {
      await exchange.close();
    }
  }
}
