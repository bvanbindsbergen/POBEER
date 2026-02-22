# Quarterly Maintenance Fee Invoicing — Design

**Date:** 2026-02-22
**Status:** Approved

## Overview

Quarterly maintenance fee system for the POBEER trade copying platform. Every quarter, each follower is invoiced 2% of their average portfolio balance over that period. Followers can pay via ByBit internal transfer or manually.

## Requirements

- Daily balance snapshots fetched from ByBit API per follower
- Calendar quarters (Q1: Jan-Mar, Q2: Apr-Jun, Q3: Jul-Sep, Q4: Oct-Dec)
- Prorated for mid-quarter joiners (fee based on days active)
- Invoice emailed to follower with link to payment page
- Payment options: ByBit internal transfer (auto) or manual
- Admin panel shows all invoices with status, amounts, and actions

## Database Schema

### `balance_snapshots`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | |
| user_id | UUID (FK -> users) | The follower |
| balance_usdt | decimal | USDT balance at snapshot time |
| snapshot_date | date | Calendar date (unique per user per day) |
| created_at | timestamp | When snapshot was taken |

Unique constraint: `(user_id, snapshot_date)`

### `invoices`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | |
| follower_id | UUID (FK -> users) | |
| quarter_label | varchar | e.g. "2026-Q1" |
| period_start | date | Start of quarter |
| period_end | date | End of quarter |
| avg_balance | decimal | Average USDT balance over period |
| fee_percent | decimal | 2% (stored for audit) |
| invoice_amount | decimal | avg_balance * fee_percent * (days_active / days_in_quarter) |
| days_in_quarter | integer | Total days in quarter |
| days_active | integer | Days follower had snapshots |
| status | enum | pending / emailed / paid / overdue |
| paid_at | timestamp | When payment received |
| paid_via | varchar | "bybit_transfer" or "manual" |
| payment_token | varchar (unique) | Secure token for pay link |
| created_at | timestamp | |

## Worker Jobs

### Daily Balance Snapshot (runs daily ~00:00 UTC)

1. Query all followers with encrypted API keys
2. For each: decrypt keys, call fetchBalance() on ByBit
3. Store USDT balance in balance_snapshots with today's date
4. If fetch fails, log warning and skip (no snapshot for that day)
5. Track last run via systemConfig key

### Quarterly Invoice Generation (runs 1st of Apr/Jul/Oct/Jan)

1. Determine previous quarter date range
2. For each follower with snapshots in that quarter:
   - Calculate average: sum(balance_usdt) / count(snapshots)
   - Calculate prorated fee: avg_balance * 0.02 * (days_active / days_in_quarter)
   - Create invoice with status "pending"
   - Generate secure payment_token (32-byte hex)
3. Send email to each follower with invoice details + payment link

## Payment Flow

### Email Content
- Quarter period, average balance, fee breakdown, amount due
- "View & Pay Invoice" button -> /invoice/{paymentToken}

### Invoice Page (/invoice/[token])
- Public page (secured by token, no login required)
- Shows: period, average balance, fee calculation, amount due
- Two buttons:
  - "Pay with ByBit Transfer" -> API call using follower's stored keys to internal-transfer USDT to platform ByBit UID -> marks paid
  - "I've Paid Manually" -> marks paid with paidVia "manual"
- Platform ByBit UID from env var PLATFORM_BYBIT_UID

## Admin Panel — Invoices Section

Added below existing Fee Ledger on /admin page:

- Quarter filter dropdown
- Summary cards: Total Invoiced, Total Paid, Total Outstanding
- Invoice table: Follower | Period | Avg Balance | Fee Amount | Status | Paid Via | Date
- Status badges: pending (yellow), emailed (blue), paid (green), overdue (red)
- Actions: "Mark as Paid", "Resend Email", "Generate Invoices Now"
- Follower cards updated: show current balance + outstanding invoice amount

## Tech Stack

- Integrated into existing worker (approach A)
- Email: nodemailer or similar (new dependency)
- ByBit transfer: CCXT internal transfer API
- No new external services required
