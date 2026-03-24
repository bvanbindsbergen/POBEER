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
  side?: "long" | "short";
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

  // RSI overbought (bearish — short entries)
  if (lower.includes("rsi overbought")) {
    return [
      { entry: 70, exit: 30 },
      { entry: 72, exit: 35 },
      { entry: 75, exit: 40 },
      { entry: 80, exit: 45 },
    ].map(({ entry, exit }) => ({
      entryConditions: [
        { indicator: "rsi" as const, operator: ">" as const, value: entry },
      ],
      exitConditions: [
        { indicator: "rsi" as const, operator: "<" as const, value: exit },
      ],
      label: `RSI>${entry}`,
      tag: "rsi-overbought",
      side: "short" as const,
    }));
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

  // MACD bearish crossover (short entries)
  if (lower.includes("macd bearish")) {
    return [
      {
        entryConditions: [
          {
            indicator: "macd" as const,
            field: "macd",
            operator: "crosses_below" as const,
            value: { indicator: "macd" as const, field: "signal" },
          },
        ],
        exitConditions: [
          {
            indicator: "macd" as const,
            field: "macd",
            operator: "crosses_above" as const,
            value: { indicator: "macd" as const, field: "signal" },
          },
        ],
        label: "MACD↓",
        tag: "macd-bear-cross",
        side: "short" as const,
      },
      {
        entryConditions: [
          { indicator: "macd" as const, field: "histogram", operator: "<" as const, value: 0 },
        ],
        exitConditions: [
          { indicator: "macd" as const, field: "histogram", operator: ">" as const, value: 0 },
        ],
        label: "MACDhist<0",
        tag: "macd-bear-hist",
        side: "short" as const,
      },
    ];
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

  // Price at upper Bollinger Band (bearish — short entries)
  if (lower.includes("upper bollinger")) {
    return [
      {
        entryConditions: [
          {
            indicator: "sma" as const,
            params: { period: 1 },
            operator: ">" as const,
            value: { indicator: "bollinger" as const, params: { period: 20 }, field: "upper" },
          },
        ],
        exitConditions: [
          {
            indicator: "sma" as const,
            params: { period: 1 },
            operator: "<" as const,
            value: { indicator: "bollinger" as const, params: { period: 20 }, field: "middle" },
          },
        ],
        label: "BB20upper→mid",
        tag: "bb-upper",
        side: "short" as const,
      },
      {
        entryConditions: [
          {
            indicator: "sma" as const,
            params: { period: 1 },
            operator: ">" as const,
            value: { indicator: "bollinger" as const, params: { period: 20 }, field: "upper" },
          },
        ],
        exitConditions: [
          {
            indicator: "sma" as const,
            params: { period: 1 },
            operator: "<" as const,
            value: { indicator: "bollinger" as const, params: { period: 20 }, field: "lower" },
          },
        ],
        label: "BB20upper→low",
        tag: "bb-upper",
        side: "short" as const,
      },
    ];
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

  // EMA death cross (bearish — short entries)
  if (lower.includes("death cross")) {
    return [
      { fast: 9, slow: 21 },
      { fast: 12, slow: 50 },
    ].map(({ fast, slow }) => ({
      entryConditions: [
        {
          indicator: "ema" as const,
          params: { period: fast },
          operator: "crosses_below" as const,
          value: { indicator: "ema" as const, params: { period: slow } },
        },
      ],
      exitConditions: [
        {
          indicator: "ema" as const,
          params: { period: fast },
          operator: "crosses_above" as const,
          value: { indicator: "ema" as const, params: { period: slow } },
        },
      ],
      label: `EMA${fast}/${slow}↓`,
      tag: "ema-death-cross",
      side: "short" as const,
    }));
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

  // Stochastic overbought (bearish — short entries)
  if (lower.includes("stochastic overbought")) {
    return [80, 85].map((threshold) => ({
      entryConditions: [
        { indicator: "stochastic" as const, field: "k", operator: ">" as const, value: threshold },
      ],
      exitConditions: [
        { indicator: "stochastic" as const, field: "k", operator: "<" as const, value: threshold === 80 ? 20 : 15 },
      ],
      label: `StochK>${threshold}`,
      tag: "stoch-overbought",
      side: "short" as const,
    }));
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
