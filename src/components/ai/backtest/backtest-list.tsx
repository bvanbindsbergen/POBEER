"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Clock } from "lucide-react";

interface BacktestSummary {
  id: string;
  symbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  status: string;
  totalPnl: string | null;
  winRate: string | null;
  totalTrades: number | null;
  createdAt: string;
  strategyConfig: string;
}

interface BacktestListProps {
  onSelect: (id: string) => void;
  selectedId?: string;
}

export function BacktestList({ onSelect, selectedId }: BacktestListProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["backtests"],
    queryFn: async () => {
      const res = await fetch("/api/ai/backtest");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const backtests: BacktestSummary[] = data?.backtests || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="w-5 h-5 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (backtests.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-slate-500">No backtests yet. Configure and run your first one above.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-slate-300">Backtest History</h4>
      <div className="space-y-1.5">
        {backtests.map((bt) => {
          const pnl = bt.totalPnl ? Number(bt.totalPnl) : null;
          const isPositive = pnl !== null && pnl >= 0;
          const config = (() => {
            try { return JSON.parse(bt.strategyConfig); } catch { return null; }
          })();

          return (
            <button
              key={bt.id}
              onClick={() => onSelect(bt.id)}
              className={`w-full text-left rounded-lg border p-3 transition-colors ${
                selectedId === bt.id
                  ? "bg-emerald-500/5 border-emerald-500/20"
                  : "bg-[#111827] border-white/[0.06] hover:border-white/[0.12]"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-200">
                    {bt.symbol}
                  </span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {bt.timeframe}
                  </Badge>
                </div>
                {bt.status === "completed" && pnl !== null ? (
                  <div className={`flex items-center gap-1 text-xs font-medium ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
                    {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    ${pnl.toFixed(2)}
                  </div>
                ) : bt.status === "running" ? (
                  <Badge className="bg-amber-500/10 text-amber-400 text-[10px]">Running</Badge>
                ) : bt.status === "failed" ? (
                  <Badge className="bg-red-500/10 text-red-400 text-[10px]">Failed</Badge>
                ) : null}
              </div>
              <div className="flex items-center gap-3 text-[11px] text-slate-500">
                <span>{config?.name || "Custom Strategy"}</span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {bt.startDate} - {bt.endDate}
                </span>
                {bt.winRate && (
                  <span>WR: {(Number(bt.winRate) * 100).toFixed(0)}%</span>
                )}
                {bt.totalTrades !== null && (
                  <span>{bt.totalTrades} trades</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
