import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { fetchCandles } from "@/lib/ai/data/candles";
import { runWalkForward } from "@/lib/ai/backtest/walk-forward";
import type { StrategyConfig } from "@/lib/ai/backtest/types";

export async function POST(req: NextRequest) {
  try {
    await requireRole("leader");
    const body = await req.json();

    const { symbol, timeframe, days, strategyConfig, windowCount, inSampleRatio } = body;

    if (!symbol || !timeframe || !days || !strategyConfig) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Fetch candles
    const candles = await fetchCandles(symbol, timeframe, days);

    if (candles.length < 20) {
      return NextResponse.json(
        { error: "Not enough candle data for walk-forward analysis" },
        { status: 400 }
      );
    }

    // Run walk-forward
    const config: StrategyConfig = strategyConfig;
    const result = runWalkForward(
      candles,
      config,
      windowCount || 5,
      inSampleRatio || 0.7
    );

    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("Walk-forward error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
