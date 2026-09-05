# Uninstall

Full removal (stop everything, remove boot service, strip provider config, delete the folder):

```sh
bun run uninstall
# or: bun run scripts/uninstall.ts --yes   # skip confirmation
```

What it does, in order:

1. Stops the PID-tracked background process (`SIGTERM`, stale PID tolerated).
2. Removes the system service — systemd user unit (Linux), launchd agent (macOS), scheduled task (Windows).
3. Removes the `commandcode` provider from `~/.config/opencode/opencode.json` and `opencode.jsonc` (whichever exist). For `.jsonc` with comments it falls back to a comment-aware textual block removal. If `providers` ends up empty, the key is dropped too.
4. Deletes the install folder (defaults to the repo root the script lives in).

Left untouched on purpose: `auth.json` keys (re-run `/connect` to reuse them).

## Flags

| Flag | Effect |
|------|--------|
| `--yes` | Skip the confirmation prompt (required when stdin is not a TTY) |
| `--dry-run` | Print what would happen, change nothing |
| `--keep-config` | Leave `opencode.json(c)` alone |
| `--dir <path>` | Uninstall a different folder instead of the script's own root |

## Notes

- Service-only removal (keeps folder + config): `bun run src/setup.ts --uninstall`.
- On Windows the running script file itself may be locked — the script removes everything else and tells you to delete the remainder manually.
- Preview first with `--dry-run`; it also shows which config files would be edited.
