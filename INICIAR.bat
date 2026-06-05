@echo off
title Sistema de Relatorios
echo.
echo  ========================================
echo   Sistema de Relatorios - Iniciando...
echo  ========================================
echo.
cd /d "%~dp0"
start "" "http://localhost:3000"
node server.js
pause
