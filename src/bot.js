// Assistente de vendas com IA no site da loja (v2.10): responde sobre o estoque, mostra fotos, qualifica,
// pega nome e WhatsApp, agenda a visita e passa para um vendedor. Cada conversa vira lead no CRM (origem "Assistente do site").
// Sem chave de IA configurada (ou se a IA falhar), segue um roteiro simples que ainda captura o contato.
const crypto = require('node:crypto');
const config = require('./config');
const { get, all, run } = require('./db');
const V = require('./vehicles');
const C = require('./contatos');
const CRM = require('./crm');

const BASE = () => (process.env.GEMINI_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
const MODELOS = () => [process.env.GEMINI_CHAT_MODEL, 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'].filter(Boolean);
const str = (x, max = 500) => String(x ?? '').trim().slice(0, max);
const httpError = (status, message) => Object.assign(new Error(message), { status });
const json = (s, d) => { try { return JSON.parse(s || ''); } catch { return d; } };

const BOT_PADRAO = {
  ativo: true, nome: 'Assistente', boas_vindas: '',
  instrucoes: '', mostrar_preco: true,
};
function botConfig(storeId) {
  const c = CRM.config(storeId);
  return { ...BOT_PADRAO, ...(c.bot || {}) };
}
function saveBotConfig(storeId, b) {
  const atual = botConfig(storeId);
  const novo = {
    ativo: b.ativo !== undefined ? !!b.ativo : atual.ativo,
    nome: str(b.nome ?? atual.nome, 40) || 'Assistente',
    boas_vindas: str(b.boas_vindas ?? atual.boas_vindas, 400),
    instrucoes: str(b.instrucoes ?? atual.instrucoes, 4000),
    mostrar_preco: b.mostrar_preco !== undefined ? !!b.mostrar_preco : atual.mostrar_preco,
  };
  CRM.saveConfig(storeId, { bot: novo });
  return novo;
}
function iaKey() { return require('./settings').ai().gemini.key || ''; }

/* ---------------- Estoque para a IA e para o chat ---------------- */
function fotos(vehicleId, n = 8) {
  return all('SELECT filename FROM photos WHERE vehicle_id = ? ORDER BY position, id LIMIT ?', vehicleId, n).map((p) => `/media/${p.filename}`);
}
function card(store, v, todasFotos = false) {
  return {
    id: v.id, titulo: `${v.marca} ${v.modelo}${v.versao ? ' ' + v.versao : ''}`, ano: [v.ano_fab, v.ano_modelo].filter(Boolean).join('/'),
    km: v.km || 0, preco: V.precoAnuncio(v), oferta: V.ofertaAtiva(v), fotos: fotos(v.id, todasFotos ? 12 : 3), url: `/v/${store.slug}/${v.id}`,
  };
}
function estoque(storeId) {
  return all(`SELECT * FROM vehicles WHERE store_id = ? AND status IN ('pronto','publicado') ORDER BY updated_at DESC LIMIT 80`, storeId);
}
function linhaVeiculo(v, preco = true) {
  const d = V.destaquesOf(v).map((k) => V.DESTAQUE[k]?.label).filter(Boolean).join(', ');
  const desc = str(String(v.descricao || '').replace(/\s+/g, ' '), 260);
  return `#${v.id} | ${v.marca} ${v.modelo} ${v.versao || ''} | ${[v.ano_fab, v.ano_modelo].filter(Boolean).join('/')} | ${Number(v.km || 0).toLocaleString('pt-BR')} km | `
    + `${preco ? `R$ ${Number(V.precoAnuncio(v) || 0).toLocaleString('pt-BR')}${V.ofertaAtiva(v) ? ' (oferta)' : ''}` : 'preço sob consulta'} | ${v.cambio || ''} | ${v.combustivel || ''} | ${v.cor || ''} | ${v.carroceria || ''}`
    + `${d ? ` | destaques: ${d}` : ''}${desc ? ` | descrição: ${desc}` : ''}`;
}

function agoraSP() {
  const f = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return { texto: f.format(new Date()), iso };
}

function prompt(store, cfg, bot, sess, vAtual) {
  const hoje = agoraSP();
  const d = sess.dados || {};
  const vs = estoque(store.id);
  return `Você é ${bot.nome}, assistente virtual de vendas da loja de veículos ${store.name}${store.city ? ` (${store.city}${store.state ? '/' + store.state : ''})` : ''}, conversando com um cliente pelo chat do site da loja.

OBJETIVO: atender bem, tirar dúvidas sobre os carros do estoque, despertar interesse e conduzir para AGENDAR UMA VISITA ou test-drive na loja. Em paralelo, conseguir o NOME e o WHATSAPP do cliente (de forma natural, sem interrogatório: peça o nome logo no começo e o WhatsApp quando oferecer enviar fotos/condições, ou ao agendar).

COMO RESPONDER:
- Português do Brasil, tom simpático, consultivo e confiante, como um bom vendedor. Mensagens CURTAS (no máximo 3 frases curtas), uma pergunta por vez.
- Seja propositivo: destaque pontos fortes do carro (ano, km, opcionais, economia, conforto), crie senso de oportunidade sem pressionar ("esse costuma sair rápido"), e sempre termine com um próximo passo (ver fotos, simular, agendar visita).
- Faça perguntas que qualificam: para que vai usar o carro, faixa de preço, se tem carro para dar na troca, se pretende financiar ou pagar à vista.
- Se o carro procurado não existir no estoque, ofereça as alternativas mais próximas da lista.
- Para mostrar carros, informe os IDs em "mostrar_veiculos"; para mandar todas as fotos de um carro, use "fotos_de" com o ID.
- Financiamento: pode dizer que a loja trabalha com financiamento e que a parcela depende da análise de crédito; NÃO prometa aprovação, taxa ou valor de parcela exato.
- Troca: diga que a loja avalia o carro na troca e que a avaliação final é presencial; pode pedir modelo, ano e km.
- NUNCA invente carros, preços, opcionais, garantias ou condições que não estejam nos dados abaixo ou nas instruções da loja. Se não souber, diga que um consultor confirma.
- Fale só sobre a loja, os carros e a compra/venda de veículos. Para outros assuntos, volte educadamente ao atendimento.
- Para agendar, confirme dia e horário dentro do horário de atendimento e só preencha "agendar" quando o cliente CONFIRMAR um dia e horário específicos E você já tiver nome e WhatsApp.
- Se o cliente pedir para falar com uma pessoa, reclamar, negociar valor final ou o assunto fugir do que você sabe, marque "chamar_humano": true e diga que um consultor vai chamá-lo no WhatsApp.

DADOS DA LOJA:
- Nome: ${store.name}
- Endereço: ${[store.address, store.city, store.state].filter(Boolean).join(', ') || 'não informado'}
- WhatsApp: ${store.whatsapp || store.phone || 'não informado'}
- Horário de atendimento e visitas: ${cfg.horarios || 'não informado'}
- Agora é ${hoje.texto} (hoje = ${hoje.iso}). Use isso para entender "amanhã", "sábado" etc.
${bot.instrucoes ? `\nINSTRUÇÕES E INFORMAÇÕES DA LOJA (siga estas regras):\n${bot.instrucoes}\n` : ''}
ESTOQUE DISPONÍVEL (id | carro | ano | km | preço | câmbio | combustível | cor | carroceria | ...):
${vs.map((v) => linhaVeiculo(v, bot.mostrar_preco)).join('\n') || '(nenhum carro cadastrado no momento)'}
${vAtual ? `\nO cliente está na página deste carro: #${vAtual.id} ${vAtual.marca} ${vAtual.modelo} ${vAtual.versao || ''}.` : ''}

O QUE JÁ SABEMOS DO CLIENTE: ${JSON.stringify({ nome: d.nome || null, whatsapp: d.telefone || null, email: d.email || null, orcamento: d.orcamento || null, troca: d.troca || null, pagamento: d.pagamento || null, visita_agendada: d.visita || null })}

FORMATO DA RESPOSTA: responda SOMENTE um JSON válido, sem texto fora dele, com as chaves:
{"resposta": "texto para o cliente", "mostrar_veiculos": [ids], "fotos_de": id ou null,
 "lead": {"nome": "" , "telefone": "", "email": "", "orcamento": número em reais ou null, "troca": "", "pagamento": "avista|financiado|troca|consorcio|indefinido|", "interesse": "resumo curto do que procura"},
 "agendar": {"data": "AAAA-MM-DD", "hora": "HH:MM", "tipo": "visita|test_drive"} ou null,
 "temperatura": "quente|morno|frio", "chamar_humano": false}
Em "lead", preencha só o que o cliente informou nesta conversa (deixe "" quando não souber).`;
}

async function gerar(key, system, historico) {
  const contents = historico.map((m) => ({ role: m.papel === 'user' ? 'user' : 'model', parts: [{ text: m.papel === 'user' ? m.texto : JSON.stringify({ resposta: m.texto }) }] }));
  let ultimo;
  for (const model of MODELOS()) {
    const r = await fetch(`${BASE()}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { responseMimeType: 'application/json', temperature: 0.6, maxOutputTokens: 1024 } }),
      signal: AbortSignal.timeout(25000),
    }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: { message: e.message } }) }));
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      const txt = (data?.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought && p.text).map((p) => p.text).join('');
      const o = json(txt.replace(/^```(json)?|```$/g, '').trim(), null);
      if (o && typeof o.resposta === 'string' && o.resposta.trim()) return o;
      ultimo = new Error('A IA respondeu fora do formato.');
      continue;
    }
    ultimo = new Error(data?.error?.message || `Erro ${r.status} na IA`);
    if (![404, 400].includes(r.status)) break; // modelo inexistente: tenta o próximo; outros erros: para
  }
  throw ultimo || new Error('IA indisponível');
}

/* ---------------- Roteiro sem IA ---------------- */
const RE_TEL = /(?:\+?55\s?)?\(?\b([1-9]{2})\)?[\s.-]?(9?)[\s.-]?(\d{4})[-.\s]?(\d{4})\b/;
function roteiro(store, cfg, sess, texto, vAtual, historico) {
  const d = sess.dados || {};
  const out = { resposta: '', mostrar_veiculos: [], lead: {}, agendar: null, temperatura: 'morno', chamar_humano: false };
  const m = String(texto).match(RE_TEL);
  if (m) out.lead.telefone = m[1] + m[2] + m[3] + m[4];
  const ultimoBot = [...historico].reverse().find((x) => x.papel === 'bot')?.texto || '';
  if (!d.nome && /seu nome/i.test(ultimoBot) && !m) {
    const n = String(texto).replace(/^(meu nome é|me chamo|sou o|sou a|sou)\s+/i, '').replace(/[^\p{L}\s'-]/gu, '').trim().split(/\s+/).slice(0, 3).join(' ');
    if (n.length >= 2 && n.length <= 40) out.lead.nome = n.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  }
  const nome = d.nome || out.lead.nome; const tel = d.telefone || out.lead.telefone;
  if (/atendente|humano|pessoa|vendedor|falar com/i.test(texto)) out.chamar_humano = true;
  const jaPerguntouNome = historico.some((x) => x.papel === 'bot' && /seu nome/i.test(x.texto));
  if (!nome) out.resposta = jaPerguntouNome ? 'Desculpe, não entendi. Qual é o seu nome?' : `Claro, te ajudo com isso! ${vAtual ? `O ${vAtual.marca} ${vAtual.modelo} está disponível. ` : ''}Para eu te atender melhor, qual é o seu nome?`;
  else if (!tel) out.resposta = `Prazer, ${nome.split(' ')[0]}! Me passa seu WhatsApp com DDD? Um consultor te envia fotos, condições de pagamento e já combina sua visita${vAtual ? ' para ver o carro' : ''}.`;
  else {
    out.resposta = `Perfeito, ${nome.split(' ')[0]}! Já passei seus dados para um consultor, que vai te chamar no WhatsApp em instantes. ${cfg.horarios ? `Nosso horário de atendimento: ${cfg.horarios}` : ''} Quer deixar um dia e horário de visita já combinado?`;
    out.temperatura = 'quente';
  }
  if (vAtual && historico.filter((x) => x.papel === 'user').length === 1) out.mostrar_veiculos = [vAtual.id];
  return out;
}

/* ---------------- Conversa ---------------- */
function sessao(storeId, sid, { ip, teste, vehicle_id } = {}) {
  let s = sid && /^[a-f0-9]{24}$/.test(sid) ? get('SELECT * FROM chat_sessions WHERE id = ? AND store_id = ?', sid, storeId) : null;
  if (!s) {
    const id = crypto.randomBytes(12).toString('hex');
    run('INSERT INTO chat_sessions (id, store_id, vehicle_id, ip, teste) VALUES (?, ?, ?, ?, ?)', id, storeId, Number(vehicle_id) || null, str(ip, 60), teste ? 1 : 0);
    s = get('SELECT * FROM chat_sessions WHERE id = ?', id);
  }
  return { ...s, dados: json(s.dados, {}) };
}

function boasVindas(store, bot, vAtual) {
  if (bot.boas_vindas) return bot.boas_vindas;
  return vAtual
    ? `Olá! Sou ${bot.nome} da ${store.name} 👋 Quer saber mais sobre o ${vAtual.marca} ${vAtual.modelo}? Posso te mandar mais fotos, falar das condições ou já agendar uma visita.`
    : `Olá! Sou ${bot.nome} da ${store.name} 👋 Está procurando algum carro? Me conta o que você precisa que eu te mostro as melhores opções.`;
}

/**
 * Processa uma mensagem do cliente.
 * @returns {Promise<{sid: string, mensagens: Array, whatsapp?: string, acoes: string[]}>}
 */
async function conversar(store, b, { ip = '', teste = false } = {}) {
  const bot = botConfig(store.id);
  if (!bot.ativo && !teste) throw httpError(403, 'Assistente desativado.');
  const cfg = CRM.config(store.id);
  const sess = sessao(store.id, b.sid, { ip, teste, vehicle_id: b.vehicle_id });
  const vid = Number(b.vehicle_id) || sess.vehicle_id;
  const vAtual = vid ? get(`SELECT * FROM vehicles WHERE id = ? AND store_id = ? AND status != 'rascunho'`, vid, store.id) : null;
  if (vAtual && !sess.vehicle_id) run('UPDATE chat_sessions SET vehicle_id = ? WHERE id = ?', vAtual.id, sess.id);
  const texto = str(b.texto, 1000);

  // Abertura: só a saudação (e o carro da página).
  if (!texto) {
    const ja = all('SELECT papel, texto, meta FROM chat_messages WHERE session_id = ? ORDER BY id', sess.id);
    if (ja.length) return { sid: sess.id, mensagens: ja.map((m) => ({ papel: m.papel, texto: m.texto, veiculos: (json(m.meta, {}).veiculos || []).map((id) => veicCard(store, id, json(m.meta, {}).fotos_de === id)).filter(Boolean) })), acoes: [] };
    const t = boasVindas(store, bot, vAtual);
    run('INSERT INTO chat_messages (session_id, papel, texto, meta) VALUES (?, ?, ?, ?)', sess.id, 'bot', t, JSON.stringify({ veiculos: [] }));
    return { sid: sess.id, mensagens: [{ papel: 'bot', texto: t, veiculos: [] }], acoes: [] };
  }

  if (!teste) {
    if (!CRM.limite(`chat:${ip}`, 60, 3600e3) || !CRM.limite(`chat-s:${sess.id}`, 40, 24 * 3600e3) || !CRM.limite(`chat-loja:${store.id}`, 800, 24 * 3600e3)) {
      throw httpError(429, 'Muitas mensagens agora. Fale com a loja pelo WhatsApp, por favor.');
    }
  }
  run('INSERT INTO chat_messages (session_id, papel, texto) VALUES (?, ?, ?)', sess.id, 'user', texto);
  const historico = all('SELECT papel, texto FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 24', sess.id).reverse();

  let r; let via = 'ia';
  const key = iaKey();
  if (key) {
    try { r = await gerar(key, prompt(store, cfg, bot, sess, vAtual), historico); } catch (e) { console.error('bot ia', e.message); r = null; }
  }
  if (!r) { r = roteiro(store, cfg, sess, texto, vAtual, historico); via = 'roteiro'; }

  // Dados do cliente.
  const L = r.lead && typeof r.lead === 'object' ? r.lead : {};
  const d = { ...sess.dados };
  const tel = C.fone(L.telefone || '');
  if (tel.length >= 10 && tel.length <= 11) d.telefone = tel;
  else { const m = texto.match(RE_TEL); if (m) d.telefone = m[1] + m[2] + m[3] + m[4]; }
  if (str(L.nome) && !/^(cliente|não informado)$/i.test(L.nome)) d.nome = str(L.nome, 80);
  if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(str(L.email))) d.email = str(L.email, 120).toLowerCase();
  if (Number(L.orcamento) > 0) d.orcamento = Math.round(Number(L.orcamento));
  if (str(L.troca)) d.troca = str(L.troca, 200);
  if (CRM.PAGAMENTOS[L.pagamento] !== undefined && L.pagamento) d.pagamento = L.pagamento;
  if (str(L.interesse)) d.interesse = str(L.interesse, 200);
  const temp = CRM.TEMPERATURAS[r.temperatura] ? r.temperatura : null;

  // Carros a mostrar (só os da loja e disponíveis).
  const ids = [...new Set([...(Array.isArray(r.mostrar_veiculos) ? r.mostrar_veiculos : []), r.fotos_de].map(Number).filter(Boolean))].slice(0, 4);
  const veiculos = ids.map((id) => veicCard(store, id, Number(r.fotos_de) === id)).filter(Boolean);

  const acoes = [];
  let whatsapp = '';
  let leadId = sess.lead_id;
  const resumoConversa = () => historico.slice(-6).map((m) => `${m.papel === 'user' ? 'Cliente' : 'Assistente'}: ${m.texto}`).join('\n');
  if (d.telefone && !teste) {
    if (!leadId) {
      const res = CRM.createLead(store.id, { nome: d.nome, telefone: d.telefone, email: d.email, vehicle_id: vAtual?.id || ids[0], interesse: d.interesse, mensagem: 'Conversa pelo assistente do site' }, { origem: 'bot' });
      leadId = res.id;
      run('UPDATE chat_sessions SET lead_id = ? WHERE id = ?', leadId, sess.id);
      CRM.addEvent(leadId, 'bot', `Conversa no assistente do site:\n${resumoConversa()}`);
      acoes.push('lead');
    }
    const l = get('SELECT * FROM leads WHERE id = ?', leadId);
    if (l) {
      const sets = []; const vals = [];
      const up = (col, val) => { if (val && !l[col]) { sets.push(`${col} = ?`); vals.push(val); } };
      up('nome', d.nome); up('email', d.email); up('orcamento', d.orcamento); up('troca', d.troca); up('pagamento', d.pagamento); up('interesse', d.interesse);
      if (temp && temp !== l.temperatura) { sets.push('temperatura = ?'); vals.push(temp); }
      sets.push('ultimo_contato = ?'); vals.push(new Date().toISOString().replace('T', ' ').slice(0, 19));
      run(`UPDATE leads SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`, ...vals, l.id);
    }
  } else if (d.telefone && teste && !sess.dados.telefone) acoes.push('lead');

  if (r.agendar && r.agendar.data && r.agendar.hora && d.telefone && !d.visita) {
    const dh = `${str(r.agendar.data, 10)}T${str(r.agendar.hora, 5)}`;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dh)) {
      if (!teste && leadId) {
        try {
          const sys = { storeId: store.id, id: null, perms: new Set(['gestao']) };
          CRM.addVisit(sys, { lead_id: leadId, data_hora: dh, tipo: r.agendar.tipo === 'test_drive' ? 'test_drive' : 'visita', vehicle_id: vAtual?.id || ids[0] }, { origem: 'agendada pelo assistente do site' });
        } catch (e) { console.error('bot visita', e.message); }
      }
      d.visita = dh.replace('T', ' ');
      acoes.push('visita');
    }
  }
  if (r.chamar_humano) {
    const n = String(store.whatsapp || store.phone || '').replace(/\D/g, '');
    if (n.length >= 10) whatsapp = `https://wa.me/${n.startsWith('55') ? n : '55' + n}?text=${encodeURIComponent(`Olá! Vim pelo site${d.nome ? `, sou ${d.nome}` : ''}${vAtual ? ` e tenho interesse no ${vAtual.marca} ${vAtual.modelo}` : ''}.`)}`;
    if (!teste && leadId) {
      run(`UPDATE leads SET precisa_humano = 1, temperatura = 'quente', updated_at = datetime('now') WHERE id = ?`, leadId);
      CRM.addEvent(leadId, 'bot', `🙋 Pediu atendimento humano no assistente do site:\n${resumoConversa()}`);
    }
    acoes.push('humano');
  }
  run(`UPDATE chat_sessions SET dados = ?, updated_at = datetime('now') WHERE id = ?`, JSON.stringify(d), sess.id);
  const resposta = str(r.resposta, 1500);
  run('INSERT INTO chat_messages (session_id, papel, texto, meta) VALUES (?, ?, ?, ?)', sess.id, 'bot', resposta, JSON.stringify({ veiculos: ids, fotos_de: Number(r.fotos_de) || null, via, acoes }));
  return { sid: sess.id, mensagens: [{ papel: 'bot', texto: resposta, veiculos }], whatsapp, acoes, via, dados: teste ? d : undefined };
}

function veicCard(store, id, todas) {
  const v = get(`SELECT * FROM vehicles WHERE id = ? AND store_id = ? AND status IN ('pronto','publicado')`, Number(id), store.id);
  return v ? card(store, v, todas) : null;
}

/* ---------------- Painel ---------------- */
function conversas(storeId) {
  return all(`SELECT s.id, s.lead_id, s.teste, s.created_at, s.updated_at, s.dados, l.nome AS lead_nome, v.marca, v.modelo,
      (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id AND m.papel = 'user') AS msgs
    FROM chat_sessions s LEFT JOIN leads l ON l.id = s.lead_id LEFT JOIN vehicles v ON v.id = s.vehicle_id
    WHERE s.store_id = ? AND s.teste = 0 AND EXISTS (SELECT 1 FROM chat_messages m WHERE m.session_id = s.id AND m.papel = 'user')
    ORDER BY s.updated_at DESC LIMIT 100`, storeId).map((s) => ({ ...s, dados: json(s.dados, {}) }));
}
function conversa(storeId, sid) {
  const s = get('SELECT * FROM chat_sessions WHERE id = ? AND store_id = ?', String(sid), storeId);
  if (!s) throw httpError(404, 'Conversa não encontrada.');
  return { sessao: { ...s, dados: json(s.dados, {}) }, mensagens: all('SELECT papel, texto, created_at FROM chat_messages WHERE session_id = ? ORDER BY id', s.id) };
}
function status(storeId) {
  return { ...botConfig(storeId), ia: !!iaKey(), conversas_7d: get(`SELECT COUNT(*) n FROM chat_sessions WHERE store_id = ? AND teste = 0 AND created_at >= datetime('now','-7 days') AND EXISTS (SELECT 1 FROM chat_messages m WHERE m.session_id = chat_sessions.id AND m.papel = 'user')`, storeId).n,
    leads_7d: get(`SELECT COUNT(*) n FROM leads WHERE store_id = ? AND origem = 'bot' AND created_at >= datetime('now','-7 days')`, storeId).n };
}

/* ---------------- Widget do site ---------------- */
// Script do chat incluído na vitrine e na página do carro.
function widget(store, vehicleId) {
  const bot = botConfig(store.id);
  if (!bot.ativo) return '';
  const cfg = JSON.stringify({ api: `/api/public/${store.slug}/chat`, v: Number(vehicleId) || null, nome: bot.nome, loja: store.name }).replace(/</g, '\\u003c');
  return `<div id="gaChat"></div><script>window.GA_CHAT=${cfg};</script><script src="/chat-widget.js" defer></script>`;
}

module.exports = { botConfig, saveBotConfig, conversar, conversas, conversa, status, widget, prompt, roteiro, card };
