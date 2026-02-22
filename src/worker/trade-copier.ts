import { db } from "../lib/db";
import {
  users,
  followerTrades,
  positions,
  type LeaderTrade,
  type User,
} from "../lib/db/schema";
import { eq, and } from "drizzle-orm";
import { decrypt } from "../lib/crypto";
import {
  createExchange,
  fetchUsdtBalance,
  placeMarketOrder,
} from "../lib/exchange/client";
import { PositionTracker } from "./position-tracker";
import { FeeCalculator } from "./fee-calculator";
import * as ccxt from "ccxt";

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 1_000;

export class TradeCopier {
  private positionTracker: PositionTracker;
  private feeCalculator: FeeCalculator;

  constructor(
    positionTracker: PositionTracker,
    feeCalculator: FeeCalculator
  ) {
    this.positionTracker = positionTracker;
    this.feeCalculator = feeCalculator;
  }

  async copyBuy(
    leaderTrade: LeaderTrade,
    fillPrice: number,
    fillQuantity: number
  ) {
    const followers = await this.getActiveFollowers();
    console.log(
      `[TradeCopier] Copying BUY to ${followers.length} active followers`
    );

    for (const follower of followers) {
      try {
        await this.executeBuyForFollower(
          follower,
          leaderTrade,
          fillPrice
        );
      } catch (err) {
        console.error(
          `[TradeCopier] Failed to copy for ${follower.name}:`,
          err
        );
      }
    }
  }

  async copySell(leaderTrade: LeaderTrade, fillPrice: number) {
    const followers = await this.getActiveFollowers();
    console.log(
      `[TradeCopier] Copying SELL to ${followers.length} active followers`
    );

    for (const follower of followers) {
      try {
        await this.executeSellForFollower(
          follower,
          leaderTrade,
          fillPrice
        );
      } catch (err) {
        console.error(
          `[TradeCopier] Failed to close for ${follower.name}:`,
          err
        );
      }
    }
  }

  private async executeBuyForFollower(
    follower: User,
    leaderTrade: LeaderTrade,
    fillPrice: number
  ) {
    const ratio = Number(follower.copyRatioPercent) || 10;
    const maxTradeUsd = follower.maxTradeUsd
      ? Number(follower.maxTradeUsd)
      : Infinity;

    let exchange: ccxt.bybit | null = null;

    try {
      // Decrypt API keys
      const apiKey = decrypt(follower.apiKeyEncrypted!);
      const apiSecret = decrypt(follower.apiSecretEncrypted!);
      exchange = createExchange({ apiKey, apiSecret });

      // Fetch balance
      const balance = await fetchUsdtBalance(exchange);
      const availableUsdt = balance.free;

      // Calculate order size
      let tradeUsdt = availableUsdt * (ratio / 100);
      tradeUsdt = Math.min(tradeUsdt, maxTradeUsd);

      if (tradeUsdt < 1) {
        // Minimum viable trade
        await this.insertFollowerTrade(
          leaderTrade.id,
          follower.id,
          leaderTrade.symbol,
          "buy",
          "skipped",
          ratio,
          null,
          null,
          "Insufficient balance"
        );
        console.log(
          `[TradeCopier] Skipped ${follower.name}: insufficient balance ($${availableUsdt.toFixed(2)} USDT)`
        );
        return;
      }

      const quantity = tradeUsdt / fillPrice;

      // Place order with retry
      const result = await this.retryOrder(() =>
        placeMarketOrder(exchange!, leaderTrade.symbol, "buy", quantity)
      );

      // Record the trade
      await this.insertFollowerTrade(
        leaderTrade.id,
        follower.id,
        leaderTrade.symbol,
        "buy",
        "filled",
        ratio,
        result.id,
        result.average ?? fillPrice
      );

      // Track the position
      await this.positionTracker.openPosition(
        follower.id,
        leaderTrade.symbol,
        result.average ?? fillPrice,
        result.filled || quantity,
        leaderTrade.positionGroupId || undefined
      );

      console.log(
        `[TradeCopier] ${follower.name}: BUY ${quantity.toFixed(6)} ${leaderTrade.symbol} @ ${(result.average ?? fillPrice).toFixed(2)}`
      );
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Unknown error";
      const isAuthError =
        errorMsg.includes("Invalid API") ||
        errorMsg.includes("auth") ||
        errorMsg.includes("permission");

      await this.insertFollowerTrade(
        leaderTrade.id,
        follower.id,
        leaderTrade.symbol,
        "buy",
        "failed",
        ratio,
        null,
        null,
        errorMsg
      );

      // Disable copying if auth error
      if (isAuthError) {
        await db
          .update(users)
          .set({ copyingEnabled: false })
          .where(eq(users.id, follower.id));
        console.log(
          `[TradeCopier] Disabled copying for ${follower.name}: API key error`
        );
      }
    } finally {
      if (exchange) {
        try {
          await exchange.close();
        } catch {
          // ignore
        }
      }
    }
  }

  private async executeSellForFollower(
    follower: User,
    leaderTrade: LeaderTrade,
    fillPrice: number
  ) {
    let exchange: ccxt.bybit | null = null;

    try {
      // Find open position for this follower + symbol
      const openPosition = await db
        .select()
        .from(positions)
        .where(
          and(
            eq(positions.userId, follower.id),
            eq(positions.symbol, leaderTrade.symbol),
            eq(positions.status, "open")
          )
        )
        .limit(1);

      if (openPosition.length === 0) {
        console.log(
          `[TradeCopier] No open position for ${follower.name} on ${leaderTrade.symbol}, skipping sell`
        );
        return;
      }

      const position = openPosition[0];
      const sellQuantity = Number(position.entryQuantity);

      // Decrypt keys and sell
      const apiKey = decrypt(follower.apiKeyEncrypted!);
      const apiSecret = decrypt(follower.apiSecretEncrypted!);
      exchange = createExchange({ apiKey, apiSecret });

      const result = await this.retryOrder(() =>
        placeMarketOrder(
          exchange!,
          leaderTrade.symbol,
          "sell",
          sellQuantity
        )
      );

      const exitPrice = result.average ?? fillPrice;

      // Record the follower trade
      await this.insertFollowerTrade(
        leaderTrade.id,
        follower.id,
        leaderTrade.symbol,
        "sell",
        "filled",
        Number(follower.copyRatioPercent) || 10,
        result.id,
        exitPrice
      );

      // Close position and calculate PnL
      const pnl = await this.positionTracker.closePosition(
        follower.id,
        leaderTrade.symbol,
        exitPrice,
        result.filled || sellQuantity
      );

      // Calculate fees if profitable
      if (pnl !== null && pnl > 0) {
        await this.feeCalculator.calculateFee(
          follower.id,
          position.id,
          pnl
        );
      }

      console.log(
        `[TradeCopier] ${follower.name}: SELL ${sellQuantity.toFixed(6)} ${leaderTrade.symbol} @ ${exitPrice.toFixed(2)} | PnL: ${pnl?.toFixed(2) || "N/A"}`
      );
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Unknown error";

      await this.insertFollowerTrade(
        leaderTrade.id,
        follower.id,
        leaderTrade.symbol,
        "sell",
        "failed",
        Number(follower.copyRatioPercent) || 10,
        null,
        null,
        errorMsg
      );
    } finally {
      if (exchange) {
        try {
          await exchange.close();
        } catch {
          // ignore
        }
      }
    }
  }

  private async getActiveFollowers(): Promise<User[]> {
    return db
      .select()
      .from(users)
      .where(
        and(
          eq(users.role, "follower"),
          eq(users.copyingEnabled, true)
        )
      );
  }

  private async retryOrder<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isRateLimit =
          lastError.message.includes("rate") ||
          lastError.message.includes("429");
        const isNetwork =
          lastError.message.includes("network") ||
          lastError.message.includes("ECONNRESET") ||
          lastError.message.includes("timeout");

        if (!isRateLimit && !isNetwork) throw lastError;

        const delay =
          RETRY_BASE_DELAY * Math.pow(2, attempt);
        console.log(
          `[TradeCopier] Retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms...`
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastError!;
  }

  private async insertFollowerTrade(
    leaderTradeId: string,
    followerId: string,
    symbol: string,
    side: "buy" | "sell",
    status: "pending" | "filled" | "failed" | "skipped",
    ratioUsed: number,
    bybitOrderId: string | null,
    avgFillPrice: number | null,
    errorMessage?: string
  ) {
    await db.insert(followerTrades).values({
      leaderTradeId,
      followerId,
      symbol,
      side,
      status,
      ratioUsed: String(ratioUsed),
      bybitOrderId,
      avgFillPrice: avgFillPrice ? String(avgFillPrice) : null,
      errorMessage: errorMessage || null,
    });
  }
}
