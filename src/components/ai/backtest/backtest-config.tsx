"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Play } from "lucide-react";
import type { StrategyConfig, Condition } from "@/lib/ai/backtest/types";
import type { IndicatorName } from "@/lib/ai/indicators";

const SYMBOLS = [
  "BTC/USDT", "ETH/USDT", "SOL/USDT", "XRP/USDT", "DOGE/USDT",
  "ADA/USDT", "AVAX/USDT", "LINK/USDT", "DOT/USDT", "MATIC/USDT",
];
const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"];
const INDICATORS: { value: IndicatorName; label: string }[] = [
  { value: "rsi", label: "RSI" },
  { value: "macd", label: "MACD" },
  { value: "bollinger", label: "Bollinger Bands" },
  { value: "ema", label: "EMA" },
  { value: "sma", label: "SMA" },
  { value: "atr", label: "ATR" },
  { value: "stochastic", label: "Stochastic" },
  { value: "volume_sma", label: "Volume SMA" },
];
const OPERATORS = [
  { value: ">", label: ">" },
  { value: "<", label: "<" },
  { value: ">=", label: ">=" },
  { value: "<=", label: "<=" },
  { value: "crosses_above", label: "Crosses Above" },
  { value: "crosses_below", label: "Crosses Below" },
];

interface BacktestConfigProps {
  onRun: (config: {
    symbol: string;
    timeframe: string;
    startDate: string;
    endDate: string;
    strategyConfig: StrategyConfig;
  }) => void;
  isRunning: boolean;
  initialConfig?: StrategyConfig;
  initialSymbol?: string;
  initialTimeframe?: string;
}

/** Format an indicator reference for display, e.g. "RSI(14)" or "EMA(21).signal" */
function formatIndicatorRef(ref: { indicator: string; params?: Record<string, number>; field?: string }): string {
  const name = ref.indicator.toUpperCase();
  const field = ref.field ? `.${ref.field}` : "";
  if (!ref.params || Object.keys(ref.params).length === 0) return `${name}${field}`;
  return `${name}(${Object.values(ref.params).join(",")})${field}`;
}

function defaultCondition(): Condition {
  return {
    indicator: "rsi",
    operator: "<",
    value: 30,
  };
}

export function BacktestConfig({
  onRun,
  isRunning,
  initialConfig,
  initialSymbol,
  initialTimeframe,
}: BacktestConfigProps) {
  const [symbol, setSymbol] = useState(initialSymbol || "BTC/USDT");
  const [timeframe, setTimeframe] = useState(initialTimeframe || "1h");

  const today = new Date().toISOString().split("T")[0];
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const [startDate, setStartDate] = useState(ninetyDaysAgo);
  const [endDate, setEndDate] = useState(today);
  const [entryConditions, setEntryConditions] = useState<Condition[]>(
    initialConfig?.entryConditions || [defaultCondition()]
  );
  const [exitConditions, setExitConditions] = useState<Condition[]>(
    initialConfig?.exitConditions || [{ indicator: "rsi", operator: ">", value: 70 }]
  );
  const [stopLoss, setStopLoss] = useState(
    initialConfig?.stopLossPercent?.toString() || "3"
  );
  const [takeProfit, setTakeProfit] = useState(
    initialConfig?.takeProfitPercent?.toString() || "6"
  );
  const [positionSize, setPositionSize] = useState(
    initialConfig?.positionSizePercent?.toString() || "10"
  );

  function updateCondition(
    list: Condition[],
    setList: (c: Condition[]) => void,
    index: number,
    field: keyof Condition,
    value: string | number
  ) {
    const updated = [...list];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (updated[index] as any)[field] = value;
    setList(updated);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onRun({
      symbol,
      timeframe,
      startDate,
      endDate,
      strategyConfig: {
        entryConditions,
        exitConditions,
        stopLossPercent: Number(stopLoss) || undefined,
        takeProfitPercent: Number(takeProfit) || undefined,
        positionSizePercent: Number(positionSize) || 10,
      },
    });
  }

  function renderConditions(
    label: string,
    conditions: Condition[],
    setConditions: (c: Condition[]) => void
  ) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium text-slate-300">{label}</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConditions([...conditions, defaultCondition()])}
            className="h-7 text-xs text-emerald-400 hover:text-emerald-300"
          >
            <Plus className="w-3 h-3 mr-1" />
            Add
          </Button>
        </div>
        {conditions.map((cond, i) => (
          <div key={i} className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 sm:gap-2">
            <Select
              value={cond.indicator}
              onValueChange={(v) =>
                updateCondition(conditions, setConditions, i, "indicator", v as unknown as number)
              }
            >
              <SelectTrigger className="w-[calc(50%-4px)] sm:w-[140px] h-8 text-xs bg-[#070b12] border-white/[0.06]">
                <span className="truncate">
                  {formatIndicatorRef({ indicator: cond.indicator, params: cond.params as Record<string, number> | undefined, field: cond.field })}
                </span>
              </SelectTrigger>
              <SelectContent>
                {INDICATORS.map((ind) => (
                  <SelectItem key={ind.value} value={ind.value}>
                    {ind.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={cond.operator}
              onValueChange={(v) =>
                updateCondition(conditions, setConditions, i, "operator", v)
              }
            >
              <SelectTrigger className="w-[calc(50%-4px)] sm:w-[130px] h-8 text-xs bg-[#070b12] border-white/[0.06]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPERATORS.map((op) => (
                  <SelectItem key={op.value} value={op.value}>
                    {op.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {typeof cond.value === "object" && cond.value !== null && "indicator" in cond.value ? (
              <div className="flex-1 min-w-[60px] sm:w-[160px] sm:flex-none h-8 flex items-center px-2 rounded-md bg-[#070b12] border border-white/[0.06] text-xs text-cyan-400 font-medium">
                {formatIndicatorRef(cond.value as { indicator: string; params?: Record<string, number>; field?: string })}
              </div>
            ) : (
              <Input
                type="number"
                value={typeof cond.value === "number" ? cond.value : ""}
                onChange={(e) =>
                  updateCondition(
                    conditions,
                    setConditions,
                    i,
                    "value",
                    Number(e.target.value)
                  )
                }
                className="flex-1 min-w-[60px] sm:w-20 sm:flex-none h-8 text-xs bg-[#070b12] border-white/[0.06]"
                placeholder="Value"
              />
            )}
            {conditions.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setConditions(conditions.filter((_, j) => j !== i))
                }
                className="h-8 w-8 p-0 text-red-400 hover:text-red-300 flex-shrink-0"
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Symbol, Timeframe, Date Range */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <Label className="text-xs text-slate-400">Symbol</Label>
          <Select value={symbol} onValueChange={setSymbol}>
            <SelectTrigger className="h-9 text-sm bg-[#070b12] border-white/[0.06]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SYMBOLS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-slate-400">Timeframe</Label>
          <Select value={timeframe} onValueChange={setTimeframe}>
            <SelectTrigger className="h-9 text-sm bg-[#070b12] border-white/[0.06]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEFRAMES.map((tf) => (
                <SelectItem key={tf} value={tf}>
                  {tf}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-slate-400">Start Date</Label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="h-9 text-sm bg-[#070b12] border-white/[0.06]"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-400">End Date</Label>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="h-9 text-sm bg-[#070b12] border-white/[0.06]"
          />
        </div>
      </div>

      {/* Entry / Exit Conditions */}
      <div className="grid md:grid-cols-2 gap-4">
        {renderConditions("Entry Conditions", entryConditions, setEntryConditions)}
        {renderConditions("Exit Conditions", exitConditions, setExitConditions)}
      </div>

      {/* Risk Management */}
      <div className="grid grid-cols-3 sm:grid-cols-3 gap-2 sm:gap-3">
        <div>
          <Label className="text-xs text-slate-400">Stop Loss %</Label>
          <Input
            type="number"
            step="0.5"
            value={stopLoss}
            onChange={(e) => setStopLoss(e.target.value)}
            className="h-9 text-sm bg-[#070b12] border-white/[0.06]"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-400">Take Profit %</Label>
          <Input
            type="number"
            step="0.5"
            value={takeProfit}
            onChange={(e) => setTakeProfit(e.target.value)}
            className="h-9 text-sm bg-[#070b12] border-white/[0.06]"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-400">Position Size %</Label>
          <Input
            type="number"
            step="1"
            min="1"
            max="100"
            value={positionSize}
            onChange={(e) => setPositionSize(e.target.value)}
            className="h-9 text-sm bg-[#070b12] border-white/[0.06]"
          />
        </div>
      </div>

      <Button
        type="submit"
        disabled={isRunning}
        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
      >
        {isRunning ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
            Running Backtest...
          </>
        ) : (
          <>
            <Play className="w-4 h-4 mr-2" />
            Run Backtest
          </>
        )}
      </Button>
    </form>
  );
}
