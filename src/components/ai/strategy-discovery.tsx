"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sparkles,
  FlaskConical,
  Bookmark,
  RefreshCw,
  TrendingUp,
  Shield,
  Flame,
  Loader2,
  ThumbsUp,
  ThumbsDown,
  X,
  Send,
} from "lucide-react";

interface DiscoveredStrategy {
  name: string;
  symbol: string;
  timeframe: string;
  riskLevel: string;
  reasoning: string;
  entryConditions: string[];
  exitConditions: string[];
  stopLoss: string;
  takeProfit: string;
  strategyConfig: unknown;
}

interface StrategyDiscoveryProps {
  onBacktest: (strategy: DiscoveredStrategy) => void;
}

const riskIcons: Record<string, typeof Shield> = {
  conservative: Shield,
  moderate: TrendingUp,
  aggressive: Flame,
};

const riskColors: Record<string, string> = {
  conservative: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  moderate: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  aggressive: "bg-red-500/10 text-red-400 border-red-500/20",
};

export function StrategyDiscovery({ onBacktest }: StrategyDiscoveryProps) {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ["ai-discover"],
    queryFn: async () => {
      const res = await fetch("/api/ai/discover");
      if (!res.ok) throw new Error("Failed to discover strategies");
      return res.json();
    },
    staleTime: 60 * 60 * 1000, // 1 hour
    retry: 1,
  });

  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  const [feedbackIndex, setFeedbackIndex] = useState<number | null>(null);
  const [feedbackAction, setFeedbackAction] = useState<"approved" | "declined">("declined");
  const [feedbackReason, setFeedbackReason] = useState("");
  const [feedbackedIds, setFeedbackedIds] = useState<Map<number, "approved" | "declined">>(new Map());

  const saveStrategy = useMutation({
    mutationFn: async ({ strategy, index }: { strategy: DiscoveredStrategy; index: number }) => {
      const res = await fetch("/api/ai/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: strategy.name,
          symbol: strategy.symbol,
          timeframe: strategy.timeframe,
          strategyConfig: strategy.strategyConfig,
          notes: strategy.reasoning,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save");
      }
      return { ...(await res.json()), index };
    },
    onSuccess: (data) => {
      setSavedIds((prev) => new Set(prev).add(data.index));
      queryClient.invalidateQueries({ queryKey: ["ai-strategies"] });
    },
  });

  const submitFeedback = useMutation({
    mutationFn: async ({
      strategy,
      index,
      action,
      reason,
    }: {
      strategy: DiscoveredStrategy;
      index: number;
      action: "approved" | "declined";
      reason: string;
    }) => {
      const res = await fetch("/api/ai/discover/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategyName: strategy.name,
          symbol: strategy.symbol,
          timeframe: strategy.timeframe,
          action,
          reason: reason || undefined,
          strategyConfig: strategy.strategyConfig,
        }),
      });
      if (!res.ok) throw new Error("Failed to submit feedback");
      return { index, action };
    },
    onSuccess: ({ index, action }) => {
      setFeedbackedIds((prev) => new Map(prev).set(index, action));
      setFeedbackIndex(null);
      setFeedbackReason("");
    },
  });

  const strategies: DiscoveredStrategy[] = data?.strategies || [];
  const generatedAt = data?.generatedAt;

  if (isError && !data) {
    return null; // Silently hide if API key not set
  }

  return (
    <div className="mb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-slate-200">
            Strategy Ideas
          </h3>
          {generatedAt && (
            <span className="text-[10px] text-slate-600">
              Updated {new Date(generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            queryClient.invalidateQueries({ queryKey: ["ai-discover"] })
          }
          disabled={isFetching}
          className="h-7 text-xs text-slate-500 hover:text-slate-300"
        >
          <RefreshCw
            className={`w-3 h-3 mr-1 ${isFetching ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="grid md:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="rounded-xl bg-[#111827] border border-white/[0.06] p-4 animate-pulse"
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="h-4 w-32 bg-white/[0.06] rounded" />
              </div>
              <div className="space-y-2 mb-3">
                <div className="h-3 w-full bg-white/[0.06] rounded" />
                <div className="h-3 w-3/4 bg-white/[0.06] rounded" />
              </div>
              <div className="flex gap-2">
                <div className="h-3 w-16 bg-white/[0.06] rounded" />
                <div className="h-3 w-16 bg-white/[0.06] rounded" />
              </div>
            </div>
          ))}
          <div className="md:col-span-3 flex items-center justify-center gap-2 py-2 text-xs text-slate-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500" />
            AI is analyzing market conditions and generating strategies...
          </div>
        </div>
      )}

      {/* Strategy cards */}
      {!isLoading && strategies.length > 0 && (
        <div className="grid md:grid-cols-3 gap-3">
          {strategies.map((s, i) => {
            const risk = s.riskLevel?.toLowerCase() || "moderate";
            const RiskIcon = riskIcons[risk] || TrendingUp;
            const riskColor =
              riskColors[risk] || riskColors.moderate;

            return (
              <div
                key={i}
                className="rounded-xl bg-[#111827] border border-white/[0.06] p-4 hover:border-white/[0.12] transition-colors"
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-2">
                  <h4 className="text-sm font-semibold text-slate-200 leading-tight">
                    {s.name}
                  </h4>
                </div>

                {/* Badges */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {s.symbol}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {s.timeframe}
                  </Badge>
                  <Badge
                    className={`text-[10px] px-1.5 py-0 border ${riskColor}`}
                  >
                    <RiskIcon className="w-2.5 h-2.5 mr-0.5" />
                    {s.riskLevel}
                  </Badge>
                </div>

                {/* Reasoning */}
                <p className="text-xs text-slate-400 mb-3 line-clamp-3 leading-relaxed">
                  {s.reasoning}
                </p>

                {/* Conditions preview */}
                <div className="space-y-1.5 mb-3">
                  {s.entryConditions?.slice(0, 2).map((c, j) => (
                    <div
                      key={`e-${j}`}
                      className="flex items-center gap-1.5 text-[11px] text-slate-500"
                    >
                      <span className="w-1 h-1 rounded-full bg-emerald-400 flex-shrink-0" />
                      <span className="truncate">{c}</span>
                    </div>
                  ))}
                  {s.exitConditions?.slice(0, 1).map((c, j) => (
                    <div
                      key={`x-${j}`}
                      className="flex items-center gap-1.5 text-[11px] text-slate-500"
                    >
                      <span className="w-1 h-1 rounded-full bg-red-400 flex-shrink-0" />
                      <span className="truncate">{c}</span>
                    </div>
                  ))}
                </div>

                {/* SL/TP */}
                <div className="flex gap-3 mb-3 text-[11px]">
                  {s.stopLoss && (
                    <span className="text-red-400">SL: {s.stopLoss}</span>
                  )}
                  {s.takeProfit && (
                    <span className="text-emerald-400">TP: {s.takeProfit}</span>
                  )}
                </div>

                {/* Feedback status */}
                {feedbackedIds.has(i) && (
                  <div className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium flex items-center gap-1.5 ${
                    feedbackedIds.get(i) === "approved"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-red-500/10 text-red-400"
                  }`}>
                    {feedbackedIds.get(i) === "approved" ? (
                      <><ThumbsUp className="w-3 h-3" /> Approved</>
                    ) : (
                      <><ThumbsDown className="w-3 h-3" /> Declined</>
                    )}
                  </div>
                )}

                {/* Inline feedback form */}
                {feedbackIndex === i && (
                  <div className="rounded-lg bg-[#0a0f1a] border border-white/[0.08] p-2.5 space-y-2">
                    <textarea
                      value={feedbackReason}
                      onChange={(e) => setFeedbackReason(e.target.value)}
                      placeholder={feedbackAction === "declined"
                        ? "Why decline? e.g. 'too risky', 'prefer BTC over alts', 'RSI strategy doesn't work for me'..."
                        : "Any notes? e.g. 'love momentum strategies', 'good risk/reward'..."
                      }
                      rows={2}
                      className="w-full rounded bg-[#111827] border border-white/[0.08] px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:border-white/[0.15] focus:outline-none resize-none"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => submitFeedback.mutate({
                          strategy: s,
                          index: i,
                          action: feedbackAction,
                          reason: feedbackReason,
                        })}
                        disabled={submitFeedback.isPending}
                        className={`h-6 text-[11px] flex-1 ${
                          feedbackAction === "approved"
                            ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                            : "bg-red-600 hover:bg-red-700 text-white"
                        }`}
                      >
                        <Send className="w-3 h-3 mr-1" />
                        Submit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setFeedbackIndex(null); setFeedbackReason(""); }}
                        className="h-6 text-[11px] text-slate-500 hover:text-slate-300 px-2"
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                )}

                {/* Actions */}
                {!feedbackedIds.has(i) && feedbackIndex !== i && (
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setFeedbackAction("approved");
                        setFeedbackIndex(i);
                        setFeedbackReason("");
                        // Also save the strategy on approve
                        if (!savedIds.has(i)) {
                          saveStrategy.mutate({ strategy: s, index: i });
                        }
                      }}
                      className="h-7 text-xs border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/10"
                    >
                      <ThumbsUp className="w-3 h-3 mr-1" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setFeedbackAction("declined");
                        setFeedbackIndex(i);
                        setFeedbackReason("");
                      }}
                      className="h-7 text-xs border-red-500/20 text-red-400 hover:bg-red-500/10"
                    >
                      <ThumbsDown className="w-3 h-3 mr-1" />
                      Decline
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onBacktest(s)}
                      className="h-7 text-xs border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/10"
                    >
                      <FlaskConical className="w-3 h-3 mr-1" />
                      Backtest
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
