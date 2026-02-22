import { db } from "./db";
import { notifications } from "./db/schema";

export async function createNotification(
  userId: string,
  type: string,
  title: string,
  message: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await db.insert(notifications).values({
      userId,
      type,
      title,
      message,
      metadata: metadata ? JSON.stringify(metadata) : null,
    });
  } catch (err) {
    console.error("[Notifications] Failed to create notification:", err);
  }
}
