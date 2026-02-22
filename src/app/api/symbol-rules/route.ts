import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { symbolRules } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function GET() {
  try {
    const auth = await requireAuth();

    const rules = await db
      .select()
      .from(symbolRules)
      .where(eq(symbolRules.userId, auth.user.id));

    return NextResponse.json({ rules });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Symbol rules error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const { symbol, action, customRatio, customMaxUsd } = await req.json();

    if (!symbol || !action) {
      return NextResponse.json(
        { error: "Symbol and action are required" },
        { status: 400 }
      );
    }

    if (!["copy", "skip", "manual"].includes(action)) {
      return NextResponse.json(
        { error: "Action must be 'copy', 'skip', or 'manual'" },
        { status: 400 }
      );
    }

    // Check for existing rule
    const [existing] = await db
      .select()
      .from(symbolRules)
      .where(
        and(
          eq(symbolRules.userId, auth.user.id),
          eq(symbolRules.symbol, symbol.toUpperCase())
        )
      )
      .limit(1);

    if (existing) {
      await db
        .update(symbolRules)
        .set({
          action,
          customRatio: customRatio ? String(customRatio) : null,
          customMaxUsd: customMaxUsd ? String(customMaxUsd) : null,
        })
        .where(eq(symbolRules.id, existing.id));
    } else {
      await db.insert(symbolRules).values({
        userId: auth.user.id,
        symbol: symbol.toUpperCase(),
        action,
        customRatio: customRatio ? String(customRatio) : null,
        customMaxUsd: customMaxUsd ? String(customMaxUsd) : null,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Symbol rules error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const { searchParams } = new URL(req.url);
    const ruleId = searchParams.get("id");

    if (!ruleId) {
      return NextResponse.json(
        { error: "Rule ID is required" },
        { status: 400 }
      );
    }

    await db
      .delete(symbolRules)
      .where(
        and(
          eq(symbolRules.id, ruleId),
          eq(symbolRules.userId, auth.user.id)
        )
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Symbol rules error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
