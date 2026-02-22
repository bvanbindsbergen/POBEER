import crypto from "crypto";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { db } from "../lib/db";
import {
  users,
  balanceSnapshots,
  invoices,
  systemConfig,
  quarterEquitySnapshots,
  transferHistory,
} from "../lib/db/schema";
import { sendInvoiceEmail } from "../lib/email";
import {
  calculateTotalFee,
  calculateQuarterProfit,
} from "../lib/fee-brackets";
import { createNotification } from "../lib/notifications";

export interface QuarterInfo {
  label: string; // "2026-Q1"
  start: string; // "YYYY-MM-DD"
  end: string; // "YYYY-MM-DD"
  totalDays: number;
}

/**
 * Determines the previous quarter based on the given date (defaults to now).
 */
export function getPreviousQuarter(date?: Date): QuarterInfo {
  const now = date ?? new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  let qYear: number;
  let qNum: number;
  let start: string;
  let end: string;

  if (month >= 1 && month <= 3) {
    qYear = year - 1;
    qNum = 4;
    start = `${qYear}-10-01`;
    end = `${qYear}-12-31`;
  } else if (month >= 4 && month <= 6) {
    qYear = year;
    qNum = 1;
    start = `${qYear}-01-01`;
    end = `${qYear}-03-31`;
  } else if (month >= 7 && month <= 9) {
    qYear = year;
    qNum = 2;
    start = `${qYear}-04-01`;
    end = `${qYear}-06-30`;
  } else {
    qYear = year;
    qNum = 3;
    start = `${qYear}-07-01`;
    end = `${qYear}-09-30`;
  }

  const startDate = new Date(start + "T00:00:00Z");
  const endDate = new Date(end + "T00:00:00Z");
  const totalDays =
    Math.round(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    ) + 1;

  return {
    label: `${qYear}-Q${qNum}`,
    start,
    end,
    totalDays,
  };
}

export class InvoiceGenerator {
  async shouldRun(): Promise<boolean> {
    const now = new Date();
    const day = now.getDate();
    const month = now.getMonth() + 1;

    if (day !== 1 || ![1, 4, 7, 10].includes(month)) {
      return false;
    }

    const quarter = getPreviousQuarter(now);

    const [config] = await db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.key, "last_invoice_generation"));

    if (config && config.value === quarter.label) {
      console.log(
        `[InvoiceGenerator] Already generated invoices for ${quarter.label}, skipping.`
      );
      return false;
    }

    return true;
  }

  async run(forceQuarter?: QuarterInfo): Promise<void> {
    const quarter = forceQuarter ?? getPreviousQuarter();

    console.log(
      `[InvoiceGenerator] Generating invoices for ${quarter.label} (${quarter.start} to ${quarter.end}, ${quarter.totalDays} days)`
    );

    const followers = await db
      .select()
      .from(users)
      .where(eq(users.role, "follower"));

    console.log(
      `[InvoiceGenerator] Found ${followers.length} follower(s) to process.`
    );

    let generated = 0;
    let skipped = 0;
    let errored = 0;

    for (const follower of followers) {
      try {
        const created = await this.generateForFollower(follower, quarter);
        if (created) {
          generated++;
        } else {
          skipped++;
        }
      } catch (err) {
        errored++;
        console.error(
          `[InvoiceGenerator] Error processing follower ${follower.id} (${follower.email}):`,
          err
        );
      }
    }

    console.log(
      `[InvoiceGenerator] Done: ${generated} invoices generated, ${skipped} skipped, ${errored} errors.`
    );

    await db
      .insert(systemConfig)
      .values({
        key: "last_invoice_generation",
        value: quarter.label,
      })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: {
          value: quarter.label,
          updatedAt: new Date(),
        },
      });
  }

  private async generateForFollower(
    follower: typeof users.$inferSelect,
    quarter: QuarterInfo
  ): Promise<boolean> {
    // Fetch balance snapshots to determine daysActive
    const snapshots = await db
      .select()
      .from(balanceSnapshots)
      .where(
        and(
          eq(balanceSnapshots.userId, follower.id),
          gte(balanceSnapshots.snapshotDate, quarter.start),
          lte(balanceSnapshots.snapshotDate, quarter.end)
        )
      );

    const daysActive = snapshots.length;

    if (daysActive === 0) {
      console.log(
        `[InvoiceGenerator] Follower ${follower.email}: no snapshots in ${quarter.label}, skipping.`
      );
      return false;
    }

    // Get average balance (still useful for display)
    const totalBalance = snapshots.reduce(
      (sum, s) => sum + parseFloat(s.balanceUsdt),
      0
    );
    const avgBalance = totalBalance / daysActive;

    // Get quarter equity snapshot
    const [equitySnap] = await db
      .select()
      .from(quarterEquitySnapshots)
      .where(
        and(
          eq(quarterEquitySnapshots.userId, follower.id),
          eq(quarterEquitySnapshots.quarterLabel, quarter.label)
        )
      )
      .limit(1);

    // Start/end equity from snapshots, fallback to first/last balance snapshot
    const startEquity = equitySnap?.startEquity
      ? Number(equitySnap.startEquity)
      : Number(snapshots[0]?.balanceUsdt || 0);
    const endEquity = equitySnap?.endEquity
      ? Number(equitySnap.endEquity)
      : Number(snapshots[snapshots.length - 1]?.balanceUsdt || 0);

    // Calculate net deposits and withdrawals from transfer_history
    const [depositSum] = await db
      .select({
        total: sql<string>`coalesce(sum(${transferHistory.amount}::numeric), 0)`,
      })
      .from(transferHistory)
      .where(
        and(
          eq(transferHistory.userId, follower.id),
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
          eq(transferHistory.userId, follower.id),
          eq(transferHistory.transferType, "withdrawal"),
          gte(transferHistory.occurredAt, new Date(quarter.start + "T00:00:00Z")),
          lte(transferHistory.occurredAt, new Date(quarter.end + "T23:59:59Z"))
        )
      );

    const netDeposits = Number(depositSum?.total) || 0;
    const netWithdrawals = Number(withdrawalSum?.total) || 0;

    // Calculate profit: (endEquity - startEquity) - netDeposits + netWithdrawals
    const quarterProfit = calculateQuarterProfit(
      startEquity,
      endEquity,
      netDeposits,
      netWithdrawals
    );

    // Calculate tiered fee
    const feeResult = calculateTotalFee(quarterProfit);

    // Skip if total fee is below threshold
    if (feeResult.totalFee < 0.01) {
      console.log(
        `[InvoiceGenerator] Follower ${follower.email}: fee $${feeResult.totalFee.toFixed(4)} below threshold, skipping.`
      );
      return false;
    }

    // Update the quarter equity snapshot with calculated profit
    if (equitySnap) {
      await db
        .update(quarterEquitySnapshots)
        .set({
          netDeposits: String(netDeposits),
          netWithdrawals: String(netWithdrawals),
          profit: String(quarterProfit),
          bracketLabel: feeResult.bracketLabel,
        })
        .where(eq(quarterEquitySnapshots.id, equitySnap.id));
    }

    const paymentToken = crypto.randomBytes(32).toString("hex");

    await db.insert(invoices).values({
      followerId: follower.id,
      quarterLabel: quarter.label,
      periodStart: quarter.start,
      periodEnd: quarter.end,
      avgBalance: String(avgBalance),
      feePercent: "0", // No longer a flat %, using tiered model
      invoiceAmount: String(feeResult.totalFee),
      daysInQuarter: quarter.totalDays,
      daysActive,
      baseFee: String(feeResult.baseFee),
      bracketFee: String(feeResult.bracketFee),
      bracketLabel: feeResult.bracketLabel,
      startEquity: String(startEquity),
      endEquity: String(endEquity),
      netDeposits: String(netDeposits),
      netWithdrawals: String(netWithdrawals),
      quarterProfit: String(quarterProfit),
      status: "pending",
      paymentToken,
    });

    console.log(
      `[InvoiceGenerator] Follower ${follower.email}: invoice €${feeResult.totalFee.toFixed(2)} (base €${feeResult.baseFee} + bracket €${feeResult.bracketFee} [${feeResult.bracketLabel}], profit $${quarterProfit.toFixed(2)})`
    );

    const emailSent = await sendInvoiceEmail(
      follower.email,
      follower.name,
      quarter.label,
      String(avgBalance),
      String(feeResult.totalFee),
      daysActive,
      quarter.totalDays,
      paymentToken,
      {
        baseFee: feeResult.baseFee,
        bracketFee: feeResult.bracketFee,
        bracketLabel: feeResult.bracketLabel,
        startEquity,
        endEquity,
        quarterProfit,
        netDeposits,
        netWithdrawals,
      }
    );

    if (emailSent) {
      await db
        .update(invoices)
        .set({ status: "emailed" })
        .where(
          and(
            eq(invoices.followerId, follower.id),
            eq(invoices.quarterLabel, quarter.label)
          )
        );
    }

    await createNotification(
      follower.id,
      "invoice_created",
      `Invoice for ${quarter.label}`,
      `Your quarterly invoice of €${feeResult.totalFee.toFixed(2)} is ready (${feeResult.bracketLabel} bracket).`,
      { quarterLabel: quarter.label, totalFee: feeResult.totalFee, bracketLabel: feeResult.bracketLabel }
    );

    return true;
  }
}
