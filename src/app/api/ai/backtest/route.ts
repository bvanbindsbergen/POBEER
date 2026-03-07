import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { backtests } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { fetchCandles } from "@/lib/ai/data/candles";
import { runBacktest } from "@/lib/ai/backtest/engine";
import type { StrategyConfig } from "@/lib/ai/backtest/types";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = await req.json();

    const { symbol, timeframe, startDate, endDate, strategyConfig, conversationId } = body;

    if (!symbol || !timeframe || !startDate || !endDate || !strategyConfig) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Create backtest record
    const [backtest] = await db
      .insert(backtests)
      .values({
        userId: auth.user.id,
        conversationId: conversationId || null,
        symbol,
        timeframe,
        startDate,
        endDate,
        strategyConfig: JSON.stringify(strategyConfig),
        status: "running",
      })
      .returning();

    try {
      // Fetch candles
      const start = new Date(startDate);
      const end = new Date(endDate);
      const daysBack = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      const candles = await fetchCandles(symbol, timeframe, daysBack);

      // Filter to date range
      const filtered = candles.filter(
        (c) => c.timestamp >= start.getTime() && c.timestamp <= end.getTime()
      );

      // Run backtest
      const config: StrategyConfig = strategyConfig;
      const result = runBacktest(filtered, config);

      // Update record with results
      const [updated] = await db
        .update(backtests)
        .set({
          status: "completed",
          totalPnl: String(result.totalPnl),
          winRate: String(result.winRate),
          maxDrawdown: String(result.maxDrawdown),
          sharpeRatio: String(result.sharpeRatio),
          profitFactor: String(result.profitFactor),
          totalTrades: result.totalTrades,
          trades: JSON.stringify(result.trades),
          equityCurve: JSON.stringify(result.equityCurve),
          updatedAt: new Date(),
        })
        .where(eq(backtests.id, backtest.id))
        .returning();

      return NextResponse.json({ backtest: updated });
    } catch (error) {
      await db
        .update(backtests)
        .set({
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "Unknown error",
          updatedAt: new Date(),
        })
        .where(eq(backtests.id, backtest.id));

      return NextResponse.json(
        { error: "Backtest failed", details: error instanceof Error ? error.message : "Unknown" },
        { status: 500 }
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Backtest error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const auth = await requireAuth();

    const results = await db
      .select({
        id: backtests.id,
        symbol: backtests.symbol,
        timeframe: backtests.timeframe,
        startDate: backtests.startDate,
        endDate: backtests.endDate,
        status: backtests.status,
        totalPnl: backtests.totalPnl,
        winRate: backtests.winRate,
        maxDrawdown: backtests.maxDrawdown,
        sharpeRatio: backtests.sharpeRatio,
        profitFactor: backtests.profitFactor,
        totalTrades: backtests.totalTrades,
        strategyConfig: backtests.strategyConfig,
        createdAt: backtests.createdAt,
      })
      .from(backtests)
      .where(eq(backtests.userId, auth.user.id))
      .orderBy(desc(backtests.createdAt))
      .limit(50);

    return NextResponse.json({ backtests: results });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Backtests list error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
