"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiKeyForm } from "@/components/api-key-form";
import { CopySettingsForm } from "@/components/copy-settings-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ShieldAlert, X, Clock, Layers, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function SettingsPage() {
  const queryClient = useQueryClient();

  const { data: authData } = useQuery({
    queryKey: ["auth"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me");
      if (!res.ok) throw new Error("Not authenticated");
      return res.json();
    },
  });

  const user = authData?.user;

  const { data: rulesData } = useQuery({
    queryKey: ["symbol-rules"],
    queryFn: async () => {
      const res = await fetch("/api/symbol-rules");
      if (!res.ok) return { rules: [] };
      return res.json();
    },
  });

  const existingRules: {
    id: string;
    symbol: string;
    action: string;
    customRatio: string | null;
    customMaxUsd: string | null;
  }[] = rulesData?.rules || [];

  const [dailyLossCapUsd, setDailyLossCapUsd] = useState("");
  const [leverageCap, setLeverageCap] = useState("");
  const [allowedMarkets, setAllowedMarkets] = useState<string[]>([]);
  const [newMarket, setNewMarket] = useState("");
  const [followMode, setFollowMode] = useState<"auto" | "manual">("auto");
  const [approvalWindowMinutes, setApprovalWindowMinutes] = useState("5");
  const [newRuleSymbol, setNewRuleSymbol] = useState("");
  const [newRuleAction, setNewRuleAction] = useState<string>("copy");
  const [newRuleRatio, setNewRuleRatio] = useState("");
  const [newRuleMaxUsd, setNewRuleMaxUsd] = useState("");

  useEffect(() => {
    if (user) {
      setDailyLossCapUsd(user.dailyLossCapUsd?.toString() || "");
      setLeverageCap(user.leverageCap?.toString() || "");
      setFollowMode(user.followMode || "auto");
      setApprovalWindowMinutes(
        user.approvalWindowMinutes?.toString() || "5"
      );
      try {
        setAllowedMarkets(
          user.allowedMarkets ? JSON.parse(user.allowedMarkets) : []
        );
      } catch {
        setAllowedMarkets([]);
      }
    }
  }, [user]);

  const saveRiskMutation = useMutation({
    mutationFn: async (data: {
      dailyLossCapUsd: string | null;
      leverageCap: string | null;
      allowedMarkets: string[] | null;
    }) => {
      const res = await fetch("/api/settings/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Risk controls saved");
      queryClient.invalidateQueries({ queryKey: ["auth"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const saveFollowModeMutation = useMutation({
    mutationFn: async (data: {
      followMode: "auto" | "manual";
      approvalWindowMinutes: number;
    }) => {
      const res = await fetch("/api/settings/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Follow mode saved");
      queryClient.invalidateQueries({ queryKey: ["auth"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const addRuleMutation = useMutation({
    mutationFn: async (data: {
      symbol: string;
      action: string;
      customRatio?: string;
      customMaxUsd?: string;
    }) => {
      const res = await fetch("/api/symbol-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Symbol rule saved");
      setNewRuleSymbol("");
      setNewRuleAction("copy");
      setNewRuleRatio("");
      setNewRuleMaxUsd("");
      queryClient.invalidateQueries({ queryKey: ["symbol-rules"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const deleteRuleMutation = useMutation({
    mutationFn: async (ruleId: string) => {
      const res = await fetch(`/api/symbol-rules?id=${ruleId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Rule deleted");
      queryClient.invalidateQueries({ queryKey: ["symbol-rules"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  function addMarket() {
    const m = newMarket.trim().toUpperCase();
    if (m && !allowedMarkets.includes(m)) {
      setAllowedMarkets([...allowedMarkets, m]);
      setNewMarket("");
    }
  }

  function removeMarket(market: string) {
    setAllowedMarkets(allowedMarkets.filter((m) => m !== market));
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure your API keys, copy trading preferences, and risk controls
        </p>
      </div>

      <ApiKeyForm hasApiKeys={user?.hasApiKeys} />
      <CopySettingsForm user={user} />

      {/* Risk Controls */}
      <Card className="bg-[#111827] border-white/[0.06]">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-red-400" />
            Risk Controls
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label className="text-sm text-slate-300">
              Daily Loss Cap (USD)
            </Label>
            <Input
              type="number"
              value={dailyLossCapUsd}
              onChange={(e) => setDailyLossCapUsd(e.target.value)}
              placeholder="No limit"
              className="h-11 bg-[#0a0e17] border-slate-700/50 font-mono text-sm"
            />
            <p className="text-xs text-slate-500">
              Stop copying trades if daily realized losses exceed this amount
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-slate-300">Leverage Cap</Label>
            <Input
              type="number"
              value={leverageCap}
              onChange={(e) => setLeverageCap(e.target.value)}
              placeholder="No limit"
              min={1}
              max={100}
              className="h-11 bg-[#0a0e17] border-slate-700/50 font-mono text-sm"
            />
            <p className="text-xs text-slate-500">
              Maximum leverage multiplier (1-100x)
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-slate-300">Allowed Markets</Label>
            <div className="flex gap-2">
              <Input
                value={newMarket}
                onChange={(e) => setNewMarket(e.target.value)}
                placeholder="e.g. BTC/USDT"
                className="h-11 bg-[#0a0e17] border-slate-700/50 font-mono text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addMarket();
                  }
                }}
              />
              <Button
                variant="outline"
                onClick={addMarket}
                className="border-white/[0.06] h-11 px-4"
              >
                Add
              </Button>
            </div>
            {allowedMarkets.length > 0 ? (
              <div className="flex flex-wrap gap-2 mt-2">
                {allowedMarkets.map((market) => (
                  <Badge
                    key={market}
                    variant="outline"
                    className="text-xs font-mono border-white/[0.1] text-slate-300 flex items-center gap-1 pr-1"
                  >
                    {market}
                    <button
                      onClick={() => removeMarket(market)}
                      className="ml-1 p-0.5 rounded hover:bg-white/[0.1]"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Leave empty to allow all markets
              </p>
            )}
          </div>

          <Button
            onClick={() =>
              saveRiskMutation.mutate({
                dailyLossCapUsd: dailyLossCapUsd || null,
                leverageCap: leverageCap || null,
                allowedMarkets:
                  allowedMarkets.length > 0 ? allowedMarkets : null,
              })
            }
            disabled={saveRiskMutation.isPending}
            className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white shadow-lg shadow-emerald-500/20"
          >
            {saveRiskMutation.isPending ? "Saving..." : "Save Risk Controls"}
          </Button>
        </CardContent>
      </Card>

      {/* Follow Mode */}
      <Card className="bg-[#111827] border-white/[0.06]">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-400" />
            Follow Mode
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between p-4 rounded-lg bg-white/[0.02] border border-white/[0.04]">
            <div>
              <p className="text-sm font-medium">Manual Approval</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {followMode === "manual"
                  ? "Trades require your approval before executing"
                  : "Trades are copied automatically"}
              </p>
            </div>
            <Switch
              checked={followMode === "manual"}
              onCheckedChange={(checked) =>
                setFollowMode(checked ? "manual" : "auto")
              }
            />
          </div>

          {followMode === "manual" && (
            <div className="space-y-2">
              <Label className="text-sm text-slate-300">
                Approval Window (minutes)
              </Label>
              <Input
                type="number"
                value={approvalWindowMinutes}
                onChange={(e) => setApprovalWindowMinutes(e.target.value)}
                min={1}
                max={60}
                className="h-11 bg-[#0a0e17] border-slate-700/50 font-mono text-sm"
              />
              <p className="text-xs text-slate-500">
                Pending trades expire if not approved within this time (1-60 min)
              </p>
            </div>
          )}

          <Button
            onClick={() =>
              saveFollowModeMutation.mutate({
                followMode,
                approvalWindowMinutes: Number(approvalWindowMinutes) || 5,
              })
            }
            disabled={saveFollowModeMutation.isPending}
            className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white shadow-lg shadow-emerald-500/20"
          >
            {saveFollowModeMutation.isPending
              ? "Saving..."
              : "Save Follow Mode"}
          </Button>
        </CardContent>
      </Card>

      {/* Per-Symbol Rules */}
      <Card className="bg-[#111827] border-white/[0.06]">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-400" />
            Per-Symbol Rules
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-xs text-slate-500">
            Override copy behavior for specific trading pairs. Rules take
            priority over global settings.
          </p>

          {/* Add Rule Form */}
          <div className="p-4 rounded-lg bg-white/[0.02] border border-white/[0.04] space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-400">Symbol</Label>
                <Input
                  value={newRuleSymbol}
                  onChange={(e) => setNewRuleSymbol(e.target.value)}
                  placeholder="e.g. BTC/USDT"
                  className="h-9 bg-[#0a0e17] border-slate-700/50 font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-400">Action</Label>
                <Select value={newRuleAction} onValueChange={setNewRuleAction}>
                  <SelectTrigger className="h-9 bg-[#0a0e17] border-slate-700/50 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="copy">Copy</SelectItem>
                    <SelectItem value="skip">Skip</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {newRuleAction === "copy" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-400">
                    Custom Ratio %
                  </Label>
                  <Input
                    type="number"
                    value={newRuleRatio}
                    onChange={(e) => setNewRuleRatio(e.target.value)}
                    placeholder="Default"
                    className="h-9 bg-[#0a0e17] border-slate-700/50 font-mono text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-400">
                    Custom Max USD
                  </Label>
                  <Input
                    type="number"
                    value={newRuleMaxUsd}
                    onChange={(e) => setNewRuleMaxUsd(e.target.value)}
                    placeholder="Default"
                    className="h-9 bg-[#0a0e17] border-slate-700/50 font-mono text-sm"
                  />
                </div>
              </div>
            )}
            <Button
              size="sm"
              onClick={() =>
                addRuleMutation.mutate({
                  symbol: newRuleSymbol,
                  action: newRuleAction,
                  customRatio: newRuleRatio || undefined,
                  customMaxUsd: newRuleMaxUsd || undefined,
                })
              }
              disabled={!newRuleSymbol || addRuleMutation.isPending}
              className="bg-emerald-500 hover:bg-emerald-400 text-white"
            >
              {addRuleMutation.isPending ? "Saving..." : "Add Rule"}
            </Button>
          </div>

          {/* Existing Rules Table */}
          {existingRules.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/[0.06] hover:bg-transparent">
                    <TableHead className="text-xs text-slate-400 uppercase tracking-wider">
                      Symbol
                    </TableHead>
                    <TableHead className="text-xs text-slate-400 uppercase tracking-wider">
                      Action
                    </TableHead>
                    <TableHead className="text-xs text-slate-400 uppercase tracking-wider">
                      Ratio
                    </TableHead>
                    <TableHead className="text-xs text-slate-400 uppercase tracking-wider">
                      Max USD
                    </TableHead>
                    <TableHead className="text-xs text-slate-400 uppercase tracking-wider w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {existingRules.map((rule) => (
                    <TableRow
                      key={rule.id}
                      className="border-white/[0.04] hover:bg-white/[0.02]"
                    >
                      <TableCell className="font-mono text-sm font-medium">
                        {rule.symbol}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] font-mono ${
                            rule.action === "copy"
                              ? "border-emerald-500/30 text-emerald-400"
                              : rule.action === "skip"
                                ? "border-red-500/30 text-red-400"
                                : "border-amber-500/30 text-amber-400"
                          }`}
                        >
                          {rule.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm text-slate-400">
                        {rule.customRatio ? `${rule.customRatio}%` : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-slate-400">
                        {rule.customMaxUsd ? `$${rule.customMaxUsd}` : "—"}
                      </TableCell>
                      <TableCell>
                        <button
                          onClick={() => deleteRuleMutation.mutate(rule.id)}
                          className="p-1 rounded hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
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
