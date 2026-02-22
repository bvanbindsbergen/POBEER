import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export async function GET() {
  try {
    const auth = await requireAuth();

    const items = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, auth.user.id))
      .orderBy(desc(notifications.createdAt))
      .limit(50);

    const [unreadCount] = await db
      .select({
        count: sql<number>`count(*)`,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, auth.user.id),
          eq(notifications.read, false)
        )
      );

    return NextResponse.json({
      notifications: items,
      unreadCount: Number(unreadCount?.count) || 0,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Notifications error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const { action, notificationId } = await req.json();

    if (action === "mark_read" && notificationId) {
      await db
        .update(notifications)
        .set({ read: true })
        .where(
          and(
            eq(notifications.id, notificationId),
            eq(notifications.userId, auth.user.id)
          )
        );
    } else if (action === "mark_all_read") {
      await db
        .update(notifications)
        .set({ read: true })
        .where(
          and(
            eq(notifications.userId, auth.user.id),
            eq(notifications.read, false)
          )
        );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Notifications error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
