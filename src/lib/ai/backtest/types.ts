import type { IndicatorName, IndicatorParams } from "../indicators";

export interface Condition {
  indicator: IndicatorName;
  params?: IndicatorParams;
  field?: string; // for multi-value indicators (e.g. "k" for stochastic, "macd" for MACD)
  operator: ">" | "<" | ">=" | "<=" | "crosses_above" | "crosses_below";
  value: number | { indicator: IndicatorName; params?: IndicatorParams; field?: string };
}

export interface StrategyConfig {
  name?: string;
  entryConditions: Condition[];
  exitConditions: Condition[];
  stopLossPercent?: number;
  takeProfitPercent?: number;
  trailingStopPercent?: number; // exit when price drops X% from highest since entry
  positionSizePercent: number; // % of equity per trade
  dcaEnabled?: boolean;
  dcaOrders?: number; // total DCA portions (e.g. 3 = initial + 2 more)
  dcaDropPercent?: number; // buy next portion when price drops X% from last buy
}

export interface Trade {
  entryIndex: number;
  exitIndex: number;
  entryTimestamp: number;
  exitTimestamp: number;
  entryPrice: number;
  exitPrice: number;
  side: "long";
  pnlPercent: number;
  pnlAbsolute: number;
}

export interface EquityPoint {
  timestamp: number;
  equity: number;
}

export interface BacktestResult {
  totalPnl: number;
  winRate: number;
  maxDrawdown: number;
  sharpeRatio: number;
  profitFactor: number;
  totalTrades: number;
  avgWin: number;
  avgLoss: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  trades: Trade[];
  equityCurve: EquityPoint[];
}
