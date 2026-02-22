import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import {
  InvoiceGenerator,
  getPreviousQuarter,
} from "@/worker/invoice-generator";

export async function POST() {
  try {
    await requireRole("leader");

    const generator = new InvoiceGenerator();
    const quarter = getPreviousQuarter();
    await generator.run(quarter);

    return NextResponse.json({
      success: true,
      quarter: quarter.label,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("Invoice generation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
