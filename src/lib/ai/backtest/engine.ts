import type { Candle } from "../data/candles";
import type { StrategyConfig, Trade, EquityPoint, BacktestResult } from "./types";
import { calculateMetrics } from "./metrics";
import { cacheIndicator, cacheAltIndicators, checkConditions } from "./conditions";

const INITIAL_EQUITY = 10000;

/**
 * Run a backtest. Accepts an optional symbol parameter for loading per-symbol alt data.
 * If any strategy conditions reference alternative data indicators (funding_rate, reddit, etc.),
 * the engine loads historical values from the database and aligns them to candle timestamps.
 */
export async function runBacktest(
  candles: Candle[],
  config: StrategyConfig,
  symbol?: string
): Promise<BacktestResult> {
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

  // Load alternative data indicators from DB (if any conditions reference them)
  await cacheAltIndicators(indicatorCache, allConditions, candles, symbol || "BTC/USDT");

  // Replay candles
  let equity = INITIAL_EQUITY;
  let inPosition = false;
  let entryPrice = 0;
  let entryIndex = 0;
  let positionSize = 0;
  let remainingSize = 0;
  let tpFilled = 0;
  let partialPnlLocked = 0; // accumulated PnL from partial exits within current trade
  const trades: Trade[] = [];
  const equityCurve: EquityPoint[] = [{ timestamp: candles[0].timestamp, equity }];

  const DUST_THRESHOLD = 0.01; // min remaining size in USD terms

  for (let i = 1; i < candles.length; i++) {
    const candle = candles[i];

    if (inPosition) {
      // Check stop loss / take profit
      const pnlPercent = ((candle.close - entryPrice) / entryPrice) * 100;

      if (config.stopLossPercent && pnlPercent <= -config.stopLossPercent) {
        const exitPnl = remainingSize * (-config.stopLossPercent / 100) + partialPnlLocked;
        equity += exitPnl;
        trades.push(makeTrade(entryIndex, i, candles, entryPrice, entryPrice * (1 - config.stopLossPercent / 100), positionSize, exitPnl));
        inPosition = false;
        partialPnlLocked = 0;
      } else if (config.takeProfitLevels?.length) {
        // Multi-target take profit
        const nextLevel = config.takeProfitLevels[tpFilled];
        if (nextLevel && pnlPercent >= nextLevel.percent) {
          const sellAmount = positionSize * (nextLevel.sellPercent / 100);
          const levelPnl = sellAmount * (pnlPercent / 100);
          partialPnlLocked += levelPnl;
          remainingSize -= sellAmount;
          tpFilled++;

          // If dust remaining, close fully
          if (remainingSize < DUST_THRESHOLD) {
            equity += partialPnlLocked;
            const avgExitPrice = entryPrice * (1 + pnlPercent / 100);
            trades.push(makeTrade(entryIndex, i, candles, entryPrice, avgExitPrice, positionSize, partialPnlLocked));
            inPosition = false;
            partialPnlLocked = 0;
          }
        } else if (checkConditions(config.exitConditions, i, indicatorCache)) {
          // Exit signal closes remaining position
          const exitPrice = candle.close;
          const remainingPnl = remainingSize * ((exitPrice - entryPrice) / entryPrice);
          const totalPnl = partialPnlLocked + remainingPnl;
          equity += totalPnl;
          trades.push(makeTrade(entryIndex, i, candles, entryPrice, exitPrice, positionSize, totalPnl));
          inPosition = false;
          partialPnlLocked = 0;
        }
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
        remainingSize = positionSize;
        tpFilled = 0;
        partialPnlLocked = 0;
      }
    }

    // Track equity
    if (inPosition) {
      const unrealized = remainingSize * ((candle.close - entryPrice) / entryPrice) + partialPnlLocked;
      equityCurve.push({ timestamp: candle.timestamp, equity: equity + unrealized });
    } else {
      equityCurve.push({ timestamp: candle.timestamp, equity });
    }
  }

  // Close any open position at the end
  if (inPosition) {
    const lastCandle = candles[candles.length - 1];
    const remainingPnl = remainingSize * ((lastCandle.close - entryPrice) / entryPrice);
    const totalPnl = partialPnlLocked + remainingPnl;
    equity += totalPnl;
    trades.push(makeTrade(entryIndex, candles.length - 1, candles, entryPrice, lastCandle.close, positionSize, totalPnl));
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
  positionSize: number,
  pnlOverride?: number
): Trade {
  const pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
  const pnlAbsolute = pnlOverride !== undefined ? pnlOverride : positionSize * (pnlPercent / 100);
  return {
    entryIndex,
    exitIndex,
    entryTimestamp: candles[entryIndex].timestamp,
    exitTimestamp: candles[exitIndex].timestamp,
    entryPrice,
    exitPrice,
    side: "long",
    pnlPercent: positionSize > 0 ? (pnlAbsolute / positionSize) * 100 : pnlPercent,
    pnlAbsolute,
  };
}
