import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const { copyRatioPercent, maxTradeUsd, copyingEnabled } = await req.json();

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
