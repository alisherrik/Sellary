param(
    [switch]$RunMigrations,
    [switch]$SeedAdmin,
    [switch]$ForceEnv
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "[backend] $Message" -ForegroundColor Cyan
}

function Resolve-PythonCommand {
    foreach ($candidate in @("py", "python")) {
        $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($cmd) {
            return $cmd.Source
        }
    }

    throw "Python topilmadi. Python 3 o'rnating va qayta urinib ko'ring."
}

function Resolve-PsqlPath {
    $psqlCommand = Get-Command psql -ErrorAction SilentlyContinue
    if ($psqlCommand) {
        return $psqlCommand.Source
    }

    $postgresRoot = "C:\Program Files\PostgreSQL"
    if (-not (Test-Path $postgresRoot)) {
        return $null
    }

    $candidate = Get-ChildItem $postgresRoot -Recurse -Filter "psql.exe" -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName

    return $candidate
}

function Get-EnvValue {
    param(
        [string]$Path,
        [string]$Key
    )

    if (-not (Test-Path $Path)) {
        return $null
    }

    $line = Get-Content $Path | Where-Object { $_ -match "^${Key}=" } | Select-Object -First 1
    if (-not $line) {
        return $null
    }

    return ($line -split "=", 2)[1].Trim()
}

function Get-PostgresConfigFromUrl {
    param([string]$DatabaseUrl)

    if ($DatabaseUrl -notmatch "^postgresql:\/\/(?<user>[^:]+):(?<pass>[^@]+)@(?<host>[^:\/]+)(:(?<port>\d+))?\/(?<db>[^?]+)") {
        return $null
    }

    return [PSCustomObject]@{
        User = $matches.user
        Password = $matches.pass
        Host = $matches.host
        Port = if ($matches.port) { $matches.port } else { "5432" }
        Database = $matches.db
    }
}

function Ensure-PostgresDatabase {
    param([string]$DatabaseUrl)

    $config = Get-PostgresConfigFromUrl -DatabaseUrl $DatabaseUrl
    if (-not $config) {
        Write-Warning "DATABASE_URL parse bo'lmadi. DB avtomatik yaratilmaydi."
        return
    }

    $psqlPath = Resolve-PsqlPath
    if (-not $psqlPath) {
        Write-Warning "psql topilmadi. DB avtomatik yaratilmaydi."
        return
    }

    $env:PGPASSWORD = $config.Password
    try {
        $exists = & $psqlPath -h $config.Host -p $config.Port -U $config.User -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$($config.Database)'"
        if (($exists | Out-String).Trim() -eq "1") {
            Write-Step "Database '$($config.Database)' allaqachon mavjud."
            return
        }

        Write-Step "Database '$($config.Database)' yaratilmoqda..."
        & $psqlPath -h $config.Host -p $config.Port -U $config.User -d postgres -c "CREATE DATABASE ""$($config.Database)"""
    }
    finally {
        Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    }
}

function Initialize-SchemaFromModels {
    param([string]$PythonExe)

    Write-Step "Schema models orqali bootstrap qilinmoqda..."
    @'
from core.database import Base, engine
import models

Base.metadata.create_all(bind=engine)
print("Schema bootstrap complete.")
'@ | & $PythonExe -
}

$rootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$backendDir = Join-Path $rootDir "sellary-backend"

if (-not (Test-Path $backendDir)) {
    throw "Backend papkasi topilmadi: $backendDir"
}

$pythonCmd = Resolve-PythonCommand

Push-Location $backendDir
try {
    if (-not (Test-Path ".venv\\Scripts\\python.exe")) {
        Write-Step "Virtual environment yaratilmoqda..."
        & $pythonCmd -m venv .venv
    } else {
        Write-Step "Virtual environment allaqachon mavjud."
    }

    $venvPython = Join-Path $backendDir ".venv\\Scripts\\python.exe"

    Write-Step "pip yangilanmoqda..."
    & $venvPython -m pip install --upgrade pip

    Write-Step "Backend dependency'lari o'rnatilmoqda..."
    & $venvPython -m pip install -r requirements.txt

    if ($ForceEnv -or -not (Test-Path ".env")) {
        Write-Step ".env.example dan .env yaratilmoqda..."
        Copy-Item ".env.example" ".env" -Force
    } else {
        Write-Step ".env mavjud, o'zgartirilmadi."
    }

    $databaseUrl = Get-EnvValue -Path ".env" -Key "DATABASE_URL"
    if ($databaseUrl) {
        Ensure-PostgresDatabase -DatabaseUrl $databaseUrl
    } else {
        Write-Warning "DATABASE_URL topilmadi. DB tayyorlash bosqichi o'tkazib yuborildi."
    }

    if ($RunMigrations) {
        try {
            Write-Step "Alembic migration'lar ishlatilmoqda..."
            & $venvPython -m alembic upgrade head
        }
        catch {
            Write-Warning "Alembic migration muvaffaqiyatsiz tugadi. Local setup uchun schema bootstrap fallback ishlatildi."
            Initialize-SchemaFromModels -PythonExe $venvPython
        }
    } else {
        Initialize-SchemaFromModels -PythonExe $venvPython
    }

    if ($SeedAdmin) {
        Write-Step "Admin foydalanuvchi seed qilinmoqda..."
        & $venvPython seed_admin.py
    } else {
        Write-Step "Admin seed o'tkazilmadi. Kerak bo'lsa -SeedAdmin bilan ishga tushiring."
    }

    Write-Host ""
    Write-Host "Backend setup tayyor." -ForegroundColor Green
    Write-Host "Ishga tushirish: scripts\\start-dev.ps1 yoki sellary-backend ichida .venv\\Scripts\\python.exe -m uvicorn main:app --reload"
}
finally {
    Pop-Location
}
