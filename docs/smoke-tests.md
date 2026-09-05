# Smoke tests

Manual end-to-end verification of the background runner (native flags + wrapper scripts). Last full run: 2026-09-05, Linux, Bun 1.4.0.

## How to rerun

```sh
# native flags
bun run status          # expect: not running
bun run daemon && sleep 1 && bun run status
curl -s http://127.0.0.1:18731/health
curl -s http://127.0.0.1:18731/v1/models | head -c 200; echo
bun run daemon          # expect: already running (PID xxxx)
bun run stop && bun run status

# wrapper scripts
./scripts/start.sh start && sleep 1 && ./scripts/start.sh status
./scripts/start.sh start            # expect: already running
./scripts/start.sh restart && sleep 1 && ./scripts/start.sh status
curl -s http://127.0.0.1:18731/health
./scripts/start.sh stop && ./scripts/start.sh status

# stale PID handling
echo "999999" > .commandcode-proxy.pid
bun run stop            # expect: stale PID file ... + cleanup
ls .commandcode-proxy.pid  # expect: no such file

# cleanup
rm -f commandcode-proxy.log commandcode-proxy.err.log .commandcode-proxy.pid
```

## Results (2026-09-05)

| # | Test | Result |
|---|------|--------|
| 1 | `status` when not running | `not running`, exit 0 |
| 2 | `stop` when not running | `not running (no PID file)`, exit 0 |
| 3 | `daemon` start | `daemon started (PID …)`, log created |
| 4 | `status` when running | `running (PID …)` matches PID file |
| 5 | `GET /health` | `{"ok":true,"upstream":"https://api.commandcode.ai"}` |
| 6 | `GET /v1/models` | 5-model list, correct shape |
| 7 | double `daemon` | refused: `already running`, original untouched, 1 process |
| 8 | `stop` on live process | `stopped`, port closed, PID file removed |
| 9 | `stop` on stale PID | `stale PID file …`, file cleaned, no stack trace |
| 10 | `start.sh` full cycle | start → status → double-start guard → restart → stop, all OK; `/health` OK after restart |
| 11 | `bun run restart` chain | `stop && daemon` works end to end |
| 12 | post-run cleanup | no processes, no PID/log artifacts, port closed |

## Bug found during testing

Double `--daemon` used to overwrite the PID file, crash the child with `EADDRINUSE`, and orphan the original process (PID file then pointed at a dead PID). Fixed with an alive-check guard in `--daemon` (`src/proxy.ts`) plus graceful stale-PID handling in `--stop`. Re-tested green (cases 7, 9).
