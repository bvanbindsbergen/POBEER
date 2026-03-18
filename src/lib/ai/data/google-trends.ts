import { db } from "@/lib/db";
import { newsCache } from "@/lib/db/schema";
import { and, eq, gt } from "drizzle-orm";

export interface TrendPoint {
  date: string;
  interest: number;
}

export interface TrendResult {
  keyword: string;
  timelineData: TrendPoint[];
  currentInterest: number;
  averageInterest: number;
  peakInterest: number;
  trend: "rising" | "falling" | "stable";
  fomoSignal: "extreme" | "high" | "moderate" | "low";
}

export interface TrendsOverview {
  results: TrendResult[];
  overallFomoLevel: "extreme" | "high" | "moderate" | "low";
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

export async function fetchGoogleTrends(
  keywords: string[] = ["bitcoin", "crypto", "buy bitcoin"]
): Promise<TrendsOverview> {
  const cacheKey = `trends:${keywords.sort().join(",")}`;

  const data = await fetchWithCache<TrendsOverview>(
    "google-trends",
    cacheKey,
    60, // 1-hour cache (trends don't change fast)
    async () => {
      const results: TrendResult[] = [];

      for (const keyword of keywords) {
        const result = await fetchSingleTrend(keyword);
        if (result) results.push(result);
      }

      const avgFomo =
        results.length > 0
          ? results.reduce((sum, r) => sum + r.currentInterest, 0) /
            results.length
          : 0;

      const overallFomoLevel = getFomoLevel(avgFomo);
      const summary = generateSummary(results, overallFomoLevel);

      return { results, overallFomoLevel, summary };
    }
  );

  return (
    data || { results: [], overallFomoLevel: "low", summary: "No data available" }
  );
}

async function fetchSingleTrend(keyword: string): Promise<TrendResult | null> {
  try {
    // Use SerpAPI if available for reliable data
    const serpApiKey = process.env.SERPAPI_KEY;
    if (serpApiKey) {
      return fetchFromSerpApi(serpApiKey, keyword);
    }

    // Fallback: use Google Trends unofficial endpoint
    return fetchFromGoogleTrendsApi(keyword);
  } catch (error) {
    console.error(`Trends fetch error for "${keyword}":`, error);
    return null;
  }
}

async function fetchFromSerpApi(
  apiKey: string,
  keyword: string
): Promise<TrendResult | null> {
  const params = new URLSearchParams({
    engine: "google_trends",
    q: keyword,
    date: "today 3-m", // Last 3 months
    api_key: apiKey,
  });

  const res = await fetch(
    `https://serpapi.com/search.json?${params.toString()}`
  );
  if (!res.ok) return null;

  const json = await res.json();
  const timeline = json.interest_over_time?.timeline_data || [];

  const timelineData: TrendPoint[] = timeline.map(
    (point: { date: string; values: { extracted_value: number }[] }) => ({
      date: point.date,
      interest: point.values?.[0]?.extracted_value || 0,
    })
  );

  return analyzeTrend(keyword, timelineData);
}

async function fetchFromGoogleTrendsApi(
  keyword: string
): Promise<TrendResult | null> {
  // Google Trends daily search trends API (public, no key needed)
  // This gives related trending searches - we'll use it as a proxy
  const encodedKeyword = encodeURIComponent(keyword);

  const res = await fetch(
    `https://trends.google.com/trends/api/dailytrends?hl=en-US&tz=-60&geo=US&ed=${formatDateForTrends()}&ns=15`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    }
  );

  if (!res.ok) {
    // If the daily trends API fails, try the interest-over-time widget
    return fetchFromExploreApi(keyword);
  }

  const text = await res.text();
  // Google prepends ")]}'" to prevent JSONP hijacking
  const jsonStr = text.replace(/^\)\]\}',?\n/, "");
  const json = JSON.parse(jsonStr);

  const trendingSearches =
    json.default?.trendingSearchesDays?.[0]?.trendingSearches || [];
  const related = trendingSearches.filter(
    (t: { title: { query: string } }) =>
      t.title.query.toLowerCase().includes(keyword.toLowerCase())
  );

  // Use the traffic count as a proxy for interest
  const interest = related.length > 0
    ? Math.min(
        100,
        related.reduce(
          (sum: number, t: { formattedTraffic: string }) =>
            sum + parseTraffic(t.formattedTraffic),
          0
        )
      )
    : 0;

  const timelineData: TrendPoint[] = [
    { date: new Date().toISOString().split("T")[0], interest },
  ];

  return analyzeTrend(keyword, timelineData);
}

async function fetchFromExploreApi(
  keyword: string
): Promise<TrendResult | null> {
  // Try the multiline explore API
  const encodedKeyword = encodeURIComponent(keyword);
  const now = new Date();
  const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const res = await fetch(
    `https://trends.google.com/trends/api/explore?hl=en-US&tz=-60&req=${encodeURIComponent(
      JSON.stringify({
        comparisonItem: [
          { keyword, geo: "", time: `${formatDate(threeMonthsAgo)} ${formatDate(now)}` },
        ],
        category: 0,
        property: "",
      })
    )}&tz=-60`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    }
  );

  if (!res.ok) return null;

  const text = await res.text();
  const jsonStr = text.replace(/^\)\]\}',?\n/, "");

  try {
    const json = JSON.parse(jsonStr);
    const token = json.widgets?.find(
      (w: { id: string }) => w.id === "TIMESERIES"
    )?.token;

    if (!token) return null;

    // Fetch the actual timeseries data
    const tsRes = await fetch(
      `https://trends.google.com/trends/api/widgetdata/multiline?hl=en-US&tz=-60&req=${encodeURIComponent(
        JSON.stringify({
          time: `${formatDate(threeMonthsAgo)} ${formatDate(now)}`,
          resolution: "WEEK",
          locale: "en-US",
          comparisonItem: [{ geo: {}, complexKeywordsRestriction: { keyword: [{ type: "BROAD", value: keyword }] } }],
          requestOptions: { property: "", backend: "IZG", category: 0 },
        })
      )}&token=${token}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      }
    );

    if (!tsRes.ok) return null;

    const tsText = await tsRes.text();
    const tsJson = JSON.parse(tsText.replace(/^\)\]\}',?\n/, ""));

    const timelineData: TrendPoint[] = (
      tsJson.default?.timelineData || []
    ).map(
      (point: { formattedAxisTime: string; value: number[] }) => ({
        date: point.formattedAxisTime,
        interest: point.value?.[0] || 0,
      })
    );

    return analyzeTrend(keyword, timelineData);
  } catch {
    return null;
  }
}

function analyzeTrend(
  keyword: string,
  timelineData: TrendPoint[]
): TrendResult {
  if (timelineData.length === 0) {
    return {
      keyword,
      timelineData: [],
      currentInterest: 0,
      averageInterest: 0,
      peakInterest: 0,
      trend: "stable",
      fomoSignal: "low",
    };
  }

  const interests = timelineData.map((p) => p.interest);
  const currentInterest = interests[interests.length - 1];
  const averageInterest =
    interests.reduce((a, b) => a + b, 0) / interests.length;
  const peakInterest = Math.max(...interests);

  // Determine trend direction
  const recentAvg =
    interests.slice(-3).reduce((a, b) => a + b, 0) /
    Math.min(3, interests.length);
  const olderAvg =
    interests.slice(0, Math.max(1, interests.length - 3)).reduce((a, b) => a + b, 0) /
    Math.max(1, interests.length - 3);

  let trend: "rising" | "falling" | "stable" = "stable";
  if (recentAvg > olderAvg * 1.2) trend = "rising";
  else if (recentAvg < olderAvg * 0.8) trend = "falling";

  const fomoSignal = getFomoLevel(currentInterest);

  return {
    keyword,
    timelineData: timelineData.slice(-12), // Last 12 data points
    currentInterest,
    averageInterest: Math.round(averageInterest),
    peakInterest,
    trend,
    fomoSignal,
  };
}

function getFomoLevel(
  interest: number
): "extreme" | "high" | "moderate" | "low" {
  if (interest >= 80) return "extreme";
  if (interest >= 60) return "high";
  if (interest >= 35) return "moderate";
  return "low";
}

function generateSummary(
  results: TrendResult[],
  overallFomo: string
): string {
  if (results.length === 0) return "No trend data available.";

  const rising = results.filter((r) => r.trend === "rising");
  const parts: string[] = [];

  parts.push(`Overall retail FOMO level: ${overallFomo}.`);

  if (rising.length > 0) {
    parts.push(
      `Rising search interest: ${rising.map((r) => `"${r.keyword}" (${r.currentInterest}/100)`).join(", ")}.`
    );
  }

  const extremes = results.filter((r) => r.fomoSignal === "extreme");
  if (extremes.length > 0) {
    parts.push(
      `CAUTION: Extreme search interest for ${extremes.map((r) => `"${r.keyword}"`).join(", ")} — historically correlates with local tops.`
    );
  }

  return parts.join(" ");
}

function parseTraffic(formatted: string): number {
  if (!formatted) return 0;
  const num = parseFloat(formatted.replace(/[^0-9.]/g, ""));
  if (formatted.includes("M")) return num * 10; // Scale to 0-100
  if (formatted.includes("K")) return num / 10;
  return num / 100;
}

function formatDateForTrends(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}
