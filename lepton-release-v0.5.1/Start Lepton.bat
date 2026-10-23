@echo off
title Lepton
rem Double-click to start Lepton; your browser opens when it is ready. Close this window to stop it.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed. Get the LTS version from https://nodejs.org, then run this file again.
  echo.
  pause
  exit /b 1
)
set LEPTON_OPEN=1
node server.js
if errorlevel 1 (
  echo.
  echo   Lepton stopped with an error ^(see above^).
  pause
)
