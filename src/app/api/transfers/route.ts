import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { transferHistory } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  try {
    const auth = await requireAuth();

    const transfers = await db
      .select({
        id: transferHistory.id,
        type: transferHistory.transferType,
        amount: transferHistory.amount,
        coin: transferHistory.coin,
        occurredAt: transferHistory.occurredAt,
      })
      .from(transferHistory)
      .where(eq(transferHistory.userId, auth.user.id))
      .orderBy(desc(transferHistory.occurredAt))
      .limit(100);

    return NextResponse.json({ transfers });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Transfers error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
