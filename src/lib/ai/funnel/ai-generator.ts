import { fetchCandles } from "@/lib/ai/data/candles";
import { calculateIndicator } from "@/lib/ai/indicators";
import { fetchMarketOverview } from "@/lib/ai/data/market";
import { fetchDerivativesOverview } from "@/lib/ai/data/funding-rates";
import { fetchRedditSentiment } from "@/lib/ai/data/reddit-sentiment";
import { fetchGoogleTrends } from "@/lib/ai/data/google-trends";
import { fetchWhaleTransactions } from "@/lib/ai/data/whale-alert";
import { fetchCrucixIntelligence } from "@/lib/ai/data/crucix";
import { db } from "@/lib/db";
import { strategyFeedback } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import type { GeneratedStrategy } from "@/lib/ai/funnel/generator";

const TOP_SYMBOLS = [
  "BTC/USDT", "ETH/USDT", "SOL/USDT", "XRP/USDT", "DOGE/USDT",
  "ADA/USDT", "AVAX/USDT", "DOT/USDT", "LINK/USDT", "POL/USDT",
  "NEAR/USDT", "UNI/USDT", "ATOM/USDT", "LTC/USDT", "FIL/USDT",
  "APT/USDT", "ARB/USDT", "OP/USDT", "INJ/USDT", "SUI/USDT",
];

export interface AiGeneratorConfig {
  count: number;
  targetTotal: number;
  prompt: string;
  timeframe: string;
  symbols?: string[];
  positionSizePercent: number;
  noRiskManagement: boolean;
  slRange: number[];
  tpRange: number[];
  userId: string;
}

export interface AiGeneratorResult {
  strategies: GeneratedStrategy[];
  totalGenerated: number;
  aiBaseCount: number;
  generationTimeMs: number;
  tokenUsage: { inputTokens: number; outputTokens: number; estimatedCost: number };
  config: { timeframe: string; targetTotal: number };
}

type RawStrategy = {
  name: string;
  symbol: string;
  reasoning?: string;
  sourceSignal?: string;
  tags?: string[];
  strategyConfig: {
    entryConditions: Array<Record<string, unknown>>;
    exitConditions: Array<Record<string, unknown>>;
    stopLossPercent?: number;
    takeProfitPercent?: number;
    positionSizePercent: number;
  };
};

/** Attempt to parse strategy objects from raw AI text */
function parseStrategiesFromText(text: string): RawStrategy[] {
  // Try parsing as a full JSON array first
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const arr = JSON.parse(jsonMatch[0]);
      if (Array.isArray(arr) && arr.length > 0) {
        return arr.filter(
          (o: RawStrategy) => o.name && o.symbol && o.strategyConfig?.entryConditions
        );
      }
    }
  } catch {
    // Fall through to partial recovery
  }

  // Truncated array: try closing the array
  try {
    const arrStart = text.indexOf("[");
    if (arrStart !== -1) {
      let truncated = text.slice(arrStart).replace(/,\s*$/, "");
      // Try to close any unclosed braces/brackets
      const openBraces = (truncated.match(/\{/g) || []).length;
      const closeBraces = (truncated.match(/\}/g) || []).length;
      truncated += "}".repeat(Math.max(0, openBraces - closeBraces));
      const openBrackets = (truncated.match(/\[/g) || []).length;
      const closeBrackets = (truncated.match(/\]/g) || []).length;
      truncated += "]".repeat(Math.max(0, openBrackets - closeBrackets));
      const arr = JSON.parse(truncated);
      if (Array.isArray(arr) && arr.length > 0) {
        // Last element may be corrupt from truncation, drop it
        const valid = arr.slice(0, -1).filter(
          (o: RawStrategy) => o.name && o.symbol && o.strategyConfig?.entryConditions
        );
        if (valid.length > 0) {
          console.warn(`[Funnel AI] Recovered ${valid.length} strategies from truncated response`);
          return valid;
        }
      }
    }
  } catch {
    // Fall through to individual object extraction
  }

  // Individual object extraction
  const results: RawStrategy[] = [];
  const objectRegex = /\{\s*"name"\s*:\s*"[^"]+?"[\s\S]*?"entryConditions"\s*:\s*\[[\s\S]*?\]\s*(?:,[\s\S]*?)?\}/g;
  for (const match of text.matchAll(objectRegex)) {
    try {
      const obj = JSON.parse(match[0]) as RawStrategy;
      if (obj.name && obj.symbol && obj.strategyConfig?.entryConditions) {
        results.push(obj);
      }
    } catch {
      // Skip unparseable objects
    }
  }
  if (results.length > 0) {
    console.warn(`[Funnel AI] Partial recovery: extracted ${results.length} individual strategies`);
  }
  return results;
}

/**
 * Core AI strategy generation logic — extracted from the route handler
 * so it can be reused by autopilot and the API route.
 */
export async function generateAiStrategies(config: AiGeneratorConfig): Promise<AiGeneratorResult> {
  const {
    count: aiBaseCount,
    targetTotal,
    prompt: userPrompt,
    timeframe,
    symbols,
    positionSizePercent,
    noRiskManagement,
    slRange,
    tpRange,
    userId,
  } = config;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const start = performance.now();

  // Gather market context for requested symbols (parallel, max 10)
  const symbolsToScan = (symbols?.length ? symbols : TOP_SYMBOLS.slice(0, 10)).slice(0, 10);
  const candleResults = await Promise.allSettled(
    symbolsToScan.map((s) => fetchCandles(s, timeframe, 14))
  );

  const technicals: Record<string, Record<string, unknown>> = {};
  for (let i = 0; i < symbolsToScan.length; i++) {
    const result = candleResults[i];
    if (result.status !== "fulfilled" || result.value.length < 20) continue;
    const candles = result.value;
    const symbol = symbolsToScan[i];
    const last = candles.length - 1;

    const rsi = calculateIndicator("rsi", candles, { period: 14 });
    const macd = calculateIndicator("macd", candles);
    const bb = calculateIndicator("bollinger", candles);
    const stoch = calculateIndicator("stochastic", candles);

    technicals[symbol] = {
      price: candles[last].close,
      rsi: rsi.values[last],
      macd: macd.values[last],
      bollinger: bb.values[last],
      stochastic: stoch.values[last],
      change7d: ((candles[last].close - candles[Math.max(0, last - 42)].close) / candles[Math.max(0, last - 42)].close * 100).toFixed(1) + "%",
    };
  }

  // Load market overview + alternative data + Crucix intelligence (all in parallel)
  const [overview, derivatives, redditData, trendsData, whaleData, crucixData] = await Promise.all([
    fetchMarketOverview().catch(() => null),
    fetchDerivativesOverview(symbolsToScan.slice(0, 3)).catch(() => null),
    fetchRedditSentiment(["cryptocurrency", "bitcoin"]).catch(() => null),
    fetchGoogleTrends(["bitcoin", "crypto"]).catch(() => null),
    fetchWhaleTransactions("btc").catch(() => null),
    fetchCrucixIntelligence().catch(() => null),
  ]);

  // Load user feedback history
  const recentFeedback = await db
    .select({
      strategyName: strategyFeedback.strategyName,
      symbol: strategyFeedback.symbol,
      action: strategyFeedback.action,
      reason: strategyFeedback.reason,
    })
    .from(strategyFeedback)
    .where(eq(strategyFeedback.userId, userId))
    .orderBy(desc(strategyFeedback.createdAt))
    .limit(20);

  const feedbackStr = recentFeedback.length > 0
    ? `\n\nUSER PREFERENCE HISTORY (learn from these):\n${recentFeedback.map(
        (f) => `- ${f.action.toUpperCase()}: "${f.strategyName}" (${f.symbol})${f.reason ? ` — ${f.reason}` : ""}`
      ).join("\n")}`
    : "";

  const overviewStr = overview
    ? `\nMarket overview:\n- Top gainers: ${overview.topGainers.map((c: { symbol: string; priceChangePercent24h: number }) => `${c.symbol} ${c.priceChangePercent24h > 0 ? "+" : ""}${c.priceChangePercent24h.toFixed(1)}%`).join(", ")}\n- Top losers: ${overview.topLosers.map((c: { symbol: string; priceChangePercent24h: number }) => `${c.symbol} ${c.priceChangePercent24h.toFixed(1)}%`).join(", ")}`
    : "";

  const altDataStr = [
    derivatives ? `\nDERIVATIVES DATA:\n${derivatives.summary}\nFunding rates: ${derivatives.fundingRates.map((f) => `${f.symbol}: ${f.fundingRatePercent} (${f.signal})`).join(", ")}` : "",
    redditData ? `\nREDDIT SENTIMENT:\n${redditData.summary}` : "",
    trendsData ? `\nGOOGLE TRENDS (retail FOMO):\n${trendsData.summary}` : "",
    whaleData ? `\nON-CHAIN WHALE FLOWS:\nSignal: ${whaleData.flowSignal} | Exchange inflows: $${(whaleData.exchangeInflows / 1e6).toFixed(1)}M | Outflows: $${(whaleData.exchangeOutflows / 1e6).toFixed(1)}M | Net: $${(whaleData.netFlow / 1e6).toFixed(1)}M` : "",
    crucixData?.available ? `\nGLOBAL INTELLIGENCE (Crucix OSINT — 27 sources):
${crucixData.macro.vix ? `VIX: ${crucixData.macro.vix.price} (${crucixData.macro.vix.change > 0 ? "+" : ""}${crucixData.macro.vix.change.toFixed(1)})` : ""}${crucixData.macro.sp500 ? ` | S&P500: ${crucixData.macro.sp500.changePct > 0 ? "+" : ""}${crucixData.macro.sp500.changePct.toFixed(1)}%` : ""}${crucixData.macro.gold ? ` | Gold: ${crucixData.macro.gold.changePct > 0 ? "+" : ""}${crucixData.macro.gold.changePct.toFixed(1)}%` : ""}${crucixData.macro.oil ? ` | Oil: $${crucixData.macro.oil.price.toFixed(1)}` : ""}
Geopolitical risk: ${crucixData.conflicts.summary}
News sentiment: ${crucixData.news.sentiment} (${crucixData.news.conflictNews} conflict, ${crucixData.news.economyNews} economy articles)
Top headlines: ${crucixData.news.topHeadlines.slice(0, 5).join(" | ")}
${crucixData.social.wallstreetbetsBuzz.length > 0 ? `WSB buzz: ${crucixData.social.wallstreetbetsBuzz.slice(0, 3).join(" | ")}` : ""}` : "",
    // Crypto geographic intelligence
    (() => {
      if (!crucixData?.crypto) return "";
      const c = crucixData.crypto;
      const parts: string[] = ["\nCRYPTO GEO INTELLIGENCE:"];
      if (c.whales.count > 0) {
        parts.push(`- Whale flows: ${c.whales.count} transfers, $${(c.whales.totalUsd / 1e6).toFixed(0)}M total${c.whales.topFlow ? `, largest: ${c.whales.topFlow}` : ""}`);
      }
      parts.push(`- Liquidations: $${(c.liquidations.totalLong24h / 1e6).toFixed(0)}M longs / $${(c.liquidations.totalShort24h / 1e6).toFixed(0)}M shorts (bias: ${c.liquidations.bias})`);
      if (c.trendingRegions.length > 0) {
        parts.push(`- Trending regions: ${c.trendingRegions.join(", ")}`);
      }
      return parts.join("\n");
    })(),
  ].filter(Boolean).join("");

  const client = new Anthropic({ apiKey });

  const riskNote = noRiskManagement
    ? `\nRISK MANAGEMENT: DISABLED. Do NOT include stopLossPercent or takeProfitPercent. Set positionSizePercent to 100. Focus purely on entry/exit signal quality.`
    : `\nInclude stopLossPercent, takeProfitPercent, and positionSizePercent: ${positionSizePercent} in each strategy.`;

  // Batch into chunks of 30
  const BATCH_SIZE = 30;
  const batches: number[] = [];
  let remaining = aiBaseCount;
  while (remaining > 0) {
    const chunk = Math.min(remaining, BATCH_SIZE);
    batches.push(chunk);
    remaining -= chunk;
  }

  // Run batches sequentially with safe margin (5 RPM limit → 20s between requests)
  const RATE_LIMIT_DELAY_MS = 20_000;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let rawStrategies: RawStrategy[] = [];
  let lastRequestTime = 0;

  for (let i = 0; i < batches.length; i++) {
    const count = batches[i];
    const batchNum = i + 1;

    // Rate-limit: wait between requests
    if (lastRequestTime > 0) {
      const elapsed = Date.now() - lastRequestTime;
      const waitMs = RATE_LIMIT_DELAY_MS - elapsed;
      if (waitMs > 0) {
        console.log(`[Funnel AI] Rate-limit pause: ${(waitMs / 1000).toFixed(1)}s before batch ${batchNum}/${batches.length}`);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }

    const diversityHint = batches.length > 1
      ? `\nThis is batch ${batchNum} of ${batches.length}. Generate DIFFERENT strategies than typical — vary indicators, params, and coins. Batch ${batchNum} focus: ${
          ["momentum & trend", "mean-reversion & oscillators", "volatility & breakout", "divergence & multi-indicator", "cross-asset & unconventional"][(batchNum - 1) % 5]
        } strategies.`
      : "";

    const prompt = `Generate exactly ${count} diverse, creative trading strategies for backtesting on ${timeframe} candles. Focus on discovering NEW insights — unconventional indicator combinations, unusual parameter values, creative signal interpretations.

IMPORTANT: Factor in the alternative data below when designing strategies:
- If funding rates show extreme longs → favor mean-reversion/short-bias entries or tighter stop losses
- If Reddit/Google trends show extreme FOMO → favor conservative entries, contrarian setups
- If whale flows show accumulation (outflows > inflows) → favor long entries on dips
- If whale flows show distribution (inflows > outflows) → favor quicker exits, tighter TPs
- Adjust risk parameters (SL/TP) based on leverage crowding and sentiment extremes
- Regional crypto demand spikes suggest local currency pressure — favor stablecoin/BTC pairs
- Whale flow direction (exchange deposits vs withdrawals) indicates sell/accumulate pressure
- Liquidation bias (long-heavy) suggests overleveraged longs — consider contrarian shorts
${userPrompt ? `\nUSER INSTRUCTIONS (follow these closely):\n${userPrompt}` : ""}
${feedbackStr}${diversityHint}

CURRENT MARKET DATA (last 14 days, ${timeframe} timeframe):
${JSON.stringify(technicals, null, 2)}
${overviewStr}${altDataStr}

Available symbols: ${symbolsToScan.join(", ")}
${riskNote}

Available technical indicators: rsi, macd, bollinger, ema, sma, stochastic, atr
Available alternative data indicators (these ARE backtestable — historical data is stored):
- funding_rate: per-symbol funding rate (decimal, e.g. 0.0005 = 0.05%)
- funding_signal: -2=extreme_short, -1=short_crowded, 0=neutral, 1=long_crowded, 2=extreme_long
- reddit_sentiment: bullish% minus bearish% (-100 to +100)
- reddit_buzz: activity score (0-100, >80 = extreme)
- google_trends: search interest (0-100, >80 = FOMO)
- whale_flow_signal: exchange net flow direction (-100 to +100, negative=accumulation/bullish)
Available operators: >, <, >=, <=, crosses_above, crosses_below
For multi-value indicators use "field": macd→"macd"|"signal"|"histogram", bollinger→"upper"|"middle"|"lower", stochastic→"k"|"d"
For indicator-vs-indicator: value can be {"indicator":"ema","params":{"period":21}}

Respond ONLY with a JSON array. No markdown fences. No explanation. Compact JSON only.
Each object:
{"name":"SOL Trend Momentum","symbol":"SOL/USDT","sourceSignal":"EMA+RSI","tags":["trend","momentum"],"strategyConfig":{"entryConditions":[{"indicator":"ema","params":{"period":9},"operator":"crosses_above","value":{"indicator":"ema","params":{"period":21}}},{"indicator":"rsi","operator":">","value":50}],"exitConditions":[{"indicator":"rsi","operator":">","value":75}]${noRiskManagement ? ',"positionSizePercent":100' : `,"stopLossPercent":4,"takeProfitPercent":10,"positionSizePercent":${positionSizePercent}`}}}

RULES:
- 1-3 entry conditions, 1-2 exit conditions
- Include alt data indicators in at least 30% of strategies (e.g. funding_signal, reddit_buzz, whale_flow_signal)
- Vary across coins AND indicator combinations
- Names under 30 chars, compact JSON
${userPrompt ? "- Prioritize the user's instructions above" : ""}`;

    // Retry up to 2 times on parse failure, with rate-limit backoff on 429
    const MAX_RETRIES = 2;
    let batchParsed = false;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        lastRequestTime = Date.now();
        const maxTokens = Math.min(Math.max(count * 350, 4096), 16384);
        const response = await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }],
        });

        totalInputTokens += response.usage.input_tokens;
        totalOutputTokens += response.usage.output_tokens;

        if (response.stop_reason === "max_tokens") {
          console.warn(`[Funnel AI] Batch ${batchNum} hit max_tokens (attempt ${attempt + 1})`);
        }

        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("")
          .replace(/```(?:json)?\s*/g, "")
          .replace(/```\s*/g, "")
          .trim();

        const parsed = parseStrategiesFromText(text);
        if (parsed.length > 0) {
          rawStrategies.push(...parsed);
          console.log(`[Funnel AI] Batch ${batchNum}/${batches.length}: ${parsed.length} strategies`);
          batchParsed = true;
          break;
        }

        if (attempt < MAX_RETRIES) {
          console.warn(`[Funnel AI] Batch ${batchNum} parse failed (attempt ${attempt + 1}), retrying after delay...`);
          await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
        }
      } catch (err: unknown) {
        const apiErr = err as { status?: number; error?: { error?: { message?: string } }; message?: string };
        console.error(`[Funnel AI] Batch ${batchNum} error:`, apiErr.message || err);

        // Surface billing/auth errors immediately — no point retrying
        if (apiErr.status === 400 || apiErr.status === 401) {
          const msg = apiErr.error?.error?.message || apiErr.message || "API request failed";
          throw new Error(msg);
        }

        // Rate-limited: wait longer and retry
        if (apiErr.status === 429) {
          if (attempt < MAX_RETRIES) {
            const backoffMs = RATE_LIMIT_DELAY_MS * (attempt + 2);
            console.warn(`[Funnel AI] Rate-limited, waiting ${(backoffMs / 1000).toFixed(0)}s...`);
            await new Promise((r) => setTimeout(r, backoffMs));
            continue;
          }
        }

        if (attempt >= MAX_RETRIES) break;
      }
    }
    if (!batchParsed) {
      console.error(`[Funnel AI] Batch ${batchNum} failed after ${MAX_RETRIES + 1} attempts`);
    }
  }

  if (rawStrategies.length === 0) {
    throw new Error("AI generation produced no results. This may be a temporary issue — please try again.");
  }
  console.log(`[Funnel AI] Generated ${rawStrategies.length} of ${aiBaseCount} strategies (${batches.length} batch${batches.length > 1 ? "es" : ""})`);

  // Convert AI base strategies to GeneratedStrategy format
  const baseStrategies: GeneratedStrategy[] = rawStrategies.map((s, i) => ({
    id: `ai-${i + 1}`,
    name: s.name || `AI Strategy ${i + 1}`,
    symbol: s.symbol,
    strategyConfig: {
      name: s.name,
      entryConditions: (s.strategyConfig?.entryConditions || []) as unknown as GeneratedStrategy["strategyConfig"]["entryConditions"],
      exitConditions: (s.strategyConfig?.exitConditions || []) as unknown as GeneratedStrategy["strategyConfig"]["exitConditions"],
      ...(noRiskManagement ? {} : {
        stopLossPercent: s.strategyConfig?.stopLossPercent,
        takeProfitPercent: s.strategyConfig?.takeProfitPercent,
      }),
      positionSizePercent: noRiskManagement ? 100 : (s.strategyConfig?.positionSizePercent || positionSizePercent),
    },
    sourceSignal: s.sourceSignal || "AI",
    tags: [...(s.tags || []), "ai-generated", ...(noRiskManagement ? ["no-rm"] : [])],
  }));

  // If targetTotal > base count, expand with SL/TP variations
  let strategies: GeneratedStrategy[];
  if (!noRiskManagement && targetTotal > baseStrategies.length) {
    strategies = [];
    let idCounter = 0;
    for (const base of baseStrategies) {
      strategies.push({ ...base, id: `ai-${++idCounter}` });
      const shortName = base.name.replace(/\s*\|.*$/, "");
      for (const sl of slRange) {
        for (const tp of tpRange) {
          if (tp <= sl) continue;
          if (sl === base.strategyConfig.stopLossPercent && tp === base.strategyConfig.takeProfitPercent) continue;
          strategies.push({
            id: `ai-${++idCounter}`,
            name: `${shortName} | TP${tp}% SL${sl}%`,
            symbol: base.symbol,
            strategyConfig: {
              ...base.strategyConfig,
              name: `${shortName} | TP${tp}% SL${sl}%`,
              stopLossPercent: sl,
              takeProfitPercent: tp,
            },
            sourceSignal: base.sourceSignal,
            tags: [...base.tags.filter((t) => !t.startsWith("sl") && !t.startsWith("tp")), `sl${sl}`, `tp${tp}`],
          });
        }
      }
    }
    if (strategies.length > targetTotal) {
      for (let i = strategies.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [strategies[i], strategies[j]] = [strategies[j], strategies[i]];
      }
      strategies = strategies.slice(0, targetTotal);
    }
  } else {
    strategies = baseStrategies;
  }

  const elapsed = performance.now() - start;
  const estimatedCost = (totalInputTokens * 3 / 1_000_000) + (totalOutputTokens * 15 / 1_000_000);

  return {
    strategies,
    totalGenerated: strategies.length,
    aiBaseCount: baseStrategies.length,
    generationTimeMs: Math.round(elapsed),
    tokenUsage: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      estimatedCost: Math.round(estimatedCost * 10000) / 10000,
    },
    config: { timeframe, targetTotal },
  };
}

/** Event types emitted by the streaming generator */
export type AiStreamEvent =
  | { type: "status"; message: string }
  | { type: "progress"; batchNum: number; totalBatches: number; strategies: GeneratedStrategy[]; message: string }
  | { type: "done"; totalGenerated: number; aiBaseCount: number; generationTimeMs: number; tokenUsage: AiGeneratorResult["tokenUsage"]; config: { timeframe: string; targetTotal: number } }
  | { type: "error"; message: string };

/**
 * Streaming variant — yields batch results as they complete via SSE.
 * Keeps the same rate-limit-safe sequential approach but sends strategies
 * to the client immediately after each batch.
 */
export async function* generateAiStrategiesStream(config: AiGeneratorConfig): AsyncGenerator<AiStreamEvent> {
  const {
    count: aiBaseCount,
    targetTotal,
    prompt: userPrompt,
    timeframe,
    symbols,
    positionSizePercent,
    noRiskManagement,
    slRange,
    tpRange,
    userId,
  } = config;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    yield { type: "error", message: "ANTHROPIC_API_KEY not configured" };
    return;
  }

  const start = performance.now();

  yield { type: "status", message: "Loading market data..." };

  // Gather market context (same as non-streaming)
  const symbolsToScan = (symbols?.length ? symbols : TOP_SYMBOLS.slice(0, 10)).slice(0, 10);
  const candleResults = await Promise.allSettled(
    symbolsToScan.map((s) => fetchCandles(s, timeframe, 14))
  );

  const technicals: Record<string, Record<string, unknown>> = {};
  for (let i = 0; i < symbolsToScan.length; i++) {
    const result = candleResults[i];
    if (result.status !== "fulfilled" || result.value.length < 20) continue;
    const candles = result.value;
    const symbol = symbolsToScan[i];
    const last = candles.length - 1;
    const rsi = calculateIndicator("rsi", candles, { period: 14 });
    const macd = calculateIndicator("macd", candles);
    const bb = calculateIndicator("bollinger", candles);
    const stoch = calculateIndicator("stochastic", candles);
    technicals[symbol] = {
      price: candles[last].close,
      rsi: rsi.values[last],
      macd: macd.values[last],
      bollinger: bb.values[last],
      stochastic: stoch.values[last],
      change7d: ((candles[last].close - candles[Math.max(0, last - 42)].close) / candles[Math.max(0, last - 42)].close * 100).toFixed(1) + "%",
    };
  }

  const [overview, derivatives, redditData, trendsData, whaleData, crucixData] = await Promise.all([
    fetchMarketOverview().catch(() => null),
    fetchDerivativesOverview(symbolsToScan.slice(0, 3)).catch(() => null),
    fetchRedditSentiment(["cryptocurrency", "bitcoin"]).catch(() => null),
    fetchGoogleTrends(["bitcoin", "crypto"]).catch(() => null),
    fetchWhaleTransactions("btc").catch(() => null),
    fetchCrucixIntelligence().catch(() => null),
  ]);

  const recentFeedback = await db
    .select({
      strategyName: strategyFeedback.strategyName,
      symbol: strategyFeedback.symbol,
      action: strategyFeedback.action,
      reason: strategyFeedback.reason,
    })
    .from(strategyFeedback)
    .where(eq(strategyFeedback.userId, userId))
    .orderBy(desc(strategyFeedback.createdAt))
    .limit(20);

  const feedbackStr = recentFeedback.length > 0
    ? `\n\nUSER PREFERENCE HISTORY (learn from these):\n${recentFeedback.map(
        (f) => `- ${f.action.toUpperCase()}: "${f.strategyName}" (${f.symbol})${f.reason ? ` — ${f.reason}` : ""}`
      ).join("\n")}`
    : "";

  const overviewStr = overview
    ? `\nMarket overview:\n- Top gainers: ${overview.topGainers.map((c: { symbol: string; priceChangePercent24h: number }) => `${c.symbol} ${c.priceChangePercent24h > 0 ? "+" : ""}${c.priceChangePercent24h.toFixed(1)}%`).join(", ")}\n- Top losers: ${overview.topLosers.map((c: { symbol: string; priceChangePercent24h: number }) => `${c.symbol} ${c.priceChangePercent24h.toFixed(1)}%`).join(", ")}`
    : "";

  const altDataStr = [
    derivatives ? `\nDERIVATIVES DATA:\n${derivatives.summary}\nFunding rates: ${derivatives.fundingRates.map((f) => `${f.symbol}: ${f.fundingRatePercent} (${f.signal})`).join(", ")}` : "",
    redditData ? `\nREDDIT SENTIMENT:\n${redditData.summary}` : "",
    trendsData ? `\nGOOGLE TRENDS (retail FOMO):\n${trendsData.summary}` : "",
    whaleData ? `\nON-CHAIN WHALE FLOWS:\nSignal: ${whaleData.flowSignal} | Exchange inflows: $${(whaleData.exchangeInflows / 1e6).toFixed(1)}M | Outflows: $${(whaleData.exchangeOutflows / 1e6).toFixed(1)}M | Net: $${(whaleData.netFlow / 1e6).toFixed(1)}M` : "",
    crucixData?.available ? `\nGLOBAL INTELLIGENCE (Crucix OSINT — 27 sources):
${crucixData.macro.vix ? `VIX: ${crucixData.macro.vix.price} (${crucixData.macro.vix.change > 0 ? "+" : ""}${crucixData.macro.vix.change.toFixed(1)})` : ""}${crucixData.macro.sp500 ? ` | S&P500: ${crucixData.macro.sp500.changePct > 0 ? "+" : ""}${crucixData.macro.sp500.changePct.toFixed(1)}%` : ""}${crucixData.macro.gold ? ` | Gold: ${crucixData.macro.gold.changePct > 0 ? "+" : ""}${crucixData.macro.gold.changePct.toFixed(1)}%` : ""}${crucixData.macro.oil ? ` | Oil: $${crucixData.macro.oil.price.toFixed(1)}` : ""}
Geopolitical risk: ${crucixData.conflicts.summary}
News sentiment: ${crucixData.news.sentiment} (${crucixData.news.conflictNews} conflict, ${crucixData.news.economyNews} economy articles)
Top headlines: ${crucixData.news.topHeadlines.slice(0, 5).join(" | ")}
${crucixData.social.wallstreetbetsBuzz.length > 0 ? `WSB buzz: ${crucixData.social.wallstreetbetsBuzz.slice(0, 3).join(" | ")}` : ""}` : "",
    // Crypto geographic intelligence
    (() => {
      if (!crucixData?.crypto) return "";
      const c = crucixData.crypto;
      const parts: string[] = ["\nCRYPTO GEO INTELLIGENCE:"];
      if (c.whales.count > 0) {
        parts.push(`- Whale flows: ${c.whales.count} transfers, $${(c.whales.totalUsd / 1e6).toFixed(0)}M total${c.whales.topFlow ? `, largest: ${c.whales.topFlow}` : ""}`);
      }
      parts.push(`- Liquidations: $${(c.liquidations.totalLong24h / 1e6).toFixed(0)}M longs / $${(c.liquidations.totalShort24h / 1e6).toFixed(0)}M shorts (bias: ${c.liquidations.bias})`);
      if (c.trendingRegions.length > 0) {
        parts.push(`- Trending regions: ${c.trendingRegions.join(", ")}`);
      }
      return parts.join("\n");
    })(),
  ].filter(Boolean).join("");

  const client = new Anthropic({ apiKey });
  const riskNote = noRiskManagement
    ? `\nRISK MANAGEMENT: DISABLED. Do NOT include stopLossPercent or takeProfitPercent. Set positionSizePercent to 100. Focus purely on entry/exit signal quality.`
    : `\nInclude stopLossPercent, takeProfitPercent, and positionSizePercent: ${positionSizePercent} in each strategy.`;

  const BATCH_SIZE = 30;
  const batches: number[] = [];
  let remaining = aiBaseCount;
  while (remaining > 0) {
    batches.push(Math.min(remaining, BATCH_SIZE));
    remaining -= BATCH_SIZE;
  }

  const RATE_LIMIT_DELAY_MS = 20_000;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let allRaw: RawStrategy[] = [];
  let lastRequestTime = 0;
  let idCounter = 0;

  yield { type: "status", message: `Generating ${aiBaseCount} strategies in ${batches.length} batches...` };

  for (let i = 0; i < batches.length; i++) {
    const count = batches[i];
    const batchNum = i + 1;

    // Rate-limit spacing
    if (lastRequestTime > 0) {
      const elapsed = Date.now() - lastRequestTime;
      const waitMs = RATE_LIMIT_DELAY_MS - elapsed;
      if (waitMs > 0) {
        yield { type: "status", message: `Rate-limit pause before batch ${batchNum}/${batches.length} (~${Math.ceil(waitMs / 1000)}s)...` };
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }

    const diversityHint = batches.length > 1
      ? `\nThis is batch ${batchNum} of ${batches.length}. Generate DIFFERENT strategies than typical — vary indicators, params, and coins. Batch ${batchNum} focus: ${
          ["momentum & trend", "mean-reversion & oscillators", "volatility & breakout", "divergence & multi-indicator", "cross-asset & unconventional"][(batchNum - 1) % 5]
        } strategies.`
      : "";

    const prompt = `Generate exactly ${count} diverse, creative trading strategies for backtesting on ${timeframe} candles. Focus on discovering NEW insights — unconventional indicator combinations, unusual parameter values, creative signal interpretations.

IMPORTANT: Factor in the alternative data below when designing strategies:
- If funding rates show extreme longs → favor mean-reversion/short-bias entries or tighter stop losses
- If Reddit/Google trends show extreme FOMO → favor conservative entries, contrarian setups
- If whale flows show accumulation (outflows > inflows) → favor long entries on dips
- If whale flows show distribution (inflows > outflows) → favor quicker exits, tighter TPs
- Adjust risk parameters (SL/TP) based on leverage crowding and sentiment extremes
- Regional crypto demand spikes suggest local currency pressure — favor stablecoin/BTC pairs
- Whale flow direction (exchange deposits vs withdrawals) indicates sell/accumulate pressure
- Liquidation bias (long-heavy) suggests overleveraged longs — consider contrarian shorts
${userPrompt ? `\nUSER INSTRUCTIONS (follow these closely):\n${userPrompt}` : ""}
${feedbackStr}${diversityHint}

CURRENT MARKET DATA (last 14 days, ${timeframe} timeframe):
${JSON.stringify(technicals, null, 2)}
${overviewStr}${altDataStr}

Available symbols: ${symbolsToScan.join(", ")}
${riskNote}

Available technical indicators: rsi, macd, bollinger, ema, sma, stochastic, atr
Available alternative data indicators (these ARE backtestable — historical data is stored):
- funding_rate: per-symbol funding rate (decimal, e.g. 0.0005 = 0.05%)
- funding_signal: -2=extreme_short, -1=short_crowded, 0=neutral, 1=long_crowded, 2=extreme_long
- reddit_sentiment: bullish% minus bearish% (-100 to +100)
- reddit_buzz: activity score (0-100, >80 = extreme)
- google_trends: search interest (0-100, >80 = FOMO)
- whale_flow_signal: exchange net flow direction (-100 to +100, negative=accumulation/bullish)
Available operators: >, <, >=, <=, crosses_above, crosses_below
For multi-value indicators use "field": macd→"macd"|"signal"|"histogram", bollinger→"upper"|"middle"|"lower", stochastic→"k"|"d"
For indicator-vs-indicator: value can be {"indicator":"ema","params":{"period":21}}

Respond ONLY with a JSON array. No markdown fences. No explanation. Compact JSON only.
Each object:
{"name":"SOL Trend Momentum","symbol":"SOL/USDT","sourceSignal":"EMA+RSI","tags":["trend","momentum"],"strategyConfig":{"entryConditions":[{"indicator":"ema","params":{"period":9},"operator":"crosses_above","value":{"indicator":"ema","params":{"period":21}}},{"indicator":"rsi","operator":">","value":50}],"exitConditions":[{"indicator":"rsi","operator":">","value":75}]${noRiskManagement ? ',"positionSizePercent":100' : `,"stopLossPercent":4,"takeProfitPercent":10,"positionSizePercent":${positionSizePercent}`}}}

RULES:
- 1-3 entry conditions, 1-2 exit conditions
- Include alt data indicators in at least 30% of strategies (e.g. funding_signal, reddit_buzz, whale_flow_signal)
- Vary across coins AND indicator combinations
- Names under 30 chars, compact JSON
${userPrompt ? "- Prioritize the user's instructions above" : ""}`;

    const MAX_RETRIES = 2;
    let batchStrategies: GeneratedStrategy[] = [];

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        lastRequestTime = Date.now();
        const maxTokens = Math.min(Math.max(count * 350, 4096), 16384);
        const response = await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }],
        });

        totalInputTokens += response.usage.input_tokens;
        totalOutputTokens += response.usage.output_tokens;

        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("")
          .replace(/```(?:json)?\s*/g, "")
          .replace(/```\s*/g, "")
          .trim();

        const parsed = parseStrategiesFromText(text);
        if (parsed.length > 0) {
          allRaw.push(...parsed);
          batchStrategies = parsed.map((s) => ({
            id: `ai-${++idCounter}`,
            name: s.name || `AI Strategy ${idCounter}`,
            symbol: s.symbol,
            strategyConfig: {
              name: s.name,
              entryConditions: (s.strategyConfig?.entryConditions || []) as unknown as GeneratedStrategy["strategyConfig"]["entryConditions"],
              exitConditions: (s.strategyConfig?.exitConditions || []) as unknown as GeneratedStrategy["strategyConfig"]["exitConditions"],
              ...(noRiskManagement ? {} : {
                stopLossPercent: s.strategyConfig?.stopLossPercent,
                takeProfitPercent: s.strategyConfig?.takeProfitPercent,
              }),
              positionSizePercent: noRiskManagement ? 100 : (s.strategyConfig?.positionSizePercent || positionSizePercent),
            },
            sourceSignal: s.sourceSignal || "AI",
            tags: [...(s.tags || []), "ai-generated", ...(noRiskManagement ? ["no-rm"] : [])],
          }));
          break;
        }

        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
        }
      } catch (err: unknown) {
        const apiErr = err as { status?: number; error?: { error?: { message?: string } }; message?: string };
        if (apiErr.status === 400 || apiErr.status === 401) {
          yield { type: "error", message: apiErr.error?.error?.message || apiErr.message || "API request failed" };
          return;
        }
        if (apiErr.status === 429 && attempt < MAX_RETRIES) {
          const backoffMs = RATE_LIMIT_DELAY_MS * (attempt + 2);
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        if (attempt >= MAX_RETRIES) break;
      }
    }

    // Yield this batch's results to the client
    if (batchStrategies.length > 0) {
      yield {
        type: "progress",
        batchNum,
        totalBatches: batches.length,
        strategies: batchStrategies,
        message: `Batch ${batchNum}/${batches.length}: +${batchStrategies.length} strategies`,
      };
    }
  }

  if (allRaw.length === 0) {
    yield { type: "error", message: "AI generation produced no results. This may be a temporary issue — please try again." };
    return;
  }

  const elapsed = performance.now() - start;
  const estimatedCost = (totalInputTokens * 3 / 1_000_000) + (totalOutputTokens * 15 / 1_000_000);

  yield {
    type: "done",
    totalGenerated: idCounter,
    aiBaseCount: allRaw.length,
    generationTimeMs: Math.round(elapsed),
    tokenUsage: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      estimatedCost: Math.round(estimatedCost * 10000) / 10000,
    },
    config: { timeframe, targetTotal },
  };
}
