import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { generateAiStrategies } from "@/lib/ai/funnel/ai-generator";

// Allow up to 5 minutes for large batch generation
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();

    const body = await req.json();
    const aiBaseCount: number = Math.min(body.count || 20, 1000);
    const targetTotal: number = body.targetTotal || aiBaseCount;
    const userPrompt: string = body.prompt || "";
    const timeframe: string = body.timeframe || "1h";
    const symbols: string[] = body.symbols?.length ? body.symbols : undefined;
    const positionSizePercent: number = body.positionSizePercent || 10;
    const noRiskManagement: boolean = body.noRiskManagement || false;
    const slRange: number[] = body.slRange || [2, 3, 5, 8];
    const tpRange: number[] = body.tpRange || [3, 5, 8, 12, 15];

    const result = await generateAiStrategies({
      count: aiBaseCount,
      targetTotal,
      prompt: userPrompt,
      timeframe,
      symbols,
      positionSizePercent,
      noRiskManagement,
      slRange,
      tpRange,
      userId: auth.user.id,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[Funnel AI Generate] Error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Generation failed: ${msg}` }, { status: 500 });
  }
}
