"use client";

import { Wrench, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

interface ToolResultCardProps {
  name: string;
  result: unknown;
}

const TOOL_LABELS: Record<string, string> = {
  fetch_candles: "Fetched Candle Data",
  calculate_indicators: "Calculated Indicators",
  get_crypto_news: "Fetched Crypto News",
  run_backtest: "Ran Backtest",
  get_market_overview: "Fetched Market Overview",
};

export function ToolResultCard({ name, result }: ToolResultCardProps) {
  const [expanded, setExpanded] = useState(false);
  const label = TOOL_LABELS[name] || name;

  // Format result summary
  let summary = "";
  if (typeof result === "object" && result !== null) {
    const r = result as Record<string, unknown>;
    if (name === "run_backtest") {
      summary = `P&L: $${r.totalPnl} | Win Rate: ${r.winRate} | Sharpe: ${r.sharpeRatio} | ${r.totalTrades} trades`;
    } else if (name === "fetch_candles") {
      summary = `${r.totalCandles} candles | Current: $${typeof r.currentPrice === 'number' ? r.currentPrice.toFixed(2) : r.currentPrice}`;
    } else if (name === "get_crypto_news" && Array.isArray(r.news)) {
      summary = `${r.news.length} articles`;
    } else if (name === "calculate_indicators" && Array.isArray(r.indicators)) {
      summary = (r.indicators as { name: string }[]).map((i) => i.name).join(", ");
    } else if (name === "get_market_overview") {
      summary = "Trending coins & top movers";
    }
  }

  return (
    <div className="mx-10 my-1.5 rounded-lg bg-[#0d1421] border border-white/[0.04] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-400 hover:text-slate-300 transition-colors"
      >
        <Wrench className="w-3 h-3 text-cyan-500" />
        <span className="font-medium">{label}</span>
        {summary && (
          <span className="text-slate-500 truncate flex-1 text-left">
            — {summary}
          </span>
        )}
        {expanded ? (
          <ChevronUp className="w-3 h-3 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-3 h-3 flex-shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 max-h-60 overflow-auto">
          <pre className="text-[11px] text-slate-500 whitespace-pre-wrap break-words">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
