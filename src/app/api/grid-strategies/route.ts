import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { gridStrategies } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  try {
    const auth = await requireRole("leader");

    const strategies = await db
      .select()
      .from(gridStrategies)
      .where(eq(gridStrategies.userId, auth.user.id))
      .orderBy(desc(gridStrategies.createdAt));

    return NextResponse.json({ strategies });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRole("leader");
    const body = await req.json();

    const { symbol, mode, upperBound, lowerBound, gridCount, investmentAmount, tradingMode } = body;

    // Validate required fields
    if (!symbol || !upperBound || !lowerBound || !gridCount || !investmentAmount) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (upperBound <= lowerBound) {
      return NextResponse.json({ error: "Upper bound must be greater than lower bound" }, { status: 400 });
    }

    if (gridCount < 5 || gridCount > 50) {
      return NextResponse.json({ error: "Grid count must be between 5 and 50" }, { status: 400 });
    }

    if (investmentAmount < 10) {
      return NextResponse.json({ error: "Investment amount must be at least $10" }, { status: 400 });
    }

    const [strategy] = await db
      .insert(gridStrategies)
      .values({
        userId: auth.user.id,
        symbol,
        mode: mode || "arithmetic",
        upperBound: Number(upperBound),
        lowerBound: Number(lowerBound),
        gridCount: Number(gridCount),
        investmentAmount: Number(investmentAmount),
        tradingMode: tradingMode || "paper",
        status: "active",
      })
      .returning();

    return NextResponse.json({ strategy }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
