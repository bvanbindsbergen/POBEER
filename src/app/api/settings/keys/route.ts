import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { encrypt } from "@/lib/crypto";
import { validateApiKeys } from "@/lib/exchange/client";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const { apiKey, apiSecret } = await req.json();

    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        { error: "API key and secret are required" },
        { status: 400 }
      );
    }

    // Validate keys by testing with fetchBalance
    const valid = await validateApiKeys({ apiKey, apiSecret });
    if (!valid) {
      return NextResponse.json(
        { error: "Invalid API keys. Please check your ByBit API key and secret." },
        { status: 400 }
      );
    }

    // Encrypt and store
    const apiKeyEncrypted = encrypt(apiKey);
    const apiSecretEncrypted = encrypt(apiSecret);

    await db
      .update(users)
      .set({
        apiKeyEncrypted,
        apiSecretEncrypted,
        updatedAt: new Date(),
      })
      .where(eq(users.id, auth.user.id));

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Save keys error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
