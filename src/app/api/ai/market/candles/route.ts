import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { fetchCandles } from "@/lib/ai/data/candles";

export async function GET(req: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get("symbol") || "BTC/USDT";
    const timeframe = searchParams.get("timeframe") || "1h";
    const days = Math.min(Number(searchParams.get("days")) || 30, 365);

    const candles = await fetchCandles(symbol, timeframe, days);

    return NextResponse.json({ candles });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Candles error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
