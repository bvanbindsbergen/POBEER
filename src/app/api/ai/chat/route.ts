import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiMessages, aiConversations, leaderTrades, positions } from "@/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { streamChat, type ChatMessage } from "@/lib/ai/claude";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const { message, conversationId } = await req.json();

    if (!message || !conversationId) {
      return new Response(JSON.stringify({ error: "Missing message or conversationId" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Verify conversation belongs to user
    const [conversation] = await db
      .select()
      .from(aiConversations)
      .where(
        and(
          eq(aiConversations.id, conversationId),
          eq(aiConversations.userId, auth.user.id)
        )
      )
      .limit(1);

    if (!conversation) {
      return new Response(JSON.stringify({ error: "Conversation not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Store user message
    await db.insert(aiMessages).values({
      conversationId,
      role: "user",
      content: message,
    });

    // Load conversation history (last 20 messages)
    const history = await db
      .select()
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, conversationId))
      .orderBy(desc(aiMessages.createdAt))
      .limit(20);

    const chatMessages: ChatMessage[] = history
      .reverse()
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    // Build context from leader's data
    const recentTrades = await db
      .select()
      .from(leaderTrades)
      .orderBy(desc(leaderTrades.detectedAt))
      .limit(5);

    const openPositions = await db
      .select()
      .from(positions)
      .where(
        and(
          eq(positions.userId, auth.user.id),
          eq(positions.status, "open")
        )
      );

    const context = {
      recentTrades: recentTrades.map((t) => ({
        symbol: t.symbol,
        side: t.side,
        price: t.avgFillPrice || t.price || "N/A",
        timestamp: t.detectedAt.toISOString(),
      })),
      openPositions: openPositions.map((p) => ({
        symbol: p.symbol,
        side: p.side,
        entryPrice: p.entryPrice,
        pnl: p.realizedPnl || "0",
      })),
      activeSymbols: [...new Set(recentTrades.map((t) => t.symbol))],
    };

    // Stream response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        let fullText = "";

        streamChat(auth.user, chatMessages, {
          onText: (text) => {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "text", content: text })}\n\n`)
            );
            fullText += text;
          },
          onToolCall: (name, input) => {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "tool_call", name, input })}\n\n`
              )
            );
          },
          onToolResult: (name, result) => {
            // Send a compact version to the client
            let parsed;
            try {
              parsed = JSON.parse(result);
            } catch {
              parsed = result;
            }
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "tool_result", name, result: parsed })}\n\n`
              )
            );
          },
          onDone: async (lastText, toolCalls) => {
            const totalText = fullText + lastText;
            // Store assistant message
            await db.insert(aiMessages).values({
              conversationId,
              role: "assistant",
              content: totalText,
              toolCalls: toolCalls.length > 0 ? JSON.stringify(toolCalls.map((t) => ({ name: t.name, input: t.input }))) : null,
              toolResults: toolCalls.length > 0 ? JSON.stringify(toolCalls.map((t) => ({ name: t.name, result: t.result }))) : null,
            });

            // Update conversation title if it's the first message
            if (chatMessages.length <= 2) {
              const title = message.slice(0, 80) + (message.length > 80 ? "..." : "");
              await db
                .update(aiConversations)
                .set({ title, updatedAt: new Date() })
                .where(eq(aiConversations.id, conversationId));
            }

            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
            );
            controller.close();
          },
          onError: (error) => {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "error", message: error.message })}\n\n`
              )
            );
            controller.close();
          },
        }, context);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    console.error("Chat error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
