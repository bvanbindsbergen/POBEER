# Quarterly Maintenance Fee Invoicing — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add quarterly invoicing that charges followers 2% of their average ByBit portfolio balance, with email notifications and ByBit transfer payment.

**Architecture:** Extends existing worker with two new scheduled jobs (daily balance snapshots, quarterly invoice generation). Adds two new DB tables, new API routes for invoice payment, a public invoice page, and an invoices section in the admin panel.

**Tech Stack:** Drizzle ORM (PostgreSQL), Next.js 16 API routes, CCXT (ByBit), nodemailer (email), existing Shadcn UI components.

---

### Task 1: Add Database Schema — balance_snapshots and invoices tables

**Files:**
- Modify: `src/lib/db/schema.ts`

**Step 1: Add the invoice status enum and balance_snapshots table to schema.ts**

After the existing `orderSideEnum` (line 31), add:

```typescript
export const invoiceStatusEnum = pgEnum("invoice_status", [
  "pending",
  "emailed",
  "paid",
  "overdue",
]);
```

After the `systemConfig` table definition (line 146), add:

```typescript
// Balance snapshots (daily ByBit balance fetch)
export const balanceSnapshots = pgTable("balance_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  balanceUsdt: numeric("balance_usdt", { precision: 20, scale: 8 }).notNull(),
  snapshotDate: varchar("snapshot_date", { length: 10 }).notNull(), // "YYYY-MM-DD"
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Quarterly invoices
export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  followerId: uuid("follower_id")
    .notNull()
    .references(() => users.id),
  quarterLabel: varchar("quarter_label", { length: 10 }).notNull(), // "2026-Q1"
  periodStart: varchar("period_start", { length: 10 }).notNull(), // "YYYY-MM-DD"
  periodEnd: varchar("period_end", { length: 10 }).notNull(),
  avgBalance: numeric("avg_balance", { precision: 20, scale: 8 }).notNull(),
  feePercent: numeric("fee_percent", { precision: 5, scale: 2 }).notNull().default("2"),
  invoiceAmount: numeric("invoice_amount", { precision: 20, scale: 8 }).notNull(),
  daysInQuarter: integer("days_in_quarter").notNull(),
  daysActive: integer("days_active").notNull(),
  status: invoiceStatusEnum("status").notNull().default("pending"),
  paidAt: timestamp("paid_at"),
  paidVia: varchar("paid_via", { length: 20 }),
  paymentToken: varchar("payment_token", { length: 255 }).notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

After the existing type exports (line 155), add:

```typescript
export type BalanceSnapshot = typeof balanceSnapshots.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
```

**Step 2: Push schema to database**

Run: `cd /c/POBEER && npx drizzle-kit push`
Expected: Tables `balance_snapshots` and `invoices` created successfully.

**Step 3: Commit**

```bash
git add src/lib/db/schema.ts
git commit -m "feat: add balance_snapshots and invoices tables for quarterly invoicing"
```

---

### Task 2: Create Balance Snapshot Worker Job

**Files:**
- Create: `src/worker/balance-snapshot.ts`

**Step 1: Create the BalanceSnapshotJob class**

```typescript
import { db } from "../lib/db";
import { users, balanceSnapshots, systemConfig } from "../lib/db/schema";
import { eq, and } from "drizzle-orm";
import { decrypt } from "../lib/crypto";
import { createExchange, fetchUsdtBalance } from "../lib/exchange/client";

export class BalanceSnapshotJob {
  async shouldRun(): Promise<boolean> {
    const [config] = await db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.key, "last_balance_snapshot"))
      .limit(1);

    if (!config) return true;

    const lastRun = config.value; // "YYYY-MM-DD"
    const today = new Date().toISOString().split("T")[0];
    return lastRun !== today;
  }

  async run(): Promise<void> {
    const today = new Date().toISOString().split("T")[0];
    console.log(`[BalanceSnapshot] Running daily snapshot for ${today}`);

    // Get all followers with API keys
    const followers = await db
      .select()
      .from(users)
      .where(eq(users.role, "follower"));

    const withKeys = followers.filter(
      (f) => f.apiKeyEncrypted && f.apiSecretEncrypted
    );

    console.log(
      `[BalanceSnapshot] Found ${withKeys.length} followers with API keys`
    );

    for (const follower of withKeys) {
      let exchange = null;
      try {
        const apiKey = decrypt(follower.apiKeyEncrypted!);
        const apiSecret = decrypt(follower.apiSecretEncrypted!);
        exchange = createExchange({ apiKey, apiSecret });

        const balance = await fetchUsdtBalance(exchange);
        const totalBalance = balance.total;

        // Upsert: one snapshot per user per day
        const existing = await db
          .select()
          .from(balanceSnapshots)
          .where(
            and(
              eq(balanceSnapshots.userId, follower.id),
              eq(balanceSnapshots.snapshotDate, today)
            )
          )
          .limit(1);

        if (existing.length === 0) {
          await db.insert(balanceSnapshots).values({
            userId: follower.id,
            balanceUsdt: String(totalBalance),
            snapshotDate: today,
          });
        } else {
          // Update if already exists (re-run safety)
          await db
            .update(balanceSnapshots)
            .set({ balanceUsdt: String(totalBalance) })
            .where(eq(balanceSnapshots.id, existing[0].id));
        }

        console.log(
          `[BalanceSnapshot] ${follower.name}: $${totalBalance.toFixed(2)} USDT`
        );
      } catch (err) {
        console.warn(
          `[BalanceSnapshot] Failed for ${follower.name}:`,
          err instanceof Error ? err.message : err
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

    // Update last run timestamp
    await db
      .insert(systemConfig)
      .values({ key: "last_balance_snapshot", value: today })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: { value: today, updatedAt: new Date() },
      });

    console.log(`[BalanceSnapshot] Daily snapshot complete for ${today}`);
  }
}
```

**Step 2: Commit**

```bash
git add src/worker/balance-snapshot.ts
git commit -m "feat: add daily balance snapshot worker job"
```

---

### Task 3: Create Invoice Generation Worker Job

**Files:**
- Create: `src/worker/invoice-generator.ts`

**Step 1: Create the InvoiceGenerator class**

```typescript
import crypto from "crypto";
import { db } from "../lib/db";
import {
  users,
  balanceSnapshots,
  invoices,
  systemConfig,
} from "../lib/db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";

const MAINTENANCE_FEE_PERCENT = 2;

interface QuarterInfo {
  label: string; // "2026-Q1"
  start: string; // "2026-01-01"
  end: string; // "2026-03-31"
  totalDays: number;
}

function getPreviousQuarter(date: Date = new Date()): QuarterInfo {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed

  let qYear: number;
  let qNum: number;
  let start: string;
  let end: string;

  if (month >= 0 && month <= 2) {
    // Currently Q1 -> previous is Q4 of last year
    qYear = year - 1;
    qNum = 4;
    start = `${qYear}-10-01`;
    end = `${qYear}-12-31`;
  } else if (month >= 3 && month <= 5) {
    // Currently Q2 -> previous is Q1
    qYear = year;
    qNum = 1;
    start = `${qYear}-01-01`;
    end = `${qYear}-03-31`;
  } else if (month >= 6 && month <= 8) {
    // Currently Q3 -> previous is Q2
    qYear = year;
    qNum = 2;
    start = `${qYear}-04-01`;
    end = `${qYear}-06-30`;
  } else {
    // Currently Q4 -> previous is Q3
    qYear = year;
    qNum = 3;
    start = `${qYear}-07-01`;
    end = `${qYear}-09-30`;
  }

  // Calculate total days
  const startDate = new Date(start);
  const endDate = new Date(end);
  const totalDays =
    Math.round(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    ) + 1;

  return {
    label: `${qYear}-Q${qNum}`,
    start,
    end,
    totalDays,
  };
}

export class InvoiceGenerator {
  async shouldRun(): Promise<boolean> {
    const now = new Date();
    const day = now.getUTCDate();
    const month = now.getUTCMonth(); // 0-indexed

    // Only run on 1st of Jan (0), Apr (3), Jul (6), Oct (9)
    const isQuarterStart = [0, 3, 6, 9].includes(month) && day === 1;
    if (!isQuarterStart) return false;

    // Check if already ran for this quarter
    const [config] = await db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.key, "last_invoice_generation"))
      .limit(1);

    if (!config) return true;

    const quarter = getPreviousQuarter(now);
    return config.value !== quarter.label;
  }

  async run(forceQuarter?: QuarterInfo): Promise<void> {
    const quarter = forceQuarter || getPreviousQuarter();
    console.log(
      `[InvoiceGenerator] Generating invoices for ${quarter.label} (${quarter.start} to ${quarter.end})`
    );

    // Get all followers
    const followers = await db
      .select()
      .from(users)
      .where(eq(users.role, "follower"));

    let generated = 0;

    for (const follower of followers) {
      try {
        // Check if invoice already exists for this follower + quarter
        const existing = await db
          .select()
          .from(invoices)
          .where(
            and(
              eq(invoices.followerId, follower.id),
              eq(invoices.quarterLabel, quarter.label)
            )
          )
          .limit(1);

        if (existing.length > 0) {
          console.log(
            `[InvoiceGenerator] Invoice already exists for ${follower.name} in ${quarter.label}`
          );
          continue;
        }

        // Get balance snapshots for this quarter
        const snapshots = await db
          .select()
          .from(balanceSnapshots)
          .where(
            and(
              eq(balanceSnapshots.userId, follower.id),
              gte(balanceSnapshots.snapshotDate, quarter.start),
              lte(balanceSnapshots.snapshotDate, quarter.end)
            )
          );

        if (snapshots.length === 0) {
          console.log(
            `[InvoiceGenerator] No snapshots for ${follower.name} in ${quarter.label}, skipping`
          );
          continue;
        }

        // Calculate average balance
        const totalBalance = snapshots.reduce(
          (sum, s) => sum + Number(s.balanceUsdt),
          0
        );
        const avgBalance = totalBalance / snapshots.length;
        const daysActive = snapshots.length;

        // Prorated fee: avgBalance * 2% * (daysActive / totalDays)
        const invoiceAmount =
          avgBalance *
          (MAINTENANCE_FEE_PERCENT / 100) *
          (daysActive / quarter.totalDays);

        // Skip trivially small invoices
        if (invoiceAmount < 0.01) {
          console.log(
            `[InvoiceGenerator] Invoice too small for ${follower.name}: $${invoiceAmount.toFixed(4)}, skipping`
          );
          continue;
        }

        const paymentToken = crypto.randomBytes(32).toString("hex");

        await db.insert(invoices).values({
          followerId: follower.id,
          quarterLabel: quarter.label,
          periodStart: quarter.start,
          periodEnd: quarter.end,
          avgBalance: String(avgBalance),
          feePercent: String(MAINTENANCE_FEE_PERCENT),
          invoiceAmount: String(invoiceAmount),
          daysInQuarter: quarter.totalDays,
          daysActive,
          status: "pending",
          paymentToken,
        });

        generated++;
        console.log(
          `[InvoiceGenerator] Invoice created for ${follower.name}: $${invoiceAmount.toFixed(2)} (avg balance: $${avgBalance.toFixed(2)}, ${daysActive}/${quarter.totalDays} days)`
        );
      } catch (err) {
        console.error(
          `[InvoiceGenerator] Error for ${follower.name}:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    // Mark as complete
    await db
      .insert(systemConfig)
      .values({ key: "last_invoice_generation", value: quarter.label })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: { value: quarter.label, updatedAt: new Date() },
      });

    console.log(
      `[InvoiceGenerator] Complete: ${generated} invoices generated for ${quarter.label}`
    );
  }
}

export { getPreviousQuarter, type QuarterInfo };
```

**Step 2: Commit**

```bash
git add src/worker/invoice-generator.ts
git commit -m "feat: add quarterly invoice generation worker job"
```

---

### Task 4: Integrate New Jobs into Worker Main Loop

**Files:**
- Modify: `src/worker/main.ts`

**Step 1: Import and instantiate the new jobs**

Add imports after line 9 (after Reconciler import):

```typescript
import { BalanceSnapshotJob } from "./balance-snapshot";
import { InvoiceGenerator } from "./invoice-generator";
```

Add to the Worker class properties (after `private reconciler: Reconciler;`):

```typescript
private balanceSnapshotJob: BalanceSnapshotJob;
private invoiceGenerator: InvoiceGenerator;
private schedulerTimer: NodeJS.Timeout | null = null;
```

In the constructor, after `this.reconciler = new Reconciler(...)`:

```typescript
this.balanceSnapshotJob = new BalanceSnapshotJob();
this.invoiceGenerator = new InvoiceGenerator();
```

**Step 2: Add a scheduler method**

Add this method to the Worker class (before `shutdown()`):

```typescript
private startScheduler() {
  // Check every 5 minutes for jobs that need to run
  const SCHEDULER_INTERVAL = 5 * 60 * 1000;

  const runScheduledJobs = async () => {
    try {
      if (await this.balanceSnapshotJob.shouldRun()) {
        console.log("[Worker] Running daily balance snapshot...");
        await this.balanceSnapshotJob.run();
      }
    } catch (err) {
      console.error("[Worker] Balance snapshot job error:", err);
    }

    try {
      if (await this.invoiceGenerator.shouldRun()) {
        console.log("[Worker] Running quarterly invoice generation...");
        await this.invoiceGenerator.run();
      }
    } catch (err) {
      console.error("[Worker] Invoice generation job error:", err);
    }
  };

  // Run immediately on start, then every 5 minutes
  runScheduledJobs();
  this.schedulerTimer = setInterval(runScheduledJobs, SCHEDULER_INTERVAL);
}
```

**Step 3: Call startScheduler in start()**

After `this.startHeartbeat();` (line 72), add:

```typescript
this.startScheduler();
```

**Step 4: Clean up scheduler in shutdown()**

In the `shutdown()` method, after `clearInterval(this.heartbeatTimer)`, add:

```typescript
if (this.schedulerTimer) {
  clearInterval(this.schedulerTimer);
}
```

**Step 5: Commit**

```bash
git add src/worker/main.ts
git commit -m "feat: integrate balance snapshot and invoice jobs into worker"
```

---

### Task 5: Add Invoice API Routes

**Files:**
- Create: `src/app/api/invoices/route.ts` (admin: list invoices)
- Create: `src/app/api/invoices/[token]/route.ts` (public: get invoice by token)
- Create: `src/app/api/invoices/[token]/pay/route.ts` (public: pay invoice)
- Create: `src/app/api/admin/invoices/generate/route.ts` (admin: manual trigger)
- Create: `src/app/api/admin/invoices/[id]/route.ts` (admin: mark paid)

**Step 1: Create GET /api/invoices — admin list all invoices**

File: `src/app/api/invoices/route.ts`

```typescript
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

    // Get distinct quarters for the filter dropdown
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
```

**Step 2: Create GET /api/invoices/[token] — public invoice lookup by payment token**

File: `src/app/api/invoices/[token]/route.ts`

```typescript
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
```

**Step 3: Create POST /api/invoices/[token]/pay — pay invoice**

File: `src/app/api/invoices/[token]/pay/route.ts`

```typescript
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
    const method: string = body.method; // "bybit_transfer" or "manual"

    if (!["bybit_transfer", "manual"].includes(method)) {
      return NextResponse.json(
        { error: "Invalid payment method" },
        { status: 400 }
      );
    }

    // Find the invoice
    const [invoice] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.paymentToken, token))
      .limit(1);

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    if (invoice.status === "paid") {
      return NextResponse.json({ error: "Invoice already paid" }, { status: 400 });
    }

    if (method === "bybit_transfer") {
      // Get follower's API keys
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

        // ByBit internal transfer
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

    // Mark as paid
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
```

**Step 4: Create POST /api/admin/invoices/generate — manual invoice generation trigger**

File: `src/app/api/admin/invoices/generate/route.ts`

```typescript
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { InvoiceGenerator, getPreviousQuarter } from "@/worker/invoice-generator";

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
```

**Step 5: Create PATCH /api/admin/invoices/[id] — admin mark as paid**

File: `src/app/api/admin/invoices/[id]/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { invoices } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole("leader");

    const { id } = await params;
    const body = await req.json();
    const { status } = body;

    if (!["paid", "overdue"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const updateData: Record<string, unknown> = { status };
    if (status === "paid") {
      updateData.paidAt = new Date();
      updateData.paidVia = "manual";
    }

    await db.update(invoices).set(updateData).where(eq(invoices.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("Invoice update error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
```

**Step 6: Commit**

```bash
git add src/app/api/invoices/ src/app/api/admin/invoices/
git commit -m "feat: add invoice API routes (list, lookup, pay, generate, mark-paid)"
```

---

### Task 6: Add Invoices Section to Admin Panel

**Files:**
- Modify: `src/app/api/admin/route.ts` — add invoice summary data
- Modify: `src/app/(dashboard)/admin/page.tsx` — add invoices UI section

**Step 1: Update admin API to include invoice summary**

In `src/app/api/admin/route.ts`, add to imports:

```typescript
import { invoices } from "@/lib/db/schema";
```

Before the `return NextResponse.json(...)` at line 102, add:

```typescript
// Invoice summary
const invoiceRecords = await db
  .select({
    id: invoices.id,
    followerId: invoices.followerId,
    quarterLabel: invoices.quarterLabel,
    avgBalance: invoices.avgBalance,
    invoiceAmount: invoices.invoiceAmount,
    daysActive: invoices.daysActive,
    daysInQuarter: invoices.daysInQuarter,
    status: invoices.status,
    paidAt: invoices.paidAt,
    paidVia: invoices.paidVia,
    createdAt: invoices.createdAt,
  })
  .from(invoices)
  .orderBy(desc(invoices.createdAt))
  .limit(100);

const enrichedInvoices = invoiceRecords.map((inv) => {
  const follower = allFollowers.find((f) => f.id === inv.followerId);
  return {
    ...inv,
    followerName: follower?.name || "Unknown",
    followerEmail: follower?.email || "",
  };
});

// Get distinct quarters
const availableQuarters = [
  ...new Set(invoiceRecords.map((i) => i.quarterLabel)),
];
```

Update the return to include invoice data:

```typescript
return NextResponse.json({
  followers: enrichedFollowers,
  fees: enrichedFees,
  workerHealth: heartbeat
    ? { lastHeartbeat: heartbeat.value }
    : null,
  invoices: enrichedInvoices,
  availableQuarters,
});
```

**Step 2: Add Invoices section to admin page UI**

In `src/app/(dashboard)/admin/page.tsx`, add the `FileText` and `Receipt` icons to the lucide-react import:

```typescript
import {
  Shield, Users, DollarSign, Activity, Wifi, WifiOff,
  FileText, Receipt,
} from "lucide-react";
```

Add `Button` import:

```typescript
import { Button } from "@/components/ui/button";
```

Add interface for Invoice:

```typescript
interface InvoiceRecord {
  id: string;
  followerName: string;
  followerEmail: string;
  quarterLabel: string;
  avgBalance: string;
  invoiceAmount: string;
  daysActive: number;
  daysInQuarter: number;
  status: string;
  paidAt: string | null;
  paidVia: string | null;
  createdAt: string;
}
```

Extract invoice data from adminData (after the existing feeRecords/workerHealth lines):

```typescript
const invoiceRecords: InvoiceRecord[] = adminData?.invoices || [];
const availableQuarters: string[] = adminData?.availableQuarters || [];
```

Add invoice summary calculations (after `totalFees`):

```typescript
const totalInvoiced = invoiceRecords.reduce(
  (sum: number, i: InvoiceRecord) => sum + Number(i.invoiceAmount),
  0
);
const totalPaid = invoiceRecords
  .filter((i) => i.status === "paid")
  .reduce((sum: number, i: InvoiceRecord) => sum + Number(i.invoiceAmount), 0);
const totalOutstanding = totalInvoiced - totalPaid;
```

Add a `handleGenerateInvoices` function and a `handleMarkPaid` function inside the component:

```typescript
async function handleGenerateInvoices() {
  try {
    const res = await fetch("/api/admin/invoices/generate", { method: "POST" });
    if (!res.ok) throw new Error("Failed to generate");
    // Refetch will happen via 10s polling
  } catch (err) {
    console.error("Generate invoices error:", err);
  }
}

async function handleMarkPaid(invoiceId: string) {
  try {
    const res = await fetch(`/api/admin/invoices/${invoiceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "paid" }),
    });
    if (!res.ok) throw new Error("Failed to update");
  } catch (err) {
    console.error("Mark paid error:", err);
  }
}
```

Add the Invoices card section after the Fee Ledger closing `</Card>` tag. This includes summary stats and the invoice table:

```tsx
{/* Invoices */}
<Card className="bg-[#111827] border-white/[0.06]">
  <CardHeader>
    <div className="flex items-center justify-between">
      <CardTitle className="text-base font-semibold flex items-center gap-2">
        <Receipt className="w-4 h-4 text-violet-400" />
        Quarterly Invoices
      </CardTitle>
      <Button
        variant="outline"
        size="sm"
        onClick={handleGenerateInvoices}
        className="text-xs border-white/[0.08] hover:bg-white/[0.04]"
      >
        Generate Invoices
      </Button>
    </div>
  </CardHeader>
  <CardContent className="space-y-4">
    {/* Invoice Summary */}
    <div className="grid grid-cols-3 gap-3">
      <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
        <p className="text-xs text-slate-500">Total Invoiced</p>
        <p className="text-lg font-bold font-mono text-violet-400">
          {formatUsd(totalInvoiced)}
        </p>
      </div>
      <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
        <p className="text-xs text-slate-500">Total Paid</p>
        <p className="text-lg font-bold font-mono text-emerald-400">
          {formatUsd(totalPaid)}
        </p>
      </div>
      <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
        <p className="text-xs text-slate-500">Outstanding</p>
        <p className="text-lg font-bold font-mono text-amber-400">
          {formatUsd(totalOutstanding)}
        </p>
      </div>
    </div>

    {/* Invoice Table */}
    {invoiceRecords.length === 0 ? (
      <div className="text-center py-8 text-sm text-slate-500">
        No invoices generated yet
      </div>
    ) : (
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-white/[0.06] hover:bg-transparent">
              <TableHead className="text-xs text-slate-400 uppercase tracking-wider">
                Follower
              </TableHead>
              <TableHead className="text-xs text-slate-400 uppercase tracking-wider">
                Quarter
              </TableHead>
              <TableHead className="text-xs text-slate-400 uppercase tracking-wider text-right">
                Avg Balance
              </TableHead>
              <TableHead className="text-xs text-slate-400 uppercase tracking-wider text-right">
                Fee Amount
              </TableHead>
              <TableHead className="text-xs text-slate-400 uppercase tracking-wider text-center">
                Days
              </TableHead>
              <TableHead className="text-xs text-slate-400 uppercase tracking-wider text-center">
                Status
              </TableHead>
              <TableHead className="text-xs text-slate-400 uppercase tracking-wider text-center">
                Action
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoiceRecords.map((inv) => (
              <TableRow
                key={inv.id}
                className="border-white/[0.04] hover:bg-white/[0.02]"
              >
                <TableCell>
                  <div>
                    <p className="text-sm font-medium">{inv.followerName}</p>
                    <p className="text-xs text-slate-500">{inv.followerEmail}</p>
                  </div>
                </TableCell>
                <TableCell className="text-sm font-mono">
                  {inv.quarterLabel}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {formatUsd(inv.avgBalance)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-violet-400">
                  {formatUsd(inv.invoiceAmount)}
                </TableCell>
                <TableCell className="text-center text-xs text-slate-400 font-mono">
                  {inv.daysActive}/{inv.daysInQuarter}
                </TableCell>
                <TableCell className="text-center">
                  <Badge
                    variant="outline"
                    className={`text-[10px] font-mono ${
                      inv.status === "paid"
                        ? "border-emerald-500/30 text-emerald-400"
                        : inv.status === "emailed"
                          ? "border-blue-500/30 text-blue-400"
                          : inv.status === "overdue"
                            ? "border-red-500/30 text-red-400"
                            : "border-amber-500/30 text-amber-400"
                    }`}
                  >
                    {inv.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-center">
                  {inv.status !== "paid" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleMarkPaid(inv.id)}
                      className="text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                    >
                      Mark Paid
                    </Button>
                  )}
                  {inv.status === "paid" && inv.paidVia && (
                    <span className="text-xs text-slate-500">
                      via {inv.paidVia === "bybit_transfer" ? "ByBit" : "manual"}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )}
  </CardContent>
</Card>
```

**Step 3: Commit**

```bash
git add src/app/api/admin/route.ts src/app/(dashboard)/admin/page.tsx
git commit -m "feat: add invoices section to admin panel with summary and table"
```

---

### Task 7: Create Public Invoice Payment Page

**Files:**
- Create: `src/app/invoice/[token]/page.tsx`

**Step 1: Create the invoice payment page**

```tsx
"use client";

import { useState, use } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Beer, CheckCircle, AlertCircle, Loader2 } from "lucide-react";

function formatUsd(value: number | string | null | undefined) {
  const num = Number(value) || 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(num);
}

export default function InvoicePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["invoice", token],
    queryFn: async () => {
      const res = await fetch(`/api/invoices/${token}`);
      if (!res.ok) {
        if (res.status === 404) throw new Error("Invoice not found");
        throw new Error("Failed to load invoice");
      }
      return res.json();
    },
  });

  const payMutation = useMutation({
    mutationFn: async (method: "bybit_transfer" | "manual") => {
      const res = await fetch(`/api/invoices/${token}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Payment failed");
      }
      return res.json();
    },
    onSuccess: () => {
      setPaymentError(null);
      refetch();
    },
    onError: (err: Error) => {
      setPaymentError(err.message);
    },
  });

  const invoice = data?.invoice;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0e17]">
        <div className="flex items-center gap-3 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Loading invoice...</span>
        </div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0e17]">
        <div className="text-center space-y-3">
          <AlertCircle className="w-10 h-10 text-red-400 mx-auto" />
          <p className="text-lg font-semibold text-slate-200">Invoice Not Found</p>
          <p className="text-sm text-slate-500">
            This invoice link may be invalid or expired.
          </p>
        </div>
      </div>
    );
  }

  const isPaid = invoice.status === "paid";

  return (
    <div className="min-h-screen bg-[#0a0e17] text-slate-200 flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3 justify-center">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center">
            <Beer className="w-5 h-5 text-[#022c22]" />
          </div>
          <span className="text-xl font-bold tracking-tight">POBEER</span>
        </div>

        <Card className="bg-[#111827] border-white/[0.06]">
          <CardHeader className="text-center">
            <CardTitle className="text-lg">
              Quarterly Maintenance Invoice
            </CardTitle>
            <p className="text-sm text-slate-400">
              {invoice.quarterLabel} &middot; {invoice.periodStart} to{" "}
              {invoice.periodEnd}
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Invoice Details */}
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Follower</span>
                <span className="font-medium">{invoice.followerName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Average Balance</span>
                <span className="font-mono">{formatUsd(invoice.avgBalance)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Maintenance Fee</span>
                <span className="font-mono">{invoice.feePercent}%</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Days Active</span>
                <span className="font-mono">
                  {invoice.daysActive} / {invoice.daysInQuarter} days
                </span>
              </div>
              <div className="border-t border-white/[0.06] pt-3 flex justify-between">
                <span className="text-slate-300 font-medium">Amount Due</span>
                <span className="text-xl font-bold font-mono text-violet-400">
                  {formatUsd(invoice.invoiceAmount)}
                </span>
              </div>
            </div>

            {/* Status */}
            {isPaid ? (
              <div className="flex flex-col items-center gap-2 py-4">
                <CheckCircle className="w-10 h-10 text-emerald-400" />
                <p className="text-emerald-400 font-semibold">Invoice Paid</p>
                <p className="text-xs text-slate-500">
                  Paid via{" "}
                  {invoice.paidVia === "bybit_transfer"
                    ? "ByBit Transfer"
                    : "Manual Payment"}{" "}
                  on {new Date(invoice.paidAt).toLocaleDateString()}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {paymentError && (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                    {paymentError}
                  </div>
                )}

                <Button
                  onClick={() => payMutation.mutate("bybit_transfer")}
                  disabled={payMutation.isPending}
                  className="w-full bg-gradient-to-r from-emerald-500 to-cyan-500 text-black font-semibold hover:from-emerald-400 hover:to-cyan-400"
                >
                  {payMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : null}
                  Pay {formatUsd(invoice.invoiceAmount)} with ByBit
                </Button>

                <Button
                  variant="outline"
                  onClick={() => payMutation.mutate("manual")}
                  disabled={payMutation.isPending}
                  className="w-full border-white/[0.08] hover:bg-white/[0.04]"
                >
                  I've Paid Manually
                </Button>

                <p className="text-xs text-slate-500 text-center">
                  ByBit payment uses an internal transfer (free, instant) from
                  your ByBit account to the platform account.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/app/invoice/
git commit -m "feat: add public invoice payment page with ByBit transfer option"
```

---

### Task 8: Add Email Support (nodemailer)

**Files:**
- Create: `src/lib/email.ts`
- Modify: `src/worker/invoice-generator.ts` — send emails after creating invoices

**Step 1: Install nodemailer**

Run: `cd /c/POBEER && npm install nodemailer && npm install -D @types/nodemailer`

**Step 2: Create email utility**

File: `src/lib/email.ts`

```typescript
import nodemailer from "nodemailer";

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn("[Email] SMTP not configured, emails will be logged only");
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export async function sendInvoiceEmail(
  to: string,
  followerName: string,
  quarterLabel: string,
  avgBalance: string,
  invoiceAmount: string,
  daysActive: number,
  daysInQuarter: number,
  paymentToken: string
): Promise<boolean> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const paymentUrl = `${baseUrl}/invoice/${paymentToken}`;

  const subject = `POBEER — Invoice for ${quarterLabel}`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #e2e8f0;">POBEER Quarterly Invoice</h2>
      <p style="color: #94a3b8;">Hi ${followerName},</p>
      <p style="color: #94a3b8;">Your maintenance fee invoice for <strong>${quarterLabel}</strong> is ready.</p>
      <div style="background: #1e293b; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <table style="width: 100%; color: #cbd5e1; font-size: 14px;">
          <tr><td style="padding: 4px 0;">Average Balance</td><td style="text-align: right; font-family: monospace;">$${Number(avgBalance).toFixed(2)}</td></tr>
          <tr><td style="padding: 4px 0;">Fee Rate</td><td style="text-align: right; font-family: monospace;">2%</td></tr>
          <tr><td style="padding: 4px 0;">Days Active</td><td style="text-align: right; font-family: monospace;">${daysActive} / ${daysInQuarter}</td></tr>
          <tr style="border-top: 1px solid #334155;"><td style="padding: 8px 0; font-weight: bold; color: #e2e8f0;">Amount Due</td><td style="text-align: right; font-family: monospace; font-weight: bold; color: #a78bfa; font-size: 18px;">$${Number(invoiceAmount).toFixed(2)}</td></tr>
        </table>
      </div>
      <a href="${paymentUrl}" style="display: block; text-align: center; background: linear-gradient(to right, #10b981, #06b6d4); color: #022c22; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 16px 0;">View & Pay Invoice</a>
      <p style="color: #64748b; font-size: 12px;">You can pay via ByBit internal transfer (free, instant) or mark as manually paid.</p>
    </div>
  `;

  const transporter = getTransporter();

  if (!transporter) {
    console.log(`[Email] Would send invoice to ${to}:`);
    console.log(`[Email] Subject: ${subject}`);
    console.log(`[Email] Payment URL: ${paymentUrl}`);
    return false;
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      html,
    });
    console.log(`[Email] Invoice sent to ${to}`);
    return true;
  } catch (err) {
    console.error(`[Email] Failed to send to ${to}:`, err);
    return false;
  }
}
```

**Step 3: Update invoice-generator.ts to send emails**

In `src/worker/invoice-generator.ts`, add import at top:

```typescript
import { sendInvoiceEmail } from "../lib/email";
```

In the `run()` method, after the `await db.insert(invoices).values(...)` block and the `generated++` line (within the follower loop), add:

```typescript
// Send email
const followerUser = follower;
const emailSent = await sendInvoiceEmail(
  followerUser.email,
  followerUser.name,
  quarter.label,
  String(avgBalance),
  String(invoiceAmount),
  daysActive,
  quarter.totalDays,
  paymentToken
);

if (emailSent) {
  await db
    .update(invoices)
    .set({ status: "emailed" })
    .where(
      and(
        eq(invoices.followerId, follower.id),
        eq(invoices.quarterLabel, quarter.label)
      )
    );
}
```

**Step 4: Update .env.example with SMTP variables**

Add to `.env.example`:

```
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
NEXT_PUBLIC_APP_URL=http://localhost:3000
PLATFORM_BYBIT_UID=
```

**Step 5: Commit**

```bash
git add src/lib/email.ts src/worker/invoice-generator.ts .env.example package.json package-lock.json
git commit -m "feat: add email support for invoice notifications"
```

---

### Task 9: Update Admin Follower Cards with Balance Info

**Files:**
- Modify: `src/app/api/admin/route.ts` — add latest balance snapshot per follower
- Modify: `src/app/(dashboard)/admin/page.tsx` — show balance on follower cards

**Step 1: Update admin API to include latest balance**

In `src/app/api/admin/route.ts`, add `balanceSnapshots` to the imports from schema:

```typescript
import {
  users, followerTrades, positions, fees, systemConfig,
  invoices, balanceSnapshots,
} from "@/lib/db/schema";
```

In the `enrichedFollowers` map, after fetching pnlResult, add a query for latest balance:

```typescript
const [latestBalance] = await db
  .select({ balanceUsdt: balanceSnapshots.balanceUsdt })
  .from(balanceSnapshots)
  .where(eq(balanceSnapshots.userId, follower.id))
  .orderBy(desc(balanceSnapshots.snapshotDate))
  .limit(1);
```

Add `currentBalance` to the returned follower object:

```typescript
currentBalance: latestBalance ? Number(latestBalance.balanceUsdt) : null,
```

**Step 2: Show balance on follower cards in admin page**

In the admin page, update the `Follower` interface to include:

```typescript
currentBalance: number | null;
```

In the follower card grid (the `<div className="grid grid-cols-2 gap-2 text-xs">` section), add a new grid item for balance:

```tsx
<div>
  <span className="text-slate-500">Balance</span>
  <p className="font-mono">
    {follower.currentBalance !== null
      ? formatUsd(follower.currentBalance)
      : "—"}
  </p>
</div>
```

Change the grid from `grid-cols-2` to `grid-cols-3` to accommodate the new field, and rearrange if needed.

**Step 3: Commit**

```bash
git add src/app/api/admin/route.ts src/app/(dashboard)/admin/page.tsx
git commit -m "feat: show follower balance from latest snapshot in admin panel"
```

---

### Task 10: Final Integration — Push Schema and Verify

**Step 1: Push updated schema to database**

Run: `cd /c/POBEER && npx drizzle-kit push`

**Step 2: Verify the build succeeds**

Run: `cd /c/POBEER && npm run build`
Expected: Build completes without errors.

**Step 3: Final commit of any remaining changes**

```bash
git add -A
git commit -m "feat: quarterly maintenance fee invoicing system

- Daily balance snapshots from ByBit API
- Quarterly invoice generation (2% of avg balance, prorated)
- Public invoice payment page with ByBit transfer option
- Email notifications via nodemailer
- Admin panel invoices section with summary and actions
- Follower balance display in admin panel"
```
