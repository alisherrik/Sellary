@echo off
setlocal

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "FRONTEND_DIR=%ROOT%\sellary-frontend"
set "BACKEND_DIR=%ROOT%\sellary-backend"
set "BACKEND_PYTHON=%BACKEND_DIR%\.venv\Scripts\python.exe"

if not exist "%FRONTEND_DIR%\package.json" (
    echo Frontend folder not found: "%FRONTEND_DIR%"
    exit /b 1
)

if not exist "%BACKEND_PYTHON%" (
    echo Backend Python not found: "%BACKEND_PYTHON%"
    echo Make sure the backend virtual environment exists.
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo npm was not found in PATH.
    exit /b 1
)

if /I "%SELLARY_DRY_RUN%"=="1" (
    echo Would start backend from "%BACKEND_DIR%"
    echo Would start frontend from "%FRONTEND_DIR%"
    exit /b 0
)

call :is_port_listening 8000
if errorlevel 1 (
    start "Sellary Backend" cmd /k "cd /d ""%BACKEND_DIR%"" && ""%BACKEND_PYTHON%"" main.py"
    timeout /t 3 /nobreak >nul
) else (
    echo Sellary backend already running on http://localhost:8000
)

call :is_port_listening 3000
if errorlevel 1 (
    if exist "%FRONTEND_DIR%\.next" (
        echo Clearing stale Next.js build cache...
        rmdir /s /q "%FRONTEND_DIR%\.next" 2>nul
    )
    start "Sellary Frontend" cmd /k "cd /d ""%FRONTEND_DIR%"" && npm run dev -- --hostname 127.0.0.1 --port 3000"
) else (
    echo Sellary frontend already running on http://localhost:3000
)

echo Sellary backend: http://localhost:8000
echo Sellary frontend: http://localhost:3000

endlocal
exit /b 0

:is_port_listening
powershell -NoProfile -Command "$connection = Get-NetTCPConnection -LocalPort %~1 -State Listen -ErrorAction SilentlyContinue; if ($connection) { exit 0 } else { exit 1 }" >nul
exit /b %errorlevel%
