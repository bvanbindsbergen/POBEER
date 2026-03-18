import { fetchCandles } from "@/lib/ai/data/candles";
import { calculateIndicator } from "@/lib/ai/indicators";
import { fetchMarketOverview } from "@/lib/ai/data/market";
import { fetchDerivativesOverview } from "@/lib/ai/data/funding-rates";
import { fetchRedditSentiment } from "@/lib/ai/data/reddit-sentiment";
import { fetchGoogleTrends } from "@/lib/ai/data/google-trends";
import { fetchWhaleTransactions } from "@/lib/ai/data/whale-alert";
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

  // Load market overview + alternative data (all in parallel)
  const [overview, derivatives, redditData, trendsData, whaleData] = await Promise.all([
    fetchMarketOverview().catch(() => null),
    fetchDerivativesOverview(symbolsToScan.slice(0, 3)).catch(() => null),
    fetchRedditSentiment(["cryptocurrency", "bitcoin"]).catch(() => null),
    fetchGoogleTrends(["bitcoin", "crypto"]).catch(() => null),
    fetchWhaleTransactions("btc").catch(() => null),
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

  // Run batches in parallel (max 5 concurrent)
  const MAX_CONCURRENT = 5;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let rawStrategies: RawStrategy[] = [];

  for (let i = 0; i < batches.length; i += MAX_CONCURRENT) {
    const batchSlice = batches.slice(i, i + MAX_CONCURRENT);
    const batchResults = await Promise.allSettled(
      batchSlice.map(async (count, batchIdx) => {
        const batchNum = i + batchIdx + 1;
        const diversityHint = batches.length > 1
          ? `\nThis is batch ${batchNum} of ${batches.length}. Generate DIFFERENT strategies than typical — vary indicators, params, and coins. Batch ${batchNum} focus: ${
            ["momentum & trend", "mean-reversion & oscillators", "volatility & breakout", "divergence & multi-indicator", "cross-asset & unconventional"][batchIdx % 5]
          } strategies.`
          : "";

        const prompt = `Generate exactly ${count} diverse, creative trading strategies for backtesting on ${timeframe} candles. Focus on discovering NEW insights — unconventional indicator combinations, unusual parameter values, creative signal interpretations.

IMPORTANT: Factor in the alternative data below when designing strategies:
- If funding rates show extreme longs → favor mean-reversion/short-bias entries or tighter stop losses
- If Reddit/Google trends show extreme FOMO → favor conservative entries, contrarian setups
- If whale flows show accumulation (outflows > inflows) → favor long entries on dips
- If whale flows show distribution (inflows > outflows) → favor quicker exits, tighter TPs
- Adjust risk parameters (SL/TP) based on leverage crowding and sentiment extremes
${userPrompt ? `\nUSER INSTRUCTIONS (follow these closely):\n${userPrompt}` : ""}
${feedbackStr}${diversityHint}

CURRENT MARKET DATA (last 14 days, ${timeframe} timeframe):
${JSON.stringify(technicals, null, 2)}
${overviewStr}${altDataStr}

Available symbols: ${symbolsToScan.join(", ")}
${riskNote}

Available indicators: rsi, macd, bollinger, ema, sma, stochastic, atr
Available operators: >, <, >=, <=, crosses_above, crosses_below
For multi-value indicators use "field": macd→"macd"|"signal"|"histogram", bollinger→"upper"|"middle"|"lower", stochastic→"k"|"d"
For indicator-vs-indicator: value can be {"indicator":"ema","params":{"period":21}}

Respond ONLY with a JSON array. No markdown fences. No explanation. Compact JSON only.
Each object:
{"name":"SOL Trend Momentum","symbol":"SOL/USDT","sourceSignal":"EMA+RSI","tags":["trend","momentum"],"strategyConfig":{"entryConditions":[{"indicator":"ema","params":{"period":9},"operator":"crosses_above","value":{"indicator":"ema","params":{"period":21}}},{"indicator":"rsi","operator":">","value":50}],"exitConditions":[{"indicator":"rsi","operator":">","value":75}]${noRiskManagement ? ',"positionSizePercent":100' : `,"stopLossPercent":4,"takeProfitPercent":10,"positionSizePercent":${positionSizePercent}`}}}

RULES:
- 1-3 entry conditions, 1-2 exit conditions
- Vary across coins AND indicator combinations
- Names under 30 chars, compact JSON
${userPrompt ? "- Prioritize the user's instructions above" : ""}`;

        // Retry up to 2 times on parse failure
        const MAX_RETRIES = 2;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
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
            return parsed;
          }

          if (attempt < MAX_RETRIES) {
            console.warn(`[Funnel AI] Batch ${batchNum} parse failed (attempt ${attempt + 1}), retrying...`);
          }
        }
        console.error(`[Funnel AI] Batch ${batchNum} failed after ${MAX_RETRIES + 1} attempts`);
        return [] as RawStrategy[];
      })
    );

    for (const result of batchResults) {
      if (result.status !== "fulfilled") {
        console.error("[Funnel AI] Batch failed:", result.reason);
        continue;
      }
      rawStrategies.push(...result.value);
    }
  }

  if (rawStrategies.length === 0) {
    throw new Error("Failed to parse AI response. Try again.");
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
