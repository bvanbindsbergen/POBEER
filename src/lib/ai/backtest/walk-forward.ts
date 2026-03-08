import type { Candle } from "../data/candles";
import type { StrategyConfig, WalkForwardResult, WalkForwardWindow } from "./types";
import { runBacktest } from "./engine";

export function runWalkForward(
  candles: Candle[],
  config: StrategyConfig,
  windowCount: number = 5,
  inSampleRatio: number = 0.7
): WalkForwardResult {
  const totalCandles = candles.length;
  const windowSize = Math.floor(totalCandles / windowCount);

  if (windowSize < 20) {
    // Not enough data — return empty result
    return {
      windows: [],
      oosAveragePnl: 0,
      oosSharpe: 0,
      oosWinRate: 0,
      consistencyRatio: 0,
      degradationRatio: 0,
    };
  }

  const windows: WalkForwardWindow[] = [];

  for (let i = 0; i < windowCount; i++) {
    const start = i * windowSize;
    const end = Math.min(start + windowSize, totalCandles);
    const windowCandles = candles.slice(start, end);

    const splitIndex = Math.floor(windowCandles.length * inSampleRatio);
    const inSampleCandles = windowCandles.slice(0, splitIndex);
    const outOfSampleCandles = windowCandles.slice(splitIndex);

    if (inSampleCandles.length < 10 || outOfSampleCandles.length < 5) continue;

    const inSampleResult = runBacktest(inSampleCandles, config);
    const outOfSampleResult = runBacktest(outOfSampleCandles, config);

    windows.push({
      windowIndex: i,
      inSampleResult,
      outOfSampleResult,
    });
  }

  // Compute aggregate OOS metrics
  const oosResults = windows.map(w => w.outOfSampleResult);
  const isResults = windows.map(w => w.inSampleResult);

  const oosAveragePnl = oosResults.length > 0
    ? oosResults.reduce((s, r) => s + r.totalPnl, 0) / oosResults.length
    : 0;
  const oosSharpe = oosResults.length > 0
    ? oosResults.reduce((s, r) => s + r.sharpeRatio, 0) / oosResults.length
    : 0;
  const oosWinRate = oosResults.length > 0
    ? oosResults.reduce((s, r) => s + r.winRate, 0) / oosResults.length
    : 0;

  const profitableOos = oosResults.filter(r => r.totalPnl > 0).length;
  const consistencyRatio = oosResults.length > 0 ? profitableOos / oosResults.length : 0;

  const avgIsSharpe = isResults.length > 0
    ? isResults.reduce((s, r) => s + r.sharpeRatio, 0) / isResults.length
    : 0;
  const degradationRatio = avgIsSharpe > 0 ? oosSharpe / avgIsSharpe : 0;

  return {
    windows,
    oosAveragePnl,
    oosSharpe,
    oosWinRate,
    consistencyRatio,
    degradationRatio,
  };
}
