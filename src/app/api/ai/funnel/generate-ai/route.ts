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
  "ADA/USDT", "AVAX/USDT", "DOT/USDT", "LINK/USDT", "MATIC/USDT",
  "NEAR/USDT", "UNI/USDT", "ATOM/USDT", "LTC/USDT", "FIL/USDT",
  "APT/USDT", "ARB/USDT", "OP/USDT", "INJ/USDT", "SUI/USDT",
];

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();

    const body = await req.json();
    const count: number = Math.min(body.count || 10, 50);
    const userPrompt: string = body.prompt || "";
    const timeframe: string = body.timeframe || "1h";
    const symbols: string[] = body.symbols?.length ? body.symbols : TOP_SYMBOLS.slice(0, 10);
    const positionSizePercent: number = body.positionSizePercent || 10;

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

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `Generate exactly ${count} trading strategies based on current market data. Each strategy must use specific technical indicator conditions that can be backtested.
${userPrompt ? `\nUSER INSTRUCTIONS (follow these closely):\n${userPrompt}` : ""}
${feedbackStr}

CURRENT MARKET DATA:
Timeframe: ${timeframe}
Technicals per coin:
${JSON.stringify(technicals, null, 2)}
${overviewStr}

Available symbols: ${symbolsToScan.join(", ")}

Available indicators for conditions: rsi, macd, bollinger, ema, sma, stochastic, atr
Available operators: >, <, >=, <=, crosses_above, crosses_below
For multi-value indicators use "field": macd→"macd"|"signal"|"histogram", bollinger→"upper"|"middle"|"lower", stochastic→"k"|"d"
For indicator-vs-indicator comparisons, value can be: {"indicator": "ema", "params": {"period": 21}}

Respond ONLY with a JSON array of exactly ${count} objects. No markdown, no explanation. Each object:
{
  "name": "Short name e.g. 'SOL RSI Bounce + MACD'",
  "symbol": "PAIR/USDT",
  "reasoning": "1-2 sentence rationale",
  "sourceSignal": "short label for entry type",
  "tags": ["tag1", "tag2"],
  "strategyConfig": {
    "entryConditions": [{"indicator": "rsi", "operator": "<", "value": 30, "params": {"period": 14}}],
    "exitConditions": [{"indicator": "rsi", "operator": ">", "value": 70}],
    "stopLossPercent": number,
    "takeProfitPercent": number,
    "positionSizePercent": ${positionSizePercent}
  }
}

RULES:
- Vary strategies across different coins and indicator combinations
- Include a mix of risk levels (tight SL 2-3% to wide 8-12%)
- Every strategy MUST have at least 1 entry condition and 1 exit condition
- stopLossPercent and takeProfitPercent are required numbers
- takeProfitPercent should be > stopLossPercent
${userPrompt ? "- Prioritize the user's instructions above" : ""}`,
        },
      ],
    });

    // Parse response
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    let rawStrategies: Array<{
      name: string;
      symbol: string;
      reasoning?: string;
      sourceSignal?: string;
      tags?: string[];
      strategyConfig: {
        entryConditions: Array<Record<string, unknown>>;
        exitConditions: Array<Record<string, unknown>>;
        stopLossPercent: number;
        takeProfitPercent: number;
        positionSizePercent: number;
      };
    }> = [];

    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        rawStrategies = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error("[Funnel AI] Failed to parse response:", e, text);
      return NextResponse.json({ error: "Failed to parse AI response" }, { status: 500 });
    }

    // Convert to GeneratedStrategy format
    // Conditions come from Claude's JSON — cast through unknown since structure is validated at runtime by the backtest engine
    const strategies: GeneratedStrategy[] = rawStrategies.map((s, i) => ({
      id: `ai-${i + 1}`,
      name: s.name || `AI Strategy ${i + 1}`,
      symbol: s.symbol,
      strategyConfig: {
        name: s.name,
        entryConditions: (s.strategyConfig?.entryConditions || []) as unknown as GeneratedStrategy["strategyConfig"]["entryConditions"],
        exitConditions: (s.strategyConfig?.exitConditions || []) as unknown as GeneratedStrategy["strategyConfig"]["exitConditions"],
        stopLossPercent: s.strategyConfig?.stopLossPercent,
        takeProfitPercent: s.strategyConfig?.takeProfitPercent,
        positionSizePercent: s.strategyConfig?.positionSizePercent || positionSizePercent,
      },
      sourceSignal: s.sourceSignal || "AI",
      tags: [...(s.tags || []), "ai-generated"],
    }));

    const elapsed = performance.now() - start;

    // Token usage for cost reporting
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const estimatedCost = (inputTokens * 3 / 1_000_000) + (outputTokens * 15 / 1_000_000);

    return NextResponse.json({
      strategies,
      totalGenerated: strategies.length,
      generationTimeMs: Math.round(elapsed),
      tokenUsage: { inputTokens, outputTokens, estimatedCost: Math.round(estimatedCost * 10000) / 10000 },
      config: { timeframe, count },
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
