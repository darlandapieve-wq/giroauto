/* GiroAuto v2.12 — Guia "Primeiros passos": do cadastro da loja a todas as integrações, com a situação de cada etapa */
(function () {
  'use strict';
  const X = window.GiroExt;
  const { S, api, esc, toast, $, $$ } = new Proxy({}, { get: (_, k) => X[k] });
  const can = (p) => (S.me?.user?.perms || []).includes(p);
  const owner = () => S.me?.user?.role === 'admin';
  const G = { abertos: new Set(), dados: null };
  try { JSON.parse(localStorage.getItem('giro_guia_abertos') || '[]').forEach((k) => G.abertos.add(k)); } catch { /* sem armazenamento */ }
  const salvaAbertos = () => { try { localStorage.setItem('giro_guia_abertos', JSON.stringify([...G.abertos])); } catch { /* ignora */ } };

  // Link externo sempre com o endereço escrito, para a pessoa saber exatamente onde vai entrar.
  const L = (url, txt) => `<a class="link" href="${esc(url)}" target="_blank" rel="noopener">${esc(txt || url.replace(/^https:\/\//, ''))}</a>`;
  const C = (t) => `<code>${esc(t)}</code>`;
  const B = (t) => `<b>${t}</b>`;

  function etapas(D) {
    const e = D.etapas; const app = D.app_url; const adm = !!S.me.user.is_admin;
    return [
      {
        k: 'conta', grupo: 'Começo', titulo: 'Criar a conta da loja e entrar', tempo: '2 min', ok: e.conta,
        para: 'Cria a loja no GiroAuto. Quem cria a conta é o dono: tem acesso a tudo e cadastra a equipe depois.',
        passos: [
          `Abra ${L(app, app.replace(/^https:\/\//, ''))} no computador ou no celular.`,
          `Clique em ${B('Criar conta')} e preencha: ${B('nome da loja')} (como os clientes conhecem), ${B('seu nome')}, ${B('e-mail')} e uma ${B('senha')} com pelo menos 8 caracteres.`,
          `Nas próximas vezes, entre no mesmo endereço com o e-mail e a senha, em ${B('Entrar')}.`,
          `No celular, instale o GiroAuto na tela inicial: no Chrome (Android) toque em ${B('⋮ > Instalar app')}; no iPhone (Safari) toque em ${B('Compartilhar > Adicionar à Tela de Início')}. Assim dá para cadastrar carros no pátio com a câmera.`,
        ],
        erros: ['"Já existe uma conta com este e-mail": esse e-mail já foi usado. Entre com ele em vez de criar outra conta.', 'Esqueceu a senha? Peça ao administrador do GiroAuto para gerar uma nova.'],
      },
      {
        k: 'loja', grupo: 'Começo', titulo: 'Dados da loja, logo e vitrine', tempo: '5 min', ok: e.loja && e.logo, parcial: e.loja || e.logo,
        para: 'Telefone, WhatsApp e endereço aparecem na vitrine, nos anúncios, nas artes e nos contratos. O logo entra nas fotos e no site da loja.',
        abrir: [['Abrir Configurações > Loja', 'config']],
        passos: [
          `Vá em ${B('Configurações > Loja e equipe')}, quadro ${B('Loja')}.`,
          `Preencha nome, ${B('telefone')}, ${B('WhatsApp com 55 + DDD')} (ex.: ${C('5544999990000')}), endereço, cidade, UF e CEP. Clique em ${B('Salvar loja')}.`,
          `No quadro ${B('Fotos prontas')}, clique em ${B('Enviar logo')}. Use um PNG com fundo transparente, de preferência com 500 px ou mais de largura.`,
          `No quadro ${B('Dados da loja para contratos')}, informe razão social, CNPJ e o representante legal. Esses dados saem nos contratos de compra, venda e consignação.`,
          `Confira a vitrine da loja, o site público com os carros: ${L(D.vitrine_url)}. Esse é o link para colocar na bio do Instagram e mandar aos clientes. Ele também fica no botão ${B('Vitrine da loja')}, no Estoque.`,
        ],
        status: [[e.loja, 'Dados da loja'], [e.logo, 'Logo'], [e.contrato, 'Dados para contratos']],
      },
      {
        k: 'equipe', grupo: 'Começo', titulo: 'Cadastrar a equipe (opcional)', tempo: '3 min por pessoa', ok: e.equipe, opcional: true, so: owner(),
        para: 'Cada vendedor entra com o próprio login. As permissões escolhem o que cada um vê: estoque, CRM, gestão, campanhas, configurações.',
        abrir: [['Abrir Equipe', 'equipe']],
        passos: [
          `No menu, abra ${B('Equipe')} e clique em ${B('+ Adicionar vendedor')}.`,
          'Informe nome, e-mail e uma senha inicial e marque as permissões. Passe o e-mail e a senha para a pessoa.',
          `O vendedor entra em ${L(app, app.replace(/^https:\/\//, ''))} e pode trocar a senha em ${B('Configurações > Minha conta')}.`,
        ],
      },
      {
        k: 'estoque', grupo: 'Começo', titulo: 'Cadastrar os carros', tempo: '3 min por carro', ok: e.estoque,
        para: 'O carro é cadastrado uma vez só e serve para tudo: Marketplace, campanhas, vitrine, assistente, artes, contratos e gestão.',
        abrir: [['Novo veículo', 'novo'], ['Importar planilha', 'importar']],
        passos: [
          `Clique em ${B('+ Novo veículo')}. Digite a ${B('placa')}: marca, modelo, ano, cor e FIPE vêm sozinhos. Confira e complete km, câmbio, preço e destaques.`,
          'Envie até 20 fotos. A primeira é a capa: de frente, com o carro inteiro.',
          `Tem muitos carros? Use ${B('Importar planilha')} no Estoque (Excel ou CSV com placa, modelo, ano, km e preço).`,
          `No celular, use ${B('Cadastro rápido')} no Estoque para tirar as fotos e cadastrar no próprio pátio.`,
          `Marque ${B('Catálogo para campanhas')} nos carros que podem entrar nos anúncios pagos (passo "Catálogo de veículos").`,
        ],
        erros: ['A placa não encontrou o carro: preencha marca e modelo à mão. A FIPE pode ser escolhida na lista.'],
      },
      {
        k: 'marketplace', grupo: 'Divulgação', titulo: 'Publicar no Facebook Marketplace', tempo: '10 min', ok: e.marketplace,
        para: 'Anúncio grátis no Marketplace, com republicação para o carro voltar ao topo. O Facebook não tem API para isso no Brasil: ou você publica com o assistente, ou a extensão do Chrome publica por você no seu navegador.',
        abrir: [['Abrir Configurações > Publicação', 'config']],
        passos: [
          `Antes de tudo, confirme que a conta do Facebook da loja tem acesso ao Marketplace: abra ${L('https://www.facebook.com/marketplace')} e veja se aparece ${B('Criar novo anúncio')}.`,
          `Em ${B('Configurações > Publicação e fotos > Publicação no Marketplace')}, escolha o modo:`,
          `${B('Assistida (sem instalar nada)')}: funciona em qualquer computador ou celular. Em cada carro, clique em ${B('Publicar')}: o GiroAuto mostra as fotos para baixar e cada campo pronto para copiar e abre ${L('https://www.facebook.com/marketplace/create/vehicle')}. Depois de publicar, cole o link do anúncio e clique em ${B('Já publiquei')}.`,
          `${B('Automática (extensão do Chrome, só no computador)')}: no quadro ${B('Extensão do Chrome')}, clique em ${B('Instalar a extensão')} e baixe o arquivo ${L(`${app}/extensao.zip`, 'extensao.zip')}. Extraia (botão direito > Extrair tudo) numa pasta que não vai apagar, por exemplo ${C('Documentos\\GiroAuto-extensao')}.`,
          `Abra uma aba nova e digite ${C('chrome://extensions')}. Ligue o ${B('Modo do desenvolvedor')} no canto superior direito, clique em ${B('Carregar sem compactação')} e escolha a pasta extraída.`,
          `Volte ao GiroAuto e aperte F5: o quadro mostra ${B('Extensão conectada')}. Deixe o Chrome aberto e logado no Facebook da loja. A extensão publica no máximo o limite diário (padrão 15), com 3 a 5 minutos entre um anúncio e outro.`,
        ],
        erros: [
          'Não aparece "Criar novo anúncio" no Marketplace: a conta é nova ou foi restringida pelo Facebook. Use uma conta antiga e ativa ou peça a revisão em facebook.com/marketplace.',
          'Extensão "não conectada": confira se o Chrome tem o GiroAuto aberto neste mesmo endereço e aperte F5. Se continuar, use "Conectar manualmente (código)" no quadro da extensão.',
          'Aviso de versão nova da extensão: baixe o .zip de novo, extraia por cima da pasta antiga e clique em ↻ no cartão do GiroAuto em chrome://extensions.',
        ],
        status: [[e.marketplace_modo !== 'extensao', 'Modo assistido'], [!!e.extensao_vista, 'Extensão conectada']],
      },
      {
        k: 'meta', grupo: 'Divulgação', titulo: 'Facebook e Instagram: campanhas pagas', tempo: '20 min', ok: e.meta, parcial: e.meta_conectado,
        para: 'Cria e acompanha anúncios no Facebook e no Instagram (conversa no WhatsApp, Messenger ou catálogo) direto do GiroAuto, com métricas. Tudo é criado pausado e só ativa depois que a Meta aceita.',
        abrir: [['Abrir Configurações > Facebook e Instagram', 'config']],
        antes: 'Faça os itens 1 a 5 no Facebook antes de conectar. Use sempre a mesma conta do Facebook, a que administra a Página da loja.',
        passos: [
          `${B('Página do Facebook da loja')}: se ainda não tem, crie em ${L('https://www.facebook.com/pages/create')} (categoria "Concessionária de automóveis" ou "Loja de carros usados").`,
          `${B('Portfólio empresarial')} (antigo Gerenciador de Negócios): abra ${L('https://business.facebook.com/select')}. Se não aparecer o da loja, clique em ${B('Criar empresa')}, use o nome da loja e confirme o e-mail que a Meta mandar.`,
          `Em ${L('https://business.facebook.com/latest/settings/pages', 'business.facebook.com > Configurações > Páginas')}, clique em ${B('Adicionar')} e coloque a Página da loja no portfólio.`,
          `${B('Conta de anúncios com forma de pagamento')}: em ${L('https://business.facebook.com/latest/settings/ad_accounts', 'Configurações > Contas de anúncios')}, crie uma (moeda ${B('BRL')}, fuso ${B('São Paulo')}). Depois cadastre cartão ou Pix em ${L('https://business.facebook.com/billing_hub/payment_settings', 'Cobrança e pagamentos')}.`,
          `${B('Instagram profissional ligado à Página')}: no app do Instagram, vá em ${B('Editar perfil > Mudar para conta profissional')}, e depois em ${B('Página > Conectar')}. Também dá para fazer em ${L('https://accountscenter.facebook.com/', 'Central de Contas')}. Para usar WhatsApp nos anúncios, vincule o número em ${B('Página > Configurações > WhatsApp')}.`,
          `${B('No GiroAuto')}: ${B('Configurações > Publicação e fotos > Facebook e Instagram')} > ${B('Conectar Facebook')}. Na janela da Meta, clique em ${B('Editar acesso')} e marque a Página, o Instagram, a conta de anúncios e o portfólio da loja.`,
          `Volte e escolha ${B('Conta de anúncios')}, ${B('Página')}, ${B('Portfólio empresarial')} e o ${B('WhatsApp da loja')} (55 + DDD + número). Clique em ${B('Salvar')}.`,
          `Teste: em ${B('Campanhas > Nova campanha')}, escolha um carro, desmarque "Ativar assim que a Meta aprovar" e crie. Confira em ${L('https://adsmanager.facebook.com/', 'adsmanager.facebook.com')}.`,
        ],
        erros: [
          '"A conexão com o Facebook ainda não foi liberada": falta a configuração do app da Meta pelo administrador do GiroAuto (passo da plataforma, abaixo).',
          'Enquanto o app da Meta do GiroAuto estiver em modo de desenvolvimento, só entra quem tem função no app. Peça ao administrador para incluir o seu Facebook como testador.',
          'A Página não aparece na lista: ao conectar, você não marcou a Página em "Editar acesso". Clique em Reconectar e marque.',
          '"Conta de anúncios inativa": falta forma de pagamento ou a conta foi bloqueada. Veja em business.facebook.com > Cobrança e pagamentos.',
          'A conexão vale cerca de 60 dias. Quando expirar, aparece "A conexão expirou": basta clicar em Conectar Facebook de novo.',
        ],
        status: [[e.meta_conectado, 'Facebook conectado'], [e.meta, 'Conta de anúncios e Página escolhidas']],
      },
      {
        k: 'catalogo', grupo: 'Divulgação', titulo: 'Catálogo de veículos (anúncios dinâmicos)', tempo: '5 min', ok: e.catalogo, opcional: true,
        para: 'A Meta lê o estoque sozinha a cada hora e mostra o carro certo para cada pessoa, levando para a página dele na vitrine.',
        abrir: [['Abrir Campanhas', 'campanhas']],
        passos: [
          `Pré-requisito: Facebook conectado com o ${B('Portfólio empresarial')} escolhido (passo anterior).`,
          `Em ${B('Campanhas')}, quadro ${B('Catálogo de veículos')}, clique em ${B('Criar catálogo de veículos')}.`,
          `No cadastro de cada carro, marque ${B('Catálogo para campanhas')}. Entram só os carros prontos ou publicados que tenham ao menos uma foto.`,
          `Confira em ${L('https://business.facebook.com/commerce', 'business.facebook.com/commerce')}: o catálogo mostra os carros em até 1 hora.`,
          `Crie a campanha em ${B('Campanhas > Nova campanha > Catálogo dinâmico')}.`,
        ],
      },
      {
        k: 'instagram', grupo: 'Divulgação', titulo: 'Postar no Instagram da loja', tempo: '3 min', ok: e.instagram, opcional: true,
        para: 'Publica a arte ou as fotos do carro no feed do Instagram pelo botão Divulgar, sem passar o celular de mão em mão.',
        abrir: [['Abrir Estoque', 'estoque']],
        passos: [
          `O Instagram precisa ser ${B('profissional')} (Empresa ou Criador): no app, ${B('Configurações > Tipo de conta e ferramentas > Mudar para conta profissional')}.`,
          `No Estoque, clique em ${B('Divulgar')} em qualquer carro e abra a aba ${B('Instagram')}.`,
          `Clique em ${B('Conectar Instagram')} e entre com o usuário e a senha do Instagram da loja. Não precisa da Página do Facebook.`,
          `Se já conectou o Facebook com o Instagram ligado à Página (passo "Facebook e Instagram"), o Instagram já vem junto.`,
        ],
        erros: ['"Falta uma configuração única do administrador": o app do Instagram ainda não foi configurado na plataforma (passo do administrador).'],
      },
      {
        k: 'whatsapp', grupo: 'Atendimento', titulo: 'WhatsApp oficial: assistente responde e envio em massa', tempo: '40 min (+ análise da Meta)', ok: e.wa_registrado && e.wa_inscrito, parcial: e.wa_token,
        para: 'Com a API oficial da Meta, o assistente do GiroAuto responde quem escreve no WhatsApp da loja 24h, manda fotos, agenda a visita, cria o lead no CRM e passa para o vendedor. Também permite campanhas de mensagens em massa com um modelo aprovado.',
        abrir: [['Abrir Configurações > WhatsApp', 'config']],
        antes: `Use um número só para isso: um chip novo ou um número que você aceita tirar do app do WhatsApp. Na API oficial, o número ${B('não pode')} continuar ativo no app WhatsApp ou WhatsApp Business do celular, e o histórico do app se perde. O atendimento humano passa a ser feito pelo CRM do GiroAuto.`,
        passos: [
          `${B('1. Portfólio da loja.')} Em ${L('https://business.facebook.com/select')}, entre no portfólio empresarial da loja (ou ${B('Criar empresa')}). Em ${L('https://business.facebook.com/latest/settings/business_info', 'Configurações > Informações da empresa')} > ${B('Editar')}, preencha ${B('razão social, endereço, telefone e site')} iguais aos do CNPJ. No site, pode usar a vitrine: ${C(D.vitrine_url)}. Sem esses dados, a Meta não deixa criar a conta do WhatsApp.`,
          `${B('2. Tirar o número do app (se ele estiver em uso).')} No celular com o número: ${B('WhatsApp > Configurações > Conta > Apagar minha conta')}. Se o número nunca foi usado no WhatsApp, pule este passo.`,
          `${B('3. Conta do WhatsApp Business.')} Em ${L('https://business.facebook.com/latest/settings/whatsapp_account', 'Configurações > Contas do WhatsApp')} > ${B('Adicionar > Crie uma nova conta do WhatsApp Business')}. Nome de exibição igual ao nome da loja, categoria ${B('Automotivo')}. Clique em ${B('Continuar')} e aceite os termos.`,
          `${B('4. Número.')} Abra o ${L('https://business.facebook.com/latest/whatsapp_manager/phone_numbers', 'Gerenciador do WhatsApp > Telefones')} > ${B('Adicionar telefone')}. Escolha ${B('BR +55')}, digite DDD + número e avance. Ele aparece como "Não verificado"; a verificação é feita pelo GiroAuto no passo 9.`,
          `${B('5. Copiar os IDs.')} Ainda em ${B('Telefones')}, clique na engrenagem do número e copie a ${B('Identificação do número de telefone')}. Copie também o ${B('ID da conta do WhatsApp')} (aparece em Configurações > Contas do WhatsApp, ao clicar na conta).`,
          `${B('6. Dar acesso ao app do GiroAuto.')} Em ${L('https://business.facebook.com/latest/settings/apps', 'Configurações > Apps')} > ${B('Adicionar > Solicitar acesso a um ID do app')}, digite ${D.meta_app_id ? C(D.meta_app_id) : 'o ID do app do GiroAuto (peça ao administrador)'} e clique em ${B('Solicitar app')}.`,
          `${B('7. Usuário do sistema e token permanente.')} Em ${L('https://business.facebook.com/latest/settings/system_users', 'Configurações > Usuários do sistema')} > ${B('Adicionar')}: nome ${C('GiroAuto Bot')}, função ${B('Admin')}. Depois clique em ${B('Atribuir ativos')}: em ${B('Apps')}, marque o GiroAuto com ${B('Gerenciar app')}; em ${B('Contas do WhatsApp')}, marque a conta da loja com ${B('Tudo')} (acesso total). Clique em ${B('Atribuir ativos')}.`,
          `Com o "GiroAuto Bot" selecionado, clique em ${B('Gerar token')}. App: ${B('GiroAuto')}. Expiração: ${B('Nunca')}. Permissões: ${C('whatsapp_business_messaging')}, ${C('whatsapp_business_management')} e ${C('business_management')}. Copie o token (começa com ${C('EAA')}): ele só aparece uma vez.`,
          `${B('8. No GiroAuto.')} Em ${B('Configurações > WhatsApp')}, quadro ${B('WhatsApp automático')}, cole o ${B('token')} e o ${B('ID do número de telefone')} e clique em ${B('Salvar')}. No quadro ${B('Assistente responde os clientes')}, informe o ${B('ID da conta (WABA)')} e clique em ${B('Ativar recebimento')}.`,
          `${B('9. Verificar o número.')} No mesmo quadro aparece ${B('Verificar o número na Meta')}. Clique em ${B('Pedir código')} (SMS ou ligação), digite o código que chegar no celular desse número e clique em ${B('Confirmar')}. O GiroAuto confirma e registra o número. Quando o quadro ficar verde, mande um "Oi" de outro celular para testar o assistente.`,
          `${B('10. Forma de pagamento.')} Em ${L('https://business.facebook.com/billing_hub/payment_settings', 'Cobrança e pagamentos')}, ou no Gerenciador do WhatsApp > ${B('Configurações de pagamento')}, cadastre um cartão. Sem ela, o número só responde quem escreveu primeiro, dentro de 24h.`,
          `${B('11. Modelo para envio em massa (opcional).')} No ${L('https://business.facebook.com/latest/whatsapp_manager/message_templates', 'Gerenciador do WhatsApp > Modelos de mensagem')} > ${B('Criar modelo')}: categoria ${B('Marketing')}, nome ${C('campanha_loja')} (só minúsculas e _), idioma ${B('Português (BR)')}. No corpo, use 2 variáveis no meio de um texto completo, por exemplo: ${C('Olá {{1}}, tudo bem? Aqui é da Loja. {{2}} Se quiser mais informações, é só responder esta mensagem.')}. Preencha os exemplos e envie para análise. Depois de ${B('Aprovado')}, coloque o nome do modelo no GiroAuto e salve.`,
          `${B('12. Verificação da empresa (recomendado).')} Em ${L('https://business.facebook.com/latest/settings/security_center', 'Configurações > Central de Segurança')} > ${B('Iniciar verificação')}, envie o CNPJ e um documento da empresa. Ela aumenta os limites de envio e protege a conta contra bloqueios.`,
        ],
        erros: [
          '"Sua empresa ainda não cumpriu os requisitos": faltam razão social, endereço, telefone ou site em Informações da empresa (passo 1).',
          'O número não registra porque a "conta do WhatsApp Business não foi verificada": a conta nova ainda está na análise automática da Meta. Espere algumas horas e clique em "Registrar número" no GiroAuto. Não precisa pedir outro código.',
          'O número já está em uso no WhatsApp: apague a conta no app do celular (passo 2) e espere uns minutos antes de adicionar.',
          '"A Meta recusou o token": token copiado pela metade, com espaço, ou gerado sem as permissões do passo 7. Gere de novo.',
          'Modelo recusado com "muitas variáveis para a extensão": aumente o texto fixo em volta de {{1}} e {{2}}. O texto também não pode começar nem terminar com uma variável.',
          'Conta marcada como "Banned/Desabilitada": não use esse portfólio. Crie outro portfólio, só da loja, e siga a política do WhatsApp (nada de mensagens em massa para quem não pediu).',
        ],
        status: [[e.wa_token, 'Token e número salvos'], [e.wa_inscrito, 'Recebimento ativado'], [e.wa_registrado, 'Número verificado e registrado'], [e.wa_modelo, 'Modelo informado']],
      },
      {
        k: 'bot', grupo: 'Atendimento', titulo: 'Assistente de vendas no site', tempo: '5 min', ok: e.bot_site,
        para: 'Um atendente com IA na vitrine e na página de cada carro: responde 24h, pega nome e WhatsApp, agenda a visita e cria o lead no CRM.',
        abrir: [['Abrir CRM > Assistente do site', 'crm']],
        passos: [
          `No menu, abra ${B('CRM')} e a aba ${B('🤖 Assistente do site')}.`,
          `Marque ${B('Mostrar o assistente no site da loja')} e dê um nome a ele (ex.: "Ana da ${esc(S.me.store.name)}").`,
          `Em ${B('Informações e regras da loja')}, escreva horário de funcionamento, formas de pagamento, se aceita troca, financiamento, garantia e o que ele ${B('não')} pode prometer. Salve.`,
          `Teste no quadro ${B('Testar o assistente')} e depois na vitrine: ${L(D.vitrine_url)}.`,
        ],
        erros: [`"A IA ainda não está ligada": o assistente funciona no modo roteiro até o administrador configurar a IA (passo da plataforma). ${D.plataforma.ia ? 'Nesta plataforma a IA já está ligada.' : ''}`],
      },
      {
        k: 'portais', grupo: 'Atendimento', titulo: 'Leads dos portais (Webmotors, OLX, iCarros…) direto no CRM', tempo: '10 min', ok: e.portais, opcional: true,
        para: 'Os portais mandam um e-mail para cada interessado. O GiroAuto lê a caixa a cada 3 minutos e cria o lead no CRM já com o carro do anúncio.',
        abrir: [['Abrir CRM > Portais', 'crm']],
        passos: [
          `Use um e-mail só para os leads (ex.: ${C('leads.suaLoja@gmail.com')}) e cadastre esse e-mail em cada portal como e-mail de contato dos anúncios.`,
          `${B('Gmail')}: ative a verificação em duas etapas em ${L('https://myaccount.google.com/signinoptions/two-step-verification')}. Depois crie uma senha de app chamada "GiroAuto" em ${L('https://myaccount.google.com/apppasswords')} e copie as 16 letras.`,
          `${B('Outlook/Hotmail')}: ative a verificação em duas etapas e crie uma senha de app em ${L('https://account.live.com/proofs/AppPassword')}. Servidor ${C('outlook.office365.com')}, porta ${C('993')}.`,
          `No GiroAuto, ${B('CRM > ✉️ Portais (e-mail)')}: cole o e-mail e a ${B('senha de app')} (não use a senha normal), marque ${B('Ler automaticamente')}, clique em ${B('Testar conexão')} e em ${B('Salvar')}.`,
          `Sem senha de app? No mesmo quadro há um endereço de encaminhamento: crie no e-mail um filtro que encaminhe as mensagens dos portais para ele.`,
        ],
        erros: ['"Usuário ou senha inválidos": a senha usada foi a normal, não a senha de app, ou a verificação em duas etapas não está ativa.'],
      },
      {
        k: 'plataforma', grupo: 'Plataforma (só o administrador do GiroAuto)', titulo: 'App da Meta, app do Instagram e IA', tempo: '30 min, uma vez para todas as lojas', so: adm,
        ok: D.plataforma.meta_app && D.plataforma.ia, parcial: D.plataforma.meta_app || D.plataforma.ia,
        para: 'Configuração única da plataforma, feita por quem hospeda o GiroAuto. Libera o "Conectar Facebook", o "Conectar Instagram" e a IA para todas as lojas.',
        abrir: [['Abrir Configurações > Sistema', 'config']],
        passos: [
          `${B('App da Meta')}: em ${L('https://developers.facebook.com/apps')}, ${B('Criar app')} do tipo ${B('Empresa')}, com o caso de uso ${B('Criar e gerenciar anúncios com a API de Marketing')}. Adicione também ${B('Conectar-se com clientes pelo WhatsApp')} e ${B('Gerenciar mensagens e conteúdo no Instagram')}.`,
          `Em ${B('Login do Facebook para Empresas > Configurações')}, cadastre a URI de redirecionamento ${C(`${app}/api/meta/callback`)}. Em ${B('Configurações do app > Básico')}, copie o ${B('ID do app')} e a ${B('Chave secreta')}.`,
          `No GiroAuto: ${B('Configurações > Sistema (administrador) > App da Meta')}, cole os dois e salve. As lojas já conseguem clicar em "Conectar Facebook".`,
          `Para outras lojas além da sua: em ${B('Funções do app')} adicione cada uma como testadora, ou publique o app (exige verificação da empresa e análise das permissões pela Meta).`,
          `${B('App do Instagram')} (postar sem Página): no mesmo app, caso de uso do Instagram > ${B('Configuração da API com login do Instagram')}. Copie o ID e a chave do app do Instagram e cadastre ${C(`${app}/api/instagram/callback`)} como URI de redirecionamento. Cole em ${B('Configurações > Sistema > App do Instagram')}.`,
          `${B('IA (Google Gemini, plano gratuito)')}: crie a chave em ${L('https://aistudio.google.com/apikey')} (${B('Create API key')}) e cole em ${B('Configurações > Sistema > Inteligência artificial')}. Liga o assistente com IA, a transcrição de áudios do WhatsApp e as imagens com IA.`,
        ],
        status: [[D.plataforma.meta_app, 'App da Meta'], [D.plataforma.ig_app, 'App do Instagram'], [D.plataforma.ia, 'IA']],
      },
      {
        k: 'extras', grupo: 'Extras', titulo: 'Recursos que já funcionam sem configurar', tempo: '—', ok: true, info: true,
        para: 'Prontos para usar desde o primeiro carro cadastrado.',
        passos: [
          `${B('Painel TV')}: no Estoque, botão ${B('Painel TV')}. Abra no computador ligado à TV da loja e aperte F11 para tela cheia.`,
          `${B('QR code e folha A4 no carro')}: no menu ${B('Mais')} de cada carro. O cliente aponta o celular e cai na página do carro, e o lead entra no CRM.`,
          `${B('Contratos')}: menu Contratos, para compra, venda, consignação e recibo, preenchidos com os dados do carro e da loja.`,
          `${B('Gestão e Resultados')}: custos por carro, despesas da loja, venda, comissão, DRE e indicadores.`,
          `${B('Republicação agendada')}: ${B('Configurações > Publicação e fotos > Republicação agendada')}, para o Marketplace se renovar sozinho nos dias e horários escolhidos.`,
          `Encontrou um erro ou tem uma ideia? Botão ${B('💬 Sugestões e erros')} no menu lateral.`,
        ],
      },
    ].filter((x) => x.so !== false);
  }

  const pill = (x) => x.info ? '<span class="pill p-info">Pronto</span>'
    : x.ok ? '<span class="pill p-ok">Concluído</span>'
    : x.parcial ? '<span class="pill p-warn">Em andamento</span>'
    : x.opcional ? '<span class="pill p-muted">Opcional</span>' : '<span class="pill p-muted">A fazer</span>';

  function card(x, i) {
    const aberto = G.abertos.has(x.k) || (!x.ok && !G.abertos.size && i === etapas(G.dados).findIndex((y) => !y.ok && !y.opcional));
    return `<details class="gd-step${x.ok ? ' gd-ok' : ''}" data-gk="${x.k}" ${aberto ? 'open' : ''}>
      <summary><span class="gd-n">${x.ok ? '✓' : i + 1}</span><span class="gd-t"><b>${esc(x.titulo)}</b><span class="sub">${esc(x.tempo)}</span></span>${pill(x)}</summary>
      <div class="gd-body">
        <p class="lead">${x.para}</p>
        ${x.status ? `<div class="gd-chk">${x.status.map(([ok, t]) => `<span class="${ok ? 'ok' : ''}">${ok ? '✅' : '⬜'} ${esc(t)}</span>`).join('')}</div>` : ''}
        ${x.antes ? `<div class="warnbox">${x.antes}</div>` : ''}
        <ol class="gd-list">${x.passos.map((p) => `<li>${p}</li>`).join('')}</ol>
        ${x.erros?.length ? `<details class="gd-err"><summary>Deu erro? Problemas comuns e como resolver</summary><ul>${x.erros.map((t) => `<li>${t}</li>`).join('')}</ul></details>` : ''}
        ${x.abrir?.length ? `<div class="btnrow" style="margin-top:12px">${x.abrir.map(([l, v]) => `<button class="btn${x.ok ? '' : ' primary'} sm" type="button" data-gvai="${v}" data-gtab="${x.k}">${esc(l)}</button>`).join('')}</div>` : ''}
      </div></details>`;
  }

  // Ao abrir uma tela pelo guia, já cai na aba certa (Configurações e CRM têm abas).
  const ABA_CFG = { loja: 'loja', marketplace: 'publicacao', meta: 'publicacao', whatsapp: 'mensagens', plataforma: 'sistema' };
  const ABA_CRM = { bot: 'assistente', portais: 'portais' };

  X.views.guia = {
    async html() {
      G.dados = await api('GET', '/api/guia');
      const lista = etapas(G.dados);
      const obrig = lista.filter((x) => !x.opcional && !x.info && x.k !== 'plataforma');
      const feitos = obrig.filter((x) => x.ok).length;
      const pct = Math.round((feitos / Math.max(1, obrig.length)) * 100);
      let grupo = '';
      const cards = lista.map((x, i) => { const h = x.grupo !== grupo ? `<h3 class="gd-g">${esc(x.grupo)}</h3>` : ''; grupo = x.grupo; return h + card(x, i); }).join('');
      return `<div class="head"><div><h1>Primeiros passos</h1><p>O caminho completo para deixar a loja funcionando: do cadastro a todas as integrações. Cada etapa diz para que serve, onde clicar e o endereço exato de cada site. Os itens se marcam sozinhos quando ficam prontos.</p></div>
          <div class="btnrow"><button class="btn sm" type="button" id="gdAll">Abrir tudo</button><button class="btn sm" type="button" id="gdPrint">Imprimir</button></div></div>
        <div class="panel gd-top"><div class="gd-prog"><div style="width:${pct}%"></div></div>
          <p><b>${feitos} de ${obrig.length}</b> etapas principais concluídas${pct === 100 ? ' — tudo pronto! 🎉' : '.'} <span class="sub">Siga na ordem: cada etapa usa o que foi feito na anterior. As marcadas "Opcional" podem ficar para depois.</span></p></div>
        <div class="gd-wrap">${cards}</div>`;
    },
    bind() {
      $$('.gd-step').forEach((d) => d.addEventListener('toggle', () => { if (d.open) G.abertos.add(d.dataset.gk); else G.abertos.delete(d.dataset.gk); salvaAbertos(); }));
      $('#gdAll') && ($('#gdAll').onclick = () => { const abrir = $$('.gd-step').some((d) => !d.open); $$('.gd-step').forEach((d) => { d.open = abrir; }); $('#gdAll').textContent = abrir ? 'Fechar tudo' : 'Abrir tudo'; });
      $('#gdPrint') && ($('#gdPrint').onclick = () => { $$('.gd-step, .gd-err').forEach((d) => { d.open = true; }); setTimeout(() => window.print(), 50); });
      $$('[data-gvai]').forEach((b) => { b.onclick = () => {
        const v = b.dataset.gvai; const k = b.dataset.gtab;
        if (v === 'config' && ABA_CFG[k]) G.cfgTab = ABA_CFG[k];
        if (v === 'crm' && ABA_CRM[k]) G.crmTab = ABA_CRM[k];
        if (location.hash === '#' + v) X.route(); else location.hash = v;
      }; });
    },
  };

  /* ---- Entrada no menu, atalho em Configurações e abas certas ao chegar pelo guia ---- */
  function navGuia() {
    const nav = $('.nav'); if (!nav || $('.nav [data-view="guia"]')) return;
    if (!(owner() || can('config'))) return;
    const primeiro = nav.querySelector('button');
    primeiro?.insertAdjacentHTML('beforebegin', '<button data-view="guia"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19.5V5a2 2 0 0 1 2-2h12v16H6.5A2.5 2.5 0 0 0 4 21.5"/><path d="M9 7h6M9 11h4"/><path d="M18 19H6.5"/></svg>Primeiros passos</button>');
    const b = $('.nav [data-view="guia"]');
    b.addEventListener('click', () => { if (location.hash === '#guia') X.route(); else location.hash = 'guia'; });
  }
  function cfgAtalho() {
    const head = $('#main .head'); if (!head || $('#cfgGuia')) return;
    head.insertAdjacentHTML('beforeend', '<div class="btnrow"><a class="btn" id="cfgGuia" href="#guia">📘 Guia de configuração</a></div>');
  }
  const antes = X.after;
  X.after = (view) => {
    antes?.(view);
    navGuia();
    $$('.nav button').forEach((b) => { if (b.dataset.view === 'guia') { if (view === 'guia') b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); } });
    if (view === 'config') {
      cfgAtalho();
      if (G.cfgTab) { const t = G.cfgTab; G.cfgTab = null; setTimeout(() => $(`[data-cfgt="${t}"]`)?.click(), 60); }
    }
    if (view === 'crm' && G.crmTab) { const t = G.crmTab; G.crmTab = null; setTimeout(() => $(`[data-crt="${t}"]`)?.click(), 60); }
  };
})();
