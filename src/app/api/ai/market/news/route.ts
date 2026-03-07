import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { fetchCryptoNews } from "@/lib/ai/data/news";

export async function GET(req: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(req.url);
    const currenciesParam = searchParams.get("currencies");
    const kind = searchParams.get("kind") || undefined;
    const currencies = currenciesParam ? currenciesParam.split(",") : undefined;

    const news = await fetchCryptoNews(currencies, kind);

    return NextResponse.json({ news });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("News error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
