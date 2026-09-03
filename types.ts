// Wire protocol types for commandcode-proxy

// --- OpenAI Chat Completions ---

export type OpenAIRole = "system" | "developer" | "user" | "assistant" | "tool" | "function";

export interface OpenAITextContent {
  type: "text";
  text: string;
}

export interface OpenAIImageContent {
  type: "image_url";
  image_url: { url: string };
}

export interface OpenAIInputTextContent {
  type: "input_text";
  text: string;
}

export type OpenAIUserContent = string | (OpenAITextContent | OpenAIImageContent | OpenAIInputTextContent)[];

export interface OpenAIToolCall {
  id: string;
  type?: "function";
  function: {
    name: string;
    arguments: string | Record<string, unknown>;
  };
  name?: string;
  input?: unknown;
}

export interface OpenAISystemMessage {
  role: "system" | "developer";
  content: string;
}

export interface OpenAIUserMessage {
  role: "user";
  content: OpenAIUserContent;
}

export interface OpenAIAssistantMessage {
  role: "assistant";
  content: string | (OpenAITextContent | { type: "reasoning"; text: string })[];
  tool_calls?: OpenAIToolCall[];
}

export interface OpenAIToolMessage {
  role: "tool" | "function";
  tool_call_id?: string;
  id?: string;
  toolCallId?: string;
  name?: string;
  content: string;
}

export type OpenAIMessage = OpenAISystemMessage | OpenAIUserMessage | OpenAIAssistantMessage | OpenAIToolMessage;

export interface OpenAITool {
  type?: "function";
  name?: string;
  description?: string;
  parameters?: Record<string, unknown>;
  input_schema?: Record<string, unknown>;
  function?: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface OpenAIThinking {
  type: "enabled" | "disabled";
  budget_tokens?: number;
}

export interface OpenAIChatRequest {
  model?: string;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  stream?: boolean;
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  thinking?: OpenAIThinking;
  reasoning_effort?: "low" | "medium" | "high";
}

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_cache_hit_tokens?: number;
}

export interface OpenAIChatChoice {
  index: number;
  message: {
    role: "assistant";
    content: string | null;
    tool_calls?: OpenAIToolCall[];
    reasoning_content?: string;
  };
  finish_reason: "stop" | "length" | "tool_calls";
}

export interface OpenAIChatResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: OpenAIChatChoice[];
  usage: OpenAIUsage;
}

// --- SSE ---

export interface SSEDelta {
  role?: "assistant";
  content?: string;
  reasoning_content?: string;
  tool_calls?: {
    index: number;
    id?: string;
    type?: "function";
    function?: {
      name?: string;
      arguments?: string;
    };
  }[];
}

export interface SSEChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: {
    index: number;
    delta: SSEDelta;
    finish_reason: "stop" | "length" | "tool_calls" | null;
  }[];
}

// --- CommandCode Alpha Generate ---

export interface AlphaConfig {
  workingDir: string;
  date: string;
  environment: string;
  structure: unknown[];
  isGitRepo: boolean;
  currentBranch: string;
  mainBranch: string;
  gitStatus: string;
  recentCommits: unknown[];
}

export interface AlphaParams {
  model: string;
  system: string;
  messages: AlphaMessage[];
  tools: AlphaTool[];
  max_tokens: number;
  temperature?: number;
  thinking?: OpenAIThinking;
  reasoningEffort?: string;
  stream: true;
}

export interface AlphaGenerateRequest {
  config: AlphaConfig;
  memory: string;
  taste: unknown;
  skills: unknown;
  permissionMode: string;
  params: AlphaParams;
}

export type AlphaContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: string; mediaType: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: Record<string, unknown> }
  | { type: "tool-result"; toolCallId: string; toolName: string; output: { type: "text"; value: string } };

export interface AlphaMessage {
  role: "user" | "assistant" | "tool";
  content: AlphaContentPart[];
}

export interface AlphaTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// --- NDJSON Events (upstream -> proxy) ---

export interface AlphaUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
}

export interface TextDelta {
  type: "text-delta";
  text: string;
}

export interface ReasoningDelta {
  type: "reasoning-delta";
  text: string;
}

export interface ToolInputStart {
  type: "tool-input-start";
  id?: string;
  toolCallId?: string;
  toolName?: string;
}

export interface ToolInputDelta {
  type: "tool-input-delta";
  id?: string;
  toolCallId?: string;
  toolName?: string;
  delta?: string;
  text?: string;
}

export interface ToolInputEnd {
  type: "tool-input-end";
  id?: string;
  toolCallId?: string;
}

export interface ToolCallEvent {
  type: "tool-call";
  toolCallId?: string;
  id?: string;
  toolName?: string;
  input?: unknown;
}

export interface FinishStep {
  type: "finish-step";
  finishReason?: string;
  finish_reason?: string;
  usage?: AlphaUsage;
  totalUsage?: AlphaUsage;
}

export interface FinishEvent {
  type: "finish";
  finishReason?: string;
  finish_reason?: string;
  usage?: AlphaUsage;
  totalUsage?: AlphaUsage;
}

export interface ErrorEvent {
  type: "error";
  error?: { message: string };
  message?: string;
}

// Ignored events (documented for completeness)
export interface StartEvent { type: "start"; }
export interface StartStepEvent { type: "start-step"; }
export interface TextStartEvent { type: "text-start"; }
export interface TextEndEvent { type: "text-end"; }
export interface ReasoningStartEvent { type: "reasoning-start"; }
export interface ReasoningEndEvent { type: "reasoning-end"; }

export type NdJsonEvent =
  | TextDelta
  | ReasoningDelta
  | ToolInputStart
  | ToolInputDelta
  | ToolInputEnd
  | ToolCallEvent
  | FinishStep
  | FinishEvent
  | ErrorEvent
  | StartEvent
  | StartStepEvent
  | TextStartEvent
  | TextEndEvent
  | ReasoningStartEvent
  | ReasoningEndEvent;
