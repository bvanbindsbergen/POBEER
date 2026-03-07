import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { systemConfig } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    await requireRole("leader");

    const [row] = await db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.key, "strategy_kill_switch"))
      .limit(1);

    return NextResponse.json({ enabled: row?.value === "true" });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole("leader");
    const body = await req.json();
    const { enabled } = body;

    await db
      .insert(systemConfig)
      .values({
        key: "strategy_kill_switch",
        value: enabled ? "true" : "false",
      })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: {
          value: enabled ? "true" : "false",
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({ enabled: !!enabled });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
