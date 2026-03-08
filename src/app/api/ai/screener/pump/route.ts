import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { createExchange } from "@/lib/exchange/client";

interface PumpSignal {
  symbol: string;
  priceChange: number; // %
  volumeChange: number; // %
  currentPrice: number;
  volume24h: number;
  timestamp: number;
}

// In-memory cache to avoid rate-limiting
let cachedSignals: PumpSignal[] = [];
let lastScanTime = 0;
const CACHE_TTL = 60_000; // 1 min cache

export async function GET(req: NextRequest) {
  try {
    await requireRole("leader");

    const url = new URL(req.url);
    const minPriceChange = Number(url.searchParams.get("minPrice") || "3");
    const minVolumeChange = Number(url.searchParams.get("minVolume") || "50");
    const timeWindow = Number(url.searchParams.get("window") || "5"); // minutes

    const now = Date.now();

    // Return cached if fresh
    if (now - lastScanTime < CACHE_TTL && cachedSignals.length > 0) {
      const filtered = cachedSignals.filter(
        (s) => Math.abs(s.priceChange) >= minPriceChange && s.volumeChange >= minVolumeChange
      );
      return NextResponse.json({ signals: filtered, cached: true, scannedAt: lastScanTime });
    }

    // Scan ByBit for all USDT spot pairs
    const exchange = createExchange();
    try {
      const tickers = await exchange.fetchTickers();

      const signals: PumpSignal[] = [];

      for (const [symbol, rawTicker] of Object.entries(tickers)) {
        // Only USDT pairs
        if (!symbol.endsWith("/USDT")) continue;

        const ticker = rawTicker as { percentage?: number; quoteVolume?: number; last?: number; timestamp?: number };
        const priceChange = ticker.percentage ?? 0;
        const volume = ticker.quoteVolume ?? 0;

        // We use 24h change as baseline; for short-window detection,
        // we check if the recent candle shows unusual movement
        // compared to the rolling average
        if (volume < 100_000) continue; // Skip low-volume pairs

        // Flag if price change exceeds threshold
        if (Math.abs(priceChange) >= minPriceChange) {
          signals.push({
            symbol,
            priceChange: Math.round(priceChange * 100) / 100,
            volumeChange: 0, // Will be enriched below
            currentPrice: ticker.last ?? 0,
            volume24h: Math.round(volume),
            timestamp: ticker.timestamp ?? now,
          });
        }
      }

      // Enrich with volume comparison (compare current volume to average)
      // For each signal, fetch recent short candles to compute volume spike
      const enriched: PumpSignal[] = [];
      for (const signal of signals.slice(0, 30)) { // Limit to top 30 to avoid rate limits
        try {
          const candles = await exchange.fetchOHLCV(
            signal.symbol,
            `${timeWindow}m`,
            now - 60 * 60 * 1000, // last hour
            12
          );

          if (candles.length >= 2) {
            const lastCandle = candles[candles.length - 1];
            const prevCandles = candles.slice(0, -1);
            const avgVolume = prevCandles.reduce((s: number, c: (number | undefined)[]) => s + (c[5] as number), 0) / prevCandles.length;
            const currentVolume = lastCandle[5] as number;
            const volChange = avgVolume > 0 ? ((currentVolume - avgVolume) / avgVolume) * 100 : 0;

            signal.volumeChange = Math.round(volChange * 100) / 100;
            if (signal.volumeChange >= minVolumeChange || Math.abs(signal.priceChange) >= minPriceChange * 2) {
              enriched.push(signal);
            }
          }
        } catch {
          // Skip pairs that fail (delisted, etc.)
        }
      }

      // Sort by absolute price change descending
      enriched.sort((a, b) => Math.abs(b.priceChange) - Math.abs(a.priceChange));

      cachedSignals = enriched;
      lastScanTime = now;

      return NextResponse.json({ signals: enriched, cached: false, scannedAt: now });
    } finally {
      await exchange.close();
    }
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[Pump Screener] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
