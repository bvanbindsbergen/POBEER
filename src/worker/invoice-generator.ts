import crypto from "crypto";
import { eq, and, gte, lte } from "drizzle-orm";
import { db } from "../lib/db";
import {
  users,
  balanceSnapshots,
  invoices,
  systemConfig,
} from "../lib/db/schema";
import { sendInvoiceEmail } from "../lib/email";

const MAINTENANCE_FEE_PERCENT = 2;

export interface QuarterInfo {
  label: string; // "2026-Q1"
  start: string; // "YYYY-MM-DD"
  end: string; // "YYYY-MM-DD"
  totalDays: number;
}

/**
 * Determines the previous quarter based on the given date (defaults to now).
 * E.g. if currently in Q2 (Apr-Jun), previous quarter is Q1 (Jan-Mar).
 * Handles Q1 -> Q4 of the previous year.
 */
export function getPreviousQuarter(date?: Date): QuarterInfo {
  const now = date ?? new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12

  let qYear: number;
  let qNum: number;
  let start: string;
  let end: string;

  if (month >= 1 && month <= 3) {
    // Currently Q1 -> previous is Q4 of last year
    qYear = year - 1;
    qNum = 4;
    start = `${qYear}-10-01`;
    end = `${qYear}-12-31`;
  } else if (month >= 4 && month <= 6) {
    // Currently Q2 -> previous is Q1
    qYear = year;
    qNum = 1;
    start = `${qYear}-01-01`;
    end = `${qYear}-03-31`;
  } else if (month >= 7 && month <= 9) {
    // Currently Q3 -> previous is Q2
    qYear = year;
    qNum = 2;
    start = `${qYear}-04-01`;
    end = `${qYear}-06-30`;
  } else {
    // Currently Q4 -> previous is Q3
    qYear = year;
    qNum = 3;
    start = `${qYear}-07-01`;
    end = `${qYear}-09-30`;
  }

  // Calculate total days in the quarter
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
  /**
   * Returns true only on the 1st of Jan/Apr/Jul/Oct AND if invoices
   * haven't already been generated for this quarter.
   */
  async shouldRun(): Promise<boolean> {
    const now = new Date();
    const day = now.getDate();
    const month = now.getMonth() + 1; // 1-12

    // Only run on the 1st of quarter-start months
    if (day !== 1 || ![1, 4, 7, 10].includes(month)) {
      return false;
    }

    const quarter = getPreviousQuarter(now);

    // Check if we already ran for this quarter
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

  /**
   * Generate quarterly invoices for all followers.
   * If forceQuarter is provided it overrides the auto-detected previous quarter.
   */
  async run(forceQuarter?: QuarterInfo): Promise<void> {
    const quarter = forceQuarter ?? getPreviousQuarter();

    console.log(
      `[InvoiceGenerator] Generating invoices for ${quarter.label} (${quarter.start} to ${quarter.end}, ${quarter.totalDays} days)`
    );

    // Get all followers
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

    // Record that we ran for this quarter
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

    console.log(
      `[InvoiceGenerator] Updated systemConfig last_invoice_generation = ${quarter.label}`
    );
  }

  /**
   * Generate an invoice for a single follower. Returns true if an invoice
   * was created, false if skipped (no activity or amount below threshold).
   */
  private async generateForFollower(
    follower: typeof users.$inferSelect,
    quarter: QuarterInfo
  ): Promise<boolean> {
    // Fetch balance snapshots within the quarter date range
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

    // Calculate average balance across all snapshot days
    const totalBalance = snapshots.reduce(
      (sum, s) => sum + parseFloat(s.balanceUsdt),
      0
    );
    const avgBalance = totalBalance / daysActive;

    // Prorated quarterly fee: avgBalance * (feePercent/100) * (daysActive / totalDays)
    const invoiceAmount =
      avgBalance *
      (MAINTENANCE_FEE_PERCENT / 100) *
      (daysActive / quarter.totalDays);

    // Skip trivial amounts
    if (invoiceAmount < 0.01) {
      console.log(
        `[InvoiceGenerator] Follower ${follower.email}: invoice amount $${invoiceAmount.toFixed(4)} below $0.01 threshold, skipping.`
      );
      return false;
    }

    // Generate a unique payment token (32 bytes -> 64 hex chars)
    const paymentToken = crypto.randomBytes(32).toString("hex");

    await db.insert(invoices).values({
      followerId: follower.id,
      quarterLabel: quarter.label,
      periodStart: quarter.start,
      periodEnd: quarter.end,
      avgBalance: String(avgBalance),
      feePercent: String(MAINTENANCE_FEE_PERCENT),
      invoiceAmount: String(invoiceAmount),
      daysInQuarter: quarter.totalDays,
      daysActive,
      status: "pending",
      paymentToken,
    });

    console.log(
      `[InvoiceGenerator] Follower ${follower.email}: invoice $${invoiceAmount.toFixed(2)} (avg balance $${avgBalance.toFixed(2)}, ${daysActive}/${quarter.totalDays} days active)`
    );

    // Send email notification
    const emailSent = await sendInvoiceEmail(
      follower.email,
      follower.name,
      quarter.label,
      String(avgBalance),
      String(invoiceAmount),
      daysActive,
      quarter.totalDays,
      paymentToken
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

    return true;
  }
}
