import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { invoices, users } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    await requireRole("leader");

    const quarter = req.nextUrl.searchParams.get("quarter");

    let query = db
      .select({
        id: invoices.id,
        followerId: invoices.followerId,
        quarterLabel: invoices.quarterLabel,
        periodStart: invoices.periodStart,
        periodEnd: invoices.periodEnd,
        avgBalance: invoices.avgBalance,
        feePercent: invoices.feePercent,
        invoiceAmount: invoices.invoiceAmount,
        daysInQuarter: invoices.daysInQuarter,
        daysActive: invoices.daysActive,
        status: invoices.status,
        paidAt: invoices.paidAt,
        paidVia: invoices.paidVia,
        createdAt: invoices.createdAt,
        followerName: users.name,
        followerEmail: users.email,
      })
      .from(invoices)
      .innerJoin(users, eq(invoices.followerId, users.id))
      .orderBy(desc(invoices.createdAt))
      .$dynamic();

    if (quarter) {
      query = query.where(eq(invoices.quarterLabel, quarter));
    }

    const results = await query.limit(200);

    const quarters = await db
      .selectDistinct({ quarterLabel: invoices.quarterLabel })
      .from(invoices)
      .orderBy(desc(invoices.quarterLabel));

    return NextResponse.json({
      invoices: results,
      quarters: quarters.map((q) => q.quarterLabel),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("Invoices list error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
