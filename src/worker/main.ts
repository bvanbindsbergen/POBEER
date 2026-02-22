import "dotenv/config";
import { db } from "../lib/db";
import { systemConfig, users } from "../lib/db/schema";
import { eq } from "drizzle-orm";
import { LeaderWatcher } from "./leader-watcher";
import { TradeCopier } from "./trade-copier";
import { PositionTracker } from "./position-tracker";
import { FeeCalculator } from "./fee-calculator";
import { Reconciler } from "./reconciler";

const HEARTBEAT_INTERVAL = 15_000; // 15 seconds

class Worker {
  private leaderWatcher: LeaderWatcher | null = null;
  private tradeCopier: TradeCopier;
  private positionTracker: PositionTracker;
  private feeCalculator: FeeCalculator;
  private reconciler: Reconciler;
  private heartbeatTimer: NodeJS.Timeout | null = null;
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

  async shutdown() {
    console.log("[Worker] Shutting down...");
    this.running = false;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
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
