import { db } from "../lib/db";
import { altDataSnapshots, systemConfig } from "../lib/db/schema";
import { eq } from "drizzle-orm";
import { createExchange } from "../lib/exchange/client";
import { FUNDING_RATE_SYMBOLS } from "../lib/constants/symbols";
import { fetchCandles, Candle } from "../lib/ai/data/candles";

const CONFIG_KEY = "last_alt_data_backfill";

function todayDateString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomNoise(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

export class AltDataBackfiller {
  private days: number;

  constructor(days = 1095) {
    this.days = days;
  }

  async shouldRun(): Promise<boolean> {
    const today = todayDateString();
    const [config] = await db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.key, CONFIG_KEY))
      .limit(1);

    if (!config) return true;
    return config.value !== today;
  }

  async run(): Promise<void> {
    console.log(`[AltDataBackfiller] Starting backfill for ${this.days} days...`);

    await this.backfillFundingRates();
    await this.backfillFearAndGreed();

    // Fetch BTC candles once for the synthetic methods to share
    let btcCandles: Candle[] = [];
    try {
      btcCandles = await fetchCandles("BTC/USDT", "1d", this.days);
    } catch (e) {
      console.error("[AltDataBackfiller] Failed to fetch BTC candles for synthetic data:", e);
    }

    await this.backfillRedditSentiment(btcCandles);
    await this.backfillWhaleFlows(btcCandles);

    // Mark completion
    await db
      .insert(systemConfig)
      .values({ key: CONFIG_KEY, value: todayDateString() })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: { value: todayDateString(), updatedAt: new Date() },
      });

    console.log("[AltDataBackfiller] Backfill complete.");
  }

  private async backfillFundingRates(): Promise<void> {
    console.log("[AltDataBackfiller] Backfilling funding rates...");

    let exchange;
    try {
      exchange = createExchange(undefined, false, "bybit");
      exchange.options.defaultType = "swap";
      await exchange.loadMarkets();
    } catch (e) {
      console.error("[AltDataBackfiller] Failed to init exchange for funding rates:", e);
      return;
    }

    const since = Date.now() - this.days * 24 * 60 * 60 * 1000;
    const limit = 200;

    for (const symbol of FUNDING_RATE_SYMBOLS) {
      const swapSymbol = `${symbol}:USDT`;
      try {
        let cursor = since;
        let keepFetching = true;

        while (keepFetching) {
          const records = await exchange.fetchFundingRateHistory(swapSymbol, cursor, limit);

          if (!records || records.length === 0) {
            break;
          }

          for (const record of records) {
            const rate = record.fundingRate;
            const timestamp = new Date(record.timestamp);

            if (rate == null) continue;

            await this.upsertSnapshot("funding_rate", symbol, "rate", timestamp, rate);

            let signal = 0;
            if (rate > 0.001) signal = 2;
            else if (rate > 0.0003) signal = 1;
            else if (rate < -0.001) signal = -2;
            else if (rate < -0.0003) signal = -1;

            await this.upsertSnapshot("funding_rate", symbol, "signal", timestamp, signal);
          }

          const lastTimestamp = records[records.length - 1].timestamp;
          // Advance cursor past the last record
          cursor = lastTimestamp + 1;

          // Stop if we've reached the present or received fewer records than requested
          if (lastTimestamp >= Date.now() || records.length < limit) {
            keepFetching = false;
          }
        }
      } catch (e) {
        console.error(`[AltDataBackfiller] Funding rate backfill error for ${symbol}:`, e);
      }

      // Rate limit between symbols
      await sleep(1000);
    }

    try {
      await exchange.close();
    } catch {
      // ignore close errors
    }

    console.log("[AltDataBackfiller] Funding rates backfill done.");
  }

  private async backfillFearAndGreed(): Promise<void> {
    console.log("[AltDataBackfiller] Backfilling Fear & Greed index...");

    try {
      const res = await fetch(`https://api.alternative.me/fng/?limit=${this.days}`);
      if (!res.ok) {
        console.error("[AltDataBackfiller] Fear & Greed response not OK:", res.status);
        return;
      }

      const json = await res.json();
      const data: Array<{ value: string; timestamp: string }> = json.data || [];

      for (const item of data) {
        const timestamp = new Date(Number(item.timestamp) * 1000);
        const value = Number(item.value);

        if (isNaN(value)) continue;

        await this.upsertSnapshot("fear_greed", null, "value", timestamp, value);
      }

      console.log(`[AltDataBackfiller] Fear & Greed: inserted ${data.length} records.`);
    } catch (e) {
      console.error("[AltDataBackfiller] Fear & Greed backfill error:", e);
    }
  }

  private async backfillRedditSentiment(
    btcCandles: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>
  ): Promise<void> {
    console.log("[AltDataBackfiller] Backfilling Reddit sentiment (synthetic)...");

    if (btcCandles.length === 0) {
      console.warn("[AltDataBackfiller] No BTC candles available — skipping Reddit sentiment backfill.");
      return;
    }

    try {
      for (const candle of btcCandles) {
        const priceChange = ((candle.close - candle.open) / candle.open) * 100;
        const sentiment = clamp(priceChange * 8 + randomNoise(-10, 10), -100, 100);
        const buzz = clamp(50 + Math.abs(priceChange) * 5 + randomNoise(-5, 5), 0, 100);
        const bullishPct = clamp(50 + sentiment / 2, 0, 100);
        const bearishPct = clamp(50 - sentiment / 2, 0, 100);

        // Use midnight timestamp for the day
        const ts = new Date(candle.timestamp);
        const midnight = new Date(ts.getFullYear(), ts.getMonth(), ts.getDate());

        await this.upsertSnapshot("reddit_estimated", null, "sentiment", midnight, sentiment);
        await this.upsertSnapshot("reddit_estimated", null, "buzz", midnight, buzz);
        await this.upsertSnapshot("reddit_estimated", null, "bullish_pct", midnight, bullishPct);
        await this.upsertSnapshot("reddit_estimated", null, "bearish_pct", midnight, bearishPct);
      }

      console.log(`[AltDataBackfiller] Reddit sentiment: processed ${btcCandles.length} candles.`);
    } catch (e) {
      console.error("[AltDataBackfiller] Reddit sentiment backfill error:", e);
    }
  }

  private async backfillWhaleFlows(
    btcCandles: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>
  ): Promise<void> {
    console.log("[AltDataBackfiller] Backfilling whale flows (synthetic)...");

    if (btcCandles.length === 0) {
      console.warn("[AltDataBackfiller] No BTC candles available — skipping whale flows backfill.");
      return;
    }

    try {
      for (const candle of btcCandles) {
        const priceChange = ((candle.close - candle.open) / candle.open) * 100;
        const volatility = ((candle.high - candle.low) / candle.low) * 100;
        const netFlow =
          (priceChange < 0 ? 1 : -1) * volatility * 100000 + randomNoise(-50000, 50000);
        const flowSignal = clamp(netFlow / 1000000, -100, 100);

        // Use midnight timestamp for the day
        const ts = new Date(candle.timestamp);
        const midnight = new Date(ts.getFullYear(), ts.getMonth(), ts.getDate());

        await this.upsertSnapshot("whale_estimated", null, "net_flow", midnight, netFlow);
        await this.upsertSnapshot("whale_estimated", null, "flow_signal", midnight, flowSignal);
      }

      console.log(`[AltDataBackfiller] Whale flows: processed ${btcCandles.length} candles.`);
    } catch (e) {
      console.error("[AltDataBackfiller] Whale flows backfill error:", e);
    }
  }

  private async upsertSnapshot(
    source: string,
    symbol: string | null,
    field: string,
    timestamp: Date,
    value: number
  ): Promise<void> {
    await db
      .insert(altDataSnapshots)
      .values({ source, symbol, field, timestamp, value })
      .onConflictDoNothing();
  }
}
