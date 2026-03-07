import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { operationalStrategies, operationalStrategyTrades } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireRole("leader");
    const { id } = await params;

    const [strategy] = await db
      .select()
      .from(operationalStrategies)
      .where(
        and(
          eq(operationalStrategies.id, id),
          eq(operationalStrategies.userId, auth.user.id)
        )
      )
      .limit(1);

    if (!strategy) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const trades = await db
      .select()
      .from(operationalStrategyTrades)
      .where(eq(operationalStrategyTrades.strategyId, id))
      .orderBy(desc(operationalStrategyTrades.createdAt))
      .limit(50);

    return NextResponse.json({ strategy, trades });
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireRole("leader");
    const { id } = await params;
    const body = await req.json();
    const { action } = body;

    const [strategy] = await db
      .select()
      .from(operationalStrategies)
      .where(
        and(
          eq(operationalStrategies.id, id),
          eq(operationalStrategies.userId, auth.user.id)
        )
      )
      .limit(1);

    if (!strategy) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (action === "pause" && strategy.status === "active") {
      const [updated] = await db
        .update(operationalStrategies)
        .set({ status: "paused", pausedAt: new Date(), updatedAt: new Date() })
        .where(eq(operationalStrategies.id, id))
        .returning();
      return NextResponse.json({ strategy: updated });
    }

    if (action === "resume" && strategy.status === "paused") {
      const [updated] = await db
        .update(operationalStrategies)
        .set({ status: "active", pausedAt: null, updatedAt: new Date() })
        .where(eq(operationalStrategies.id, id))
        .returning();
      return NextResponse.json({ strategy: updated });
    }

    return NextResponse.json({ error: "Invalid action for current status" }, { status: 400 });
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
