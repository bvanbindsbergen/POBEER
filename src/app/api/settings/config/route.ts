import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = await req.json();
    const {
      copyRatioPercent,
      maxTradeUsd,
      copyingEnabled,
      dailyLossCapUsd,
      leverageCap,
      allowedMarkets,
      followMode,
      approvalWindowMinutes,
    } = body;

    // Validate
    if (
      copyRatioPercent !== undefined &&
      (copyRatioPercent < 1 || copyRatioPercent > 100)
    ) {
      return NextResponse.json(
        { error: "Copy ratio must be between 1 and 100" },
        { status: 400 }
      );
    }

    // Can't enable copying without API keys
    if (copyingEnabled && !auth.user.apiKeyEncrypted) {
      return NextResponse.json(
        { error: "Please configure API keys before enabling copy trading" },
        { status: 400 }
      );
    }

    if (
      dailyLossCapUsd !== undefined &&
      dailyLossCapUsd !== null &&
      Number(dailyLossCapUsd) < 0
    ) {
      return NextResponse.json(
        { error: "Daily loss cap must be positive" },
        { status: 400 }
      );
    }

    if (
      leverageCap !== undefined &&
      leverageCap !== null &&
      (Number(leverageCap) < 1 || Number(leverageCap) > 100)
    ) {
      return NextResponse.json(
        { error: "Leverage cap must be between 1 and 100" },
        { status: 400 }
      );
    }

    if (allowedMarkets !== undefined && allowedMarkets !== null) {
      if (!Array.isArray(allowedMarkets)) {
        return NextResponse.json(
          { error: "Allowed markets must be an array" },
          { status: 400 }
        );
      }
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (copyRatioPercent !== undefined) {
      updates.copyRatioPercent = String(copyRatioPercent);
    }
    if (maxTradeUsd !== undefined) {
      updates.maxTradeUsd = maxTradeUsd ? String(maxTradeUsd) : null;
    }
    if (copyingEnabled !== undefined) {
      updates.copyingEnabled = copyingEnabled;
    }
    if (dailyLossCapUsd !== undefined) {
      updates.dailyLossCapUsd = dailyLossCapUsd
        ? String(dailyLossCapUsd)
        : null;
    }
    if (leverageCap !== undefined) {
      updates.leverageCap = leverageCap ? String(leverageCap) : null;
    }
    if (allowedMarkets !== undefined) {
      updates.allowedMarkets = allowedMarkets
        ? JSON.stringify(allowedMarkets)
        : null;
    }
    if (followMode !== undefined) {
      if (!["auto", "manual"].includes(followMode)) {
        return NextResponse.json(
          { error: "Follow mode must be 'auto' or 'manual'" },
          { status: 400 }
        );
      }
      updates.followMode = followMode;
    }
    if (approvalWindowMinutes !== undefined) {
      const mins = Number(approvalWindowMinutes);
      if (mins < 1 || mins > 60) {
        return NextResponse.json(
          { error: "Approval window must be between 1 and 60 minutes" },
          { status: 400 }
        );
      }
      updates.approvalWindowMinutes = mins;
    }

    await db.update(users).set(updates).where(eq(users.id, auth.user.id));

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Save config error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
