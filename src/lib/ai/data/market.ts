import { db } from "@/lib/db";
import { newsCache } from "@/lib/db/schema";
import { and, eq, gt } from "drizzle-orm";

export interface TrendingCoin {
  id: string;
  name: string;
  symbol: string;
  marketCapRank: number | null;
  priceChangePercent24h: number | null;
}

export interface MarketOverview {
  trending: TrendingCoin[];
  topGainers: MarketCoin[];
  topLosers: MarketCoin[];
}

export interface MarketCoin {
  id: string;
  symbol: string;
  name: string;
  currentPrice: number;
  priceChangePercent24h: number;
  marketCap: number;
  totalVolume: number;
}

async function fetchWithCache<T>(
  source: string,
  cacheKey: string,
  ttlMinutes: number,
  fetcher: () => Promise<T>
): Promise<T | null> {
  // Check cache
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

export async function fetchTrendingCoins(): Promise<TrendingCoin[]> {
  const data = await fetchWithCache<TrendingCoin[]>(
    "coingecko",
    "trending",
    5,
    async () => {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/search/trending",
        { headers: { accept: "application/json" } }
      );
      if (!res.ok) return [];
      const json = await res.json();
      return (json.coins || []).slice(0, 10).map(
        (c: {
          item: {
            id: string;
            name: string;
            symbol: string;
            market_cap_rank: number | null;
            data?: { price_change_percentage_24h?: { usd?: number } };
          };
        }) => ({
          id: c.item.id,
          name: c.item.name,
          symbol: c.item.symbol.toUpperCase(),
          marketCapRank: c.item.market_cap_rank,
          priceChangePercent24h:
            c.item.data?.price_change_percentage_24h?.usd ?? null,
        })
      );
    }
  );
  return data || [];
}

export async function fetchMarketCoins(): Promise<MarketCoin[]> {
  const data = await fetchWithCache<MarketCoin[]>(
    "coingecko",
    "markets",
    5,
    async () => {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=false&price_change_percentage=24h",
        { headers: { accept: "application/json" } }
      );
      if (!res.ok) return [];
      const json = await res.json();
      return json.map(
        (c: {
          id: string;
          symbol: string;
          name: string;
          current_price: number;
          price_change_percentage_24h: number;
          market_cap: number;
          total_volume: number;
        }) => ({
          id: c.id,
          symbol: c.symbol.toUpperCase(),
          name: c.name,
          currentPrice: c.current_price,
          priceChangePercent24h: c.price_change_percentage_24h,
          marketCap: c.market_cap,
          totalVolume: c.total_volume,
        })
      );
    }
  );
  return data || [];
}

export async function fetchMarketOverview(): Promise<MarketOverview> {
  const [trending, coins] = await Promise.all([
    fetchTrendingCoins(),
    fetchMarketCoins(),
  ]);

  const sorted = [...coins].sort(
    (a, b) => b.priceChangePercent24h - a.priceChangePercent24h
  );

  return {
    trending,
    topGainers: sorted.slice(0, 5),
    topLosers: sorted.slice(-5).reverse(),
  };
}
