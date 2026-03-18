import { db } from "@/lib/db";
import { newsCache } from "@/lib/db/schema";
import { and, eq, gt } from "drizzle-orm";

export interface RedditPost {
  title: string;
  subreddit: string;
  score: number;
  numComments: number;
  url: string;
  created: number;
  sentiment: "bullish" | "bearish" | "neutral";
}

export interface SubredditSentiment {
  subreddit: string;
  postCount: number;
  avgScore: number;
  bullishPercent: number;
  bearishPercent: number;
  neutralPercent: number;
  dominantSentiment: "bullish" | "bearish" | "neutral";
  topPosts: RedditPost[];
}

export interface RedditOverview {
  subreddits: SubredditSentiment[];
  overallSentiment: "bullish" | "bearish" | "neutral";
  buzzScore: number; // 0-100 based on activity volume
  summary: string;
}

// Keywords for sentiment classification
const BULLISH_WORDS = [
  "moon", "pump", "bull", "buy", "long", "green", "ath", "breakout",
  "undervalued", "gem", "rocket", "lambo", "hodl", "accumulate",
  "bullish", "rally", "surge", "soar", "gain", "profit",
];

const BEARISH_WORDS = [
  "dump", "crash", "bear", "sell", "short", "red", "scam", "rug",
  "overvalued", "bubble", "dead", "rekt", "fear", "panic",
  "bearish", "drop", "plunge", "tank", "loss", "bleeding",
];

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

function classifySentiment(text: string): "bullish" | "bearish" | "neutral" {
  const lower = text.toLowerCase();
  let bullishScore = 0;
  let bearishScore = 0;

  for (const word of BULLISH_WORDS) {
    if (lower.includes(word)) bullishScore++;
  }
  for (const word of BEARISH_WORDS) {
    if (lower.includes(word)) bearishScore++;
  }

  if (bullishScore > bearishScore && bullishScore >= 2) return "bullish";
  if (bearishScore > bullishScore && bearishScore >= 2) return "bearish";
  if (bullishScore > bearishScore) return "bullish";
  if (bearishScore > bullishScore) return "bearish";
  return "neutral";
}

async function fetchSubredditPosts(
  subreddit: string,
  limit: number = 25
): Promise<RedditPost[]> {
  // Reddit's public JSON API (no auth required)
  const res = await fetch(
    `https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}&raw_json=1`,
    {
      headers: {
        "User-Agent": "Alphora/1.0 (crypto trading platform)",
      },
    }
  );

  if (!res.ok) return [];

  const json = await res.json();
  const posts: RedditPost[] = (json.data?.children || [])
    .filter((child: { kind: string }) => child.kind === "t3")
    .map(
      (child: {
        data: {
          title: string;
          subreddit: string;
          score: number;
          num_comments: number;
          permalink: string;
          created_utc: number;
          selftext: string;
        };
      }) => {
        const d = child.data;
        const fullText = `${d.title} ${d.selftext || ""}`;
        return {
          title: d.title,
          subreddit: d.subreddit,
          score: d.score,
          numComments: d.num_comments,
          url: `https://reddit.com${d.permalink}`,
          created: d.created_utc * 1000,
          sentiment: classifySentiment(fullText),
        };
      }
    );

  return posts;
}

function analyzeSubreddit(
  subreddit: string,
  posts: RedditPost[]
): SubredditSentiment {
  if (posts.length === 0) {
    return {
      subreddit,
      postCount: 0,
      avgScore: 0,
      bullishPercent: 0,
      bearishPercent: 0,
      neutralPercent: 100,
      dominantSentiment: "neutral",
      topPosts: [],
    };
  }

  const bullish = posts.filter((p) => p.sentiment === "bullish").length;
  const bearish = posts.filter((p) => p.sentiment === "bearish").length;
  const neutral = posts.filter((p) => p.sentiment === "neutral").length;
  const total = posts.length;

  const bullishPercent = Math.round((bullish / total) * 100);
  const bearishPercent = Math.round((bearish / total) * 100);
  const neutralPercent = 100 - bullishPercent - bearishPercent;

  let dominantSentiment: "bullish" | "bearish" | "neutral" = "neutral";
  if (bullishPercent > bearishPercent && bullishPercent > 40)
    dominantSentiment = "bullish";
  else if (bearishPercent > bullishPercent && bearishPercent > 40)
    dominantSentiment = "bearish";

  const avgScore =
    posts.reduce((sum, p) => sum + p.score, 0) / total;

  // Top 5 posts by score
  const topPosts = [...posts].sort((a, b) => b.score - a.score).slice(0, 5);

  return {
    subreddit,
    postCount: total,
    avgScore: Math.round(avgScore),
    bullishPercent,
    bearishPercent,
    neutralPercent,
    dominantSentiment,
    topPosts,
  };
}

export async function fetchRedditSentiment(
  subreddits: string[] = ["cryptocurrency", "bitcoin", "ethtrader"],
  currency?: string
): Promise<RedditOverview> {
  const cacheKey = `reddit:${subreddits.sort().join(",")}:${currency || "all"}`;

  const data = await fetchWithCache<RedditOverview>(
    "reddit",
    cacheKey,
    15, // 15-minute cache
    async () => {
      const results: SubredditSentiment[] = [];

      for (const sub of subreddits) {
        const posts = await fetchSubredditPosts(sub);

        // Filter by currency if specified
        const filtered = currency
          ? posts.filter(
              (p) =>
                p.title.toLowerCase().includes(currency.toLowerCase()) ||
                p.title.includes(currency.toUpperCase())
            )
          : posts;

        results.push(analyzeSubreddit(sub, filtered));
      }

      // Calculate overall sentiment
      const totalBullish = results.reduce((s, r) => s + r.bullishPercent * r.postCount, 0);
      const totalBearish = results.reduce((s, r) => s + r.bearishPercent * r.postCount, 0);
      const totalPosts = results.reduce((s, r) => s + r.postCount, 0);

      let overallSentiment: "bullish" | "bearish" | "neutral" = "neutral";
      if (totalPosts > 0) {
        const avgBullish = totalBullish / totalPosts;
        const avgBearish = totalBearish / totalPosts;
        if (avgBullish > avgBearish && avgBullish > 40) overallSentiment = "bullish";
        else if (avgBearish > avgBullish && avgBearish > 40) overallSentiment = "bearish";
      }

      // Buzz score: based on total engagement
      const totalComments = results.reduce(
        (s, r) => s + r.topPosts.reduce((cs, p) => cs + p.numComments, 0),
        0
      );
      const buzzScore = Math.min(100, Math.round((totalComments / 50) * 10 + totalPosts));

      const summary = generateRedditSummary(results, overallSentiment, buzzScore);

      return { subreddits: results, overallSentiment, buzzScore, summary };
    }
  );

  return (
    data || {
      subreddits: [],
      overallSentiment: "neutral",
      buzzScore: 0,
      summary: "No Reddit data available.",
    }
  );
}

function generateRedditSummary(
  subreddits: SubredditSentiment[],
  overallSentiment: string,
  buzzScore: number
): string {
  const parts: string[] = [];

  parts.push(`Reddit overall sentiment: ${overallSentiment} (buzz: ${buzzScore}/100).`);

  for (const sub of subreddits) {
    if (sub.postCount > 0) {
      parts.push(
        `r/${sub.subreddit}: ${sub.dominantSentiment} (${sub.bullishPercent}% bull / ${sub.bearishPercent}% bear, ${sub.postCount} posts).`
      );
    }
  }

  if (buzzScore > 80) {
    parts.push("HIGH ACTIVITY: Reddit buzz is elevated — potential retail FOMO or panic.");
  }

  return parts.join(" ");
}
