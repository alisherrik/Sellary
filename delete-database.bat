@echo off
setlocal

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "RESET_SCRIPT=%ROOT%\reset-database.bat"

if not exist "%RESET_SCRIPT%" (
    echo reset-database.bat not found: "%RESET_SCRIPT%"
    exit /b 1
)

call "%RESET_SCRIPT%"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" exit /b %EXIT_CODE%

endlocal
