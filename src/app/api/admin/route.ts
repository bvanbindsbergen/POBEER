import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  users,
  followerTrades,
  positions,
  fees,
  systemConfig,
  invoices,
  balanceSnapshots,
} from "@/lib/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export async function GET() {
  try {
    await requireRole("leader");

    // Get all followers
    const allFollowers = await db
      .select()
      .from(users)
      .where(eq(users.role, "follower"));

    // Enrich followers with stats
    const enrichedFollowers = await Promise.all(
      allFollowers.map(async (follower) => {
        const tradesResult = await db
          .select({
            total: sql<number>`count(*)`,
            successful: sql<number>`count(*) filter (where ${followerTrades.status} = 'filled')`,
          })
          .from(followerTrades)
          .where(eq(followerTrades.followerId, follower.id));

        const pnlResult = await db
          .select({
            totalPnl: sql<number>`coalesce(sum(${positions.realizedPnl}::numeric), 0)`,
          })
          .from(positions)
          .where(
            and(
              eq(positions.userId, follower.id),
              eq(positions.status, "closed")
            )
          );

        // Latest balance snapshot
        const [latestBalance] = await db
          .select({ balanceUsdt: balanceSnapshots.balanceUsdt })
          .from(balanceSnapshots)
          .where(eq(balanceSnapshots.userId, follower.id))
          .orderBy(desc(balanceSnapshots.snapshotDate))
          .limit(1);

        return {
          id: follower.id,
          name: follower.name,
          email: follower.email,
          copyingEnabled: follower.copyingEnabled,
          copyRatioPercent: follower.copyRatioPercent,
          hasApiKeys: !!(
            follower.apiKeyEncrypted && follower.apiSecretEncrypted
          ),
          totalTrades: Number(tradesResult[0]?.total) || 0,
          successfulTrades: Number(tradesResult[0]?.successful) || 0,
          totalPnl: Number(pnlResult[0]?.totalPnl) || 0,
          currentBalance: latestBalance
            ? Number(latestBalance.balanceUsdt)
            : null,
        };
      })
    );

    // Get fee records
    const feeRecords = await db
      .select({
        id: fees.id,
        followerId: fees.followerId,
        profitAmount: fees.profitAmount,
        feeAmount: fees.feeAmount,
        status: fees.status,
        createdAt: fees.createdAt,
        positionId: fees.positionId,
      })
      .from(fees)
      .orderBy(desc(fees.createdAt))
      .limit(50);

    // Enrich fee records with follower name and symbol
    const enrichedFees = await Promise.all(
      feeRecords.map(async (fee) => {
        const follower = allFollowers.find((f) => f.id === fee.followerId);
        const [position] = await db
          .select({ symbol: positions.symbol })
          .from(positions)
          .where(eq(positions.id, fee.positionId))
          .limit(1);

        return {
          ...fee,
          followerName: follower?.name || "Unknown",
          symbol: position?.symbol || "Unknown",
        };
      })
    );

    // Worker health
    const [heartbeat] = await db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.key, "worker_heartbeat"))
      .limit(1);

    // Invoice records
    const invoiceRecords = await db
      .select({
        id: invoices.id,
        followerId: invoices.followerId,
        quarterLabel: invoices.quarterLabel,
        avgBalance: invoices.avgBalance,
        invoiceAmount: invoices.invoiceAmount,
        daysActive: invoices.daysActive,
        daysInQuarter: invoices.daysInQuarter,
        status: invoices.status,
        paidAt: invoices.paidAt,
        paidVia: invoices.paidVia,
        createdAt: invoices.createdAt,
      })
      .from(invoices)
      .orderBy(desc(invoices.createdAt))
      .limit(100);

    const enrichedInvoices = invoiceRecords.map((inv) => {
      const follower = allFollowers.find((f) => f.id === inv.followerId);
      return {
        ...inv,
        followerName: follower?.name || "Unknown",
        followerEmail: follower?.email || "",
      };
    });

    return NextResponse.json({
      followers: enrichedFollowers,
      fees: enrichedFees,
      workerHealth: heartbeat
        ? { lastHeartbeat: heartbeat.value }
        : null,
      invoices: enrichedInvoices,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("Admin error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
