# Histórico de versões do GiroAuto

A versão em uso aparece no rodapé do menu lateral do painel e em `/health`.

## v2.19.3 — 08/11/2026

- **Campanhas:** saiu o posicionamento "Explorar do Instagram", que a Meta descontinuou na API v25 (ela recusava a campanha com "O posicionamento Explorar do Instagram está obsoleto"). Campanhas salvas antes com ele marcado são criadas normalmente, sem esse posicionamento.

## v2.19.2 — 08/11/2026

- **Campanhas:** o quadro "Conta de anúncios" mostra o saldo da conta direto da Meta: saldo disponível (conta pré-paga, com o mesmo texto do Gerenciador de Anúncios) ou o valor a pagar (cartão), o limite de gastos restante e um atalho para adicionar saldo.
- **Repasse (v0.9.2):** carro enviado pela Loja sai no grupo com o preço de repasse exato definido na Loja; o acréscimo configurado no grupo destino vale só para carros de terceiros.

## v2.19.1 — 08/11/2026

- **Repasse sem segundo login:** o administrador logado no GiroAuto abre o Repasse pelo menu direto, sem a tela de login do Repasse, e a integração (Do Repasse, Enviar para a Fila) também dispensa o login. Usa um segredo compartilhado entre os dois serviços (GIRO_SSO_SEGREDO); o endereço próprio do Repasse continua com o login de sempre.
- **Menu lateral sem barra de rolagem:** sai o quadro da extensão (o status continua em Republicação e Configurações) e o nome da loja/usuário quando há logo; itens mais compactos em telas baixas.
- **Comando de voz** agora é o botão flutuante no canto inferior direito também no computador.

## v2.19.0 — 08/11/2026

Usabilidade e leveza (propostas da análise de 08/11):

- **Novo veículo mais rápido:** "+ Novo veículo" abre o cadastro curto (placa → busca automática → km → preço → fotos), no computador e no celular, com área para arrastar as fotos. O link "Formulário completo" leva o que já foi digitado.
- **Formulário completo mais curto (de ~4 para ~2 telas):** começa pelos dados do carro, tem uma só PLACA (a da busca) e as seções secundárias (proprietário, custos, destaques, gestão, arte) vêm recolhidas; o painel lembra quais você deixou abertas.
- **Menu em grupos:** Vender, Acompanhar, Documentos e Loja. "Primeiros passos" sai do menu quando as etapas principais estão concluídas (continua em Configurações).
- **Celular:** barra inferior com Estoque, CRM, Painel e "Mais" (menu completo); o botão de voz e os avisos sobem acima da barra.
- **Busca rápida:** botão "Buscar", Ctrl+K ou "/" acham carro (placa, modelo) ou cliente do CRM (nome, telefone) de qualquer tela.
- **Ações em lote no Estoque:** selecione vários carros e marque como pronto, republique, gere a arte ou marque como vendidos de uma vez.
- **Aviso de lead novo no celular:** no CRM, "Ativar avisos neste aparelho". Chega notificação quando um lead entra sozinho (site, QR, portais, assistente). No iPhone, com o GiroAuto instalado na tela de início.
- **Painel enxuto:** 4 indicadores principais (Vendidos, Lucro, Estoque, Parados) e o restante em "Mais indicadores"; nada mais cortado.
- **Correções visuais:** nomes das etapas do funil do CRM inteiros, tabela da Gestão com a 1ª coluna fixa ao rolar, cabeçalho do GiroAuto Fotos no celular.
- **Mais leve:** fotos reduzidas por padrão (lado maior 1600 px; uma foto de 9 MB vira ~300 KB) respeitando a rotação da câmera; miniaturas WebP de 400 px nas listas, na Gestão e na vitrine (cache só no disco do servidor, sem ocupar o Supabase); sharp sem cache e com 1 thread, MALLOC_ARENA_MAX=2 e canvas carregado só quando gera arte (a Loja sobe com ~50 MB); log de memória a cada 30 min.
- **Atualizações chegam na hora:** o painel e o service worker levam a versão da app, e o código do painel é sempre revalidado (o navegador não fica com versão antiga).

## v2.18.0 — 08/11/2026

- Integração com o GiroAuto Repasse (por ora só para o administrador do sistema):
  - **Do Repasse** (no Estoque): lista a Fila e os anúncios em circulação do Repasse e traz o carro para o estoque com fotos, dados, FIPE e valor de compra = preço de repasse (origem "Outra loja / repasse"). Não duplica: o que já veio aparece como "Já no estoque", e os carros que a própria loja mandou aparecem como "Da sua loja".
  - **Enviar para a Fila do Repasse** (em Divulgar > Grupo de repasse): manda o carro, com fotos e o preço de repasse definido na loja, para a Fila do Repasse, onde é conferido e aprovado antes de ir ao grupo. Fica registrado no histórico do carro.
  - Usa a sessão de quem entrou no Repasse pelo menu (ou a conexão do GiroAuto Fotos); sem ela, aparece o aviso com o link para entrar.

## v2.17.0 — 08/11/2026

- Repasse dentro do GiroAuto: novo item **Repasse** no menu lateral (por ora só para o administrador do sistema) abre o GiroAuto Repasse em `/repasse/`, com o mesmo login de sempre do Repasse e um botão "← GiroAuto" para voltar.
- O Repasse continua sendo um serviço separado no Render; a Loja só repassa as requisições de `/repasse/*` para ele, em streaming (sem guardar nada em memória), inclusive a atividade em tempo real. Se ele estiver ligando, aparece uma página que tenta de novo sozinha.

## v2.16.4 — 01/11/2026

- GiroAuto Fotos pela **Pollinations** agora usa o **Nano Banana 2 Lite** (Gemini 3.1 Flash-Lite Image, `google/gemini-3.1-flash-lite-image`) por padrão, no lugar do antigo "kontext": mais fiel ao carro, cerca de US$ 0,03 por foto. Envia todas as fotos de referência nos ângulos novos e o tamanho do formato escolhido. Mensagens claras para crédito esgotado e chave recusada (a Pollinations agora exige chave secreta `sk_`).

## v2.16.3 — 01/11/2026

- GiroAuto Fotos: o botão **Entrar no Puter e gerar** aparece assim que a página percebe que falta entrar; "Refazer" some enquanto a foto está sendo gerada na página; aviso para manter a aba aberta.

## v2.16.2 — 01/11/2026

- **GiroAuto Fotos automático, sem chave de IA**: nova opção **Gemini direto nesta página (conta Puter)** em "Como gerar" (e padrão quando o painel não tem chave de IA). A própria página gera as fotos com o Gemini (Nano Banana) pelo Puter.js e envia o resultado ao GiroAuto, duas fotos por vez, sem copiar, baixar ou colar nada. Na primeira vez o Puter pede para entrar (conta grátis, com uso mensal gratuito; depois, recarga na própria conta Puter). Basta manter a aba aberta até terminar.
- Quando a cota ou o crédito da IA do servidor acaba, as fotos que faltam continuam sozinhas pela página (antes passavam para o modo manual).

## v2.16.1 — 01/11/2026

- **GiroAuto Fotos grátis pelo app do Gemini**: em "Como gerar", escolha **Grátis pelo app do Gemini**. Cada foto tem 3 botões: **Copiar texto e baixar foto** (para ângulos novos baixa as fotos de referência), **Abrir o Gemini** e **Enviar imagem**. Também dá para colar a imagem com Ctrl+V na tela do ensaio. Funciona com uma conta Google gratuita (o app tem limite diário) e também no ChatGPT.
- **Quando a cota ou o crédito da IA acaba** (Pollinations, Google), as fotos que faltam passam sozinhas para o modo grátis pelo app, com o texto pronto, em vez de dar erro.
- Mensagem da Pollinations atualizada: o crédito grátis que renovava a cada hora foi encerrado pela Pollinations em julho/2026; agora o uso é com crédito (Pollen) comprado.

## v2.16.0 — 01/11/2026

- **GiroAuto Fotos, dentro do GiroAuto** (endereço `/fotos`, item **Fotos com IA** no menu e **Mais > Ensaio de fotos com IA** em cada carro). Usa o mesmo login, o mesmo banco, o mesmo armazenamento de fotos (Supabase) e a mesma chave de IA de Configurações > Imagens com IA. Nada novo para criar no Render ou no Supabase.
- **Ensaio fotográfico com IA**: 7 a 10 fotos do carro em um de 8 cenários (estacionamento com cidade, natureza, coberto premium, showroom, arquitetura moderna, estrada cênica, estúdio fundo infinito, noturno urbano) ou **personalizado** (texto e foto do pátio ou da fachada da loja). Formatos 4:5, 1:1, 9:16, 4:3 e 16:9, resolução padrão ou alta, placa mantida, borrada ou com o nome da loja.
- **Ângulos novos**: com poucas fotos (até uma só), a IA cria os ângulos que faltam (frente 3/4, traseira 3/4, lateral, frente, traseira, detalhes) a partir das fotos enviadas. Interior só é criado se houver ao menos uma foto real do interior. Essas fotos vêm marcadas "IA: …" para conferir.
- **Revisão**: aprovar, descartar ou refazer com um pedido ("mais luz"), com a foto original ao lado e nota de fidelidade (0 a 10) feita pela IA de texto.
- **Arte com as informações do veículo** (mesmo padrão da arte com preço) para cada ensaio, em 4:5 e em stories 9:16, refeita sozinha quando preço, selos ou contato mudam. A arte com preço também aceita os formatos 9:16 e 1:1.
- **Baixar** cada imagem ou o ZIP (fotos aprovadas, artes e texto do anúncio). As fotos aprovadas podem ir direto para as fotos do carro no estoque.
- **GiroAuto Repasse**: quem entra com o login do Repasse (ou conecta o Repasse estando na loja) faz ensaios dos anúncios da fila e em circulação, pela API do Repasse (`REPASSE_URL`, padrão `https://giroauto-repasse.onrender.com`).
- Modo manual (texto pronto para o ChatGPT ou o Gemini e envio da imagem), limite diário de imagens por loja e geração em segundo plano.

## v2.15.4 — 28/10/2026

- **Economia de banda (plano gratuito do Render, 5 GB/mês)**: o servidor estava enviando o banco inteiro ao Supabase a cada minuto, porque cada consulta da extensão gravava o "último acesso". Agora o último acesso da extensão e dos usuários, e a hora do check de e-mail sem mensagens novas, não disparam cópia — vão junto na próxima alteração de verdade ou no desligamento.
- **Cópia do banco comprimida** (gzip) e no máximo uma a cada 2 minutos (espera 10 s sem alterações, até 60 s). Cópias antigas sem compressão continuam sendo restauradas. Cópias diárias guardadas por 14 dias.
- **Respostas comprimidas** (gzip) para o painel, a API e as páginas.
- **Painel**: a atualização automática passou de 20 s para 30 s e pausa com a aba em segundo plano; ao voltar à aba, atualiza na hora.

## v2.15.3 — 22/10/2026

- **Painel**: saíram o aviso de pós-venda em "Onde atuar agora" e o quadro "Pós-venda hoje" (os contatos de pós-venda continuam em Gestão > Contatos).
- **Documentação**: nova sequência — Outro → Aguardando preenchimento → ATPV-e preenchido → Assinado → Entregue ao comprador → Comunicação de venda realizada → Transferência concluída. Em "Outro" aparece o campo de observação (obrigatório). A documentação só conta como concluída em "Transferência concluída". Etapas antigas foram convertidas (Vistoria → Assinado, Em transferência → Comunicação de venda, Não se aplica → Outro com a observação "Não se aplica").
- **CRM**: quando o lead passa da etapa "Visita agendada" (Visitou, Proposta, Vendido, Perdido ou Arquivado), as visitas que estavam marcadas saem da Agenda e do Painel sozinhas (visita até hoje conta como feita; futura é cancelada), com registro no histórico do lead.
- **CRM: etapa Arquivado** no fim do funil, só como ícone 🗄 com a contagem. Arraste o card para lá e ele sai da tela; clique no ícone para ver a lista dos arquivados e, se quiser, devolver um lead ao funil.

## v2.15.2 — 22/10/2026

- **Voz: oferta e preço.** "Ajuste uma oferta no valor de 34500 para a Ecosport", "tira a oferta do Jetta", "muda o preço do Gol para 45 mil". Respeita a permissão de preços e não deixa a oferta ficar maior que o preço.
- **Voz mais rápida.** Os comandos comuns (pátio/oficina, serviço pronto, incluir preparação, conta paga, oferta e preço) são entendidos na hora, sem esperar a IA; ela só entra nas frases diferentes, começando pelo modelo mais rápido.
- **Resposta falada e "Fazer direto".** O GiroAuto fala o que entendeu e o que fez. Marque **Fazer direto** na janela do microfone para executar sem o toque de confirmação (para usar com as mãos ocupadas).
- **CRM e Painel com a mesma visita.** A visita é um compromisso, e a etapa mostra até onde a negociação chegou: o lead continua num card só, na sua etapa. No funil aparece a faixa **Visitas de hoje** (horário, nome e etapa) e o selo do card fica em destaque ("📅 hoje 16:30"); no Painel, cada visita mostra a etapa do lead. Lead marcado como perdido ou vendido tem as visitas futuras canceladas automaticamente, com registro no histórico.
- **Siri mais fácil.** O atalho agora tem 3 ações (Ditar Texto, Obter Conteúdo do URL com o link pronto, Falar Texto), sem cabeçalhos nem JSON, e o painel tem um campo para testar a chave sem o iPhone.

## v2.15.1 — 22/10/2026

- **Correção do comando de voz**: quando a IA do Google não respondia, aparecia "Erro interno no servidor". Agora o GiroAuto tenta todos os modelos disponíveis e, se a IA estiver fora do ar ou lenta, entende sozinho os comandos mais comuns (carro no pátio ou na oficina/parceiro, serviço pronto, incluir preparação, conta paga), identificando o carro por modelo, ano, cor ou placa. Se houver dois carros parecidos, ele pergunta qual. Quando não dá para entender, mostra uma mensagem clara em vez do erro.
- **Alexa**: em Configurações > Minha conta > Comandos de voz, o botão **Configurar a Alexa** gera o pacote da skill (modelo de interação e código, já com a chave) e mostra o passo a passo no console da Amazon. Funciona nos Echo da sua conta sem precisar publicar a skill.
- Chaves de voz por aparelho (Siri, Alexa): cada uma aparece na lista com a data de uso e pode ser desativada sozinha.

## v2.15.0 — 22/10/2026

- **Preparação e custos numa lista só.** O quadro **Entrada, preparação e custos** do cadastro do carro substitui as listas "Manutenções e custos já feitos" e "Custos previstos" da Gestão do veículo. Cada item tem descrição, categoria, situação (a fazer, em andamento ou feito), valor, prazo/data e parceiro. Item a fazer com valor é custo previsto; ao marcar ✓ vira custo realizado. O lucro previsto da Gestão do veículo usa essa lista. A mesma lista aparece em Gestão > Estoque e margem (Abrir), no selo 🔧 do Estoque, em Gestão > Acompanhamento e no quadro Preparação do Painel, com editar, iniciar, marcar como feito e excluir. Os custos lançados antes desta versão foram trazidos para a lista automaticamente.
- **Comandos de voz.** Botão 🎤 (no menu lateral no computador e no canto da tela no celular): fale o que aconteceu, por exemplo "o Jetta 2013 preto ficou pronto na oficina e está no pátio", "inclua na Ecosport 2009 alinhamento e balanceamento" ou "a conta de energia foi paga". A IA entende, o GiroAuto confere o carro, o item e a conta, mostra o que vai fazer e executa com um toque em Confirmar. Também dá para digitar.
- **Siri (Atalhos do iPhone) e outros assistentes:** em Configurações > Minha conta > Comandos de voz, gere a chave pessoal e siga o passo a passo para o atalho "GiroAuto". Pela Siri o comando é executado direto, e ela fala o que foi feito (ou pergunta quando houver dúvida, como dois carros parecidos).

## v2.14.0 — 22/10/2026

- **Cartão CNPJ lido sozinho**: no formulário de implantação, o dono anexa o Cartão CNPJ (PDF do site da Receita ou foto) logo no item "1. Empresa" e os campos se preenchem na hora (razão social, nome fantasia, CNPJ, endereço, cidade, UF, CEP, telefone, e-mail e representante legal pelo quadro de sócios). O GiroAuto lê o texto do PDF, usa a IA para fotos e completa com a base pública da Receita. Ao enviar, só o que ficou em branco é preenchido na loja, nos dados para contratos e nas respostas. No guia Primeiros passos aparece a situação na Receita, os sócios e o botão **Ler o Cartão CNPJ de novo**. Cartões já enviados (como o da Garage45) são lidos sozinhos.
- **CRM**: o funil inteiro (8 etapas) cabe na tela, sem barra de rolagem lateral, com cards mais compactos.
- **Preparação dos carros**: anote o que precisa arrumar antes de vender (repintar para-choque, trocar lâmpada, costurar banco…), no cadastro do carro ou depois, um item por linha. A categoria é escolhida pela descrição; dá para pôr prazo e custo previsto (que entra nos custos do carro como previsto e vira realizado quando o item é feito). Os itens aparecem no selo 🔧 do carro no Estoque, em Gestão > Acompanhamento (quadro Preparação) e no Painel (quadro Preparação), com marcar como feito em um clique.
- **Carros em avaliação**: em "+ Novo veículo" escolha **Estoque** ou **Em avaliação** (ou use o botão **+ Avaliação** no Estoque). O carro em avaliação aparece na lista marcado, fora da vitrine, das publicações, das campanhas e dos números do estoque. Comprou? **Passar para o estoque** com um clique.

## v2.13.3 — 16/10/2026

- **Primeiros passos > Formulário para o dono da loja**: gere um link e mande por WhatsApp. O dono preenche pelo celular, sem login, os dados da empresa como no Cartão CNPJ, horários, regras de atendimento (troca, financiamento, garantia, laudo, entrega), vendedores, portais e redes, e envia o logo e os documentos. O GiroAuto aplica as respostas na loja, nos dados para contratos, no CRM e nas regras do assistente (sem apagar o que já foi escrito).
- Os documentos enviados (Cartão CNPJ, comprovante de endereço, contrato social) ficam privados e servem para a verificação da empresa na Meta.
- **Criar acessos** dos vendedores informados no formulário, com senha provisória mostrada uma vez.

## v2.13.2 — 16/10/2026

- Vitrine: os carros fora do filtro agora somem da tela, não só da contagem.

## v2.13.1 — 16/10/2026

- Vitrine: o botão de fechar os filtros só aparece no celular, e o espaçamento dos cards foi ajustado.

## v2.13.0 — 16/10/2026

- **Gestão > Contatos: excluir contato.** Para excluir um contato, use o botão **Excluir contato** na ficha ou em Editar. Para excluir vários de uma vez, marque os contatos na lista e clique em **Excluir (N)**. Sempre há confirmação. O contato sai da lista e dos envios de mensagem, e as anotações são apagadas. Carros, vendas e leads ligados a ele continuam. Parceiros, donos e compradores excluídos não voltam sozinhos na sincronização; o contato só reaparece se a pessoa virar lead de novo ou for cadastrada à mão.
- **Vitrine da loja com menu de filtros** à esquerda (no celular, pelo botão **Filtros**). Os filtros são: busca, marca, categoria (SUV, sedã, hatch…), faixa de preço ou preço mínimo e máximo, diferenciais (perícia aprovada, perícia premium, único dono, IPVA pago, garantia, aceita troca, financiamento, blindado…), ano, quilometragem, câmbio e combustível. A vitrine também ordena por mais recentes, menor ou maior preço, menor km ou mais novos. Só aparecem as opções que existem no estoque, com a quantidade ao lado. O endereço guarda os filtros, então dá para mandar ao cliente o link já filtrado (ex.: `/v/loja?cat=suv&faixa=70000-100000`). Os cards mostram até dois selos (perícia, único dono, IPVA pago, garantia).
- **Gestão > Pendências**: acompanhamento de multas, IPVA atrasado, licenciamento, restrição judicial (Renajud), gravame, restrição administrativa, bloqueio de furto/roubo, recall, vistoria, documentos e outras pendências, nos carros em estoque ou já vendidos. Cada pendência tem valor, vencimento, responsável (loja, antigo dono, comprador, consignatário, despachante), situação e histórico. A aba mostra os indicadores (em aberto, vencidas, vencem em 7 dias, valor em aberto, resolvidas em 30 dias) e filtros por situação, tipo e carro. No Estoque, o carro ganha o aviso "⚠ N pendências" (vermelho se alguma venceu), e o menu **Mais** de cada carro tem **Registrar pendência**.

## v2.12.1 — 16/10/2026

- Guia: os botões "Abrir…" agora chegam na aba certa de Configurações e do CRM, como WhatsApp, Publicação e Portais.

## v2.12.0 — 16/10/2026

- **Primeiros passos**: novo item no topo do menu, para o dono e para quem configura, com o guia completo de configuração de uma loja nova. Cobre o cadastro e o login, os dados da loja e o logo, a equipe, o estoque, o Marketplace (modo assistido ou com a extensão), Facebook e Instagram para campanhas, o catálogo, o Instagram, o WhatsApp oficial (12 passos, do portfólio ao modelo de mensagem), o assistente do site, os leads dos portais por e-mail e a configuração da plataforma pelo administrador. Cada etapa diz para que serve, o endereço exato de cada site, os botões a clicar e os erros comuns com a solução. A etapa marca "Concluído" sozinha quando fica pronta, e uma barra mostra o progresso. Tem os botões "Abrir tudo" e "Imprimir" e leva direto à aba certa de Configurações ou do CRM.
- Atalho **📘 Guia de configuração** no topo de Configurações.
- **Estoque**: botão **Vitrine da loja** ao lado de Importar planilha e Painel TV. Abre o site público da loja, o link para mandar aos clientes.

## v2.11.6 — 15/10/2026

- Verificação do número do WhatsApp: quando a Meta recusa, a mensagem agora traz o detalhe e o código do erro enviados por ela, para saber o que corrigir.

## v2.11.5 — 15/10/2026

- **WhatsApp: verificar o número sem sair do GiroAuto.** Em Configurações > WhatsApp aparece o quadro **Verificar o número na Meta** enquanto o número estiver "não verificado": **Pedir código** (SMS ou ligação), digitar o código e **Confirmar**. O GiroAuto confirma o código e registra o número na API da Meta sozinho, com um PIN de 6 dígitos guardado criptografado. Se o número já estiver verificado e só faltar o registro, aparece **Registrar número**.
- Correção: salvar o quadro **WhatsApp automático** apagava a conta do WhatsApp Business (WABA), a inscrição e a chave do app guardadas pelo assistente. Agora esses dados são mantidos.

## v2.11.4 — 15/10/2026

- **WhatsApp automático**: ao salvar, o GiroAuto confere o token e o ID do número na Meta e mostra o motivo se estiverem errados, em vez de salvar um token inválido. Também tira espaços e um "Bearer" colado junto.
- Com o token válido, o **assistente no WhatsApp é ativado na hora**: webhook, conta do WhatsApp Business e assistente ligado, sem outro passo.

## v2.11.3 — 15/10/2026

- Ativação do WhatsApp: a conta do WhatsApp Business (WABA) agora também é descoberta pelas empresas ligadas ao token (escolhendo a que tem o número da loja), e a mensagem de erro mostra o motivo dado pela Meta.

## v2.11.2 — 15/10/2026

- Ativação automática (uma vez) do assistente no WhatsApp para as lojas que já têm a API oficial configurada: ao iniciar, o servidor faz o mesmo que o botão "Ativar recebimento" e registra o resultado.

## v2.11.1 — 15/10/2026

- **WhatsApp: ativação em um clique.** O botão **Ativar recebimento** agora faz tudo sozinho pela API da Meta:
  - descobre a conta do WhatsApp Business (WABA) pelo token;
  - configura o webhook de mensagens no app da Meta do GiroAuto (URL, token de verificação e o campo "messages");
  - inscreve a conta no app e liga o assistente.
- A configuração manual fica guardada num "Configuração manual", para números que estão em outro app da Meta.

## v2.11 — 15/10/2026

**Assistente responde no WhatsApp**

- As mensagens que chegam no número da loja (API oficial do WhatsApp) são respondidas pelo mesmo assistente de vendas do site:
  - já sabe o número do cliente (não pede o WhatsApp) e usa o nome do perfil como ponto de partida;
  - manda as **fotos dos carros** como imagens, com legenda (modelo, ano, km, preço e link);
  - entende **áudios** (transcrição com a IA), e registra fotos e documentos que o cliente envia;
  - cria/atualiza o lead no CRM (origem "WhatsApp"), agenda e remarca visitas;
  - marca as mensagens como lidas.
- **Vendedor assume**:
  - na ficha do lead aparece a conversa do WhatsApp, com uma caixa para **responder pela API**;
  - ao responder, o assistente pausa naquela conversa por 12 horas;
  - também há botões para pausar o assistente ou devolver a conversa para ele;
  - quando o cliente pede um atendente, o assistente pausa e o lead fica marcado como "pediu atendente".
- Com o assistente desligado no WhatsApp, as mensagens continuam entrando no CRM (lead novo ou histórico do lead), sem resposta automática.
- **Configurações > WhatsApp > "Assistente responde os clientes"**:
  - passo a passo com a URL do webhook e o token de verificação para o app da Meta;
  - ID da conta do WhatsApp Business (WABA) e botão **Ativar recebimento** (inscreve a conta no app);
  - chave do app opcional, para números em outro app da Meta;
  - opção ligar/desligar.
- Segurança: o webhook confere a assinatura da Meta (X-Hub-Signature-256) e ignora mensagens repetidas.
- **CRM**: ícone do WhatsApp ao lado do nome em cada card, que abre a conversa direto com a mensagem pronta.
- **Painel**: os quadros se encaixam em colunas, sem espaços vazios entre eles.

## v2.10.3 — 15/10/2026

- **Painel**: novo quadro **Visitas** com as de hoje e as dos próximos 7 dias (horário, cliente, tipo, carro e vendedor, com a situação: confirmada, veio, faltou). Visitas do dia também entram em "Onde atuar agora". Clicar no cliente abre o lead; "abrir" leva para CRM > Agenda.
- **Assistente do site e CRM**:
  - o lead é criado assim que o cliente diz o nome, mesmo antes do WhatsApp, e a conversa já aparece no CRM;
  - agendamento feito sem WhatsApp entra na agenda e o assistente pede o WhatsApp para confirmar; nunca diz "confirmado" sem ele;
  - **remarcar** ("pode ser às 10h?") muda a mesma visita, em vez de ignorar ou criar outra;
  - quando o cliente usa um telefone que já tem lead em aberto, a conversa entra nesse lead com o aviso "cliente se apresentou como …";
  - o WhatsApp informado depois é gravado no lead.

## v2.10.2 — 15/10/2026

- **Assistente do site mais estável.** O modelo de IA do Google estava sobrecarregado ("high demand") e, nesse caso, o assistente caía no roteiro e repetia "me passa seu WhatsApp". Agora:
  - se um modelo estiver sobrecarregado, lento ou indisponível, tenta outros modelos do Google (2.5 Flash, Flash mais recente, Flash-Lite) e faz uma segunda rodada antes de desistir;
  - cada tentativa espera no máximo 15 s, com resposta mais rápida (sem "raciocínio" longo no 2.5 Flash);
  - se mesmo assim a IA não responder, avisa a instabilidade e oferece o WhatsApp de um consultor, sem repetir o roteiro.
- No modo roteiro, depois de pedir o WhatsApp duas vezes, o assistente oferece o contato direto com um consultor em vez de insistir.

## v2.10.1 — 15/10/2026

- **Horário**: datas e horas gravadas pelo sistema (histórico do lead, conversas, e-mails processados) agora aparecem no horário de Brasília (antes, 3 horas à frente). O "hoje" do sistema (contratos, painel, despesas, resultados, CRM) também segue Brasília, inclusive depois das 21h.
- **CRM > Agenda**: botão 🗑 para **excluir o agendamento**. Fica registrado no histórico do lead; se não sobrar visita marcada, o lead volta para "Em atendimento".
- **Configurações em abas**: Loja e equipe · Publicação e fotos · WhatsApp · Minha conta · Sistema (administrador). Os painéis da aba se distribuem em colunas.
- **Configurações > Sistema > Inteligência artificial** (administrador do sistema):
  - **chave própria para o assistente de vendas e a leitura de e-mails**, que pode ser do plano gratuito do Google AI Studio, com passo a passo e botão **Testar**;
  - na mesma tela, a escolha de como gerar as fotos no estacionamento (à mão, Pollinations ou Gemini pago). O antigo painel "Imagens com IA" não estava aparecendo.
- No CRM, o aviso de "modo roteiro" ganhou o botão **Configurar a IA agora**.
- Menu lateral mais compacto (botões menores).

## v2.10 — 15/10/2026

**Assistente de vendas com IA no site e leads dos portais por e-mail**

- **Assistente no site da loja**: botão "Fale com a gente" na vitrine e "Dúvidas sobre este carro?" em cada carro.
  - Responde na hora, 24h, com base no estoque e nas informações da loja.
  - Mostra os carros com fotos (toque para ampliar) e manda todas as fotos quando o cliente pede.
  - Abordagem de vendedor: qualifica (uso, faixa de preço, troca, pagamento), oferece alternativas quando o carro procurado não existe e conduz para **agendar a visita ou o test-drive**.
  - Pega **nome e WhatsApp**: a conversa vira lead no CRM (origem "Assistente do site"), com orçamento, troca, forma de pagamento e temperatura. A conversa inteira fica na ficha do lead.
  - **Agenda a visita** no CRM quando o cliente confirma dia e horário.
  - **Passa para um vendedor**: quando o cliente pede, mostra o botão do WhatsApp da loja e marca o lead com "pediu atendente".
  - Regras de segurança: não inventa carros, preços ou condições; não promete aprovação de financiamento; fala só da loja e dos carros.
  - Sem chave de IA, ou se a IA falhar, segue um roteiro que ainda captura nome e WhatsApp.
- **CRM > 🤖 Assistente do site**:
  - ligar ou desligar o assistente, com nome e boas-vindas;
  - campo **"Informações e regras da loja"** (troca, financiamento, garantia, laudo, entrega…) que o assistente segue;
  - opção de informar ou não os preços;
  - **testar o assistente** como cliente, sem salvar nada no CRM;
  - lista das conversas recentes.
- **Leads dos portais por e-mail** (CRM > ✉️ Portais): Webmotors, OLX, iCarros, Mobiauto, Mercado Livre, NaPista e outros.
  - **Leitura automática da caixa de e-mail** (IMAP, com passo a passo para senha de app do Gmail) a cada 3 minutos, com teste de conexão e "ler agora".
  - **Endereço de webhook** para serviços de encaminhamento (Cloudflare, Mailgun, Postmark, SendGrid, Zapier/Make).
  - **Colar o e-mail**: mostra o que foi encontrado e cria o lead.
  - Extrai nome, telefone, e-mail, mensagem e o carro do anúncio (pela placa ou por marca/modelo/ano no estoque). Para formatos desconhecidos, a IA ajuda.
  - Não duplica: o mesmo e-mail não entra duas vezes e o mesmo telefone vai para o lead em aberto. Lista dos e-mails processados.

## v2.9 — 15/10/2026

**CRM de leads**

- Novo item **CRM** no menu, com um contador de leads novos (fica vermelho quando há lead sem resposta).
- **Funil em colunas**:
  - etapas: Novo → Em atendimento → Qualificado → Visita agendada → Visitou → Proposta → Vendido / Perdido;
  - arraste o card para mudar de etapa;
  - o card mostra o carro de interesse com foto, a origem, a temperatura (🔥🌤️❄️), o vendedor, a próxima visita, a próxima tarefa e o alerta de "sem resposta";
  - busca por nome, telefone, carro ou placa, com filtros por origem, vendedor e "só os meus".
- **Ficha do lead**:
  - dados do cliente, carro de interesse, o que procura, orçamento, forma de pagamento, carro na troca, origem, vendedor e observações;
  - botões de WhatsApp (mensagem pronta citando o carro) e de ligar, que ficam registrados no histórico;
  - histórico completo: criação, novos contatos, anotações, propostas, mudanças de etapa, repasses, visitas e tarefas;
  - atalhos para agendar visita, criar tarefa, gerar contrato e marcar perdido (com motivo).
- **Agenda**: visitas, test-drives, avaliações da troca e entregas, por dia. Tem botão de WhatsApp com a mensagem de confirmação pronta e a situação: confirmada, compareceu, não compareceu ou cancelada. "Compareceu" move o lead para "Visitou".
- **Tarefas**: retornos com prazo e responsável, separados em atrasadas, hoje e próximas.
- **Relatório** (gestão): leads, vendas, conversão, tempo médio da 1ª resposta e visitas agendadas × realizadas, por origem e por vendedor, além dos motivos de perda.
- **Distribuição**: rodízio automático entre os vendedores escolhidos, ou manual (quem atender primeiro assume). O tempo do alerta "sem resposta" e o horário de atendimento são configuráveis.
- **Vendedor** vê só os próprios leads e os sem dono; quem tem acesso à gestão vê todos e repassa leads entre vendedores.
- **Captação**:
  - formulário "Tenho interesse" na página de cada carro e "Não achou o que procura?" na vitrine;
  - quem chega pelo **QR code da folha A4** entra com a origem "QR code no carro";
  - o mesmo telefone não duplica: o novo contato entra no lead em aberto;
  - o cliente vira **Contato** com o papel "Interessado", e o lead aparece no histórico do contato.
- **Venda**: ao marcar o carro como vendido, o lead em aberto com o telefone do comprador vai para "Vendido".

## v2.8.1 — 15/10/2026

- **Configurações > Dados da loja para contratos**: razão social, CNPJ, representante legal e CPF, endereço para o contrato e foro. Esses dados entram em todos os contratos e continuam editáveis em cada um; o que for alterado no contrato também fica salvo.
- No contrato, o bloco **🏢 Dados da loja** aparece aberto e com aviso enquanto faltar razão social, CNPJ ou representante.
- Novo modelo **Compra e venda entre particulares**, para carro em nome de pessoa física (consignado, de parceiro ou ainda não transferido):
  - o contrato é entre o proprietário (vendedor) e o comprador, regido pelo Código Civil;
  - a loja entra como interveniente intermediadora (cláusula marcada por padrão; desmarcando, a loja sai do contrato e das assinaturas);
  - cláusulas opcionais: garantia dada pela loja, quitação do financiamento do vendedor, financiamento do comprador, laudo, leilão, sinistro e multa;
  - puxa do carro o proprietário, o comprador, o valor e a remuneração da loja (margem ou diferença para o repasse).
- Ao gerar a compra e venda da loja para um carro que está em nome de terceiro, aparece o aviso com o botão para trocar para o modelo entre particulares.

## v2.8 — 15/10/2026

**Contratos e termos**

- Nova aba **Contratos** no menu, com 11 modelos prontos:
  - compra e venda ao consumidor final (com a garantia legal de 90 dias do CDC);
  - venda para lojista (repasse, no estado, sem garantia);
  - consignação (contrato estimatório);
  - compra pela loja ou recebimento na troca;
  - recibo de sinal e reserva;
  - termo de entrega e ciência;
  - autorização e responsabilidade para test-drive;
  - termo aditivo;
  - recibo de pagamento;
  - termo de garantia contratual;
  - distrato.
- **Preenchimento automático:**
  - os dados da loja vêm preenchidos e podem ser editados (razão social, CNPJ e representante ficam salvos para os próximos contratos);
  - escolhendo o carro, entram os dados do veículo (placa, Renavam, chassi, km), do comprador, o valor, a forma de pagamento (entrada, troca, financiamento, boletos), a troca e o financiamento;
  - na consignação entram o dono, o repasse e a margem; na compra pela loja entram quem vendeu e o valor;
  - CPF, RG e endereço de um cliente que já teve contrato são reaproveitados;
  - valores saem por extenso.
- **Cláusulas com caixinha:**
  - as usuais já vêm marcadas;
  - as específicas ficam desmarcadas, como troca, quitação do financiamento da troca, financiamento, parcelamento próprio, reserva de domínio, sinal, laudo cautelar, leilão, sinistro, uso em frota, chassi remarcado, quilometragem, serviços, acessórios, recall, IPVA, consignado, venda fora da loja, seguro e multa;
  - ao marcar uma específica aparecem os campos dela;
  - o texto de qualquer cláusula pode ser editado só naquele contrato, e dá para incluir cláusula avulsa.
- **Prévia ao vivo** do documento. Campo vazio vira linha em branco para preencher à mão.
- Página de impressão A4 com logo, cláusulas numeradas, assinaturas e testemunhas, para imprimir ou salvar em PDF.
- **Histórico** dos contratos emitidos, com busca, abrir/editar, copiar para um novo, imprimir e excluir.
- **Editar modelo** (quem tem acesso a Configurações):
  - mudar nome, título e texto;
  - escolher o que vem marcado;
  - reordenar, remover ou criar cláusulas;
  - lista de campos para usar no texto;
  - duplicar para criar modelos da loja;
  - restaurar o padrão.
- Botão **📄 Contrato** no resumo de cada veículo.
- Os textos-base seguem o CDC, o Código Civil, o CTB e a LGPD. São modelos de apoio: cada loja deve revisá-los com o seu advogado.

## v2.7 — 15/10/2026

**Acesso do desenvolvedor e canal de sugestões e erros**

- **Sugestões e erros** (link no rodapé do menu, para todos os usuários): informar erro/problema, melhoria, nova funcionalidade, dúvida ou outro, com resumo, detalhes e a tela. A versão e o navegador vão junto. Cada loja vê o que já enviou, a situação e a resposta do desenvolvedor.
- **Desenvolvedor** (item do menu visível só para o administrador do sistema):
  - Indicadores gerais: lojas (novas e ativas em 7/30 dias), usuários e acessos, veículos, vendas e faturamento em 30 dias, publicações e falhas da extensão, extensões ativas, lojas com Meta, contatos, mensagens e apontamentos abertos.
  - **Lojas**: tabela com dono, cadastro, último acesso, usuários, estoque, publicados, vendas e faturamento em 30 dias, extensão, Meta, contatos e apontamentos; cada loja abre um detalhe com usuários (último acesso), extensão, apontamentos e atividade.
  - **Sugestões e erros**: caixa de entrada com filtros por situação e tipo; definir situação (novo, em análise, planejado, em desenvolvimento, feito, não será feito), prioridade e responder para a loja.
  - **Atividade**: novas lojas, veículos e vendas por mês e a atividade recente de todas as lojas.
- O último acesso de cada usuário passa a ser registrado.

## v2.6.2 — 14/10/2026

- **Lucro das vendas com troca**: passa a entrar nos Resultados, DRE e Painel **na data da venda** (decisão da loja). Não há lucro em dobro: o carro da troca entra no estoque com custo igual ao valor dado na troca, e na venda dele só a diferença vira lucro. Resultados mostram "Trocas no estoque" (carros recebidos na troca ainda à venda) como informação.
- **Republicação > Não concluídas**: botões **Deu certo** (o anúncio está no ar: tira da lista e marca o carro como publicado) e **Dispensar**.
- **Painel**: os indicadores do topo ficam em **uma única linha** no computador, com valores grandes abreviados (ex.: R$ 106 mil; o valor exato aparece ao passar o mouse).

## v2.6.1 — 14/10/2026

- **Correção nas campanhas de catálogo**: com um único veículo (ex.: só o Jetta), a Meta recusava o anúncio com "(#194) param child_attachments has too few elements", porque o modelo era sempre carrossel e o carrossel exige ao menos 2 veículos. Agora, com 1 veículo, o anúncio vai como **imagem única** apontando para a página do carro; com 2 ou mais, continua em carrossel.

## v2.6 — 14/10/2026

- **Carro na troca**: a lista da venda agora inclui também os carros vendidos nos últimos 30 dias (marcados como "vendido"). Vendidos há mais de 30 dias ficam de fora.
- **Visual mais compacto** em todas as telas: menu lateral mais estreito com botões menores, títulos, caixas, campos, botões, tabelas, indicadores e janelas com menos espaço sobrando, sem perder a leitura.
- **Menu lateral**: o item "Novo veículo" saiu do menu; o botão continua dentro de Estoque (e o Estoque fica marcado ao cadastrar ou editar um carro).
- **Editar veículo reorganizado em duas colunas** que usam toda a largura: à esquerda Dados do veículo, Proprietário e documentação e Destaques; à direita Fotos (com Onde anunciar na mesma caixa), Gestão do veículo e Imagem para divulgação (menor). A venda (carros vendidos) fica embaixo, na largura toda. Os botões Salvar ficam sempre visíveis no rodapé. No celular, os campos curtos ficam dois por linha.

## v2.5 — 14/10/2026

**Venda com troca sem lucro duplicado, pagamento combinado (à vista + troca + financiamento + boleto) e logo da loja**

- **Venda com troca**: escolha o carro da troca na lista do estoque ou cadastre na hora (marca, modelo, ano, placa). Ele entra no estoque como compra pelo valor dado na troca, com origem "Troca", comprado de = comprador, e fica ligado ao carro vendido.
- **Lucro realizado em cadeia**: o lucro de uma venda com troca fica **a realizar** e só entra nos Resultados/DRE quando o carro da troca for vendido sem nova troca; aí toda a cadeia é realizada junta. Resultados mostram "Lucro a realizar" e quais vendas aguardam a troca. Assim o lucro não é contado duas vezes.
- **Pagamento combinado**: à vista (PIX, dinheiro, cartão), carro na troca, **financiamento** (banco, valor financiado, parcelas, valor da parcela e **retorno da financeira**, que entra na receita do carro) e **boleto/promissória** (quantidade e valor), em qualquer combinação. O total é a soma das partes.
- **Gestão do veículo**: campo **WhatsApp de quem vendeu** o carro para a loja (vira contato "Vendeu carro à loja").
- **Estoque**: filtro por propriedade (loja, consignado, parceria…) e por origem da compra.
- **Gestão > Estoque e margem**: foto da capa ao lado de cada carro; em consignado/parceria/outro aparece o nome do dono com link para o WhatsApp; carros que entraram na troca têm o selo 🔁.
- **Logo da loja** (enviado em Configurações > Fotos prontas) no menu lateral, no Painel e nas páginas públicas (vitrine e página do carro); a folha A4 e o painel da TV já usavam.
- Forma de pagamento inclui **Boleto**.

## v2.4 — 13/10/2026

**Painel do administrador, Contatos com histórico e mensagens em massa, contas a pagar**

- **Painel** (primeiro item do menu, para quem tem acesso a resultados): tudo da loja em uma tela, com caixas compactas, filtro de período, atualização automática a cada minuto e **tela cheia** para projetar. Mostra vendas, faturamento, lucro, resultado, dias para vender, estoque, capital investido, carros parados (com botão de oferta), onde estão os carros (pátio, oficina, parceiro, com atraso e WhatsApp do parceiro), documentação pendente, republicação, campanhas pagas, contas a pagar, pós-venda do dia e uma lista **Onde atuar agora** em ordem de prioridade. Tudo é clicável.
- **Gestão > Contatos**: junta automaticamente parceiros/fornecedores, consignatários, proprietários e compradores, mais os contatos cadastrados à mão. Um mesmo contato acumula papéis (ex.: foi consignatário e depois comprou). Filtros por papel, busca, pós-venda (30 dias), clientes para resgatar (compraram há 6+ meses), sem contato há 90+ dias e quem não quer receber. Cada contato tem **histórico** (carros que deixou, comprou, serviços, ligações e mensagens) e botão de WhatsApp.
- **Mensagens em massa** para os contatos selecionados, com modelos prontos (feirão, resgate de cliente, pós-venda, novidade no estoque, dica, consignatário) e personalização com {nome} e {loja}:
  - **Assistido** (gratuito): abre cada conversa no WhatsApp com a mensagem pronta; você só aperta Enviar e o próximo já fica pronto.
  - **Automático** pela **API oficial do WhatsApp** (Configurações > WhatsApp automático): envia sozinho para todos, com modelo aprovado pela Meta (cobrança da Meta por conversa).
  - Tudo fica registrado no histórico de cada contato; quem pede para não receber fica de fora.
- **Contas a pagar**: em Despesas da loja, desmarque "Já está pago" para lançar com vencimento; aparecem no Painel (vencidas em vermelho) e têm botão "Marcar pago".
- **Venda**: a pergunta do documento de transferência agora tem todas as etapas, iguais às de Gestão > Documentação.
- **Estoque**: a etiqueta "Consignado" (e parceria/outro) abre o WhatsApp do proprietário quando o telefone está cadastrado.

## v2.3 — 13/10/2026

- **Estoque**: a etiqueta "Em manutenção: Oficina do Zé" (ou outro local) virou link: abre o WhatsApp do parceiro com a mensagem pronta pedindo o andamento. Ao lado, há quantos dias o carro está lá (em vermelho se passou da previsão).
- **Grupo de repasse**:
  - Novo botão **WhatsApp (1 foto)**: envia só a foto da capa junto com o texto.
  - **Emojis corrigidos** no envio só de texto (o link abre direto o WhatsApp no celular ou o WhatsApp Web no computador, sem o wa.me, que quebrava os emojis).
  - Texto no novo padrão: ano modelo no título, linha 🚗 com cor, câmbio, combustível e km, FIPE sem percentual, **placa parcial (AA\*\*\*11)**, destaques sem "Aceita troca" e "Financiamento", campo **ℹ️ Detalhes** preenchido por você, telefone no formato (44)999158307 e link do **site da loja** com todos os veículos. O documento saiu do texto.

## v2.2 — 13/10/2026

**Equipe no menu, margem da loja, grupos de repasse, edição depois da venda e placa mais confiável**

- **Equipe** virou item do menu (entre Resultados e Configurações), só para o administrador: cadastrar vendedor, liberar ou tirar acesso, escolher permissões (tabela com o que cada um pode fazer) e instruções de como o vendedor entra. Em Configurações, todos podem **trocar a própria senha**.
- **Veículo vendido pode ser editado**: botão Editar no estoque e painel **Venda** dentro do cadastro (valor, data, vendedor, comissão, pagamento, comprador), salvo junto com o veículo.
- **Margem da loja** para consignado, parceria e outro: em **%** ou **valor fixo (R$)**. Entra no lucro previsto e real da loja; o repasse fixo ao dono continua opcional.
- **Editar custos** já feitos e previstos (tipo, categoria, descrição e valor), no cadastro e em Custos e margem.
- **Documentação**: nova etapa **Comunicação de venda realizada**, entre "Em transferência" e "Transferido".
- **Grupos de repasse** (Divulgar > Grupo de repasse, ou Mais > Enviar para grupo de repasse): preço de repasse (não aparece nos anúncios), texto pronto para lojistas, envio de texto e fotos pelo compartilhamento do celular, WhatsApp, cópia do texto, fotos em .zip, cadastro dos grupos da loja e registro de onde cada carro já foi enviado.
- **Gestão**: aba Localização passou a se chamar **Acompanhamento**; o nome de cada carro é clicável e abre a **ficha rápida** com os dados e o botão **Editar**.
- **Despesas da loja**: lançar **comissão de vendedor** (com o vendedor e, se quiser, a venda). Entra como comissão no DRE e no ranking de vendedores, não como despesa fixa.
- **Busca pela placa**: leitura das fontes melhorada (combustível "Álcool / Gasolina", município, versões em sigla como XLT/LTZ) e cabeçalhos de navegador no servidor. Se os sites bloquearem, o painel mostra os links da consulta e um campo para **colar o texto da página** (Ctrl+A, Ctrl+C), que preenche tudo sem extensão. Diagnóstico das fontes em `/health/placa`.
- **Telas mais compactas no computador** (painéis, indicadores e tabelas com menos espaço sobrando).

## v2.1 — 13/10/2026

**Placa que preenche sozinha, gestão no cadastro, venda completa com documento e resultados mais completos**

Cadastro
- **Busca pela placa corrigida**: o endereço do placafipe estava errado (`.com.br`); agora usa **placafipe.com** e, se falhar, **keplaca.com** (as duas gratuitas). Tenta pelo servidor e depois pelo navegador da loja (extensão **v1.7**). Escolhe sozinho a versão FIPE mais parecida com o documento (motor, câmbio, portas) e mostra as outras versões para trocar com um clique.
- **Proprietário e documentação separados**: Proprietário (loja, consignado, parceria, repasse, outro) e Documentação (em nome da loja, Renave, procuração, outro), com o campo de observações. Carros antigos marcados como "procuração" viraram consignado + documentação por procuração.
- **Gestão do veículo no próprio cadastro**: valor de compra (ou repasse, no consignado), data da compra (vem preenchida e pode ajustar), origem da compra, comprado de, **manutenções já feitas** e **custos previstos**, com a **previsão de lucro e margem calculada na hora**. Custo previsto vira "feito" com um clique.

Venda e documento
- **Vendido** agora abre a venda completa: valor, data, vendedor, comissão, forma de pagamento (entrada e financeira, carro na troca), comprador (nome, CPF, telefone), observações e se o **documento de transferência (ATPV-e/recibo) já foi preenchido**. Mostra o lucro da venda antes de confirmar. Os dados podem ser editados depois (menu Mais > Dados da venda).
- **Gestão > Documentação**: acompanhamento da transferência de cada carro vendido, por etapas (preenchimento, assinatura/firma, vistoria, transferência, novo CRLV, entregue), com histórico, alerta de mais de 30 dias e **WhatsApp pronto para avisar o comprador**. No estoque, os vendidos mostram a etapa do documento.

Gestão e resultados
- **Gestão** reorganizada em abas: Estoque e margem, Localização, Documentação, **Despesas da loja** (aluguel, salários, energia… com repetição mensal) e Parceiros.
- **Resultados**: lucro das vendas, despesas e **resultado líquido**; **DRE do período**; vendas e lucro dos **últimos 12 meses**; **tempo até vender** e **idade do estoque** por faixas; **vendas por marca** com dias médios; **ranking de vendedores**; formas de pagamento; origem da compra; maiores e menores lucros; estoque mais antigo; desconto médio sobre o anúncio; documentos pendentes; filtro por origem; **exportar vendas em planilha**.

Correções
- **Cadastrar parceiro** dentro do pop-up (localização e custos) não fecha mais a janela: o parceiro é criado ali e já fica selecionado.

Arquivos alterados: `src/plate.js`, `src/gestao.js`, `src/vehicles.js`, `src/db.js`, `src/team.js`, `src/importer.js`, `src/routes2.js`, `src/routes3.js`, `src/server.js`, `public/app.js`, `public/app2.js`, `public/app.css`, `public/sw.js`, `extension/manifest.json`, `extension/background.js`, `package.json`, `test/api.test.js`, `CHANGELOG.md`, `README.md`.

**Extensão:** atualize para a v1.7 (consulta da placa nas duas fontes pelo navegador).

## v2.0 — 13/10/2026

**Cadastro pela placa, app no celular, vender mais e gestão da loja**

Cadastro
- **Buscar dados pela placa** (sem API paga): marca, modelo, versão, anos, cor, combustível, município e valor/código FIPE. O GiroAuto lê o placafipe.com.br pelo servidor; se o site bloquear, lê pelo navegador da loja (extensão v1.6); se não der, abre a **Tabela FIPE** gratuita (Marca → Modelo → Ano). Cada placa consultada fica guardada 60 dias.
- **Proprietário e documentação**: próprio da loja, consignado, procuração para venda, parceria ou repasse; dados do dono, comissão, combinado, validade e **upload da procuração** (arquivo privado, só pelo painel); Renavam, chassi e município.
- **Cadastro rápido no celular** e **app instalável** (tela inicial do celular), com câmera para as fotos.
- **Fotos prontas** (opcionais): reduzir o tamanho, marca d'água com o logo da loja e **desfocar a placa** arrastando sobre a foto.
- **Importar planilha** (Excel ou CSV) com prévia, reconhecimento de colunas e modelo para baixar.

Vender mais
- **Carro parado**: aviso a partir de 25 dias (ajustável), com diferença para a FIPE, **oferta sugerida com um clique** e republicação com o preço de ocasião.
- **Republicação agendada**: dias, horários e quantidade por horário; a extensão republica sozinha, respeitando o limite diário.
- **QR code** de cada carro, **folha A4** para o para-brisa (colorida ou preto e branco) e **painel para TV/monitor** da loja.

Gestão
- **Custos e margem** por carro: compra ou repasse, custos por categoria e parceiro, venda (valor, comprador, pagamento, comissão, vendedor) e lucro bruto e líquido, previsto e real.
- **Localização dos carros**: no pátio, em manutenção, em loja parceira, com cliente; cadastro de **parceiros** (oficina, elétrica, funilaria, estética, lavador, loja parceira, despachante…) com **WhatsApp** e mensagem pronta para pedir o andamento.
- **Resultados**: vendidos, faturamento, lucro bruto e líquido, margem, ticket médio, dias para vender, capital no estoque, idade do estoque, carros parados, em manutenção, consignados, custo de preparação e giro, com filtros por período, tipo e vendedor.
- **Equipe**: vendedores com login próprio e permissões escolhidas pelo dono (cadastrar, preços, excluir, publicar, vender, campanhas, financeiro, resultados, parceiros, configurações). Quem não tem acesso ao financeiro não vê valores de compra e margem.

Arquivos novos: `src/team.js`, `src/gestao.js`, `src/plate.js`, `src/photos.js`, `src/schedule.js`, `src/printables.js`, `src/importer.js`, `src/routes2.js`, `src/routes3.js`, `public/app2.js`, `public/manifest.webmanifest`, `public/sw.js`, `public/icon-192.png`, `public/icon-512.png`. Alterados: `src/server.js`, `src/db.js`, `src/auth.js`, `src/vehicles.js`, `src/storage.js`, `public/app.js`, `public/app.html`, `public/app.css`, `extension/manifest.json`, `extension/background.js`, `package.json`, `test/api.test.js`, `test/mock-graph.js`, `test/e2e-server.js`, `CHANGELOG.md`, `README.md`.

**Extensão:** a v1.6 da extensão traz a consulta de placa pelo navegador. O painel avisa para atualizar.

## v1.10 — 13/10/2026

- **Teto solar** entre os destaques do cadastro (entra na descrição, na legenda e no selo da arte).
- **Duplicar** no estoque: cria uma cópia com todos os dados e cópias das fotos e abre para editar. Mudar ou apagar algo na cópia não altera o veículo original. A cópia nasce sem anúncio publicado.
- A frase final "Loja · Cidade/UF. Chame para agendar uma visita ou test drive." saiu da descrição. Agora é opcional, pela caixa **Convite para visita no fim da descrição**. A frase foi retirada também das descrições já cadastradas.
- **Legenda do Instagram sem repetições**: título, itens, destaques, oferta e avisos aparecem uma vez só; da descrição entra apenas o texto livre.
- **Imagens para divulgação**: ficou só a arte com preço. As fotos 2 a 5 (estacionamento) e a configuração de IA de imagens foram retiradas, e as imagens que existiam foram apagadas.
- Estoque: botões organizados em duas linhas, sem cortar o preço.

Arquivos alterados: `src/vehicles.js`, `src/channels.js`, `src/server.js`, `src/db.js`, `src/arts/index.js`, `src/arts/card.js`, `public/app.js`, `public/app.css`, `package.json`, `test/api.test.js`, `CHANGELOG.md`, `README.md`.

## v1.9 — 11/10/2026

**Instagram conectado direto (login do Instagram)**

- Novo botão **Conectar Instagram** em Divulgar > Instagram: a loja entra com o usuário e a senha do Instagram e o GiroAuto recebe as permissões de publicar (`instagram_business_basic` e `instagram_business_content_publish`), sem depender da Página do Facebook.
- O administrador configura uma vez o **app do Instagram** (ID e chave secreta próprios) em Configurações > App da Meta > Instagram, com passo a passo e a URI de redirecionamento pronta para copiar.
- A publicação usa a conexão direta quando existe; senão, continua pelo Instagram ligado à Página.
- O token do Instagram é renovado sozinho antes de vencer.
- A conexão pelo Facebook passa a pedir de novo permissões recusadas antes (`auth_type=rerequest`).

Arquivos alterados: `src/instagram.js` (novo), `src/channels.js`, `src/server.js`, `src/settings.js`, `src/db.js`, `src/meta/service.js`, `public/app.js`, `package.json`, `test/api.test.js`, `test/mock-graph.js`, `CHANGELOG.md`.

## v1.8.2 — 11/10/2026

- Quando o Instagram não aparece ligado, o GiroAuto procura de novo o perfil profissional na Página escolhida (ao abrir Divulgar e ao salvar a Página) e mostra o motivo exato se o Facebook não entregar.

Arquivos alterados: `src/meta/service.js`, `src/server.js`, `public/app.js`, `package.json`, `CHANGELOG.md`.

## v1.8.1 — 09/10/2026

- **Verificar permissões no Facebook** (Divulgar > Instagram): mostra quais permissões o Facebook entregou ao GiroAuto, quais foram recusadas na conexão e quais o app da Meta não liberou.
- Quando o Instagram recusa por falta de permissão (#10/#200), o erro já diz qual permissão falta e o que fazer.

Arquivos alterados: `src/channels.js`, `src/server.js`, `public/app.js`, `package.json`, `test/api.test.js`, `test/mock-graph.js`, `CHANGELOG.md`.

## v1.8 — 09/10/2026

**Fotos no estacionamento sem custo, destaques do veículo, preço de oferta e guia do Instagram**

- **Fotos no estacionamento: três modos** (Configurações > Imagens com IA):
  - **Grátis, à mão (padrão)**: em cada imagem, o botão **Fazer grátis** entrega a foto e a instrução prontas para colar no Gemini ou no ChatGPT gratuitos; depois é só enviar a imagem pronta.
  - **Automático com cota grátis (Pollinations)**: gera sozinho com a cota gratuita diária de uma conta grátis da Pollinations. Quando a cota acaba, continua sozinho mais tarde.
  - **Automático pago (Google Gemini)**, como na v1.7.
  - Em qualquer modo, dá para enviar uma imagem própria no lugar de uma gerada.
- **Destaques e transparência** no cadastro: Perícia aprovada, Perícia premium, Sem retoques, Pneus novos, Pneus seminovos, Único dono, Revisões em dia, Manual e chave reserva, IPVA pago, Garantia da loja, Aceita troca, Financiamento facilitado, Blindado e, para informar o cliente, Ex-locadora ou ex-táxi, Possui leilão, Indício de sinistro e Chassi ou motor remarcado.
  - Entram na descrição gerada, na legenda do Instagram e nos dados para Webmotors e OLX.
  - Leilão, sinistro, remarcado e ex-locadora aparecem sempre no anúncio (Marketplace, catálogo, vitrine, Instagram, Webmotors e OLX) como aviso de transparência, se a descrição ainda não citar.
  - A arte mostra selos (Perícia aprovada/premium e mais um destaque). Com "Revisões em dia", a frase vira "Revisado e pronto para rodar!".
- **Preço de oferta** (opcional): quando preenchido e menor que o preço, os anúncios, o catálogo (sale_price), as campanhas, a vitrine e o preenchimento no Facebook usam o preço de oferta. A arte mostra "de… por…" com selo OFERTA.
  - Uma oferta lançada depois da publicação libera **Republicar com oferta** na hora.
- **Instagram**: na aba Instagram do botão Divulgar, um passo a passo mostra o que falta ligar.
- A descrição gerada não inclui mais "aceitamos troca e financiamento" sem que esses itens estejam marcados.

Arquivos alterados: `src/arts/pollinations.js` (novo), `src/arts/index.js`, `src/arts/gemini.js`, `src/arts/card.js`, `src/vehicles.js`, `src/channels.js`, `src/server.js`, `src/settings.js`, `src/feed.js`, `src/pages.js`, `src/meta/service.js`, `src/db.js`, `src/start.js`, `public/app.js`, `public/app.css`, `package.json`, `test/api.test.js`, `test/mock-graph.js`, `CHANGELOG.md`, `README.md`.

## v1.7 — 09/10/2026

**Excluir veículo, imagens de divulgação e novos canais (Instagram, Webmotors e OLX)**

- **Excluir** veículos em estoque, rascunhos e vendidos, com janela de confirmação. Fotos e imagens geradas são apagadas junto. Se o carro ainda tiver anúncio no ar, o painel mostra os links para retirar.
- **Pacote de 5 imagens** para cada veículo, gerado sozinho depois de salvar com fotos:
  - **Imagem 1: arte com preço** no estilo de post de loja (marca, modelo, motor e ano, preço em destaque, itens do veículo, três fotos menores e contato da loja). Atualiza sozinha quando o preço ou os dados mudam. Sem custo.
  - **Imagens 2 a 5: o carro num estacionamento vazio**, editadas pela IA de imagens do Google (cerca de US$ 0,034 por imagem). A loja escolhe a foto de origem de cada uma e pode refazer.
  - Download de todas em .zip. Administrador configura a chave em **Configurações > Imagens com IA**.
- **Divulgar** (novo botão no estoque):
  - **Instagram**: publica um carrossel (arte, imagens geradas e fotos, até 10) com legenda pronta e editável.
  - **Webmotors e OLX**: fotos e imagens em .zip, dados prontos para copiar, link para o site e registro do link do anúncio.
- Etiquetas INSTAGRAM, WEBMOTORS e OLX no estoque. Ao marcar como vendido, lembrete com os links para retirar os anúncios.
- Nova permissão opcional "Publicar no Instagram" em Configurações > App da Meta.

Arquivos alterados: `src/arts/card.js` (novo), `src/arts/gemini.js` (novo), `src/arts/index.js` (novo), `src/channels.js` (novo), `assets/fonts/` (novo), `src/server.js`, `src/db.js`, `src/settings.js`, `src/config.js`, `src/vehicles.js`, `src/meta/service.js`, `src/start.js`, `src/pages.js`, `public/app.js`, `public/app.css`, `Dockerfile`, `package.json`, `test/api.test.js`, `test/mock-graph.js`, `test/e2e-server.js`, `CHANGELOG.md`, `README.md`.

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
