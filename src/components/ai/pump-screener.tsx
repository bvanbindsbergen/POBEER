"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  RefreshCw,
  Loader2,
  Flame,
  Volume2,
} from "lucide-react";

interface PumpSignal {
  symbol: string;
  priceChange: number;
  volumeChange: number;
  currentPrice: number;
  volume24h: number;
  timestamp: number;
}

export function PumpScreener() {
  const [minPrice, setMinPrice] = useState(3);
  const [minVolume, setMinVolume] = useState(50);
  const [window, setWindow] = useState(5);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["pump-screener", minPrice, minVolume, window],
    queryFn: async () => {
      const res = await fetch(
        `/api/ai/screener/pump?minPrice=${minPrice}&minVolume=${minVolume}&window=${window}`
      );
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const signals: PumpSignal[] = data?.signals || [];

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <label className="text-[11px] text-slate-500">Min Price %</label>
          <select
            value={minPrice}
            onChange={(e) => setMinPrice(Number(e.target.value))}
            className="rounded bg-[#111827] border border-white/[0.08] px-2 py-1 text-xs text-slate-300"
          >
            {[1, 2, 3, 5, 8, 10].map((v) => (
              <option key={v} value={v}>{v}%</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-[11px] text-slate-500">Min Vol %</label>
          <select
            value={minVolume}
            onChange={(e) => setMinVolume(Number(e.target.value))}
            className="rounded bg-[#111827] border border-white/[0.08] px-2 py-1 text-xs text-slate-300"
          >
            {[25, 50, 100, 200, 500].map((v) => (
              <option key={v} value={v}>{v}%</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-[11px] text-slate-500">Window</label>
          <select
            value={window}
            onChange={(e) => setWindow(Number(e.target.value))}
            className="rounded bg-[#111827] border border-white/[0.08] px-2 py-1 text-xs text-slate-300"
          >
            {[5, 10, 15].map((v) => (
              <option key={v} value={v}>{v}m</option>
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
            Last scan: {new Date(data.scannedAt).toLocaleTimeString()}
            {data.cached && " (cached)"}
          </span>
        )}
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
          <span className="ml-2 text-sm text-slate-400">Scanning markets...</span>
        </div>
      ) : signals.length === 0 ? (
        <div className="text-center py-8">
          <Flame className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <p className="text-sm text-slate-500">No pump signals detected with current filters.</p>
          <p className="text-[11px] text-slate-600 mt-1">Try lowering thresholds or wait for market activity.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {signals.map((s) => {
            const isUp = s.priceChange > 0;
            return (
              <div
                key={s.symbol}
                className="flex items-center justify-between rounded-lg bg-[#111827] border border-white/[0.06] p-3 hover:border-white/[0.12] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className={`p-1.5 rounded-lg ${isUp ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
                    {isUp ? (
                      <TrendingUp className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <TrendingDown className="w-4 h-4 text-red-400" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-200">{s.symbol.replace("/USDT", "")}</span>
                      <span className="text-xs text-slate-500">${s.currentPrice.toFixed(s.currentPrice < 1 ? 6 : 2)}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-xs font-medium ${isUp ? "text-emerald-400" : "text-red-400"}`}>
                        {isUp ? "+" : ""}{s.priceChange.toFixed(2)}%
                      </span>
                      {s.volumeChange > 0 && (
                        <span className="flex items-center gap-0.5 text-xs text-cyan-400">
                          <Volume2 className="w-3 h-3" />
                          +{s.volumeChange.toFixed(0)}% vol
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-slate-500">Vol 24h</div>
                  <div className="text-xs text-slate-400">
                    ${s.volume24h >= 1_000_000
                      ? `${(s.volume24h / 1_000_000).toFixed(1)}M`
                      : `${(s.volume24h / 1_000).toFixed(0)}K`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
