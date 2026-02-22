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

interface InvoiceBreakdown {
  baseFee: number;
  bracketFee: number;
  bracketLabel: string;
  startEquity: number;
  endEquity: number;
  quarterProfit: number;
  netDeposits: number;
  netWithdrawals: number;
}

export async function sendInvoiceEmail(
  to: string,
  followerName: string,
  quarterLabel: string,
  avgBalance: string,
  invoiceAmount: string,
  daysActive: number,
  daysInQuarter: number,
  paymentToken: string,
  breakdown?: InvoiceBreakdown
): Promise<boolean> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const paymentUrl = `${baseUrl}/invoice/${paymentToken}`;

  const subject = `POBEER — Invoice for ${quarterLabel}`;

  const profitColor = breakdown && breakdown.quarterProfit >= 0 ? "#10b981" : "#ef4444";
  const profitSign = breakdown && breakdown.quarterProfit >= 0 ? "+" : "";

  const breakdownRows = breakdown
    ? `
          <tr><td style="padding: 6px 0;">Start Equity</td><td style="text-align: right; font-family: monospace;">$${breakdown.startEquity.toFixed(2)}</td></tr>
          <tr><td style="padding: 6px 0;">End Equity</td><td style="text-align: right; font-family: monospace;">$${breakdown.endEquity.toFixed(2)}</td></tr>
          <tr><td style="padding: 6px 0;">Net Deposits</td><td style="text-align: right; font-family: monospace;">$${breakdown.netDeposits.toFixed(2)}</td></tr>
          <tr><td style="padding: 6px 0;">Net Withdrawals</td><td style="text-align: right; font-family: monospace;">$${breakdown.netWithdrawals.toFixed(2)}</td></tr>
          <tr><td style="padding: 6px 0;">Quarter Profit</td><td style="text-align: right; font-family: monospace; color: ${profitColor};">${profitSign}$${breakdown.quarterProfit.toFixed(2)}</td></tr>
          <tr><td colspan="2" style="border-top: 1px solid #334155; padding: 0;"></td></tr>
          <tr><td style="padding: 6px 0;">Bracket</td><td style="text-align: right; font-family: monospace; color: #a78bfa;">${breakdown.bracketLabel}</td></tr>
          <tr><td style="padding: 6px 0;">Base Fee</td><td style="text-align: right; font-family: monospace;">€${breakdown.baseFee.toFixed(2)}</td></tr>
          <tr><td style="padding: 6px 0;">Bracket Fee</td><td style="text-align: right; font-family: monospace;">€${breakdown.bracketFee.toFixed(2)}</td></tr>
    `
    : `
          <tr><td style="padding: 6px 0;">Average Balance</td><td style="text-align: right; font-family: monospace;">$${Number(avgBalance).toFixed(2)}</td></tr>
    `;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; background: #0f172a; color: #e2e8f0;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h2 style="color: #e2e8f0; margin: 0;">POBEER</h2>
        <p style="color: #64748b; font-size: 14px; margin: 4px 0 0;">Quarterly Invoice</p>
      </div>
      <p style="color: #94a3b8;">Hi ${followerName},</p>
      <p style="color: #94a3b8;">Your invoice for <strong style="color: #e2e8f0;">${quarterLabel}</strong> is ready.</p>
      <div style="background: #1e293b; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <table style="width: 100%; color: #cbd5e1; font-size: 14px; border-collapse: collapse;">
          ${breakdownRows}
          <tr><td style="padding: 6px 0;">Days Active</td><td style="text-align: right; font-family: monospace;">${daysActive} / ${daysInQuarter}</td></tr>
          <tr><td colspan="2" style="border-top: 1px solid #334155; padding: 0;"></td></tr>
          <tr><td style="padding: 8px 0; font-weight: bold; color: #e2e8f0;">Amount Due</td><td style="text-align: right; font-family: monospace; font-weight: bold; color: #a78bfa; font-size: 20px;">€${Number(invoiceAmount).toFixed(2)}</td></tr>
        </table>
      </div>
      <div style="text-align: center; margin: 24px 0;">
        <a href="${paymentUrl}" style="display: inline-block; background: linear-gradient(to right, #10b981, #06b6d4); color: #022c22; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">View & Pay Invoice</a>
      </div>
      <p style="color: #64748b; font-size: 12px; text-align: center;">You can pay via ByBit internal transfer (free, instant) or mark as manually paid.</p>
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
