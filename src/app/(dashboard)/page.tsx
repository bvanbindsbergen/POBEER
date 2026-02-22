"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  BarChart3,
  Rocket,
  Check,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

function formatUsd(value: number | string | null | undefined) {
  const num = Number(value) || 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

function formatCrypto(value: number | string | null | undefined) {
  const num = Number(value) || 0;
  return num.toFixed(6);
}

export default function OverviewPage() {
  const { data: authData } = useQuery({
    queryKey: ["auth"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me");
      if (!res.ok) throw new Error("Not authenticated");
      return res.json();
    },
  });

  const { data: positionsData } = useQuery({
    queryKey: ["positions"],
    queryFn: async () => {
      const res = await fetch("/api/positions");
      if (!res.ok) return { positions: [], summary: null };
      return res.json();
    },
    refetchInterval: 10000,
  });

  const { data: tradesData } = useQuery({
    queryKey: ["recent-trades"],
    queryFn: async () => {
      const res = await fetch("/api/trades?limit=5");
      if (!res.ok) return { trades: [] };
      return res.json();
    },
    refetchInterval: 10000,
  });

  const { data: bracketData } = useQuery({
    queryKey: ["fee-bracket"],
    queryFn: async () => {
      const res = await fetch("/api/fee-bracket");
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 60000,
  });

  const { data: balanceData } = useQuery({
    queryKey: ["balance"],
    queryFn: async () => {
      const res = await fetch("/api/balance");
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: pendingData } = useQuery({
    queryKey: ["pending-trades"],
    queryFn: async () => {
      const res = await fetch("/api/pending-trades");
      if (!res.ok) return { pendingTrades: [] };
      return res.json();
    },
    refetchInterval: 5000,
  });

  const queryClient = useQueryClient();
  const decideMutation = useMutation({
    mutationFn: async ({
      id,
      decision,
    }: {
      id: string;
      decision: "approve" | "reject";
    }) => {
      const res = await fetch(`/api/pending-trades/${id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed");
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      toast.success(
        variables.decision === "approve" ? "Trade approved" : "Trade rejected"
      );
      queryClient.invalidateQueries({ queryKey: ["pending-trades"] });
      queryClient.invalidateQueries({ queryKey: ["positions"] });
      queryClient.invalidateQueries({ queryKey: ["recent-trades"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const activePendingTrades = (pendingData?.pendingTrades || []).filter(
    (t: { status: string }) => t.status === "pending"
  );

  const user = authData?.user;
  const positions = positionsData?.positions || [];
  const summary = positionsData?.summary || {
    totalPnl: 0,
    openPositions: 0,
    totalTrades: 0,
  };
  const recentTrades = tradesData?.trades || [];
  const openPositions = positions.filter(
    (p: { status: string }) => p.status === "open"
  );
  const totalPnl = Number(summary.totalPnl) || 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome back,{" "}
          <span className="text-emerald-400">{user?.name || "Trader"}</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Here&apos;s your trading overview
        </p>
      </div>

      {/* Setup Banner */}
      {user?.role === "follower" && !user?.hasApiKeys && (
        <Card className="bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 border-emerald-500/20">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Rocket className="w-5 h-5 text-emerald-400" />
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Complete Your Setup
                  </p>
                  <p className="text-xs text-slate-400">
                    Add your ByBit API keys to start copy trading
                  </p>
                </div>
              </div>
              <Link href="/onboarding">
                <Button
                  size="sm"
                  className="bg-emerald-500 hover:bg-emerald-400 text-white"
                >
                  Get Started
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total PnL */}
        <Card className="bg-[#111827] border-white/[0.06] card-glow">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                Total P&L
              </span>
              {totalPnl >= 0 ? (
                <TrendingUp className="w-4 h-4 text-emerald-400" />
              ) : (
                <TrendingDown className="w-4 h-4 text-red-400" />
              )}
            </div>
            <p
              className={`text-2xl font-bold font-mono ${
                totalPnl >= 0
                  ? "text-emerald-400 glow-profit"
                  : "text-red-400 glow-loss"
              }`}
            >
              {totalPnl >= 0 ? "+" : ""}
              {formatUsd(totalPnl)}
            </p>
          </CardContent>
        </Card>

        {/* Open Positions */}
        <Card className="bg-[#111827] border-white/[0.06]">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                Open Positions
              </span>
              <Activity className="w-4 h-4 text-cyan-400" />
            </div>
            <p className="text-2xl font-bold font-mono text-foreground">
              {openPositions.length}
            </p>
          </CardContent>
        </Card>

        {/* Total Trades */}
        <Card className="bg-[#111827] border-white/[0.06]">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                Total Trades
              </span>
              <ArrowUpRight className="w-4 h-4 text-amber-400" />
            </div>
            <p className="text-2xl font-bold font-mono text-foreground">
              {summary.totalTrades || 0}
            </p>
          </CardContent>
        </Card>

        {/* Balance */}
        {balanceData?.currentBalance != null && user?.role === "follower" ? (
          <Card className="bg-[#111827] border-white/[0.06]">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Balance
                </span>
                <Wallet className="w-4 h-4 text-emerald-400" />
              </div>
              <p className="text-2xl font-bold font-mono text-foreground">
                {formatUsd(balanceData.currentBalance)}
              </p>
              <div className="flex items-center gap-2 mt-1">
                {user?.copyingEnabled ? (
                  <>
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-glow" />
                    <span className="text-xs text-emerald-400">Copying</span>
                  </>
                ) : (
                  <>
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                    <span className="text-xs text-slate-400">Inactive</span>
                  </>
                )}
                {user?.copyRatioPercent && (
                  <span className="text-xs text-slate-500 ml-auto">
                    {user.copyRatioPercent}% ratio
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-[#111827] border-white/[0.06]">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Copy Status
                </span>
                <Wallet className="w-4 h-4 text-violet-400" />
              </div>
              <div className="flex items-center gap-2">
                {user?.copyingEnabled ? (
                  <>
                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-glow" />
                    <span className="text-sm font-semibold text-emerald-400">
                      Active
                    </span>
                  </>
                ) : (
                  <>
                    <div className="w-2 h-2 rounded-full bg-slate-500" />
                    <span className="text-sm font-semibold text-slate-400">
                      Inactive
                    </span>
                  </>
                )}
                {user?.copyRatioPercent && (
                  <span className="text-xs text-slate-500 ml-auto">
                    {user.copyRatioPercent}% ratio
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Pending Trades (Manual Approval Mode) */}
      {activePendingTrades.length > 0 && (
        <Card className="bg-[#111827] border-amber-500/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400" />
              Pending Trades
              <Badge
                variant="outline"
                className="ml-auto text-xs border-amber-500/30 text-amber-400"
              >
                {activePendingTrades.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {activePendingTrades.map(
                (trade: {
                  id: string;
                  symbol: string;
                  side: string;
                  suggestedQuantity: string;
                  leaderFillPrice: string;
                  expiresAt: string;
                }) => (
                  <div
                    key={trade.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-amber-500/10"
                  >
                    <div className="flex items-center gap-3">
                      <Badge
                        variant="outline"
                        className={`text-xs font-mono ${
                          trade.side === "buy"
                            ? "border-emerald-500/30 text-emerald-400"
                            : "border-red-500/30 text-red-400"
                        }`}
                      >
                        {trade.side.toUpperCase()}
                      </Badge>
                      <div>
                        <p className="text-sm font-medium">{trade.symbol}</p>
                        <p className="text-xs text-slate-500 font-mono">
                          {Number(trade.suggestedQuantity).toFixed(6)} @{" "}
                          {formatUsd(trade.leaderFillPrice)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 border-red-500/30 text-red-400 hover:bg-red-500/10"
                        onClick={() =>
                          decideMutation.mutate({
                            id: trade.id,
                            decision: "reject",
                          })
                        }
                        disabled={decideMutation.isPending}
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 px-3 bg-emerald-500 hover:bg-emerald-400 text-white"
                        onClick={() =>
                          decideMutation.mutate({
                            id: trade.id,
                            decision: "approve",
                          })
                        }
                        disabled={decideMutation.isPending}
                      >
                        <Check className="w-3.5 h-3.5 mr-1" />
                        Approve
                      </Button>
                    </div>
                  </div>
                )
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Fee Bracket Tracker */}
      {bracketData && user?.role === "follower" && (
        <Card className="bg-[#111827] border-white/[0.06]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-violet-400" />
              Fee Bracket — {bracketData.quarterLabel}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <span className="text-xs text-slate-500">Start Equity</span>
                <p className="text-sm font-mono font-medium">
                  {formatUsd(bracketData.startEquity)}
                </p>
              </div>
              <div>
                <span className="text-xs text-slate-500">Current Equity</span>
                <p className="text-sm font-mono font-medium">
                  {formatUsd(bracketData.currentEquity)}
                </p>
              </div>
              <div>
                <span className="text-xs text-slate-500">Est. Profit</span>
                <p
                  className={`text-sm font-mono font-semibold ${
                    bracketData.estimatedProfit >= 0
                      ? "text-emerald-400"
                      : "text-red-400"
                  }`}
                >
                  {bracketData.estimatedProfit >= 0 ? "+" : ""}
                  {formatUsd(bracketData.estimatedProfit)}
                </p>
              </div>
              <div>
                <span className="text-xs text-slate-500">Current Bracket</span>
                <Badge
                  variant="outline"
                  className="mt-0.5 text-xs font-mono border-violet-500/30 text-violet-400"
                >
                  {bracketData.bracketLabel}
                </Badge>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-white/[0.04] flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Estimated Fee: Base €{bracketData.baseFee} + Bracket €
                {bracketData.bracketFee}
              </span>
              <span className="text-sm font-mono font-semibold text-violet-400">
                €{bracketData.estimatedTotalFee?.toFixed(2)}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Open Positions */}
        <Card className="bg-[#111827] border-white/[0.06]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              Open Positions
            </CardTitle>
          </CardHeader>
          <CardContent>
            {openPositions.length === 0 ? (
              <div className="text-center py-8 text-sm text-slate-500">
                No open positions
              </div>
            ) : (
              <div className="space-y-3">
                {openPositions.map(
                  (pos: {
                    id: string;
                    symbol: string;
                    side: string;
                    entryPrice: string;
                    entryQuantity: string;
                  }) => (
                    <div
                      key={pos.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]"
                    >
                      <div className="flex items-center gap-3">
                        <Badge
                          variant={
                            pos.side === "buy" ? "default" : "destructive"
                          }
                          className={`text-xs font-mono uppercase ${
                            pos.side === "buy"
                              ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
                              : "bg-red-500/15 text-red-400 border-red-500/20"
                          }`}
                        >
                          {pos.side}
                        </Badge>
                        <div>
                          <p className="text-sm font-semibold">{pos.symbol}</p>
                          <p className="text-xs text-slate-500 font-mono">
                            {formatCrypto(pos.entryQuantity)} @{" "}
                            {formatUsd(pos.entryPrice)}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="bg-[#111827] border-white/[0.06]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentTrades.length === 0 ? (
              <div className="text-center py-8 text-sm text-slate-500">
                No recent activity
              </div>
            ) : (
              <div className="space-y-3">
                {recentTrades.map(
                  (trade: {
                    id: string;
                    symbol: string;
                    side: string;
                    status: string;
                    avgFillPrice: string;
                    quantity: string;
                    createdAt: string;
                  }) => (
                    <div
                      key={trade.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`p-1.5 rounded-md ${
                            trade.side === "buy"
                              ? "bg-emerald-500/10"
                              : "bg-red-500/10"
                          }`}
                        >
                          {trade.side === "buy" ? (
                            <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <ArrowDownRight className="w-3.5 h-3.5 text-red-400" />
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-medium">
                            {trade.side.toUpperCase()} {trade.symbol}
                          </p>
                          <p className="text-xs text-slate-500 font-mono">
                            {formatCrypto(trade.quantity)} @{" "}
                            {formatUsd(trade.avgFillPrice)}
                          </p>
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={`text-[10px] font-mono ${
                          trade.status === "filled"
                            ? "border-emerald-500/30 text-emerald-400"
                            : trade.status === "failed"
                              ? "border-red-500/30 text-red-400"
                              : "border-slate-500/30 text-slate-400"
                        }`}
                      >
                        {trade.status}
                      </Badge>
                    </div>
                  )
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
