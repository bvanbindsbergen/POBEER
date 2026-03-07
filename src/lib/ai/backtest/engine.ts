import type { Candle } from "../data/candles";
import type { StrategyConfig, Trade, EquityPoint, BacktestResult } from "./types";
import { calculateMetrics } from "./metrics";
import { cacheIndicator, checkConditions } from "./conditions";

const INITIAL_EQUITY = 10000;

export function runBacktest(
  candles: Candle[],
  config: StrategyConfig
): BacktestResult {
  if (candles.length < 2) {
    return {
      ...calculateMetrics([], []),
      trades: [],
      equityCurve: [{ timestamp: Date.now(), equity: INITIAL_EQUITY }],
    };
  }

  // Pre-compute all needed indicators
  const indicatorCache = new Map<string, (number | undefined)[]>();
  const allConditions = [...config.entryConditions, ...config.exitConditions];

  for (const cond of allConditions) {
    cacheIndicator(indicatorCache, cond.indicator, cond.params, cond.field, candles);
    if (typeof cond.value === "object") {
      cacheIndicator(indicatorCache, cond.value.indicator, cond.value.params, cond.value.field, candles);
    }
  }

  // Replay candles
  let equity = INITIAL_EQUITY;
  let inPosition = false;
  let entryPrice = 0;
  let entryIndex = 0;
  let positionSize = 0;
  const trades: Trade[] = [];
  const equityCurve: EquityPoint[] = [{ timestamp: candles[0].timestamp, equity }];

  for (let i = 1; i < candles.length; i++) {
    const candle = candles[i];

    if (inPosition) {
      // Check stop loss / take profit
      const pnlPercent = ((candle.close - entryPrice) / entryPrice) * 100;

      if (config.stopLossPercent && pnlPercent <= -config.stopLossPercent) {
        equity += positionSize * (-config.stopLossPercent / 100);
        trades.push(makeTrade(entryIndex, i, candles, entryPrice, entryPrice * (1 - config.stopLossPercent / 100), positionSize));
        inPosition = false;
      } else if (config.takeProfitPercent && pnlPercent >= config.takeProfitPercent) {
        equity += positionSize * (config.takeProfitPercent / 100);
        trades.push(makeTrade(entryIndex, i, candles, entryPrice, entryPrice * (1 + config.takeProfitPercent / 100), positionSize));
        inPosition = false;
      } else if (checkConditions(config.exitConditions, i, indicatorCache)) {
        const exitPrice = candle.close;
        const pnl = positionSize * ((exitPrice - entryPrice) / entryPrice);
        equity += pnl;
        trades.push(makeTrade(entryIndex, i, candles, entryPrice, exitPrice, positionSize));
        inPosition = false;
      }
    } else {
      // Check entry conditions
      if (checkConditions(config.entryConditions, i, indicatorCache)) {
        inPosition = true;
        entryPrice = candle.close;
        entryIndex = i;
        positionSize = equity * (config.positionSizePercent / 100);
      }
    }

    // Track equity
    if (inPosition) {
      const unrealized = positionSize * ((candle.close - entryPrice) / entryPrice);
      equityCurve.push({ timestamp: candle.timestamp, equity: equity + unrealized });
    } else {
      equityCurve.push({ timestamp: candle.timestamp, equity });
    }
  }

  // Close any open position at the end
  if (inPosition) {
    const lastCandle = candles[candles.length - 1];
    const pnl = positionSize * ((lastCandle.close - entryPrice) / entryPrice);
    equity += pnl;
    trades.push(makeTrade(entryIndex, candles.length - 1, candles, entryPrice, lastCandle.close, positionSize));
    equityCurve[equityCurve.length - 1].equity = equity;
  }

  const metrics = calculateMetrics(trades, equityCurve);

  return { ...metrics, trades, equityCurve };
}

function makeTrade(
  entryIndex: number,
  exitIndex: number,
  candles: Candle[],
  entryPrice: number,
  exitPrice: number,
  positionSize: number
): Trade {
  const pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
  return {
    entryIndex,
    exitIndex,
    entryTimestamp: candles[entryIndex].timestamp,
    exitTimestamp: candles[exitIndex].timestamp,
    entryPrice,
    exitPrice,
    side: "long",
    pnlPercent,
    pnlAbsolute: positionSize * (pnlPercent / 100),
  };
}
