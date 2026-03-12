"use client";

import { useState } from "react";
import { PriceChart } from "../charts/price-chart";
import { EquityChart } from "../charts/equity-chart";
import type { Trade, EquityPoint, WalkForwardResult } from "@/lib/ai/backtest/types";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Activity, BarChart3, Target, Hash, Zap, Shield, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";

function sf(v: number | null | undefined, d: number): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toFixed(d);
}

interface BacktestResultsProps {
  result: {
    id?: string;
    totalPnl: string | number;
    winRate: string | number;
    maxDrawdown: string | number;
    sharpeRatio: string | number;
    profitFactor: string | number;
    totalTrades: number;
    trades?: string | Trade[];
    equityCurve?: string | EquityPoint[];
    symbol?: string;
    timeframe?: string;
    strategyConfig?: string;
  };
  candles?: { timestamp: number; open: number; high: number; low: number; close: number; volume: number }[];
  onActivate?: (source: {
    id: string;
    name: string;
    symbol: string;
    timeframe: string;
    strategyConfig: string | object;
    sourceType: "strategy" | "backtest";
    totalPnl?: number | string;
    winRate?: number | string;
    sharpeRatio?: number | string;
  }) => void;
  walkForwardResult?: WalkForwardResult | null;
  walkForwardLoading?: boolean;
}

export function BacktestResults({ result, candles, onActivate, walkForwardResult, walkForwardLoading }: BacktestResultsProps) {
  const [wfExpanded, setWfExpanded] = useState(false);
  const trades: Trade[] = typeof result.trades === "string"
    ? JSON.parse(result.trades || "[]")
    : result.trades || [];
  const equityCurve: EquityPoint[] = typeof result.equityCurve === "string"
    ? JSON.parse(result.equityCurve || "[]")
    : result.equityCurve || [];

  const pnl = Number(result.totalPnl) || 0;
  const winRate = Number(result.winRate) || 0;
  const drawdown = Number(result.maxDrawdown) || 0;
  const sharpe = Number(result.sharpeRatio) || 0;
  const pf = Number(result.profitFactor) || 0;
  const isPositive = pnl >= 0;

  const metrics = [
    {
      label: "Total P&L",
      value: `$${pnl.toFixed(2)}`,
      icon: isPositive ? TrendingUp : TrendingDown,
      color: isPositive ? "text-emerald-400" : "text-red-400",
      bg: isPositive ? "bg-emerald-500/10" : "bg-red-500/10",
    },
    {
      label: "Win Rate",
      value: `${(winRate * 100).toFixed(1)}%`,
      icon: Target,
      color: winRate >= 0.5 ? "text-emerald-400" : "text-amber-400",
      bg: winRate >= 0.5 ? "bg-emerald-500/10" : "bg-amber-500/10",
    },
    {
      label: "Max Drawdown",
      value: `${(drawdown * 100).toFixed(1)}%`,
      icon: Activity,
      color: drawdown < 0.1 ? "text-emerald-400" : drawdown < 0.2 ? "text-amber-400" : "text-red-400",
      bg: drawdown < 0.1 ? "bg-emerald-500/10" : drawdown < 0.2 ? "bg-amber-500/10" : "bg-red-500/10",
    },
    {
      label: "Sharpe Ratio",
      value: sharpe.toFixed(2),
      icon: BarChart3,
      color: sharpe >= 1 ? "text-emerald-400" : sharpe >= 0 ? "text-amber-400" : "text-red-400",
      bg: sharpe >= 1 ? "bg-emerald-500/10" : sharpe >= 0 ? "bg-amber-500/10" : "bg-red-500/10",
    },
    {
      label: "Profit Factor",
      value: pf === Infinity ? "Inf" : pf.toFixed(2),
      icon: TrendingUp,
      color: pf >= 1.5 ? "text-emerald-400" : pf >= 1 ? "text-amber-400" : "text-red-400",
      bg: pf >= 1.5 ? "bg-emerald-500/10" : pf >= 1 ? "bg-amber-500/10" : "bg-red-500/10",
    },
    {
      label: "Total Trades",
      value: String(result.totalTrades),
      icon: Hash,
      color: "text-cyan-400",
      bg: "bg-cyan-500/10",
    },
  ];

  return (
    <div className="space-y-4">
      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="rounded-lg bg-[#111827] border border-white/[0.06] p-3"
          >
            <div className="flex items-center gap-2 mb-1">
              <div className={`p-1 rounded ${m.bg}`}>
                <m.icon className={`w-3.5 h-3.5 ${m.color}`} />
              </div>
              <span className="text-[10px] uppercase tracking-wide text-slate-500">
                {m.label}
              </span>
            </div>
            <p className={`text-lg font-semibold ${m.color}`}>{m.value}</p>
          </div>
        ))}
      </div>

      {/* Charts */}
      {candles && candles.length > 0 && (
        <div className="rounded-lg bg-[#111827] border border-white/[0.06] p-3">
          <h4 className="text-sm font-medium text-slate-300 mb-2">
            Price Chart with Trade Markers
          </h4>
          <PriceChart candles={candles} trades={trades} height={350} />
        </div>
      )}

      {equityCurve.length > 0 && (
        <div className="rounded-lg bg-[#111827] border border-white/[0.06] p-3">
          <h4 className="text-sm font-medium text-slate-300 mb-2">
            Equity Curve
          </h4>
          <EquityChart equityCurve={equityCurve} height={220} />
        </div>
      )}

      {/* Robustness Analysis (Walk-Forward) */}
      {walkForwardLoading && (
        <div className="rounded-lg bg-[#111827] border border-white/[0.06] p-4">
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
            <span className="text-sm text-slate-400">Validating strategy robustness...</span>
          </div>
        </div>
      )}

      {walkForwardResult && walkForwardResult.windows.length > 0 && (
        <div className="rounded-lg bg-[#111827] border border-white/[0.06] p-4 space-y-3">
          {/* Header with verdict badge */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium text-slate-300">Robustness Score</h4>
              <span className="text-[10px] text-slate-600">Tested on {walkForwardResult.windows.length} unseen data windows</span>
            </div>
            {(() => {
              const cr = walkForwardResult.consistencyRatio;
              const profitable = walkForwardResult.windows.filter(w => w.outOfSampleResult.totalPnl > 0).length;
              if (cr >= 0.6) return (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Shield className="w-3.5 h-3.5" />
                  Robust ({profitable}/{walkForwardResult.windows.length} profitable)
                </div>
              );
              if (cr >= 0.4) return (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Suspect ({profitable}/{walkForwardResult.windows.length} profitable)
                </div>
              );
              return (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Overfit ({profitable}/{walkForwardResult.windows.length} profitable)
                </div>
              );
            })()}
          </div>

          {/* Summary metrics row */}
          <div className="grid grid-cols-4 gap-3">
            <div className="rounded bg-white/[0.02] border border-white/[0.04] p-2">
              <p className="text-[10px] text-slate-500">Consistency</p>
              <p className={`text-sm font-bold ${(walkForwardResult.consistencyRatio ?? 0) >= 0.6 ? "text-emerald-400" : (walkForwardResult.consistencyRatio ?? 0) >= 0.4 ? "text-amber-400" : "text-red-400"}`}>
                {sf((walkForwardResult.consistencyRatio ?? 0) * 100, 0)}%
              </p>
            </div>
            <div className="rounded bg-white/[0.02] border border-white/[0.04] p-2">
              <p className="text-[10px] text-slate-500">Degradation</p>
              <p className={`text-sm font-bold ${(walkForwardResult.degradationRatio ?? 0) >= 0.7 ? "text-emerald-400" : (walkForwardResult.degradationRatio ?? 0) >= 0.4 ? "text-amber-400" : "text-red-400"}`}>
                {sf((walkForwardResult.degradationRatio ?? 0) * 100, 0)}%
              </p>
            </div>
            <div className="rounded bg-white/[0.02] border border-white/[0.04] p-2">
              <p className="text-[10px] text-slate-500">Avg OOS Sharpe</p>
              <p className={`text-sm font-bold ${(walkForwardResult.oosSharpe ?? 0) >= 1 ? "text-emerald-400" : (walkForwardResult.oosSharpe ?? 0) >= 0 ? "text-amber-400" : "text-red-400"}`}>
                {sf(walkForwardResult.oosSharpe, 2)}
              </p>
            </div>
            <div className="rounded bg-white/[0.02] border border-white/[0.04] p-2">
              <p className="text-[10px] text-slate-500">Avg OOS P&L</p>
              <p className={`text-sm font-bold ${(walkForwardResult.oosAveragePnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {(walkForwardResult.oosAveragePnl ?? 0) >= 0 ? "+" : ""}{sf(walkForwardResult.oosAveragePnl, 2)}%
              </p>
            </div>
          </div>

          {/* Expandable window details */}
          <button
            onClick={() => setWfExpanded(!wfExpanded)}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            {wfExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {wfExpanded ? "Hide" : "Show"} window details
          </button>

          {wfExpanded && (
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
                  {walkForwardResult.windows.map((w) => {
                    const oosPositive = w.outOfSampleResult.totalPnl > 0;
                    return (
                      <tr
                        key={w.windowIndex}
                        className={`border-b border-white/[0.03] ${oosPositive ? "bg-emerald-500/[0.03]" : "bg-red-500/[0.03]"}`}
                      >
                        <td className="py-2 pr-3 text-slate-300 font-medium">#{w.windowIndex + 1}</td>
                        <td className={`text-right py-2 px-3 ${(w.inSampleResult.totalPnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {(w.inSampleResult.totalPnl ?? 0) >= 0 ? "+" : ""}{sf(w.inSampleResult.totalPnl, 2)}%
                        </td>
                        <td className={`text-right py-2 px-3 font-medium ${oosPositive ? "text-emerald-400" : "text-red-400"}`}>
                          {(w.outOfSampleResult.totalPnl ?? 0) >= 0 ? "+" : ""}{sf(w.outOfSampleResult.totalPnl, 2)}%
                        </td>
                        <td className="text-right py-2 px-3 text-slate-400">{sf(w.inSampleResult.sharpeRatio, 2)}</td>
                        <td className="text-right py-2 px-3 text-slate-400">{sf(w.outOfSampleResult.sharpeRatio, 2)}</td>
                        <td className="text-right py-2 px-3 text-slate-400">{w.inSampleResult.totalTrades}</td>
                        <td className="text-right py-2 pl-3 text-slate-400">{w.outOfSampleResult.totalTrades}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Activate Strategy Button */}
      {onActivate && isPositive && result.id && result.symbol && result.timeframe && result.strategyConfig && (
        <div className="flex justify-center">
          <Button
            onClick={() => {
              const config = typeof result.strategyConfig === "string"
                ? (() => { try { return JSON.parse(result.strategyConfig!); } catch { return null; } })()
                : result.strategyConfig;
              onActivate({
                id: result.id!,
                name: config?.name || `${result.symbol} ${result.timeframe} Strategy`,
                symbol: result.symbol!,
                timeframe: result.timeframe!,
                strategyConfig: result.strategyConfig!,
                sourceType: "backtest",
                totalPnl: result.totalPnl,
                winRate: result.winRate,
                sharpeRatio: result.sharpeRatio,
              });
            }}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            <Zap className="w-4 h-4 mr-1.5" />
            Activate Strategy for Live Trading
          </Button>
        </div>
      )}
    </div>
  );
}
