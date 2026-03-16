import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { generateStrategies, type FunnelConfig } from "@/lib/ai/funnel/generator";
import { generateAiStrategies } from "@/lib/ai/funnel/ai-generator";
import { fetchCandlesBatch, type Candle } from "@/lib/ai/data/candles";
import { runBacktest } from "@/lib/ai/backtest/engine";
import type { GeneratedStrategy } from "@/lib/ai/funnel/generator";
import type { Trade, EquityPoint } from "@/lib/ai/backtest/types";

export const maxDuration = 300;

interface AutopilotEvent {
  phase: "generate" | "backtest" | "cross-validate" | "done" | "error";
  status: "started" | "progress" | "completed" | "error";
  message: string;
  data?: unknown;
}

function encodeEvent(event: AutopilotEvent): string {
  return JSON.stringify(event) + "\n";
}

function downsampleEquity(curve: EquityPoint[], maxPoints: number): EquityPoint[] {
  if (curve.length <= maxPoints) return curve;
  const step = curve.length / maxPoints;
  const result: EquityPoint[] = [];
  for (let i = 0; i < maxPoints; i++) {
    result.push(curve[Math.floor(i * step)]);
  }
  result.push(curve[curve.length - 1]);
  return result;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = await req.json();

    const mode: "algo" | "ai" = body.mode || "algo";
    const timeframe: string = body.timeframe || "1h";
    const minProfitPercent: number = body.minProfitPercent ?? 5;
    const daysBack: number = body.daysBack || 90;
    const topN: number = body.topN || 10;
    const positionSizePercent: number = body.positionSizePercent || 10;

    // Cross-validation config
    const cvSymbols: string[] = body.crossValidateSymbols || ["BTC/USDT", "ETH/USDT", "SOL/USDT", "XRP/USDT", "DOGE/USDT"];
    const cvDateRanges: { label: string; days: number }[] = body.crossValidateDateRanges || [
      { label: "30d", days: 30 },
      { label: "90d", days: 90 },
      { label: "180d", days: 180 },
    ];

    // Algo mode config
    const signals = body.signals || [];
    const maxStrategies: number = body.maxStrategies || 1000;
    const slRange: number[] = body.slRange || [3, 5, 8];
    const tpRange: number[] = body.tpRange || [5, 8, 12];

    // AI mode config
    const aiBaseCount: number = body.aiBaseCount || 20;
    const aiTargetTotal: number = body.aiTargetTotal || aiBaseCount;
    const aiPrompt: string = body.aiPrompt || "";
    const noRiskManagement: boolean = body.noRiskManagement || false;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: AutopilotEvent) => {
          controller.enqueue(encoder.encode(encodeEvent(event)));
        };

        try {
          // ── Phase 1: Generate ──
          send({ phase: "generate", status: "started", message: `Generating strategies (${mode} mode)...` });

          let strategies: GeneratedStrategy[];

          if (mode === "ai") {
            const result = await generateAiStrategies({
              count: aiBaseCount,
              targetTotal: aiTargetTotal,
              prompt: aiPrompt,
              timeframe,
              positionSizePercent: noRiskManagement ? 100 : positionSizePercent,
              noRiskManagement,
              slRange,
              tpRange,
              userId: auth.user.id,
            });
            strategies = result.strategies;
            send({
              phase: "generate", status: "completed",
              message: `Generated ${strategies.length} AI strategies (${result.aiBaseCount} base)`,
              data: { count: strategies.length, aiBaseCount: result.aiBaseCount, tokenUsage: result.tokenUsage },
            });
          } else {
            // Algo mode — may need scanner signals
            let algoSignals = signals;
            if (!algoSignals.length) {
              send({ phase: "generate", status: "progress", message: "Scanning market for signals..." });
              try {
                // Import dynamically to avoid circular deps
                const scanUrl = new URL("/api/ai/screener/market", req.url);
                scanUrl.searchParams.set("timeframe", timeframe);
                const scanRes = await fetch(scanUrl.toString(), {
                  headers: { cookie: req.headers.get("cookie") || "" },
                });
                if (scanRes.ok) {
                  const scanData = await scanRes.json();
                  algoSignals = (scanData.signals || []).map((s: { symbol: string; signals: string[]; currentPrice: number }) => ({
                    symbol: s.symbol,
                    signals: s.signals,
                    currentPrice: s.currentPrice,
                  }));
                }
              } catch (err) {
                console.error("[Autopilot] Scanner failed:", err);
              }
            }

            if (!algoSignals.length) {
              send({ phase: "generate", status: "error", message: "No signals available for algo mode" });
              send({ phase: "error", status: "error", message: "No signals available" });
              controller.close();
              return;
            }

            const config: FunnelConfig = {
              signals: algoSignals,
              timeframe,
              maxStrategies,
              slRange,
              tpRange,
              minProfitPercent,
              positionSizePercent,
            };
            strategies = generateStrategies(config);
            send({
              phase: "generate", status: "completed",
              message: `Generated ${strategies.length} algo strategies`,
              data: { count: strategies.length },
            });
          }

          // ── Phase 2: Backtest all ──
          send({ phase: "backtest", status: "started", message: `Backtesting ${strategies.length} strategies...` });

          // Group by symbol for efficient candle fetching
          const bySymbol = new Map<string, GeneratedStrategy[]>();
          for (const s of strategies) {
            const list = bySymbol.get(s.symbol) || [];
            list.push(s);
            bySymbol.set(s.symbol, list);
          }

          const symbolList = [...bySymbol.keys()];
          const candleResults = await fetchCandlesBatch(
            symbolList.map((symbol) => ({ symbol, timeframe, daysBack }))
          );

          const candleCache = new Map<string, Candle[]>();
          for (let i = 0; i < symbolList.length; i++) {
            const result = candleResults[i];
            if (result.status === "fulfilled" && result.value.length >= 30) {
              candleCache.set(symbolList[i], result.value);
            }
          }

          send({ phase: "backtest", status: "progress", message: `Fetched candles for ${candleCache.size}/${symbolList.length} symbols` });

          const INITIAL_EQUITY = 10000;
          const backtestResults: {
            strategy: GeneratedStrategy;
            metrics: {
              totalPnl: number;
              winRate: number;
              maxDrawdown: number;
              sharpeRatio: number;
              profitFactor: number;
              totalTrades: number;
            };
            trades: Trade[];
            equityCurve: EquityPoint[];
          }[] = [];

          let tested = 0;
          for (const [symbol, symbolStrategies] of bySymbol) {
            const candles = candleCache.get(symbol);
            if (!candles) continue;

            for (const strategy of symbolStrategies) {
              tested++;
              try {
                const result = runBacktest(candles, strategy.strategyConfig);
                const totalReturnPct = (result.totalPnl / INITIAL_EQUITY) * 100;

                if (totalReturnPct >= minProfitPercent) {
                  backtestResults.push({
                    strategy,
                    metrics: {
                      totalPnl: Math.round(totalReturnPct * 100) / 100,
                      winRate: Math.round(result.winRate * 100) / 100,
                      maxDrawdown: Math.round(result.maxDrawdown * 100) / 100,
                      sharpeRatio: Math.round(result.sharpeRatio * 100) / 100,
                      profitFactor: Math.round(result.profitFactor * 100) / 100,
                      totalTrades: result.totalTrades,
                    },
                    trades: result.trades,
                    equityCurve: downsampleEquity(result.equityCurve, 200),
                  });
                }
              } catch {
                // Skip erroring strategies
              }

              // Progress updates every 100 strategies
              if (tested % 100 === 0) {
                send({ phase: "backtest", status: "progress", message: `Backtested ${tested}/${strategies.length}...` });
              }
            }
          }

          // Sort by PnL
          backtestResults.sort((a, b) => b.metrics.totalPnl - a.metrics.totalPnl);

          send({
            phase: "backtest", status: "completed",
            message: `${backtestResults.length} of ${tested} passed ${minProfitPercent}% filter`,
            data: { totalTested: tested, totalPassed: backtestResults.length },
          });

          if (backtestResults.length === 0) {
            send({
              phase: "done", status: "completed",
              message: "No strategies passed the profit filter",
              data: { winners: [], totalTested: tested, totalPassed: 0 },
            });
            controller.close();
            return;
          }

          // ── Phase 3: Cross-validate top N ──
          const topStrategies = backtestResults.slice(0, topN);
          send({
            phase: "cross-validate", status: "started",
            message: `Cross-validating top ${topStrategies.length} strategies across ${cvSymbols.length} pairs × ${cvDateRanges.length} ranges...`,
          });

          const winners: {
            strategy: GeneratedStrategy;
            metrics: typeof backtestResults[0]["metrics"];
            trades: Trade[];
            equityCurve: EquityPoint[];
            crossValidation: {
              results: { symbol: string; dateRange: string; totalPnl: number; totalTrades: number }[];
              profitableRatio: number;
              avgPnl: number;
            };
          }[] = [];

          // Prefetch all candles for cross-validation (symbols × ranges)
          const cvFetchJobs: { symbol: string; timeframe: string; daysBack: number }[] = [];
          for (const sym of cvSymbols) {
            for (const range of cvDateRanges) {
              cvFetchJobs.push({ symbol: sym, timeframe, daysBack: range.days });
            }
          }
          const cvCandleResults = await fetchCandlesBatch(cvFetchJobs);

          // Build lookup: "symbol|days" → candles
          const cvCandleMap = new Map<string, Candle[]>();
          for (let i = 0; i < cvFetchJobs.length; i++) {
            const job = cvFetchJobs[i];
            const result = cvCandleResults[i];
            if (result.status === "fulfilled" && result.value.length >= 20) {
              cvCandleMap.set(`${job.symbol}|${job.daysBack}`, result.value);
            }
          }

          send({
            phase: "cross-validate", status: "progress",
            message: `Fetched candles for ${cvCandleMap.size}/${cvFetchJobs.length} combinations`,
          });

          for (let si = 0; si < topStrategies.length; si++) {
            const { strategy, metrics, trades, equityCurve } = topStrategies[si];

            const cvResults: { symbol: string; dateRange: string; totalPnl: number; totalTrades: number }[] = [];

            for (const sym of cvSymbols) {
              for (const range of cvDateRanges) {
                const candles = cvCandleMap.get(`${sym}|${range.days}`);
                if (!candles || candles.length < 20) {
                  cvResults.push({ symbol: sym, dateRange: range.label, totalPnl: 0, totalTrades: 0 });
                  continue;
                }

                try {
                  const result = runBacktest(candles, strategy.strategyConfig);
                  const totalReturnPct = (result.totalPnl / INITIAL_EQUITY) * 100;
                  cvResults.push({
                    symbol: sym,
                    dateRange: range.label,
                    totalPnl: Math.round(totalReturnPct * 100) / 100,
                    totalTrades: result.totalTrades,
                  });
                } catch {
                  cvResults.push({ symbol: sym, dateRange: range.label, totalPnl: 0, totalTrades: 0 });
                }
              }
            }

            const withTrades = cvResults.filter((r) => r.totalTrades > 0);
            const profitable = withTrades.filter((r) => r.totalPnl > 0);
            const profitableRatio = withTrades.length > 0 ? profitable.length / withTrades.length : 0;
            const avgPnl = withTrades.length > 0
              ? withTrades.reduce((s, r) => s + r.totalPnl, 0) / withTrades.length
              : 0;

            // Winner criteria: profitable on >60% of CV pairs AND positive avg PnL
            if (profitableRatio >= 0.6 && avgPnl > 0) {
              winners.push({
                strategy,
                metrics,
                trades,
                equityCurve,
                crossValidation: {
                  results: cvResults,
                  profitableRatio: Math.round(profitableRatio * 100) / 100,
                  avgPnl: Math.round(avgPnl * 100) / 100,
                },
              });
            }

            send({
              phase: "cross-validate", status: "progress",
              message: `Validated ${si + 1}/${topStrategies.length}...`,
            });
          }

          // Sort winners by cross-validation score (profitableRatio × avgPnl)
          winners.sort((a, b) => {
            const scoreA = a.crossValidation.profitableRatio * a.crossValidation.avgPnl;
            const scoreB = b.crossValidation.profitableRatio * b.crossValidation.avgPnl;
            return scoreB - scoreA;
          });

          send({
            phase: "cross-validate", status: "completed",
            message: `${winners.length} winners from ${topStrategies.length} candidates`,
          });

          // ── Done ──
          send({
            phase: "done", status: "completed",
            message: `Auto-pilot complete: ${winners.length} winning strategies found`,
            data: {
              winners,
              totalGenerated: strategies.length,
              totalTested: tested,
              totalPassed: backtestResults.length,
              totalCrossValidated: topStrategies.length,
              totalWinners: winners.length,
            },
          });
        } catch (err) {
          console.error("[Autopilot] Error:", err);
          send({
            phase: "error", status: "error",
            message: err instanceof Error ? err.message : "Unknown error",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
    console.error("[Autopilot] Error:", error);
    return new Response(JSON.stringify({ error: "Autopilot failed" }), { status: 500 });
  }
}
