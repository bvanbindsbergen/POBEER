"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { MessageBubble } from "./message-bubble";
import { ToolResultCard } from "./tool-result-card";
import { Plus, Send, MessageSquare, Trash2, Loader2 } from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: string | null;
  toolResults?: string | null;
}

interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
}

interface StreamEvent {
  type: "text" | "tool_call" | "tool_result" | "done" | "error";
  content?: string;
  name?: string;
  input?: unknown;
  result?: unknown;
  message?: string;
}

interface ChatPanelProps {
  onStrategyAction?: (action: "save" | "backtest", data: unknown) => void;
}

export function ChatPanel({ onStrategyAction }: ChatPanelProps) {
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [toolEvents, setToolEvents] = useState<StreamEvent[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // Fetch conversations
  const { data: convData } = useQuery({
    queryKey: ["ai-conversations"],
    queryFn: async () => {
      const res = await fetch("/api/ai/conversations");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });
  const conversations: Conversation[] = convData?.conversations || [];

  // Fetch messages for active conversation
  const { data: msgData } = useQuery({
    queryKey: ["ai-messages", activeConversation],
    queryFn: async () => {
      if (!activeConversation) return { messages: [] };
      const res = await fetch(`/api/ai/conversations/${activeConversation}/messages`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!activeConversation,
  });
  const messages: Message[] = msgData?.messages || [];

  // Create conversation
  const createConv = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ai/conversations", { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: (data) => {
      setActiveConversation(data.conversation.id);
      queryClient.invalidateQueries({ queryKey: ["ai-conversations"] });
    },
  });

  // Delete conversation
  const deleteConv = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/ai/conversations/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      if (activeConversation) {
        setActiveConversation(null);
      }
      queryClient.invalidateQueries({ queryKey: ["ai-conversations"] });
    },
  });

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  // Send message with streaming
  const sendMessage = useCallback(async () => {
    if (!input.trim() || isStreaming) return;

    let convId = activeConversation;
    if (!convId) {
      const res = await fetch("/api/ai/conversations", { method: "POST" });
      const data = await res.json();
      convId = data.conversation.id;
      setActiveConversation(convId);
      queryClient.invalidateQueries({ queryKey: ["ai-conversations"] });
    }

    const userMessage = input.trim();
    setInput("");
    setIsStreaming(true);
    setStreamingContent("");
    setToolEvents([]);

    // Optimistically add user message
    queryClient.setQueryData(
      ["ai-messages", convId],
      (old: { messages: Message[] } | undefined) => ({
        messages: [
          ...(old?.messages || []),
          { id: `temp-${Date.now()}`, role: "user" as const, content: userMessage },
        ],
      })
    );

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage, conversationId: convId }),
      });

      if (!res.ok) throw new Error("Chat request failed");
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event: StreamEvent = JSON.parse(line.slice(6));

            if (event.type === "text") {
              fullContent += event.content || "";
              setStreamingContent(fullContent);
            } else if (event.type === "tool_call" || event.type === "tool_result") {
              setToolEvents((prev) => [...prev, event]);
              if (event.type === "tool_result") {
                // Reset content accumulator for post-tool text
                fullContent = "";
                setStreamingContent("");
              }
            } else if (event.type === "done") {
              // Done
            } else if (event.type === "error") {
              console.error("Stream error:", event.message);
            }
          } catch {
            // Skip malformed events
          }
        }
      }
    } catch (error) {
      console.error("Chat error:", error);
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
      setToolEvents([]);
      queryClient.invalidateQueries({ queryKey: ["ai-messages", convId] });
      queryClient.invalidateQueries({ queryKey: ["ai-conversations"] });
    }
  }, [input, isStreaming, activeConversation, queryClient]);

  return (
    <div className="flex h-[calc(100vh-12rem)] gap-4">
      {/* Conversation Sidebar */}
      <div className="w-56 flex-shrink-0 flex flex-col bg-[#0d1117] rounded-xl border border-white/[0.06] overflow-hidden">
        <div className="p-3 border-b border-white/[0.06]">
          <Button
            size="sm"
            onClick={() => createConv.mutate()}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8"
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            New Chat
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer text-xs transition-colors ${
                activeConversation === conv.id
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-300"
              }`}
              onClick={() => setActiveConversation(conv.id)}
            >
              <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate flex-1">{conv.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteConv.mutate(conv.id);
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 transition-all"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          {conversations.length === 0 && (
            <p className="text-[11px] text-slate-600 text-center py-4">
              No conversations yet
            </p>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col bg-[#0d1117] rounded-xl border border-white/[0.06] overflow-hidden">
        {!activeConversation ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center mb-4">
              <MessageSquare className="w-6 h-6 text-emerald-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-200 mb-1">AI Trading Assistant</h3>
            <p className="text-sm text-slate-500 max-w-md">
              Ask about market conditions, discover strategies, or backtest trading ideas.
            </p>
            <Button
              onClick={() => createConv.mutate()}
              className="mt-4 bg-emerald-600 hover:bg-emerald-700 text-white"
              size="sm"
            >
              Start a Conversation
            </Button>
          </div>
        ) : (
          <>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg) => {
                if (msg.role === "system") return null;
                return (
                  <MessageBubble
                    key={msg.id}
                    role={msg.role as "user" | "assistant"}
                    content={msg.content}
                  />
                );
              })}

              {/* Streaming content */}
              {toolEvents.map((evt, i) => {
                if (evt.type === "tool_call") {
                  return (
                    <div key={`tc-${i}`} className="mx-10 my-1 flex items-center gap-2 text-xs text-cyan-500">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Running {evt.name}...
                    </div>
                  );
                }
                if (evt.type === "tool_result" && evt.name) {
                  return (
                    <ToolResultCard
                      key={`tr-${i}`}
                      name={evt.name}
                      result={evt.result}
                    />
                  );
                }
                return null;
              })}

              {streamingContent && (
                <MessageBubble role="assistant" content={streamingContent} />
              )}

              {isStreaming && !streamingContent && toolEvents.length === 0 && (
                <div className="flex items-center gap-2 text-xs text-slate-500 ml-10">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500" />
                  Thinking...
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-3 border-t border-white/[0.06]">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder="Ask about strategies, market conditions, or request a backtest..."
                  className="flex-1 h-10 px-4 rounded-lg bg-[#070b12] border border-white/[0.06] text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/30 transition-colors"
                  disabled={isStreaming}
                />
                <Button
                  onClick={sendMessage}
                  disabled={!input.trim() || isStreaming}
                  size="sm"
                  className="h-10 px-4 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
