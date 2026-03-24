import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { AltDataCollector } from "@/worker/alt-data-collector";

export const maxDuration = 120;

export async function POST(_req: NextRequest) {
  try {
    await requireRole("leader");

    const collector = new AltDataCollector();
    await collector.run();

    return NextResponse.json({ success: true, message: "Alt data collection completed" });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[Admin Collect] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
