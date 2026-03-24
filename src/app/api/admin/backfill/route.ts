import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { AltDataBackfiller } from "@/worker/alt-data-backfill";

export const maxDuration = 300; // 5 min timeout

export async function POST(req: NextRequest) {
  try {
    await requireRole("leader");
    const body = await req.json().catch(() => ({}));
    const days = body.days || 180;

    const backfiller = new AltDataBackfiller(days);
    await backfiller.run();

    return NextResponse.json({ success: true, message: `Backfill completed for ${days} days` });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[Admin Backfill] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
