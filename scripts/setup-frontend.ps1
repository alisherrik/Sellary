param(
    [switch]$ForceEnv
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "[frontend] $Message" -ForegroundColor Cyan
}

function Assert-Command {
    param(
        [string]$Name,
        [string]$InstallHint
    )

    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $cmd) {
        throw "$Name topilmadi. $InstallHint"
    }
}

$rootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$frontendDir = Join-Path $rootDir "sellary-frontend"

if (-not (Test-Path $frontendDir)) {
    throw "Frontend papkasi topilmadi: $frontendDir"
}

Assert-Command -Name "node" -InstallHint "Node.js LTS o'rnating."
Assert-Command -Name "npm" -InstallHint "npm Node.js bilan birga keladi."

Push-Location $frontendDir
try {
    Write-Step "Frontend dependency'lari o'rnatilmoqda..."
    & npm install

    if ($ForceEnv -or -not (Test-Path ".env")) {
        Write-Step ".env.example dan .env yaratilmoqda..."
        Copy-Item ".env.example" ".env" -Force
    } else {
        Write-Step ".env mavjud, o'zgartirilmadi."
    }

    if (Test-Path ".env.local.example") {
        if ($ForceEnv -or -not (Test-Path ".env.local")) {
            Write-Step ".env.local.example dan .env.local yaratilmoqda..."
            Copy-Item ".env.local.example" ".env.local" -Force
        } else {
            Write-Step ".env.local mavjud, o'zgartirilmadi."
        }
    }

    Write-Host ""
    Write-Host "Frontend setup tayyor." -ForegroundColor Green
    Write-Host "Ishga tushirish: scripts\\start-dev.ps1 yoki sellary-frontend ichida npm run dev"
}
finally {
    Pop-Location
}
