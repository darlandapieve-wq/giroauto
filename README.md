# GiroAuto v1.2

Histórico de versões: veja [CHANGELOG.md](CHANGELOG.md).

Painel para lojas de veículos com três frentes:

1. **Estoque**: cadastro do veículo uma única vez, com até 20 fotos.
2. **Anúncio orgânico no Facebook Marketplace**: uma extensão do Chrome publica, exclui e republica os anúncios na conta do Facebook da loja. A pessoa sempre confirma a publicação clicando em "Publicar" no próprio Facebook.
3. **Campanhas pagas no Facebook e no Instagram**: criadas direto na conta de anúncios da loja pela API de Marketing da Meta (campanha, conjunto de anúncios, criativo e anúncio), com métricas, pausa, reativação e encerramento pelo painel.

## Colocar no ar (100% online, sem o cliente instalar nada)

O GiroAuto é um site: você hospeda uma vez e cada loja só abre o endereço no navegador, no computador ou no celular, e cria a conta.

### Opção recomendada: Render (render.com)

1. Crie uma conta gratuita no [GitHub](https://github.com) e um repositório **privado** chamado `giroauto`. Envie para ele o conteúdo desta pasta: no site do GitHub, use **Add file > Upload files** e arraste todos os arquivos e pastas.
2. Crie uma conta no [Render](https://render.com) entrando com o GitHub.
3. No Render: **New > Blueprint**, escolha o repositório `giroauto` e confirme. O arquivo `render.yaml` já configura tudo: servidor, disco de 5 GB para o banco e as fotos, segredo de sessão e verificação de saúde.
4. Quando pedir, preencha `META_APP_ID` e `META_APP_SECRET` (pode deixar em branco e preencher depois em **Environment**).
5. Em alguns minutos o painel fica disponível num endereço como `https://giroauto-xxxx.onrender.com`.
6. No app da Meta, cadastre `https://SEU-ENDERECO/api/meta/callback` como URI de redirecionamento.

Custo: o plano com disco (Starter) custa cerca de US$ 7 por mês mais o disco. O plano gratuito não guarda os dados entre reinícios, então não serve para uso real.

Domínio próprio (ex.: `painel.giroauto.com.br`): adicione em **Settings > Custom Domains** no Render, defina a variável `PUBLIC_URL=https://painel.giroauto.com.br` e atualize a URI de redirecionamento no app da Meta.

### Outras hospedagens

O `Dockerfile` funciona em qualquer serviço que rode contêineres (Railway, Fly.io, uma VPS com Docker). Requisitos: volume persistente montado em `/data`, variáveis `SESSION_SECRET`, `PUBLIC_URL`, `META_APP_ID`, `META_APP_SECRET`, e HTTPS.

## Publicação orgânica: dois modos

Escolha em **Configurações > Publicação no Marketplace**.

- **Assistida, sem instalar nada (padrão):** o painel mostra um passo a passo com as fotos para baixar (ou salvar direto na galeria, no celular), o botão que abre o formulário de veículo do Marketplace, e cada campo com botão **Copiar** ou com a opção exata a escolher na lista. Depois de publicar, a pessoa cola o link do anúncio e clica em **Já publiquei**. Na republicação, o primeiro passo abre o anúncio antigo para excluir. Funciona em qualquer navegador, inclusive no celular.
- **Automática, com a extensão do Chrome:** a extensão preenche o formulário, exclui e republica sozinha; a pessoa só confirma no Facebook. Exige instalar a extensão (seção abaixo).

A publicação orgânica não pode ser 100% automática pelo servidor: a Meta não oferece API de Marketplace para veículos no Brasil, e um robô no servidor logado na conta do cliente viola os termos do Facebook e leva a bloqueio. Por isso, ou a pessoa publica com o assistente, ou a extensão age no navegador dela.

### Preenchimento automático (v1.1)

No computador, o assistente de publicação tem o botão **Preencher automaticamente**:

1. Uma única vez, arraste o botão **★ GiroAuto Preencher** (aparece no assistente) para a barra de favoritos do navegador (Ctrl+Shift+B mostra a barra).
2. Clique em **Preencher automaticamente**. O GiroAuto separa o veículo e abre o formulário do Marketplace.
3. Na aba do Facebook, clique no favorito e em **Buscar dados no GiroAuto**. Uma janela pequena do GiroAuto abre e entrega os dados e as fotos. O favorito escolhe as opções das listas, preenche os textos e anexa as fotos.
4. Confira e clique em **Avançar** e **Publicar**. A publicação é registrada no GiroAuto sozinha.

Por que um favorito: por segurança, um site não pode controlar a aba de outro site. O favorito roda dentro da página do Facebook, a pedido da pessoa, sem instalar nada. Ele nunca clica em Publicar. Se o navegador bloquear a troca de dados entre as janelas, aparece a opção de copiar e colar os dados.

O código-fonte do favorito fica em `assist/filler.src.js`. Depois de alterar, gere `public/bookmarklet.js` com `npm install && npm run build:bookmarklet`.

## Requisitos (para rodar no seu computador)

- Node.js 22.13 ou mais recente (usa o SQLite embutido no Node; não precisa instalar banco de dados).
- Google Chrome para a extensão.
- Um app da Meta (gratuito) para as campanhas.

## Rodar localmente

```bash
npm install
cp .env.example .env      # preencha SESSION_SECRET e, para campanhas, META_APP_ID e META_APP_SECRET
npm start                 # abre em http://localhost:3333
```

Crie a conta da loja na tela inicial ("Criar conta"). Os dados ficam na pasta `data/` (banco `giroauto.db` e fotos em `data/media`).

## Configurar o app da Meta (campanhas)

1. Em [developers.facebook.com](https://developers.facebook.com/apps), crie um app do tipo **Empresa** (ou o caso de uso "Criar e gerenciar anúncios com a API de Marketing"), vinculado ao portfólio empresarial da loja.
2. Adicione o produto **Login do Facebook para Empresas**. Em "URIs de redirecionamento do OAuth válidos", cadastre:
   `PUBLIC_URL/api/meta/callback` (por exemplo `http://localhost:3333/api/meta/callback` no teste local).
3. Copie o **ID do app** e a **Chave secreta do app** (Configurações > Básico) para `META_APP_ID` e `META_APP_SECRET` no `.env`.
4. Permissões pedidas no login: `ads_management`, `ads_read`, `business_management`, `catalog_management`, `pages_show_list`, `pages_read_engagement`, `pages_manage_ads`, `instagram_basic`.
   Se preferir uma "configuração" do Login para Empresas, informe o ID em `META_LOGIN_CONFIG_ID`.

**Modo de desenvolvimento:** enquanto o app estiver em desenvolvimento, só contas com função no app (administrador, desenvolvedor ou testador) conseguem conectar. Para testar com a sua própria loja isso basta. Para vender o GiroAuto para outras lojas, a Meta exige verificação da empresa e análise do app (acesso avançado a `ads_management` e às demais permissões).

### No painel

Configurações > Facebook e Instagram > **Conectar Facebook**. Depois escolha a conta de anúncios, a Página (o Instagram vinculado vem junto), o portfólio empresarial e o número de WhatsApp da loja. O número precisa estar vinculado à Página no Facebook.

### Tipos de campanha

| Tipo | Objetivo na Meta | O que acontece |
|---|---|---|
| Conversas no WhatsApp | `OUTCOME_ENGAGEMENT`, destino `WHATSAPP`, otimizado para conversas | O cliente toca no anúncio e abre conversa com a loja. Um veículo vira anúncio de imagem; vários viram carrossel (até 10). |
| Conversas no Messenger | `OUTCOME_ENGAGEMENT`, destino `MESSENGER` | Abre conversa com a Página. |
| Catálogo dinâmico | `OUTCOME_TRAFFIC` com catálogo de veículos | Usa o catálogo e leva para a página do carro na vitrine pública da loja. |

Em todos os tipos: posicionamentos no Facebook (feed, Marketplace, stories) e no Instagram (feed, stories, explorar), cidade + raio de 17 a 80 km, idade 18 a 65 por padrão.

**Segurança no gasto:** tudo é criado **pausado**. Só depois de criar campanha, conjunto, criativo e anúncio sem erro o painel ativa os três (se "Ativar assim que a Meta aprovar" estiver marcado). Se a Meta recusar qualquer etapa, o painel apaga o que já tinha criado e mostra a mensagem da Meta. Para o primeiro teste, desmarque a ativação e confira a campanha no Gerenciador de Anúncios.

### Catálogo de veículos

O botão "Criar catálogo de veículos" cria um catálogo com vertical `vehicles` no portfólio empresarial e um feed que a Meta lê a cada hora em `PUBLIC_URL/feed/<loja>.csv?k=<chave>`. Só entram no feed os veículos marcados "Catálogo para campanhas", com status pronto ou publicado e ao menos uma foto.

A Meta precisa acessar esse endereço e as fotos pela internet, então o catálogo só funciona com `PUBLIC_URL` público em HTTPS (servidor publicado ou um túnel, por exemplo `cloudflared tunnel --url http://localhost:3333`). As campanhas de WhatsApp e Messenger funcionam também no teste local, porque as fotos são enviadas para a Meta pelo próprio servidor.

## Extensão do Chrome (anúncios orgânicos)

1. Abra `chrome://extensions`, ative o **Modo do desenvolvedor** e clique em **Carregar sem compactação**. Escolha a pasta `extension`.
2. No painel: Configurações > Extensão do Chrome > **Gerar código de pareamento**.
3. Clique no ícone da extensão, informe o endereço do painel e o código.

Como funciona:

- **Publicar**: a extensão abre `facebook.com/marketplace/create/vehicle`, preenche tipo, fotos, ano, marca, modelo, quilometragem, preço, carroceria, cor, condição, combustível, câmbio e descrição. Você confere e clica em **Avançar** e **Publicar**. Quando o Facebook sai da página de criação, a extensão registra a publicação no painel.
- **Republicar**: abre "Seus anúncios", localiza o anúncio pelo nome do veículo, exclui e em seguida faz a publicação nova.
- **Vendido**: exclui o anúncio do Marketplace.
- Republicação liberada a cada 7 dias por anúncio (`REPUBLISH_DAYS`) e intervalo de 3 a 5 minutos entre anúncios, para manter ritmo humano.
- Se a extensão não encontrar um campo ou botão, ela mostra o que falta e você termina à mão; a tarefa continua.

## Testes

```bash
npm test                          # API completa contra uma Graph API simulada (cadastro, fotos, extensão, feed, OAuth, campanhas, rollback)
node test/e2e-server.js           # sobe o painel com a Meta simulada em http://127.0.0.1:4556 para testar no navegador
python3 test/extension-filler.py  # preenchimento da extensão contra uma imitação do formulário (requer Playwright)
```

## O que ainda precisa ser validado com contas reais

- **Formulário do Marketplace**: a extensão localiza os campos pelos rótulos em português e inglês ("Tipo de veículo", "Ano", "Marca", "Quilometragem", "Preço"...). Foi testada contra uma imitação da estrutura do formulário, não contra a página real do Facebook, que muda com frequência. Ajustes de rótulo ficam em `extension/content.js`, no objeto `L`.
- **Exclusão de anúncio**: depende dos botões "…" e "Excluir anúncio" em "Seus anúncios". Se falhar, a extensão pede a exclusão manual e segue com a republicação.
- **Catálogo dinâmico**: o conjunto de produtos filtra os veículos pelo identificador `giro-<id>` (`retailer_id`). Confirmar na primeira campanha real se a Meta aceita esse filtro para catálogos de veículos.
- **Versão da API**: padrão `v25.0` (`META_API_VERSION`).

## Produção

- Publique atrás de HTTPS e defina `PUBLIC_URL` com o endereço final, `NODE_ENV=production` e um `SESSION_SECRET` longo.
- O token da Meta é guardado criptografado (AES-256-GCM, chave derivada do `SESSION_SECRET`). Trocar o segredo exige reconectar o Facebook.
- O token de longa duração vale cerca de 60 dias; o painel avisa quando expira.
- Faça backup da pasta `data/`.

## Estrutura

```
src/server.js        rotas HTTP (painel, extensão, Meta, páginas públicas)
src/db.js            esquema SQLite
src/meta/graph.js    cliente da Graph API (appsecret_proof, paginação, erros)
src/meta/service.js  OAuth, ativos, catálogo, criação e controle de campanhas
src/feed.js          feed CSV do catálogo de veículos
src/pages.js         vitrine pública e página do veículo
public/              painel (HTML, CSS, JS sem build)
extension/           extensão do Chrome (Manifest V3)
test/                testes automatizados e Meta simulada
```
