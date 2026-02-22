"use client";

import { use, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Beer, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

function formatUsd(value: number | string | null | undefined) {
  const num = Number(value) || 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

interface Invoice {
  id: string;
  quarterLabel: string;
  periodStart: string;
  periodEnd: string;
  avgBalance: number;
  feePercent: number;
  invoiceAmount: number;
  daysInQuarter: number;
  daysActive: number;
  status: string;
  paidAt: string | null;
  paidVia: string | null;
  followerName: string;
  followerEmail: string;
  createdAt: string;
}

export default function InvoicePaymentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const queryClient = useQueryClient();
  const [paymentError, setPaymentError] = useState("");

  const {
    data: invoiceData,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["invoice", token],
    queryFn: async () => {
      const res = await fetch(`/api/invoices/${token}`);
      if (!res.ok) throw new Error("Invoice not found");
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
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Payment failed");
      }
      return res.json();
    },
    onSuccess: () => {
      setPaymentError("");
      queryClient.invalidateQueries({ queryKey: ["invoice", token] });
    },
    onError: (err: Error) => {
      setPaymentError(err.message);
    },
  });

  const invoice: Invoice | null = invoiceData?.invoice || null;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0e17] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (isError || !invoice) {
    return (
      <div className="min-h-screen bg-[#0a0e17] flex items-center justify-center">
        <div className="text-center space-y-3">
          <AlertCircle className="w-10 h-10 text-red-400 mx-auto" />
          <p className="text-lg font-semibold text-foreground">
            Invoice Not Found
          </p>
          <p className="text-sm text-muted-foreground">
            This invoice link is invalid or has expired.
          </p>
        </div>
      </div>
    );
  }

  const isPaid = invoice.status === "paid";

  return (
    <div className="min-h-screen bg-[#0a0e17] flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-6">
        {/* Logo Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center">
              <Beer className="w-5 h-5 text-[#022c22]" />
            </div>
            <span className="text-2xl font-bold tracking-tight text-foreground">
              POBEER
            </span>
          </div>
        </div>

        {/* Invoice Card */}
        <Card className="bg-[#111827] border-white/[0.06]">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold text-foreground">
              Quarterly Maintenance Invoice
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {invoice.quarterLabel} &middot; {formatDate(invoice.periodStart)}{" "}
              &ndash; {formatDate(invoice.periodEnd)}
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Invoice Details */}
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-slate-400">Follower</span>
                <span className="text-sm font-medium text-foreground">
                  {invoice.followerName}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-slate-400">Average Balance</span>
                <span className="text-sm font-mono font-medium text-foreground">
                  {formatUsd(invoice.avgBalance)}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-slate-400">Maintenance Fee</span>
                <span className="text-sm font-mono font-medium text-foreground">
                  {invoice.feePercent}%
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-slate-400">Days Active</span>
                <span className="text-sm font-mono font-medium text-foreground">
                  {invoice.daysActive}{" "}
                  <span className="text-slate-500">
                    / {invoice.daysInQuarter}
                  </span>
                </span>
              </div>

              {/* Divider */}
              <div className="border-t border-white/[0.06]" />

              {/* Amount Due */}
              <div className="flex items-center justify-between py-2">
                <span className="text-sm font-semibold text-slate-300">
                  Amount Due
                </span>
                <span className="text-2xl font-bold font-mono text-violet-400">
                  {formatUsd(invoice.invoiceAmount)}
                </span>
              </div>
            </div>

            {/* Paid State */}
            {isPaid && (
              <div className="flex flex-col items-center gap-3 py-6">
                <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center">
                  <CheckCircle className="w-8 h-8 text-emerald-400" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-lg font-semibold text-emerald-400">
                    Invoice Paid
                  </p>
                  <div className="flex items-center gap-2 justify-center">
                    {invoice.paidVia && (
                      <Badge
                        variant="outline"
                        className="text-xs font-mono border-emerald-500/30 text-emerald-400"
                      >
                        {invoice.paidVia === "bybit_transfer"
                          ? "ByBit Transfer"
                          : "Manual Payment"}
                      </Badge>
                    )}
                  </div>
                  {invoice.paidAt && (
                    <p className="text-xs text-slate-500">
                      Paid on {formatDate(invoice.paidAt)}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Unpaid State */}
            {!isPaid && (
              <div className="space-y-3">
                {/* Error display */}
                {paymentError && (
                  <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {paymentError}
                  </div>
                )}

                {/* Pay with ByBit button */}
                <Button
                  onClick={() => payMutation.mutate("bybit_transfer")}
                  disabled={payMutation.isPending}
                  className="w-full h-11 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-white font-semibold shadow-lg shadow-emerald-500/20 transition-all duration-200"
                >
                  {payMutation.isPending ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing...
                    </span>
                  ) : (
                    `Pay ${formatUsd(invoice.invoiceAmount)} with ByBit`
                  )}
                </Button>

                {/* Manual payment button */}
                <Button
                  variant="outline"
                  onClick={() => payMutation.mutate("manual")}
                  disabled={payMutation.isPending}
                  className="w-full h-11 border-white/[0.06] hover:bg-white/[0.04] text-slate-300"
                >
                  I&apos;ve Paid Manually
                </Button>

                <p className="text-xs text-center text-slate-500 leading-relaxed">
                  &ldquo;Pay with ByBit&rdquo; will record an internal transfer
                  from your ByBit account. If you have already sent the funds
                  manually, click &ldquo;I&apos;ve Paid Manually&rdquo; instead.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
