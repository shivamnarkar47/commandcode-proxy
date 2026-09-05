# Background run

Three ways to run the proxy in the background, from lightest to heaviest. All of them bind the same port (default `18731`, override with `--port` or `PORT` env).

## Option A — native flags (cross-platform, recommended)

No extra files. The proxy daemonizes itself via `Bun.spawn(detached: true)`:

```sh
bun run src/proxy.ts --daemon   # start detached, log to ./commandcode-proxy.log
bun run src/proxy.ts --status   # running (PID xxxx) / not running
bun run src/proxy.ts --stop     # SIGTERM + remove PID file
```

Package-script shortcuts:

```sh
bun run daemon
bun run status
bun run stop
bun run restart   # stop && daemon
```

## Option B — wrapper scripts

Explicit `nohup` / `Start-Process` wrappers with `start|stop|status|restart` subcommands:

```sh
# Linux / macOS (nohup + PID file)
scripts/start.sh start
scripts/start.sh status
scripts/start.sh restart
scripts/start.sh stop
```

```powershell
# Windows (hidden window + PID file)
scripts\start.ps1 start
scripts\start.ps1 status
scripts\start.ps1 restart
scripts\start.ps1 stop
```

Use these if you prefer `nohup`-style semantics or need to manage the proxy from other tooling.

## Option C — system service (start on boot)

```sh
bun run src/setup.ts                 # systemd / launchd / Scheduled Task
bun run src/setup.ts --uninstall
```

Only needed for persistence across reboots. See `src/setup.ts`.

## Runtime files

Created next to `proxy.ts` (project root):

| File | Content |
|------|---------|
| `.commandcode-proxy.pid` | PID of the background process (gitignored) |
| `commandcode-proxy.log` | stdout + stderr of the daemon (gitignored via `*.log`) |
| `commandcode-proxy.err.log` | Windows stderr redirect only |

## Safety behavior

- **Double start is refused.** `--daemon` and `start.sh start` check the PID file and verify liveness (`kill(pid, 0)`) before spawning. If already running they print `already running (PID xxxx)` and exit without touching the running instance.
- **Stale PID files self-heal.** If the PID file points to a dead process, `--status` / `--stop` report `stale PID file (PID xxxx not responding)`, delete it, and (for `--daemon`) proceed with a fresh start.
- **Port conflicts surface in the log.** If the port is taken, the daemon child exits with `EADDRINUSE` — check `commandcode-proxy.log`.

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `already running` but `/health` refuses | Stale process bound the port outside PID tracking. `ps aux \| grep proxy.ts`, kill it, remove `.commandcode-proxy.pid`. |
| `stale PID file` loop | Something deletes the process but not the file (e.g. OOM-killer). Just start again — the stale file is cleaned automatically. |
| No log output | Check `commandcode-proxy.log` path — it's the project root, not `src/`. |
| Windows: console window flashes | Use `start.ps1` (hidden window) or `--daemon` instead of plain `bun run`. |
