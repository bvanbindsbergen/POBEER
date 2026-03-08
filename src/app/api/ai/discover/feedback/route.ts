import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { strategyFeedback } from "@/lib/db/schema";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = await req.json();

    const { strategyName, symbol, timeframe, action, reason, strategyConfig } = body;

    if (!strategyName || !symbol || !action) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (action !== "approved" && action !== "declined") {
      return NextResponse.json({ error: "Action must be 'approved' or 'declined'" }, { status: 400 });
    }

    const [feedback] = await db
      .insert(strategyFeedback)
      .values({
        userId: auth.user.id,
        strategyName,
        symbol,
        timeframe: timeframe || "",
        action,
        reason: reason || null,
        strategyConfig: strategyConfig ? JSON.stringify(strategyConfig) : null,
      })
      .returning();

    return NextResponse.json({ feedback });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Strategy feedback error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
