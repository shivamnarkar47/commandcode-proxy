#!/usr/bin/env bun
// CommandCode Go proxy: OpenAI Chat Completions -> POST /alpha/generate (NDJSON) -> OpenAI SSE/JSON.
// Zero deps. Run: COMMANDCODE_API_KEY=user_xxx bun run proxy.ts [--port 18731]
// See wire doc: /alpha/generate takes {config,memory,params:{model,system,messages:ModelMessage[],tools}},
// returns newline-delimited JSON (NOT SSE). This shim translates both directions.

import os from "node:os";
import path from "node:path";
import {
  openaiMessagesToAlpha,
  openaiToolsToAlpha,
  readNdjsonLines,
  mapFinish,
  sseChunk,
  buildSSEChunk,
  parseAlphaUsage,
} from "./translate.js";
import type {
  OpenAIChatRequest,
  OpenAIUsage,
  NdJsonEvent,
  SSEDelta,
} from "./types.js";

const PORT = parseInt(
  process.argv.includes("--port")
    ? process.argv[process.argv.indexOf("--port") + 1] ?? "18731"
    : process.env.PORT ?? "18731",
  10,
);
const UPSTREAM = (process.env.COMMANDCODE_BASE_URL || "https://api.commandcode.ai").replace(/\/$/, "");
const VERSION = process.env.COMMANDCODE_VERSION || "0.52.1";
const WORKING_DIR = process.env.COMMANDCODE_WORKING_DIR || process.cwd();

const STATIC_MODELS = [
  "deepseek/deepseek-v4-flash",
  "meituan/LongCat-2.0:free",
  "zai-org/glm-5.3-flash",
  "meta/muse-spark-1.3-contributor",
  "meta/muse-spark-1.2-contributor",
];

// --- Key resolution: env -> incoming Bearer (opencode forwards /connect key) -> auth.json ---

let cachedFileKey: { key: string; source: string } | null = null;

function authJsonCandidates(): string[] {
  const candidates: (string | undefined)[] = [process.env.OPENCODE_AUTH_PATH];
  if (process.platform === "win32") {
    if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, "opencode", "auth.json"));
    if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, "opencode", "auth.json"));
  } else {
    candidates.push(
      path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "opencode", "auth.json"),
    );
  }
  return candidates.filter((c): c is string => Boolean(c));
}

async function keyFromAuthFile(): Promise<{ key: string; source: string } | null> {
  if (cachedFileKey) return cachedFileKey;
  for (const f of authJsonCandidates()) {
    try {
      const raw = await Bun.file(f).text();
      const db = JSON.parse(raw) as Record<string, string | { key?: string }>;
      for (const id of ["commandcode", "commandcode-go", "opencode-go"]) {
        const entry = db?.[id];
        const key = typeof entry === "string" ? entry : entry?.key;
        if (key) {
          cachedFileKey = { key, source: `auth.json:${id}` };
          return cachedFileKey;
        }
      }
    } catch {
      /* missing/unparseable -> next */
    }
  }
  return null;
}

async function resolveApiKey(req: Request): Promise<{ key: string; source: string } | null> {
  if (process.env.COMMANDCODE_API_KEY) return { key: process.env.COMMANDCODE_API_KEY, source: "env" };
  const bearer = req.headers.get("authorization")?.startsWith("Bearer ")
    ? req.headers.get("authorization")!.slice(7).trim()
    : "";
  if (bearer) return { key: bearer, source: "bearer-header" };
  const xApiKey = req.headers.get("x-api-key");
  if (xApiKey) return { key: xApiKey, source: "x-api-key" };
  return await keyFromAuthFile();
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// --- Main handler ---

async function handleChatCompletions(req: Request): Promise<Response> {
  const resolved = await resolveApiKey(req);
  const apiKey = resolved?.key ?? "";
  if (!apiKey) {
    return Response.json(
      {
        error: {
          message:
            "No CommandCode key found (env COMMANDCODE_API_KEY, Bearer header, or ~/.local/share/opencode/auth.json `commandcode`). Re-run /connect or set env.",
          type: "auth_error",
          code: "missing_api_key",
        },
      },
      { status: 401 },
    );
  }

  const body = (await req.json()) as OpenAIChatRequest;
  const model = body.model || STATIC_MODELS[0]!;
  const { system, messages } = openaiMessagesToAlpha(body.messages || []);
  const tools = openaiToolsToAlpha(body.tools || []);
  const wantStream = body.stream !== false;

  const upstreamBody = {
    config: {
      workingDir: WORKING_DIR,
      date: todayStr(),
      environment: "production",
      structure: [],
      isGitRepo: false,
      currentBranch: "",
      mainBranch: "",
      gitStatus: "",
      recentCommits: [],
    },
    memory: "",
    taste: null,
    skills: null,
    permissionMode: "standard",
    params: {
      model,
      system: system || "",
      messages,
      tools,
      max_tokens: body.max_tokens ?? body.max_completion_tokens ?? 8000,
      ...(typeof body.temperature === "number" ? { temperature: body.temperature } : {}),
      ...(body.thinking !== undefined ? { thinking: body.thinking } : {}),
      ...(body.reasoning_effort !== undefined ? { reasoningEffort: body.reasoning_effort } : {}),
      stream: true,
    },
  };

  const sessionId = req.headers.get("x-session-id") || crypto.randomUUID();
  const upstreamHeaders: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
    "x-cli-environment": "production",
    "x-command-code-version": VERSION,
    "x-session-id": sessionId,
  };
  if (process.env.CMD_ZDR === "1") upstreamHeaders["x-cmd-zdr"] = "1";

  const t0 = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(`${UPSTREAM}/alpha/generate`, {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify(upstreamBody),
    });
  } catch (e) {
    return Response.json(
      { error: { message: `Upstream unreachable: ${(e as Error).message}`, type: "upstream_error" } },
      { status: 502 },
    );
  }
  const tHeaders = Date.now();
  let tFirst = 0;

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep raw */
    }
    return Response.json(
      parsed || { error: { message: text.slice(0, 2000) || `Upstream ${upstream.status}`, type: "upstream_error" } },
      { status: upstream.status },
    );
  }

  const chatId = `chatcmpl-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const created = Math.floor(Date.now() / 1000);

  // Accumulation state
  let fullText = "";
  let fullReasoning = "";
  const toolArgs: Record<string, string> = {};
  const toolNames: Record<string, string> = {};
  const toolOrder: string[] = [];
  const streamedDeltaIds = new Set<string>();
  let finishReason: "stop" | "length" | "tool_calls" = "stop";
  let usage: ReturnType<typeof parseAlphaUsage> = null;

  const ensureTool = (id: string, name?: string) => {
    if (!(id in toolArgs)) {
      toolArgs[id] = "";
      toolOrder.push(id);
    }
    if (name && !toolNames[id]) toolNames[id] = name;
  };
  const toolIndex = (id: string) => toolOrder.indexOf(id);

  // For non-streaming, collect everything
  const sseChunks: string[] = [];

  const writeSSE = (chunk: Parameters<typeof sseChunk>[1]) => {
    const data = `data: ${JSON.stringify(chunk)}\n\n`;
    if (wantStream) sseWritable.write(data);
    else sseChunks.push(data);
  };

  const sseWritable = {
    write: (_s: string) => {}, // placeholder, replaced below
  };

  if (wantStream) {
    // Streaming response
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    sseWritable.write = (s: string) => {
      void writer.write(encoder.encode(s));
    };

    // Start processing in background
    void (async () => {
      try {
        for await (const line of readNdjsonLines(upstream.body!)) {
          let ev: NdJsonEvent;
          try {
            ev = JSON.parse(line) as NdJsonEvent;
          } catch {
            continue;
          }
          const t = ev.type;

          if (t === "text-delta" && "text" in ev && typeof ev.text === "string") {
            fullText += ev.text;
            if (!tFirst) tFirst = Date.now();
            const delta: SSEDelta = { role: "assistant", content: ev.text };
            writeSSE(buildSSEChunk(chatId, created, model, delta, null));
          } else if (t === "reasoning-delta" && "text" in ev && typeof ev.text === "string") {
            fullReasoning += ev.text;
            if (!tFirst) tFirst = Date.now();
            const delta: SSEDelta = { role: "assistant", reasoning_content: ev.text };
            writeSSE(buildSSEChunk(chatId, created, model, delta, null));
          } else if (t === "tool-input-start") {
            const id = "id" in ev ? ev.id : "toolCallId" in ev ? ev.toolCallId : undefined;
            if (id) {
              ensureTool(id, "toolName" in ev ? ev.toolName : undefined);
              const delta: SSEDelta = {
                role: "assistant",
                tool_calls: [
                  {
                    index: toolIndex(id),
                    id,
                    type: "function",
                    function: { name: toolNames[id] || ("toolName" in ev ? ev.toolName : undefined) || "tool", arguments: "" },
                  },
                ],
              };
              writeSSE(buildSSEChunk(chatId, created, model, delta, null));
            }
          } else if (t === "tool-input-delta") {
            const id = "id" in ev ? ev.id : "toolCallId" in ev ? ev.toolCallId : undefined;
            const delta = "delta" in ev ? ev.delta : "text" in ev ? ev.text : "";
            if (id && delta) {
              ensureTool(id, "toolName" in ev ? ev.toolName : undefined);
              toolArgs[id] += delta;
              streamedDeltaIds.add(id);
              const sseDelta: SSEDelta = {
                tool_calls: [{ index: toolIndex(id), function: { arguments: delta } }],
              };
              writeSSE(buildSSEChunk(chatId, created, model, sseDelta, null));
            }
          } else if (t === "tool-call") {
            const id = "toolCallId" in ev ? ev.toolCallId : "id" in ev ? ev.id : undefined;
            if (id) {
              ensureTool(id, "toolName" in ev ? ev.toolName : undefined);
              if (!streamedDeltaIds.has(id) && "input" in ev && ev.input !== undefined) {
                const argStr = typeof ev.input === "string" ? ev.input : JSON.stringify(ev.input);
                toolArgs[id] = argStr;
                const delta: SSEDelta = {
                  role: "assistant",
                  tool_calls: [
                    {
                      index: toolIndex(id),
                      id,
                      type: "function",
                      function: { name: toolNames[id] || ("toolName" in ev ? ev.toolName : undefined) || "tool", arguments: argStr },
                    },
                  ],
                };
                writeSSE(buildSSEChunk(chatId, created, model, delta, null));
              } else if ("toolName" in ev && ev.toolName && !toolNames[id]) {
                toolNames[id] = ev.toolName;
              }
            }
          } else if (t === "finish-step" || t === "finish") {
            if ("finishReason" in ev && ev.finishReason) finishReason = mapFinish(ev.finishReason);
            else if ("finish_reason" in ev && ev.finish_reason) finishReason = mapFinish(ev.finish_reason);
            if ("usage" in ev && ev.usage) {
              usage = parseAlphaUsage(ev.usage);
            } else if ("totalUsage" in ev && "totalUsage" in ev && ev.totalUsage) {
              const u = ev.totalUsage;
              usage = {
                prompt_tokens: u.inputTokens ?? 0,
                completion_tokens: u.outputTokens ?? 0,
                total_tokens: u.totalTokens ?? ((u.inputTokens ?? 0) + (u.outputTokens ?? 0)),
              };
            }
            if (t === "finish") break;
          } else if (t === "error") {
            const msg =
              "error" in ev && ev.error ? ev.error.message : "message" in ev ? ev.message : "Upstream error";
            const delta: SSEDelta = { content: `\n\n[upstream error: ${msg}]` };
            writeSSE(buildSSEChunk(chatId, created, model, delta, "stop"));
          }
          // ignore: start, start-step, reasoning-start/end, text-start/end, tool-input-end
        }
      } catch (e) {
        const delta: SSEDelta = { content: `\n\n[proxy error: ${(e as Error).message}]` };
        writeSSE(buildSSEChunk(chatId, created, model, delta, "stop"));
        sseWritable.write(`data: [DONE]\n\n`);
        await writer.close();
        return;
      }

      const tDone = Date.now();
      const outTokens = usage?.completion_tokens ?? 0;
      const genMs = Math.max(tDone - (tFirst || tHeaders), 1);
      const tps = ((outTokens / (genMs / 1000))).toFixed(1);
      console.log(
        `[${model}] headers=${tHeaders - t0}ms first-token=${tFirst ? tFirst - t0 : -1}ms total=${tDone - t0}ms finish=${finishReason} out=${outTokens}tok ${tps}tok/s`,
      );

      writeSSE(buildSSEChunk(chatId, created, model, {}, finishReason));
      sseWritable.write(`data: [DONE]\n\n`);
      await writer.close();
    })();

    return new Response(readable, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-session-id": sessionId,
      },
    });
  } else {
    // Non-streaming: process everything, return single JSON
    try {
      for await (const line of readNdjsonLines(upstream.body)) {
        let ev: NdJsonEvent;
        try {
          ev = JSON.parse(line) as NdJsonEvent;
        } catch {
          continue;
        }
        const t = ev.type;

        if (t === "text-delta" && "text" in ev && typeof ev.text === "string") {
          fullText += ev.text;
          if (!tFirst) tFirst = Date.now();
        } else if (t === "reasoning-delta" && "text" in ev && typeof ev.text === "string") {
          fullReasoning += ev.text;
          if (!tFirst) tFirst = Date.now();
        } else if (t === "tool-input-delta") {
          const id = "id" in ev ? ev.id : "toolCallId" in ev ? ev.toolCallId : undefined;
          const delta = "delta" in ev ? ev.delta : "text" in ev ? ev.text : "";
          if (id && delta) {
            ensureTool(id, "toolName" in ev ? ev.toolName : undefined);
            toolArgs[id] += delta;
            streamedDeltaIds.add(id);
          }
        } else if (t === "tool-call") {
          const id = "toolCallId" in ev ? ev.toolCallId : "id" in ev ? ev.id : undefined;
          if (id) {
            ensureTool(id, "toolName" in ev ? ev.toolName : undefined);
            if (!streamedDeltaIds.has(id) && "input" in ev && ev.input !== undefined) {
              toolArgs[id] = typeof ev.input === "string" ? ev.input : JSON.stringify(ev.input);
            } else if ("toolName" in ev && ev.toolName && !toolNames[id]) {
              toolNames[id] = ev.toolName;
            }
          }
        } else if (t === "finish-step" || t === "finish") {
          if ("finishReason" in ev && ev.finishReason) finishReason = mapFinish(ev.finishReason);
          else if ("finish_reason" in ev && ev.finish_reason) finishReason = mapFinish(ev.finish_reason);
          if ("usage" in ev && ev.usage) {
            usage = parseAlphaUsage(ev.usage);
          } else if ("totalUsage" in ev && "totalUsage" in ev && ev.totalUsage) {
            const u = ev.totalUsage;
            usage = {
              prompt_tokens: u.inputTokens ?? 0,
              completion_tokens: u.outputTokens ?? 0,
              total_tokens: u.totalTokens ?? ((u.inputTokens ?? 0) + (u.outputTokens ?? 0)),
            };
          }
          if (t === "finish") break;
        } else if (t === "error") {
          const msg = "error" in ev && ev.error ? ev.error.message : "message" in ev ? ev.message : "Upstream error";
          throw new Error(msg);
        }
      }
    } catch (e) {
      return Response.json(
        { error: { message: (e as Error).message, type: "upstream_error" } },
        { status: 502 },
      );
    }

    const tDone = Date.now();
    const outTokens = usage?.completion_tokens ?? 0;
    const genMs = Math.max(tDone - (tFirst || tHeaders), 1);
    const tps = ((outTokens / (genMs / 1000))).toFixed(1);
    console.log(
      `[${model}] headers=${tHeaders - t0}ms first-token=${tFirst ? tFirst - t0 : -1}ms total=${tDone - t0}ms finish=${finishReason} out=${outTokens}tok ${tps}tok/s`,
    );

    const tool_calls = toolOrder.map((id) => ({
      id,
      type: "function" as const,
      function: { name: toolNames[id] || "tool", arguments: toolArgs[id] || "{}" },
    }));
    const message: {
      role: "assistant";
      content: string;
      tool_calls?: typeof tool_calls;
      reasoning_content?: string;
    } = { role: "assistant", content: fullText };
    if (tool_calls.length) message.tool_calls = tool_calls;
    if (fullReasoning) message.reasoning_content = fullReasoning;

    const finalUsage: OpenAIUsage = usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    return Response.json({
      id: chatId,
      object: "chat.completion",
      created,
      model,
      choices: [{ index: 0, message, finish_reason: finishReason }],
      usage: finalUsage,
    });
  }
}

// --- Server ---

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  idleTimeout: 300, // 5 min for long-lived SSE streams
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/v1/health")) {
        return Response.json({ ok: true, upstream: UPSTREAM });
      }
      if (req.method === "GET" && (url.pathname === "/v1/models" || url.pathname === "/models")) {
        return Response.json({
          object: "list",
          data: STATIC_MODELS.map((id) => ({ id, object: "model", created: 0, owned_by: "commandcode" })),
        });
      }
      if (
        req.method === "POST" &&
        (url.pathname === "/v1/chat/completions" || url.pathname === "/chat/completions")
      ) {
        return await handleChatCompletions(req);
      }
      return Response.json(
        { error: { message: `Not found: ${req.method} ${url.pathname}. Use POST /v1/chat/completions`, type: "not_found" } },
        { status: 404 },
      );
    } catch (e) {
      return Response.json(
        { error: { message: (e as Error).message, type: "bad_request" } },
        { status: 400 },
      );
    }
  },
});

console.log(`commandcode-proxy on http://127.0.0.1:${PORT} -> ${UPSTREAM}/alpha/generate`);
const found = process.env.COMMANDCODE_API_KEY ? "env" : (await keyFromAuthFile())?.source || "none";
console.log(`key source: ${found}`);
if (found === "none") console.log("WARN: no key in env or auth.json; requests will 401 until /connect runs.");
