import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { fetchRedditSentiment } from "@/lib/ai/data/reddit-sentiment";

export async function GET(req: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(req.url);
    const subredditsParam = searchParams.get("subreddits");
    const subreddits = subredditsParam
      ? subredditsParam.split(",")
      : undefined;
    const currency = searchParams.get("currency") || undefined;

    const data = await fetchRedditSentiment(subreddits, currency);

    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Reddit sentiment error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
