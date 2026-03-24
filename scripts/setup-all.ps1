param(
    [switch]$RunMigrations,
    [switch]$SeedAdmin,
    [switch]$ForceEnv
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$backendScript = Join-Path $PSScriptRoot "setup-backend.ps1"
$frontendScript = Join-Path $PSScriptRoot "setup-frontend.ps1"

if (-not (Test-Path $backendScript)) {
    throw "setup-backend.ps1 topilmadi."
}

if (-not (Test-Path $frontendScript)) {
    throw "setup-frontend.ps1 topilmadi."
}

$backendArgs = @{
    SeedAdmin = $true
}
$frontendArgs = @{}

if ($RunMigrations) {
    $backendArgs.RunMigrations = $true
}

if ($SeedAdmin) {
    $backendArgs.SeedAdmin = $true
}

if ($ForceEnv) {
    $backendArgs.ForceEnv = $true
    $frontendArgs.ForceEnv = $true
}

Write-Host "=== Sellary full setup boshlandi ===" -ForegroundColor Yellow
Write-Host ""

& $backendScript @backendArgs
Write-Host ""
& $frontendScript @frontendArgs

Write-Host ""
Write-Host "Hammasi tayyor." -ForegroundColor Green
Write-Host "Keyingi qadam:"
Write-Host "  1. Backend .env ni tekshiring"
Write-Host "  2. Frontend .env/.env.local ni tekshiring"
Write-Host "  3. scripts\\start-dev.ps1 ni ishga tushiring"
