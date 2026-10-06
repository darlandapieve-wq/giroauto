@echo off
chcp 65001 >nul
title GiroAuto - Atualizar
cd /d "%~dp0"
echo.
echo  GiroAuto - atualizar esta pasta para a ultima versao do GitHub
echo  Pasta: %CD%
echo  (seus dados locais em "data" e o arquivo ".env" NAO sao alterados)
echo.

set "ZIPURL=https://github.com/darlandapieve-wq/giroauto/archive/refs/heads/main.zip"
set "TMPZIP=%TEMP%\giroauto-main.zip"
set "TMPDIR=%TEMP%\giroauto-main-extraido"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "try { Invoke-WebRequest -Uri '%ZIPURL%' -OutFile '%TMPZIP%' -UseBasicParsing } catch { Write-Host ('Falha ao baixar: ' + $_.Exception.Message); exit 2 };" ^
  "if (Test-Path '%TMPDIR%') { Remove-Item -Recurse -Force '%TMPDIR%' };" ^
  "Expand-Archive -Path '%TMPZIP%' -DestinationPath '%TMPDIR%' -Force"
if errorlevel 2 (
  echo.
  echo  Nao foi possivel baixar do GitHub.
  echo  Se o repositorio for PRIVADO, baixe o .zip pelo site do GitHub ^(Code ^> Download ZIP^)
  echo  ou peca ao Claude o pacote da versao e extraia nesta pasta.
  echo.
  pause & exit /b 1
)

rem Copia os arquivos novos. Preserva: data (banco e fotos locais), .env, node_modules e este atualizador.
robocopy "%TMPDIR%\giroauto-main" "%CD%" /E /NFL /NDL /NJH /NJS /NP /XD data node_modules .git /XF .env atualizar.bat >nul
if %ERRORLEVEL% GEQ 8 ( echo  Erro ao copiar os arquivos. & pause & exit /b 1 )

for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "(Get-Content -Raw package.json | ConvertFrom-Json).version"`) do set "VER=%%v"
echo  Atualizado para a versao %VER%.

where node >nul 2>nul
if not errorlevel 1 (
  echo  Atualizando dependencias...
  call npm install --no-audit --no-fund >nul 2>nul
)

rmdir /s /q "%TMPDIR%" 2>nul
del "%TMPZIP%" 2>nul
echo.
echo  Pronto. Veja o que mudou no arquivo CHANGELOG.md.
echo.
pause
