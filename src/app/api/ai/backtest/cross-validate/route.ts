import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { fetchCandles } from "@/lib/ai/data/candles";
import { runBacktest } from "@/lib/ai/backtest/engine";
import type { StrategyConfig } from "@/lib/ai/backtest/types";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    await requireAuth();
    const body = await req.json();

    const {
      symbols,
      timeframe,
      strategyConfig,
      dateRanges,
    }: {
      symbols: string[];
      timeframe: string;
      strategyConfig: StrategyConfig;
      dateRanges: { label: string; days: number }[];
    } = body;

    if (!symbols?.length || !timeframe || !strategyConfig || !dateRanges?.length) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const start = performance.now();
    const INITIAL_EQUITY = 10000;

    // Fetch candles for each symbol × dateRange individually
    // (fetchOHLCV caps at 1000 candles, so fetching once with maxDays misses recent data)
    const fetchJobs: { symbol: string; range: { label: string; days: number } }[] = [];
    for (const symbol of symbols) {
      for (const range of dateRanges) {
        fetchJobs.push({ symbol, range });
      }
    }

    // Run all fetches in parallel (max ~30 concurrent)
    const candleResults = await Promise.allSettled(
      fetchJobs.map((job) => fetchCandles(job.symbol, timeframe, job.range.days))
    );

    // Run backtests for each symbol × dateRange combo
    const results: {
      symbol: string;
      dateRange: string;
      days: number;
      totalPnl: number;
      winRate: number;
      sharpeRatio: number;
      profitFactor: number;
      maxDrawdown: number;
      totalTrades: number;
    }[] = [];

    for (let i = 0; i < fetchJobs.length; i++) {
      const { symbol, range } = fetchJobs[i];
      const candleResult = candleResults[i];

      if (candleResult.status !== "fulfilled" || candleResult.value.length < 20) {
        results.push({
          symbol, dateRange: range.label, days: range.days,
          totalPnl: 0, winRate: 0, sharpeRatio: 0, profitFactor: 0, maxDrawdown: 0, totalTrades: 0,
        });
        continue;
      }

      try {
        const rangeCandles = candleResult.value;
        const result = runBacktest(rangeCandles, strategyConfig);
        const totalReturnPct = (result.totalPnl / INITIAL_EQUITY) * 100;

        results.push({
          symbol,
          dateRange: range.label,
          days: range.days,
          totalPnl: Math.round(totalReturnPct * 100) / 100,
          winRate: Math.round(result.winRate * 10000) / 100,
          sharpeRatio: Math.round(result.sharpeRatio * 100) / 100,
          profitFactor: Math.round((result.profitFactor > 999 ? 999 : result.profitFactor) * 100) / 100,
          maxDrawdown: Math.round(result.maxDrawdown * 10000) / 100,
          totalTrades: result.totalTrades,
        });
      } catch (err) {
        console.error(`[Cross-Validate] Error on ${symbol} ${range.label}:`, err);
        results.push({
          symbol, dateRange: range.label, days: range.days,
          totalPnl: 0, winRate: 0, sharpeRatio: 0, profitFactor: 0, maxDrawdown: 0, totalTrades: 0,
        });
      }
    }

    // Compute summary
    const profitable = results.filter((r) => r.totalPnl > 0 && r.totalTrades > 0);
    const withTrades = results.filter((r) => r.totalTrades > 0);

    const elapsed = performance.now() - start;

    return NextResponse.json({
      results,
      summary: {
        totalTests: results.length,
        profitable: profitable.length,
        avgPnl: withTrades.length > 0 ? Math.round(withTrades.reduce((s, r) => s + r.totalPnl, 0) / withTrades.length * 100) / 100 : 0,
        avgSharpe: withTrades.length > 0 ? Math.round(withTrades.reduce((s, r) => s + r.sharpeRatio, 0) / withTrades.length * 100) / 100 : 0,
        avgWinRate: withTrades.length > 0 ? Math.round(withTrades.reduce((s, r) => s + r.winRate, 0) / withTrades.length * 100) / 100 : 0,
      },
      executionTimeMs: Math.round(elapsed),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[Cross-Validate] Error:", error);
    return NextResponse.json({ error: "Cross-validation failed" }, { status: 500 });
  }
}
