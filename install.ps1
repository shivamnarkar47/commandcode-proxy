# install.ps1 — Install commandcode-proxy for Windows
# Usage: irm https://github.com/snarkar-aiq/commandcode-proxy/raw/main/install.ps1 | iex
$ErrorActionPreference = "Stop"

$RepoUrl = "https://github.com/snarkar-aiq/commandcode-proxy.git"
$InstallDir = "$env:USERPROFILE\.config\opencode\commandcode-proxy"

Write-Host "[install] Checking for bun..." -ForegroundColor Cyan
$bun = Get-Command bun -ErrorAction SilentlyContinue
if (-not $bun) {
  Write-Host "bun not found. Install from https://bun.com" -ForegroundColor Red
  Write-Host "  powershell -c "irm https://bun.com/install.ps1 | iex"" -ForegroundColor Yellow
  exit 1
}

Write-Host "[install] Cloning commandcode-proxy..." -ForegroundColor Cyan
if (Test-Path $InstallDir) {
  Write-Host "[install] $InstallDir exists. Pulling latest..." -ForegroundColor Yellow
  Set-Location $InstallDir
  git pull --ff-only
} else {
  git clone $RepoUrl $InstallDir
  Set-Location $InstallDir
}

Write-Host "[install] Installing dependencies..." -ForegroundColor Cyan
bun install --no-save

Write-Host "[install] Running setup..." -ForegroundColor Cyan
bun run src/setup.ts

Write-Host ""
Write-Host "Done. Restart OpenCode or press F5 to reload config." -ForegroundColor Green
Write-Host "Proxy started now on http://127.0.0.1:18731 (service, or background daemon if the service failed)."
