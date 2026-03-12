"use client";

import { Shield, AlertTriangle } from "lucide-react";
import type { WalkForwardResult } from "@/lib/ai/backtest/types";

interface WalkForwardResultsProps {
  result: WalkForwardResult | null;
  isLoading?: boolean;
}

function sf(v: number | null | undefined, d: number): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toFixed(d);
}

export function WalkForwardResults({ result, isLoading }: WalkForwardResultsProps) {
  if (isLoading) {
    return (
      <div className="rounded-xl bg-[#111827] border border-white/[0.06] p-6">
        <div className="flex items-center justify-center gap-3">
          <div className="w-4 h-4 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
          <span className="text-sm text-slate-400">Running walk-forward analysis...</span>
        </div>
      </div>
    );
  }

  if (!result) return null;

  if (result.windows.length === 0) {
    return (
      <div className="rounded-xl bg-[#111827] border border-white/[0.06] p-6">
        <p className="text-sm text-slate-400 text-center">
          Not enough data for walk-forward analysis. Try a longer time period.
        </p>
      </div>
    );
  }

  const verdict = getVerdict(result.consistencyRatio);

  return (
    <div className="rounded-xl bg-[#111827] border border-white/[0.06] p-4 space-y-4">
      {/* Header with verdict */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">Walk-Forward Analysis</h3>
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${verdict.className}`}
        >
          {verdict.icon}
          {verdict.label}
        </div>
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="Consistency"
          value={`${sf((result.consistencyRatio ?? 0) * 100, 0)}%`}
          sub="profitable OOS windows"
          color={(result.consistencyRatio ?? 0) >= 0.6 ? "emerald" : (result.consistencyRatio ?? 0) >= 0.4 ? "amber" : "red"}
        />
        <MetricCard
          label="Degradation"
          value={`${sf((result.degradationRatio ?? 0) * 100, 0)}%`}
          sub="OOS / IS Sharpe"
          color={(result.degradationRatio ?? 0) >= 0.7 ? "emerald" : (result.degradationRatio ?? 0) >= 0.4 ? "amber" : "red"}
        />
        <MetricCard
          label="Avg OOS Sharpe"
          value={sf(result.oosSharpe, 2)}
          sub="out-of-sample"
          color={(result.oosSharpe ?? 0) >= 1 ? "emerald" : (result.oosSharpe ?? 0) >= 0 ? "amber" : "red"}
        />
        <MetricCard
          label="Avg OOS P&L"
          value={`${(result.oosAveragePnl ?? 0) >= 0 ? "+" : ""}${sf(result.oosAveragePnl, 2)}%`}
          sub="out-of-sample"
          color={(result.oosAveragePnl ?? 0) >= 0 ? "emerald" : "red"}
        />
      </div>

      {/* Window-by-window table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-white/[0.06]">
              <th className="text-left py-2 pr-3 font-medium">Window</th>
              <th className="text-right py-2 px-3 font-medium">IS P&L</th>
              <th className="text-right py-2 px-3 font-medium">OOS P&L</th>
              <th className="text-right py-2 px-3 font-medium">IS Sharpe</th>
              <th className="text-right py-2 px-3 font-medium">OOS Sharpe</th>
              <th className="text-right py-2 px-3 font-medium">IS Trades</th>
              <th className="text-right py-2 pl-3 font-medium">OOS Trades</th>
            </tr>
          </thead>
          <tbody>
            {result.windows.map((w) => {
              const oosPositive = w.outOfSampleResult.totalPnl > 0;
              return (
                <tr
                  key={w.windowIndex}
                  className={`border-b border-white/[0.03] ${
                    oosPositive ? "bg-emerald-500/[0.03]" : "bg-red-500/[0.03]"
                  }`}
                >
                  <td className="py-2 pr-3 text-slate-300 font-medium">#{w.windowIndex + 1}</td>
                  <td className={`text-right py-2 px-3 ${(w.inSampleResult.totalPnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {(w.inSampleResult.totalPnl ?? 0) >= 0 ? "+" : ""}{sf(w.inSampleResult.totalPnl, 2)}%
                  </td>
                  <td className={`text-right py-2 px-3 font-medium ${oosPositive ? "text-emerald-400" : "text-red-400"}`}>
                    {(w.outOfSampleResult.totalPnl ?? 0) >= 0 ? "+" : ""}{sf(w.outOfSampleResult.totalPnl, 2)}%
                  </td>
                  <td className="text-right py-2 px-3 text-slate-400">
                    {sf(w.inSampleResult.sharpeRatio, 2)}
                  </td>
                  <td className="text-right py-2 px-3 text-slate-400">
                    {sf(w.outOfSampleResult.sharpeRatio, 2)}
                  </td>
                  <td className="text-right py-2 px-3 text-slate-400">
                    {w.inSampleResult.totalTrades}
                  </td>
                  <td className="text-right py-2 pl-3 text-slate-400">
                    {w.outOfSampleResult.totalTrades}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  color: "emerald" | "amber" | "red";
}) {
  const colorMap = {
    emerald: "text-emerald-400",
    amber: "text-amber-400",
    red: "text-red-400",
  };

  return (
    <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
      <p className="text-[10px] text-slate-500 mb-1">{label}</p>
      <p className={`text-lg font-bold ${colorMap[color]}`}>{value}</p>
      <p className="text-[10px] text-slate-600">{sub}</p>
    </div>
  );
}

function getVerdict(consistencyRatio: number) {
  if (consistencyRatio >= 0.6) {
    return {
      label: "Robust",
      className: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
      icon: <Shield className="w-3.5 h-3.5" />,
    };
  }
  if (consistencyRatio >= 0.4) {
    return {
      label: "Suspect",
      className: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
      icon: <AlertTriangle className="w-3.5 h-3.5" />,
    };
  }
  return {
    label: "Overfit",
    className: "bg-red-500/10 text-red-400 border border-red-500/20",
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
  };
}
