import type { Trade, EquityPoint } from "./types";

export function calculateMetrics(trades: Trade[], equityCurve: EquityPoint[]) {
  if (trades.length === 0) {
    return {
      totalPnl: 0,
      winRate: 0,
      maxDrawdown: 0,
      sharpeRatio: 0,
      profitFactor: 0,
      totalTrades: 0,
      avgWin: 0,
      avgLoss: 0,
      maxConsecutiveWins: 0,
      maxConsecutiveLosses: 0,
    };
  }

  const wins = trades.filter((t) => t.pnlAbsolute > 0);
  const losses = trades.filter((t) => t.pnlAbsolute <= 0);

  const totalPnl = trades.reduce((sum, t) => sum + t.pnlAbsolute, 0);
  const winRate = wins.length / trades.length;

  const avgWin = wins.length > 0
    ? wins.reduce((sum, t) => sum + t.pnlAbsolute, 0) / wins.length
    : 0;
  const avgLoss = losses.length > 0
    ? Math.abs(losses.reduce((sum, t) => sum + t.pnlAbsolute, 0) / losses.length)
    : 0;

  const grossProfit = wins.reduce((sum, t) => sum + t.pnlAbsolute, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnlAbsolute, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Max drawdown from equity curve
  let peak = equityCurve[0]?.equity || 10000;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    if (point.equity > peak) peak = point.equity;
    const dd = (peak - point.equity) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Sharpe ratio (annualized, using trade returns)
  const returns = trades.map((t) => t.pnlPercent / 100);
  const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  const stdReturn = Math.sqrt(
    returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / returns.length
  );
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;

  // Consecutive wins/losses
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;
  let currentWins = 0;
  let currentLosses = 0;
  for (const t of trades) {
    if (t.pnlAbsolute > 0) {
      currentWins++;
      currentLosses = 0;
      maxConsecutiveWins = Math.max(maxConsecutiveWins, currentWins);
    } else {
      currentLosses++;
      currentWins = 0;
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLosses);
    }
  }

  return {
    totalPnl,
    winRate,
    maxDrawdown,
    sharpeRatio,
    profitFactor,
    totalTrades: trades.length,
    avgWin,
    avgLoss,
    maxConsecutiveWins,
    maxConsecutiveLosses,
  };
}
