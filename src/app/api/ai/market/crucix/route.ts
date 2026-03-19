import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { fetchCrucixIntelligence } from "@/lib/ai/data/crucix";

export async function GET() {
  try {
    await requireAuth();
    const intel = await fetchCrucixIntelligence();
    if (!intel) {
      return NextResponse.json({ available: false, message: "Crucix not configured" });
    }
    return NextResponse.json(intel);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[Crucix API] Error:", error);
    return NextResponse.json({ error: "Failed to fetch intelligence" }, { status: 500 });
  }
}
