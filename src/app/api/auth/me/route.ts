import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET() {
  try {
    const auth = await getSession();
    if (!auth) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { user } = auth;
    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        copyRatioPercent: user.copyRatioPercent,
        maxTradeUsd: user.maxTradeUsd,
        copyingEnabled: user.copyingEnabled,
        hasApiKeys: !!(user.apiKeyEncrypted && user.apiSecretEncrypted),
      },
    });
  } catch (error) {
    console.error("Me error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
