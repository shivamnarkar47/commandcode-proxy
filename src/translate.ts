// Pure translation functions between OpenAI and CommandCode wire formats

import type {
  OpenAIMessage,
  OpenAIUserContent,
  OpenAITool,
  OpenAIToolCall,
  AlphaMessage,
  AlphaTool,
  AlphaContentPart,
  AlphaUsage,
  SSEChunk,
  SSEDelta,
} from "./types.js";

export function safeParseJson<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export function guessMediaType(url: string): string {
  const m = /^data:([^;,]+)/.exec(url);
  if (m?.[1]) return m[1];
  if (/\.png(\?|$)/i.test(url)) return "image/png";
  if (/\.jpe?g(\?|$)/i.test(url)) return "image/jpeg";
  if (/\.webp(\?|$)/i.test(url)) return "image/webp";
  if (/\.gif(\?|$)/i.test(url)) return "image/gif";
  return "image/png";
}

function contentToText(c: OpenAIUserContent | null | undefined): string {
  if (c == null) return "";
  if (typeof c === "string") return c;
  if (Array.isArray(c))
    return c.map((p) => ("text" in p ? p.text : "content" in p && typeof p.content === "string" ? p.content : "") ?? "").join("");
  return String(c);
}

export function openaiMessagesToAlpha(openaiMessages: OpenAIMessage[] = []): {
  system: string;
  messages: AlphaMessage[];
  toolIdToName: Record<string, string>;
} {
  const systemParts: string[] = [];
  const messages: AlphaMessage[] = [];
  const toolIdToName: Record<string, string> = {};

  for (const msg of openaiMessages) {
    const role = msg?.role;
    if (role === "system" || role === "developer") {
      const t = contentToText((msg as { content: string }).content);
      if (t) systemParts.push(t);
    } else if (role === "user") {
      const c = (msg as { content: OpenAIUserContent }).content;
      if (typeof c === "string") {
        messages.push({ role: "user", content: [{ type: "text", text: c }] });
      } else if (Array.isArray(c)) {
        const parts: AlphaContentPart[] = [];
        for (const p of c) {
          if ("type" in p && p.type === "text") {
            parts.push({ type: "text", text: p.text ?? "" });
          } else if ("type" in p && p.type === "image_url") {
            const url = p.image_url?.url ?? "";
            parts.push({ type: "image", image: url, mediaType: guessMediaType(url) });
          } else if ("type" in p && p.type === "input_text") {
            parts.push({ type: "text", text: p.text ?? "" });
          }
        }
        messages.push({ role: "user", content: parts.length ? parts : [{ type: "text", text: "" }] });
      } else {
        messages.push({ role: "user", content: [{ type: "text", text: String(c ?? "") }] });
      }
    } else if (role === "assistant") {
      const content: AlphaContentPart[] = [];
      const assistantMsg = msg as {
        content?: string | { type: string; text?: string }[];
        tool_calls?: OpenAIToolCall[];
      };
      if (typeof assistantMsg.content === "string" && assistantMsg.content) {
        content.push({ type: "text", text: assistantMsg.content });
      } else if (Array.isArray(assistantMsg.content)) {
        for (const p of assistantMsg.content) {
          if (typeof p === "string") content.push({ type: "text", text: p });
          else if (p?.type === "text") content.push({ type: "text", text: p.text ?? "" });
          else if (p?.type === "reasoning") content.push({ type: "text", text: p.text ?? "" });
        }
      }
      for (const tc of assistantMsg.tool_calls ?? []) {
        const name = tc?.function?.name ?? tc?.name ?? "tool";
        toolIdToName[tc.id] = name;
        content.push({
          type: "tool-call",
          toolCallId: tc.id,
          toolName: name,
          input: typeof tc.function?.arguments === "string"
            ? safeParseJson<Record<string, unknown>>(tc.function.arguments, {})
            : (tc.function?.arguments ?? tc.input ?? {}),
        });
      }
      if (content.length) messages.push({ role: "assistant", content });
    } else if (role === "tool" || role === "function") {
      const toolMsg = msg as {
        tool_call_id?: string;
        id?: string;
        toolCallId?: string;
        name?: string;
        content: string;
      };
      const toolCallId = toolMsg.tool_call_id || toolMsg.id || toolMsg.toolCallId || "call_unknown";
      const toolName = toolMsg.name || toolIdToName[toolCallId] || "tool";
      const value = typeof toolMsg.content === "string" ? toolMsg.content : JSON.stringify(toolMsg.content ?? "");
      const entry: AlphaContentPart = {
        type: "tool-result",
        toolCallId,
        toolName,
        output: { type: "text", value },
      };
      const last = messages[messages.length - 1];
      if (last?.role === "tool") last.content.push(entry);
      else messages.push({ role: "tool", content: [entry] });
    }
  }

  return { system: systemParts.join("\n\n"), messages, toolIdToName };
}

export function openaiToolsToAlpha(tools: OpenAITool[] = []): AlphaTool[] {
  if (!tools?.length) return [];
  return tools
    .map((t): AlphaTool | null => {
      if (t?.type === "function" && t.function) {
        return {
          name: t.function.name,
          description: t.function.description || "",
          input_schema: t.function.parameters || { type: "object", properties: {} },
        };
      }
      if (t?.name && t?.input_schema) {
        return { name: t.name, description: t.description || "", input_schema: t.input_schema };
      }
      if (t?.function?.name) {
        return {
          name: t.function.name,
          description: t.function.description || "",
          input_schema: t.function.parameters || { type: "object", properties: {} },
        };
      }
      return null;
    })
    .filter((t): t is AlphaTool => t !== null);
}

export async function* readNdjsonLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: true });
    if (done) {
      buf += decoder.decode();
      if (buf.trim()) yield buf;
      break;
    }
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line) yield line;
    }
  }
}

export function mapFinish(reason: string | undefined): "stop" | "length" | "tool_calls" {
  if (reason === "tool-calls" || reason === "tool_calls") return "tool_calls";
  if (reason === "length") return "length";
  return "stop";
}

export function buildSSEChunk(
  chatId: string,
  created: number,
  model: string,
  delta: SSEDelta,
  finishReason: "stop" | "length" | "tool_calls" | null,
): SSEChunk {
  return {
    id: chatId,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

export function sseChunk(res: { write: (s: string) => void }, chunk: SSEChunk): void {
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

export function parseAlphaUsage(u: AlphaUsage | undefined): {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_cache_hit_tokens?: number;
} | null {
  if (!u) return null;
  return {
    prompt_tokens: u.inputTokens ?? 0,
    completion_tokens: u.outputTokens ?? 0,
    total_tokens: u.totalTokens ?? ((u.inputTokens ?? 0) + (u.outputTokens ?? 0)),
    ...(u.cachedInputTokens != null ? { prompt_cache_hit_tokens: u.cachedInputTokens } : {}),
  };
}
