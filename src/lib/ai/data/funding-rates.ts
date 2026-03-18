import { db } from "@/lib/db";
import { newsCache } from "@/lib/db/schema";
import { and, eq, gt } from "drizzle-orm";
import { createExchange } from "@/lib/exchange/client";

export interface FundingRateData {
  symbol: string;
  fundingRate: number;
  fundingRatePercent: string;
  nextFundingTime: number | null;
  signal: "extreme_long" | "long_crowded" | "neutral" | "short_crowded" | "extreme_short";
}

export interface OpenInterestData {
  symbol: string;
  openInterest: number;
  openInterestUsd: number;
}

export interface DerivativesOverview {
  fundingRates: FundingRateData[];
  openInterest: OpenInterestData[];
  overallLeverage: "extreme_long" | "high_long" | "neutral" | "high_short" | "extreme_short";
  summary: string;
}

async function fetchWithCache<T>(
  source: string,
  cacheKey: string,
  ttlMinutes: number,
  fetcher: () => Promise<T>
): Promise<T | null> {
  const cached = await db
    .select()
    .from(newsCache)
    .where(
      and(
        eq(newsCache.source, source),
        eq(newsCache.cacheKey, cacheKey),
        gt(newsCache.expiresAt, new Date())
      )
    )
    .limit(1);

  if (cached.length > 0) {
    return JSON.parse(cached[0].data);
  }

  try {
    const data = await fetcher();
    await db.insert(newsCache).values({
      source,
      cacheKey,
      data: JSON.stringify(data),
      expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
    });
    return data;
  } catch (error) {
    console.error(`${source} fetch error:`, error);
    return null;
  }
}

function classifyFundingRate(
  rate: number
): FundingRateData["signal"] {
  // Funding rates are typically ±0.01% to ±0.1%
  // >0.05% = heavily long, <-0.05% = heavily short
  if (rate > 0.001) return "extreme_long"; // >0.1%
  if (rate > 0.0003) return "long_crowded"; // >0.03%
  if (rate < -0.001) return "extreme_short";
  if (rate < -0.0003) return "short_crowded";
  return "neutral";
}

export async function fetchDerivativesOverview(
  symbols: string[] = ["BTC/USDT", "ETH/USDT", "SOL/USDT"]
): Promise<DerivativesOverview> {
  const cacheKey = `derivatives:${symbols.sort().join(",")}`;

  const data = await fetchWithCache<DerivativesOverview>(
    "derivatives",
    cacheKey,
    5, // 5-minute cache
    async () => {
      // Try CCXT first for funding rates
      const ccxtResult = await fetchFromCcxt(symbols);
      if (ccxtResult) return ccxtResult;

      // Fallback to Coinglass free data
      return fetchFromCoinglass(symbols);
    }
  );

  return (
    data || {
      fundingRates: [],
      openInterest: [],
      overallLeverage: "neutral",
      summary: "No derivatives data available.",
    }
  );
}

async function fetchFromCcxt(
  symbols: string[]
): Promise<DerivativesOverview | null> {
  try {
    const exchange = createExchange(undefined, false, "bybit");
    // Switch to derivatives/swap market
    exchange.options.defaultType = "swap";

    await exchange.loadMarkets();

    const fundingRates: FundingRateData[] = [];
    const openInterest: OpenInterestData[] = [];

    for (const symbol of symbols) {
      const swapSymbol = symbol.includes(":") ? symbol : `${symbol}:USDT`;

      try {
        // Fetch funding rate
        const fr = await exchange.fetchFundingRate(swapSymbol);
        if (fr) {
          const rate = fr.fundingRate || 0;
          fundingRates.push({
            symbol,
            fundingRate: rate,
            fundingRatePercent: (rate * 100).toFixed(4) + "%",
            nextFundingTime: fr.fundingDatetime
              ? new Date(fr.fundingDatetime).getTime()
              : null,
            signal: classifyFundingRate(rate),
          });
        }
      } catch (e) {
        console.error(`Funding rate error for ${symbol}:`, e);
      }

      try {
        // Fetch open interest
        const oi = await exchange.fetchOpenInterest(swapSymbol);
        if (oi) {
          openInterest.push({
            symbol,
            openInterest: oi.openInterestAmount || 0,
            openInterestUsd: oi.openInterestValue || 0,
          });
        }
      } catch (e) {
        console.error(`Open interest error for ${symbol}:`, e);
      }
    }

    await exchange.close();

    return buildOverview(fundingRates, openInterest);
  } catch (error) {
    console.error("CCXT derivatives error:", error);
    return null;
  }
}

async function fetchFromCoinglass(
  symbols: string[]
): Promise<DerivativesOverview> {
  const fundingRates: FundingRateData[] = [];
  const openInterest: OpenInterestData[] = [];

  // Coinglass public API (no key needed for basic data)
  try {
    const res = await fetch(
      "https://open-api.coinglass.com/public/v2/funding",
      {
        headers: { accept: "application/json" },
      }
    );

    if (res.ok) {
      const json = await res.json();
      const data = json.data || [];

      for (const symbol of symbols) {
        const base = symbol.split("/")[0];
        const item = data.find(
          (d: { symbol: string }) =>
            d.symbol.toUpperCase() === base.toUpperCase()
        );

        if (item) {
          const rate = item.uMarginList?.[0]?.rate || 0;
          fundingRates.push({
            symbol,
            fundingRate: rate,
            fundingRatePercent: (rate * 100).toFixed(4) + "%",
            nextFundingTime: null,
            signal: classifyFundingRate(rate),
          });
        }
      }
    }
  } catch (e) {
    console.error("Coinglass funding error:", e);
  }

  // Coinglass OI
  try {
    const res = await fetch(
      "https://open-api.coinglass.com/public/v2/open_interest",
      {
        headers: { accept: "application/json" },
      }
    );

    if (res.ok) {
      const json = await res.json();
      const data = json.data || [];

      for (const symbol of symbols) {
        const base = symbol.split("/")[0];
        const item = data.find(
          (d: { symbol: string }) =>
            d.symbol.toUpperCase() === base.toUpperCase()
        );

        if (item) {
          openInterest.push({
            symbol,
            openInterest: item.openInterest || 0,
            openInterestUsd: item.openInterestAmount || 0,
          });
        }
      }
    }
  } catch (e) {
    console.error("Coinglass OI error:", e);
  }

  return buildOverview(fundingRates, openInterest);
}

function buildOverview(
  fundingRates: FundingRateData[],
  openInterest: OpenInterestData[]
): DerivativesOverview {
  // Determine overall leverage bias
  const avgRate =
    fundingRates.length > 0
      ? fundingRates.reduce((s, f) => s + f.fundingRate, 0) /
        fundingRates.length
      : 0;

  let overallLeverage: DerivativesOverview["overallLeverage"] = "neutral";
  if (avgRate > 0.001) overallLeverage = "extreme_long";
  else if (avgRate > 0.0003) overallLeverage = "high_long";
  else if (avgRate < -0.001) overallLeverage = "extreme_short";
  else if (avgRate < -0.0003) overallLeverage = "high_short";

  const summary = generateDerivativesSummary(
    fundingRates,
    openInterest,
    overallLeverage
  );

  return { fundingRates, openInterest, overallLeverage, summary };
}

function generateDerivativesSummary(
  fundingRates: FundingRateData[],
  openInterest: OpenInterestData[],
  overallLeverage: string
): string {
  const parts: string[] = [];

  parts.push(`Overall leverage bias: ${overallLeverage}.`);

  const extremes = fundingRates.filter(
    (f) => f.signal === "extreme_long" || f.signal === "extreme_short"
  );
  if (extremes.length > 0) {
    parts.push(
      `WARNING: Extreme funding on ${extremes.map((f) => `${f.symbol} (${f.fundingRatePercent})`).join(", ")} — high liquidation risk.`
    );
  }

  const crowded = fundingRates.filter(
    (f) => f.signal === "long_crowded" || f.signal === "short_crowded"
  );
  if (crowded.length > 0) {
    parts.push(
      `Crowded positions: ${crowded.map((f) => `${f.symbol} ${f.signal} (${f.fundingRatePercent})`).join(", ")}.`
    );
  }

  if (openInterest.length > 0) {
    const totalOiUsd = openInterest.reduce((s, o) => s + o.openInterestUsd, 0);
    parts.push(
      `Total OI across tracked symbols: $${(totalOiUsd / 1e9).toFixed(2)}B.`
    );
  }

  return parts.join(" ");
}
