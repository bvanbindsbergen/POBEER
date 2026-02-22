"use client";

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Percent, DollarSign } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

interface CopySettingsFormProps {
  user: {
    hasApiKeys?: boolean;
    copyRatioPercent?: string;
    maxTradeUsd?: string | null;
    copyingEnabled?: boolean;
  } | null;
  onSuccess?: () => void;
}

export function CopySettingsForm({ user, onSuccess }: CopySettingsFormProps) {
  const queryClient = useQueryClient();
  const [copyRatio, setCopyRatio] = useState<number[]>([
    Number(user?.copyRatioPercent) || 10,
  ]);
  const [maxTradeUsd, setMaxTradeUsd] = useState(
    user?.maxTradeUsd?.toString() || ""
  );
  const [copyingEnabled, setCopyingEnabled] = useState(
    user?.copyingEnabled || false
  );

  useEffect(() => {
    if (user) {
      setCopyRatio([Number(user.copyRatioPercent) || 10]);
      setMaxTradeUsd(user.maxTradeUsd?.toString() || "");
      setCopyingEnabled(user.copyingEnabled || false);
    }
  }, [user]);

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
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  return (
    <Card className="bg-[#111827] border-white/[0.06]">
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Percent className="w-4 h-4 text-cyan-400" />
          Copy Trading Settings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
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
  );
}
