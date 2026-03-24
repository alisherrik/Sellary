@echo off
setlocal EnableDelayedExpansion

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "BACKEND_DIR=%ROOT%\sellary-backend"
set "BACKEND_PYTHON=%BACKEND_DIR%\.venv\Scripts\python.exe"
set "REQUIREMENTS_FILE=%BACKEND_DIR%\requirements.txt"
set "ENV_FILE=%BACKEND_DIR%\.env"
set "ALEMBIC_INI=%BACKEND_DIR%\alembic.ini"

if not exist "%BACKEND_PYTHON%" (
    echo Backend Python not found: "%BACKEND_PYTHON%"
    echo Make sure the backend virtual environment exists.
    set "EXIT_CODE=1"
    goto :finish
)

if not exist "%REQUIREMENTS_FILE%" (
    echo requirements.txt not found: "%REQUIREMENTS_FILE%"
    set "EXIT_CODE=1"
    goto :finish
)

if not exist "%ALEMBIC_INI%" (
    echo alembic.ini not found: "%ALEMBIC_INI%"
    set "EXIT_CODE=1"
    goto :finish
)

if not exist "%ENV_FILE%" (
    echo .env not found: "%ENV_FILE%"
    echo Copy .env.example to .env and configure DATABASE_URL plus SUPER_ADMIN_* values.
    set "EXIT_CODE=1"
    goto :finish
)

if /I "%SELLARY_DRY_RUN%"=="1" (
    echo Would install backend requirements from "%REQUIREMENTS_FILE%"
    echo Would run alembic upgrade head in "%BACKEND_DIR%"
    echo Super admin will be auto-created or updated from SUPER_ADMIN_* values in .env
    set "EXIT_CODE=0"
    goto :finish
)

pushd "%BACKEND_DIR%"

echo Installing backend requirements...
"%BACKEND_PYTHON%" -m pip install -r requirements.txt
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
    echo Dependency installation failed with exit code %EXIT_CODE%.
    popd
    goto :finish
)

echo Checking existing database state...
"%BACKEND_PYTHON%" -c "from bootstrap_utils import has_unmanaged_schema; raise SystemExit(2 if has_unmanaged_schema() else 0)"
set "SCHEMA_STATE=%ERRORLEVEL%"
if "%SCHEMA_STATE%"=="2" (
    echo Existing tables were found without Alembic migration history.
    echo This usually means the database was created by an older reset/bootstrap flow.
    echo.
    set /p "CONFIRM_RESET=Type RESET to wipe and rebuild the database with migrations: "
    if /I not "!CONFIRM_RESET!"=="RESET" (
        popd
        echo Setup cancelled.
        set "EXIT_CODE=1"
        goto :finish
    )

    echo Resetting database with migrations...
    "%BACKEND_PYTHON%" reset_database.py --yes
    set "EXIT_CODE=%ERRORLEVEL%"
    popd

    if not "%EXIT_CODE%"=="0" (
        echo Database reset failed with exit code %EXIT_CODE%.
        goto :finish
    )

    echo Database is ready.
    echo Super admin is synced automatically from sellary-backend\.env.
    goto :finish
)

echo Running database migrations...
"%BACKEND_PYTHON%" -m alembic upgrade head
set "EXIT_CODE=%ERRORLEVEL%"
popd

if not "%EXIT_CODE%"=="0" (
    echo Database setup failed with exit code %EXIT_CODE%.
    goto :finish
)

echo Database is ready.
echo Super admin is synced automatically from sellary-backend\.env.

:finish
if not defined EXIT_CODE set "EXIT_CODE=0"
if /I not "%SELLARY_NO_PAUSE%"=="1" pause
endlocal
exit /b %EXIT_CODE%
