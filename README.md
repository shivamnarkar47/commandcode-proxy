# 🔌 commandcode-proxy

> **OpenAI Chat Completions → CommandCode `/alpha/generate` shim**
>
> Zero-dependency Bun + TypeScript proxy that lets [OpenCode](https://opencode.ai) talk to [CommandCode Go](https://commandcode.ai) via a local OpenAI-compatible endpoint.

## What it does

OpenCode speaks OpenAI Chat Completions. CommandCode Go speaks `POST /alpha/generate` (NDJSON). This proxy sits in between and translates both directions:

- **Out:** system/user/assistant/tool messages → `ModelMessage[]`, tools → `{name, description, input_schema}`
- **In:** NDJSON `text-delta` → `content`, `reasoning-delta` → `reasoning_content`, `tool-input-delta` → `tool_calls` chunks, `finish` → `finish_reason`

Always streams upstream; buffers when downstream asks `stream:false`.

## Run

```sh
# No env needed if you already ran /connect (key in ~/.local/share/opencode/auth.json).
# Key resolution order: COMMANDCODE_API_KEY env → Bearer header → auth.json.
bun run proxy.ts --port 18731
```

### Dev mode

```sh
bun --watch run proxy.ts --port 18731
```

### Install as a service

```sh
bun run setup.ts
```

This creates a systemd user service (Linux), launchd agent (macOS), or scheduled task (Windows) that starts the proxy on boot.

To uninstall:

```sh
bun run setup.ts --uninstall
```

### Windows

Works on Windows too. Auth.json lookup order:

- `%APPDATA%\opencode\auth.json`
- `%LOCALAPPDATA%\opencode\auth.json`

Run with `bun` from PowerShell/CMD.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health`, `/v1/health` | Health check |
| `GET` | `/v1/models`, `/models` | Static model list |
| `POST` | `/v1/chat/completions`, `/chat/completions` | Main translation endpoint |

## opencode.json

Set `providers.commandcode.settings.baseURL` to `http://127.0.0.1:18731/v1`. Models carry explicit `modelID` (canonical id sent upstream as `params.model`).

Two template files are included for reference:

| File | Use when |
|------|----------|
| `opencode.json` | You want a plain JSON config (no comments) |
| `opencode.jsonc` | You want a JSONC config with inline documentation |

Copy the `providers.commandcode` block from either file into your `~/.config/opencode/opencode.json` (or `opencode.jsonc`), then restart OpenCode or press F5 to reload.

## Thinking / reasoning params

The proxy passes `thinking` and `reasoning_effort` through to upstream (`params.thinking`, `params.reasoningEffort`). Different models support different thinking variants — pass them in your OpenAI request body:

```json
{
  "model": "deepseek/deepseek-v4-flash",
  "messages": [...],
  "thinking": { "type": "enabled", "budget_tokens": 8000 }
}
```

Or with OpenAI-style effort:

```json
{
  "model": "deepseek/deepseek-v4-flash",
  "messages": [...],
  "reasoning_effort": "high"
}
```

Upstream emits `reasoning-delta` NDJSON events; the proxy accumulates them into `reasoning_content` on the assistant message (both streamed and non-streamed responses).

## Variants in opencode.json

To select thinking variants from OpenCode's UI (`/models` → pick variant), define them under each model's `variants` array. Variant `settings` are merged into the request body and forwarded by the proxy:

```jsonc
{
  "providers": {
    "commandcode": {
      "models": {
        "deepseek/deepseek-v4-flash": {
          "variants": [
            { "id": "low", "settings": { "reasoningEffort": "low" } },
            { "id": "medium", "settings": { "reasoningEffort": "medium" } },
            { "id": "high", "settings": { "reasoningEffort": "high" } },
            { "id": "max", "settings": { "reasoningEffort": "high", "thinking": { "type": "enabled", "budget_tokens": 16000 } } }
          ]
        },
        "meituan/LongCat-2.0:free": {
          "variants": [
            { "id": "think", "settings": { "thinking": { "type": "enabled", "budget_tokens": 8000 } } }
          ]
        }
      }
    }
  }
}
```

Select at runtime with `provider/model#variant`, e.g. `commandcode/deepseek/deepseek-v4-flash#max`.

## Project structure

```
commandcode-proxy/
├── package.json          # bun scripts, bun-types devDep
├── tsconfig.json         # strict, bundler resolution, bun-types
├── types.ts              # wire protocol types (OpenAI + Alpha + NDJSON)
├── translate.ts          # pure translation functions (no server)
├── proxy.ts              # Bun.serve server, routing, key resolution, streaming
├── setup.ts              # install/uninstall system service
├── service.json          # systemd descriptor
└── README.md
```

## License

MIT
