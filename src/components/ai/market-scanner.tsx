"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity,
  RefreshCw,
  Loader2,
  Search,
  TrendingUp,
  BarChart3,
  Sparkles,
} from "lucide-react";

interface MarketSignal {
  symbol: string;
  currentPrice: number;
  volume24h: number;
  signals: string[];
  score: number;
  timeframe: string;
}

export function MarketScanner({
  onFunnel,
}: {
  onFunnel?: (signals: { symbol: string; signals: string[]; currentPrice: number }[]) => void;
} = {}) {
  const [timeframe, setTimeframe] = useState("1h");

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["market-scanner", timeframe],
    queryFn: async () => {
      const res = await fetch(`/api/ai/screener/market?timeframe=${timeframe}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 5 * 60_000,
  });

  const signals: MarketSignal[] = data?.signals || [];

  const signalColors: Record<string, string> = {
    oversold: "text-emerald-400 bg-emerald-500/10",
    overbought: "text-red-400 bg-red-500/10",
    bullish: "text-emerald-400 bg-emerald-500/10",
    bearish: "text-red-400 bg-red-500/10",
    golden: "text-amber-400 bg-amber-500/10",
    death: "text-red-400 bg-red-500/10",
    squeeze: "text-cyan-400 bg-cyan-500/10",
    bouncing: "text-emerald-400 bg-emerald-500/10",
    positive: "text-emerald-400 bg-emerald-500/10",
    lower: "text-emerald-400 bg-emerald-500/10",
    upper: "text-red-400 bg-red-500/10",
  };

  function getSignalStyle(signal: string) {
    const lower = signal.toLowerCase();
    for (const [key, style] of Object.entries(signalColors)) {
      if (lower.includes(key)) return style;
    }
    return "text-slate-400 bg-slate-500/10";
  }

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <label className="text-[11px] text-slate-500">Timeframe</label>
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            className="rounded bg-[#111827] border border-white/[0.08] px-2 py-1 text-xs text-slate-300"
          >
            {["15m", "1h", "4h", "1d"].map((tf) => (
              <option key={tf} value={tf}>{tf}</option>
            ))}
          </select>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => refetch()}
          disabled={isFetching}
          className="h-7 text-xs border-white/[0.08] text-slate-400"
        >
          {isFetching ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
          Scan
        </Button>
        {data?.scannedAt && (
          <span className="text-[10px] text-slate-600">
            Scanned {new Date(data.scannedAt).toLocaleTimeString()}
            {data.cached && " (cached)"}
          </span>
        )}
        {onFunnel && signals.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onFunnel(
                signals.map((s) => ({
                  symbol: s.symbol,
                  signals: s.signals,
                  currentPrice: s.currentPrice,
                }))
              )
            }
            className="h-7 text-xs border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/10 ml-auto"
          >
            <Sparkles className="w-3 h-3 mr-1" />
            Funnel All Signals
          </Button>
        )}
        <span className={`text-[10px] text-slate-600 ${onFunnel && signals.length > 0 ? "" : "ml-auto"}`}>
          Scanning 20 top coins
        </span>
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
          <span className="ml-2 text-sm text-slate-400">Scanning indicators across markets...</span>
        </div>
      ) : signals.length === 0 ? (
        <div className="text-center py-8">
          <Search className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <p className="text-sm text-slate-500">No notable signals found on {timeframe} timeframe.</p>
          <p className="text-[11px] text-slate-600 mt-1">Try a different timeframe.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {signals.map((s) => (
            <div
              key={s.symbol}
              className="rounded-xl bg-[#111827] border border-white/[0.06] p-3 hover:border-white/[0.12] transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-200">{s.symbol.replace("/USDT", "")}</span>
                  <span className="text-xs text-slate-500">
                    ${s.currentPrice.toFixed(s.currentPrice < 1 ? 6 : 2)}
                  </span>
                  <Badge variant="outline" className="text-[10px]">{s.timeframe}</Badge>
                </div>
                <div className="flex items-center gap-1.5">
                  {onFunnel && (
                    <button
                      onClick={() =>
                        onFunnel([
                          {
                            symbol: s.symbol,
                            signals: s.signals,
                            currentPrice: s.currentPrice,
                          },
                        ])
                      }
                      className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                    >
                      <Sparkles className="w-3 h-3" />
                      Funnel
                    </button>
                  )}
                  <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-xs font-medium text-cyan-400">{s.score} signal{s.score > 1 ? "s" : ""}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {s.signals.map((sig, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium ${getSignalStyle(sig)}`}
                  >
                    {sig}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
