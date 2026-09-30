<#
═══════════════════════════════════════════════════════════════
 Aurora — start all services (Windows PowerShell 5.1+ / PowerShell 7)
   1. simulator\unified_backend.py  (single public backend, API_PORT, default 8080)
   2. simulator\simulator.py        (internal control API, SIM_PORT, default 8001)
   3. Vite dev server               (VITE_PORT, default 5173)

 Ports/host come from simulator\config.py (root .env). Python comes from the
 repo venv (.venv\) unless $env:AURORA_PYTHON is set. Ctrl+C stops everything.
 Usage:  powershell -ExecutionPolicy Bypass -File .\start.ps1
═══════════════════════════════════════════════════════════════
#>
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Py = if ($env:AURORA_PYTHON) { $env:AURORA_PYTHON } else { Join-Path $Root '.venv\Scripts\python.exe' }
$VitePort = if ($env:VITE_PORT) { [int]$env:VITE_PORT } else { 5173 }
$HealthTimeoutS = if ($env:HEALTH_TIMEOUT_S) { [int]$env:HEALTH_TIMEOUT_S } else { 60 }

function Info($msg) { Write-Host "[start] $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "[start] ERROR: $msg" -ForegroundColor Red; exit 1 }

# ── Preflight ─────────────────────────────────────────────────
if (-not (Test-Path $Py)) {
  Fail @"
Python venv not found at $Py
  Create it from the repo root:
    py -3 -m venv .venv
    .venv\Scripts\pip install -r simulator\requirements.txt
  (optional Chronos extras: .venv\Scripts\pip install -r simulator\requirements-ml.txt)
  Or set `$env:AURORA_PYTHON to an existing interpreter.
"@
}
& $Py -c "import fastapi, flask, dotenv, sklearn" 2>$null
if ($LASTEXITCODE -ne 0) { Fail "Python deps missing in $Py — run: $Py -m pip install -r simulator\requirements.txt" }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { Fail "npm not found (install Node.js 18+)" }
if (-not (Test-Path (Join-Path $Root 'node_modules'))) { Fail "node_modules missing — run: npm install" }

# Single source of truth for ports/host: config.py (loads the root .env)
Push-Location (Join-Path $Root 'simulator')
try {
  $cfg = & $Py -c "import config as c; print(c.API_PORT, c.SIM_PORT, c.HOST)" 2>$null
} finally { Pop-Location }
if ($LASTEXITCODE -ne 0 -or -not $cfg) { Fail "could not read ports from simulator\config.py" }
$ApiPort, $SimPort, $BindHost = ($cfg | Select-Object -Last 1).Trim().Split(' ')
$HealthHost = if ($BindHost -eq '0.0.0.0') { '127.0.0.1' } else { $BindHost }

foreach ($p in @([int]$ApiPort, [int]$SimPort, $VitePort)) {
  $conn = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) {
    $owner = (Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue).ProcessName
    Fail "port $p is already in use (pid $($conn.OwningProcess) $owner). Stop it or change the port in .env / VITE_PORT."
  }
}

# ── Start (cleanup in finally: runs on Ctrl+C, errors, or normal exit) ──
$procs = @()
try {
  Info "1/3 unified backend on ${BindHost}:$ApiPort"
  $procs += Start-Process -FilePath $Py -ArgumentList 'unified_backend.py' `
    -WorkingDirectory (Join-Path $Root 'simulator') -NoNewWindow -PassThru

  Info "waiting for http://${HealthHost}:$ApiPort/api/health (timeout ${HealthTimeoutS}s)..."
  $deadline = (Get-Date).AddSeconds($HealthTimeoutS)
  while ($true) {
    if ($procs[0].HasExited) { Fail "backend exited during startup (see output above)" }
    try {
      Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://${HealthHost}:$ApiPort/api/health" | Out-Null
      break
    } catch {
      if ((Get-Date) -gt $deadline) { Fail "backend not healthy after ${HealthTimeoutS}s" }
      Start-Sleep -Seconds 1
    }
  }
  Info "backend healthy"

  Info "2/3 simulator on ${BindHost}:$SimPort"
  $procs += Start-Process -FilePath $Py -ArgumentList 'simulator.py' `
    -WorkingDirectory (Join-Path $Root 'simulator') -NoNewWindow -PassThru

  Info "3/3 vite on :$VitePort"
  $procs += Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'dev', '--', '--port', "$VitePort", '--strictPort') `
    -WorkingDirectory $Root -NoNewWindow -PassThru

  Write-Host ""
  Write-Host "  Frontend:     http://localhost:$VitePort" -ForegroundColor Green
  Write-Host "  Backend API:  http://${HealthHost}:$ApiPort   (health: /api/health)" -ForegroundColor Green
  Write-Host "  Simulator:    http://${HealthHost}:$SimPort   (internal)" -ForegroundColor Green
  Write-Host "  Press Ctrl+C to stop all services" -ForegroundColor Green
  Write-Host ""

  Wait-Process -Id ($procs | ForEach-Object { $_.Id })
}
finally {
  Info "Stopping services..."
  foreach ($p in $procs) {
    if ($p -and -not $p.HasExited) {
      # /T kills the whole tree (npm -> node vite, python children)
      & taskkill.exe /PID $p.Id /T /F 2>$null | Out-Null
    }
  }
  Info "All services stopped."
}
