import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { generateStrategies, type FunnelConfig } from "@/lib/ai/funnel/generator";

export async function POST(req: NextRequest) {
  try {
    await requireRole("leader");

    const body = await req.json();
    const config: FunnelConfig = {
      signals: body.signals || [],
      timeframe: body.timeframe || "1h",
      maxStrategies: Math.min(body.maxStrategies || 1000, 5000),
      slRange: body.slRange || [2, 3, 5],
      tpRange: body.tpRange || [3, 5, 8, 12],
      minProfitPercent: body.minProfitPercent || 5,
      positionSizePercent: body.positionSizePercent || 10,
    };

    if (!config.signals.length) {
      return NextResponse.json({ error: "No signals provided" }, { status: 400 });
    }

    const start = performance.now();
    const strategies = generateStrategies(config);
    const elapsed = performance.now() - start;

    return NextResponse.json({
      strategies,
      totalGenerated: strategies.length,
      generationTimeMs: Math.round(elapsed),
      config: {
        timeframe: config.timeframe,
        minProfitPercent: config.minProfitPercent,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[Funnel Generate] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
