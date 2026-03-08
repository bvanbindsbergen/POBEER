"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Grid3x3,
  Pause,
  Play,
  Square,
  TrendingUp,
  RefreshCw,
  Loader2,
} from "lucide-react";

interface GridStrategy {
  id: string;
  symbol: string;
  mode: "arithmetic" | "geometric";
  upperBound: number;
  lowerBound: number;
  gridCount: number;
  investmentAmount: number;
  status: "active" | "paused" | "stopped";
  tradingMode: "paper" | "live";
  totalPnl: number | null;
  completedCycles: number | null;
  activatedAt: string | null;
  stoppedAt: string | null;
  createdAt: string;
}

export function GridDashboard() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["grid-strategies"],
    queryFn: async () => {
      const res = await fetch("/api/grid-strategies");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json() as Promise<{ strategies: GridStrategy[] }>;
    },
    refetchInterval: 30_000,
  });

  const updateStrategy = useMutation({
    mutationFn: async ({
      id,
      action,
    }: {
      id: string;
      action: "pause" | "resume";
    }) => {
      const res = await fetch(`/api/grid-strategies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grid-strategies"] });
    },
  });

  const stopStrategy = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/grid-strategies/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to stop");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grid-strategies"] });
    },
  });

  const strategies = data?.strategies || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-5 h-5 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (strategies.length === 0) {
    return (
      <div className="rounded-xl bg-[#111827] border border-white/[0.06] p-8 text-center mt-4">
        <div className="w-12 h-12 rounded-2xl bg-violet-500/10 flex items-center justify-center mx-auto mb-4">
          <Grid3x3 className="w-6 h-6 text-violet-400" />
        </div>
        <h3 className="text-lg font-semibold text-slate-200 mb-1">No Grid Bots</h3>
        <p className="text-sm text-slate-500 max-w-md mx-auto">
          Create your first grid trading bot above to start automated range trading.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">Your Grid Bots</h3>
        <button
          onClick={() =>
            queryClient.invalidateQueries({ queryKey: ["grid-strategies"] })
          }
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        {strategies.map((s) => {
          const pnl = s.totalPnl || 0;
          const isPnlPositive = pnl >= 0;

          // Calculate grid levels for visualization
          const levels: number[] = [];
          if (s.mode === "arithmetic") {
            const step = (s.upperBound - s.lowerBound) / s.gridCount;
            for (let i = 0; i <= s.gridCount; i++) {
              levels.push(s.lowerBound + i * step);
            }
          } else {
            const ratio = Math.pow(s.upperBound / s.lowerBound, 1 / s.gridCount);
            for (let i = 0; i <= s.gridCount; i++) {
              levels.push(s.lowerBound * Math.pow(ratio, i));
            }
          }

          return (
            <div
              key={s.id}
              className="rounded-xl bg-[#111827] border border-white/[0.06] p-4"
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-slate-200">
                      {s.symbol}
                    </span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1.5 py-0 ${
                        s.tradingMode === "paper"
                          ? "border-cyan-500/30 text-cyan-400"
                          : "border-amber-500/30 text-amber-400"
                      }`}
                    >
                      {s.tradingMode}
                    </Badge>
                  </div>
                  <div className="flex gap-1.5 mt-1">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {s.mode}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {s.gridCount} grids
                    </Badge>
                  </div>
                </div>
                <Badge
                  className={`text-[10px] px-1.5 py-0 ${
                    s.status === "active"
                      ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                      : s.status === "paused"
                      ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                      : "bg-slate-500/20 text-slate-400 border-slate-500/30"
                  }`}
                >
                  {s.status}
                </Badge>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="bg-[#0d1117] rounded-lg p-2">
                  <div className="text-[10px] text-slate-500">Total PnL</div>
                  <div
                    className={`text-sm font-semibold ${
                      isPnlPositive ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {isPnlPositive ? "+" : ""}${pnl.toFixed(2)}
                  </div>
                </div>
                <div className="bg-[#0d1117] rounded-lg p-2">
                  <div className="text-[10px] text-slate-500">Cycles</div>
                  <div className="text-sm font-semibold text-slate-200">
                    {s.completedCycles || 0}
                  </div>
                </div>
              </div>

              {/* Price Range */}
              <div className="bg-[#0d1117] rounded-lg p-2 mb-3">
                <div className="text-[10px] text-slate-500 mb-1">Price Range</div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-emerald-400 font-mono">
                    ${s.lowerBound.toFixed(s.lowerBound >= 100 ? 2 : 4)}
                  </span>
                  <div className="flex-1 mx-2 h-1 rounded-full bg-slate-800 relative overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500/50 to-violet-500/50 rounded-full"
                      style={{ width: "100%" }}
                    />
                  </div>
                  <span className="text-violet-400 font-mono">
                    ${s.upperBound.toFixed(s.upperBound >= 100 ? 2 : 4)}
                  </span>
                </div>

                {/* Grid Level Visualization */}
                <div className="mt-2 flex gap-[1px]">
                  {levels.slice(0, 30).map((_, idx) => (
                    <div
                      key={idx}
                      className="flex-1 h-1.5 rounded-sm bg-violet-500/20"
                    />
                  ))}
                  {levels.length > 30 && (
                    <span className="text-[8px] text-slate-600 ml-1">
                      +{levels.length - 30}
                    </span>
                  )}
                </div>
              </div>

              {/* Investment */}
              <div className="flex items-center justify-between text-xs text-slate-500 mb-3">
                <span>Investment</span>
                <span className="text-slate-300">${s.investmentAmount.toFixed(2)}</span>
              </div>

              {/* Controls */}
              {s.status !== "stopped" && (
                <div className="flex gap-2">
                  {s.status === "active" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        updateStrategy.mutate({ id: s.id, action: "pause" })
                      }
                      disabled={updateStrategy.isPending}
                      className="h-7 text-xs border-amber-500/20 text-amber-400 hover:bg-amber-500/10 flex-1"
                    >
                      <Pause className="w-3 h-3 mr-1" />
                      Pause
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        updateStrategy.mutate({ id: s.id, action: "resume" })
                      }
                      disabled={updateStrategy.isPending}
                      className="h-7 text-xs border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/10 flex-1"
                    >
                      <Play className="w-3 h-3 mr-1" />
                      Resume
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => stopStrategy.mutate(s.id)}
                    disabled={stopStrategy.isPending}
                    className="h-7 text-xs border-red-500/20 text-red-400 hover:bg-red-500/10"
                  >
                    <Square className="w-3 h-3 mr-1" />
                    Stop
                  </Button>
                </div>
              )}

              {/* Created date */}
              <p className="text-[10px] text-slate-600 mt-2">
                {new Date(s.createdAt).toLocaleDateString()}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
