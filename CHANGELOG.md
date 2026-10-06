# Histórico de versões do GiroAuto

A versão em uso aparece no rodapé do menu lateral do painel e em `/health`.

## v1.2 — 06/10/2026

**Correções no preenchimento automático (testado no Facebook real pela loja)**

- **Fabricante:** o campo do Facebook se chama "Fabricante" e é uma lista longa. O preenchedor agora usa a busca da lista e, se não houver busca, rola a lista até achar a marca.
- **Modelo:** quando o Facebook oferece uma lista de modelos, o preenchedor escolhe pelo nome base (ex.: "Onix" para "Onix LT 1.0 Turbo"). Se o campo for de texto, preenche modelo e versão.
- **Cor interna:** novo campo no cadastro do veículo, preenchido no Facebook e enviado ao catálogo. Veículos sem cor interna usam "Preto" e o preenchedor avisa para conferir.
- Cores com nomes diferentes no Facebook (Dourado/Ouro, Vinho/Bordô, Bege) e opção "Outro" quando a cor não existe na lista.
- O preenchedor nunca digita a busca de uma lista em outro campo do formulário.
- Botão **Copiar diagnóstico** quando algum campo fica para preencher à mão, para facilitar os próximos ajustes.
- A extensão do Chrome recebeu as mesmas correções.

Arquivos alterados: `assist/filler.src.js`, `public/bookmarklet.js`, `public/app.js`, `src/db.js`, `src/vehicles.js`, `src/feed.js`, `extension/content.js`, `extension/manifest.json`, `package.json`, `test/api.test.js`, `test/extension-filler.py`, `test/fixtures/fb-form.html`, `CHANGELOG.md`, `README.md`.

**Importante:** depois de atualizar, o favorito antigo continua funcionando com o código da v1.1. Apague o favorito **★ GiroAuto Preencher** e arraste de novo o botão do assistente para pegar a v1.2.

## v1.1 — 06/10/2026

**Preenchimento automático no Facebook, sem instalar nada**

- Novo botão **Preencher automaticamente** no assistente de publicação (computador).
- Botão de favorito **★ GiroAuto Preencher**: arrastado uma vez para a barra de favoritos. Na página do Marketplace, ele busca no GiroAuto o veículo escolhido e:
  - escolhe as opções nas listas (tipo de veículo, ano, carroceria, cor, condição, combustível, transmissão);
  - preenche os campos de texto (marca, modelo, quilometragem, preço, descrição);
  - anexa as fotos na ordem, com a capa primeiro.
- Quando a pessoa clica em **Publicar** no Facebook, a publicação é registrada no GiroAuto sozinha e o painel atualiza a data para a próxima republicação.
- Janela-ponte (`/ponte`) que entrega dados e fotos só para páginas do facebook.com.
- Alternativa caso o navegador bloqueie a comunicação entre as janelas: copiar e colar os dados (fotos à mão).
- O passo a passo manual continua disponível em "Prefiro preencher à mão" e é o padrão no celular.
- Versão exibida no painel e em `/health`.

Arquivos alterados: `assist/filler.src.js` (novo), `public/bookmarklet.js` (novo), `public/ponte.html` (novo), `public/ponte.js` (novo), `public/app.js`, `public/app.html`, `public/app.css`, `src/server.js`, `src/db.js`, `package.json`, `test/api.test.js`, `CHANGELOG.md` (novo), `README.md`.

## v1.0 — 05/10/2026

Primeira versão publicada.

- Login por loja, estoque com até 20 fotos por veículo, vitrine pública e página de cada carro.
- Publicação orgânica no Marketplace em dois modos: assistida (copiar e colar, sem instalar nada) ou pela extensão do Chrome.
- Republicação com intervalo mínimo de 7 dias e marcação de vendido.
- Campanhas pagas no Facebook e no Instagram pela API de Marketing da Meta: WhatsApp, Messenger e catálogo dinâmico, com métricas, pausa, reativação e encerramento.
- Catálogo de veículos com feed atualizado a cada hora.
- Configuração do app da Meta pelo painel (administrador), com páginas de privacidade, exclusão de dados e termos.
- Pronto para hospedar no Render (Dockerfile e render.yaml).
