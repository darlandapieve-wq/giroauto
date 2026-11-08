# Família GiroAuto — monorepo

## O que é
Um só repositório e um só serviço no Render para toda a família:
- Loja: estoque, publicação em Marketplace/Instagram, gestão e resultados (rota /)
- Fotos: geração automática de fotos de veículos (rota /fotos), mesmo login e busca pela placa
- Repasse: lê anúncios de repasse em grupos do WhatsApp, edita e retransmite ao grupo "GiroAuto Repasse" (rota /repasse)

## Infraestrutura
- GitHub: darlandapieve-wq/giroauto (branch main)
- Render: UM serviço web "giroauto", Docker, plano free, Virginia, auto-deploy na main
- O serviço antigo "giroauto-repasse" será desativado depois que o monorepo estiver validado
- Supabase: hoje são dois projetos (o da Loja/Fotos e o "giroauto-repasse"); o destino é o projeto único "giroauto" (ver "Banco de dados único"), e o "giroauto-repasse" será pausado após a validação
- Variáveis de ambiente dos dois apps ficam no mesmo serviço, com prefixos (LOJA_*, REPASSE_*)

## Regras sobre dados (obrigatórias)
- NUNCA criar banco ou projeto Supabase novo.
- NUNCA apagar tabelas ou dados sem autorização explícita do Darlan.
- Mudanças de banco só por migration versionada.

## Banco de dados único
- Supabase do monorepo: giroauto (ahltyukhyvkawtzvxwmq), região São Paulo.
- Repasse usa o schema "repasse". Loja e Fotos ficam no schema "giro_private" (formato atual, ver "Onde estão os dados hoje"); levar para "public" só na Fase 2.
- Projeto giroauto-repasse (qbwifhvfohujejqfjqsj): será PAUSADO após validação, nunca excluído sem ordem do Darlan.
- Antes de qualquer mudança: descobrir onde os dados estão hoje (Storage, Auth, arquivos locais no Render).
- Nada de dados importantes em disco local do Render (é apagado a cada deploy).

## Onde estão os dados hoje (levantamento de 08/11/2026)
O schema "public" dos dois projetos está vazio. Supabase Auth não é usado (0 usuários nos dois). Supabase Storage não é usado (o único bucket, tmp-g45-fotos, está vazio).

### Loja e Fotos — projeto giroauto (ahltyukhyvkawtzvxwmq)
- O banco de trabalho é um SQLite dentro do container: /data/giroauto.db (src/db.js). O disco é apagado a cada deploy.
- src/storage.js (modo "banco") copia o SQLite inteiro, comprimido, para giro_private.files, "pasta" giroauto-dados, arquivo giroauto.db. A cópia é feita 10 s a 2 min depois de cada alteração e ao receber SIGTERM. src/start.js baixa essa cópia ao iniciar.
- Cópias diárias: giroauto-dados/copias/giroauto-AAAA-MM-DD.db, mantidas por 14 dias.
- Fotos, artes, ensaios do Fotos, procurações e logos: giro_private.files, "pasta" giroauto-fotos (370 arquivos, cerca de 86 MB). O disco local é só cache.
- Acesso por funções RPC giro_* com SUPABASE_KEY (chave publicável) + GIROAUTO_STORAGE_TOKEN. O hash do token fica em giro_private.settings.
- Login e sessões são próprios, nas tabelas users e sessions do SQLite.
- Tokens da Meta, senha IMAP e sessão do Repasse ficam dentro do SQLite, criptografados com SESSION_SECRET.
- Serviços externos: Meta (Marketplace, Instagram, anúncios, WhatsApp oficial), caixa IMAP da loja (leads dos portais), Pollinations/Gemini/Anthropic (só geram, não guardam), placa/FIPE/CNPJ.
- O Fotos fala com o Repasse pela API HTTP (REPASSE_URL, hoje giroauto-repasse.onrender.com), sem acessar o banco dele.

### Repasse — projeto giroauto-repasse (qbwifhvfohujejqfjqsj)
- Tudo fica no Postgres, schema "repasse", via DATABASE_URL (src/db.js do repo giroauto-repasse). Sem DATABASE_URL, usa PGlite local (data/pglite); na nuvem, nesse caso, só mostra a página de erro.
- fotos: 595 fotos em bytea (cerca de 121 MB); anuncios: 298; mensagens: 782; grupos: 115; contatos: 54; envios: 34; poucos registros em leads, conversas, compradores e contas (1).
- wa_auth: 12.899 linhas. É a sessão Baileys do WhatsApp do número particular, com o prefixo "c1:".
- kv: a configuração da conta fica em "config:1" (fontes, destino, redução de preço, filtros).
- Login: ADMIN_SENHA (acesso de desenvolvedor). A tabela usuarios está vazia. Cookies assinados com SESSAO_SEGREDO.
- Disco local só para temporários de vídeo (ffmpeg).
- Limpezas automáticas do próprio app: mensagens com mais de 4 dias; anúncios descartados, encerrados ou filtrados depois do prazo (padrão 48 h), junto com fotos e envios. Os vendidos nunca são apagados. Se o WhatsApp responder "loggedOut", toda a wa_auth da conta é apagada.

## Riscos de perda
| Nível | App | Risco |
|---|---|---|
| Alto | Loja/Fotos | Sobrescrita no deploy: o servidor novo restaura a cópia e envia de volta logo ao subir, enquanto o antigo ainda pode salvar alterações. O mesmo vale para o painel local rodando com as chaves do Render. |
| Alto | Repasse | Dois servidores com a mesma sessão do WhatsApp (serviço antigo + monorepo, ou dois servidores do monorepo no deploy): conexão derrubada e, se vier como "loggedOut", wa_auth apagada e novo pareamento pelo QR code. |
| Médio | Loja/Fotos | Queda brusca do container: perde até cerca de 2 min de alterações. A hibernação é segura, porque o servidor recebe SIGTERM e salva antes. |
| Médio | Loja/Fotos | Banco inteiro num arquivo só: uma gravação ruim troca tudo; para voltar, só há as 14 cópias diárias. |
| Médio | Loja/Fotos | Se SESSION_SECRET mudar, as conexões da Meta, do IMAP e do Repasse precisam ser refeitas. |
| Médio | Repasse | Cópia errada da wa_auth (incompleta ou sem o prefixo c1:) obriga a parear de novo pelo QR code. |
| Médio | Os dois | Espaço: num projeto só, cerca de 245 MB do limite free de 500 MB; as fotos são o que mais cresce. |
| Baixo | Repasse | ADMIN_SENHA é o único acesso; se mudar, o login do Fotos com o Repasse quebra. |
| Baixo | Repasse | As limpezas automáticas apagam dados de propósito; a cópia não deve contar com eles. |

## Regras da migração (obrigatórias)
- O serviço antigo giroauto-repasse e o monorepo NUNCA podem ficar conectados ao WhatsApp ao mesmo tempo.
- A cópia do schema repasse para o projeto giroauto é feita com o serviço antigo SUSPENSO.
- SESSION_SECRET, ADMIN_SENHA e wa_auth (com o prefixo c1:) são levados SEM NENHUMA alteração.
- O giroauto-repasse NÃO tem SESSAO_SEGREDO definido: o segredo dos cookies é derivado da ADMIN_SENHA. Não criar um SESSAO_SEGREDO no destino (isso derrubaria os logins).
- Variáveis atuais (só os nomes): giroauto = GIROAUTO_STORAGE_TOKEN, SUPABASE_KEY, SUPABASE_URL, META_API_VERSION, SESSION_SECRET, DATA_DIR, NODE_ENV; giroauto-repasse = ANTHROPIC_API_KEY, ADMIN_SENHA, DATABASE_URL, TZ_LOCAL.
- Fase 1: unificar código e banco mantendo os formatos atuais (SQLite em giro_private para Loja/Fotos, schema repasse com fotos em bytea).
- Fase 2 (depois): limpar o giro_private (13 mil registros removidos sem conteúdo) e tirar as fotos do Repasse de dentro do banco.

## Memória no Render (medido em 08/11/2026)
- Limite: 512 MB por serviço (plano free).
- Loja/Fotos: de 60 a 130 MB no uso normal, com pico de 450 MB em 02 e 03/11/2026.
- Repasse: cresce sem parar, de cerca de 100 MB para 340 MB em uma semana, com picos de 430 MB. Provável vazamento de memória.
- Juntos, hoje, não cabem com segurança num serviço só.

## Plano da migração (revisado em 08/11/2026)
1. Etapa 0: backup completo e números de referência.
2. Unificar SÓ O BANCO: schema repasse copiado para o projeto giroauto. Os dois serviços do Render continuam SEPARADOS (giroauto e giroauto-repasse); o giroauto-repasse só troca a DATABASE_URL.
3. Corrigir o vazamento de memória do Repasse.
4. Unificar os serviços só depois que os dois, medidos juntos, ficarem abaixo de 450 MB.
- Na etapa 2 continuam valendo: cópia com o serviço antigo suspenso, wa_auth sem nenhuma alteração e o projeto giroauto-repasse mantido (só pausado após validação).
- A proteção contra sobrescrita no deploy (Loja/Fotos) é independente e pode ser feita a qualquer momento.

## Decisão: Express no monorepo
- O monorepo vai usar o Express 5. A Loja sobe do Express 4 para o 5; o Repasse continua como está (Express 5, ESM).
- Motivos:
  - O Express 4 está em fim de vida; o 5 é a linha atual.
  - O 5 trata erros de rotas async sozinho, o que o Repasse já usa. Descer o Repasse para o 4 deixaria erros async sem tratamento.
  - A Loja não usa os recursos que mudaram no 5 (curingas "*", parâmetros opcionais com "?", redirect('back'), req.param()), então a troca é pequena.
- Como fazer:
  - A atualização da Loja para o Express 5 é um passo separado, com os testes, e vai para produção sozinha, antes da unificação dos serviços.
  - A Loja (CommonJS) monta o Repasse (ESM) com import() dinâmico, como um Router em /repasse.

## Fotos
- Geração 100% automática integrada à página
- Gerar ângulos novos quando houver poucas fotos (ex.: só uma)
- Provedor: Pollinations (crédito Pollen). Puter descartado.

## Repasse — regras de negócio
- Fontes: Carros a Venda (Marcelo Silva), Rodrigo João Pessoa, 01 | Casa das Ofertas, Asa Repasses, #5 Repasses Cascavel
- Destino: GiroAuto Repasse
- Vendas sempre à vista no PIX
- Redução automática opcional do valor a cada reenvio (passo e piso por anúncio)
- Número conectado é o particular: NADA de resposta automática nele

## Regras de trabalho
- Push na main = produção. Testar antes.
- Segredos só em variáveis de ambiente.
- Plano free hiberna após inatividade: cuidar da conexão do WhatsApp do Repasse.

## Ferramentas
- Rodar o SkillSpector (NVIDIA) antes de instalar qualquer skill ou plugin.
- Conectores MCP: Supabase, Render e GitHub.

## Fora do escopo por enquanto
- afiliados-ml, SaaS de agendamentos e demais projetos aguardam ordem do Darlan.
- Próximo projeto a migrar: gerador de documentos de aula do IFPR.

## Estado atual / Pendências
- Levantamento de dados concluído (ver "Onde estão os dados hoje").
- Migração ainda não iniciada: Repasse segue no serviço e no projeto antigos.
- Etapa 0 (backup) concluída em 08/11/2026: C:\Backups\giroauto\2026-11-08 (repasse.dump, SQLite da Loja + 12 cópias diárias, 367 fotos, variaveis.txt, relatorio-etapa0.txt). Todas as cópias passaram no PRAGMA integrity_check; a queda de tamanho das cópias depois de 28/10 foi só a compressão (o banco cresceu).
- Cliente PostgreSQL 17.11 em C:\Ferramentas\pgsql.
- Pendente antes da migração: proteção contra sobrescrita no deploy (Loja/Fotos) e trava de conexão única do WhatsApp (Repasse).
