"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bookmark, PlayCircle } from "lucide-react";

interface StrategyCardProps {
  strategy: {
    name: string;
    symbol: string;
    timeframe: string;
    entryConditions?: string[];
    exitConditions?: string[];
    stopLoss?: string;
    takeProfit?: string;
    riskLevel?: string;
    reasoning?: string;
    strategyConfig?: unknown;
  };
  onSave?: () => void;
  onBacktest?: () => void;
  isSaving?: boolean;
}

export function StrategyCard({ strategy, onSave, onBacktest, isSaving }: StrategyCardProps) {
  const riskColors: Record<string, string> = {
    conservative: "bg-emerald-500/10 text-emerald-400",
    moderate: "bg-amber-500/10 text-amber-400",
    aggressive: "bg-red-500/10 text-red-400",
  };

  const riskClass = strategy.riskLevel
    ? riskColors[strategy.riskLevel.toLowerCase()] || "bg-slate-500/10 text-slate-400"
    : "";

  return (
    <div className="mx-10 my-2 rounded-xl bg-gradient-to-br from-[#111827] to-[#0f1724] border border-emerald-500/10 p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-200">{strategy.name}</h4>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline" className="text-[10px]">
              {strategy.symbol}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {strategy.timeframe}
            </Badge>
            {strategy.riskLevel && (
              <Badge className={`text-[10px] ${riskClass}`}>
                {strategy.riskLevel}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {strategy.entryConditions && strategy.entryConditions.length > 0 && (
        <div className="mb-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
            Entry
          </p>
          <ul className="text-xs text-slate-400 space-y-0.5">
            {strategy.entryConditions.map((c, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-emerald-400" />
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      {strategy.exitConditions && strategy.exitConditions.length > 0 && (
        <div className="mb-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
            Exit
          </p>
          <ul className="text-xs text-slate-400 space-y-0.5">
            {strategy.exitConditions.map((c, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-red-400" />
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(strategy.stopLoss || strategy.takeProfit) && (
        <div className="flex gap-4 mb-2 text-xs">
          {strategy.stopLoss && (
            <span className="text-red-400">SL: {strategy.stopLoss}</span>
          )}
          {strategy.takeProfit && (
            <span className="text-emerald-400">TP: {strategy.takeProfit}</span>
          )}
        </div>
      )}

      {strategy.reasoning && (
        <p className="text-xs text-slate-500 mb-3 italic">{strategy.reasoning}</p>
      )}

      <div className="flex gap-2">
        {onSave && (
          <Button
            size="sm"
            variant="outline"
            onClick={onSave}
            disabled={isSaving}
            className="h-7 text-xs border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/10"
          >
            <Bookmark className="w-3 h-3 mr-1" />
            {isSaving ? "Saving..." : "Save Strategy"}
          </Button>
        )}
        {onBacktest && (
          <Button
            size="sm"
            variant="outline"
            onClick={onBacktest}
            className="h-7 text-xs border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/10"
          >
            <PlayCircle className="w-3 h-3 mr-1" />
            Run Backtest
          </Button>
        )}
      </div>
    </div>
  );
}
