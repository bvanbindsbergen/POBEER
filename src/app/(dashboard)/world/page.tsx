"use client";

import { useState } from "react";
import { Globe, ExternalLink, AlertTriangle, Maximize2, Minimize2 } from "lucide-react";

const CRUCIX_URL = process.env.NEXT_PUBLIC_CRUCIX_URL || "";

export default function WorldPage() {
  const [fullscreen, setFullscreen] = useState(false);

  if (!CRUCIX_URL) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Globe className="w-6 h-6 text-cyan-400" />
            World Overview
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Global intelligence dashboard — OSINT, markets, conflicts, sentiment
          </p>
        </div>
        <div className="rounded-xl bg-[#0a0f1a] border border-white/[0.06] p-12 text-center space-y-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/alphora-world-logo.png" alt="Alphora World" className="w-48 h-48 mx-auto object-contain opacity-80" />
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-slate-200">Alphora World Not Connected</h2>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              Set the <code className="text-violet-300 bg-violet-500/10 px-1.5 py-0.5 rounded text-xs">NEXT_PUBLIC_CRUCIX_URL</code> environment
              variable to your Alphora World deployment URL to enable global intelligence.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-[#070b12]">
        <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
          <a
            href={CRUCIX_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-lg bg-black/60 text-slate-400 hover:text-white transition-colors backdrop-blur-sm"
            title="Open in new tab"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
          <button
            onClick={() => setFullscreen(false)}
            className="p-2 rounded-lg bg-black/60 text-slate-400 hover:text-white transition-colors backdrop-blur-sm"
            title="Exit fullscreen"
          >
            <Minimize2 className="w-4 h-4" />
          </button>
        </div>
        <iframe
          src={CRUCIX_URL}
          className="w-full h-full border-0"
          allow="fullscreen"
          title="Crucix Intelligence Dashboard"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Globe className="w-6 h-6 text-cyan-400" />
            World Overview
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Global intelligence — 27 OSINT sources, updated every 15 minutes
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={CRUCIX_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.04] transition-colors"
            title="Open in new tab"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
          <button
            onClick={() => setFullscreen(true)}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.04] transition-colors"
            title="Fullscreen"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="rounded-xl overflow-hidden border border-white/[0.06] bg-[#0a0f1a]" style={{ height: "calc(100vh - 180px)" }}>
        <iframe
          src={CRUCIX_URL}
          className="w-full h-full border-0"
          allow="fullscreen"
          title="Crucix Intelligence Dashboard"
        />
      </div>
    </div>
  );
}
