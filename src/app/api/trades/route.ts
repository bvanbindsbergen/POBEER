import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { followerTrades, leaderTrades } from "@/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const limit = Math.min(Number(searchParams.get("limit")) || 50, 100);

    const isLeader = auth.user.role === "leader";

    if (isLeader) {
      // Leader sees their own trades
      const conditions = status
        ? and(eq(leaderTrades.status, status as "detected" | "open" | "closed"))
        : undefined;

      const trades = await db
        .select()
        .from(leaderTrades)
        .where(conditions)
        .orderBy(desc(leaderTrades.detectedAt))
        .limit(limit);

      return NextResponse.json({ trades });
    } else {
      // Followers see their copied trades
      const conditions = status
        ? and(
            eq(followerTrades.followerId, auth.user.id),
            eq(followerTrades.status, status as "pending" | "filled" | "failed" | "skipped")
          )
        : eq(followerTrades.followerId, auth.user.id);

      const trades = await db
        .select({
          id: followerTrades.id,
          symbol: followerTrades.symbol,
          side: followerTrades.side,
          quantity: followerTrades.quantity,
          avgFillPrice: followerTrades.avgFillPrice,
          status: followerTrades.status,
          ratioUsed: followerTrades.ratioUsed,
          errorMessage: followerTrades.errorMessage,
          createdAt: followerTrades.createdAt,
          leaderTradeId: followerTrades.leaderTradeId,
        })
        .from(followerTrades)
        .where(conditions)
        .orderBy(desc(followerTrades.createdAt))
        .limit(limit);

      return NextResponse.json({ trades });
    }
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Trades error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
