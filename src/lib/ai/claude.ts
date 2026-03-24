import Anthropic from "@anthropic-ai/sdk";
import { aiTools } from "./tools";
import { executeToolCall } from "./tool-executor";
import { buildSystemPrompt } from "./prompts";
import type { User } from "@/lib/db/schema";

const MAX_TOOL_ITERATIONS = 3;
const MODEL = "claude-sonnet-4-6";

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StreamCallbacks {
  onText: (text: string) => void;
  onToolCall: (name: string, input: Record<string, unknown>) => void;
  onToolResult: (name: string, result: string) => void;
  onDone: (fullText: string, toolCalls: { name: string; input: unknown; result: string }[]) => void;
  onError: (error: Error) => void;
}

export async function streamChat(
  user: User,
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  context?: Parameters<typeof buildSystemPrompt>[1]
) {
  const client = getClient();
  const systemPrompt = buildSystemPrompt(user, context);

  // Build Anthropic message format
  const anthropicMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let fullText = "";
  const allToolCalls: { name: string; input: unknown; result: string }[] = [];
  let iteration = 0;

  while (iteration < MAX_TOOL_ITERATIONS + 1) {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: anthropicMessages,
      tools: aiTools,
    });

    let currentToolUseId = "";
    let currentToolName = "";
    let currentToolInput = "";
    let hasToolUse = false;
    const toolUseBlocks: { id: string; name: string; input: Record<string, unknown> }[] = [];

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        if (event.content_block.type === "text") {
          // text block starting
        } else if (event.content_block.type === "tool_use") {
          hasToolUse = true;
          currentToolUseId = event.content_block.id;
          currentToolName = event.content_block.name;
          currentToolInput = "";
          callbacks.onToolCall(currentToolName, {});
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          fullText += event.delta.text;
          callbacks.onText(event.delta.text);
        } else if (event.delta.type === "input_json_delta") {
          currentToolInput += event.delta.partial_json;
        }
      } else if (event.type === "content_block_stop") {
        if (currentToolName && currentToolInput) {
          try {
            const parsed = JSON.parse(currentToolInput);
            toolUseBlocks.push({
              id: currentToolUseId,
              name: currentToolName,
              input: parsed,
            });
          } catch {
            toolUseBlocks.push({
              id: currentToolUseId,
              name: currentToolName,
              input: {},
            });
          }
          currentToolName = "";
          currentToolInput = "";
        }
      }
    }

    if (!hasToolUse || iteration >= MAX_TOOL_ITERATIONS) {
      break;
    }

    // Execute tool calls and continue conversation
    // Build the assistant message with all content blocks
    const assistantContent: Anthropic.ContentBlockParam[] = [];
    if (fullText) {
      assistantContent.push({ type: "text", text: fullText });
    }
    for (const block of toolUseBlocks) {
      assistantContent.push({
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input,
      });
    }

    anthropicMessages.push({ role: "assistant", content: assistantContent });

    // Execute each tool and collect results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      const result = await executeToolCall(
        block.name,
        block.input as Record<string, unknown>,
        user.id
      );
      callbacks.onToolResult(block.name, result);
      allToolCalls.push({ name: block.name, input: block.input, result });
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result,
      });
    }

    anthropicMessages.push({ role: "user", content: toolResults });

    // Reset for next iteration
    fullText = "";
    iteration++;
  }

  callbacks.onDone(fullText, allToolCalls);
}
