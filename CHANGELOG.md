# Histórico de versões do GiroAuto

A versão em uso aparece no rodapé do menu lateral do painel e em `/health`.

## v1.6.2 — 06/10/2026

- Quando a Meta recusa um anúncio porque o app ainda está em **modo de desenvolvimento**, o painel explica como mudar o app para o modo Ativo e tentar de novo.

Arquivos alterados: `src/server.js`, `package.json`, `CHANGELOG.md`.

## v1.6.1 — 06/10/2026

**Correção: "Invalid Scopes" ao conectar o Facebook**

- O GiroAuto passou a pedir só as permissões que o caso de uso "Criar e gerenciar anúncios com a API de Marketing" aceita: `ads_management`, `ads_read`, `business_management`, `pages_show_list` e `pages_read_engagement`.
- `catalog_management` e `instagram_basic` viraram opcionais: o administrador liga em **Configurações > App da Meta > Permissões extras**, depois de adicionar o caso de uso correspondente no app da Meta. `pages_manage_ads` não é mais pedida.
- Sem `instagram_basic`, as Páginas continuam aparecendo e os anúncios continuam indo para o Instagram.
- Mensagem clara ao criar o catálogo sem a permissão. WhatsApp e Messenger funcionam sem catálogo.

Arquivos alterados: `src/config.js`, `src/settings.js`, `src/meta/service.js`, `src/server.js`, `public/app.js`, `test/api.test.js`, `package.json`, `CHANGELOG.md`, `README.md`.

## v1.6 — 06/10/2026

**Campanhas com público, posicionamentos e alcance estimado**

- **Público automático (Advantage+)**, recomendado pela Meta: a loja define cidade, raio e idade mínima; a Meta encontra quem tem mais chance de comprar.
- **Público personalizado**: idade mínima e máxima, gênero e **interesses** buscados direto na Meta (com sugestões prontas: Automóveis, Carros usados, Concessionária, Picapes, SUV).
- **Onde o anúncio aparece**: automático (a Meta distribui) ou escolhido entre Feed, Marketplace, Stories e Reels do Facebook e Feed, Stories, Explorar e Reels do Instagram.
- **Alcance estimado** pela Meta, atualizado a cada mudança, com aviso quando o público fica pequeno demais.
- **Data de início** da campanha (vazio = começa agora).
- Idade padrão 21 a 65 anos.

Arquivos alterados: `src/meta/service.js`, `src/server.js`, `src/db.js`, `public/app.js`, `test/api.test.js`, `test/mock-graph.js`, `package.json`, `CHANGELOG.md`.

## v1.5 — 06/10/2026

**Publicação automática com um clique (extensão do Chrome)**

- Clique em **Publicar** ou **Republicar** no GiroAuto e a extensão faz tudo sozinha: exclui o anúncio antigo (republicação), preenche o formulário, anexa as fotos, clica em **Avançar** e **Publicar**, registra o link do anúncio no painel, fecha a aba do Facebook e volta para o GiroAuto.
- **Vendido** também exclui o anúncio do Marketplace na hora.
- O painel conversa direto com a extensão: começa na hora (sem esperar 1 minuto) e conecta a extensão à loja sozinho, sem código.
- O painel detecta a extensão instalada e oferece ativar a publicação automática com um botão.
- Status ao vivo no estoque: "Na fila", "Publicando agora", "Precisa de você".
- Proteções da conta do Facebook: limite de publicações por dia (padrão 15, ajustável), intervalo de 3 a 5 minutos entre anúncios, e parada imediata se o Facebook mostrar verificação de identidade, bloqueio ou erro.
- Opção **Publicar sem conferir** (ligada por padrão). Desligada, a extensão preenche tudo e espera você clicar em Publicar.
- Extensão para baixar direto pelo painel (Configurações > Extensão do Chrome > Instalar), com passo a passo. Aviso automático quando houver versão nova da extensão.
- Extensão v1.5.0 com identificador fixo (o painel sempre a reconhece).

Arquivos alterados: `extension/background.js`, `extension/content.js`, `extension/manifest.json`, `public/app.js`, `src/server.js`, `src/db.js`, `Dockerfile`, `.dockerignore`, `package.json`, `test/fixtures/fb-form.html`, `test/fixtures/fb-selling.html` (novo), `test/e2e-extension.py` (novo), `CHANGELOG.md`, `README.md`.

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
