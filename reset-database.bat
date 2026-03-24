@echo off
setlocal EnableDelayedExpansion

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "BACKEND_DIR=%ROOT%\sellary-backend"
set "BACKEND_PYTHON=%BACKEND_DIR%\.venv\Scripts\python.exe"

if not exist "%BACKEND_PYTHON%" (
    echo Backend Python not found: "%BACKEND_PYTHON%"
    echo Make sure the backend virtual environment exists.
    set "EXIT_CODE=1"
    goto :finish
)

if /I "%SELLARY_DRY_RUN%"=="1" (
    echo Would run reset_database.py --yes in "%BACKEND_DIR%"
    echo Super admin will be auto-created or updated from SUPER_ADMIN_* values in .env
    set "EXIT_CODE=0"
    goto :finish
)

echo This will delete all Sellary tables and recreate an empty schema
echo for the database configured in sellary-backend\.env.
echo Super admin will be recreated from SUPER_ADMIN_* values in .env.
echo.
set /p "CONFIRM=Type RESET to continue: "

if /I not "!CONFIRM!"=="RESET" (
    echo Cancelled.
    set "EXIT_CODE=0"
    goto :finish
)

pushd "%BACKEND_DIR%"
"%BACKEND_PYTHON%" reset_database.py --yes
set "EXIT_CODE=%ERRORLEVEL%"
popd

if not "%EXIT_CODE%"=="0" (
    echo Database reset failed with exit code %EXIT_CODE%.
    goto :finish
)

echo Database reset complete.

:finish
if not defined EXIT_CODE set "EXIT_CODE=0"
if /I not "%SELLARY_NO_PAUSE%"=="1" pause
endlocal
exit /b %EXIT_CODE%
