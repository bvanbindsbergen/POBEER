"use client";

import { useState, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Grid3x3, Plus, Loader2 } from "lucide-react";

const POPULAR_PAIRS = [
  "BTC/USDT",
  "ETH/USDT",
  "SOL/USDT",
  "BNB/USDT",
  "XRP/USDT",
  "DOGE/USDT",
  "ADA/USDT",
  "AVAX/USDT",
  "MATIC/USDT",
  "LINK/USDT",
];

interface GridStrategyFormProps {
  onCreated?: () => void;
}

export function GridStrategyForm({ onCreated }: GridStrategyFormProps) {
  const [symbol, setSymbol] = useState("BTC/USDT");
  const [upperBound, setUpperBound] = useState("");
  const [lowerBound, setLowerBound] = useState("");
  const [gridCount, setGridCount] = useState(10);
  const [investmentAmount, setInvestmentAmount] = useState("");
  const [mode, setMode] = useState<"arithmetic" | "geometric">("arithmetic");
  const [tradingMode, setTradingMode] = useState<"paper" | "live">("paper");
  const [showPreview, setShowPreview] = useState(false);

  const gridLevels = useMemo(() => {
    const lower = Number(lowerBound);
    const upper = Number(upperBound);
    if (!lower || !upper || upper <= lower || gridCount < 2) return [];

    const levels: number[] = [];
    if (mode === "arithmetic") {
      const step = (upper - lower) / gridCount;
      for (let i = 0; i <= gridCount; i++) {
        levels.push(lower + i * step);
      }
    } else {
      const ratio = Math.pow(upper / lower, 1 / gridCount);
      for (let i = 0; i <= gridCount; i++) {
        levels.push(lower * Math.pow(ratio, i));
      }
    }
    return levels;
  }, [lowerBound, upperBound, gridCount, mode]);

  const createGrid = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/grid-strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          mode,
          upperBound: Number(upperBound),
          lowerBound: Number(lowerBound),
          gridCount,
          investmentAmount: Number(investmentAmount),
          tradingMode,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create grid strategy");
      }
      return res.json();
    },
    onSuccess: () => {
      setUpperBound("");
      setLowerBound("");
      setInvestmentAmount("");
      setGridCount(10);
      setShowPreview(false);
      onCreated?.();
    },
  });

  const profitPerGrid = useMemo(() => {
    if (gridLevels.length < 2) return 0;
    const avgStep = (gridLevels[gridLevels.length - 1] - gridLevels[0]) / gridCount;
    const avgPrice = (gridLevels[0] + gridLevels[gridLevels.length - 1]) / 2;
    return (avgStep / avgPrice) * 100;
  }, [gridLevels, gridCount]);

  return (
    <div className="rounded-xl bg-[#111827] border border-white/[0.06] p-4">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-1.5 rounded-lg bg-violet-500/10">
          <Grid3x3 className="w-4 h-4 text-violet-400" />
        </div>
        <h3 className="text-sm font-semibold text-slate-200">Create Grid Bot</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Symbol */}
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Trading Pair</label>
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="w-full rounded-lg bg-[#0d1117] border border-white/[0.06] text-sm text-slate-200 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
          >
            {POPULAR_PAIRS.map((pair) => (
              <option key={pair} value={pair}>
                {pair}
              </option>
            ))}
          </select>
        </div>

        {/* Mode Toggle */}
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Grid Mode</label>
          <div className="flex gap-2">
            <button
              onClick={() => setMode("arithmetic")}
              className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors ${
                mode === "arithmetic"
                  ? "bg-violet-500/10 border-violet-500/30 text-violet-400"
                  : "bg-[#0d1117] border-white/[0.06] text-slate-400 hover:text-slate-200"
              }`}
            >
              Arithmetic
            </button>
            <button
              onClick={() => setMode("geometric")}
              className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors ${
                mode === "geometric"
                  ? "bg-violet-500/10 border-violet-500/30 text-violet-400"
                  : "bg-[#0d1117] border-white/[0.06] text-slate-400 hover:text-slate-200"
              }`}
            >
              Geometric
            </button>
          </div>
        </div>

        {/* Upper Bound */}
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Upper Price ($)</label>
          <input
            type="number"
            value={upperBound}
            onChange={(e) => setUpperBound(e.target.value)}
            placeholder="e.g. 70000"
            className="w-full rounded-lg bg-[#0d1117] border border-white/[0.06] text-sm text-slate-200 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-500/50 placeholder:text-slate-600"
          />
        </div>

        {/* Lower Bound */}
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Lower Price ($)</label>
          <input
            type="number"
            value={lowerBound}
            onChange={(e) => setLowerBound(e.target.value)}
            placeholder="e.g. 60000"
            className="w-full rounded-lg bg-[#0d1117] border border-white/[0.06] text-sm text-slate-200 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-500/50 placeholder:text-slate-600"
          />
        </div>

        {/* Grid Count */}
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">
            Grid Count: <span className="text-slate-200">{gridCount}</span>
          </label>
          <input
            type="range"
            min={5}
            max={50}
            value={gridCount}
            onChange={(e) => setGridCount(Number(e.target.value))}
            className="w-full accent-violet-500"
          />
          <div className="flex justify-between text-[10px] text-slate-600 mt-1">
            <span>5</span>
            <span>50</span>
          </div>
        </div>

        {/* Investment Amount */}
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Investment (USDT)</label>
          <input
            type="number"
            value={investmentAmount}
            onChange={(e) => setInvestmentAmount(e.target.value)}
            placeholder="e.g. 1000"
            className="w-full rounded-lg bg-[#0d1117] border border-white/[0.06] text-sm text-slate-200 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-500/50 placeholder:text-slate-600"
          />
        </div>

        {/* Trading Mode */}
        <div className="md:col-span-2">
          <label className="block text-xs text-slate-400 mb-1.5">Trading Mode</label>
          <div className="flex gap-2">
            <button
              onClick={() => setTradingMode("paper")}
              className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors ${
                tradingMode === "paper"
                  ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-400"
                  : "bg-[#0d1117] border-white/[0.06] text-slate-400 hover:text-slate-200"
              }`}
            >
              Paper Trading
            </button>
            <button
              onClick={() => setTradingMode("live")}
              className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors ${
                tradingMode === "live"
                  ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                  : "bg-[#0d1117] border-white/[0.06] text-slate-400 hover:text-slate-200"
              }`}
            >
              Live Trading
            </button>
          </div>
        </div>
      </div>

      {/* Grid Preview */}
      {gridLevels.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="text-xs text-violet-400 hover:text-violet-300 transition-colors mb-2"
          >
            {showPreview ? "Hide" : "Show"} Grid Preview ({gridLevels.length} levels)
          </button>

          {showPreview && (
            <div className="bg-[#0d1117] rounded-lg border border-white/[0.06] p-3 max-h-48 overflow-y-auto">
              <div className="flex items-center justify-between text-[10px] text-slate-500 mb-2">
                <span>Level</span>
                <span>Price</span>
              </div>
              {gridLevels
                .slice()
                .reverse()
                .map((level, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between py-0.5 border-b border-white/[0.03] last:border-0"
                  >
                    <span className="text-[10px] text-slate-500">
                      #{gridLevels.length - idx}
                    </span>
                    <span className="text-xs text-slate-300 font-mono">
                      ${level.toFixed(level >= 100 ? 2 : level >= 1 ? 4 : 6)}
                    </span>
                  </div>
                ))}
            </div>
          )}

          {profitPerGrid > 0 && (
            <div className="flex gap-3 mt-2 text-[10px] text-slate-500">
              <span>
                Profit/grid: <span className="text-emerald-400">{profitPerGrid.toFixed(2)}%</span>
              </span>
              <span>
                Per level: <span className="text-slate-300">
                  ${(Number(investmentAmount || 0) / gridCount).toFixed(2)}
                </span>
              </span>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {createGrid.isError && (
        <div className="mt-3 rounded-lg bg-red-500/10 border border-red-500/20 p-2 text-xs text-red-400">
          {createGrid.error instanceof Error ? createGrid.error.message : "Failed to create grid bot"}
        </div>
      )}

      {/* Submit */}
      <div className="mt-4 flex justify-end">
        <Button
          onClick={() => createGrid.mutate()}
          disabled={
            createGrid.isPending ||
            !upperBound ||
            !lowerBound ||
            !investmentAmount ||
            Number(upperBound) <= Number(lowerBound)
          }
          className="bg-violet-600 hover:bg-violet-700 text-white text-sm"
          size="sm"
        >
          {createGrid.isPending ? (
            <>
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Create Grid Bot
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
