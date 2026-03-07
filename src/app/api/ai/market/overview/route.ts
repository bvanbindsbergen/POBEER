import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { fetchMarketOverview } from "@/lib/ai/data/market";

export async function GET() {
  try {
    await requireAuth();
    const overview = await fetchMarketOverview();
    return NextResponse.json({ overview });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Market overview error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
