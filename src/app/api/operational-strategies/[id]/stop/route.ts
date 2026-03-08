import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { operationalStrategies, operationalStrategyTrades } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { createExchange, placeMarketOrder } from "@/lib/exchange/client";
import { fetchCandles } from "@/lib/ai/data/candles";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireRole("leader");
    const { id } = await params;
    const body = await req.json();
    const { forceClose } = body;

    const [strategy] = await db
      .select()
      .from(operationalStrategies)
      .where(
        and(
          eq(operationalStrategies.id, id),
          eq(operationalStrategies.userId, auth.user.id)
        )
      )
      .limit(1);

    if (!strategy) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (strategy.status === "stopped") {
      return NextResponse.json({ error: "Strategy already stopped" }, { status: 400 });
    }

    // Force close open position if requested
    if (forceClose && strategy.inPosition && strategy.entryPrice && strategy.entryQuantity) {
      if (!auth.user.apiKeyEncrypted || !auth.user.apiSecretEncrypted) {
        return NextResponse.json({ error: "No API keys configured" }, { status: 400 });
      }

      const apiKey = decrypt(auth.user.apiKeyEncrypted);
      const apiSecret = decrypt(auth.user.apiSecretEncrypted);
      const exchange = createExchange({ apiKey, apiSecret }, false, auth.user.exchange || "bybit");

      try {
        const order = await placeMarketOrder(exchange, strategy.symbol, "sell", strategy.entryQuantity);
        const fillPrice = order.average || order.price || strategy.entryPrice;
        const pnl = (fillPrice - strategy.entryPrice) * strategy.entryQuantity;

        // Record the closing trade
        await db.insert(operationalStrategyTrades).values({
          strategyId: strategy.id,
          symbol: strategy.symbol,
          side: "sell",
          quantity: strategy.entryQuantity,
          price: fillPrice,
          bybitOrderId: order.id,
          pnl,
          reason: "manual_stop",
        });

        // Update with closed position
        const [updated] = await db
          .update(operationalStrategies)
          .set({
            status: "stopped",
            stoppedAt: new Date(),
            stoppedReason: "manual",
            inPosition: false,
            entryPrice: null,
            entryQuantity: null,
            todayPnl: (strategy.todayPnl || 0) + pnl,
            totalPnl: (strategy.totalPnl || 0) + pnl,
            tradesCount: (strategy.tradesCount || 0) + 1,
            updatedAt: new Date(),
          })
          .where(eq(operationalStrategies.id, id))
          .returning();

        return NextResponse.json({ strategy: updated, closedPosition: true, pnl });
      } finally {
        await exchange.close();
      }
    }

    // Just stop without closing position
    const [updated] = await db
      .update(operationalStrategies)
      .set({
        status: "stopped",
        stoppedAt: new Date(),
        stoppedReason: "manual",
        updatedAt: new Date(),
      })
      .where(eq(operationalStrategies.id, id))
      .returning();

    return NextResponse.json({ strategy: updated });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[Stop Strategy] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
