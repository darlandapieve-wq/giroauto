# Histórico de versões do GiroAuto

A versão em uso aparece no rodapé do menu lateral do painel e em `/health`.

## v1.4 — 06/10/2026

**Supabase do GiroAuto configurado**

- Projeto **giroauto** criado no Supabase (região São Paulo, plano gratuito).
- Novo modo de armazenamento "banco": a cópia do banco e as fotos ficam no Postgres do projeto, num esquema privado (`giro_private`), acessado só por funções que exigem a senha do servidor. Não precisa da chave secreta do Supabase.
- Arquivos enviados em partes de 512 KB e confirmados só no final: um envio interrompido nunca estraga a última cópia boa.
- Senha do servidor errada: o painel não inicia, para não sobrescrever a cópia guardada.
- Variáveis no Render: `SUPABASE_URL`, `SUPABASE_KEY` e `GIROAUTO_STORAGE_TOKEN`.

Arquivos alterados: `src/storage.js`, `test/storage.test.js`, `test/mock-supabase.js`, `render.yaml`, `.env.example`, `package.json`, `CHANGELOG.md`, `README.md`.

## v1.3 — 06/10/2026

**Dados permanentes: lojas, veículos e fotos não se perdem mais a cada nova versão**

- O banco de dados é copiado para o **Supabase** (gratuito) poucos segundos depois de cada alteração e sempre que o servidor desliga (o Render desliga a versão antiga ao publicar uma nova).
- Ao iniciar, o servidor baixa a última cópia antes de abrir o painel. As sessões também continuam: não é preciso entrar de novo.
- As fotos ficam no Supabase; o servidor guarda uma cópia local apenas como cache.
- Uma cópia por dia fica guardada na pasta `copias` do Supabase, como segurança extra.
- Se as chaves do Supabase estiverem erradas, o servidor não inicia, para nunca sobrescrever a cópia guardada com um banco vazio.
- Painel do administrador mostra a situação dos dados (protegidos ou temporários), a hora da última cópia e o botão **Fazer cópia agora**.
- Novo `atualizar.bat` para manter uma pasta no computador sempre na última versão do GitHub, sem apagar dados locais nem o `.env`.

Configuração necessária no Render (uma vez): variáveis `SUPABASE_URL` e `SUPABASE_SECRET_KEY`.

Arquivos alterados: `src/storage.js` (novo), `src/start.js` (novo), `src/server.js`, `src/db.js`, `src/meta/service.js`, `public/app.js`, `package.json`, `Dockerfile`, `render.yaml`, `.env.example`, `atualizar.bat` (novo), `test/storage.test.js` (novo), `test/mock-supabase.js` (novo), `CHANGELOG.md`, `README.md`.

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
