import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { createExchange } from "@/lib/exchange/client";
import { fetchCandles } from "@/lib/ai/data/candles";
import { calculateIndicator } from "@/lib/ai/indicators";

interface MarketSignal {
  symbol: string;
  currentPrice: number;
  volume24h: number;
  signals: string[]; // human-readable signal descriptions
  score: number; // composite score (more signals = higher)
  timeframe: string;
}

// Cache
let cachedResults: MarketSignal[] = [];
let lastScanTime = 0;
const CACHE_TTL = 5 * 60_000; // 5 min

// Top coins to scan (by typical volume on ByBit)
const TOP_SYMBOLS = [
  "BTC/USDT", "ETH/USDT", "SOL/USDT", "XRP/USDT", "DOGE/USDT",
  "ADA/USDT", "AVAX/USDT", "DOT/USDT", "LINK/USDT", "MATIC/USDT",
  "NEAR/USDT", "UNI/USDT", "ATOM/USDT", "LTC/USDT", "FIL/USDT",
  "APT/USDT", "ARB/USDT", "OP/USDT", "INJ/USDT", "SUI/USDT",
];

export async function GET(req: NextRequest) {
  try {
    await requireRole("leader");

    const url = new URL(req.url);
    const timeframe = url.searchParams.get("timeframe") || "1h";
    const now = Date.now();

    // Return cached if fresh
    if (now - lastScanTime < CACHE_TTL && cachedResults.length > 0) {
      return NextResponse.json({ signals: cachedResults, cached: true, scannedAt: lastScanTime });
    }

    const results: MarketSignal[] = [];

    for (const symbol of TOP_SYMBOLS) {
      try {
        const candles = await fetchCandles(symbol, timeframe, 14); // 14 days for indicator warmup
        if (candles.length < 30) continue;

        const signals: string[] = [];
        const lastIdx = candles.length - 1;

        // RSI Analysis
        const rsiResult = calculateIndicator("rsi", candles, { period: 14 });
        const rsiVal = rsiResult.values[lastIdx] as number | undefined;
        const rsiPrev = rsiResult.values[lastIdx - 1] as number | undefined;
        if (rsiVal !== undefined) {
          if (rsiVal < 30) signals.push(`RSI oversold (${rsiVal.toFixed(1)})`);
          else if (rsiVal > 70) signals.push(`RSI overbought (${rsiVal.toFixed(1)})`);
          if (rsiPrev !== undefined && rsiPrev < 30 && rsiVal >= 30) signals.push("RSI bouncing from oversold");
        }

        // MACD Analysis
        const macdResult = calculateIndicator("macd", candles, {});
        const macdCurr = macdResult.values[lastIdx] as { macd?: number; signal?: number; histogram?: number } | undefined;
        const macdPrev = macdResult.values[lastIdx - 1] as { macd?: number; signal?: number; histogram?: number } | undefined;
        if (macdCurr && macdPrev && macdCurr.macd !== undefined && macdCurr.signal !== undefined) {
          if (macdPrev.macd !== undefined && macdPrev.signal !== undefined) {
            if (macdPrev.macd <= macdPrev.signal && macdCurr.macd > macdCurr.signal) {
              signals.push("MACD bullish crossover");
            }
            if (macdPrev.macd >= macdPrev.signal && macdCurr.macd < macdCurr.signal) {
              signals.push("MACD bearish crossover");
            }
          }
          if (macdCurr.histogram !== undefined) {
            if (macdCurr.histogram > 0 && macdPrev?.histogram !== undefined && macdPrev.histogram <= 0) {
              signals.push("MACD histogram turned positive");
            }
          }
        }

        // Bollinger Bands Analysis
        const bbResult = calculateIndicator("bollinger", candles, { period: 20, stdDev: 2 });
        const bbCurr = bbResult.values[lastIdx] as { upper?: number; middle?: number; lower?: number } | undefined;
        if (bbCurr && bbCurr.lower !== undefined && bbCurr.upper !== undefined) {
          const price = candles[lastIdx].close;
          if (price <= bbCurr.lower) signals.push("Price at lower Bollinger Band");
          if (price >= bbCurr.upper) signals.push("Price at upper Bollinger Band");
          // BB Squeeze: narrow bands
          const bandwidth = bbCurr.upper - bbCurr.lower;
          const bbPrev = bbResult.values[lastIdx - 5] as { upper?: number; lower?: number } | undefined;
          if (bbPrev?.upper !== undefined && bbPrev?.lower !== undefined) {
            const prevBandwidth = bbPrev.upper - bbPrev.lower;
            if (bandwidth < prevBandwidth * 0.6) {
              signals.push("Bollinger Band squeeze (breakout imminent)");
            }
          }
        }

        // EMA Crossovers
        const ema9Result = calculateIndicator("ema", candles, { period: 9 });
        const ema21Result = calculateIndicator("ema", candles, { period: 21 });
        const ema9 = ema9Result.values[lastIdx] as number | undefined;
        const ema21 = ema21Result.values[lastIdx] as number | undefined;
        const ema9Prev = ema9Result.values[lastIdx - 1] as number | undefined;
        const ema21Prev = ema21Result.values[lastIdx - 1] as number | undefined;
        if (ema9 !== undefined && ema21 !== undefined && ema9Prev !== undefined && ema21Prev !== undefined) {
          if (ema9Prev <= ema21Prev && ema9 > ema21) signals.push("EMA 9/21 golden cross");
          if (ema9Prev >= ema21Prev && ema9 < ema21) signals.push("EMA 9/21 death cross");
        }

        // Stochastic
        const stochResult = calculateIndicator("stochastic", candles, { period: 14, signalPeriod: 3 });
        const stochCurr = stochResult.values[lastIdx] as { k?: number; d?: number } | undefined;
        if (stochCurr?.k !== undefined && stochCurr?.d !== undefined) {
          if (stochCurr.k < 20 && stochCurr.d < 20) signals.push(`Stochastic oversold (K:${stochCurr.k.toFixed(0)} D:${stochCurr.d.toFixed(0)})`);
          if (stochCurr.k > 80 && stochCurr.d > 80) signals.push(`Stochastic overbought (K:${stochCurr.k.toFixed(0)} D:${stochCurr.d.toFixed(0)})`);
        }

        if (signals.length > 0) {
          results.push({
            symbol,
            currentPrice: candles[lastIdx].close,
            volume24h: candles.slice(-24).reduce((s, c) => s + c.volume, 0),
            signals,
            score: signals.length,
            timeframe,
          });
        }
      } catch (err) {
        // Skip symbols that fail
        console.error(`[MarketScanner] Failed to scan ${symbol}:`, err);
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    cachedResults = results;
    lastScanTime = now;

    return NextResponse.json({ signals: results, cached: false, scannedAt: now });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[Market Scanner] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
