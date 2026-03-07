"use client";

import { useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChatPanel } from "@/components/ai/chat/chat-panel";
import { BacktestConfig } from "@/components/ai/backtest/backtest-config";
import { BacktestResults } from "@/components/ai/backtest/backtest-results";
import { BacktestList } from "@/components/ai/backtest/backtest-list";
import { StrategyDiscovery } from "@/components/ai/strategy-discovery";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  MessageSquare,
  FlaskConical,
  Lightbulb,
  Trash2,
  Brain,
  ShieldAlert,
} from "lucide-react";
import type { StrategyConfig } from "@/lib/ai/backtest/types";

export default function AIPage() {
  const [activeTab, setActiveTab] = useState("chat");
  const [backtestResult, setBacktestResult] = useState<Record<string, unknown> | null>(null);
  const [backtestCandles, setBacktestCandles] = useState<
    { timestamp: number; open: number; high: number; low: number; close: number; volume: number }[] | undefined
  >();
  const [prefillConfig, setPrefillConfig] = useState<{
    strategyConfig?: StrategyConfig;
    symbol?: string;
    timeframe?: string;
  } | null>(null);
  const queryClient = useQueryClient();

  // Check if user is leader
  const { data: authData, isLoading: authLoading } = useQuery({
    queryKey: ["auth"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me");
      if (!res.ok) throw new Error("Not authenticated");
      return res.json();
    },
  });

  const isLeader = authData?.user?.role === "leader";

  // Run backtest mutation
  const runBacktest = useMutation({
    mutationFn: async (config: {
      symbol: string;
      timeframe: string;
      startDate: string;
      endDate: string;
      strategyConfig: StrategyConfig;
    }) => {
      const [btRes, candleRes] = await Promise.all([
        fetch("/api/ai/backtest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
        }),
        fetch(
          `/api/ai/market/candles?symbol=${encodeURIComponent(config.symbol)}&timeframe=${config.timeframe}&days=${
            Math.ceil(
              (new Date(config.endDate).getTime() - new Date(config.startDate).getTime()) /
                (1000 * 60 * 60 * 24)
            )
          }`
        ),
      ]);

      if (!btRes.ok) throw new Error("Backtest failed");
      const btData = await btRes.json();

      let candles;
      if (candleRes.ok) {
        const candleData = await candleRes.json();
        candles = candleData.candles;
      }

      return { backtest: btData.backtest, candles };
    },
    onSuccess: (data) => {
      setBacktestResult(data.backtest);
      setBacktestCandles(data.candles);
      queryClient.invalidateQueries({ queryKey: ["backtests"] });
    },
  });

  // Fetch strategies
  const { data: stratData } = useQuery({
    queryKey: ["ai-strategies"],
    queryFn: async () => {
      const res = await fetch("/api/ai/strategies");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: isLeader,
  });
  const strategies = stratData?.strategies || [];

  // Delete strategy
  const deleteStrategy = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/ai/strategies/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-strategies"] });
    },
  });

  // Load backtest details
  const loadBacktest = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/ai/backtest/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      setBacktestResult(data.backtest);

      if (data.backtest.symbol && data.backtest.timeframe) {
        const days = Math.ceil(
          (new Date(data.backtest.endDate).getTime() -
            new Date(data.backtest.startDate).getTime()) /
            (1000 * 60 * 60 * 24)
        );
        const cRes = await fetch(
          `/api/ai/market/candles?symbol=${encodeURIComponent(data.backtest.symbol)}&timeframe=${data.backtest.timeframe}&days=${days}`
        );
        if (cRes.ok) {
          const cData = await cRes.json();
          setBacktestCandles(cData.candles);
        }
      }
    },
    []
  );

  // Handle backtest from discovery
  const handleDiscoveryBacktest = useCallback(
    (strategy: { symbol: string; timeframe: string; strategyConfig: unknown }) => {
      setPrefillConfig({
        strategyConfig: strategy.strategyConfig as StrategyConfig,
        symbol: strategy.symbol,
        timeframe: strategy.timeframe,
      });
      setActiveTab("backtests");
    },
    []
  );

  // Handle strategy actions from chat
  const handleStrategyAction = useCallback(
    (action: string, data: unknown) => {
      if (action === "backtest" && typeof data === "object" && data) {
        const d = data as Record<string, unknown>;
        setPrefillConfig({
          strategyConfig: d.strategyConfig as StrategyConfig,
          symbol: d.symbol as string,
          timeframe: d.timeframe as string,
        });
        setActiveTab("backtests");
      }
    },
    []
  );

  if (authLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-5 h-5 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  // Only leaders can access AI assistant
  if (!isLeader) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="p-3 rounded-2xl bg-amber-500/10 mb-4">
          <ShieldAlert className="w-8 h-8 text-amber-400" />
        </div>
        <h2 className="text-lg font-bold text-slate-200 mb-2">Leader Only</h2>
        <p className="text-sm text-slate-500 max-w-md">
          The AI Trading Assistant is available to the lead trader only.
          Contact your group admin for access.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20">
          <Brain className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-100">AI Assistant</h1>
          <p className="text-xs text-slate-500">
            Discover strategies, analyze markets, and backtest ideas
          </p>
        </div>
      </div>

      {/* Auto-generated Strategy Ideas */}
      <StrategyDiscovery onBacktest={handleDiscoveryBacktest} />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-[#111827] border border-white/[0.06] mb-4">
          <TabsTrigger
            value="chat"
            className="data-[state=active]:bg-emerald-500/10 data-[state=active]:text-emerald-400 text-sm"
          >
            <MessageSquare className="w-4 h-4 mr-1.5" />
            Chat
          </TabsTrigger>
          <TabsTrigger
            value="strategies"
            className="data-[state=active]:bg-emerald-500/10 data-[state=active]:text-emerald-400 text-sm"
          >
            <Lightbulb className="w-4 h-4 mr-1.5" />
            Strategies
            {strategies.length > 0 && (
              <Badge variant="outline" className="ml-1.5 text-[10px] px-1.5 py-0">
                {strategies.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="backtests"
            className="data-[state=active]:bg-emerald-500/10 data-[state=active]:text-emerald-400 text-sm"
          >
            <FlaskConical className="w-4 h-4 mr-1.5" />
            Backtests
          </TabsTrigger>
        </TabsList>

        {/* Chat Tab */}
        <TabsContent value="chat" className="mt-0">
          <ChatPanel onStrategyAction={handleStrategyAction} />
        </TabsContent>

        {/* Strategies Tab */}
        <TabsContent value="strategies" className="mt-0">
          {strategies.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
                <Lightbulb className="w-6 h-6 text-amber-400" />
              </div>
              <h3 className="text-lg font-semibold text-slate-200 mb-1">
                No Saved Strategies
              </h3>
              <p className="text-sm text-slate-500 max-w-md mx-auto">
                Save strategies from the AI-generated ideas above, or chat with the AI to discover more.
              </p>
              <Button
                onClick={() => setActiveTab("chat")}
                className="mt-4 bg-emerald-600 hover:bg-emerald-700 text-white"
                size="sm"
              >
                Go to Chat
              </Button>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
              {strategies.map(
                (s: {
                  id: string;
                  name: string;
                  symbol: string;
                  timeframe: string;
                  strategyConfig: string;
                  notes: string | null;
                  createdAt: string;
                }) => {
                  const config = (() => {
                    try {
                      return JSON.parse(s.strategyConfig);
                    } catch {
                      return null;
                    }
                  })();

                  return (
                    <div
                      key={s.id}
                      className="rounded-xl bg-[#111827] border border-white/[0.06] p-4"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <h4 className="text-sm font-semibold text-slate-200">
                          {s.name}
                        </h4>
                        <button
                          onClick={() => deleteStrategy.mutate(s.id)}
                          className="p-1 rounded text-slate-600 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex gap-1.5 mb-3">
                        <Badge variant="outline" className="text-[10px]">
                          {s.symbol}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {s.timeframe}
                        </Badge>
                      </div>
                      {s.notes && (
                        <p className="text-xs text-slate-500 mb-3 line-clamp-2">
                          {s.notes}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setPrefillConfig({
                              strategyConfig: config,
                              symbol: s.symbol,
                              timeframe: s.timeframe,
                            });
                            setActiveTab("backtests");
                          }}
                          className="h-7 text-xs border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/10"
                        >
                          <FlaskConical className="w-3 h-3 mr-1" />
                          Backtest
                        </Button>
                      </div>
                      <p className="text-[10px] text-slate-600 mt-2">
                        {new Date(s.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  );
                }
              )}
            </div>
          )}
        </TabsContent>

        {/* Backtests Tab */}
        <TabsContent value="backtests" className="mt-0 space-y-4">
          <div className="rounded-xl bg-[#111827] border border-white/[0.06] p-4">
            <h3 className="text-sm font-semibold text-slate-200 mb-4">
              Configure Backtest
            </h3>
            <BacktestConfig
              onRun={runBacktest.mutate}
              isRunning={runBacktest.isPending}
              initialConfig={prefillConfig?.strategyConfig}
              initialSymbol={prefillConfig?.symbol}
              initialTimeframe={prefillConfig?.timeframe}
            />
          </div>

          {runBacktest.isError && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
              Backtest failed. Please check your configuration and try again.
            </div>
          )}

          {backtestResult && (
            <BacktestResults result={backtestResult as Parameters<typeof BacktestResults>[0]["result"]} candles={backtestCandles} />
          )}

          <BacktestList
            onSelect={loadBacktest}
            selectedId={backtestResult ? (backtestResult as { id?: string }).id : undefined}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
