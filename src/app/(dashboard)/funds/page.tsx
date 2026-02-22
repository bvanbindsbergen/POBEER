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
import {
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  ExternalLink,
  Info,
} from "lucide-react";

function formatUsd(value: number | string | null | undefined) {
  const num = Number(value) || 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(num);
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface Transfer {
  id: string;
  type: string;
  amount: string;
  coin: string;
  occurredAt: string;
}

export default function FundsPage() {
  const { data: balanceData } = useQuery({
    queryKey: ["balance"],
    queryFn: async () => {
      const res = await fetch("/api/balance");
      if (!res.ok) return { currentBalance: null, lastUpdated: null, history: [] };
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: transferData } = useQuery({
    queryKey: ["transfers"],
    queryFn: async () => {
      const res = await fetch("/api/transfers");
      if (!res.ok) return { transfers: [] };
      return res.json();
    },
  });

  const transfers: Transfer[] = transferData?.transfers || [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Funds</h1>
        <p className="text-sm text-muted-foreground mt-1">
          View your balance and deposit/withdrawal history
        </p>
      </div>

      {/* Balance Card */}
      <Card className="bg-[#111827] border-white/[0.06] card-glow">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Current Balance
            </span>
            <Wallet className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-3xl font-bold font-mono text-emerald-400 glow-profit">
            {balanceData?.currentBalance != null
              ? formatUsd(balanceData.currentBalance)
              : "—"}
          </p>
          {balanceData?.lastUpdated && (
            <p className="text-xs text-slate-500 mt-2">
              Last updated: {balanceData.lastUpdated}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Deposit/Withdrawal Guide */}
      <Card className="bg-[#111827] border-white/[0.06]">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Info className="w-4 h-4 text-cyan-400" />
            How to Deposit & Withdraw
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="p-4 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              <div className="flex items-center gap-2 mb-2">
                <ArrowDownLeft className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold">Deposit</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Fund your ByBit account directly through the ByBit app or
                website. You can deposit via bank transfer, credit card, or
                crypto transfer. Deposits appear in your POBEER balance within
                24 hours.
              </p>
              <a
                href="https://www.bybit.com/app/deposit"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-emerald-400 hover:underline inline-flex items-center gap-1 mt-2"
              >
                Go to ByBit Deposit
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="p-4 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              <div className="flex items-center gap-2 mb-2">
                <ArrowUpRight className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-semibold">Withdraw</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Withdraw funds directly through your ByBit account. POBEER does
                not have withdrawal access — your funds are always under your
                control. Note: withdrawals may affect your copy trading
                positions.
              </p>
              <a
                href="https://www.bybit.com/app/withdraw"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-amber-400 hover:underline inline-flex items-center gap-1 mt-2"
              >
                Go to ByBit Withdraw
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Transfer History */}
      <Card className="bg-[#111827] border-white/[0.06]">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <ArrowDownLeft className="w-4 h-4 text-cyan-400" />
            Transfer History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {transfers.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-500">
              No transfers recorded yet
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/[0.06] hover:bg-transparent">
                    <TableHead className="text-xs text-slate-400 uppercase tracking-wider">
                      Type
                    </TableHead>
                    <TableHead className="text-xs text-slate-400 uppercase tracking-wider text-right">
                      Amount
                    </TableHead>
                    <TableHead className="text-xs text-slate-400 uppercase tracking-wider">
                      Coin
                    </TableHead>
                    <TableHead className="text-xs text-slate-400 uppercase tracking-wider">
                      Date
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transfers.map((transfer) => (
                    <TableRow
                      key={transfer.id}
                      className="border-white/[0.04] hover:bg-white/[0.02]"
                    >
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] font-mono ${
                            transfer.type === "deposit"
                              ? "border-emerald-500/30 text-emerald-400"
                              : "border-amber-500/30 text-amber-400"
                          }`}
                        >
                          {transfer.type}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono text-sm ${
                          transfer.type === "deposit"
                            ? "text-emerald-400"
                            : "text-amber-400"
                        }`}
                      >
                        {transfer.type === "deposit" ? "+" : "-"}
                        {formatUsd(transfer.amount)}
                      </TableCell>
                      <TableCell className="text-sm font-mono text-slate-400">
                        {transfer.coin}
                      </TableCell>
                      <TableCell className="text-xs text-slate-400">
                        {formatDate(transfer.occurredAt)}
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
