"use client";

import { User, Bot } from "lucide-react";

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
}

export function MessageBubble({ role, content }: MessageBubbleProps) {
  const isUser = role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
          isUser
            ? "bg-emerald-500/20 text-emerald-400"
            : "bg-cyan-500/20 text-cyan-400"
        }`}
      >
        {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
      </div>
      <div
        className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-emerald-600/20 text-slate-200 rounded-tr-sm"
            : "bg-[#1a2332] text-slate-300 rounded-tl-sm"
        }`}
      >
        <div className="whitespace-pre-wrap break-words prose-invert prose-sm [&_strong]:text-emerald-300 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_code]:bg-black/30 [&_code]:px-1 [&_code]:rounded [&_code]:text-xs">
          {renderMarkdown(content)}
        </div>
      </div>
    </div>
  );
}

function renderMarkdown(text: string) {
  // Simple markdown rendering - bold, inline code, lists
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={i}>{part.slice(1, -1)}</code>;
    }
    return <span key={i}>{part}</span>;
  });
}
