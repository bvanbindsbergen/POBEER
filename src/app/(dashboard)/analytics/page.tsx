"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, TrendingUp, TrendingDown, Activity } from "lucide-react";

interface EquityPoint {
  date: string;
  equity: number;
}

interface StrategyRow {
  id: string;
  name: string;
  symbol: string;
  totalPnl: number;
  tradesCount: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  mode: string;
}

interface DrawdownPoint {
  date: string;
  drawdown: number;
}

interface PortfolioData {
  equityCurve: EquityPoint[];
  strategies: StrategyRow[];
  rollingDrawdown: DrawdownPoint[];
}

type SortKey = keyof StrategyRow;

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

// Simple SVG line chart
function EquityCurveChart({ data }: { data: EquityPoint[] }) {
  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-500 text-sm">
        Not enough data points for chart
      </div>
    );
  }

  const width = 700;
  const height = 200;
  const padding = { top: 20, right: 20, bottom: 30, left: 60 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const values = data.map((d) => d.equity);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;

  const points = data
    .map((d, i) => {
      const x = padding.left + (i / (data.length - 1)) * chartW;
      const y = padding.top + chartH - ((d.equity - minVal) / range) * chartH;
      return `${x},${y}`;
    })
    .join(" ");

  // Y-axis labels
  const yLabels = [minVal, minVal + range * 0.5, maxVal];

  // X-axis labels (show first, middle, last)
  const xIndices = [0, Math.floor(data.length / 2), data.length - 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
      {/* Grid lines */}
      {yLabels.map((val, i) => {
        const y = padding.top + chartH - ((val - minVal) / range) * chartH;
        return (
          <g key={i}>
            <line
              x1={padding.left}
              y1={y}
              x2={width - padding.right}
              y2={y}
              stroke="rgba(255,255,255,0.06)"
              strokeDasharray="4,4"
            />
            <text
              x={padding.left - 8}
              y={y + 4}
              textAnchor="end"
              fill="#94a3b8"
              fontSize="10"
            >
              ${val.toFixed(0)}
            </text>
          </g>
        );
      })}
      {/* X-axis labels */}
      {xIndices.map((idx) => {
        const x = padding.left + (idx / (data.length - 1)) * chartW;
        return (
          <text
            key={idx}
            x={x}
            y={height - 5}
            textAnchor="middle"
            fill="#94a3b8"
            fontSize="10"
          >
            {data[idx].date.slice(5)}
          </text>
        );
      })}
      {/* Line */}
      <polyline
        points={points}
        fill="none"
        stroke="#10b981"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Simple SVG area chart for drawdown
function DrawdownChart({ data }: { data: DrawdownPoint[] }) {
  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-500 text-sm">
        Not enough data points for chart
      </div>
    );
  }

  const width = 700;
  const height = 160;
  const padding = { top: 10, right: 20, bottom: 30, left: 60 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const values = data.map((d) => d.drawdown);
  const maxDd = Math.max(...values, 1);

  const linePoints = data
    .map((d, i) => {
      const x = padding.left + (i / (data.length - 1)) * chartW;
      const y = padding.top + (d.drawdown / maxDd) * chartH;
      return `${x},${y}`;
    })
    .join(" ");

  // Polygon for fill: starts top-left, goes through points, then back along bottom
  const firstX = padding.left;
  const lastX = padding.left + chartW;
  const polygonPoints = `${firstX},${padding.top} ${linePoints} ${lastX},${padding.top}`;

  // Y-axis labels
  const yLabels = [0, maxDd * 0.5, maxDd];
  const xIndices = [0, Math.floor(data.length / 2), data.length - 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
      {yLabels.map((val, i) => {
        const y = padding.top + (val / maxDd) * chartH;
        return (
          <g key={i}>
            <line
              x1={padding.left}
              y1={y}
              x2={width - padding.right}
              y2={y}
              stroke="rgba(255,255,255,0.06)"
              strokeDasharray="4,4"
            />
            <text
              x={padding.left - 8}
              y={y + 4}
              textAnchor="end"
              fill="#94a3b8"
              fontSize="10"
            >
              {val.toFixed(1)}%
            </text>
          </g>
        );
      })}
      {xIndices.map((idx) => {
        const x = padding.left + (idx / (data.length - 1)) * chartW;
        return (
          <text
            key={idx}
            x={x}
            y={height - 5}
            textAnchor="middle"
            fill="#94a3b8"
            fontSize="10"
          >
            {data[idx].date.slice(5)}
          </text>
        );
      })}
      <polygon points={polygonPoints} fill="rgba(239,68,68,0.15)" />
      <polyline
        points={linePoints}
        fill="none"
        stroke="#ef4444"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function AnalyticsPage() {
  const [sortKey, setSortKey] = useState<SortKey>("totalPnl");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data, isLoading } = useQuery<PortfolioData>({
    queryKey: ["portfolio-analytics"],
    queryFn: async () => {
      const res = await fetch("/api/analytics/portfolio");
      if (!res.ok) throw new Error("Failed to fetch analytics");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sortedStrategies = data?.strategies
    ? [...data.strategies].sort((a, b) => {
        const aVal = a[sortKey];
        const bVal = b[sortKey];
        if (typeof aVal === "number" && typeof bVal === "number") {
          return sortDir === "asc" ? aVal - bVal : bVal - aVal;
        }
        return sortDir === "asc"
          ? String(aVal).localeCompare(String(bVal))
          : String(bVal).localeCompare(String(aVal));
      })
    : [];

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400">
          <div className="w-5 h-5 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
          <span className="text-sm font-medium">Loading analytics...</span>
        </div>
      </div>
    );
  }

  const hasData =
    data &&
    (data.equityCurve.length > 0 || data.strategies.length > 0);

  if (!hasData) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-6 h-6 text-emerald-400" />
          <h1 className="text-2xl font-bold text-slate-100">
            Portfolio Analytics
          </h1>
        </div>
        <div className="bg-[#111827] border border-white/[0.06] rounded-xl p-12 text-center">
          <Activity className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">
            No analytics data yet. Data will appear once strategies are active
            and equity snapshots are captured.
          </p>
        </div>
      </div>
    );
  }

  // Summary stats
  const totalEquity =
    data.equityCurve.length > 0
      ? data.equityCurve[data.equityCurve.length - 1].equity
      : 0;
  const totalPnl = data.strategies.reduce((s, st) => s + st.totalPnl, 0);
  const totalTrades = data.strategies.reduce((s, st) => s + st.tradesCount, 0);
  const maxDrawdown =
    data.rollingDrawdown.length > 0
      ? Math.max(...data.rollingDrawdown.map((d) => d.drawdown))
      : 0;

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ^" : " v") : "";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BarChart3 className="w-6 h-6 text-emerald-400" />
        <h1 className="text-2xl font-bold text-slate-100">
          Portfolio Analytics
        </h1>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-[#111827] border border-white/[0.06] rounded-xl p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs font-medium mb-1">
            <TrendingUp className="w-3.5 h-3.5" />
            Portfolio Equity
          </div>
          <p className="text-lg font-semibold text-slate-100">
            {formatUsd(totalEquity)}
          </p>
        </div>
        <div className="bg-[#111827] border border-white/[0.06] rounded-xl p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs font-medium mb-1">
            <Activity className="w-3.5 h-3.5" />
            Total PnL
          </div>
          <p
            className={`text-lg font-semibold ${
              totalPnl >= 0 ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {formatUsd(totalPnl)}
          </p>
        </div>
        <div className="bg-[#111827] border border-white/[0.06] rounded-xl p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs font-medium mb-1">
            <BarChart3 className="w-3.5 h-3.5" />
            Total Trades
          </div>
          <p className="text-lg font-semibold text-slate-100">{totalTrades}</p>
        </div>
        <div className="bg-[#111827] border border-white/[0.06] rounded-xl p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs font-medium mb-1">
            <TrendingDown className="w-3.5 h-3.5" />
            Max Drawdown
          </div>
          <p className="text-lg font-semibold text-red-400">
            {maxDrawdown.toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Equity curve */}
      {data.equityCurve.length > 0 && (
        <div className="bg-[#111827] border border-white/[0.06] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            Equity Curve
          </h2>
          <EquityCurveChart data={data.equityCurve} />
        </div>
      )}

      {/* Strategy performance table */}
      {sortedStrategies.length > 0 && (
        <div className="bg-[#111827] border border-white/[0.06] rounded-xl p-5 overflow-x-auto">
          <h2 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            Strategy Performance
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 text-xs border-b border-white/[0.06]">
                <th
                  className="pb-3 pr-4 cursor-pointer hover:text-slate-300"
                  onClick={() => handleSort("name")}
                >
                  Name{sortIndicator("name")}
                </th>
                <th
                  className="pb-3 pr-4 cursor-pointer hover:text-slate-300"
                  onClick={() => handleSort("symbol")}
                >
                  Symbol{sortIndicator("symbol")}
                </th>
                <th
                  className="pb-3 pr-4 cursor-pointer hover:text-slate-300 text-right"
                  onClick={() => handleSort("totalPnl")}
                >
                  Total PnL{sortIndicator("totalPnl")}
                </th>
                <th
                  className="pb-3 pr-4 cursor-pointer hover:text-slate-300 text-right"
                  onClick={() => handleSort("tradesCount")}
                >
                  Trades{sortIndicator("tradesCount")}
                </th>
                <th
                  className="pb-3 pr-4 cursor-pointer hover:text-slate-300 text-right"
                  onClick={() => handleSort("winRate")}
                >
                  Win Rate{sortIndicator("winRate")}
                </th>
                <th
                  className="pb-3 pr-4 cursor-pointer hover:text-slate-300 text-right"
                  onClick={() => handleSort("avgWin")}
                >
                  Avg Win{sortIndicator("avgWin")}
                </th>
                <th
                  className="pb-3 pr-4 cursor-pointer hover:text-slate-300 text-right"
                  onClick={() => handleSort("avgLoss")}
                >
                  Avg Loss{sortIndicator("avgLoss")}
                </th>
                <th
                  className="pb-3 pr-4 cursor-pointer hover:text-slate-300 text-right"
                  onClick={() => handleSort("profitFactor")}
                >
                  PF{sortIndicator("profitFactor")}
                </th>
                <th className="pb-3">Mode</th>
              </tr>
            </thead>
            <tbody>
              {sortedStrategies.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-white/[0.03] hover:bg-white/[0.02]"
                >
                  <td className="py-3 pr-4 text-slate-200 font-medium">
                    {s.name}
                  </td>
                  <td className="py-3 pr-4 text-slate-400">{s.symbol}</td>
                  <td
                    className={`py-3 pr-4 text-right font-medium ${
                      s.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {formatUsd(s.totalPnl)}
                  </td>
                  <td className="py-3 pr-4 text-right text-slate-300">
                    {s.tradesCount}
                  </td>
                  <td className="py-3 pr-4 text-right text-slate-300">
                    {formatPercent(s.winRate)}
                  </td>
                  <td className="py-3 pr-4 text-right text-emerald-400">
                    {formatUsd(s.avgWin)}
                  </td>
                  <td className="py-3 pr-4 text-right text-red-400">
                    {formatUsd(s.avgLoss)}
                  </td>
                  <td className="py-3 pr-4 text-right text-slate-300">
                    {s.profitFactor >= 999
                      ? "---"
                      : s.profitFactor.toFixed(2)}
                  </td>
                  <td className="py-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        s.mode === "live"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "bg-amber-500/10 text-amber-400"
                      }`}
                    >
                      {s.mode}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Drawdown chart */}
      {data.rollingDrawdown.length > 0 && (
        <div className="bg-[#111827] border border-white/[0.06] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-red-400" />
            Rolling Drawdown
          </h2>
          <DrawdownChart data={data.rollingDrawdown} />
        </div>
      )}
    </div>
  );
}
