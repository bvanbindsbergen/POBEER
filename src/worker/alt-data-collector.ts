import { db } from "../lib/db";
import { altDataSnapshots, systemConfig } from "../lib/db/schema";
import { eq } from "drizzle-orm";
import { createExchange } from "../lib/exchange/client";
import { FUNDING_RATE_SYMBOLS } from "../lib/constants/symbols";

const CONFIG_KEY = "last_alt_data_collection";
const COLLECTION_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

const TOP_SYMBOLS = FUNDING_RATE_SYMBOLS;

// Reddit sentiment keywords
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

function todayHourString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}`;
}

export class AltDataCollector {
  async shouldRun(): Promise<boolean> {
    const currentHour = todayHourString();
    const [config] = await db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.key, CONFIG_KEY))
      .limit(1);

    if (!config) return true;
    return config.value !== currentHour;
  }

  async run(): Promise<void> {
    const now = new Date();
    // Round to the current hour for consistency
    const timestamp = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());

    console.log(`[AltDataCollector] Collecting alternative data at ${timestamp.toISOString()}`);

    const results = await Promise.allSettled([
      this.collectFundingRates(timestamp),
      this.collectRedditSentiment(timestamp),
      this.collectGoogleTrends(timestamp),
      this.collectWhaleFlows(timestamp),
      this.collectFearAndGreed(timestamp),
      this.collectLunarCrush(timestamp),
    ]);

    for (const result of results) {
      if (result.status === "rejected") {
        console.error("[AltDataCollector] Collection failed:", result.reason);
      }
    }

    // Mark completion
    await db
      .insert(systemConfig)
      .values({ key: CONFIG_KEY, value: todayHourString() })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: { value: todayHourString(), updatedAt: new Date() },
      });

    console.log("[AltDataCollector] Collection complete.");
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

  private async collectFundingRates(timestamp: Date): Promise<void> {
    try {
      const exchange = createExchange(undefined, false, "bybit");
      exchange.options.defaultType = "swap";
      await exchange.loadMarkets();

      for (const symbol of TOP_SYMBOLS) {
        const swapSymbol = `${symbol}:USDT`;
        try {
          const fr = await exchange.fetchFundingRate(swapSymbol);
          if (fr?.fundingRate != null) {
            const rate = fr.fundingRate;
            await this.upsertSnapshot("funding_rate", symbol, "rate", timestamp, rate);
            // Numeric signal: -2=extreme_short, -1=short_crowded, 0=neutral, 1=long_crowded, 2=extreme_long
            let signal = 0;
            if (rate > 0.001) signal = 2;
            else if (rate > 0.0003) signal = 1;
            else if (rate < -0.001) signal = -2;
            else if (rate < -0.0003) signal = -1;
            await this.upsertSnapshot("funding_rate", symbol, "signal", timestamp, signal);
          }
        } catch (e) {
          console.error(`[AltDataCollector] Funding rate ${symbol}:`, e);
        }
      }

      // Also collect open interest
      for (const symbol of TOP_SYMBOLS.slice(0, 3)) {
        const swapSymbol = `${symbol}:USDT`;
        try {
          const oi = await exchange.fetchOpenInterest(swapSymbol);
          if (oi?.openInterestValue != null) {
            await this.upsertSnapshot("funding_rate", symbol, "open_interest_usd", timestamp, oi.openInterestValue);
          }
        } catch (e) {
          console.error(`[AltDataCollector] OI ${symbol}:`, e);
        }
      }

      await exchange.close();
      console.log("[AltDataCollector] Funding rates collected.");
    } catch (e) {
      console.error("[AltDataCollector] Funding rates error:", e);
    }
  }

  private async collectRedditSentiment(timestamp: Date): Promise<void> {
    const subreddits = ["cryptocurrency", "bitcoin"];

    try {
      let totalBullish = 0;
      let totalBearish = 0;
      let totalPosts = 0;
      let totalComments = 0;
      let totalScore = 0;

      for (const sub of subreddits) {
        const res = await fetch(
          `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`,
          { headers: { "User-Agent": "Alphora/1.0 (crypto trading platform)" } }
        );
        if (!res.ok) continue;

        const json = await res.json();
        const posts = (json.data?.children || []).filter(
          (c: { kind: string }) => c.kind === "t3"
        );

        for (const post of posts) {
          const d = post.data;
          const text = `${d.title} ${d.selftext || ""}`.toLowerCase();
          let bull = 0, bear = 0;
          for (const w of BULLISH_WORDS) { if (text.includes(w)) bull++; }
          for (const w of BEARISH_WORDS) { if (text.includes(w)) bear++; }

          if (bull > bear) totalBullish++;
          else if (bear > bull) totalBearish++;

          totalPosts++;
          totalComments += d.num_comments || 0;
          totalScore += d.score || 0;
        }
      }

      if (totalPosts > 0) {
        const bullishPct = (totalBullish / totalPosts) * 100;
        const bearishPct = (totalBearish / totalPosts) * 100;
        const buzzScore = Math.min(100, Math.round((totalComments / 50) * 10 + totalPosts));
        // Sentiment numeric: -100 (all bearish) to +100 (all bullish)
        const sentimentScore = bullishPct - bearishPct;

        await this.upsertSnapshot("reddit", null, "bullish_pct", timestamp, bullishPct);
        await this.upsertSnapshot("reddit", null, "bearish_pct", timestamp, bearishPct);
        await this.upsertSnapshot("reddit", null, "buzz", timestamp, buzzScore);
        await this.upsertSnapshot("reddit", null, "sentiment", timestamp, sentimentScore);
        await this.upsertSnapshot("reddit", null, "avg_score", timestamp, totalScore / totalPosts);
      }

      console.log("[AltDataCollector] Reddit sentiment collected.");
    } catch (e) {
      console.error("[AltDataCollector] Reddit error:", e);
    }
  }

  private async collectGoogleTrends(timestamp: Date): Promise<void> {
    try {
      // Use SerpAPI if available
      const serpApiKey = process.env.SERPAPI_KEY;
      if (serpApiKey) {
        for (const keyword of ["bitcoin", "crypto", "buy bitcoin"]) {
          const params = new URLSearchParams({
            engine: "google_trends",
            q: keyword,
            date: "now 7-d",
            api_key: serpApiKey,
          });

          const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
          if (!res.ok) continue;

          const json = await res.json();
          const timeline = json.interest_over_time?.timeline_data || [];
          if (timeline.length > 0) {
            const latest = timeline[timeline.length - 1];
            const interest = latest.values?.[0]?.extracted_value || 0;
            const fieldName = keyword.replace(/\s+/g, "_");
            await this.upsertSnapshot("google_trends", null, fieldName, timestamp, interest);
          }
        }

        // Compute aggregate FOMO level (0-100)
        // This will be the max of all keyword interests
        console.log("[AltDataCollector] Google Trends collected via SerpAPI.");
      } else {
        // Fallback: use the daily trends API for a basic signal
        const res = await fetch(
          `https://trends.google.com/trends/api/dailytrends?hl=en-US&tz=-60&geo=US&ns=15`,
          { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } }
        );

        if (res.ok) {
          const text = await res.text();
          const jsonStr = text.replace(/^\)\]\}',?\n/, "");
          const json = JSON.parse(jsonStr);
          const searches = json.default?.trendingSearchesDays?.[0]?.trendingSearches || [];

          // Count crypto-related trending searches
          const cryptoTerms = ["bitcoin", "btc", "crypto", "ethereum", "eth", "solana", "sol"];
          const cryptoTrending = searches.filter(
            (s: { title: { query: string } }) =>
              cryptoTerms.some((t) => s.title.query.toLowerCase().includes(t))
          );

          // Scale: 0 crypto trending = 10, 1 = 30, 2 = 50, 3+ = 70+
          const interestProxy = Math.min(100, 10 + cryptoTrending.length * 20);
          await this.upsertSnapshot("google_trends", null, "bitcoin", timestamp, interestProxy);
          console.log("[AltDataCollector] Google Trends collected via daily API.");
        }
      }
    } catch (e) {
      console.error("[AltDataCollector] Google Trends error:", e);
    }
  }

  private async collectFearAndGreed(timestamp: Date): Promise<void> {
    try {
      const res = await fetch("https://api.alternative.me/fng/?limit=1");
      if (!res.ok) {
        console.error("[AltDataCollector] Fear & Greed response not OK:", res.status);
        return;
      }

      const json = await res.json();
      const entry = json.data?.[0];
      if (!entry) return;

      const value = parseFloat(entry.value);
      if (isNaN(value)) return;

      await this.upsertSnapshot("fear_greed", null, "value", timestamp, value);
      console.log("[AltDataCollector] Fear & Greed collected.");
    } catch (e) {
      console.error("[AltDataCollector] Fear & Greed error:", e);
    }
  }

  private async collectLunarCrush(timestamp: Date): Promise<void> {
    const apiKey = process.env.LUNARCRUSH_API_KEY;
    if (!apiKey) return;

    // Map LunarCrush base symbols to our trading pair format
    const symbolMap: Record<string, string> = {
      BTC: "BTC/USDT",
      ETH: "ETH/USDT",
      SOL: "SOL/USDT",
      XRP: "XRP/USDT",
      DOGE: "DOGE/USDT",
    };

    try {
      const res = await fetch("https://lunarcrush.com/api4/public/coins/list", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        console.error("[AltDataCollector] LunarCrush response not OK:", res.status);
        return;
      }

      const json = await res.json();
      const coins: Array<{
        symbol: string;
        galaxy_score?: number;
        social_volume?: number;
        social_dominance?: number;
      }> = json.data || [];

      for (const coin of coins) {
        const tradingSymbol = symbolMap[coin.symbol?.toUpperCase()];
        if (!tradingSymbol) continue;

        if (coin.galaxy_score != null) {
          await this.upsertSnapshot("lunarcrush", tradingSymbol, "galaxy_score", timestamp, coin.galaxy_score);
        }
        if (coin.social_volume != null) {
          await this.upsertSnapshot("lunarcrush", tradingSymbol, "social_volume", timestamp, coin.social_volume);
        }
        if (coin.social_dominance != null) {
          await this.upsertSnapshot("lunarcrush", tradingSymbol, "social_dominance", timestamp, coin.social_dominance);
        }
      }

      console.log("[AltDataCollector] LunarCrush data collected.");
    } catch (e) {
      console.error("[AltDataCollector] LunarCrush error:", e);
    }
  }

  private async collectWhaleFlows(timestamp: Date): Promise<void> {
    try {
      const apiKey = process.env.WHALE_ALERT_API_KEY;

      if (apiKey) {
        const now = Math.floor(Date.now() / 1000);
        const oneHourAgo = now - 3600;

        const params = new URLSearchParams({
          api_key: apiKey,
          min_value: "500000",
          start: String(oneHourAgo),
          end: String(now),
        });

        const res = await fetch(`https://api.whale-alert.io/v1/transactions?${params.toString()}`);
        if (res.ok) {
          const json = await res.json();
          const txs = json.transactions || [];

          let inflows = 0;
          let outflows = 0;
          const exchangeNames = ["binance", "coinbase", "kraken", "bitfinex", "huobi", "okex", "kucoin", "bybit"];

          for (const tx of txs) {
            const toExchange = exchangeNames.some((e) => (tx.to?.owner || "").toLowerCase().includes(e));
            const fromExchange = exchangeNames.some((e) => (tx.from?.owner || "").toLowerCase().includes(e));

            if (toExchange && !fromExchange) inflows += tx.amount_usd || 0;
            else if (fromExchange && !toExchange) outflows += tx.amount_usd || 0;
          }

          const netFlow = inflows - outflows;
          // Signal: negative = accumulation (bullish), positive = distribution (bearish)
          // Scale to -100 to +100
          const flowSignal = Math.max(-100, Math.min(100, netFlow / 1000000));

          await this.upsertSnapshot("whale_flow", null, "inflows_usd", timestamp, inflows);
          await this.upsertSnapshot("whale_flow", null, "outflows_usd", timestamp, outflows);
          await this.upsertSnapshot("whale_flow", null, "net_flow", timestamp, netFlow);
          await this.upsertSnapshot("whale_flow", null, "flow_signal", timestamp, flowSignal);

          console.log("[AltDataCollector] Whale flows collected via Whale Alert.");
        }
      } else {
        // Fallback: Blockchair for large BTC transactions
        const res = await fetch(
          "https://api.blockchair.com/bitcoin/transactions?limit=10&s=output_total(desc)",
          { headers: { accept: "application/json" } }
        );

        if (res.ok) {
          const json = await res.json();
          const txs = json.data || [];
          const totalVolume = txs.reduce(
            (sum: number, tx: { output_total_usd: number }) => sum + (tx.output_total_usd || 0),
            0
          );

          // Rough proxy: high whale volume = more activity
          const activityLevel = Math.min(100, totalVolume / 10000000); // scale to 0-100
          await this.upsertSnapshot("whale_flow", null, "activity", timestamp, activityLevel);
          await this.upsertSnapshot("whale_flow", null, "net_flow", timestamp, 0); // unknown direction without labels
          await this.upsertSnapshot("whale_flow", null, "flow_signal", timestamp, 0);

          console.log("[AltDataCollector] Whale flows collected via Blockchair.");
        }
      }
    } catch (e) {
      console.error("[AltDataCollector] Whale flows error:", e);
    }
  }
}
