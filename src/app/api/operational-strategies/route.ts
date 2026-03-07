import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { operationalStrategies } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  try {
    const auth = await requireRole("leader");

    const strategies = await db
      .select()
      .from(operationalStrategies)
      .where(eq(operationalStrategies.userId, auth.user.id))
      .orderBy(desc(operationalStrategies.activatedAt));

    return NextResponse.json({ strategies });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
