import { calculateIndicator, type IndicatorName } from "../indicators";
import { isAltIndicator, loadAltDataForCandles, type AltIndicatorName } from "../alt-data-indicators";
import type { Candle } from "../data/candles";
import type { Condition } from "./types";

export function cacheIndicator(
  cache: Map<string, (number | undefined)[]>,
  indicator: IndicatorName,
  params: Condition["params"],
  field: string | undefined,
  candles: Candle[]
) {
  const key = `${indicator}:${JSON.stringify(params || {})}:${field || ""}`;
  if (cache.has(key)) return;

  // Alt data indicators are loaded from DB via cacheAltIndicators — skip here
  if (isAltIndicator(indicator)) return;

  const result = calculateIndicator(indicator, candles, params);
  const values = result.values.map((v) => {
    if (v === undefined) return undefined;
    if (typeof v === "number") return v;
    if (field && typeof v === "object") return (v as Record<string, number | undefined>)[field];
    // For multi-value indicators without field, use first numeric value
    if (typeof v === "object") {
      const vals = Object.values(v as Record<string, number | undefined>);
      return vals[0];
    }
    return undefined;
  });
  cache.set(key, values);
}

/**
 * Pre-loads all alternative data indicators referenced in conditions from the database.
 * Must be called before running the backtest when strategies use alt data conditions.
 */
export async function cacheAltIndicators(
  cache: Map<string, (number | undefined)[]>,
  conditions: Condition[],
  candles: Candle[],
  symbol: string
): Promise<void> {
  const altIndicators = new Set<AltIndicatorName>();

  for (const cond of conditions) {
    if (isAltIndicator(cond.indicator)) {
      altIndicators.add(cond.indicator);
    }
    if (typeof cond.value === "object" && isAltIndicator(cond.value.indicator as string)) {
      altIndicators.add(cond.value.indicator as AltIndicatorName);
    }
  }

  if (altIndicators.size === 0) return;

  const loadPromises = [...altIndicators].map(async (indicator) => {
    const key = `${indicator}:{}:`;
    if (cache.has(key)) return;

    const values = await loadAltDataForCandles(indicator, candles, symbol);
    cache.set(key, values);
  });

  await Promise.all(loadPromises);
}

export function getIndicatorValue(
  cache: Map<string, (number | undefined)[]>,
  indicator: IndicatorName,
  params: Condition["params"],
  field: string | undefined,
  index: number
): number | undefined {
  const key = `${indicator}:${JSON.stringify(params || {})}:${field || ""}`;
  return cache.get(key)?.[index];
}

export function checkConditions(
  conditions: Condition[],
  index: number,
  cache: Map<string, (number | undefined)[]>
): boolean {
  if (conditions.length === 0) return false;

  return conditions.every((cond) => {
    const current = getIndicatorValue(cache, cond.indicator, cond.params, cond.field, index);
    if (current === undefined) return false;

    let targetValue: number | undefined;

    if (typeof cond.value === "object") {
      targetValue = getIndicatorValue(
        cache,
        cond.value.indicator,
        cond.value.params,
        cond.value.field,
        index
      );
    } else {
      targetValue = cond.value;
    }

    if (targetValue === undefined) return false;

    switch (cond.operator) {
      case ">": return current > targetValue;
      case "<": return current < targetValue;
      case ">=": return current >= targetValue;
      case "<=": return current <= targetValue;
      case "crosses_above": {
        const prev = getIndicatorValue(cache, cond.indicator, cond.params, cond.field, index - 1);
        let prevTarget: number | undefined;
        if (typeof cond.value === "object") {
          prevTarget = getIndicatorValue(cache, cond.value.indicator, cond.value.params, cond.value.field, index - 1);
        } else {
          prevTarget = cond.value;
        }
        if (prev === undefined || prevTarget === undefined) return false;
        return prev <= prevTarget && current > targetValue;
      }
      case "crosses_below": {
        const prev = getIndicatorValue(cache, cond.indicator, cond.params, cond.field, index - 1);
        let prevTarget: number | undefined;
        if (typeof cond.value === "object") {
          prevTarget = getIndicatorValue(cache, cond.value.indicator, cond.value.params, cond.value.field, index - 1);
        } else {
          prevTarget = cond.value;
        }
        if (prev === undefined || prevTarget === undefined) return false;
        return prev >= prevTarget && current < targetValue;
      }
    }
  });
}
