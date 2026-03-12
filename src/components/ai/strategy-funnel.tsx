"use client";

import { useState, useMemo, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  FlaskConical,
  Trophy,
  Loader2,
  ChevronRight,
  Save,
  Zap,
  ArrowUpDown,
  CheckSquare,
  Square,
  Brain,
  Cpu,
} from "lucide-react";
import type { GeneratedStrategy } from "@/lib/ai/funnel/generator";

interface FunnelSignal {
  symbol: string;
  signals: string[];
  currentPrice: number;
}

interface BacktestMetrics {
  totalPnl: number;
  winRate: number;
  maxDrawdown: number;
  sharpeRatio: number;
  profitFactor: number;
  totalTrades: number;
}

interface FunnelResult {
  strategy: GeneratedStrategy;
  metrics: BacktestMetrics;
}

type SortField = "totalPnl" | "winRate" | "sharpeRatio" | "maxDrawdown" | "profitFactor" | "totalTrades";

const SL_PRESETS = {
  Conservative: [2, 3, 5],
  Moderate: [3, 5, 8],
  Aggressive: [5, 8, 12],
};

const TP_PRESETS = {
  Conservative: [3, 5, 8],
  Moderate: [5, 8, 12],
  Aggressive: [8, 12, 15, 20],
};

export function StrategyFunnel({
  initialSignals,
  onActivate,
}: {
  initialSignals?: FunnelSignal[];
  onActivate?: (source: {
    id: string;
    name: string;
    symbol: string;
    timeframe: string;
    strategyConfig: string | object;
    sourceType: "strategy" | "backtest";
  }) => void;
}) {
  // Stage tracking
  const [stage, setStage] = useState<1 | 2 | 3>(1);

  // Mode: algorithmic (free) or ai (Claude-powered)
  const [mode, setMode] = useState<"algo" | "ai">("algo");

  // Stage 1 config (shared)
  const [timeframe, setTimeframe] = useState("1h");
  const [minProfitPercent, setMinProfitPercent] = useState(5);

  // Algorithmic mode config
  const [maxStrategies, setMaxStrategies] = useState(1000);
  const [slPreset, setSlPreset] = useState<keyof typeof SL_PRESETS>("Moderate");
  const [tpPreset, setTpPreset] = useState<keyof typeof TP_PRESETS>("Moderate");
  const [useScanner, setUseScanner] = useState(!initialSignals?.length);

  // AI mode config
  const [aiCount, setAiCount] = useState(10);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiCost, setAiCost] = useState<{ inputTokens: number; outputTokens: number; estimatedCost: number } | null>(null);

  const positionSizePercent = 10; // fixed default

  // Stage 2 state
  const [generated, setGenerated] = useState<GeneratedStrategy[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [daysBack, setDaysBack] = useState(90);

  // Stage 3 state
  const [results, setResults] = useState<FunnelResult[]>([]);
  const [batchStats, setBatchStats] = useState<{
    totalTested: number;
    totalPassed: number;
    executionTimeMs: number;
  } | null>(null);
  const [sortField, setSortField] = useState<SortField>("totalPnl");
  const [sortAsc, setSortAsc] = useState(false);

  // Generate mutation
  const generateMutation = useMutation({
    mutationFn: async () => {
      let signals = initialSignals || [];

      // If using scanner, fetch signals first
      if (useScanner && !initialSignals?.length) {
        const scanRes = await fetch(`/api/ai/screener/market?timeframe=${timeframe}`);
        if (!scanRes.ok) throw new Error("Scanner failed");
        const scanData = await scanRes.json();
        signals = (scanData.signals || []).map((s: { symbol: string; signals: string[]; currentPrice: number }) => ({
          symbol: s.symbol,
          signals: s.signals,
          currentPrice: s.currentPrice,
        }));
      }

      if (!signals.length) throw new Error("No signals available");

      const res = await fetch("/api/ai/funnel/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signals,
          timeframe,
          maxStrategies,
          slRange: SL_PRESETS[slPreset],
          tpRange: TP_PRESETS[tpPreset],
          minProfitPercent,
          positionSizePercent,
        }),
      });
      if (!res.ok) throw new Error("Generation failed");
      return res.json();
    },
    onSuccess: (data) => {
      setGenerated(data.strategies);
      setSelected(new Set(data.strategies.map((s: GeneratedStrategy) => s.id)));
      setStage(2);
    },
  });

  // AI generate mutation
  const aiGenerateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ai/funnel/generate-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          count: aiCount,
          prompt: aiPrompt,
          timeframe,
          positionSizePercent,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "AI generation failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setGenerated(data.strategies);
      setSelected(new Set(data.strategies.map((s: GeneratedStrategy) => s.id)));
      setAiCost(data.tokenUsage || null);
      setStage(2);
    },
  });

  // Backtest mutation
  const backtestMutation = useMutation({
    mutationFn: async () => {
      const selectedStrategies = generated.filter((s) => selected.has(s.id));
      const res = await fetch("/api/ai/funnel/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategies: selectedStrategies,
          daysBack,
          minProfitPercent,
          timeframe,
        }),
      });
      if (!res.ok) throw new Error("Batch backtest failed");
      return res.json();
    },
    onSuccess: (data) => {
      setResults(data.results);
      setBatchStats({
        totalTested: data.totalTested,
        totalPassed: data.totalPassed,
        executionTimeMs: data.executionTimeMs,
      });
      setStage(3);
    },
  });

  // Save strategy
  const saveMutation = useMutation({
    mutationFn: async (result: FunnelResult) => {
      const res = await fetch("/api/ai/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: result.strategy.name,
          symbol: result.strategy.symbol,
          timeframe,
          strategyConfig: JSON.stringify(result.strategy.strategyConfig),
          notes: `Funnel result: PnL ${result.metrics.totalPnl.toFixed(1)}%, WR ${result.metrics.winRate.toFixed(0)}%, Sharpe ${result.metrics.sharpeRatio.toFixed(2)}`,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      return res.json();
    },
  });

  // Selection helpers
  const toggleAll = useCallback(() => {
    if (selected.size === generated.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(generated.map((s) => s.id)));
    }
  }, [selected.size, generated]);

  const toggleBySymbol = useCallback(
    (symbol: string) => {
      const symbolIds = generated.filter((s) => s.symbol === symbol).map((s) => s.id);
      const allSelected = symbolIds.every((id) => selected.has(id));
      const next = new Set(selected);
      for (const id of symbolIds) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      setSelected(next);
    },
    [generated, selected]
  );

  const toggleByTag = useCallback(
    (tag: string) => {
      const tagIds = generated.filter((s) => s.tags.includes(tag)).map((s) => s.id);
      const allSelected = tagIds.every((id) => selected.has(id));
      const next = new Set(selected);
      for (const id of tagIds) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      setSelected(next);
    },
    [generated, selected]
  );

  // Unique symbols and tags for filter buttons
  const uniqueSymbols = useMemo(
    () => [...new Set(generated.map((s) => s.symbol))],
    [generated]
  );
  const uniqueTags = useMemo(
    () => [...new Set(generated.flatMap((s) => s.tags).filter((t) => !t.startsWith("sl") && !t.startsWith("tp")))],
    [generated]
  );

  // Sorted results
  const sortedResults = useMemo(() => {
    const sorted = [...results].sort((a, b) => {
      const av = a.metrics[sortField];
      const bv = b.metrics[sortField];
      return sortAsc ? av - bv : bv - av;
    });
    return sorted;
  }, [results, sortField, sortAsc]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Stage indicator */}
      <div className="flex items-center gap-2 text-xs">
        <button
          onClick={() => setStage(1)}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-full transition-colors ${
            stage === 1
              ? "bg-emerald-500/20 text-emerald-400"
              : "bg-slate-800 text-slate-500 hover:text-slate-300"
          }`}
        >
          <Sparkles className="w-3 h-3" />
          1. Generate
        </button>
        <ChevronRight className="w-3 h-3 text-slate-600" />
        <button
          onClick={() => generated.length > 0 ? setStage(2) : null}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-full transition-colors ${
            stage === 2
              ? "bg-cyan-500/20 text-cyan-400"
              : generated.length > 0
                ? "bg-slate-800 text-slate-500 hover:text-slate-300"
                : "bg-slate-800/50 text-slate-700 cursor-not-allowed"
          }`}
        >
          <CheckSquare className="w-3 h-3" />
          2. Select
        </button>
        <ChevronRight className="w-3 h-3 text-slate-600" />
        <button
          onClick={() => results.length > 0 ? setStage(3) : null}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-full transition-colors ${
            stage === 3
              ? "bg-amber-500/20 text-amber-400"
              : results.length > 0
                ? "bg-slate-800 text-slate-500 hover:text-slate-300"
                : "bg-slate-800/50 text-slate-700 cursor-not-allowed"
          }`}
        >
          <Trophy className="w-3 h-3" />
          3. Results
        </button>
      </div>

      {/* STAGE 1: Configure & Generate */}
      {stage === 1 && (
        <div className="rounded-xl bg-[#111827] border border-white/[0.06] p-4 space-y-4">
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            Configure Strategy Generation
          </h3>

          {/* Mode toggle */}
          <div className="flex gap-1 p-0.5 rounded-lg bg-[#0d1117] border border-white/[0.06] w-fit">
            <button
              onClick={() => setMode("algo")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                mode === "algo"
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              Algorithmic
              <span className="text-[9px] opacity-60">FREE</span>
            </button>
            <button
              onClick={() => setMode("ai")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                mode === "ai"
                  ? "bg-violet-500/15 text-violet-400"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <Brain className="w-3.5 h-3.5" />
              AI (Claude)
              <span className="text-[9px] opacity-60">~$0.01-0.05</span>
            </button>
          </div>

          {/* Shared config */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">Timeframe</label>
              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
                className="w-full rounded bg-[#0d1117] border border-white/[0.08] px-2 py-1.5 text-xs text-slate-300"
              >
                {["15m", "1h", "4h", "1d"].map((tf) => (
                  <option key={tf} value={tf}>{tf}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[11px] text-slate-500 block mb-1">Min Total Return %</label>
              <input
                type="number"
                value={minProfitPercent}
                onChange={(e) => setMinProfitPercent(Number(e.target.value))}
                min={0}
                step={1}
                className="w-full rounded bg-[#0d1117] border border-white/[0.08] px-2 py-1.5 text-xs text-slate-300"
              />
            </div>
          </div>

          {/* Algorithmic mode options */}
          {mode === "algo" && (
            <div className="space-y-3">
              {initialSignals?.length ? (
                <div className="text-xs text-slate-400">
                  Using {initialSignals.length} coin{initialSignals.length > 1 ? "s" : ""} from scanner:{" "}
                  {initialSignals.map((s) => s.symbol.replace("/USDT", "")).join(", ")}
                </div>
              ) : (
                <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useScanner}
                    onChange={(e) => setUseScanner(e.target.checked)}
                    className="rounded border-slate-600"
                  />
                  Use Market Scanner signals (auto-fetch)
                </label>
              )}

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-[11px] text-slate-500 block mb-1">
                    Max Strategies: {maxStrategies}
                  </label>
                  <input
                    type="range"
                    min={100}
                    max={5000}
                    step={100}
                    value={maxStrategies}
                    onChange={(e) => setMaxStrategies(Number(e.target.value))}
                    className="w-full accent-emerald-500"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-slate-500 block mb-1">SL Range</label>
                  <select
                    value={slPreset}
                    onChange={(e) => setSlPreset(e.target.value as keyof typeof SL_PRESETS)}
                    className="w-full rounded bg-[#0d1117] border border-white/[0.08] px-2 py-1.5 text-xs text-slate-300"
                  >
                    {Object.entries(SL_PRESETS).map(([name, vals]) => (
                      <option key={name} value={name}>{name} [{vals.join(",")}%]</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] text-slate-500 block mb-1">TP Range</label>
                  <select
                    value={tpPreset}
                    onChange={(e) => setTpPreset(e.target.value as keyof typeof TP_PRESETS)}
                    className="w-full rounded bg-[#0d1117] border border-white/[0.08] px-2 py-1.5 text-xs text-slate-300"
                  >
                    {Object.entries(TP_PRESETS).map(([name, vals]) => (
                      <option key={name} value={name}>{name} [{vals.join(",")}%]</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* AI mode options */}
          {mode === "ai" && (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-slate-500 block mb-1">
                  Number of strategies: {aiCount}
                </label>
                <input
                  type="range"
                  min={5}
                  max={30}
                  step={5}
                  value={aiCount}
                  onChange={(e) => setAiCount(Number(e.target.value))}
                  className="w-full accent-violet-500"
                />
                <div className="flex justify-between text-[9px] text-slate-600 mt-0.5">
                  <span>5</span>
                  <span>~${(aiCount * 0.003).toFixed(3)} estimated</span>
                  <span>30</span>
                </div>
              </div>

              <div>
                <label className="text-[11px] text-slate-500 block mb-1">
                  Your instructions <span className="text-slate-600">(optional — guide what Claude generates)</span>
                </label>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="e.g. Focus on SOL and ETH. I prefer momentum strategies with tight stop losses. Avoid DOGE. Look for RSI divergence setups..."
                  rows={3}
                  className="w-full rounded bg-[#0d1117] border border-white/[0.08] px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:border-violet-500/30 focus:outline-none resize-none"
                />
              </div>

              {aiCost && (
                <div className="text-[10px] text-slate-500">
                  Last generation: {aiCost.inputTokens + aiCost.outputTokens} tokens (${aiCost.estimatedCost.toFixed(4)})
                </div>
              )}
            </div>
          )}

          {/* Generate button */}
          {mode === "algo" ? (
            <Button
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {generateMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Cpu className="w-4 h-4 mr-2" />
              )}
              Generate {maxStrategies} Ideas
            </Button>
          ) : (
            <Button
              onClick={() => aiGenerateMutation.mutate()}
              disabled={aiGenerateMutation.isPending}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              {aiGenerateMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Brain className="w-4 h-4 mr-2" />
              )}
              Generate {aiCount} AI Strategies
            </Button>
          )}

          {generateMutation.isError && (
            <p className="text-xs text-red-400">
              Failed to generate strategies. {(generateMutation.error as Error)?.message}
            </p>
          )}
          {aiGenerateMutation.isError && (
            <p className="text-xs text-red-400">
              AI generation failed. {(aiGenerateMutation.error as Error)?.message}
            </p>
          )}
        </div>
      )}

      {/* STAGE 2: Select */}
      {stage === 2 && (
        <div className="rounded-xl bg-[#111827] border border-white/[0.06] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-cyan-400" />
              Select Strategies to Backtest
            </h3>
            <span className="text-xs text-slate-400">
              <span className="text-cyan-400 font-medium">{selected.size}</span> of {generated.length} selected
            </span>
          </div>

          {/* Filter buttons */}
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={toggleAll}
              className="text-[10px] px-2 py-0.5 rounded bg-slate-700/50 text-slate-400 hover:text-slate-200 transition-colors"
            >
              {selected.size === generated.length ? "Deselect All" : "Select All"}
            </button>
            {uniqueSymbols.map((symbol) => (
              <button
                key={symbol}
                onClick={() => toggleBySymbol(symbol)}
                className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors"
              >
                {symbol.replace("/USDT", "")}
              </button>
            ))}
            {uniqueTags.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleByTag(tag)}
                className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
              >
                {tag}
              </button>
            ))}
          </div>

          {/* Strategy table */}
          <div className="max-h-80 overflow-y-auto rounded-lg border border-white/[0.04]">
            <table className="w-full text-xs">
              <thead className="bg-[#0d1117] sticky top-0">
                <tr className="text-slate-500">
                  <th className="text-left p-2 w-8">
                    <button onClick={toggleAll}>
                      {selected.size === generated.length ? (
                        <CheckSquare className="w-3.5 h-3.5 text-cyan-400" />
                      ) : (
                        <Square className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </th>
                  <th className="text-left p-2">Name</th>
                  <th className="text-left p-2">Symbol</th>
                  <th className="text-left p-2">Entry</th>
                  <th className="text-left p-2">SL%</th>
                  <th className="text-left p-2">TP%</th>
                  <th className="text-left p-2">Tags</th>
                </tr>
              </thead>
              <tbody>
                {generated.map((s) => (
                  <tr
                    key={s.id}
                    className={`border-t border-white/[0.03] hover:bg-white/[0.02] cursor-pointer ${
                      selected.has(s.id) ? "bg-cyan-500/5" : ""
                    }`}
                    onClick={() => {
                      const next = new Set(selected);
                      if (next.has(s.id)) next.delete(s.id);
                      else next.add(s.id);
                      setSelected(next);
                    }}
                  >
                    <td className="p-2">
                      {selected.has(s.id) ? (
                        <CheckSquare className="w-3.5 h-3.5 text-cyan-400" />
                      ) : (
                        <Square className="w-3.5 h-3.5 text-slate-600" />
                      )}
                    </td>
                    <td className="p-2 text-slate-300 font-medium truncate max-w-[200px]">{s.name}</td>
                    <td className="p-2 text-slate-400">{s.symbol.replace("/USDT", "")}</td>
                    <td className="p-2 text-slate-500 truncate max-w-[120px]">{s.sourceSignal}</td>
                    <td className="p-2 text-red-400">{s.strategyConfig.stopLossPercent}%</td>
                    <td className="p-2 text-emerald-400">{s.strategyConfig.takeProfitPercent}%</td>
                    <td className="p-2">
                      <div className="flex gap-1">
                        {s.tags.filter((t) => !t.startsWith("sl") && !t.startsWith("tp")).map((t) => (
                          <Badge key={t} variant="outline" className="text-[9px] px-1 py-0">{t}</Badge>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Backtest controls */}
          <div className="flex items-center gap-3">
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">Backtest Period (days)</label>
              <input
                type="number"
                value={daysBack}
                onChange={(e) => setDaysBack(Number(e.target.value))}
                min={7}
                max={365}
                className="w-24 rounded bg-[#0d1117] border border-white/[0.08] px-2 py-1.5 text-xs text-slate-300"
              />
            </div>

            <Button
              onClick={() => backtestMutation.mutate()}
              disabled={backtestMutation.isPending || selected.size === 0}
              className="bg-cyan-600 hover:bg-cyan-700 text-white mt-4"
            >
              {backtestMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <FlaskConical className="w-4 h-4 mr-2" />
              )}
              Backtest {selected.size} Selected
            </Button>
          </div>

          {backtestMutation.isPending && (
            <div className="space-y-2">
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-cyan-500 rounded-full animate-pulse" style={{ width: "60%" }} />
              </div>
              <p className="text-[10px] text-slate-500">
                Running batch backtests... This may take a moment for large batches.
              </p>
            </div>
          )}
        </div>
      )}

      {/* STAGE 3: Results */}
      {stage === 3 && batchStats && (
        <div className="rounded-xl bg-[#111827] border border-white/[0.06] p-4 space-y-3">
          {/* Summary header */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-400" />
              Funnel Results
            </h3>
            <span className="text-[10px] text-slate-500">
              {(batchStats.executionTimeMs / 1000).toFixed(1)}s
            </span>
          </div>

          <div className="flex flex-wrap gap-3 text-xs">
            <div className="px-3 py-1.5 rounded-lg bg-cyan-500/10">
              <span className="text-slate-500">Tested: </span>
              <span className="text-cyan-400 font-medium">{batchStats.totalTested}</span>
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-emerald-500/10">
              <span className="text-slate-500">Passed {minProfitPercent}%: </span>
              <span className="text-emerald-400 font-medium">{batchStats.totalPassed}</span>
            </div>
            {sortedResults.length > 0 && (
              <div className="px-3 py-1.5 rounded-lg bg-amber-500/10">
                <span className="text-slate-500">Top: </span>
                <span className="text-amber-400 font-medium">
                  +{sortedResults[0].metrics.totalPnl.toFixed(1)}%
                </span>
              </div>
            )}
          </div>

          {sortedResults.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-slate-500">No strategies passed the {minProfitPercent}% profit filter.</p>
              <p className="text-[11px] text-slate-600 mt-1">Try lowering the minimum profit threshold or adjusting parameters.</p>
              <Button
                onClick={() => setStage(1)}
                variant="outline"
                size="sm"
                className="mt-3 text-xs border-white/[0.08] text-slate-400"
              >
                Back to Configure
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-white/[0.04]">
              <table className="w-full text-xs">
                <thead className="bg-[#0d1117]">
                  <tr className="text-slate-500">
                    <th className="text-left p-2">Name</th>
                    <th className="text-left p-2">Symbol</th>
                    <SortHeader field="totalPnl" label="PnL%" current={sortField} asc={sortAsc} onClick={handleSort} />
                    <SortHeader field="winRate" label="Win%" current={sortField} asc={sortAsc} onClick={handleSort} />
                    <SortHeader field="sharpeRatio" label="Sharpe" current={sortField} asc={sortAsc} onClick={handleSort} />
                    <SortHeader field="maxDrawdown" label="DD%" current={sortField} asc={sortAsc} onClick={handleSort} />
                    <SortHeader field="profitFactor" label="PF" current={sortField} asc={sortAsc} onClick={handleSort} />
                    <SortHeader field="totalTrades" label="Trades" current={sortField} asc={sortAsc} onClick={handleSort} />
                    <th className="text-left p-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedResults.map((r, i) => (
                    <tr
                      key={r.strategy.id}
                      className={`border-t border-white/[0.03] hover:bg-white/[0.02] ${
                        i < 3 ? "bg-amber-500/5" : ""
                      }`}
                    >
                      <td className="p-2 text-slate-300 font-medium truncate max-w-[200px]">
                        {i < 3 && <span className="text-amber-400 mr-1">#{i + 1}</span>}
                        {r.strategy.name}
                      </td>
                      <td className="p-2 text-slate-400">{r.strategy.symbol.replace("/USDT", "")}</td>
                      <td className={`p-2 font-medium ${r.metrics.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {r.metrics.totalPnl >= 0 ? "+" : ""}{r.metrics.totalPnl.toFixed(1)}%
                      </td>
                      <td className="p-2 text-slate-300">{r.metrics.winRate.toFixed(0)}%</td>
                      <td className="p-2 text-slate-300">{r.metrics.sharpeRatio.toFixed(2)}</td>
                      <td className="p-2 text-red-400">{r.metrics.maxDrawdown.toFixed(1)}%</td>
                      <td className="p-2 text-slate-300">{r.metrics.profitFactor.toFixed(2)}</td>
                      <td className="p-2 text-slate-400">{r.metrics.totalTrades}</td>
                      <td className="p-2">
                        <div className="flex gap-1">
                          <button
                            onClick={() => saveMutation.mutate(r)}
                            className="p-1 rounded text-slate-500 hover:text-emerald-400 transition-colors"
                            title="Save Strategy"
                          >
                            <Save className="w-3.5 h-3.5" />
                          </button>
                          {onActivate && (
                            <button
                              onClick={() =>
                                onActivate({
                                  id: r.strategy.id,
                                  name: r.strategy.name,
                                  symbol: r.strategy.symbol,
                                  timeframe,
                                  strategyConfig: r.strategy.strategyConfig,
                                  sourceType: "strategy",
                                })
                              }
                              className="p-1 rounded text-slate-500 hover:text-amber-400 transition-colors"
                              title="Activate"
                            >
                              <Zap className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SortHeader({
  field,
  label,
  current,
  asc,
  onClick,
}: {
  field: SortField;
  label: string;
  current: SortField;
  asc: boolean;
  onClick: (field: SortField) => void;
}) {
  return (
    <th className="text-left p-2">
      <button
        onClick={() => onClick(field)}
        className={`flex items-center gap-0.5 hover:text-slate-300 transition-colors ${
          current === field ? "text-cyan-400" : ""
        }`}
      >
        {label}
        {current === field && (
          <ArrowUpDown className="w-3 h-3" style={{ transform: asc ? "scaleY(-1)" : undefined }} />
        )}
      </button>
    </th>
  );
}
