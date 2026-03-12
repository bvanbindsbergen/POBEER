import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { fetchCandles } from "@/lib/ai/data/candles";
import { runBacktest } from "@/lib/ai/backtest/engine";
import type { GeneratedStrategy } from "@/lib/ai/funnel/generator";

export async function POST(req: NextRequest) {
  try {
    await requireRole("leader");

    const body = await req.json();
    const strategies: GeneratedStrategy[] = body.strategies || [];
    const daysBack: number = body.daysBack || 90;
    const minProfitPercent: number = body.minProfitPercent ?? 5;
    const timeframe: string = body.timeframe || "1h";

    if (!strategies.length) {
      return NextResponse.json({ error: "No strategies provided" }, { status: 400 });
    }

    const start = performance.now();

    // Group strategies by symbol to fetch candles only once per symbol
    const bySymbol = new Map<string, GeneratedStrategy[]>();
    for (const s of strategies) {
      const list = bySymbol.get(s.symbol) || [];
      list.push(s);
      bySymbol.set(s.symbol, list);
    }

    // Fetch candles per symbol (key optimization)
    const candleCache = new Map<string, Awaited<ReturnType<typeof fetchCandles>>>();
    for (const symbol of bySymbol.keys()) {
      try {
        const candles = await fetchCandles(symbol, timeframe, daysBack);
        if (candles.length >= 30) {
          candleCache.set(symbol, candles);
        }
      } catch (err) {
        console.error(`[Funnel Backtest] Failed to fetch candles for ${symbol}:`, err);
      }
    }

    // Run backtests
    const results: {
      strategy: GeneratedStrategy;
      metrics: {
        totalPnl: number;
        winRate: number;
        maxDrawdown: number;
        sharpeRatio: number;
        profitFactor: number;
        totalTrades: number;
      };
    }[] = [];

    let totalTested = 0;

    for (const [symbol, symbolStrategies] of bySymbol) {
      const candles = candleCache.get(symbol);
      if (!candles) continue;

      for (const strategy of symbolStrategies) {
        totalTested++;
        try {
          const result = runBacktest(candles, strategy.strategyConfig);

          // Only include strategies that pass the minimum profit filter
          if (result.totalPnl >= minProfitPercent) {
            results.push({
              strategy,
              metrics: {
                totalPnl: Math.round(result.totalPnl * 100) / 100,
                winRate: Math.round(result.winRate * 100) / 100,
                maxDrawdown: Math.round(result.maxDrawdown * 100) / 100,
                sharpeRatio: Math.round(result.sharpeRatio * 100) / 100,
                profitFactor: Math.round(result.profitFactor * 100) / 100,
                totalTrades: result.totalTrades,
              },
            });
          }
        } catch (err) {
          // Skip strategies that error during backtest
          console.error(`[Funnel Backtest] Error on ${strategy.name}:`, err);
        }
      }
    }

    // Sort by totalPnl descending
    results.sort((a, b) => b.metrics.totalPnl - a.metrics.totalPnl);

    const elapsed = performance.now() - start;

    return NextResponse.json({
      totalTested,
      totalPassed: results.length,
      executionTimeMs: Math.round(elapsed),
      results,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[Funnel Backtest] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
