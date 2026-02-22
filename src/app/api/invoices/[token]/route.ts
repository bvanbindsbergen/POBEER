import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { invoices, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    const [result] = await db
      .select({
        id: invoices.id,
        quarterLabel: invoices.quarterLabel,
        periodStart: invoices.periodStart,
        periodEnd: invoices.periodEnd,
        avgBalance: invoices.avgBalance,
        feePercent: invoices.feePercent,
        invoiceAmount: invoices.invoiceAmount,
        daysInQuarter: invoices.daysInQuarter,
        daysActive: invoices.daysActive,
        baseFee: invoices.baseFee,
        bracketFee: invoices.bracketFee,
        bracketLabel: invoices.bracketLabel,
        startEquity: invoices.startEquity,
        endEquity: invoices.endEquity,
        netDeposits: invoices.netDeposits,
        netWithdrawals: invoices.netWithdrawals,
        quarterProfit: invoices.quarterProfit,
        status: invoices.status,
        paidAt: invoices.paidAt,
        paidVia: invoices.paidVia,
        createdAt: invoices.createdAt,
        followerName: users.name,
        followerEmail: users.email,
      })
      .from(invoices)
      .innerJoin(users, eq(invoices.followerId, users.id))
      .where(eq(invoices.paymentToken, token))
      .limit(1);

    if (!result) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    return NextResponse.json({ invoice: result });
  } catch (error) {
    console.error("Invoice lookup error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
