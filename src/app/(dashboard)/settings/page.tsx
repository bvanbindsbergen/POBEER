"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Key, Shield, Percent, DollarSign, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [showApiKey, setShowApiKey] = useState(false);
  const [showApiSecret, setShowApiSecret] = useState(false);

  const { data: authData } = useQuery({
    queryKey: ["auth"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me");
      if (!res.ok) throw new Error("Not authenticated");
      return res.json();
    },
  });

  const user = authData?.user;

  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [copyRatio, setCopyRatio] = useState<number[]>([
    Number(user?.copyRatioPercent) || 10,
  ]);
  const [maxTradeUsd, setMaxTradeUsd] = useState(
    user?.maxTradeUsd?.toString() || ""
  );
  const [copyingEnabled, setCopyingEnabled] = useState(
    user?.copyingEnabled || false
  );

  const saveKeysMutation = useMutation({
    mutationFn: async (data: { apiKey: string; apiSecret: string }) => {
      const res = await fetch("/api/settings/keys", {
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
      toast.success("API keys saved and validated");
      setApiKey("");
      setApiSecret("");
      queryClient.invalidateQueries({ queryKey: ["auth"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const saveConfigMutation = useMutation({
    mutationFn: async (data: {
      copyRatioPercent: number;
      maxTradeUsd: string | null;
      copyingEnabled: boolean;
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
      toast.success("Settings saved");
      queryClient.invalidateQueries({ queryKey: ["auth"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure your API keys and copy trading preferences
        </p>
      </div>

      {/* API Keys */}
      <Card className="bg-[#111827] border-white/[0.06]">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Key className="w-4 h-4 text-amber-400" />
            ByBit API Keys
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="bg-amber-500/5 border border-amber-500/15 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <Shield className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-200/80 leading-relaxed">
                Only enable <strong>Spot Trading</strong> and{" "}
                <strong>Read</strong> permissions. Never enable Withdrawal.
                Keys are encrypted at rest with AES-256-GCM.
              </p>
            </div>
          </div>

          {user?.hasApiKeys && (
            <div className="flex items-center gap-2 text-sm text-emerald-400">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              API keys configured
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm text-slate-300">API Key</Label>
              <div className="relative">
                <Input
                  type={showApiKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    user?.hasApiKeys ? "Enter new key to replace" : "Enter API key"
                  }
                  className="h-11 bg-[#0a0e17] border-slate-700/50 font-mono text-sm pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {showApiKey ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm text-slate-300">API Secret</Label>
              <div className="relative">
                <Input
                  type={showApiSecret ? "text" : "password"}
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  placeholder={
                    user?.hasApiKeys
                      ? "Enter new secret to replace"
                      : "Enter API secret"
                  }
                  className="h-11 bg-[#0a0e17] border-slate-700/50 font-mono text-sm pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowApiSecret(!showApiSecret)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {showApiSecret ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <Button
            onClick={() => saveKeysMutation.mutate({ apiKey, apiSecret })}
            disabled={!apiKey || !apiSecret || saveKeysMutation.isPending}
            className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white shadow-lg shadow-emerald-500/20"
          >
            {saveKeysMutation.isPending ? "Validating..." : "Save API Keys"}
          </Button>
        </CardContent>
      </Card>

      {/* Copy Settings */}
      <Card className="bg-[#111827] border-white/[0.06]">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Percent className="w-4 h-4 text-cyan-400" />
            Copy Trading Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Copy Ratio */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm text-slate-300">Copy Ratio</Label>
              <span className="text-sm font-mono font-semibold text-emerald-400">
                {copyRatio[0]}%
              </span>
            </div>
            <Slider
              value={copyRatio}
              onValueChange={setCopyRatio}
              min={1}
              max={50}
              step={1}
              className="w-full"
            />
            <p className="text-xs text-slate-500">
              Percentage of your USDT balance used per trade
            </p>
          </div>

          {/* Max Trade USD */}
          <div className="space-y-2">
            <Label className="text-sm text-slate-300 flex items-center gap-2">
              <DollarSign className="w-3.5 h-3.5" />
              Max Trade Size (USD)
            </Label>
            <Input
              type="number"
              value={maxTradeUsd}
              onChange={(e) => setMaxTradeUsd(e.target.value)}
              placeholder="No limit"
              className="h-11 bg-[#0a0e17] border-slate-700/50 font-mono text-sm"
            />
            <p className="text-xs text-slate-500">
              Maximum USD value per copied trade (leave empty for no limit)
            </p>
          </div>

          {/* Enable/Disable */}
          <div className="flex items-center justify-between p-4 rounded-lg bg-white/[0.02] border border-white/[0.04]">
            <div>
              <p className="text-sm font-medium">Enable Copy Trading</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {!user?.hasApiKeys
                  ? "Add API keys first to enable"
                  : "Automatically copy leader trades"}
              </p>
            </div>
            <Switch
              checked={copyingEnabled}
              onCheckedChange={setCopyingEnabled}
              disabled={!user?.hasApiKeys}
            />
          </div>

          <Button
            onClick={() =>
              saveConfigMutation.mutate({
                copyRatioPercent: copyRatio[0],
                maxTradeUsd: maxTradeUsd || null,
                copyingEnabled,
              })
            }
            disabled={saveConfigMutation.isPending}
            className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white shadow-lg shadow-emerald-500/20"
          >
            {saveConfigMutation.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
