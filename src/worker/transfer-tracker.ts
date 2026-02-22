import { db } from "../lib/db";
import { users, transferHistory, systemConfig } from "../lib/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "../lib/crypto";
import {
  createExchange,
  fetchDeposits,
  fetchWithdrawals,
} from "../lib/exchange/client";

const CONFIG_KEY = "last_transfer_track";

function todayDateString(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export class TransferTracker {
  /**
   * Returns true if the job has not yet run today.
   */
  async shouldRun(): Promise<boolean> {
    const today = todayDateString();

    const [config] = await db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.key, CONFIG_KEY))
      .limit(1);

    if (!config) return true;
    return config.value !== today;
  }

  /**
   * Fetches recent deposits/withdrawals for every follower with API keys
   * and inserts new records into transfer_history (dedup by bybitTxId).
   */
  async run(): Promise<void> {
    const today = todayDateString();
    console.log(`[TransferTracker] Starting daily transfer tracking for ${today}`);

    const followers = await db
      .select()
      .from(users)
      .where(eq(users.role, "follower"));

    const eligible = followers.filter(
      (f) => f.apiKeyEncrypted && f.apiSecretEncrypted
    );

    console.log(
      `[TransferTracker] Found ${eligible.length} follower(s) with API keys`
    );

    let totalDeposits = 0;
    let totalWithdrawals = 0;

    for (const follower of eligible) {
      const exchange = createExchange({
        apiKey: decrypt(follower.apiKeyEncrypted!),
        apiSecret: decrypt(follower.apiSecretEncrypted!),
      });

      try {
        // Fetch last 30 days of deposits and withdrawals
        const since = Date.now() - 30 * 24 * 60 * 60 * 1000;

        const deposits = await fetchDeposits(exchange, since);
        for (const dep of deposits) {
          try {
            await db.insert(transferHistory).values({
              userId: follower.id,
              transferType: "deposit",
              amount: String(dep.amount),
              coin: dep.currency,
              bybitTxId: dep.txid,
              occurredAt: new Date(dep.timestamp),
            });
            totalDeposits++;
          } catch {
            // Duplicate bybitTxId — already tracked, skip
          }
        }

        const withdrawals = await fetchWithdrawals(exchange, since);
        for (const wd of withdrawals) {
          try {
            await db.insert(transferHistory).values({
              userId: follower.id,
              transferType: "withdrawal",
              amount: String(wd.amount),
              coin: wd.currency,
              bybitTxId: wd.txid,
              occurredAt: new Date(wd.timestamp),
            });
            totalWithdrawals++;
          } catch {
            // Duplicate bybitTxId — already tracked, skip
          }
        }

        console.log(
          `[TransferTracker] ${follower.name}: ${deposits.length} deposits, ${withdrawals.length} withdrawals fetched`
        );
      } catch (err) {
        console.error(
          `[TransferTracker] Failed for ${follower.name} (${follower.email}):`,
          err
        );
      } finally {
        await exchange.close();
      }
    }

    // Mark as completed today
    await db
      .insert(systemConfig)
      .values({ key: CONFIG_KEY, value: today })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: { value: today, updatedAt: new Date() },
      });

    console.log(
      `[TransferTracker] Complete: ${totalDeposits} new deposits, ${totalWithdrawals} new withdrawals tracked`
    );
  }
}
