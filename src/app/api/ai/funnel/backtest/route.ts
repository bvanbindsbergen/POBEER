import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { fetchCandlesBatch, type Candle } from "@/lib/ai/data/candles";
import { runBacktest } from "@/lib/ai/backtest/engine";
import type { GeneratedStrategy } from "@/lib/ai/funnel/generator";
import type { Trade, EquityPoint } from "@/lib/ai/backtest/types";

export const maxDuration = 120; // allow up to 2 min for large batches

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

    // Fetch candles per symbol with throttled concurrency
    const symbolList = [...bySymbol.keys()];
    const candleResults = await fetchCandlesBatch(
      symbolList.map((symbol) => ({ symbol, timeframe, daysBack }))
    );

    const candleCache = new Map<string, Candle[]>();
    for (let i = 0; i < symbolList.length; i++) {
      const result = candleResults[i];
      if (result.status === "fulfilled" && result.value.length >= 30) {
        candleCache.set(symbolList[i], result.value);
      } else if (result.status === "rejected") {
        console.error(`[Funnel Backtest] Failed to fetch candles for ${symbolList[i]}:`, result.reason);
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
      trades: Trade[];
      equityCurve: EquityPoint[];
    }[] = [];

    let totalTested = 0;

    for (const [symbol, symbolStrategies] of bySymbol) {
      const candles = candleCache.get(symbol);
      if (!candles) continue;

      for (const strategy of symbolStrategies) {
        totalTested++;
        try {
          const result = await runBacktest(candles, strategy.strategyConfig, symbol);

          // totalPnl from engine is absolute dollars on $10k equity — convert to %
          const INITIAL_EQUITY = 10000;
          const totalReturnPct = Math.round((result.totalPnl / INITIAL_EQUITY) * 100 * 100) / 100;

          // Only include strategies that pass the minimum profit filter
          if (totalReturnPct >= minProfitPercent) {
            results.push({
              strategy,
              metrics: {
                totalPnl: Math.round(totalReturnPct * 100) / 100,
                winRate: Math.round(result.winRate * 100) / 100,
                maxDrawdown: Math.round(result.maxDrawdown * 100) / 100,
                sharpeRatio: Math.round(result.sharpeRatio * 100) / 100,
                profitFactor: Math.round(result.profitFactor * 100) / 100,
                totalTrades: result.totalTrades,
              },
              trades: result.trades,
              // Downsample equity curve to max 200 points to keep response size manageable
              equityCurve: downsampleEquity(result.equityCurve, 200),
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

function downsampleEquity(curve: EquityPoint[], maxPoints: number): EquityPoint[] {
  if (curve.length <= maxPoints) return curve;
  const step = curve.length / maxPoints;
  const result: EquityPoint[] = [];
  for (let i = 0; i < maxPoints; i++) {
    result.push(curve[Math.floor(i * step)]);
  }
  // Always include the last point
  result.push(curve[curve.length - 1]);
  return result;
}
