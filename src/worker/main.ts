import "dotenv/config";
import { db } from "../lib/db";
import { systemConfig, users } from "../lib/db/schema";
import { eq } from "drizzle-orm";
import { LeaderWatcher } from "./leader-watcher";
import { TradeCopier } from "./trade-copier";
import { PositionTracker } from "./position-tracker";
import { FeeCalculator } from "./fee-calculator";
import { Reconciler } from "./reconciler";
import { BalanceSnapshotJob } from "./balance-snapshot";
import { InvoiceGenerator } from "./invoice-generator";
import { TransferTracker } from "./transfer-tracker";
import { PendingTradeExpirer } from "./pending-trade-expirer";

const HEARTBEAT_INTERVAL = 15_000; // 15 seconds
const SCHEDULER_INTERVAL = 5 * 60 * 1_000; // 5 minutes

class Worker {
  private leaderWatcher: LeaderWatcher | null = null;
  private tradeCopier: TradeCopier;
  private positionTracker: PositionTracker;
  private feeCalculator: FeeCalculator;
  private reconciler: Reconciler;
  private balanceSnapshotJob: BalanceSnapshotJob;
  private invoiceGenerator: InvoiceGenerator;
  private transferTracker: TransferTracker;
  private pendingTradeExpirer: PendingTradeExpirer;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private schedulerTimer: NodeJS.Timeout | null = null;
  private expirerTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor() {
    this.positionTracker = new PositionTracker();
    this.feeCalculator = new FeeCalculator();
    this.tradeCopier = new TradeCopier(
      this.positionTracker,
      this.feeCalculator
    );
    this.reconciler = new Reconciler(
      this.positionTracker,
      this.tradeCopier,
      this.feeCalculator
    );
    this.balanceSnapshotJob = new BalanceSnapshotJob();
    this.invoiceGenerator = new InvoiceGenerator();
    this.transferTracker = new TransferTracker();
    this.pendingTradeExpirer = new PendingTradeExpirer();
  }

  async start() {
    console.log("[Worker] Starting POBEER trade copier worker...");

    // Find the leader user
    const [leader] = await db
      .select()
      .from(users)
      .where(eq(users.role, "leader"))
      .limit(1);

    if (!leader) {
      console.error("[Worker] No leader user found. Please create a leader account first.");
      process.exit(1);
    }

    if (!leader.apiKeyEncrypted || !leader.apiSecretEncrypted) {
      console.error("[Worker] Leader has no API keys configured.");
      process.exit(1);
    }

    console.log(`[Worker] Leader found: ${leader.name} (${leader.email})`);

    // Run reconciliation first
    console.log("[Worker] Running reconciliation...");
    await this.reconciler.reconcile(leader);
    console.log("[Worker] Reconciliation complete.");

    // Start the leader watcher
    this.leaderWatcher = new LeaderWatcher(
      leader,
      this.tradeCopier,
      this.positionTracker,
      this.feeCalculator
    );

    this.running = true;
    this.startHeartbeat();
    this.startScheduler();
    this.startPendingTradeExpirer();

    console.log("[Worker] Starting leader order watcher...");
    await this.leaderWatcher.start();
  }

  private startHeartbeat() {
    this.heartbeatTimer = setInterval(async () => {
      try {
        await db
          .insert(systemConfig)
          .values({
            key: "worker_heartbeat",
            value: new Date().toISOString(),
          })
          .onConflictDoUpdate({
            target: systemConfig.key,
            set: {
              value: new Date().toISOString(),
              updatedAt: new Date(),
            },
          });
      } catch (err) {
        console.error("[Worker] Heartbeat failed:", err);
      }
    }, HEARTBEAT_INTERVAL);
  }

  private startScheduler() {
    const runScheduledJobs = async () => {
      try {
        if (await this.balanceSnapshotJob.shouldRun()) {
          console.log("[Worker] Running daily balance snapshot...");
          await this.balanceSnapshotJob.run();
        }
      } catch (err) {
        console.error("[Worker] Balance snapshot job error:", err);
      }

      try {
        if (await this.transferTracker.shouldRun()) {
          console.log("[Worker] Running daily transfer tracking...");
          await this.transferTracker.run();
        }
      } catch (err) {
        console.error("[Worker] Transfer tracker job error:", err);
      }

      try {
        if (await this.invoiceGenerator.shouldRun()) {
          console.log("[Worker] Running quarterly invoice generation...");
          await this.invoiceGenerator.run();
        }
      } catch (err) {
        console.error("[Worker] Invoice generation job error:", err);
      }
    };

    // Run immediately on start, then every 5 minutes
    runScheduledJobs();
    this.schedulerTimer = setInterval(runScheduledJobs, SCHEDULER_INTERVAL);
  }

  private startPendingTradeExpirer() {
    this.expirerTimer = setInterval(async () => {
      try {
        await this.pendingTradeExpirer.run();
      } catch (err) {
        console.error("[Worker] Pending trade expirer error:", err);
      }
    }, 30_000); // every 30 seconds
  }

  async shutdown() {
    console.log("[Worker] Shutting down...");
    this.running = false;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
    }

    if (this.expirerTimer) {
      clearInterval(this.expirerTimer);
    }

    if (this.leaderWatcher) {
      await this.leaderWatcher.stop();
    }

    console.log("[Worker] Shutdown complete.");
    process.exit(0);
  }
}

// Main
const worker = new Worker();

process.on("SIGINT", () => worker.shutdown());
process.on("SIGTERM", () => worker.shutdown());

worker.start().catch((err) => {
  console.error("[Worker] Fatal error:", err);
  process.exit(1);
});
