import type { OrderResult } from "../lib/exchange/types";

export function simulateMarketOrder(
  symbol: string,
  side: "buy" | "sell",
  amount: number,
  currentPrice: number
): OrderResult {
  const slippage = side === "buy" ? 1.0005 : 0.9995;
  const fillPrice = currentPrice * slippage;
  return {
    id: `paper_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    symbol,
    side,
    amount,
    price: fillPrice,
    average: fillPrice,
    filled: amount,
    status: "closed",
  };
}
