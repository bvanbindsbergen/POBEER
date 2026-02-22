import { db } from "../lib/db";
import { positions } from "../lib/db/schema";
import { eq, and } from "drizzle-orm";

export class PositionTracker {
  async openPosition(
    userId: string,
    symbol: string,
    entryPrice: number,
    entryQuantity: number,
    positionGroupId?: string
  ): Promise<string> {
    const [position] = await db
      .insert(positions)
      .values({
        userId,
        symbol,
        side: "buy",
        entryPrice: String(entryPrice),
        entryQuantity: String(entryQuantity),
        status: "open",
        positionGroupId: positionGroupId || null,
      })
      .returning();

    console.log(
      `[PositionTracker] Opened position: ${symbol} qty=${entryQuantity} @ $${entryPrice} for user ${userId}`
    );

    return position.id;
  }

  async closePosition(
    userId: string,
    symbol: string,
    exitPrice: number,
    exitQuantity: number
  ): Promise<number | null> {
    // Find the oldest open position for this user + symbol
    const [openPosition] = await db
      .select()
      .from(positions)
      .where(
        and(
          eq(positions.userId, userId),
          eq(positions.symbol, symbol),
          eq(positions.status, "open")
        )
      )
      .orderBy(positions.createdAt)
      .limit(1);

    if (!openPosition) {
      console.log(
        `[PositionTracker] No open position found for ${symbol} user ${userId}`
      );
      return null;
    }

    const entryPrice = Number(openPosition.entryPrice);
    const entryQty = Number(openPosition.entryQuantity);
    const closeQty = Math.min(exitQuantity, entryQty);

    // Calculate realized PnL: (exitPrice - entryPrice) * quantity
    const realizedPnl = (exitPrice - entryPrice) * closeQty;

    await db
      .update(positions)
      .set({
        exitPrice: String(exitPrice),
        exitQuantity: String(closeQty),
        realizedPnl: String(realizedPnl),
        status: "closed",
        closedAt: new Date(),
      })
      .where(eq(positions.id, openPosition.id));

    console.log(
      `[PositionTracker] Closed position: ${symbol} PnL=$${realizedPnl.toFixed(2)} for user ${userId}`
    );

    return realizedPnl;
  }

  async getOpenPositions(userId: string) {
    return db
      .select()
      .from(positions)
      .where(
        and(eq(positions.userId, userId), eq(positions.status, "open"))
      );
  }

  async getOpenPositionForSymbol(userId: string, symbol: string) {
    const [position] = await db
      .select()
      .from(positions)
      .where(
        and(
          eq(positions.userId, userId),
          eq(positions.symbol, symbol),
          eq(positions.status, "open")
        )
      )
      .limit(1);

    return position || null;
  }
}
