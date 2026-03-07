import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { newsCache } from "@/lib/db/schema";
import { and, eq, gt } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { fetchMarketOverview } from "@/lib/ai/data/market";
import { fetchCryptoNews } from "@/lib/ai/data/news";
import { fetchCandles } from "@/lib/ai/data/candles";
import { calculateIndicator } from "@/lib/ai/indicators";

const CACHE_TTL_MINUTES = 60;

export async function GET() {
  try {
    const auth = await requireAuth();

    // Check cache first (1-hour TTL)
    const cached = await db
      .select()
      .from(newsCache)
      .where(
        and(
          eq(newsCache.source, "ai_discover"),
          eq(newsCache.cacheKey, `discover:${auth.user.id}`),
          gt(newsCache.expiresAt, new Date())
        )
      )
      .limit(1);

    if (cached.length > 0) {
      return NextResponse.json(JSON.parse(cached[0].data));
    }

    // Gather market context
    const [overview, news, btcCandles, ethCandles, solCandles] = await Promise.all([
      fetchMarketOverview(),
      fetchCryptoNews(undefined, "news"),
      fetchCandles("BTC/USDT", "4h", 14),
      fetchCandles("ETH/USDT", "4h", 14),
      fetchCandles("SOL/USDT", "4h", 14),
    ]);

    // Calculate key indicators for top 3 coins
    const indicators: Record<string, Record<string, unknown>> = {};
    for (const [symbol, candles] of [
      ["BTC/USDT", btcCandles],
      ["ETH/USDT", ethCandles],
      ["SOL/USDT", solCandles],
    ] as const) {
      if (candles.length < 20) continue;
      const rsi = calculateIndicator("rsi", candles, { period: 14 });
      const macd = calculateIndicator("macd", candles);
      const bb = calculateIndicator("bollinger", candles);
      const lastRsi = rsi.values.filter((v) => v !== undefined).slice(-1)[0];
      const lastMacd = macd.values.filter((v) => v !== undefined).slice(-1)[0];
      const lastBb = bb.values.filter((v) => v !== undefined).slice(-1)[0];
      const lastPrice = candles[candles.length - 1].close;
      const price24hAgo = candles[Math.max(0, candles.length - 7)].close;
      indicators[symbol] = {
        price: lastPrice,
        change24h: ((lastPrice - price24hAgo) / price24hAgo * 100).toFixed(2) + "%",
        rsi: lastRsi,
        macd: lastMacd,
        bollingerBands: lastBb,
      };
    }

    // Ask Claude for strategies
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        strategies: [],
        generatedAt: new Date().toISOString(),
        error: "ANTHROPIC_API_KEY not configured",
      });
    }

    const client = new Anthropic({ apiKey });

    const contextStr = JSON.stringify({
      marketOverview: {
        trending: overview.trending.slice(0, 5).map((c) => `${c.symbol} (rank #${c.marketCapRank})`),
        topGainers: overview.topGainers.map((c) => `${c.symbol} ${c.priceChangePercent24h > 0 ? "+" : ""}${c.priceChangePercent24h.toFixed(1)}%`),
        topLosers: overview.topLosers.map((c) => `${c.symbol} ${c.priceChangePercent24h.toFixed(1)}%`),
      },
      technicals: indicators,
      recentNews: news.slice(0, 8).map((n) => ({
        title: n.title,
        sentiment: n.sentiment,
        currencies: n.currencies,
      })),
    }, null, 2);

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `Based on the current market data below, suggest exactly 3 short-term trading strategies. Each strategy should be actionable for the next 1-7 days.

CURRENT MARKET DATA:
${contextStr}

Respond ONLY with a JSON array of exactly 3 strategy objects. No markdown, no explanation outside the JSON. Each object must have:
{
  "name": "Short descriptive name",
  "symbol": "PAIR/USDT",
  "timeframe": "1h or 4h or 1d",
  "riskLevel": "Conservative or Moderate or Aggressive",
  "reasoning": "2-3 sentence explanation based on the data",
  "entryConditions": ["human readable condition 1", "condition 2"],
  "exitConditions": ["human readable condition 1", "condition 2"],
  "stopLoss": "X%",
  "takeProfit": "X%",
  "strategyConfig": {
    "entryConditions": [{"indicator": "rsi|macd|bollinger|ema|sma|stochastic", "operator": ">|<|>=|<=|crosses_above|crosses_below", "value": number, "params": {"period": number}, "field": "optional for macd/stochastic/bollinger"}],
    "exitConditions": [{"indicator": "...", "operator": "...", "value": number}],
    "stopLossPercent": number,
    "takeProfitPercent": number,
    "positionSizePercent": 10
  }
}`,
        },
      ],
    });

    // Parse Claude's response
    let strategies: unknown[] = [];
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    try {
      // Extract JSON array from response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        strategies = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error("Failed to parse discover response:", e, text);
    }

    const result = {
      strategies,
      generatedAt: new Date().toISOString(),
    };

    // Cache result
    await db.insert(newsCache).values({
      source: "ai_discover",
      cacheKey: `discover:${auth.user.id}`,
      data: JSON.stringify(result),
      expiresAt: new Date(Date.now() + CACHE_TTL_MINUTES * 60 * 1000),
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Discover error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
