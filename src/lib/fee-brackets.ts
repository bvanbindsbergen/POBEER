/**
 * Fee bracket definitions for POBEER quarterly invoicing.
 *
 * Each follower pays a BASE_FEE (€297) plus a bracket fee based on
 * their quarterly profit (equity change minus net deposits).
 */

export const BASE_FEE = 297; // EUR flat fee per quarter

export interface FeeBracket {
  label: string;
  minProfit: number; // inclusive
  maxProfit: number; // exclusive (Infinity for top bracket)
  fee: number; // EUR additional bracket fee
}

export const FEE_BRACKETS: FeeBracket[] = [
  { label: "No Profit", minProfit: -Infinity, maxProfit: 0, fee: 0 },
  { label: "Bronze", minProfit: 0, maxProfit: 2_500, fee: 0 },
  { label: "Silver", minProfit: 2_500, maxProfit: 10_000, fee: 197 },
  { label: "Gold", minProfit: 10_000, maxProfit: 25_000, fee: 497 },
  { label: "Platinum", minProfit: 25_000, maxProfit: 50_000, fee: 997 },
  { label: "Diamond", minProfit: 50_000, maxProfit: Infinity, fee: 1_997 },
];

/**
 * Returns the fee bracket for a given quarterly profit amount.
 */
export function getBracket(profit: number): FeeBracket {
  for (const bracket of FEE_BRACKETS) {
    if (profit >= bracket.minProfit && profit < bracket.maxProfit) {
      return bracket;
    }
  }
  // Fallback: no profit bracket
  return FEE_BRACKETS[0];
}

/**
 * Calculates the total quarterly fee: BASE_FEE + bracket fee.
 * If profit <= 0, only the base fee is charged (story 6.4).
 */
export function calculateTotalFee(profit: number): {
  baseFee: number;
  bracketFee: number;
  bracketLabel: string;
  totalFee: number;
} {
  const bracket = getBracket(profit);
  const bracketFee = profit <= 0 ? 0 : bracket.fee;

  return {
    baseFee: BASE_FEE,
    bracketFee,
    bracketLabel: bracket.label,
    totalFee: BASE_FEE + bracketFee,
  };
}

/**
 * Calculates quarterly profit from equity snapshots.
 * profit = (endEquity - startEquity) - netDeposits + netWithdrawals
 */
export function calculateQuarterProfit(
  startEquity: number,
  endEquity: number,
  netDeposits: number,
  netWithdrawals: number
): number {
  return endEquity - startEquity - netDeposits + netWithdrawals;
}
