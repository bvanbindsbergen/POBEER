import type { Condition } from "../backtest/types";

interface MappedSignal {
  entryConditions: Condition[];
  exitConditions: Condition[];
  tag: string;
}

interface SignalVariation {
  entryConditions: Condition[];
  exitConditions: Condition[];
  label: string;
  tag: string;
}

/**
 * Maps a human-readable scanner signal string to Condition[] variations.
 * Returns multiple variations per signal (different thresholds/params).
 */
export function mapSignalToConditions(signal: string): SignalVariation[] {
  const lower = signal.toLowerCase();

  // RSI oversold
  if (lower.includes("rsi oversold")) {
    return [25, 28, 30, 35].map((threshold) => ({
      entryConditions: [
        { indicator: "rsi" as const, operator: "<" as const, value: threshold },
      ],
      exitConditions: [
        { indicator: "rsi" as const, operator: ">" as const, value: threshold <= 28 ? 65 : 70 },
      ],
      label: `RSI<${threshold}`,
      tag: "rsi-oversold",
    }));
  }

  // RSI bouncing from oversold
  if (lower.includes("rsi bouncing")) {
    return [28, 30, 32].map((threshold) => ({
      entryConditions: [
        { indicator: "rsi" as const, operator: "crosses_above" as const, value: threshold },
      ],
      exitConditions: [
        { indicator: "rsi" as const, operator: ">" as const, value: 70 },
      ],
      label: `RSI↑${threshold}`,
      tag: "rsi-bounce",
    }));
  }

  // RSI overbought (bearish — skip for long-only, but can use as exit confirmation)
  if (lower.includes("rsi overbought")) {
    return [];
  }

  // MACD bullish crossover
  if (lower.includes("macd bullish crossover")) {
    return [{
      entryConditions: [
        {
          indicator: "macd" as const,
          field: "macd",
          operator: "crosses_above" as const,
          value: { indicator: "macd" as const, field: "signal" },
        },
      ],
      exitConditions: [
        {
          indicator: "macd" as const,
          field: "macd",
          operator: "crosses_below" as const,
          value: { indicator: "macd" as const, field: "signal" },
        },
      ],
      label: "MACD↑",
      tag: "macd-cross",
    }];
  }

  // MACD histogram turned positive
  if (lower.includes("macd histogram turned positive")) {
    return [{
      entryConditions: [
        { indicator: "macd" as const, field: "histogram", operator: ">" as const, value: 0 },
      ],
      exitConditions: [
        { indicator: "macd" as const, field: "histogram", operator: "<" as const, value: 0 },
      ],
      label: "MACDhist>0",
      tag: "macd-hist",
    }];
  }

  // MACD bearish crossover (skip for long-only)
  if (lower.includes("macd bearish")) {
    return [];
  }

  // Price at lower Bollinger Band
  if (lower.includes("lower bollinger")) {
    return [15, 20, 25].map((period) => ({
      entryConditions: [
        {
          indicator: "bollinger" as const,
          params: { period },
          field: "lower",
          operator: ">=" as const,
          // "close < lower band" — we express as: bollinger.lower >= close
          // But conditions compare indicator vs value, so we flip:
          // Actually we need: price < lower band. The engine compares indicator value to target.
          // So: bollinger.lower > close. But we don't have "close" as an indicator...
          // We use sma(1) as a proxy for close, or we can just set a threshold.
          // Better: use the crossing approach with bollinger lower as the value
          value: { indicator: "sma" as const, params: { period: 1 } },
        },
      ],
      exitConditions: [
        {
          indicator: "sma" as const,
          params: { period: 1 },
          operator: ">" as const,
          value: { indicator: "bollinger" as const, params: { period }, field: "middle" },
        },
      ],
      label: `BB${period}low`,
      tag: "bb-lower",
    }));
  }

  // Bollinger Band squeeze (confirmation only — pair with other signals)
  if (lower.includes("bollinger band squeeze")) {
    return [];
  }

  // Price at upper Bollinger Band (bearish, skip for long-only)
  if (lower.includes("upper bollinger")) {
    return [];
  }

  // EMA golden cross
  if (lower.includes("golden cross")) {
    return [
      { fast: 9, slow: 21 },
      { fast: 12, slow: 26 },
    ].map(({ fast, slow }) => ({
      entryConditions: [
        {
          indicator: "ema" as const,
          params: { period: fast },
          operator: "crosses_above" as const,
          value: { indicator: "ema" as const, params: { period: slow } },
        },
      ],
      exitConditions: [
        {
          indicator: "ema" as const,
          params: { period: fast },
          operator: "crosses_below" as const,
          value: { indicator: "ema" as const, params: { period: slow } },
        },
      ],
      label: `EMA${fast}/${slow}↑`,
      tag: "ema-cross",
    }));
  }

  // EMA death cross (bearish, skip)
  if (lower.includes("death cross")) {
    return [];
  }

  // Stochastic oversold
  if (lower.includes("stochastic oversold")) {
    return [15, 20, 25].map((threshold) => ({
      entryConditions: [
        { indicator: "stochastic" as const, field: "k", operator: "<" as const, value: threshold },
      ],
      exitConditions: [
        { indicator: "stochastic" as const, field: "k", operator: ">" as const, value: 80 },
      ],
      label: `StochK<${threshold}`,
      tag: "stoch-oversold",
    }));
  }

  // Stochastic overbought (bearish, skip)
  if (lower.includes("stochastic overbought")) {
    return [];
  }

  return [];
}

/**
 * Maps all signals for a coin and returns base conditions with variations.
 */
export function mapAllSignals(signals: string[]): {
  primary: SignalVariation[];
  secondary: SignalVariation[];
} {
  const allVariations: SignalVariation[] = [];
  for (const signal of signals) {
    allVariations.push(...mapSignalToConditions(signal));
  }

  if (allVariations.length === 0) return { primary: [], secondary: [] };

  // First signal's variations are primary, rest are secondary (for confirmation combos)
  return {
    primary: allVariations.length > 0 ? [allVariations[0]] : [],
    secondary: allVariations.slice(1),
  };
}
