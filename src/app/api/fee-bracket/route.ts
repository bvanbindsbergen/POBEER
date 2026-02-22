import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  balanceSnapshots,
  quarterEquitySnapshots,
  transferHistory,
} from "@/lib/db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import {
  calculateTotalFee,
  calculateQuarterProfit,
  FEE_BRACKETS,
  BASE_FEE,
} from "@/lib/fee-brackets";

function getCurrentQuarterInfo() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  let qNum: number;
  let start: string;
  let end: string;

  if (month <= 3) {
    qNum = 1;
    start = `${year}-01-01`;
    end = `${year}-03-31`;
  } else if (month <= 6) {
    qNum = 2;
    start = `${year}-04-01`;
    end = `${year}-06-30`;
  } else if (month <= 9) {
    qNum = 3;
    start = `${year}-07-01`;
    end = `${year}-09-30`;
  } else {
    qNum = 4;
    start = `${year}-10-01`;
    end = `${year}-12-31`;
  }

  return { label: `${year}-Q${qNum}`, start, end };
}

export async function GET() {
  try {
    const auth = await requireAuth();
    const userId = auth.user.id;
    const quarter = getCurrentQuarterInfo();

    // Get equity snapshot for current quarter
    const [equitySnap] = await db
      .select()
      .from(quarterEquitySnapshots)
      .where(
        and(
          eq(quarterEquitySnapshots.userId, userId),
          eq(quarterEquitySnapshots.quarterLabel, quarter.label)
        )
      )
      .limit(1);

    // Get latest balance snapshot as current equity estimate
    const snapshots = await db
      .select()
      .from(balanceSnapshots)
      .where(
        and(
          eq(balanceSnapshots.userId, userId),
          gte(balanceSnapshots.snapshotDate, quarter.start),
          lte(balanceSnapshots.snapshotDate, quarter.end)
        )
      );

    const startEquity = equitySnap?.startEquity
      ? Number(equitySnap.startEquity)
      : Number(snapshots[0]?.balanceUsdt || 0);

    const currentEquity = snapshots.length > 0
      ? Number(snapshots[snapshots.length - 1].balanceUsdt)
      : startEquity;

    // Net deposits/withdrawals so far this quarter
    const [depositSum] = await db
      .select({
        total: sql<string>`coalesce(sum(${transferHistory.amount}::numeric), 0)`,
      })
      .from(transferHistory)
      .where(
        and(
          eq(transferHistory.userId, userId),
          eq(transferHistory.transferType, "deposit"),
          gte(transferHistory.occurredAt, new Date(quarter.start + "T00:00:00Z")),
          lte(transferHistory.occurredAt, new Date(quarter.end + "T23:59:59Z"))
        )
      );

    const [withdrawalSum] = await db
      .select({
        total: sql<string>`coalesce(sum(${transferHistory.amount}::numeric), 0)`,
      })
      .from(transferHistory)
      .where(
        and(
          eq(transferHistory.userId, userId),
          eq(transferHistory.transferType, "withdrawal"),
          gte(transferHistory.occurredAt, new Date(quarter.start + "T00:00:00Z")),
          lte(transferHistory.occurredAt, new Date(quarter.end + "T23:59:59Z"))
        )
      );

    const netDeposits = Number(depositSum?.total) || 0;
    const netWithdrawals = Number(withdrawalSum?.total) || 0;

    const estimatedProfit = calculateQuarterProfit(
      startEquity,
      currentEquity,
      netDeposits,
      netWithdrawals
    );

    const feeEstimate = calculateTotalFee(estimatedProfit);

    return NextResponse.json({
      quarterLabel: quarter.label,
      startEquity,
      currentEquity,
      netDeposits,
      netWithdrawals,
      estimatedProfit,
      baseFee: BASE_FEE,
      bracketFee: feeEstimate.bracketFee,
      bracketLabel: feeEstimate.bracketLabel,
      estimatedTotalFee: feeEstimate.totalFee,
      brackets: FEE_BRACKETS.filter((b) => b.minProfit !== -Infinity),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Fee bracket error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
