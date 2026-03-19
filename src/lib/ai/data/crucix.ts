/**
 * Crucix Intelligence Feed — fetches sweep data from a deployed Crucix instance
 * and extracts trading-relevant signals (macro, conflicts, sentiment, news).
 */

const CRUCIX_URL = process.env.CRUCIX_URL || process.env.NEXT_PUBLIC_CRUCIX_URL || "";

export interface CrucixIntelligence {
  available: boolean;
  timestamp: string;
  // Macro market data
  macro: {
    vix?: { price: number; change: number };
    sp500?: { price: number; changePct: number };
    gold?: { price: number; changePct: number };
    oil?: { price: number; changePct: number };
    btc?: { price: number; changePct: number };
    eth?: { price: number; changePct: number };
  };
  // Conflict / geopolitical risk
  conflicts: {
    totalEvents: number;
    totalFatalities: number;
    hotspots: string[];
    summary: string;
  };
  // News sentiment
  news: {
    topHeadlines: string[];
    conflictNews: number;
    economyNews: number;
    sentiment: string;
  };
  // Social signals
  social: {
    redditTopPosts: string[];
    wallstreetbetsBuzz: string[];
  };
  // One-line summary for prompt injection
  summary: string;
}

export async function fetchCrucixIntelligence(): Promise<CrucixIntelligence | null> {
  if (!CRUCIX_URL) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(`${CRUCIX_URL.replace(/\/$/, "")}/api/data`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timer);

    if (!res.ok) return null;

    const data = await res.json();
    return extractIntelligence(data);
  } catch (e) {
    console.warn("[Crucix] Failed to fetch intelligence:", (e as Error).message);
    return null;
  }
}

function extractIntelligence(data: Record<string, unknown>): CrucixIntelligence {
  const markets = data.markets as Record<string, Record<string, unknown>> | undefined;
  const acled = data.acled as Record<string, unknown> | undefined;
  const gdelt = data.gdelt as Record<string, unknown> | undefined;
  const reddit = data.reddit as Record<string, unknown> | undefined;
  const news = (data.news || data.headlines || []) as Array<Record<string, unknown>>;

  // Extract macro quotes
  const quotes = (markets as Record<string, unknown>)?.quotes as Record<string, Record<string, unknown>> | undefined;
  const getQuote = (sym: string) => {
    const q = quotes?.[sym];
    if (!q) return undefined;
    return { price: q.price as number, changePct: q.changePct as number, change: q.change as number };
  };

  const vixQ = getQuote("^VIX");
  const sp500Q = getQuote("SPY");
  const goldQ = getQuote("GC=F");
  const oilQ = getQuote("CL=F");
  const btcQ = getQuote("BTC-USD");
  const ethQ = getQuote("ETH-USD");

  // Extract conflict data
  const totalEvents = (acled?.totalEvents as number) || 0;
  const totalFatalities = (acled?.totalFatalities as number) || 0;
  const topCountries = acled?.topCountries as Record<string, { count: number }> | undefined;
  const hotspots = topCountries
    ? Object.entries(topCountries)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 5)
        .map(([country]) => country)
    : [];

  // Extract news
  const allArticles = (gdelt?.allArticles || []) as Array<{ title?: string }>;
  const conflictArticles = (gdelt?.conflicts || []) as Array<unknown>;
  const economyArticles = (gdelt?.economy || []) as Array<unknown>;
  const topHeadlines = allArticles.slice(0, 10).map((a) => a.title || "").filter(Boolean);

  // Extract Reddit
  const subreddits = (reddit?.subreddits || {}) as Record<string, Array<{ title?: string; score?: number }>>;
  const wsbPosts = (subreddits["wallstreetbets"] || []).slice(0, 5).map((p) => p.title || "").filter(Boolean);
  const worldnews = (subreddits["worldnews"] || []).slice(0, 5).map((p) => p.title || "").filter(Boolean);

  // Build summary
  const summaryParts: string[] = [];
  if (vixQ) summaryParts.push(`VIX: ${vixQ.price.toFixed(1)}`);
  if (sp500Q) summaryParts.push(`S&P500: ${sp500Q.changePct > 0 ? "+" : ""}${sp500Q.changePct.toFixed(1)}%`);
  if (oilQ) summaryParts.push(`Oil: $${oilQ.price.toFixed(1)}`);
  if (totalEvents > 0) summaryParts.push(`${totalEvents} conflict events (${totalFatalities} fatalities) in 7d`);
  if (hotspots.length > 0) summaryParts.push(`Hotspots: ${hotspots.join(", ")}`);

  return {
    available: true,
    timestamp: new Date().toISOString(),
    macro: {
      vix: vixQ ? { price: vixQ.price, change: vixQ.change } : undefined,
      sp500: sp500Q ? { price: sp500Q.price, changePct: sp500Q.changePct } : undefined,
      gold: goldQ ? { price: goldQ.price, changePct: goldQ.changePct } : undefined,
      oil: oilQ ? { price: oilQ.price, changePct: oilQ.changePct } : undefined,
      btc: btcQ ? { price: btcQ.price, changePct: btcQ.changePct } : undefined,
      eth: ethQ ? { price: ethQ.price, changePct: ethQ.changePct } : undefined,
    },
    conflicts: {
      totalEvents,
      totalFatalities,
      hotspots,
      summary: totalEvents > 0
        ? `${totalEvents} conflict events with ${totalFatalities} fatalities in past 7 days. Top hotspots: ${hotspots.join(", ")}`
        : "No significant conflict data available",
    },
    news: {
      topHeadlines,
      conflictNews: conflictArticles.length,
      economyNews: economyArticles.length,
      sentiment: conflictArticles.length > economyArticles.length ? "risk-off" : "neutral",
    },
    social: {
      redditTopPosts: worldnews,
      wallstreetbetsBuzz: wsbPosts,
    },
    summary: summaryParts.join(" | ") || "Crucix data unavailable",
  };
}
