import { db } from "@/lib/db";
import { altDataSnapshots } from "@/lib/db/schema";
import { and, eq, gte, lte, isNull, asc, or, inArray } from "drizzle-orm";
import type { Candle } from "./data/candles";

/**
 * Alternative data indicator names that can be used in strategy conditions.
 *
 * Each maps to a source+field combo in the alt_data_snapshots table.
 * The backtest engine loads these values and aligns them to candle timestamps.
 */
export type AltIndicatorName =
  | "funding_rate"       // Per-symbol funding rate (decimal, e.g. 0.0001)
  | "funding_signal"     // Per-symbol: -2 extreme_short, -1 short, 0 neutral, 1 long, 2 extreme_long
  | "open_interest"      // Per-symbol open interest in USD
  | "reddit_sentiment"   // Aggregate: bullish% - bearish% (-100 to +100)
  | "reddit_buzz"        // Aggregate activity score (0-100)
  | "reddit_bullish"     // Bullish post percentage (0-100)
  | "reddit_bearish"     // Bearish post percentage (0-100)
  | "google_trends"      // Google search interest for "bitcoin" (0-100)
  | "whale_net_flow"     // Net exchange flow in USD (negative = accumulation)
  | "whale_flow_signal"  // Scaled signal (-100 to +100, neg = accumulation)
  | "fear_greed"         // Fear & Greed Index aggregate (0-100)
  | "galaxy_score"       // LunarCrush Galaxy Score per-symbol
  | "social_volume"      // LunarCrush social volume per-symbol
  | "social_dominance";  // LunarCrush social dominance per-symbol

export const ALT_INDICATOR_NAMES: AltIndicatorName[] = [
  "funding_rate", "funding_signal", "open_interest",
  "reddit_sentiment", "reddit_buzz", "reddit_bullish", "reddit_bearish",
  "google_trends", "whale_net_flow", "whale_flow_signal",
  "fear_greed", "galaxy_score", "social_volume", "social_dominance",
];

// Map indicator name to DB source+field
// `sources` array allows matching both live and estimated/backfilled data
const INDICATOR_DB_MAP: Record<AltIndicatorName, { sources: string[]; field: string; perSymbol: boolean }> = {
  funding_rate:      { sources: ["funding_rate"],                field: "rate",             perSymbol: true },
  funding_signal:    { sources: ["funding_rate"],                field: "signal",           perSymbol: true },
  open_interest:     { sources: ["funding_rate"],                field: "open_interest_usd", perSymbol: true },
  reddit_sentiment:  { sources: ["reddit", "reddit_estimated"],  field: "sentiment",        perSymbol: false },
  reddit_buzz:       { sources: ["reddit", "reddit_estimated"],  field: "buzz",             perSymbol: false },
  reddit_bullish:    { sources: ["reddit", "reddit_estimated"],  field: "bullish_pct",      perSymbol: false },
  reddit_bearish:    { sources: ["reddit", "reddit_estimated"],  field: "bearish_pct",      perSymbol: false },
  google_trends:     { sources: ["google_trends"],               field: "bitcoin",          perSymbol: false },
  whale_net_flow:    { sources: ["whale_flow", "whale_estimated"], field: "net_flow",       perSymbol: false },
  whale_flow_signal: { sources: ["whale_flow", "whale_estimated"], field: "flow_signal",    perSymbol: false },
  fear_greed:        { sources: ["fear_greed"],                  field: "value",            perSymbol: false },
  galaxy_score:      { sources: ["lunarcrush"],                  field: "galaxy_score",     perSymbol: true },
  social_volume:     { sources: ["lunarcrush"],                  field: "social_volume",    perSymbol: true },
  social_dominance:  { sources: ["lunarcrush"],                  field: "social_dominance", perSymbol: true },
};

export function isAltIndicator(name: string): name is AltIndicatorName {
  return ALT_INDICATOR_NAMES.includes(name as AltIndicatorName);
}

interface AltDataPoint {
  timestamp: number;
  value: number;
}

/**
 * Loads alternative data from the database for a given indicator and time range,
 * then aligns the values to candle timestamps using forward-fill (last known value).
 *
 * Returns an array of (number | undefined)[] aligned 1:1 with the candles array.
 */
export async function loadAltDataForCandles(
  indicatorName: AltIndicatorName,
  candles: Candle[],
  symbol?: string
): Promise<(number | undefined)[]> {
  if (candles.length === 0) return [];

  const mapping = INDICATOR_DB_MAP[indicatorName];
  if (!mapping) return candles.map(() => undefined);

  const startTime = new Date(candles[0].timestamp);
  // Fetch data starting 24h before first candle to ensure we have initial values
  const paddedStart = new Date(startTime.getTime() - 24 * 60 * 60 * 1000);
  const endTime = new Date(candles[candles.length - 1].timestamp);

  const sourceCondition = mapping.sources.length === 1
    ? eq(altDataSnapshots.source, mapping.sources[0])
    : inArray(altDataSnapshots.source, mapping.sources);

  const conditions = [
    sourceCondition,
    eq(altDataSnapshots.field, mapping.field),
    gte(altDataSnapshots.timestamp, paddedStart),
    lte(altDataSnapshots.timestamp, endTime),
  ];

  if (mapping.perSymbol && symbol) {
    conditions.push(eq(altDataSnapshots.symbol, symbol));
  } else if (!mapping.perSymbol) {
    conditions.push(isNull(altDataSnapshots.symbol));
  }

  const rows = await db
    .select({
      timestamp: altDataSnapshots.timestamp,
      value: altDataSnapshots.value,
    })
    .from(altDataSnapshots)
    .where(and(...conditions))
    .orderBy(asc(altDataSnapshots.timestamp));

  if (rows.length === 0) {
    return candles.map(() => undefined);
  }

  const dataPoints: AltDataPoint[] = rows.map((r) => ({
    timestamp: r.timestamp.getTime(),
    value: r.value,
  }));

  // Forward-fill: for each candle, find the most recent data point at or before candle time
  return alignToCandles(dataPoints, candles);
}

/**
 * Aligns alt data points to candle timestamps using forward-fill.
 * For each candle, uses the most recent data point at or before the candle's timestamp.
 */
function alignToCandles(
  dataPoints: AltDataPoint[],
  candles: Candle[]
): (number | undefined)[] {
  const result: (number | undefined)[] = new Array(candles.length);
  let dataIdx = 0;
  let lastValue: number | undefined = undefined;

  for (let i = 0; i < candles.length; i++) {
    const candleTime = candles[i].timestamp;

    // Advance data pointer to the last point at or before this candle
    while (
      dataIdx < dataPoints.length &&
      dataPoints[dataIdx].timestamp <= candleTime
    ) {
      lastValue = dataPoints[dataIdx].value;
      dataIdx++;
    }

    result[i] = lastValue;
  }

  return result;
}
