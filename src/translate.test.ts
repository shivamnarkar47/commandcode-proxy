import { describe, expect, test } from "bun:test";
import {
  openaiMessagesToAlpha,
  openaiToolsToAlpha,
  readNdjsonLines,
  mapFinish,
  normalizeFinishReason,
  buildSSEChunk,
  parseAlphaUsage,
} from "./translate.js";

function ndjsonStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]!));
        i++;
      } else {
        controller.close();
      }
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const line of readNdjsonLines(stream)) out.push(line);
  return out;
}

describe("readNdjsonLines", () => {
  test("splits lines across chunks", async () => {
    const lines = await collect(ndjsonStream(['{"a":1}\n{"b"', ':2}\n']));
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  test("yields each line of final buffer without trailing newline", async () => {
    const lines = await collect(ndjsonStream(['{"a":1}\n{"b":2}']));
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  test("skips empty lines", async () => {
    const lines = await collect(ndjsonStream(["\n\n{}\n\n"]));
    expect(lines).toEqual(["{}"]);
  });
});

describe("openaiMessagesToAlpha", () => {
  test("merges system messages", () => {
    const { system, messages } = openaiMessagesToAlpha([
      { role: "system", content: "a" },
      { role: "system", content: "b" },
      { role: "user", content: "hi" },
    ]);
    expect(system).toBe("a\n\nb");
    expect(messages.length).toBe(1);
  });

  test("maps image content with media type", () => {
    const { messages } = openaiMessagesToAlpha([
      {
        role: "user",
        content: [{ type: "image_url", image_url: { url: "https://x/y.jpg" } }],
      },
    ]);
    expect(messages[0]!.content[0]).toEqual({
      type: "image",
      image: "https://x/y.jpg",
      mediaType: "image/jpeg",
    });
  });

  test("groups tool results into one message", () => {
    const { messages } = openaiMessagesToAlpha([
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "c1", function: { name: "read", arguments: "{}" } }],
      } as never,
      { role: "tool", tool_call_id: "c1", name: "read", content: "out1" },
      { role: "tool", tool_call_id: "c1", name: "read", content: "out2" },
    ]);
    const last = messages[messages.length - 1]!;
    expect(last.role).toBe("tool");
    expect(last.content.length).toBe(2);
  });
});

describe("openaiToolsToAlpha", () => {
  test("maps function tools", () => {
    const tools = openaiToolsToAlpha([
      { type: "function", function: { name: "read", description: "d", parameters: { type: "object" } } },
    ]);
    expect(tools).toEqual([{ name: "read", description: "d", input_schema: { type: "object" } }]);
  });

  test("drops unknown shapes", () => {
    expect(openaiToolsToAlpha([{} as never])).toEqual([]);
    expect(openaiToolsToAlpha()).toEqual([]);
  });
});

describe("mapFinish / normalizeFinishReason", () => {
  test("maps upstream reasons", () => {
    expect(mapFinish("tool-calls")).toBe("tool_calls");
    expect(mapFinish("tool_calls")).toBe("tool_calls");
    expect(mapFinish("length")).toBe("length");
    expect(mapFinish("other")).toBe("stop");
    expect(mapFinish(undefined)).toBe("stop");
  });

  test("flips stop to tool_calls when tools were emitted", () => {
    expect(normalizeFinishReason("stop", 1)).toBe("tool_calls");
    expect(normalizeFinishReason("stop", 0)).toBe("stop");
    expect(normalizeFinishReason("length", 2)).toBe("length");
  });
});

describe("parseAlphaUsage / buildSSEChunk", () => {
  test("parses usage with cache hits", () => {
    expect(parseAlphaUsage({ inputTokens: 1, outputTokens: 2, cachedInputTokens: 1 })).toEqual({
      prompt_tokens: 1,
      completion_tokens: 2,
      total_tokens: 3,
      prompt_cache_hit_tokens: 1,
    });
    expect(parseAlphaUsage(undefined)).toBeNull();
  });

  test("builds chunk shape", () => {
    const chunk = buildSSEChunk("id1", 5, "m", { content: "hi" }, null);
    expect(chunk.choices[0]!.delta).toEqual({ content: "hi" });
    expect(chunk.choices[0]!.finish_reason).toBeNull();
  });
});
