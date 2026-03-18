import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { altDataSnapshots } from "@/lib/db/schema";
import { and, eq, gte, lte, isNull, asc, desc } from "drizzle-orm";

/**
 * GET: Query historical alternative data snapshots.
 * Used by the frontend to visualize alt data alongside price charts.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(req.url);
    const source = searchParams.get("source"); // funding_rate, reddit, google_trends, whale_flow
    const field = searchParams.get("field"); // rate, buzz, sentiment, etc.
    const symbol = searchParams.get("symbol") || null;
    const days = Number(searchParams.get("days") || "30");

    if (!source || !field) {
      return NextResponse.json(
        { error: "source and field are required" },
        { status: 400 }
      );
    }

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const conditions = [
      eq(altDataSnapshots.source, source),
      eq(altDataSnapshots.field, field),
      gte(altDataSnapshots.timestamp, since),
    ];

    if (symbol) {
      conditions.push(eq(altDataSnapshots.symbol, symbol));
    } else {
      conditions.push(isNull(altDataSnapshots.symbol));
    }

    const rows = await db
      .select({
        timestamp: altDataSnapshots.timestamp,
        value: altDataSnapshots.value,
      })
      .from(altDataSnapshots)
      .where(and(...conditions))
      .orderBy(asc(altDataSnapshots.timestamp))
      .limit(5000);

    return NextResponse.json({
      source,
      field,
      symbol,
      count: rows.length,
      data: rows.map((r) => ({
        timestamp: r.timestamp.toISOString(),
        value: r.value,
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Alt data query error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST: Trigger a manual collection of alternative data.
 * Useful for initial seeding or catching up after downtime.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAuth();

    // Dynamic import to avoid bundling worker code in the API route
    const { AltDataCollector } = await import("@/worker/alt-data-collector");
    const collector = new AltDataCollector();
    await collector.run();

    // Return latest counts per source
    const counts = await db
      .select({
        source: altDataSnapshots.source,
      })
      .from(altDataSnapshots)
      .orderBy(desc(altDataSnapshots.createdAt))
      .limit(1000);

    const sourceCounts: Record<string, number> = {};
    for (const row of counts) {
      sourceCounts[row.source] = (sourceCounts[row.source] || 0) + 1;
    }

    return NextResponse.json({
      message: "Alternative data collection triggered",
      recentCounts: sourceCounts,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Alt data collection error:", error);
    return NextResponse.json(
      { error: "Collection failed" },
      { status: 500 }
    );
  }
}
