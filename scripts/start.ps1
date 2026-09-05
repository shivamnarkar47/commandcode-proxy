# start.ps1 — Background service wrapper for commandcode-proxy (Windows)
# Usage: scripts\start.ps1 {start|stop|status|restart}
param([string]$Action = "start")

$RootDir = Split-Path -Parent $PSScriptRoot
$PidFile = Join-Path $RootDir ".commandcode-proxy.pid"
$LogFile = Join-Path $RootDir "commandcode-proxy.log"
$ErrFile = Join-Path $RootDir "commandcode-proxy.err.log"
$Port = if ($env:PORT) { $env:PORT } else { "18731" }

function Is-Running {
  if (-not (Test-Path $PidFile)) { return $false }
  $pid = Get-Content $PidFile
  Get-Process -Id $pid -ErrorAction SilentlyContinue | Out-Null
}

function Start-Proxy {
  if (Is-Running) {
    Write-Host "already running (PID $(Get-Content $PidFile))"
    return
  }
  $proc = Start-Process -FilePath "bun" -ArgumentList "run","src/proxy.ts","--port",$Port `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $LogFile -RedirectStandardError $ErrFile
  $proc.Id | Set-Content $PidFile
  Write-Host "started (PID $($proc.Id)), log: $LogFile"
}

function Stop-Proxy {
  if (Is-Running) {
    Stop-Process -Id (Get-Content $PidFile) -Force
    Remove-Item $PidFile -Force
    Write-Host "stopped"
  } else {
    Write-Host "not running"
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
  }
}

function Get-Status {
  if (Is-Running) {
    Write-Host "running (PID $(Get-Content $PidFile))"
  } else {
    Write-Host "not running"
  }
}

function Restart-Proxy {
  Stop-Proxy
  Start-Sleep -Seconds 1
  Start-Proxy
}

switch ($Action) {
  "start"   { Start-Proxy }
  "stop"    { Stop-Proxy }
  "status"  { Get-Status }
  "restart" { Restart-Proxy }
  default   { Write-Host "Usage: start.ps1 {start|stop|status|restart}"; exit 1 }
}
