#!/usr/bin/env bash
# install.sh — Install commandcode-proxy for Mac/Linux
# Usage: curl -fsSL https://github.com/snarkar-aiq/commandcode-proxy/raw/main/install.sh | bash
set -euo pipefail

REPO_URL="https://github.com/snarkar-aiq/commandcode-proxy.git"
INSTALL_DIR="$HOME/.config/opencode/commandcode-proxy"

echo "[install] Checking for bun..."
if ! command -v bun &>/dev/null; then
  echo "bun not found. Install from https://bun.com"
  echo "  curl -fsSL https://bun.com/install | bash"
  exit 1
fi

echo "[install] Cloning commandcode-proxy..."
if [ -d "$INSTALL_DIR" ]; then
  echo "[install] $INSTALL_DIR exists. Pulling latest..."
  cd "$INSTALL_DIR"
  git pull --ff-only
else
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

echo "[install] Installing dependencies..."
bun install --no-save

echo "[install] Running setup..."
bun run src/setup.ts

echo
echo "✅ Done. Restart OpenCode or press F5 to reload config."
echo "   Proxy started now on http://127.0.0.1:18731 (service, or background daemon if the service failed)."
