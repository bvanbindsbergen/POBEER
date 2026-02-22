import { db } from "../lib/db";
import { pendingTrades } from "../lib/db/schema";
import { eq, and, lte } from "drizzle-orm";
import { createNotification } from "../lib/notifications";

export class PendingTradeExpirer {
  /**
   * Expires all pending trades whose expiresAt has passed.
   * Called every 30 seconds from the worker scheduler.
   */
  async run(): Promise<void> {
    const now = new Date();

    const expired = await db
      .select()
      .from(pendingTrades)
      .where(
        and(
          eq(pendingTrades.status, "pending"),
          lte(pendingTrades.expiresAt, now)
        )
      );

    if (expired.length === 0) return;

    for (const trade of expired) {
      await db
        .update(pendingTrades)
        .set({ status: "expired" })
        .where(eq(pendingTrades.id, trade.id));

      await createNotification(
        trade.followerId,
        "trade_expired",
        `Trade expired: ${trade.side.toUpperCase()} ${trade.symbol}`,
        `Pending ${trade.side} ${trade.symbol} expired (approval window passed).`,
        { symbol: trade.symbol, side: trade.side }
      );
    }

    console.log(
      `[PendingTradeExpirer] Expired ${expired.length} pending trade(s)`
    );
  }
}
