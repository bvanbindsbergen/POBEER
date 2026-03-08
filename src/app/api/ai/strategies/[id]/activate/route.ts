import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  operationalStrategies,
  strategySuggestions,
  backtests,
  systemConfig,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireRole("leader");
    const { id } = await params;
    const body = await req.json();

    const {
      maxCapUsd = 500,
      maxCapPercent = 10,
      dailyLossLimitUsd = 100,
      sourceType = "strategy",
      mode = "live",
    } = body;

    // Validate mode
    if (mode !== "live" && mode !== "paper") {
      return NextResponse.json({ error: "Invalid trading mode. Must be 'live' or 'paper'" }, { status: 400 });
    }

    // Validate limits
    if (maxCapUsd <= 0 || maxCapPercent <= 0 || dailyLossLimitUsd <= 0) {
      return NextResponse.json({ error: "Invalid fund allocation values" }, { status: 400 });
    }

    // Check max concurrent strategies
    const [maxConfig] = await db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.key, "max_concurrent_strategies"))
      .limit(1);
    const maxConcurrent = maxConfig ? parseInt(maxConfig.value, 10) : 3;

    const activeStrategies = await db
      .select()
      .from(operationalStrategies)
      .where(eq(operationalStrategies.status, "active"));

    if (activeStrategies.length >= maxConcurrent) {
      return NextResponse.json(
        { error: `Maximum ${maxConcurrent} concurrent strategies allowed` },
        { status: 400 }
      );
    }

    let name: string;
    let symbol: string;
    let timeframe: string;
    let strategyConfig: string;
    let backtestId: string | null = null;

    if (sourceType === "backtest") {
      // Load from backtest
      const [bt] = await db
        .select()
        .from(backtests)
        .where(and(eq(backtests.id, id), eq(backtests.userId, auth.user.id)))
        .limit(1);

      if (!bt) {
        return NextResponse.json({ error: "Backtest not found" }, { status: 404 });
      }

      const config = JSON.parse(bt.strategyConfig);
      name = config.name || `${bt.symbol} ${bt.timeframe} Strategy`;
      symbol = bt.symbol;
      timeframe = bt.timeframe;
      strategyConfig = bt.strategyConfig;
      backtestId = bt.id;
    } else {
      // Load from strategy suggestion
      const [strat] = await db
        .select()
        .from(strategySuggestions)
        .where(and(eq(strategySuggestions.id, id), eq(strategySuggestions.userId, auth.user.id)))
        .limit(1);

      if (!strat) {
        return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
      }

      name = strat.name;
      symbol = strat.symbol;
      timeframe = strat.timeframe;
      strategyConfig = strat.strategyConfig;
    }

    // Insert operational strategy
    const today = new Date().toISOString().split("T")[0];
    const [opStrategy] = await db
      .insert(operationalStrategies)
      .values({
        userId: auth.user.id,
        backtestId,
        name,
        symbol,
        timeframe,
        strategyConfig,
        maxCapUsd,
        maxCapPercent,
        dailyLossLimitUsd,
        todayPnlDate: today,
        mode,
        paperBalance: mode === "paper" ? maxCapUsd : null,
      })
      .returning();

    return NextResponse.json({ strategy: opStrategy });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[Activate Strategy] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
