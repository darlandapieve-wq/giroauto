@echo off
chcp 65001 >nul
title GiroAuto
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo O Node.js nao esta instalado.
  echo Baixe a versao LTS em https://nodejs.org , instale e abra este arquivo de novo.
  echo.
  start https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias, aguarde...
  call npm install --no-audit --no-fund
  if errorlevel 1 ( echo Falha ao instalar. & pause & exit /b 1 )
)

if not exist .env (
  copy .env.example .env >nul
  echo Arquivo .env criado. Para campanhas, preencha META_APP_ID e META_APP_SECRET nele.
)

echo.
echo Abrindo o painel em http://localhost:3333
echo Deixe esta janela aberta enquanto usar o painel. Para parar, feche a janela.
echo.
start "" http://localhost:3333
call npm start
pause
