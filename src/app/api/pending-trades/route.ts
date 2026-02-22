import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { pendingTrades } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  try {
    const auth = await requireAuth();

    const trades = await db
      .select()
      .from(pendingTrades)
      .where(eq(pendingTrades.followerId, auth.user.id))
      .orderBy(desc(pendingTrades.createdAt))
      .limit(50);

    return NextResponse.json({ pendingTrades: trades });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Pending trades error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
