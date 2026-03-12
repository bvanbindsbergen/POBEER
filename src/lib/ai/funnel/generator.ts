import type { Condition, StrategyConfig } from "../backtest/types";
import { mapSignalToConditions } from "./signal-mapper";

export interface FunnelConfig {
  signals: { symbol: string; signals: string[]; currentPrice: number }[];
  timeframe: string;
  maxStrategies: number;
  slRange: number[];
  tpRange: number[];
  minProfitPercent: number;
  positionSizePercent: number;
}

export interface GeneratedStrategy {
  id: string;
  name: string;
  symbol: string;
  strategyConfig: StrategyConfig;
  sourceSignal: string;
  tags: string[];
}

/**
 * Generates strategy combinations algorithmically from scanner signals.
 * Pure function — zero API calls, zero tokens.
 */
export function generateStrategies(config: FunnelConfig): GeneratedStrategy[] {
  const strategies: GeneratedStrategy[] = [];
  let idCounter = 0;

  for (const coinSignals of config.signals) {
    const { symbol, signals } = coinSignals;
    const shortSymbol = symbol.replace("/USDT", "");

    // Map each signal to condition variations
    const allVariations: {
      entryConditions: Condition[];
      exitConditions: Condition[];
      label: string;
      tag: string;
    }[] = [];

    for (const signal of signals) {
      allVariations.push(...mapSignalToConditions(signal));
    }

    if (allVariations.length === 0) continue;

    // Stage 1: Each variation alone × SL × TP
    for (const variation of allVariations) {
      for (const sl of config.slRange) {
        for (const tp of config.tpRange) {
          // Skip illogical: TP should be > SL for positive expectancy
          if (tp <= sl) continue;

          strategies.push({
            id: `gen-${++idCounter}`,
            name: `${shortSymbol} ${variation.label} | TP${tp}% SL${sl}%`,
            symbol,
            strategyConfig: {
              name: `${shortSymbol} ${variation.label} | TP${tp}% SL${sl}%`,
              entryConditions: variation.entryConditions,
              exitConditions: variation.exitConditions,
              stopLossPercent: sl,
              takeProfitPercent: tp,
              positionSizePercent: config.positionSizePercent,
            },
            sourceSignal: variation.label,
            tags: [variation.tag, `sl${sl}`, `tp${tp}`],
          });
        }
      }
    }

    // Stage 2: Confirmation combos (primary + 1 secondary) × SL × TP
    if (allVariations.length >= 2) {
      for (let i = 0; i < allVariations.length; i++) {
        for (let j = i + 1; j < allVariations.length; j++) {
          // Skip same-tag combos (e.g., two RSI oversold variations)
          if (allVariations[i].tag === allVariations[j].tag) continue;

          const combo = allVariations[i];
          const confirm = allVariations[j];
          const comboEntry = [...combo.entryConditions, ...confirm.entryConditions];
          // Use primary's exit + secondary's exit
          const comboExit = [...combo.exitConditions];

          for (const sl of config.slRange) {
            for (const tp of config.tpRange) {
              if (tp <= sl) continue;

              strategies.push({
                id: `gen-${++idCounter}`,
                name: `${shortSymbol} ${combo.label}+${confirm.label} | TP${tp}% SL${sl}%`,
                symbol,
                strategyConfig: {
                  name: `${shortSymbol} ${combo.label}+${confirm.label} | TP${tp}% SL${sl}%`,
                  entryConditions: comboEntry,
                  exitConditions: comboExit,
                  stopLossPercent: sl,
                  takeProfitPercent: tp,
                  positionSizePercent: config.positionSizePercent,
                },
                sourceSignal: `${combo.label}+${confirm.label}`,
                tags: [combo.tag, confirm.tag, "combo", `sl${sl}`, `tp${tp}`],
              });
            }
          }
        }
      }
    }
  }

  // Cap at maxStrategies — if exceeding, shuffle and slice
  if (strategies.length > config.maxStrategies) {
    // Fisher-Yates shuffle
    for (let i = strategies.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [strategies[i], strategies[j]] = [strategies[j], strategies[i]];
    }
    return strategies.slice(0, config.maxStrategies);
  }

  return strategies;
}
