"use client";

import { useState } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeftRight, ChevronDown, ChevronUp } from "lucide-react";

function formatUsd(value: number | string | null | undefined) {
  const num = Number(value) || 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(num);
}

function formatDate(date: string) {
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const statusColors: Record<string, string> = {
  filled: "border-emerald-500/30 text-emerald-400 bg-emerald-500/10",
  pending: "border-amber-500/30 text-amber-400 bg-amber-500/10",
  failed: "border-red-500/30 text-red-400 bg-red-500/10",
  skipped: "border-slate-500/30 text-slate-400 bg-slate-500/10",
  detected: "border-blue-500/30 text-blue-400 bg-blue-500/10",
  open: "border-cyan-500/30 text-cyan-400 bg-cyan-500/10",
  closed: "border-slate-500/30 text-slate-400 bg-slate-500/10",
};

interface Trade {
  id: string;
  symbol: string;
  side: string;
  quantity: string;
  avgFillPrice: string;
  status: string;
  createdAt: string;
  errorMessage?: string;
  ratioUsed?: string;
  leaderTrade?: {
    symbol: string;
    side: string;
    avgFillPrice: string;
    quantity: string;
  };
}

export default function TradesPage() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["trades", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      params.set("limit", "50");
      const res = await fetch(`/api/trades?${params}`);
      if (!res.ok) return { trades: [] };
      return res.json();
    },
    refetchInterval: 10000,
  });

  const trades: Trade[] = data?.trades || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Trade History</h1>
          <p className="text-sm text-muted-foreground mt-1">
            All your copied trades
          </p>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 bg-[#111827] border-slate-700/50">
            <SelectValue placeholder="Filter" />
          </SelectTrigger>
          <SelectContent className="bg-[#111827] border-slate-700/50">
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="filled">Filled</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="skipped">Skipped</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="bg-[#111827] border-white/[0.06]">
        <CardHeader className="pb-0">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <ArrowLeftRight className="w-4 h-4 text-cyan-400" />
            Trades
            <Badge
              variant="outline"
              className="ml-2 text-xs border-slate-600 text-slate-400"
            >
              {trades.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <div className="w-5 h-5 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
            </div>
          ) : trades.length === 0 ? (
            <div className="text-center py-12 text-sm text-slate-500">
              No trades found
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/[0.06] hover:bg-transparent">
                    <TableHead className="text-xs text-slate-400 uppercase tracking-wider">
                      Time
                    </TableHead>
                    <TableHead className="text-xs text-slate-400 uppercase tracking-wider">
                      Pair
                    </TableHead>
                    <TableHead className="text-xs text-slate-400 uppercase tracking-wider">
                      Side
                    </TableHead>
                    <TableHead className="text-xs text-slate-400 uppercase tracking-wider text-right">
                      Qty
                    </TableHead>
                    <TableHead className="text-xs text-slate-400 uppercase tracking-wider text-right">
                      Price
                    </TableHead>
                    <TableHead className="text-xs text-slate-400 uppercase tracking-wider text-center">
                      Status
                    </TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trades.map((trade) => (
                    <>
                      <TableRow
                        key={trade.id}
                        className="border-white/[0.04] hover:bg-white/[0.02] cursor-pointer"
                        onClick={() =>
                          setExpandedRow(
                            expandedRow === trade.id ? null : trade.id
                          )
                        }
                      >
                        <TableCell className="text-xs text-slate-400 font-mono">
                          {formatDate(trade.createdAt)}
                        </TableCell>
                        <TableCell className="font-medium text-sm">
                          {trade.symbol}
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={`text-[10px] font-mono uppercase ${
                              trade.side === "buy"
                                ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
                                : "bg-red-500/15 text-red-400 border-red-500/20"
                            }`}
                          >
                            {trade.side}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {Number(trade.quantity).toFixed(6)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatUsd(trade.avgFillPrice)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant="outline"
                            className={`text-[10px] font-mono ${statusColors[trade.status] || ""}`}
                          >
                            {trade.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {expandedRow === trade.id ? (
                            <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                          )}
                        </TableCell>
                      </TableRow>
                      {expandedRow === trade.id && (
                        <TableRow
                          key={`${trade.id}-detail`}
                          className="border-white/[0.04]"
                        >
                          <TableCell colSpan={7} className="bg-white/[0.01]">
                            <div className="p-3 space-y-2 text-xs">
                              {trade.ratioUsed && (
                                <div className="flex gap-2">
                                  <span className="text-slate-500">
                                    Copy ratio:
                                  </span>
                                  <span className="font-mono">
                                    {trade.ratioUsed}%
                                  </span>
                                </div>
                              )}
                              {trade.leaderTrade && (
                                <div className="flex gap-2">
                                  <span className="text-slate-500">
                                    Leader:
                                  </span>
                                  <span className="font-mono">
                                    {trade.leaderTrade.side.toUpperCase()}{" "}
                                    {Number(
                                      trade.leaderTrade.quantity
                                    ).toFixed(6)}{" "}
                                    @ {formatUsd(trade.leaderTrade.avgFillPrice)}
                                  </span>
                                </div>
                              )}
                              {trade.errorMessage && (
                                <div className="flex gap-2">
                                  <span className="text-red-400">Error:</span>
                                  <span className="text-red-300">
                                    {trade.errorMessage}
                                  </span>
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
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
