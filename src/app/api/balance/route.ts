import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { balanceSnapshots } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  try {
    const auth = await requireAuth();

    // Get latest balance snapshot
    const [latest] = await db
      .select()
      .from(balanceSnapshots)
      .where(eq(balanceSnapshots.userId, auth.user.id))
      .orderBy(desc(balanceSnapshots.snapshotDate))
      .limit(1);

    // Get last 30 snapshots for history
    const history = await db
      .select({
        date: balanceSnapshots.snapshotDate,
        balance: balanceSnapshots.balanceUsdt,
      })
      .from(balanceSnapshots)
      .where(eq(balanceSnapshots.userId, auth.user.id))
      .orderBy(desc(balanceSnapshots.snapshotDate))
      .limit(30);

    return NextResponse.json({
      currentBalance: latest ? Number(latest.balanceUsdt) : null,
      lastUpdated: latest?.snapshotDate || null,
      history: history.reverse(),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Balance error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
