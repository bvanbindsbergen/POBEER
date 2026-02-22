import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { invoices, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { createExchange } from "@/lib/exchange/client";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const body = await req.json();
    const method: string = body.method;

    if (!["bybit_transfer", "manual"].includes(method)) {
      return NextResponse.json(
        { error: "Invalid payment method" },
        { status: 400 }
      );
    }

    const [invoice] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.paymentToken, token))
      .limit(1);

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    if (invoice.status === "paid") {
      return NextResponse.json(
        { error: "Invoice already paid" },
        { status: 400 }
      );
    }

    if (method === "bybit_transfer") {
      const [follower] = await db
        .select()
        .from(users)
        .where(eq(users.id, invoice.followerId))
        .limit(1);

      if (!follower?.apiKeyEncrypted || !follower?.apiSecretEncrypted) {
        return NextResponse.json(
          { error: "No API keys configured. Please pay manually." },
          { status: 400 }
        );
      }

      const platformUid = process.env.PLATFORM_BYBIT_UID;
      if (!platformUid) {
        return NextResponse.json(
          { error: "Platform payment not configured" },
          { status: 500 }
        );
      }

      let exchange = null;
      try {
        const apiKey = decrypt(follower.apiKeyEncrypted);
        const apiSecret = decrypt(follower.apiSecretEncrypted);
        exchange = createExchange({ apiKey, apiSecret });

        const amount = Number(invoice.invoiceAmount);
        await exchange.transfer("USDT", amount, "spot", "spot", {
          toMemberId: platformUid,
        });

        console.log(
          `[Invoice] ByBit transfer: $${amount.toFixed(2)} from ${follower.name} to platform`
        );
      } catch (err) {
        console.error("[Invoice] ByBit transfer failed:", err);
        return NextResponse.json(
          {
            error: `ByBit transfer failed: ${err instanceof Error ? err.message : "Unknown error"}. Please try manual payment.`,
          },
          { status: 400 }
        );
      } finally {
        if (exchange) {
          try {
            await exchange.close();
          } catch {
            // ignore
          }
        }
      }
    }

    await db
      .update(invoices)
      .set({
        status: "paid",
        paidAt: new Date(),
        paidVia: method,
      })
      .where(eq(invoices.id, invoice.id));

    return NextResponse.json({ success: true, status: "paid" });
  } catch (error) {
    console.error("Invoice payment error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
