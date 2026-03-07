import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { strategySuggestions } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  try {
    const auth = await requireAuth();

    const strategies = await db
      .select()
      .from(strategySuggestions)
      .where(eq(strategySuggestions.userId, auth.user.id))
      .orderBy(desc(strategySuggestions.createdAt))
      .limit(50);

    return NextResponse.json({ strategies });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = await req.json();

    const { name, symbol, timeframe, strategyConfig, notes, conversationId } = body;

    if (!name || !symbol || !timeframe || !strategyConfig) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const [strategy] = await db
      .insert(strategySuggestions)
      .values({
        userId: auth.user.id,
        conversationId: conversationId || null,
        name,
        symbol,
        timeframe,
        strategyConfig: typeof strategyConfig === "string" ? strategyConfig : JSON.stringify(strategyConfig),
        notes: notes || null,
      })
      .returning();

    return NextResponse.json({ strategy });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
