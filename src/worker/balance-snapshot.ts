import { db } from "../lib/db";
import { users, balanceSnapshots, systemConfig } from "../lib/db/schema";
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
}
