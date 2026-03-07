import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiConversations } from "@/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";

export async function GET() {
  try {
    const auth = await requireAuth();

    const conversations = await db
      .select()
      .from(aiConversations)
      .where(
        and(
          eq(aiConversations.userId, auth.user.id),
          eq(aiConversations.status, "active")
        )
      )
      .orderBy(desc(aiConversations.updatedAt))
      .limit(50);

    return NextResponse.json({ conversations });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const auth = await requireAuth();

    const [conversation] = await db
      .insert(aiConversations)
      .values({
        userId: auth.user.id,
        title: "New Chat",
      })
      .returning();

    return NextResponse.json({ conversation });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
