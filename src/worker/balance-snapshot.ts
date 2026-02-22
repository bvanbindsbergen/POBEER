import { db } from "../lib/db";
import {
  users,
  balanceSnapshots,
  systemConfig,
  quarterEquitySnapshots,
} from "../lib/db/schema";
import { eq, and } from "drizzle-orm";
import { decrypt } from "../lib/crypto";
import { createExchange, fetchUsdtBalance } from "../lib/exchange/client";

const CONFIG_KEY = "last_balance_snapshot";

function todayDateString(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export class BalanceSnapshotJob {
  /**
   * Returns true if the job has not yet run today.
   * Checks the systemConfig key "last_balance_snapshot" against today's date.
   */
  async shouldRun(): Promise<boolean> {
    const today = todayDateString();

    const [config] = await db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.key, CONFIG_KEY))
      .limit(1);

    if (!config) {
      return true;
    }

    return config.value !== today;
  }

  /**
   * Fetches the USDT balance for every follower with API keys configured
   * and upserts a daily snapshot row per user.
   */
  async run(): Promise<void> {
    const today = todayDateString();
    console.log(`[BalanceSnapshot] Starting daily balance snapshot for ${today}`);

    // Fetch all followers that have encrypted API keys
    const followers = await db
      .select()
      .from(users)
      .where(eq(users.role, "follower"));

    const eligible = followers.filter(
      (f) => f.apiKeyEncrypted && f.apiSecretEncrypted
    );

    console.log(
      `[BalanceSnapshot] Found ${eligible.length} follower(s) with API keys (out of ${followers.length} total)`
    );

    let successCount = 0;
    let failCount = 0;

    for (const follower of eligible) {
      const exchange = createExchange({
        apiKey: decrypt(follower.apiKeyEncrypted!),
        apiSecret: decrypt(follower.apiSecretEncrypted!),
      });

      try {
        const balance = await fetchUsdtBalance(exchange);

        // Upsert: one snapshot per user per day
        const [existing] = await db
          .select()
          .from(balanceSnapshots)
          .where(
            and(
              eq(balanceSnapshots.userId, follower.id),
              eq(balanceSnapshots.snapshotDate, today)
            )
          )
          .limit(1);

        if (existing) {
          await db
            .update(balanceSnapshots)
            .set({
              balanceUsdt: String(balance.total),
            })
            .where(eq(balanceSnapshots.id, existing.id));
        } else {
          await db.insert(balanceSnapshots).values({
            userId: follower.id,
            balanceUsdt: String(balance.total),
            snapshotDate: today,
          });
        }

        successCount++;
        console.log(
          `[BalanceSnapshot] ${follower.name} (${follower.email}): $${balance.total.toFixed(2)} USDT`
        );
      } catch (err) {
        failCount++;
        console.error(
          `[BalanceSnapshot] Failed for ${follower.name} (${follower.email}):`,
          err
        );
      } finally {
        await exchange.close();
      }
    }

    // On Q-start days (Jan 1, Apr 1, Jul 1, Oct 1), capture startEquity
    const now = new Date();
    const day = now.getDate();
    const month = now.getMonth() + 1;
    if (day === 1 && [1, 4, 7, 10].includes(month)) {
      await this.captureQuarterStartEquity(eligible, today);
    }

    // On Q-end days (Mar 31, Jun 30, Sep 30, Dec 31), capture endEquity
    const isQEnd =
      (month === 3 && day === 31) ||
      (month === 6 && day === 30) ||
      (month === 9 && day === 30) ||
      (month === 12 && day === 31);
    if (isQEnd) {
      await this.captureQuarterEndEquity(eligible, today);
    }

    // Update systemConfig with today's date to mark completion
    await db
      .insert(systemConfig)
      .values({
        key: CONFIG_KEY,
        value: today,
      })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: {
          value: today,
          updatedAt: new Date(),
        },
      });

    console.log(
      `[BalanceSnapshot] Complete: ${successCount} succeeded, ${failCount} failed out of ${eligible.length} follower(s)`
    );
  }

  /**
   * On Q-start days, upsert a quarter_equity_snapshots row with startEquity
   * equal to today's balance snapshot for each follower.
   */
  private async captureQuarterStartEquity(
    followers: (typeof users.$inferSelect)[],
    today: string
  ): Promise<void> {
    const qLabel = this.getCurrentQuarterLabel();
    console.log(
      `[BalanceSnapshot] Q-start detected — capturing startEquity for ${qLabel}`
    );

    for (const follower of followers) {
      // Get today's snapshot (just upserted above)
      const [snap] = await db
        .select()
        .from(balanceSnapshots)
        .where(
          and(
            eq(balanceSnapshots.userId, follower.id),
            eq(balanceSnapshots.snapshotDate, today)
          )
        )
        .limit(1);

      if (!snap) continue;

      // Check if row exists already
      const [existing] = await db
        .select()
        .from(quarterEquitySnapshots)
        .where(
          and(
            eq(quarterEquitySnapshots.userId, follower.id),
            eq(quarterEquitySnapshots.quarterLabel, qLabel)
          )
        )
        .limit(1);

      if (existing) {
        await db
          .update(quarterEquitySnapshots)
          .set({ startEquity: snap.balanceUsdt })
          .where(eq(quarterEquitySnapshots.id, existing.id));
      } else {
        await db.insert(quarterEquitySnapshots).values({
          userId: follower.id,
          quarterLabel: qLabel,
          startEquity: snap.balanceUsdt,
        });
      }

      console.log(
        `[BalanceSnapshot] ${follower.name}: startEquity for ${qLabel} = $${Number(snap.balanceUsdt).toFixed(2)}`
      );
    }
  }

  /**
   * On Q-end days, update quarter_equity_snapshots with endEquity.
   */
  private async captureQuarterEndEquity(
    followers: (typeof users.$inferSelect)[],
    today: string
  ): Promise<void> {
    const qLabel = this.getCurrentQuarterLabel();
    console.log(
      `[BalanceSnapshot] Q-end detected — capturing endEquity for ${qLabel}`
    );

    for (const follower of followers) {
      const [snap] = await db
        .select()
        .from(balanceSnapshots)
        .where(
          and(
            eq(balanceSnapshots.userId, follower.id),
            eq(balanceSnapshots.snapshotDate, today)
          )
        )
        .limit(1);

      if (!snap) continue;

      const [existing] = await db
        .select()
        .from(quarterEquitySnapshots)
        .where(
          and(
            eq(quarterEquitySnapshots.userId, follower.id),
            eq(quarterEquitySnapshots.quarterLabel, qLabel)
          )
        )
        .limit(1);

      if (existing) {
        await db
          .update(quarterEquitySnapshots)
          .set({ endEquity: snap.balanceUsdt })
          .where(eq(quarterEquitySnapshots.id, existing.id));
      } else {
        // If no Q-start row existed, create one with endEquity only
        await db.insert(quarterEquitySnapshots).values({
          userId: follower.id,
          quarterLabel: qLabel,
          endEquity: snap.balanceUsdt,
        });
      }

      console.log(
        `[BalanceSnapshot] ${follower.name}: endEquity for ${qLabel} = $${Number(snap.balanceUsdt).toFixed(2)}`
      );
    }
  }

  private getCurrentQuarterLabel(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    if (month <= 3) return `${year}-Q1`;
    if (month <= 6) return `${year}-Q2`;
    if (month <= 9) return `${year}-Q3`;
    return `${year}-Q4`;
  }
}
