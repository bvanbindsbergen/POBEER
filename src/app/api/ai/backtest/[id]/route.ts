import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { backtests } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;

    const [backtest] = await db
      .select()
      .from(backtests)
      .where(and(eq(backtests.id, id), eq(backtests.userId, auth.user.id)))
      .limit(1);

    if (!backtest) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ backtest });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Backtest detail error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
