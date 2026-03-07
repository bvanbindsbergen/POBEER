import { db } from "@/lib/db";
import { newsCache } from "@/lib/db/schema";
import { and, eq, gt } from "drizzle-orm";

export interface NewsItem {
  title: string;
  source: string;
  publishedAt: string;
  currencies: string[];
  sentiment: string | null;
  url: string;
}

export async function fetchCryptoNews(
  currencies?: string[],
  kind?: string
): Promise<NewsItem[]> {
  const token = process.env.CRYPTOPANIC_API_TOKEN;
  if (!token) {
    return [];
  }

  const cacheKey = `news:${currencies?.join(",") || "all"}:${kind || "all"}`;

  // Check cache (15-minute TTL)
  const cached = await db
    .select()
    .from(newsCache)
    .where(
      and(
        eq(newsCache.source, "cryptopanic"),
        eq(newsCache.cacheKey, cacheKey),
        gt(newsCache.expiresAt, new Date())
      )
    )
    .limit(1);

  if (cached.length > 0) {
    return JSON.parse(cached[0].data);
  }

  // Fetch from CryptoPanic
  const params = new URLSearchParams({
    auth_token: token,
    public: "true",
  });
  if (currencies?.length) {
    params.set("currencies", currencies.join(","));
  }
  if (kind) {
    params.set("kind", kind);
  }

  try {
    const res = await fetch(
      `https://cryptopanic.com/api/free/v1/posts/?${params.toString()}`
    );
    if (!res.ok) return [];

    const data = await res.json();
    const items: NewsItem[] = (data.results || []).map(
      (r: {
        title: string;
        source: { title: string };
        published_at: string;
        currencies?: { code: string }[];
        votes?: { positive?: number; negative?: number };
        url: string;
      }) => ({
        title: r.title,
        source: r.source?.title || "Unknown",
        publishedAt: r.published_at,
        currencies: r.currencies?.map((c: { code: string }) => c.code) || [],
        sentiment: deriveSentiment(r.votes),
        url: r.url,
      })
    );

    // Cache with 15-min TTL
    await db.insert(newsCache).values({
      source: "cryptopanic",
      cacheKey,
      data: JSON.stringify(items),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    return items;
  } catch (error) {
    console.error("CryptoPanic API error:", error);
    return [];
  }
}

function deriveSentiment(
  votes?: { positive?: number; negative?: number }
): string | null {
  if (!votes) return null;
  const pos = votes.positive || 0;
  const neg = votes.negative || 0;
  if (pos === 0 && neg === 0) return null;
  if (pos > neg * 2) return "bullish";
  if (neg > pos * 2) return "bearish";
  return "neutral";
}
