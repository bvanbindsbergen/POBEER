import { db } from "../lib/db";
import { leaderTrades, type User } from "../lib/db/schema";
import { decrypt } from "../lib/crypto";
import { createProExchange } from "../lib/exchange/client";
import { eq } from "drizzle-orm";
import { TradeCopier } from "./trade-copier";
import { PositionTracker } from "./position-tracker";
import { FeeCalculator } from "./fee-calculator";
import * as ccxt from "ccxt";

const RECONNECT_DELAY = 5_000;
const MAX_RECONNECT_DELAY = 60_000;

type ProBybit = InstanceType<typeof ccxt.pro.bybit>;

export class LeaderWatcher {
  private exchange: ProBybit | null = null;
  private running = false;
  private reconnectDelay = RECONNECT_DELAY;
  private leader: User;
  private tradeCopier: TradeCopier;
  private positionTracker: PositionTracker;
  private feeCalculator: FeeCalculator;

  constructor(
    leader: User,
    tradeCopier: TradeCopier,
    positionTracker: PositionTracker,
    feeCalculator: FeeCalculator
  ) {
    this.leader = leader;
    this.tradeCopier = tradeCopier;
    this.positionTracker = positionTracker;
    this.feeCalculator = feeCalculator;
  }

  async start() {
    this.running = true;

    while (this.running) {
      try {
        await this.connect();
        await this.watchLoop();
      } catch (err) {
        if (!this.running) break;
        console.error(
          `[LeaderWatcher] Error, reconnecting in ${this.reconnectDelay}ms:`,
          err
        );
        await this.sleep(this.reconnectDelay);
        this.reconnectDelay = Math.min(
          this.reconnectDelay * 2,
          MAX_RECONNECT_DELAY
        );
      }
    }
  }

  async stop() {
    this.running = false;
    if (this.exchange) {
      try {
        await this.exchange.close();
      } catch {
        // ignore close errors
      }
      this.exchange = null;
    }
  }

  private async connect() {
    if (this.exchange) {
      try {
        await this.exchange.close();
      } catch {
        // ignore
      }
    }

    const apiKey = decrypt(this.leader.apiKeyEncrypted!);
    const apiSecret = decrypt(this.leader.apiSecretEncrypted!);

    this.exchange = createProExchange({ apiKey, apiSecret });
    console.log("[LeaderWatcher] Connected to ByBit WebSocket");
    this.reconnectDelay = RECONNECT_DELAY; // Reset on successful connect
  }

  private async watchLoop() {
    if (!this.exchange) throw new Error("Exchange not connected");

    console.log("[LeaderWatcher] Watching for orders...");

    while (this.running) {
      const orders = await this.exchange.watchOrders();

      for (const order of orders) {
        await this.processOrder(order);
      }
    }
  }

  private async processOrder(order: ccxt.Order) {
    const orderId = order.id;
    const symbol = order.symbol;
    const side = order.side as "buy" | "sell";
    const status = order.status; // 'open', 'closed', 'canceled'

    console.log(
      `[LeaderWatcher] Order detected: ${side} ${symbol} | status=${status} | filled=${order.filled}/${order.amount}`
    );

    // Check if we already know about this order
    const existing = await db
      .select()
      .from(leaderTrades)
      .where(eq(leaderTrades.bybitOrderId, orderId))
      .limit(1);

    if (existing.length === 0) {
      // New order
      const positionGroupId = `${symbol}_${Date.now()}`;

      await db.insert(leaderTrades).values({
        bybitOrderId: orderId,
        symbol,
        side,
        orderType: order.type || "market",
        quantity: String(order.amount),
        price: order.price ? String(order.price) : null,
        avgFillPrice: order.average ? String(order.average) : null,
        filledQuantity: String(order.filled || 0),
        status: status === "closed" ? "closed" : "detected",
        positionGroupId,
        rawData: JSON.stringify(order),
      });

      console.log(
        `[LeaderWatcher] New order inserted: ${orderId} (${side} ${symbol})`
      );

      // If order is already filled, process it immediately
      if (
        status === "closed" &&
        order.filled &&
        order.filled > 0 &&
        order.average
      ) {
        await this.handleFilledOrder(orderId, symbol, side, order);
      }
    } else {
      // Update existing order
      const leaderTrade = existing[0];

      await db
        .update(leaderTrades)
        .set({
          avgFillPrice: order.average ? String(order.average) : null,
          filledQuantity: String(order.filled || 0),
          status: status === "closed" ? "closed" : leaderTrade.status,
          updatedAt: new Date(),
        })
        .where(eq(leaderTrades.bybitOrderId, orderId));

      // If just got filled and wasn't processed before
      if (
        status === "closed" &&
        leaderTrade.status !== "closed" &&
        order.filled &&
        order.filled > 0 &&
        order.average
      ) {
        await this.handleFilledOrder(orderId, symbol, side, order);
      }
    }
  }

  private async handleFilledOrder(
    orderId: string,
    symbol: string,
    side: "buy" | "sell",
    order: ccxt.Order
  ) {
    const fillPrice = order.average!;
    const fillQuantity = order.filled;

    console.log(
      `[LeaderWatcher] Order filled: ${side} ${fillQuantity} ${symbol} @ ${fillPrice}`
    );

    // Get the leader trade record
    const [leaderTrade] = await db
      .select()
      .from(leaderTrades)
      .where(eq(leaderTrades.bybitOrderId, orderId))
      .limit(1);

    if (!leaderTrade) return;

    if (side === "buy") {
      // Opening position — track leader position
      await this.positionTracker.openPosition(
        this.leader.id,
        symbol,
        fillPrice,
        fillQuantity,
        leaderTrade.positionGroupId || undefined
      );

      // Copy buy to all followers
      await this.tradeCopier.copyBuy(leaderTrade, fillPrice, fillQuantity);
    } else {
      // Closing position — track leader close and close followers
      await this.positionTracker.closePosition(
        this.leader.id,
        symbol,
        fillPrice,
        fillQuantity
      );

      // Copy sell to all followers + calculate fees
      await this.tradeCopier.copySell(leaderTrade, fillPrice);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
