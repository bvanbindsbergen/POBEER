import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { fetchCandles } from "@/lib/ai/data/candles";
import { calculateIndicator } from "@/lib/ai/indicators";
import { fetchMarketOverview } from "@/lib/ai/data/market";
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

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();

    const body = await req.json();
    const aiBaseCount: number = Math.min(body.count || 20, 30); // Claude generates up to 30 unique ideas
    const targetTotal: number = body.targetTotal || aiBaseCount; // expand with SL/TP variations to reach this
    const userPrompt: string = body.prompt || "";
    const timeframe: string = body.timeframe || "1h";
    const symbols: string[] = body.symbols?.length ? body.symbols : TOP_SYMBOLS.slice(0, 10);
    const positionSizePercent: number = body.positionSizePercent || 10;
    const noRiskManagement: boolean = body.noRiskManagement || false;
    const slRange: number[] = body.slRange || [2, 3, 5, 8];
    const tpRange: number[] = body.tpRange || [3, 5, 8, 12, 15];

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }

    const start = performance.now();

    // Gather market context for requested symbols (parallel, max 10)
    const symbolsToScan = symbols.slice(0, 10);
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

    // Load market overview
    let overview;
    try {
      overview = await fetchMarketOverview();
    } catch {
      overview = null;
    }

    // Load user feedback history
    const recentFeedback = await db
      .select({
        strategyName: strategyFeedback.strategyName,
        symbol: strategyFeedback.symbol,
        action: strategyFeedback.action,
        reason: strategyFeedback.reason,
      })
      .from(strategyFeedback)
      .where(eq(strategyFeedback.userId, auth.user.id))
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

    const client = new Anthropic({ apiKey });

    // Scale max_tokens: ~80 tokens per strategy for compact JSON
    const maxTokens = Math.min(Math.max(aiBaseCount * 150, 2048), 16384);

    const riskNote = noRiskManagement
      ? `\nRISK MANAGEMENT: DISABLED. Do NOT include stopLossPercent or takeProfitPercent. Set positionSizePercent to 100. Focus purely on entry/exit signal quality.`
      : `\nInclude stopLossPercent, takeProfitPercent, and positionSizePercent: ${positionSizePercent} in each strategy.`;

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      messages: [
        {
          role: "user",
          content: `Generate exactly ${aiBaseCount} diverse, creative trading strategies for backtesting on ${timeframe} candles. Focus on discovering NEW insights — unconventional indicator combinations, unusual parameter values, creative signal interpretations.
${userPrompt ? `\nUSER INSTRUCTIONS (follow these closely):\n${userPrompt}` : ""}
${feedbackStr}

CURRENT MARKET DATA (last 14 days, ${timeframe} timeframe):
${JSON.stringify(technicals, null, 2)}
${overviewStr}

Available symbols: ${symbolsToScan.join(", ")}
${riskNote}

Available indicators: rsi, macd, bollinger, ema, sma, stochastic, atr
Available operators: >, <, >=, <=, crosses_above, crosses_below
For multi-value indicators use "field": macd→"macd"|"signal"|"histogram", bollinger→"upper"|"middle"|"lower", stochastic→"k"|"d"
For indicator-vs-indicator: value can be {"indicator":"ema","params":{"period":21}}

Respond ONLY with a JSON array. No markdown. Compact JSON.
Each object:
{"name":"SOL Trend Momentum","symbol":"SOL/USDT","sourceSignal":"EMA+RSI","tags":["trend","momentum"],"strategyConfig":{"entryConditions":[{"indicator":"ema","params":{"period":9},"operator":"crosses_above","value":{"indicator":"ema","params":{"period":21}}},{"indicator":"rsi","operator":">","value":50}],"exitConditions":[{"indicator":"rsi","operator":">","value":75}]${noRiskManagement ? ',"positionSizePercent":100' : `,"stopLossPercent":4,"takeProfitPercent":10,"positionSizePercent":${positionSizePercent}`}}}

RULES:
- 1-3 entry conditions, 1-2 exit conditions
- Vary across coins AND indicator combinations
- Names under 30 chars, compact JSON
${userPrompt ? "- Prioritize the user's instructions above" : ""}`,
        },
      ],
    });

    // Parse response
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

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

    let rawStrategies: RawStrategy[] = [];

    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        rawStrategies = JSON.parse(jsonMatch[0]);
      }
    } catch {
      // If full array parse fails, try to extract individual JSON objects
      console.warn("[Funnel AI] Full array parse failed, attempting partial recovery");
      const objectMatches = text.matchAll(/\{[^{}]*"strategyConfig"\s*:\s*\{[^}]*"entryConditions"[\s\S]*?"positionSizePercent"\s*:\s*\d+\s*\}\s*\}/g);
      for (const match of objectMatches) {
        try {
          const obj = JSON.parse(match[0]) as RawStrategy;
          if (obj.name && obj.symbol && obj.strategyConfig?.entryConditions) {
            rawStrategies.push(obj);
          }
        } catch {
          // Skip unparseable objects
        }
      }
      if (rawStrategies.length === 0) {
        console.error("[Funnel AI] Could not parse any strategies from response");
        return NextResponse.json({ error: "Failed to parse AI response. Try generating fewer strategies." }, { status: 500 });
      }
      console.log(`[Funnel AI] Recovered ${rawStrategies.length} of ${aiBaseCount} strategies`);
    }

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

    // If targetTotal > base count, expand with SL/TP variations (skip if noRiskManagement)
    let strategies: GeneratedStrategy[];
    if (!noRiskManagement && targetTotal > baseStrategies.length) {
      strategies = [];
      let idCounter = 0;
      for (const base of baseStrategies) {
        // Always include the original
        strategies.push({ ...base, id: `ai-${++idCounter}` });
        // Create SL/TP variations
        const shortName = base.name.replace(/\s*\|.*$/, ""); // strip existing SL/TP suffix
        for (const sl of slRange) {
          for (const tp of tpRange) {
            if (tp <= sl) continue;
            // Skip if same as original
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
      // Cap at targetTotal, shuffle if exceeding
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

    // Token usage for cost reporting
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const estimatedCost = (inputTokens * 3 / 1_000_000) + (outputTokens * 15 / 1_000_000);

    return NextResponse.json({
      strategies,
      totalGenerated: strategies.length,
      aiBaseCount: baseStrategies.length,
      generationTimeMs: Math.round(elapsed),
      tokenUsage: { inputTokens, outputTokens, estimatedCost: Math.round(estimatedCost * 10000) / 10000 },
      config: { timeframe, targetTotal },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[Funnel AI Generate] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
