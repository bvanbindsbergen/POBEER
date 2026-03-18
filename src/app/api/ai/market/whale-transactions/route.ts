import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { fetchWhaleTransactions } from "@/lib/ai/data/whale-alert";

export async function GET(req: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(req.url);
    const currency = searchParams.get("currency") || undefined;
    const minUsd = searchParams.get("min_usd")
      ? Number(searchParams.get("min_usd"))
      : undefined;

    const data = await fetchWhaleTransactions(currency, minUsd);

    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Whale transactions error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
