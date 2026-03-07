import {
  RSI,
  MACD,
  BollingerBands,
  EMA,
  SMA,
  ATR,
  Stochastic,
} from "technicalindicators";
import type { Candle } from "./data/candles";

export type IndicatorName =
  | "rsi"
  | "macd"
  | "bollinger"
  | "ema"
  | "sma"
  | "atr"
  | "stochastic"
  | "volume_sma";

export interface IndicatorParams {
  period?: number;
  fastPeriod?: number;
  slowPeriod?: number;
  signalPeriod?: number;
  stdDev?: number;
}

export interface IndicatorResult {
  name: string;
  values: (number | { [key: string]: number | undefined } | undefined)[];
  timestamps: number[];
}

const DEFAULT_PARAMS: Record<IndicatorName, IndicatorParams> = {
  rsi: { period: 14 },
  macd: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
  bollinger: { period: 20, stdDev: 2 },
  ema: { period: 21 },
  sma: { period: 50 },
  atr: { period: 14 },
  stochastic: { period: 14, signalPeriod: 3 },
  volume_sma: { period: 20 },
};

export function calculateIndicator(
  name: IndicatorName,
  candles: Candle[],
  params?: IndicatorParams
): IndicatorResult {
  const p = { ...DEFAULT_PARAMS[name], ...params };
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);
  const timestamps = candles.map((c) => c.timestamp);

  switch (name) {
    case "rsi": {
      const values = RSI.calculate({ values: closes, period: p.period! });
      const offset = candles.length - values.length;
      return {
        name: `RSI(${p.period})`,
        values: padArray(values, offset),
        timestamps,
      };
    }
    case "macd": {
      const values = MACD.calculate({
        values: closes,
        fastPeriod: p.fastPeriod!,
        slowPeriod: p.slowPeriod!,
        signalPeriod: p.signalPeriod!,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
      });
      const offset = candles.length - values.length;
      return {
        name: `MACD(${p.fastPeriod}/${p.slowPeriod}/${p.signalPeriod})`,
        values: padArray(
          values.map((v) => ({
            macd: v.MACD,
            signal: v.signal,
            histogram: v.histogram,
          })),
          offset
        ),
        timestamps,
      };
    }
    case "bollinger": {
      const values = BollingerBands.calculate({
        values: closes,
        period: p.period!,
        stdDev: p.stdDev!,
      });
      const offset = candles.length - values.length;
      return {
        name: `BB(${p.period},${p.stdDev})`,
        values: padArray(
          values.map((v) => ({
            upper: v.upper,
            middle: v.middle,
            lower: v.lower,
          })),
          offset
        ),
        timestamps,
      };
    }
    case "ema": {
      const values = EMA.calculate({ values: closes, period: p.period! });
      const offset = candles.length - values.length;
      return {
        name: `EMA(${p.period})`,
        values: padArray(values, offset),
        timestamps,
      };
    }
    case "sma": {
      const values = SMA.calculate({ values: closes, period: p.period! });
      const offset = candles.length - values.length;
      return {
        name: `SMA(${p.period})`,
        values: padArray(values, offset),
        timestamps,
      };
    }
    case "atr": {
      const values = ATR.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: p.period!,
      });
      const offset = candles.length - values.length;
      return {
        name: `ATR(${p.period})`,
        values: padArray(values, offset),
        timestamps,
      };
    }
    case "stochastic": {
      const values = Stochastic.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: p.period!,
        signalPeriod: p.signalPeriod!,
      });
      const offset = candles.length - values.length;
      return {
        name: `Stoch(${p.period}/${p.signalPeriod})`,
        values: padArray(
          values.map((v) => ({ k: v.k, d: v.d })),
          offset
        ),
        timestamps,
      };
    }
    case "volume_sma": {
      const values = SMA.calculate({ values: volumes, period: p.period! });
      const offset = candles.length - values.length;
      return {
        name: `VolSMA(${p.period})`,
        values: padArray(values, offset),
        timestamps,
      };
    }
  }
}

function padArray<T>(values: T[], offset: number): (T | undefined)[] {
  return [...Array(offset).fill(undefined), ...values];
}
