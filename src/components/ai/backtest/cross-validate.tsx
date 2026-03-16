"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  GitCompareArrows,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { StrategyConfig } from "@/lib/ai/backtest/types";

const ALL_SYMBOLS = [
  "BTC/USDT", "ETH/USDT", "SOL/USDT", "XRP/USDT", "DOGE/USDT",
  "ADA/USDT", "AVAX/USDT", "DOT/USDT", "LINK/USDT", "NEAR/USDT",
];

const DATE_RANGES = [
  { label: "30d", days: 30 },
  { label: "60d", days: 60 },
  { label: "90d", days: 90 },
  { label: "180d", days: 180 },
  { label: "365d", days: 365 },
];

interface CrossValidateResult {
  symbol: string;
  dateRange: string;
  days: number;
  totalPnl: number;
  winRate: number;
  sharpeRatio: number;
  profitFactor: number;
  maxDrawdown: number;
  totalTrades: number;
}

interface CrossValidateProps {
  strategyConfig: StrategyConfig;
  currentSymbol: string;
  timeframe: string;
}

export function CrossValidate({ strategyConfig, currentSymbol, timeframe }: CrossValidateProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(
    new Set(ALL_SYMBOLS.filter((s) => s !== currentSymbol))
  );
  const [selectedRanges, setSelectedRanges] = useState<Set<string>>(
    new Set(["30d", "90d", "180d"])
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const symbols = [currentSymbol, ...ALL_SYMBOLS.filter((s) => selectedSymbols.has(s) && s !== currentSymbol)];
      const dateRanges = DATE_RANGES.filter((r) => selectedRanges.has(r.label));

      const res = await fetch("/api/ai/backtest/cross-validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols, timeframe, strategyConfig, dateRanges }),
      });
      if (!res.ok) throw new Error("Cross-validation failed");
      return res.json();
    },
  });

  const results: CrossValidateResult[] = mutation.data?.results || [];
  const summary = mutation.data?.summary;
  const execTime = mutation.data?.executionTimeMs;

  // Group results by symbol for the matrix view
  const symbols = [...new Set(results.map((r) => r.symbol))];
  const ranges = [...new Set(results.map((r) => r.dateRange))];

  const toggleSymbol = (s: string) => {
    setSelectedSymbols((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  };

  const toggleRange = (r: string) => {
    setSelectedRanges((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r); else next.add(r);
      return next;
    });
  };

  return (
    <div className="rounded-xl bg-[#111827] border border-white/[0.06] p-4 space-y-3">
      {/* Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 w-full text-left"
      >
        {isOpen ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
        <GitCompareArrows className="w-4 h-4 text-violet-400" />
        <h3 className="text-sm font-semibold text-slate-200">
          Cross-Validate
        </h3>
        <span className="text-[10px] text-slate-500">
          Test on other pairs & date ranges
        </span>
      </button>

      {isOpen && (
        <div className="space-y-3 pt-1">
          {/* Symbol selection */}
          <div>
            <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium block mb-1.5">
              Symbols
            </label>
            <div className="flex flex-wrap gap-1.5">
              {/* Current symbol — always included */}
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-violet-500/15 text-violet-400 border border-violet-500/20">
                {currentSymbol.replace("/USDT", "")} (current)
              </span>
              {ALL_SYMBOLS.filter((s) => s !== currentSymbol).map((s) => (
                <button
                  key={s}
                  onClick={() => toggleSymbol(s)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                    selectedSymbols.has(s)
                      ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/20"
                      : "bg-slate-800 text-slate-500 border border-white/[0.04] hover:text-slate-400"
                  }`}
                >
                  {s.replace("/USDT", "")}
                </button>
              ))}
            </div>
          </div>

          {/* Date range selection */}
          <div>
            <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium block mb-1.5">
              Date Ranges
            </label>
            <div className="flex flex-wrap gap-1.5">
              {DATE_RANGES.map((r) => (
                <button
                  key={r.label}
                  onClick={() => toggleRange(r.label)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                    selectedRanges.has(r.label)
                      ? "bg-amber-500/15 text-amber-400 border border-amber-500/20"
                      : "bg-slate-800 text-slate-500 border border-white/[0.04] hover:text-slate-400"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Run button */}
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || selectedRanges.size === 0}
            className="bg-violet-600 hover:bg-violet-700 text-white text-xs h-8"
          >
            {mutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <GitCompareArrows className="w-3.5 h-3.5 mr-1.5" />
            )}
            Test on {1 + selectedSymbols.size} pairs × {selectedRanges.size} ranges
            {mutation.isPending && " ..."}
          </Button>

          {/* Summary */}
          {summary && (
            <div className="flex flex-wrap gap-3 text-xs">
              <div className="px-3 py-1.5 rounded-lg bg-violet-500/10">
                <span className="text-slate-500">Tested: </span>
                <span className="text-violet-400 font-medium">{summary.totalTests}</span>
              </div>
              <div className="px-3 py-1.5 rounded-lg bg-emerald-500/10">
                <span className="text-slate-500">Profitable: </span>
                <span className="text-emerald-400 font-medium">
                  {summary.profitable}/{summary.totalTests}
                  <span className="text-slate-500 ml-1">
                    ({Math.round((summary.profitable / summary.totalTests) * 100)}%)
                  </span>
                </span>
              </div>
              <div className="px-3 py-1.5 rounded-lg bg-cyan-500/10">
                <span className="text-slate-500">Avg PnL: </span>
                <span className={`font-medium ${summary.avgPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {summary.avgPnl >= 0 ? "+" : ""}{summary.avgPnl}%
                </span>
              </div>
              <div className="px-3 py-1.5 rounded-lg bg-slate-500/10">
                <span className="text-slate-500">Avg Sharpe: </span>
                <span className="text-slate-300 font-medium">{summary.avgSharpe}</span>
              </div>
              {execTime && (
                <span className="text-[10px] text-slate-600 self-center">{(execTime / 1000).toFixed(1)}s</span>
              )}
            </div>
          )}

          {/* Results matrix */}
          {results.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-white/[0.04]">
              <table className="w-full text-[11px]">
                <thead className="bg-[#0d1117]">
                  <tr className="text-slate-500">
                    <th className="text-left p-2 sticky left-0 bg-[#0d1117] z-10">Symbol</th>
                    {ranges.map((r) => (
                      <th key={r} className="text-center p-2" colSpan={1}>{r}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {symbols.map((symbol) => {
                    const symbolResults = results.filter((r) => r.symbol === symbol);
                    const isCurrent = symbol === currentSymbol;
                    return (
                      <tr
                        key={symbol}
                        className={`border-t border-white/[0.03] ${isCurrent ? "bg-violet-500/5" : ""}`}
                      >
                        <td className="p-2 font-medium text-slate-300 sticky left-0 bg-[#111827] z-10">
                          {symbol.replace("/USDT", "")}
                          {isCurrent && <span className="text-violet-400 text-[9px] ml-1">*</span>}
                        </td>
                        {ranges.map((range) => {
                          const r = symbolResults.find((sr) => sr.dateRange === range);
                          if (!r || r.totalTrades === 0) {
                            return (
                              <td key={range} className="p-2 text-center text-slate-600">—</td>
                            );
                          }
                          const isProfit = r.totalPnl > 0;
                          return (
                            <td key={range} className="p-2">
                              <div className="flex flex-col items-center gap-0.5">
                                <span className={`font-semibold ${isProfit ? "text-emerald-400" : "text-red-400"}`}>
                                  {isProfit ? "+" : ""}{r.totalPnl}%
                                </span>
                                <span className="text-slate-500">
                                  WR {r.winRate}% · {r.totalTrades}t
                                </span>
                                <span className="text-slate-600">
                                  SR {r.sharpeRatio}
                                </span>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Interpretation hint */}
          {summary && summary.totalTests > 0 && (
            <div className={`rounded-lg px-3 py-2 text-[11px] ${
              summary.profitable / summary.totalTests >= 0.6
                ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                : summary.profitable / summary.totalTests >= 0.4
                ? "bg-amber-500/10 border border-amber-500/20 text-amber-400"
                : "bg-red-500/10 border border-red-500/20 text-red-400"
            }`}>
              {summary.profitable / summary.totalTests >= 0.6 ? (
                <><TrendingUp className="w-3.5 h-3.5 inline mr-1" />Strong cross-validation: profitable on {Math.round((summary.profitable / summary.totalTests) * 100)}% of combinations. Higher chance of real alpha.</>
              ) : summary.profitable / summary.totalTests >= 0.4 ? (
                <><TrendingUp className="w-3.5 h-3.5 inline mr-1" />Moderate cross-validation: works on some pairs/periods. May be pair-specific or regime-dependent.</>
              ) : (
                <><TrendingDown className="w-3.5 h-3.5 inline mr-1" />Weak cross-validation: only profitable on {Math.round((summary.profitable / summary.totalTests) * 100)}% of tests. Likely overfitted to specific conditions.</>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
