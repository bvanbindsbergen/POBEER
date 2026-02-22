"use client";

import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

        {/* Copy Status */}
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
      </div>

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
