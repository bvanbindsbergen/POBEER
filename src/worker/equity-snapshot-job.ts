import { db } from "../lib/db";
import {
  operationalStrategies,
  strategyEquitySnapshots,
  systemConfig,
} from "../lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { fetchCandles } from "../lib/ai/data/candles";

const CONFIG_KEY = "last_equity_snapshot_date";

function todayDateString(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export class EquitySnapshotJob {
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

    if (!config) {
      return true;
    }

    return config.value !== today;
  }

  /**
   * For each active/paused operational strategy, snapshot the totalPnl + unrealized PnL.
   */
  async run(): Promise<void> {
    const today = todayDateString();
    console.log(`[EquitySnapshot] Starting daily equity snapshot for ${today}`);

    // Fetch all active or paused strategies
    const strategies = await db
      .select()
      .from(operationalStrategies)
      .where(
        inArray(operationalStrategies.status, ["active", "paused"])
      );

    console.log(
      `[EquitySnapshot] Found ${strategies.length} active/paused strategies`
    );

    let successCount = 0;
    let failCount = 0;

    for (const strategy of strategies) {
      try {
        let unrealizedPnl = 0;

        // If strategy is in position, compute unrealized PnL from current price
        if (
          strategy.inPosition &&
          strategy.entryPrice &&
          strategy.entryQuantity
        ) {
          try {
            const candles = await fetchCandles(
              strategy.symbol,
              strategy.timeframe,
              1,
              1
            );
            if (candles.length > 0) {
              const currentPrice = candles[candles.length - 1].close;
              unrealizedPnl =
                (currentPrice - strategy.entryPrice) * strategy.entryQuantity;
            }
          } catch (err) {
            console.error(
              `[EquitySnapshot] Failed to fetch candles for ${strategy.symbol}:`,
              err
            );
            // Continue with unrealizedPnl = 0
          }
        }

        const equity = (strategy.totalPnl ?? 0) + unrealizedPnl;

        // Upsert: one snapshot per strategy per day
        const [existing] = await db
          .select()
          .from(strategyEquitySnapshots)
          .where(
            eq(strategyEquitySnapshots.strategyId, strategy.id)
          )
          .limit(1)
          .then((rows) =>
            rows.filter((r) => r.snapshotDate === today)
          );

        if (existing) {
          await db
            .update(strategyEquitySnapshots)
            .set({
              equity,
              unrealizedPnl,
            })
            .where(eq(strategyEquitySnapshots.id, existing.id));
        } else {
          await db.insert(strategyEquitySnapshots).values({
            strategyId: strategy.id,
            equity,
            unrealizedPnl,
            snapshotDate: today,
          });
        }

        successCount++;
        console.log(
          `[EquitySnapshot] ${strategy.name} (${strategy.symbol}): equity=$${equity.toFixed(2)}, unrealized=$${unrealizedPnl.toFixed(2)}`
        );
      } catch (err) {
        failCount++;
        console.error(
          `[EquitySnapshot] Failed for ${strategy.name} (${strategy.symbol}):`,
          err
        );
      }
    }

    // Update systemConfig with today's date
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
      `[EquitySnapshot] Complete: ${successCount} succeeded, ${failCount} failed out of ${strategies.length} strategies`
    );
  }
}
