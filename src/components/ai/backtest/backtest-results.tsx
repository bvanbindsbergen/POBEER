"use client";

import { PriceChart } from "../charts/price-chart";
import { EquityChart } from "../charts/equity-chart";
import type { Trade, EquityPoint } from "@/lib/ai/backtest/types";
import { TrendingUp, TrendingDown, Activity, BarChart3, Target, Hash } from "lucide-react";

interface BacktestResultsProps {
  result: {
    totalPnl: string | number;
    winRate: string | number;
    maxDrawdown: string | number;
    sharpeRatio: string | number;
    profitFactor: string | number;
    totalTrades: number;
    trades?: string | Trade[];
    equityCurve?: string | EquityPoint[];
  };
  candles?: { timestamp: number; open: number; high: number; low: number; close: number; volume: number }[];
}

export function BacktestResults({ result, candles }: BacktestResultsProps) {
  const trades: Trade[] = typeof result.trades === "string"
    ? JSON.parse(result.trades || "[]")
    : result.trades || [];
  const equityCurve: EquityPoint[] = typeof result.equityCurve === "string"
    ? JSON.parse(result.equityCurve || "[]")
    : result.equityCurve || [];

  const pnl = Number(result.totalPnl);
  const winRate = Number(result.winRate);
  const drawdown = Number(result.maxDrawdown);
  const sharpe = Number(result.sharpeRatio);
  const pf = Number(result.profitFactor);
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
    </div>
  );
}
