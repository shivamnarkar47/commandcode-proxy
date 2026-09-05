#!/usr/bin/env bun
// setup.ts — Automated setup for commandcode-proxy
// Usage: bun run setup.ts [--uninstall]
// Zero deps. Creates systemd service (Linux), launchd (macOS), or scheduled task (Windows).

import os from "node:os";
import path from "node:path";
import { existsSync, mkdirSync, rmSync } from "node:fs";

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const IS_LINUX = process.platform === "linux";

const PORT = process.env.PORT || "18731";
const PROXY_URL = `http://127.0.0.1:${PORT}`;

// --- platform paths ---
function dataDir(): string {
  if (IS_WIN) return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  if (IS_MAC) return path.join(os.homedir(), "Library", "Application Support");
  return process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
}
function configDir(): string {
  if (IS_WIN) return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(os.homedir(), ".config");
}
function opencodeDataDir(): string {
  return path.join(dataDir(), "opencode");
}
function opencodeConfigFile(): string {
  const dir = path.join(configDir(), "opencode");
  if (existsSync(path.join(dir, "opencode.jsonc"))) return path.join(dir, "opencode.jsonc");
  return path.join(dir, "opencode.json");
}
const PROXY_DIR = path.join(configDir(), "opencode", "commandcode-proxy");
const PROXY_FILE = path.join(PROXY_DIR, "proxy.ts");
const RUNTIME = process.env.BUN_PATH || process.execPath;

// --- helpers ---
const log = (...a: unknown[]) => console.log("[setup]", ...a);
const warn = (...a: unknown[]) => console.warn("[setup]", ...a);
const err = (...a: unknown[]) => console.error("[setup]", ...a);

async function readJsonSafe(p: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await Bun.file(p).text();
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function run(cmd: string): Promise<void> {
  try {
    const parts = cmd.split(" ");
    const proc = Bun.spawn({
      cmd: parts,
      stdout: "inherit",
      stderr: "inherit",
    });
    await proc.exited;
  } catch (e) {
    warn(`command failed: ${cmd}\n  ${(e as Error).message}`);
  }
}

async function isPortOpen(port: string): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// --- provider config ---
interface ProviderConfig {
  name: string;
  package: string;
  settings: { baseURL: string; env?: string[] };
  models: Record<string, unknown>;
}

function buildProviderConfig(hasKey: boolean): ProviderConfig {
  const cfg: ProviderConfig = {
    name: "CommandCode Go (via local proxy)",
    package: "@opencode-ai/ai/providers/openai-compatible",
    settings: { baseURL: `${PROXY_URL}/v1` },
    models: {
      "deepseek/deepseek-v4-flash": {
        modelID: "deepseek/deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        variants: [
          { id: "low", settings: { reasoningEffort: "low" } },
          { id: "medium", settings: { reasoningEffort: "medium" } },
          { id: "high", settings: { reasoningEffort: "high" } },
          { id: "max", settings: { reasoningEffort: "high", thinking: { type: "enabled", budget_tokens: 16000 } } },
        ],
      },
      "meituan/LongCat-2.0:free": {
        modelID: "meituan/LongCat-2.0:free",
        name: "LongCat-2.0:Free",
        variants: [
          { id: "think", settings: { thinking: { type: "enabled", budget_tokens: 8000 } } },
        ],
      },
      "zai-org/glm-5.3-flash": {
        modelID: "zai-org/glm-5.3-flash",
        name: "GLM-5.3-Flash",
        variants: [
          { id: "think", settings: { thinking: { type: "enabled", budget_tokens: 8000 } } },
        ],
      },
      "meta/muse-spark-1.3-contributor": {
        modelID: "meta/muse-spark-1.3-contributor",
        name: "Muse Spark 1.3 Contributor",
        variants: [
          { id: "low", settings: { thinking: { type: "enabled", budget_tokens: 4000 } } },
          { id: "high", settings: { thinking: { type: "enabled", budget_tokens: 8000 } } },
          { id: "xhigh", settings: { thinking: { type: "enabled", budget_tokens: 16000 } } },
        ],
      },
      "meta/muse-spark-1.2-contributor": {
        modelID: "meta/muse-spark-1.2-contributor",
        name: "Muse Spark 1.2 Contributor",
        variants: [
          { id: "think", settings: { thinking: { type: "enabled", budget_tokens: 8000 } } },
        ],
      },
    },
  };
  if (!hasKey) {
    cfg.settings.env = ["COMMANDCODE_API_KEY"];
  }
  return cfg;
}

// --- service install ---
async function installSystemd(): Promise<void> {
  const serviceFile = path.join(os.homedir(), ".config", "systemd", "user", "commandcode-proxy.service");
  const unit = `[Unit]
Description=CommandCode Go local proxy for OpenCode
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${RUNTIME} run ${PROXY_FILE} --port ${PORT}
WorkingDirectory=${PROXY_DIR}
Restart=on-failure
RestartSec=3
Environment="PATH=/usr/local/bin:/usr/bin:/bin"

[Install]
WantedBy=default.target
`;
  await Bun.write(serviceFile, unit);
  await run("systemctl --user daemon-reload");
  await run("systemctl --user enable --now commandcode-proxy");
  log("systemd user service installed and started");
}

async function installLaunchd(): Promise<void> {
  const plistFile = path.join(os.homedir(), "Library", "LaunchAgents", "ai.commandcode.proxy.plist");
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.commandcode.proxy</string>
  <key>ProgramArguments</key>
  <array>
    <string>${RUNTIME}</string>
    <string>run</string>
    <string>${PROXY_FILE}</string>
    <string>--port</string>
    <string>${PORT}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${PROXY_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/commandcode-proxy.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/commandcode-proxy.err.log</string>
</dict>
</plist>
`;
  await Bun.write(plistFile, plist);
  await run(`launchctl unload ${plistFile} 2>/dev/null; launchctl load ${plistFile}`);
  log("launchd agent installed and started");
}

async function installWindowsTask(): Promise<void> {
  const taskName = "CommandCodeProxy";
  const args = `run "${PROXY_FILE}" --port ${PORT}`;

  try {
    await run(`schtasks /Delete /TN ${taskName} /F 2>nul`);
  } catch {
    /* ignore */
  }

  const xmlPath = path.join(os.tmpdir(), "commandcode-proxy-task.xml");
  const xml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartInterval>PT1M</RestartInterval>
    <RestartCount>3</RestartCount>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${RUNTIME}</Command>
      <Arguments>${args}</Arguments>
      <WorkingDirectory>${PROXY_DIR}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>`;
  await Bun.write(xmlPath, xml);
  await run(`schtasks /Create /TN ${taskName} /XML ${xmlPath} /F`);
  await run(`schtasks /Run /TN ${taskName}`);
  rmSync(xmlPath, { force: true });
  log("Windows scheduled task installed and started");
}

async function uninstallService(): Promise<void> {
  if (IS_LINUX) {
    await run("systemctl --user disable --now commandcode-proxy 2>/dev/null");
    rmSync(path.join(os.homedir(), ".config", "systemd", "user", "commandcode-proxy.service"), { force: true });
    await run("systemctl --user daemon-reload");
  } else if (IS_MAC) {
    const f = path.join(os.homedir(), "Library", "LaunchAgents", "ai.commandcode.proxy.plist");
    await run(`launchctl unload ${f} 2>/dev/null`);
    rmSync(f, { force: true });
  } else if (IS_WIN) {
    await run("schtasks /Delete /TN CommandCodeProxy /F 2>nul");
  }
  log("service uninstalled");
}

// --- opencode.json merge ---
async function ensureOpencodeConfig(hasKey: boolean): Promise<void> {
  const cfgPath = opencodeConfigFile();
  const cfg: Record<string, unknown> =
    (await readJsonSafe(cfgPath)) ?? { $schema: "https://opencode.ai/config.json" };

  const providers: Record<string, unknown> =
    (cfg.providers as Record<string, unknown> | undefined) ?? {};
  providers.commandcode = buildProviderConfig(hasKey);
  cfg.providers = providers;

  await Bun.write(cfgPath, JSON.stringify(cfg, null, 2));
  log(`opencode.json updated at ${cfgPath}`);
}

// --- auth check ---
async function checkAuth(): Promise<boolean> {
  const authPath = path.join(opencodeDataDir(), "auth.json");
  const auth = await readJsonSafe(authPath);
  const entry =
    (auth?.commandcode as string | { key?: string } | undefined) ??
    (auth?.["commandcode-go"] as string | { key?: string } | undefined) ??
    (auth?.["opencode-go"] as string | { key?: string } | undefined);
  if (entry) {
    const k = typeof entry === "string" ? entry : entry?.key;
    log(`found key in auth.json (${k?.slice(0, 8)}...)`);
    return true;
  }
  if (process.env.COMMANDCODE_API_KEY) {
    log(`found key in env (${process.env.COMMANDCODE_API_KEY.slice(0, 8)}...)`);
    return true;
  }
  warn("no CommandCode key found — requests will 401 until you set COMMANDCODE_API_KEY or run /connect");
  return false;
}

// --- main ---
async function main(): Promise<void> {
  const uninstall = process.argv.includes("--uninstall");

  log(`platform: ${process.platform}`);
  log(`bun: ${process.execPath}`);

  if (uninstall) {
    await uninstallService();
    return;
  }

  // 1. Ensure proxy dir exists and proxy sources are in place
  // (proxy.ts imports ./translate.js, so all src files must be copied)
  const selfDir = import.meta.dirname || path.dirname(new URL(import.meta.url).pathname);
  mkdirSync(PROXY_DIR, { recursive: true });
  let copied = 0;
  for (const f of ["proxy.ts", "translate.ts", "types.ts"]) {
    const src = path.join(selfDir, f);
    const dst = path.join(PROXY_DIR, f);
    if (existsSync(src) && src !== dst) {
      await Bun.write(dst, Bun.file(src));
      copied++;
    }
  }
  if (copied > 0) log(`copied ${copied} src file(s) to ${PROXY_DIR}`);
  else if (!existsSync(PROXY_FILE)) warn("proxy sources not found — place them next to setup.ts first");

  // 2. Check auth
  const hasKey = await checkAuth();

  // 3. Update opencode.json
  await ensureOpencodeConfig(hasKey);

  // 4. Install service
  if (IS_LINUX) await installSystemd();
  else if (IS_MAC) await installLaunchd();
  else if (IS_WIN) await installWindowsTask();
  else warn("unknown platform — service not installed, start manually: bun run proxy.ts --port 18731");

  // 5. Verify — fall back to a background daemon so the proxy is live immediately
  await new Promise((r) => setTimeout(r, 1500));
  if (await isPortOpen(PORT)) {
    log(`proxy is live at ${PROXY_URL}`);
  } else {
    warn("service didn't come up — starting background daemon instead");
    try {
      const proc = Bun.spawn({
        cmd: [RUNTIME, "run", PROXY_FILE, "--port", PORT, "--daemon"],
        cwd: PROXY_DIR,
        stdout: "inherit",
        stderr: "inherit",
      });
      await proc.exited;
    } catch (e) {
      warn(`daemon fallback failed: ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
    if (await isPortOpen(PORT)) {
      log(`proxy is live at ${PROXY_URL} (background daemon)`);
    } else {
      warn("proxy didn't come up — check logs");
      return;
    }
  }
  log("done. restart OpenCode or press F5 to reload config.");
}

main().catch((e: Error) => {
  err(e.message);
  process.exit(1);
});
