#!/bin/bash
# GiroAuto — duplo clique no macOS (ou ./iniciar.command no Linux)
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "O Node.js não está instalado. Baixe a versão LTS em https://nodejs.org e abra este arquivo de novo."
  open https://nodejs.org 2>/dev/null || xdg-open https://nodejs.org 2>/dev/null
  read -n 1 -s -r -p "Pressione uma tecla para sair"; exit 1
fi
[ -d node_modules ] || npm install --no-audit --no-fund || { read -n 1 -s -r -p "Falha ao instalar."; exit 1; }
[ -f .env ] || { cp .env.example .env; echo "Arquivo .env criado. Para campanhas, preencha META_APP_ID e META_APP_SECRET nele."; }
echo "Abrindo o painel em http://localhost:3333 — deixe esta janela aberta."
(sleep 2; open http://localhost:3333 2>/dev/null || xdg-open http://localhost:3333 2>/dev/null) &
npm start
