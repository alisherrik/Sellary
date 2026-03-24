param(
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 3000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "[start-dev] $Message" -ForegroundColor Cyan
}

function Test-PortBusy {
    param([int]$Port)

    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return $null -ne $listener
}

$rootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$backendDir = Join-Path $rootDir "sellary-backend"
$frontendDir = Join-Path $rootDir "sellary-frontend"
$backendPython = Join-Path $backendDir ".venv\\Scripts\\python.exe"

if (-not (Test-Path $backendPython)) {
    throw "Backend virtual environment topilmadi. Avval scripts\\setup-backend.ps1 ni ishga tushiring."
}

if (-not (Test-Path (Join-Path $frontendDir "package.json"))) {
    throw "Frontend package.json topilmadi. Frontend setup to'liq emas."
}

if (Test-PortBusy -Port $BackendPort) {
    throw "Backend port $BackendPort band. Avval eski processni to'xtating yoki boshqa port bering."
}

if (Test-PortBusy -Port $FrontendPort) {
    throw "Frontend port $FrontendPort band. Avval eski processni to'xtating yoki boshqa port bering."
}

$backendCommand = "Set-Location '$backendDir'; & '$backendPython' -m uvicorn main:app --host 127.0.0.1 --port $BackendPort --reload"
$frontendCommand = "Set-Location '$frontendDir'; npm run dev -- --hostname 127.0.0.1 --port $FrontendPort"

Write-Step "Backend yangi oynada ishga tushirilmoqda..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCommand -WorkingDirectory $backendDir | Out-Null

Start-Sleep -Seconds 3

Write-Step "Frontend yangi oynada ishga tushirilmoqda..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCommand -WorkingDirectory $frontendDir | Out-Null

Write-Host ""
Write-Host "Dev serverlar ishga tushirildi." -ForegroundColor Green
Write-Host "Backend:  http://127.0.0.1:${BackendPort}"
Write-Host "Frontend: http://127.0.0.1:${FrontendPort}"
Write-Host ""
Write-Host "Agar port band bo'lsa, masalan:"
Write-Host "  .\\scripts\\start-dev.ps1 -FrontendPort 3001"
