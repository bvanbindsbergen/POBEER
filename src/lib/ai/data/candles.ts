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

/** Convert timeframe string to milliseconds */
function timeframeToMs(tf: string): number {
  const map: Record<string, number> = {
    "1m": 60_000,
    "5m": 5 * 60_000,
    "15m": 15 * 60_000,
    "30m": 30 * 60_000,
    "1h": 3_600_000,
    "2h": 2 * 3_600_000,
    "4h": 4 * 3_600_000,
    "6h": 6 * 3_600_000,
    "8h": 8 * 3_600_000,
    "12h": 12 * 3_600_000,
    "1d": 86_400_000,
    "3d": 3 * 86_400_000,
    "1w": 7 * 86_400_000,
  };
  return map[tf] || 3_600_000; // default 1h
}

// ── Concurrency limiter (module-level semaphore) ──
const MAX_CONCURRENT_EXCHANGE = 3;
let activeExchangeCalls = 0;
const waitQueue: (() => void)[] = [];

async function acquireSemaphore(): Promise<void> {
  if (activeExchangeCalls < MAX_CONCURRENT_EXCHANGE) {
    activeExchangeCalls++;
    return;
  }
  return new Promise<void>((resolve) => {
    waitQueue.push(() => {
      activeExchangeCalls++;
      resolve();
    });
  });
}

function releaseSemaphore(): void {
  activeExchangeCalls--;
  if (waitQueue.length > 0) {
    const next = waitQueue.shift()!;
    next();
  }
}

/** Small delay helper */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fetch candles with pagination to handle >1000 candle ranges.
 * Uses cache intelligently: if cache covers the range and is fresh, skip exchange.
 * If cache is partial, only fetches the gap.
 */
export async function fetchCandles(
  symbol: string,
  timeframe: string,
  daysBack: number,
  limit?: number
): Promise<Candle[]> {
  const now = Date.now();
  const since = now - daysBack * 24 * 60 * 60 * 1000;
  const tfMs = timeframeToMs(timeframe);

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

  // If cache covers the range and latest candle is <1hr old, use it
  if (cached.length > 0) {
    const latestCached = cached[cached.length - 1].timestamp.getTime();
    const earliestCached = cached[0].timestamp.getTime();
    const expectedCandles = Math.floor((now - since) / tfMs);
    const coverageRatio = cached.length / Math.max(expectedCandles, 1);

    if (now - latestCached < 60 * 60 * 1000 && coverageRatio > 0.9 && earliestCached <= since + tfMs * 2) {
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

  // Determine fetch start: if we have partial cache, fetch from last cached timestamp
  let fetchSince = since;
  if (cached.length > 0) {
    const latestCached = cached[cached.length - 1].timestamp.getTime();
    const earliestCached = cached[0].timestamp.getTime();
    // If cache starts near the requested start but is missing recent data, only fetch gap
    if (earliestCached <= since + tfMs * 2) {
      fetchSince = latestCached + tfMs;
    }
  }

  // Paginated fetch from exchange
  await acquireSemaphore();
  const exchange = createExchange();
  try {
    const allOhlcv: (number | undefined)[][] = [];
    let cursor = fetchSince;
    const PAGE_SIZE = 1000;

    while (cursor < now) {
      const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, cursor, PAGE_SIZE);

      if (!ohlcv || ohlcv.length === 0) break;

      allOhlcv.push(...ohlcv);

      const lastTs = ohlcv[ohlcv.length - 1][0] as number;
      // If we got fewer than PAGE_SIZE, we've reached the end
      if (ohlcv.length < PAGE_SIZE) break;
      // Advance cursor past last candle
      cursor = lastTs + tfMs;

      // If cursor is past now, we're done
      if (cursor >= now) break;

      // Rate-limit pause between pages
      await sleep(200);
    }

    if (allOhlcv.length > 0) {
      // Upsert into cache
      const rows = allOhlcv.map((c) => ({
        symbol,
        timeframe,
        timestamp: new Date(c[0] as number),
        open: c[1] as number,
        high: c[2] as number,
        low: c[3] as number,
        close: c[4] as number,
        volume: c[5] as number,
      }));

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

    // Combine cached data (before fetchSince) with newly fetched data
    const cachedBefore = cached
      .filter((c) => c.timestamp.getTime() < fetchSince)
      .map((c) => ({
        timestamp: c.timestamp.getTime(),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));

    const freshCandles = allOhlcv.map((c) => ({
      timestamp: c[0] as number,
      open: c[1] as number,
      high: c[2] as number,
      low: c[3] as number,
      close: c[4] as number,
      volume: c[5] as number,
    }));

    // Merge and deduplicate by timestamp
    const merged = [...cachedBefore, ...freshCandles];
    const seen = new Set<number>();
    const deduped = merged.filter((c) => {
      if (seen.has(c.timestamp)) return false;
      seen.add(c.timestamp);
      return true;
    });
    deduped.sort((a, b) => a.timestamp - b.timestamp);

    return limit ? deduped.slice(-limit) : deduped;
  } finally {
    await exchange.close();
    releaseSemaphore();
  }
}

/**
 * Fetch candles for multiple symbol×timeframe×daysBack jobs with controlled concurrency.
 * Returns results in the same order as the input jobs.
 */
export async function fetchCandlesBatch(
  jobs: { symbol: string; timeframe: string; daysBack: number }[]
): Promise<PromiseSettledResult<Candle[]>[]> {
  // Process all jobs — the semaphore inside fetchCandles limits concurrent exchange calls
  return Promise.allSettled(
    jobs.map((job) => fetchCandles(job.symbol, job.timeframe, job.daysBack))
  );
}
