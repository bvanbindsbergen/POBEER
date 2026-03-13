"use client";

import { useState, useCallback, type ErrorInfo, Component, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChatPanel } from "@/components/ai/chat/chat-panel";
import { BacktestConfig } from "@/components/ai/backtest/backtest-config";
import { BacktestResults } from "@/components/ai/backtest/backtest-results";
import { BacktestList } from "@/components/ai/backtest/backtest-list";
import { StrategyDiscovery } from "@/components/ai/strategy-discovery";
import { ActivateStrategyModal } from "@/components/ai/activate-strategy-modal";
import { OperationalDashboard } from "@/components/ai/operational-dashboard";
import { PumpScreener } from "@/components/ai/pump-screener";
import { MarketScanner } from "@/components/ai/market-scanner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  MessageSquare,
  FlaskConical,
  Lightbulb,
  Trash2,
  Brain,
  ShieldAlert,
  Zap,
  Radar,
  Flame,
  Grid3x3,
  Filter,
} from "lucide-react";
import type { StrategyConfig } from "@/lib/ai/backtest/types";
import type { WalkForwardResult } from "@/lib/ai/backtest/types";
import { GridDashboard } from "@/components/grid/grid-dashboard";
import { GridStrategyForm } from "@/components/grid/grid-strategy-form";
import { StrategyFunnel } from "@/components/ai/strategy-funnel";

class AIErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[AI Page Error]", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-6 text-center">
            <p className="text-sm text-red-400 mb-2">Something went wrong loading this section.</p>
            <button
              onClick={() => {
                this.setState({ hasError: false });
                window.location.reload();
              }}
              className="text-xs text-slate-400 hover:text-slate-200 underline"
            >
              Reload page
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}

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
  const [activateSource, setActivateSource] = useState<{
    id: string;
    name: string;
    symbol: string;
    timeframe: string;
    strategyConfig: string | object;
    sourceType: "strategy" | "backtest";
    totalPnl?: number | string;
    winRate?: number | string;
    sharpeRatio?: number | string;
  } | null>(null);
  const [walkForwardResult, setWalkForwardResult] = useState<WalkForwardResult | null>(null);
  const [walkForwardLoading, setWalkForwardLoading] = useState(false);
  const [funnelSignals, setFunnelSignals] = useState<
    { symbol: string; signals: string[]; currentPrice: number }[] | undefined
  >();
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

  // Run backtest mutation (also kicks off walk-forward in parallel)
  const runBacktest = useMutation({
    mutationFn: async (config: {
      symbol: string;
      timeframe: string;
      startDate: string;
      endDate: string;
      strategyConfig: StrategyConfig;
    }) => {
      const days = Math.ceil(
        (new Date(config.endDate).getTime() - new Date(config.startDate).getTime()) /
          (1000 * 60 * 60 * 24)
      );

      const [btRes, candleRes] = await Promise.all([
        fetch("/api/ai/backtest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
        }),
        fetch(
          `/api/ai/market/candles?symbol=${encodeURIComponent(config.symbol)}&timeframe=${config.timeframe}&days=${days}`
        ),
      ]);

      if (!btRes.ok) throw new Error("Backtest failed");
      const btData = await btRes.json();

      let candles;
      if (candleRes.ok) {
        const candleData = await candleRes.json();
        candles = candleData.candles;
      }

      // Fire walk-forward in the background (non-blocking)
      setWalkForwardResult(null);
      setWalkForwardLoading(true);
      fetch("/api/ai/backtest/walk-forward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: config.symbol,
          timeframe: config.timeframe,
          days,
          strategyConfig: config.strategyConfig,
        }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => { if (data?.result) setWalkForwardResult(data.result); })
        .catch(() => {})
        .finally(() => setWalkForwardLoading(false));

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

  // Fetch operational strategies count
  const { data: opData } = useQuery({
    queryKey: ["operational-strategies"],
    queryFn: async () => {
      const res = await fetch("/api/operational-strategies");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: isLeader,
    refetchInterval: 30_000,
  });
  const activeOpCount = (opData?.strategies || []).filter(
    (s: { status: string }) => s.status === "active"
  ).length;

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

  // Handle scanner → funnel
  const handleScannerFunnel = useCallback(
    (signals: { symbol: string; signals: string[]; currentPrice: number }[]) => {
      setFunnelSignals(signals);
      setActiveTab("funnel");
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
    <AIErrorBoundary>
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
        <div className="overflow-x-auto -mx-4 px-4 mb-4 scrollbar-none">
          <TabsList className="bg-[#111827] border border-white/[0.06] w-max md:w-auto">
            <TabsTrigger
              value="chat"
              className="data-[state=active]:bg-emerald-500/10 data-[state=active]:text-emerald-400 text-xs sm:text-sm px-2 sm:px-3"
            >
              <MessageSquare className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1 sm:mr-1.5" />
              Chat
            </TabsTrigger>
            <TabsTrigger
              value="strategies"
              className="data-[state=active]:bg-emerald-500/10 data-[state=active]:text-emerald-400 text-xs sm:text-sm px-2 sm:px-3"
            >
              <Lightbulb className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1 sm:mr-1.5" />
              <span className="hidden sm:inline">Strategies</span>
              <span className="sm:hidden">Strats</span>
              {strategies.length > 0 && (
                <Badge variant="outline" className="ml-1 text-[10px] px-1.5 py-0">
                  {strategies.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="backtests"
              className="data-[state=active]:bg-emerald-500/10 data-[state=active]:text-emerald-400 text-xs sm:text-sm px-2 sm:px-3"
            >
              <FlaskConical className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1 sm:mr-1.5" />
              <span className="hidden sm:inline">Backtests</span>
              <span className="sm:hidden">BT</span>
            </TabsTrigger>
            <TabsTrigger
              value="funnel"
              className="data-[state=active]:bg-emerald-500/10 data-[state=active]:text-emerald-400 text-xs sm:text-sm px-2 sm:px-3"
            >
              <Filter className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1 sm:mr-1.5" />
              Funnel
            </TabsTrigger>
            <TabsTrigger
              value="live"
              className="data-[state=active]:bg-amber-500/10 data-[state=active]:text-amber-400 text-xs sm:text-sm px-2 sm:px-3"
            >
              <Zap className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1 sm:mr-1.5" />
              Live
              {activeOpCount > 0 && (
                <Badge className="ml-1 text-[10px] px-1.5 py-0 bg-amber-500/20 text-amber-400 border-amber-500/30">
                  {activeOpCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="screeners"
              className="data-[state=active]:bg-cyan-500/10 data-[state=active]:text-cyan-400 text-xs sm:text-sm px-2 sm:px-3"
            >
              <Radar className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1 sm:mr-1.5" />
              <span className="hidden sm:inline">Screeners</span>
              <span className="sm:hidden">Scan</span>
            </TabsTrigger>
            <TabsTrigger
              value="grid"
              className="data-[state=active]:bg-violet-500/10 data-[state=active]:text-violet-400 text-xs sm:text-sm px-2 sm:px-3"
            >
              <Grid3x3 className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1 sm:mr-1.5" />
              Grid
            </TabsTrigger>
          </TabsList>
        </div>

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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setActivateSource({
                              id: s.id,
                              name: s.name,
                              symbol: s.symbol,
                              timeframe: s.timeframe,
                              strategyConfig: s.strategyConfig,
                              sourceType: "strategy",
                            })
                          }
                          className="h-7 text-xs border-amber-500/20 text-amber-400 hover:bg-amber-500/10"
                        >
                          <Zap className="w-3 h-3 mr-1" />
                          Activate
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
            <BacktestResults
              result={backtestResult as Parameters<typeof BacktestResults>[0]["result"]}
              candles={backtestCandles}
              onActivate={(source) => setActivateSource(source)}
              walkForwardResult={walkForwardResult}
              walkForwardLoading={walkForwardLoading}
            />
          )}

          <BacktestList
            onSelect={loadBacktest}
            selectedId={backtestResult ? (backtestResult as { id?: string }).id : undefined}
            onActivate={(source) => setActivateSource(source)}
          />
        </TabsContent>

        {/* Funnel Tab — forceMount keeps state alive across tab switches */}
        <TabsContent value="funnel" className="mt-0" forceMount>
          <div className={activeTab !== "funnel" ? "hidden" : undefined}>
            <StrategyFunnel
              initialSignals={funnelSignals}
              onActivate={(source) => setActivateSource(source)}
            />
          </div>
        </TabsContent>

        {/* Live Tab */}
        <TabsContent value="live" className="mt-0">
          <OperationalDashboard />
        </TabsContent>

        {/* Screeners Tab */}
        <TabsContent value="screeners" className="mt-0 space-y-6">
          <div className="rounded-xl bg-[#111827] border border-white/[0.06] p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 rounded-lg bg-amber-500/10">
                <Flame className="w-4 h-4 text-amber-400" />
              </div>
              <h3 className="text-sm font-semibold text-slate-200">Pump Screener</h3>
              <span className="text-[10px] text-slate-500">Real-time price & volume spike detection</span>
            </div>
            <PumpScreener />
          </div>

          <div className="rounded-xl bg-[#111827] border border-white/[0.06] p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 rounded-lg bg-cyan-500/10">
                <Radar className="w-4 h-4 text-cyan-400" />
              </div>
              <h3 className="text-sm font-semibold text-slate-200">Market Scanner</h3>
              <span className="text-[10px] text-slate-500">Technical analysis across top 20 coins</span>
            </div>
            <MarketScanner onFunnel={handleScannerFunnel} />
          </div>
        </TabsContent>

        {/* Grid Bots Tab */}
        <TabsContent value="grid" className="mt-0 space-y-4">
          <GridStrategyForm
            onCreated={() =>
              queryClient.invalidateQueries({ queryKey: ["grid-strategies"] })
            }
          />
          <GridDashboard />
        </TabsContent>
      </Tabs>

      {/* Activate Strategy Modal */}
      <ActivateStrategyModal
        open={!!activateSource}
        onOpenChange={(open) => { if (!open) setActivateSource(null); }}
        source={activateSource}
      />
    </div>
    </AIErrorBoundary>
  );
}
