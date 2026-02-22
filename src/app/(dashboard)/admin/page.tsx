"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Shield,
  Users,
  DollarSign,
  Activity,
  Wifi,
  WifiOff,
  Receipt,
  FileText,
} from "lucide-react";

function formatUsd(value: number | string | null | undefined) {
  const num = Number(value) || 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(num);
}

function timeAgo(date: string) {
  const seconds = Math.floor(
    (Date.now() - new Date(date).getTime()) / 1000
  );
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

interface Follower {
  id: string;
  name: string;
  email: string;
  copyingEnabled: boolean;
  copyRatioPercent: string;
  hasApiKeys: boolean;
  totalTrades: number;
  successfulTrades: number;
  totalPnl: number;
  currentBalance: number | null;
}

interface FeeRecord {
  id: string;
  followerName: string;
  symbol: string;
  profitAmount: string;
  feeAmount: string;
  status: string;
  createdAt: string;
}

interface InvoiceRecord {
  id: string;
  followerName: string;
  followerEmail: string;
  quarterLabel: string;
  avgBalance: string;
  invoiceAmount: string;
  daysActive: number;
  daysInQuarter: number;
  baseFee: string | null;
  bracketFee: string | null;
  bracketLabel: string | null;
  quarterProfit: string | null;
  status: string;
  paidAt: string | null;
  paidVia: string | null;
  createdAt: string;
}

export default function AdminPage() {
  const { data: authData } = useQuery({
    queryKey: ["auth"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me");
      if (!res.ok) throw new Error("Not authenticated");
      return res.json();
    },
  });

  const { data: adminData, isLoading } = useQuery({
    queryKey: ["admin"],
    queryFn: async () => {
      const res = await fetch("/api/admin");
      if (!res.ok) return { followers: [], fees: [], workerHealth: null };
      return res.json();
    },
    refetchInterval: 10000,
  });

  const user = authData?.user;
  const followers: Follower[] = adminData?.followers || [];
  const feeRecords: FeeRecord[] = adminData?.fees || [];
  const workerHealth = adminData?.workerHealth;
  const invoiceRecords: InvoiceRecord[] = adminData?.invoices || [];

  if (user?.role !== "leader") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-2">
          <Shield className="w-10 h-10 text-slate-500 mx-auto" />
          <p className="text-lg font-semibold">Access Denied</p>
          <p className="text-sm text-muted-foreground">
            This page is only available to the lead trader
          </p>
        </div>
      </div>
    );
  }

  const workerIsAlive = workerHealth?.lastHeartbeat
    ? Date.now() - new Date(workerHealth.lastHeartbeat).getTime() < 60000
    : false;

  const totalFees = feeRecords.reduce(
    (sum: number, f: FeeRecord) => sum + Number(f.feeAmount),
    0
  );

  const totalInvoiced = invoiceRecords.reduce(
    (sum: number, i: InvoiceRecord) => sum + Number(i.invoiceAmount), 0
  );
  const totalPaid = invoiceRecords
    .filter((i) => i.status === "paid")
    .reduce((sum: number, i: InvoiceRecord) => sum + Number(i.invoiceAmount), 0);
  const totalOutstanding = totalInvoiced - totalPaid;

  async function handleGenerateInvoices() {
    try {
      await fetch("/api/admin/invoices/generate", { method: "POST" });
    } catch (err) {
      console.error("Generate invoices error:", err);
    }
  }

  async function handleMarkPaid(invoiceId: string) {
    try {
      await fetch(`/api/admin/invoices/${invoiceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paid" }),
      });
    } catch (err) {
      console.error("Mark paid error:", err);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Admin Panel</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage followers, view fees, and monitor system health
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-[#111827] border-white/[0.06]">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                Followers
              </span>
              <Users className="w-4 h-4 text-cyan-400" />
            </div>
            <p className="text-2xl font-bold font-mono">{followers.length}</p>
            <p className="text-xs text-slate-500 mt-1">
              {followers.filter((f) => f.copyingEnabled).length} active
            </p>
          </CardContent>
        </Card>

        <Card className="bg-[#111827] border-white/[0.06]">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                Total Fees
              </span>
              <DollarSign className="w-4 h-4 text-emerald-400" />
            </div>
            <p className="text-2xl font-bold font-mono text-emerald-400 glow-profit">
              {formatUsd(totalFees)}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-[#111827] border-white/[0.06]">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                Worker Status
              </span>
              <Activity className="w-4 h-4 text-violet-400" />
            </div>
            <div className="flex items-center gap-2">
              {workerIsAlive ? (
                <>
                  <Wifi className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm font-semibold text-emerald-400">
                    Online
                  </span>
                </>
              ) : (
                <>
                  <WifiOff className="w-4 h-4 text-red-400" />
                  <span className="text-sm font-semibold text-red-400">
                    Offline
                  </span>
                </>
              )}
            </div>
            {workerHealth?.lastHeartbeat && (
              <p className="text-xs text-slate-500 mt-1">
                Last seen: {timeAgo(workerHealth.lastHeartbeat)}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Followers Grid */}
      <Card className="bg-[#111827] border-white/[0.06]">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Users className="w-4 h-4 text-cyan-400" />
            Followers
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="w-5 h-5 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
            </div>
          ) : followers.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-500">
              No followers yet
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {followers.map((follower) => (
                <div
                  key={follower.id}
                  className="p-4 rounded-lg bg-white/[0.02] border border-white/[0.04] space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center">
                        <span className="text-xs font-semibold text-emerald-400">
                          {follower.name[0].toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-medium">{follower.name}</p>
                        <p className="text-xs text-slate-500">
                          {follower.email}
                        </p>
                      </div>
                    </div>
                    <div
                      className={`w-2 h-2 rounded-full ${
                        follower.copyingEnabled
                          ? "bg-emerald-400 animate-pulse-glow"
                          : "bg-slate-600"
                      }`}
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-slate-500">Ratio</span>
                      <p className="font-mono font-medium">
                        {follower.copyRatioPercent}%
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-500">API Keys</span>
                      <p
                        className={
                          follower.hasApiKeys
                            ? "text-emerald-400"
                            : "text-red-400"
                        }
                      >
                        {follower.hasApiKeys ? "Set" : "Missing"}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-500">Balance</span>
                      <p className="font-mono">
                        {follower.currentBalance !== null
                          ? formatUsd(follower.currentBalance)
                          : "—"}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-500">Trades</span>
                      <p className="font-mono">
                        {follower.successfulTrades}/{follower.totalTrades}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-500">P&L</span>
                      <p
                        className={`font-mono ${
                          follower.totalPnl >= 0
                            ? "text-emerald-400"
                            : "text-red-400"
                        }`}
                      >
                        {follower.totalPnl >= 0 ? "+" : ""}
                        {formatUsd(follower.totalPnl)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fee Ledger */}
      <Card className="bg-[#111827] border-white/[0.06]">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-emerald-400" />
            Fee Ledger
          </CardTitle>
        </CardHeader>
        <CardContent>
          {feeRecords.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-500">
              No fees recorded yet
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
                      Pair
                    </TableHead>
                    <TableHead className="text-xs text-slate-400 uppercase tracking-wider text-right">
                      Profit
                    </TableHead>
                    <TableHead className="text-xs text-slate-400 uppercase tracking-wider text-right">
                      Fee (2%)
                    </TableHead>
                    <TableHead className="text-xs text-slate-400 uppercase tracking-wider text-center">
                      Status
                    </TableHead>
                    <TableHead className="text-xs text-slate-400 uppercase tracking-wider">
                      Date
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {feeRecords.map((fee) => (
                    <TableRow
                      key={fee.id}
                      className="border-white/[0.04] hover:bg-white/[0.02]"
                    >
                      <TableCell className="text-sm">
                        {fee.followerName}
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        {fee.symbol}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-emerald-400">
                        +{formatUsd(fee.profitAmount)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-amber-400">
                        {formatUsd(fee.feeAmount)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant="outline"
                          className={`text-[10px] font-mono ${
                            fee.status === "settled"
                              ? "border-emerald-500/30 text-emerald-400"
                              : "border-amber-500/30 text-amber-400"
                          }`}
                        >
                          {fee.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-slate-400 font-mono">
                        {new Date(fee.createdAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quarterly Invoices */}
      <Card className="bg-[#111827] border-white/[0.06]">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Receipt className="w-4 h-4 text-violet-400" />
              Quarterly Invoices
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              className="border-white/[0.06] hover:bg-white/[0.02] text-xs"
              onClick={handleGenerateInvoices}
            >
              <FileText className="w-3.5 h-3.5 mr-1.5" />
              Generate Invoices
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Invoice Summary Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04] text-center">
              <span className="text-xs text-slate-500">Total Invoiced</span>
              <p className="text-lg font-bold font-mono text-violet-400">
                {formatUsd(totalInvoiced)}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04] text-center">
              <span className="text-xs text-slate-500">Total Paid</span>
              <p className="text-lg font-bold font-mono text-emerald-400">
                {formatUsd(totalPaid)}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04] text-center">
              <span className="text-xs text-slate-500">Outstanding</span>
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
                      Profit
                    </TableHead>
                    <TableHead className="text-xs text-slate-400 uppercase tracking-wider text-center">
                      Bracket
                    </TableHead>
                    <TableHead className="text-xs text-slate-400 uppercase tracking-wider text-right">
                      Fee
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
                  {invoiceRecords.map((invoice) => (
                    <TableRow
                      key={invoice.id}
                      className="border-white/[0.04] hover:bg-white/[0.02]"
                    >
                      <TableCell>
                        <div>
                          <p className="text-sm font-medium">
                            {invoice.followerName}
                          </p>
                          <p className="text-xs text-slate-500">
                            {invoice.followerEmail}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm font-mono">
                        {invoice.quarterLabel}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {invoice.quarterProfit != null ? (
                          <span
                            className={
                              Number(invoice.quarterProfit) >= 0
                                ? "text-emerald-400"
                                : "text-red-400"
                            }
                          >
                            {Number(invoice.quarterProfit) >= 0 ? "+" : ""}
                            {formatUsd(invoice.quarterProfit)}
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {invoice.bracketLabel ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] font-mono border-violet-500/30 text-violet-400"
                          >
                            {invoice.bracketLabel}
                          </Badge>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-violet-400">
                        {formatUsd(invoice.invoiceAmount)}
                      </TableCell>
                      <TableCell className="text-center text-sm font-mono text-slate-400">
                        {invoice.daysActive}/{invoice.daysInQuarter}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant="outline"
                          className={`text-[10px] font-mono ${
                            invoice.status === "paid"
                              ? "border-emerald-500/30 text-emerald-400"
                              : invoice.status === "emailed"
                                ? "border-blue-500/30 text-blue-400"
                                : invoice.status === "overdue"
                                  ? "border-red-500/30 text-red-400"
                                  : "border-amber-500/30 text-amber-400"
                          }`}
                        >
                          {invoice.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {invoice.status === "paid" ? (
                          <span className="text-xs text-slate-500">
                            via {invoice.paidVia || "manual"}
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-white/[0.06] hover:bg-white/[0.02] text-xs h-7 px-2"
                            onClick={() => handleMarkPaid(invoice.id)}
                          >
                            Mark Paid
                          </Button>
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
    </div>
  );
}
