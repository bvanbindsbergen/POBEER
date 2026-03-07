import { db } from "@/lib/db";
import { ohlcvCache } from "@/lib/db/schema";
import { createExchange } from "@/lib/exchange/client";
import { and, eq, gte, lte } from "drizzle-orm";

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function fetchCandles(
  symbol: string,
  timeframe: string,
  daysBack: number,
  limit?: number
): Promise<Candle[]> {
  const now = Date.now();
  const since = now - daysBack * 24 * 60 * 60 * 1000;

  // Check cache first
  const cached = await db
    .select()
    .from(ohlcvCache)
    .where(
      and(
        eq(ohlcvCache.symbol, symbol),
        eq(ohlcvCache.timeframe, timeframe),
        gte(ohlcvCache.timestamp, new Date(since)),
        lte(ohlcvCache.timestamp, new Date(now))
      )
    )
    .orderBy(ohlcvCache.timestamp);

  // If we have cached data and the latest candle is less than 1 hour old, use cache
  if (cached.length > 0) {
    const latestCached = cached[cached.length - 1].timestamp.getTime();
    if (now - latestCached < 60 * 60 * 1000) {
      const candles = cached.map((c) => ({
        timestamp: c.timestamp.getTime(),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));
      return limit ? candles.slice(-limit) : candles;
    }
  }

  // Fetch from exchange
  const exchange = createExchange();
  try {
    const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, since, limit || 1000);

    if (ohlcv.length > 0) {
      // Upsert into cache
      const rows = ohlcv.map((c) => ({
        symbol,
        timeframe,
        timestamp: new Date(c[0] as number),
        open: c[1] as number,
        high: c[2] as number,
        low: c[3] as number,
        close: c[4] as number,
        volume: c[5] as number,
      }));

      // Insert in batches to avoid query size limits
      const batchSize = 500;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        await db
          .insert(ohlcvCache)
          .values(batch)
          .onConflictDoUpdate({
            target: [ohlcvCache.symbol, ohlcvCache.timeframe, ohlcvCache.timestamp],
            set: {
              open: ohlcvCache.open,
              high: ohlcvCache.high,
              low: ohlcvCache.low,
              close: ohlcvCache.close,
              volume: ohlcvCache.volume,
            },
          });
      }
    }

    return ohlcv.map((c) => ({
      timestamp: c[0] as number,
      open: c[1] as number,
      high: c[2] as number,
      low: c[3] as number,
      close: c[4] as number,
      volume: c[5] as number,
    }));
  } finally {
    await exchange.close();
  }
}
