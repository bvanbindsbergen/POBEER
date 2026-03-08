import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { gridStrategies, gridOrders } from "@/lib/db/schema";
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
      .from(gridStrategies)
      .where(
        and(
          eq(gridStrategies.id, id),
          eq(gridStrategies.userId, auth.user.id)
        )
      )
      .limit(1);

    if (!strategy) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const orders = await db
      .select()
      .from(gridOrders)
      .where(eq(gridOrders.gridStrategyId, id))
      .orderBy(desc(gridOrders.createdAt))
      .limit(200);

    return NextResponse.json({ strategy, orders });
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
      .from(gridStrategies)
      .where(
        and(
          eq(gridStrategies.id, id),
          eq(gridStrategies.userId, auth.user.id)
        )
      )
      .limit(1);

    if (!strategy) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (action === "pause" && strategy.status === "active") {
      const [updated] = await db
        .update(gridStrategies)
        .set({ status: "paused", updatedAt: new Date() })
        .where(eq(gridStrategies.id, id))
        .returning();
      return NextResponse.json({ strategy: updated });
    }

    if (action === "resume" && strategy.status === "paused") {
      const [updated] = await db
        .update(gridStrategies)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(gridStrategies.id, id))
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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireRole("leader");
    const { id } = await params;

    const [strategy] = await db
      .select()
      .from(gridStrategies)
      .where(
        and(
          eq(gridStrategies.id, id),
          eq(gridStrategies.userId, auth.user.id)
        )
      )
      .limit(1);

    if (!strategy) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [updated] = await db
      .update(gridStrategies)
      .set({
        status: "stopped",
        stoppedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(gridStrategies.id, id))
      .returning();

    return NextResponse.json({ strategy: updated });
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
