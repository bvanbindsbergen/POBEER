"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Key, Shield, Eye, EyeOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

interface ApiKeyFormProps {
  hasApiKeys?: boolean;
  onSuccess?: () => void;
}

export function ApiKeyForm({ hasApiKeys, onSuccess }: ApiKeyFormProps) {
  const queryClient = useQueryClient();
  const [showApiKey, setShowApiKey] = useState(false);
  const [showApiSecret, setShowApiSecret] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");

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
              <strong>Read</strong> permissions. Never enable Withdrawal. Keys
              are encrypted at rest with AES-256-GCM.
            </p>
          </div>
        </div>

        {hasApiKeys && (
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
                  hasApiKeys ? "Enter new key to replace" : "Enter API key"
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
                  hasApiKeys
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
  );
}
