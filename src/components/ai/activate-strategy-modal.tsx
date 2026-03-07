"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Zap, AlertTriangle, Loader2, DollarSign, Percent, Shield } from "lucide-react";

interface ActivateStrategyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: {
    id: string;
    name: string;
    symbol: string;
    timeframe: string;
    strategyConfig: string | object;
    sourceType: "strategy" | "backtest";
    // Backtest metrics (optional)
    totalPnl?: number | string;
    winRate?: number | string;
    sharpeRatio?: number | string;
  } | null;
}

export function ActivateStrategyModal({
  open,
  onOpenChange,
  source,
}: ActivateStrategyModalProps) {
  const [maxCapUsd, setMaxCapUsd] = useState(500);
  const [maxCapPercent, setMaxCapPercent] = useState(10);
  const [dailyLossLimitUsd, setDailyLossLimitUsd] = useState(100);
  const queryClient = useQueryClient();

  const activate = useMutation({
    mutationFn: async () => {
      if (!source) throw new Error("No source");
      const res = await fetch(`/api/ai/strategies/${source.id}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maxCapUsd,
          maxCapPercent,
          dailyLossLimitUsd,
          sourceType: source.sourceType,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Activation failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["operational-strategies"] });
      onOpenChange(false);
    },
  });

  if (!source) return null;

  const config =
    typeof source.strategyConfig === "string"
      ? (() => {
          try {
            return JSON.parse(source.strategyConfig);
          } catch {
            return null;
          }
        })()
      : source.strategyConfig;

  const pnl = source.totalPnl != null ? Number(source.totalPnl) : null;
  const winRate = source.winRate != null ? Number(source.winRate) : null;
  const sharpe = source.sharpeRatio != null ? Number(source.sharpeRatio) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0a0f1a] border-white/[0.08] text-slate-200 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-100">
            <Zap className="w-5 h-5 text-amber-400" />
            Activate Strategy
          </DialogTitle>
          <DialogDescription className="text-slate-500">
            Deploy this strategy for live auto-trading on ByBit
          </DialogDescription>
        </DialogHeader>

        {/* Strategy Summary */}
        <div className="rounded-lg bg-[#111827] border border-white/[0.06] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-200">{source.name}</span>
            <div className="flex gap-1.5">
              <Badge variant="outline" className="text-[10px]">{source.symbol}</Badge>
              <Badge variant="outline" className="text-[10px]">{source.timeframe}</Badge>
            </div>
          </div>
          {config && (
            <div className="text-[11px] text-slate-500">
              {config.entryConditions?.length || 0} entry conditions, {config.exitConditions?.length || 0} exit conditions
              {config.stopLossPercent && ` | SL: ${config.stopLossPercent}%`}
              {config.takeProfitPercent && ` | TP: ${config.takeProfitPercent}%`}
            </div>
          )}
        </div>

        {/* Backtest Metrics */}
        {pnl !== null && (
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-[#111827] border border-white/[0.06] p-2 text-center">
              <div className="text-[10px] text-slate-500 uppercase">P&L</div>
              <div className={`text-sm font-semibold ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                ${pnl.toFixed(2)}
              </div>
            </div>
            {winRate !== null && (
              <div className="rounded-lg bg-[#111827] border border-white/[0.06] p-2 text-center">
                <div className="text-[10px] text-slate-500 uppercase">Win Rate</div>
                <div className="text-sm font-semibold text-slate-200">
                  {(winRate * 100).toFixed(1)}%
                </div>
              </div>
            )}
            {sharpe !== null && (
              <div className="rounded-lg bg-[#111827] border border-white/[0.06] p-2 text-center">
                <div className="text-[10px] text-slate-500 uppercase">Sharpe</div>
                <div className="text-sm font-semibold text-slate-200">
                  {sharpe.toFixed(2)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Fund Allocation Inputs */}
        <div className="space-y-3">
          <div>
            <label className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
              <DollarSign className="w-3.5 h-3.5" />
              Max USD Cap
            </label>
            <input
              type="number"
              value={maxCapUsd}
              onChange={(e) => setMaxCapUsd(Number(e.target.value))}
              min={10}
              step={50}
              className="w-full rounded-lg bg-[#111827] border border-white/[0.08] px-3 py-2 text-sm text-slate-200 focus:border-emerald-500/30 focus:outline-none"
            />
          </div>
          <div>
            <label className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
              <Percent className="w-3.5 h-3.5" />
              Max % of Balance
            </label>
            <input
              type="number"
              value={maxCapPercent}
              onChange={(e) => setMaxCapPercent(Number(e.target.value))}
              min={1}
              max={100}
              step={1}
              className="w-full rounded-lg bg-[#111827] border border-white/[0.08] px-3 py-2 text-sm text-slate-200 focus:border-emerald-500/30 focus:outline-none"
            />
          </div>
          <div>
            <label className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
              <Shield className="w-3.5 h-3.5" />
              Daily Loss Limit (USD)
            </label>
            <input
              type="number"
              value={dailyLossLimitUsd}
              onChange={(e) => setDailyLossLimitUsd(Number(e.target.value))}
              min={10}
              step={10}
              className="w-full rounded-lg bg-[#111827] border border-white/[0.08] px-3 py-2 text-sm text-slate-200 focus:border-emerald-500/30 focus:outline-none"
            />
          </div>

          <div className="rounded-lg bg-amber-500/5 border border-amber-500/10 p-2.5 text-[11px] text-amber-400/80">
            <div className="flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <div>
                Will use up to <strong>${maxCapUsd}</strong> or <strong>{maxCapPercent}%</strong> of
                balance (whichever is lower). Auto-stops if daily loss exceeds <strong>${dailyLossLimitUsd}</strong>.
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-white/[0.08] text-slate-400"
          >
            Cancel
          </Button>
          <Button
            onClick={() => activate.mutate()}
            disabled={activate.isPending}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {activate.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                Activating...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 mr-1.5" />
                Activate Strategy
              </>
            )}
          </Button>
        </DialogFooter>

        {activate.isError && (
          <p className="text-xs text-red-400 text-center">
            {activate.error instanceof Error ? activate.error.message : "Activation failed"}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
