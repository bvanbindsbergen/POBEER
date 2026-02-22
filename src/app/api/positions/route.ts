import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { positions, followerTrades } from "@/lib/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export async function GET() {
  try {
    const auth = await requireAuth();

    const userPositions = await db
      .select()
      .from(positions)
      .where(eq(positions.userId, auth.user.id))
      .orderBy(desc(positions.createdAt));

    // Summary
    const totalPnl = userPositions
      .filter((p) => p.status === "closed" && p.realizedPnl)
      .reduce((sum, p) => sum + Number(p.realizedPnl), 0);

    const openPositions = userPositions.filter(
      (p) => p.status === "open"
    ).length;

    const totalTradesResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(followerTrades)
      .where(eq(followerTrades.followerId, auth.user.id));

    const totalTrades = Number(totalTradesResult[0]?.count) || 0;

    return NextResponse.json({
      positions: userPositions,
      summary: {
        totalPnl,
        openPositions,
        totalTrades,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Positions error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
