import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  operationalStrategies,
  operationalStrategyTrades,
  strategyEquitySnapshots,
} from "@/lib/db/schema";
import { eq, ne, asc, desc } from "drizzle-orm";

export async function GET() {
  try {
    await requireRole("leader");

    // 1. Equity curve: group snapshots by date, sum equity across strategies
    const snapshots = await db
      .select()
      .from(strategyEquitySnapshots)
      .orderBy(asc(strategyEquitySnapshots.snapshotDate));

    const equityByDate = new Map<string, number>();
    for (const snap of snapshots) {
      const prev = equityByDate.get(snap.snapshotDate) ?? 0;
      equityByDate.set(snap.snapshotDate, prev + snap.equity);
    }

    const equityCurve = Array.from(equityByDate.entries()).map(
      ([date, equity]) => ({ date, equity })
    );

    // 2. Strategy performance
    const allStrategies = await db
      .select()
      .from(operationalStrategies)
      .where(ne(operationalStrategies.status, "stopped"));

    const strategies = [];

    for (const strat of allStrategies) {
      // Get sell trades to compute metrics
      const sellTrades = await db
        .select()
        .from(operationalStrategyTrades)
        .where(eq(operationalStrategyTrades.strategyId, strat.id))
        .orderBy(desc(operationalStrategyTrades.createdAt));

      const sells = sellTrades.filter((t) => t.side === "sell" && t.pnl !== null);
      const wins = sells.filter((t) => (t.pnl ?? 0) > 0);
      const losses = sells.filter((t) => (t.pnl ?? 0) < 0);

      const winRate = sells.length > 0 ? wins.length / sells.length : 0;

      const avgWin =
        wins.length > 0
          ? wins.reduce((sum, t) => sum + (t.pnl ?? 0), 0) / wins.length
          : 0;

      const avgLoss =
        losses.length > 0
          ? losses.reduce((sum, t) => sum + (t.pnl ?? 0), 0) / losses.length
          : 0;

      const totalWins = wins.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
      const totalLosses = Math.abs(
        losses.reduce((sum, t) => sum + (t.pnl ?? 0), 0)
      );
      const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

      strategies.push({
        id: strat.id,
        name: strat.name,
        symbol: strat.symbol,
        totalPnl: strat.totalPnl ?? 0,
        tradesCount: strat.tradesCount ?? 0,
        winRate,
        avgWin,
        avgLoss,
        profitFactor: profitFactor === Infinity ? 999 : profitFactor,
        mode: strat.mode,
      });
    }

    // 3. Rolling drawdown from equity curve
    const rollingDrawdown: { date: string; drawdown: number }[] = [];
    let peak = 0;

    for (const point of equityCurve) {
      if (point.equity > peak) {
        peak = point.equity;
      }
      const drawdown = peak > 0 ? ((peak - point.equity) / peak) * 100 : 0;
      rollingDrawdown.push({ date: point.date, drawdown });
    }

    return NextResponse.json({
      equityCurve,
      strategies,
      rollingDrawdown,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[Analytics] Portfolio API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
