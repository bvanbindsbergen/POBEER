import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  pendingTrades,
  users,
  leaderTrades,
  followerTrades,
  positions,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import {
  createExchange,
  fetchUsdtBalance,
  placeMarketOrder,
} from "@/lib/exchange/client";
import { createNotification } from "@/lib/notifications";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;
    const { decision } = await req.json(); // "approve" or "reject"

    if (!["approve", "reject"].includes(decision)) {
      return NextResponse.json(
        { error: "Decision must be 'approve' or 'reject'" },
        { status: 400 }
      );
    }

    // Fetch the pending trade
    const [trade] = await db
      .select()
      .from(pendingTrades)
      .where(
        and(
          eq(pendingTrades.id, id),
          eq(pendingTrades.followerId, auth.user.id)
        )
      )
      .limit(1);

    if (!trade) {
      return NextResponse.json(
        { error: "Pending trade not found" },
        { status: 404 }
      );
    }

    if (trade.status !== "pending") {
      return NextResponse.json(
        { error: `Trade already ${trade.status}` },
        { status: 400 }
      );
    }

    if (decision === "reject") {
      await db
        .update(pendingTrades)
        .set({ status: "rejected" })
        .where(eq(pendingTrades.id, id));

      return NextResponse.json({ success: true, status: "rejected" });
    }

    // Approve: execute the trade
    const user = auth.user;
    if (!user.apiKeyEncrypted || !user.apiSecretEncrypted) {
      return NextResponse.json(
        { error: "No API keys configured" },
        { status: 400 }
      );
    }

    const exchange = createExchange({
      apiKey: decrypt(user.apiKeyEncrypted),
      apiSecret: decrypt(user.apiSecretEncrypted),
    });

    try {
      const quantity = Number(trade.suggestedQuantity);
      const result = await placeMarketOrder(
        exchange,
        trade.symbol,
        trade.side as "buy" | "sell",
        quantity
      );

      // Record follower trade
      await db.insert(followerTrades).values({
        leaderTradeId: trade.leaderTradeId,
        followerId: user.id,
        symbol: trade.symbol,
        side: trade.side,
        status: "filled",
        ratioUsed: String(Number(user.copyRatioPercent) || 10),
        bybitOrderId: result.id,
        avgFillPrice: String(result.average ?? Number(trade.leaderFillPrice) ?? 0),
      });

      // Track position for buys
      if (trade.side === "buy") {
        await db.insert(positions).values({
          userId: user.id,
          symbol: trade.symbol,
          side: "buy",
          entryPrice: String(result.average ?? Number(trade.leaderFillPrice) ?? 0),
          entryQuantity: String(result.filled || quantity),
          status: "open",
        });
      }

      await db
        .update(pendingTrades)
        .set({ status: "approved" })
        .where(eq(pendingTrades.id, id));

      await createNotification(
        user.id,
        "trade_approved",
        `Approved: ${trade.side.toUpperCase()} ${trade.symbol}`,
        `Trade executed: ${quantity.toFixed(6)} ${trade.symbol} @ $${(result.average ?? 0).toFixed(2)}`,
        { symbol: trade.symbol, side: trade.side }
      );

      return NextResponse.json({
        success: true,
        status: "approved",
        result: {
          orderId: result.id,
          filled: result.filled,
          avgPrice: result.average,
        },
      });
    } finally {
      await exchange.close();
    }
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Pending trade decide error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
