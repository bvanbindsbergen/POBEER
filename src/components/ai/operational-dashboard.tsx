"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Zap,
  Pause,
  Play,
  Square,
  AlertOctagon,
  TrendingUp,
  TrendingDown,
  Activity,
  Clock,
  DollarSign,
  Loader2,
} from "lucide-react";
import type { OperationalStrategy } from "@/lib/db/schema";

export function OperationalDashboard() {
  const queryClient = useQueryClient();
  const [confirmStop, setConfirmStop] = useState<{ id: string; name: string; inPosition: boolean } | null>(null);
  const [killSwitchConfirm, setKillSwitchConfirm] = useState(false);

  // Fetch strategies
  const { data, isLoading } = useQuery({
    queryKey: ["operational-strategies"],
    queryFn: async () => {
      const res = await fetch("/api/operational-strategies");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  // Kill switch state
  const { data: killData } = useQuery({
    queryKey: ["kill-switch"],
    queryFn: async () => {
      const res = await fetch("/api/operational-strategies/kill-switch");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const killSwitch = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await fetch("/api/operational-strategies/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kill-switch"] });
      setKillSwitchConfirm(false);
    },
  });

  const pauseResume = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "pause" | "resume" }) => {
      const res = await fetch(`/api/operational-strategies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["operational-strategies"] });
    },
  });

  const stopStrategy = useMutation({
    mutationFn: async ({ id, forceClose }: { id: string; forceClose: boolean }) => {
      const res = await fetch(`/api/operational-strategies/${id}/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceClose }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["operational-strategies"] });
      setConfirmStop(null);
    },
  });

  const strategies: OperationalStrategy[] = data?.strategies || [];
  const isKillActive = killData?.enabled === true;

  const activeCount = strategies.filter((s) => s.status === "active").length;
  const totalPnl = strategies.reduce((sum, s) => sum + (s.totalPnl || 0), 0);
  const inPositionCount = strategies.filter((s) => s.inPosition).length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-5 h-5 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Kill Switch Banner */}
      {isKillActive && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertOctagon className="w-5 h-5 text-red-400" />
            <span className="text-sm font-medium text-red-400">
              Kill Switch Active — All strategies paused
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => killSwitch.mutate(false)}
            className="border-red-500/20 text-red-400 hover:bg-red-500/10 h-7 text-xs"
          >
            Disable Kill Switch
          </Button>
        </div>
      )}

      {/* Stats + Kill Switch */}
      <div className="flex items-center justify-between">
        <div className="flex gap-4">
          <div className="flex items-center gap-1.5 text-sm">
            <Activity className="w-4 h-4 text-emerald-400" />
            <span className="text-slate-400">Active:</span>
            <span className="font-medium text-slate-200">{activeCount}</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <DollarSign className="w-4 h-4 text-cyan-400" />
            <span className="text-slate-400">Total P&L:</span>
            <span className={`font-medium ${totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              ${totalPnl.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <Zap className="w-4 h-4 text-amber-400" />
            <span className="text-slate-400">In Position:</span>
            <span className="font-medium text-slate-200">{inPositionCount}</span>
          </div>
        </div>
        {!isKillActive && strategies.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setKillSwitchConfirm(true)}
            className="border-red-500/20 text-red-400 hover:bg-red-500/10 h-7 text-xs"
          >
            <AlertOctagon className="w-3.5 h-3.5 mr-1" />
            STOP ALL
          </Button>
        )}
      </div>

      {/* Strategy Cards */}
      {strategies.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
            <Zap className="w-6 h-6 text-amber-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-200 mb-1">No Live Strategies</h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            Activate a strategy from the Strategies or Backtests tab to start live auto-trading.
          </p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {strategies.map((s) => (
            <StrategyCard
              key={s.id}
              strategy={s}
              onPauseResume={(action) => pauseResume.mutate({ id: s.id, action })}
              onStop={() => setConfirmStop({ id: s.id, name: s.name, inPosition: s.inPosition || false })}
              isPauseResumeLoading={pauseResume.isPending}
            />
          ))}
        </div>
      )}

      {/* Stop Confirmation Dialog */}
      <Dialog open={!!confirmStop} onOpenChange={() => setConfirmStop(null)}>
        <DialogContent className="bg-[#0a0f1a] border-white/[0.08] text-slate-200 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-slate-100">Stop Strategy</DialogTitle>
            <DialogDescription className="text-slate-500">
              Stop "{confirmStop?.name}"? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            {confirmStop?.inPosition && (
              <Button
                onClick={() => stopStrategy.mutate({ id: confirmStop.id, forceClose: true })}
                disabled={stopStrategy.isPending}
                className="w-full bg-red-600 hover:bg-red-700 text-white"
              >
                {stopStrategy.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                Stop & Close Position
              </Button>
            )}
            <Button
              onClick={() => confirmStop && stopStrategy.mutate({ id: confirmStop.id, forceClose: false })}
              disabled={stopStrategy.isPending}
              variant="outline"
              className="w-full border-white/[0.08] text-slate-400"
            >
              {!confirmStop?.inPosition && stopStrategy.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              {confirmStop?.inPosition ? "Stop (Keep Position Open)" : "Stop Strategy"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setConfirmStop(null)}
              className="w-full text-slate-500"
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Kill Switch Confirmation */}
      <Dialog open={killSwitchConfirm} onOpenChange={setKillSwitchConfirm}>
        <DialogContent className="bg-[#0a0f1a] border-white/[0.08] text-slate-200 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-red-400 flex items-center gap-2">
              <AlertOctagon className="w-5 h-5" />
              Activate Kill Switch
            </DialogTitle>
            <DialogDescription className="text-slate-500">
              This will immediately pause all strategy evaluations. No new trades will be placed.
              Existing open positions remain until manually managed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setKillSwitchConfirm(false)} className="text-slate-500">
              Cancel
            </Button>
            <Button
              onClick={() => killSwitch.mutate(true)}
              disabled={killSwitch.isPending}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {killSwitch.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Activate Kill Switch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StrategyCard({
  strategy,
  onPauseResume,
  onStop,
  isPauseResumeLoading,
}: {
  strategy: OperationalStrategy;
  onPauseResume: (action: "pause" | "resume") => void;
  onStop: () => void;
  isPauseResumeLoading: boolean;
}) {
  const s = strategy;
  const todayPnl = s.todayPnl || 0;
  const totalPnl = s.totalPnl || 0;

  const statusColors = {
    active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    paused: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    stopped: "bg-red-500/10 text-red-400 border-red-500/20",
  };

  return (
    <div className="rounded-xl bg-[#111827] border border-white/[0.06] p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h4 className="text-sm font-semibold text-slate-200">{s.name}</h4>
          <div className="flex gap-1.5 mt-1">
            <Badge variant="outline" className="text-[10px]">{s.symbol}</Badge>
            <Badge variant="outline" className="text-[10px]">{s.timeframe}</Badge>
          </div>
        </div>
        <div className="flex gap-1 items-center">
          {s.mode === "paper" ? (
            <Badge className="text-[10px] border bg-cyan-500/10 text-cyan-400 border-cyan-500/20">
              PAPER
            </Badge>
          ) : (
            <Badge className="text-[10px] border bg-amber-500/10 text-amber-400 border-amber-500/20">
              LIVE
            </Badge>
          )}
          <Badge className={`text-[10px] border ${statusColors[s.status]}`}>
            {s.status === "active" && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse mr-1" />}
            {s.status}
          </Badge>
        </div>
      </div>

      {/* Fund allocation */}
      <div className="text-xs text-slate-500">
        <DollarSign className="w-3 h-3 inline mr-0.5" />
        ${s.maxCapUsd} / {s.maxCapPercent}%
        {s.inPosition && s.entryPrice && (
          <span className="ml-2 text-amber-400">
            <Zap className="w-3 h-3 inline mr-0.5" />
            In position @ ${s.entryPrice.toFixed(2)}
          </span>
        )}
      </div>

      {/* PnL */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-[#0a0f1a] p-2">
          <div className="text-[10px] text-slate-500 uppercase">Today</div>
          <div className={`text-sm font-semibold ${todayPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {todayPnl >= 0 ? "+" : ""}${todayPnl.toFixed(2)}
          </div>
        </div>
        <div className="rounded-lg bg-[#0a0f1a] p-2">
          <div className="text-[10px] text-slate-500 uppercase">Total</div>
          <div className={`text-sm font-semibold ${totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>{s.tradesCount || 0} trades</span>
        {s.lastCheckedAt && (
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatRelative(new Date(s.lastCheckedAt))}
          </span>
        )}
      </div>

      {/* Stopped reason */}
      {s.status === "stopped" && s.stoppedReason && (
        <div className="text-[11px] text-red-400/70">
          Stopped: {s.stoppedReason === "daily_loss_limit" ? "Daily loss limit reached" : s.stoppedReason}
        </div>
      )}

      {/* Controls */}
      {s.status !== "stopped" && (
        <div className="flex gap-2 pt-1">
          {s.status === "active" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onPauseResume("pause")}
              disabled={isPauseResumeLoading}
              className="h-7 text-xs border-amber-500/20 text-amber-400 hover:bg-amber-500/10 flex-1"
            >
              <Pause className="w-3 h-3 mr-1" />
              Pause
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onPauseResume("resume")}
              disabled={isPauseResumeLoading}
              className="h-7 text-xs border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/10 flex-1"
            >
              <Play className="w-3 h-3 mr-1" />
              Resume
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={onStop}
            className="h-7 text-xs border-red-500/20 text-red-400 hover:bg-red-500/10"
          >
            <Square className="w-3 h-3 mr-1" />
            Stop
          </Button>
        </div>
      )}
    </div>
  );
}

function formatRelative(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return date.toLocaleDateString();
}
