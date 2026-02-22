"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ApiKeyForm } from "@/components/api-key-form";
import { CopySettingsForm } from "@/components/copy-settings-form";
import {
  CheckCircle,
  ChevronRight,
  ExternalLink,
  Beer,
  Key,
  Settings,
  Rocket,
} from "lucide-react";

const STEPS = [
  { id: 1, title: "Create ByBit Account", icon: Beer },
  { id: 2, title: "Create API Keys", icon: Key },
  { id: 3, title: "Enter API Keys", icon: Key },
  { id: 4, title: "Configure Settings", icon: Settings },
  { id: 5, title: "All Done!", icon: Rocket },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);

  const { data: authData } = useQuery({
    queryKey: ["auth"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me");
      if (!res.ok) throw new Error("Not authenticated");
      return res.json();
    },
  });

  const user = authData?.user;

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome to <span className="text-emerald-400">POBEER</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Let&apos;s get you set up for copy trading in a few simple steps
        </p>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center gap-2">
        {STEPS.map((step, idx) => (
          <div key={step.id} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                currentStep > step.id
                  ? "bg-emerald-500/20 text-emerald-400"
                  : currentStep === step.id
                    ? "bg-emerald-500 text-white"
                    : "bg-white/[0.06] text-slate-500"
              }`}
            >
              {currentStep > step.id ? (
                <CheckCircle className="w-4 h-4" />
              ) : (
                step.id
              )}
            </div>
            {idx < STEPS.length - 1 && (
              <div
                className={`w-8 h-0.5 ${
                  currentStep > step.id ? "bg-emerald-500/50" : "bg-white/[0.06]"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: Create ByBit Account */}
      {currentStep === 1 && (
        <Card className="bg-[#111827] border-white/[0.06]">
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              Step 1: Create a ByBit Account
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-400">
              You need a ByBit account to start copy trading. If you already have
              one, skip to the next step.
            </p>
            <ol className="space-y-3 text-sm text-slate-300">
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-white/[0.06] flex items-center justify-center text-xs font-bold">
                  1
                </span>
                <span>
                  Go to{" "}
                  <a
                    href="https://www.bybit.com/register"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-400 hover:underline inline-flex items-center gap-1"
                  >
                    bybit.com/register
                    <ExternalLink className="w-3 h-3" />
                  </a>{" "}
                  and create an account
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-white/[0.06] flex items-center justify-center text-xs font-bold">
                  2
                </span>
                <span>Complete identity verification (KYC)</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-white/[0.06] flex items-center justify-center text-xs font-bold">
                  3
                </span>
                <span>
                  Fund your account with USDT (deposit via bank transfer, card,
                  or crypto)
                </span>
              </li>
            </ol>

            <div className="flex gap-3 pt-2">
              <Button
                onClick={() => setCurrentStep(2)}
                className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white"
              >
                I Have a ByBit Account
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Create API Keys */}
      {currentStep === 2 && (
        <Card className="bg-[#111827] border-white/[0.06]">
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              Step 2: Create API Keys on ByBit
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-400">
              API keys allow POBEER to place trades on your behalf. Follow these
              steps carefully:
            </p>
            <ol className="space-y-3 text-sm text-slate-300">
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-white/[0.06] flex items-center justify-center text-xs font-bold">
                  1
                </span>
                <span>
                  Log into ByBit and go to{" "}
                  <a
                    href="https://www.bybit.com/app/user/api-management"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-400 hover:underline inline-flex items-center gap-1"
                  >
                    API Management
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-white/[0.06] flex items-center justify-center text-xs font-bold">
                  2
                </span>
                <span>
                  Click &ldquo;Create New Key&rdquo; and select
                  &ldquo;System-generated API Keys&rdquo;
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-white/[0.06] flex items-center justify-center text-xs font-bold">
                  3
                </span>
                <div>
                  <span>Set these permissions:</span>
                  <ul className="mt-1 ml-4 space-y-1 text-xs text-slate-400">
                    <li className="text-emerald-400">
                      Read-Only: <strong>Enabled</strong>
                    </li>
                    <li className="text-emerald-400">
                      Spot Trading: <strong>Enabled</strong>
                    </li>
                    <li className="text-red-400">
                      Withdrawal: <strong>DISABLED</strong> (very important!)
                    </li>
                  </ul>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-white/[0.06] flex items-center justify-center text-xs font-bold">
                  4
                </span>
                <span>
                  Copy both the API Key and API Secret — you&apos;ll need them
                  in the next step
                </span>
              </li>
            </ol>

            <div className="bg-red-500/5 border border-red-500/15 rounded-lg p-3">
              <p className="text-xs text-red-200/80">
                <strong>Security Warning:</strong> Never enable Withdrawal
                permissions. POBEER only needs Spot Trading access. Your API
                secret will be shown only once by ByBit — save it securely.
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => setCurrentStep(1)}
                className="border-white/[0.06]"
              >
                Back
              </Button>
              <Button
                onClick={() => setCurrentStep(3)}
                className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white"
              >
                I&apos;ve Created My API Keys
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Enter API Keys */}
      {currentStep === 3 && (
        <div className="space-y-4">
          <ApiKeyForm
            hasApiKeys={user?.hasApiKeys}
            onSuccess={() => setCurrentStep(4)}
          />
          <Button
            variant="outline"
            onClick={() => setCurrentStep(2)}
            className="border-white/[0.06]"
          >
            Back
          </Button>
        </div>
      )}

      {/* Step 4: Configure Copy Settings */}
      {currentStep === 4 && (
        <div className="space-y-4">
          <CopySettingsForm
            user={user}
            onSuccess={() => setCurrentStep(5)}
          />
          <Button
            variant="outline"
            onClick={() => setCurrentStep(3)}
            className="border-white/[0.06]"
          >
            Back
          </Button>
        </div>
      )}

      {/* Step 5: All Done */}
      {currentStep === 5 && (
        <Card className="bg-[#111827] border-white/[0.06]">
          <CardContent className="py-12">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-emerald-400" />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-foreground">
                  You&apos;re All Set!
                </h2>
                <p className="text-sm text-muted-foreground max-w-md">
                  Your account is configured and ready. When the leader makes a
                  trade, it will be automatically copied to your ByBit account
                  based on your settings.
                </p>
              </div>
              <Button
                onClick={() => router.push("/")}
                className="mt-4 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-white font-semibold"
              >
                Go to Dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
