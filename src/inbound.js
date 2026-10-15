// Leads dos portais por e-mail (v2.10): Webmotors, OLX, iCarros, Mobiauto, Mercado Livre, NaPista e outros avisam
// os interessados por e-mail. O GiroAuto lê esses e-mails (caixa IMAP da loja, encaminhamento por webhook ou colando
// o texto) e cria o lead no CRM com nome, telefone, e-mail, mensagem e o carro do anúncio.
const crypto = require('node:crypto');
const { get, all, run } = require('./db');
const { encrypt, decrypt } = require('./crypto');
const C = require('./contatos');
const CRM = require('./crm');

const str = (x, max = 500) => String(x ?? '').trim().slice(0, max);
const httpError = (status, message) => Object.assign(new Error(message), { status });

const PORTAIS = [
  ['webmotors', /webmotors/i], ['olx', /\bolx\b/i], ['icarros', /icarros/i], ['mobiauto', /mobiauto/i],
  ['mercadolivre', /mercado\s?livre|mercadolivre|mercadolibre/i], ['napista', /napista|na pista/i],
  ['portal', /socarrao|s[oó] carr[aã]o|usadosbr|kavak|autoline|meucarronovo|carrosnaweb|autoplaza|motorshop/i],
];
const NOME_PORTAL = { webmotors: 'Webmotors', olx: 'OLX', icarros: 'iCarros', mobiauto: 'Mobiauto', mercadolivre: 'Mercado Livre', napista: 'NaPista' };
const DOM_IGNORAR = /(webmotors|olx|icarros|mobiauto|mercadolivre|mercadolibre|napista|socarrao|usadosbr|kavak|noreply|no-reply|nao-responda|naoresponda|mailer|notifica|google|gmail\.com\.br)/i;

function htmlParaTexto(h) {
  return String(h || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d|table)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}
const sem = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function rotulo(texto, nomes) {
  for (const n of nomes) {
    const re = new RegExp(`(?:^|\\n|\\s)${n}\\s*[:\\-–]\\s*([^\\n]{1,200})`, 'i');
    const m = texto.match(re);
    if (m && m[1].trim()) return m[1].trim();
  }
  return '';
}

/**
 * Extrai os dados do interessado de um e-mail de portal.
 * @returns {{portal: string, portal_nome: string, nome: string, telefone: string, email: string, mensagem: string, veiculo: string, placa: string}}
 */
function parse({ from = '', subject = '', text = '', html = '' }, store = {}) {
  const corpo = (text && text.trim().length > 30 ? text : htmlParaTexto(html) || text).replace(/\r/g, '');
  const tudo = `${from}\n${subject}\n${corpo}`;
  let portal = '';
  for (const [k, re] of PORTAIS) if (re.test(from) || re.test(subject)) { portal = k; break; }
  if (!portal) for (const [k, re] of PORTAIS) if (re.test(corpo)) { portal = k; break; }
  const nomePortal = NOME_PORTAL[portal] || (portal === 'portal' ? (tudo.match(PORTAIS[6][1]) || [''])[0] : '');

  let nome = rotulo(corpo, ['nome do (?:cliente|interessado|comprador)', 'nome completo', 'nome', 'cliente', 'interessado', 'comprador']);
  nome = nome.replace(/\s*(telefone|celular|e-?mail|whats).*$/i, '').replace(/[<>"]/g, '').trim();
  if (!nome) { const m = corpo.match(/(?:^|\n)\s*([A-ZÀ-Ú][a-zà-ú]+(?: [A-ZÀ-Ú][a-zà-ú]+){0,3}) (?:tem interesse|enviou|quer|gostaria|está interessad|fez uma proposta)/); if (m) nome = m[1]; }

  // Telefones (sem o da loja).
  const loja = C.fone(store.whatsapp || '') + '|' + C.fone(store.phone || '');
  const rotTel = rotulo(corpo, ['telefone', 'celular', 'whatsapp', 'fone', 'tel', 'contato']);
  const tels = [rotTel, corpo].join('\n').match(/(?:\+?55\s?)?\(?\b[1-9]{2}\)?[\s.-]?(?:9[\s.-]?)?\d{4}[\s.-]?\d{4}\b/g) || [];
  const telefone = tels.map((t) => C.fone(t)).find((t) => t.length >= 10 && t.length <= 11 && !loja.includes(t)) || '';

  const rotEmail = rotulo(corpo, ['e-?mail do (?:cliente|interessado)', 'e-?mail']);
  const emails = [rotEmail, corpo].join('\n').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const email = (emails.find((e) => !DOM_IGNORAR.test(e) && (!store.email || e.toLowerCase() !== store.email.toLowerCase())) || '').toLowerCase();

  let mensagem = rotulo(corpo, ['mensagem', 'coment[aá]rio', 'observa[cç][aã]o', 'pergunta', 'proposta']);
  if (!mensagem) { const m = corpo.match(/mensagem[^\n]*\n+([^\n]{3,400})/i); if (m) mensagem = m[1].trim(); }
  const veiculo = rotulo(corpo, ['ve[ií]culo', 'an[uú]ncio', 'modelo', 'carro', 'interesse no ve[ií]culo']) || (subject.match(/(?:interesse|proposta|contato)[^:]*:\s*(.+)$/i) || [])[1] || '';
  const placa = ((tudo.match(/\b([A-Z]{3})[-\s]?([0-9][A-Z0-9][0-9]{2})\b/) || []).slice(1).join('')).toUpperCase();
  return { portal: portal || '', portal_nome: nomePortal || '', nome: str(nome, 120), telefone, email, mensagem: str(mensagem, 1000), veiculo: str(veiculo, 200), placa };
}

// Acha o carro do anúncio no estoque: placa, ou marca + modelo (+ ano) citados no e-mail.
function acharVeiculo(storeId, dados, textoTodo) {
  const vs = all(`SELECT id, marca, modelo, versao, ano_fab, ano_modelo, placa, status FROM vehicles WHERE store_id = ? AND status != 'rascunho' ORDER BY status = 'vendido', updated_at DESC`, storeId);
  if (dados.placa) { const v = vs.find((x) => String(x.placa || '').toUpperCase().replace(/\W/g, '') === dados.placa); if (v) return v; }
  const alvo = sem(`${dados.veiculo}\n${textoTodo}`);
  let melhor = null; let nota = 0;
  for (const v of vs) {
    const modelo = sem(v.modelo); const marca = sem(v.marca);
    if (!modelo || !new RegExp(`\\b${modelo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(alvo)) continue;
    let n = 2;
    if (marca && alvo.includes(marca)) n += 1;
    if (v.ano_modelo && alvo.includes(String(v.ano_modelo))) n += 2;
    if (v.versao && alvo.includes(sem(v.versao))) n += 1;
    if (v.status !== 'vendido') n += 0.5;
    if (n > nota) { nota = n; melhor = v; }
  }
  return melhor;
}

/**
 * Processa um e-mail recebido e cria (ou atualiza) o lead.
 * @returns {{ok: boolean, lead_id?: number, novo?: boolean, dados: object, erro?: string}}
 */
async function processar(storeId, mail, { msgId = '' } = {}) {
  const store = get('SELECT * FROM stores WHERE id = ?', storeId) || {};
  if (msgId && get('SELECT 1 FROM inbound_emails WHERE store_id = ? AND msg_id = ?', storeId, msgId)) return { ok: true, duplicado: true, dados: {} };
  const dados = parse(mail, store);
  if (!dados.telefone && !dados.email) {
    const ia = await iaExtrair(mail).catch(() => null);
    if (ia) Object.assign(dados, Object.fromEntries(Object.entries(ia).filter(([, v]) => v)));
    dados.telefone = C.fone(dados.telefone || '');
  }
  const log = (status, extra = {}) => run('INSERT INTO inbound_emails (store_id, remetente, assunto, portal, lead_id, status, erro, msg_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    storeId, str(mail.from, 200), str(mail.subject, 300), dados.portal_nome || dados.portal, extra.lead_id || null, status, str(extra.erro, 300), str(msgId, 300));
  if (!dados.telefone && !dados.email) { log('ignorado', { erro: 'Não achei telefone nem e-mail do interessado.' }); return { ok: false, dados, erro: 'Não achei telefone nem e-mail do interessado neste e-mail.' }; }
  const v = acharVeiculo(storeId, dados, `${mail.subject || ''}\n${mail.text || htmlParaTexto(mail.html)}`);
  const origem = CRM.ORIGENS[dados.portal] ? dados.portal : 'portal';
  try {
    const r = CRM.createLead(storeId, {
      nome: dados.nome, telefone: dados.telefone && dados.telefone.length >= 10 ? dados.telefone : '', email: dados.email, vehicle_id: v?.id,
      origem_detalhe: dados.portal_nome || '', interesse: v ? '' : dados.veiculo,
      mensagem: [dados.mensagem, !v && dados.veiculo ? `Anúncio: ${dados.veiculo}` : ''].filter(Boolean).join(' · ') || `E-mail: ${str(mail.subject, 160)}`,
    }, { origem });
    log('ok', { lead_id: r.id });
    return { ok: true, lead_id: r.id, novo: r.novo, dados: { ...dados, vehicle_id: v?.id || null } };
  } catch (e) {
    log('erro', { erro: e.message });
    return { ok: false, dados, erro: e.message };
  }
}

// Plano B: pede à IA para ler e-mails em formato desconhecido.
async function iaExtrair(mail) {
  const key = require('./settings').ai().gemini.key;
  if (!key) return null;
  const base = (process.env.GEMINI_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
  const texto = str(`De: ${mail.from}\nAssunto: ${mail.subject}\n\n${mail.text || htmlParaTexto(mail.html)}`, 6000);
  for (const model of [process.env.GEMINI_CHAT_MODEL, 'gemini-flash-latest', 'gemini-2.5-flash'].filter(Boolean)) {
    const r = await fetch(`${base}/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: `Este é um e-mail de um portal de anúncios de veículos avisando sobre um cliente interessado. Extraia os dados DO CLIENTE (não do portal nem da loja). Responda só JSON: {"nome":"","telefone":"","email":"","mensagem":"","veiculo":""}\n\n${texto}` }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } }),
    });
    if (r.status === 404) continue;
    if (!r.ok) return null;
    const d = await r.json();
    try { return JSON.parse((d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('')); } catch { return null; }
  }
  return null;
}

/* ---------------- Configuração (webhook e IMAP) ---------------- */
function cfg(storeId) { return CRM.config(storeId).email || {}; }
function token(storeId) {
  const c = cfg(storeId);
  if (c.token) return c.token;
  const t = crypto.randomBytes(16).toString('hex');
  CRM.saveConfig(storeId, { email: { ...c, token: t } });
  return t;
}
function storeByToken(t) {
  if (!/^[a-f0-9]{32}$/.test(String(t))) return null;
  return all(`SELECT id, crm_config FROM stores WHERE crm_config LIKE ?`, `%${t}%`).find((s) => { try { return JSON.parse(s.crm_config).email?.token === t; } catch { return false; } }) || null;
}

function publicCfg(storeId, baseUrl) {
  const c = cfg(storeId);
  return {
    webhook_url: `${baseUrl}/api/inbound/email/${token(storeId)}`,
    imap: { ativo: !!c.imap_ativo, host: c.host || '', port: c.port || 993, user: c.user || '', tem_senha: !!c.pass_enc, todos: !!c.todos, ultimo_check: c.ultimo_check || '', erro: c.erro || '' },
    recentes: all('SELECT remetente, assunto, portal, lead_id, status, erro, created_at FROM inbound_emails WHERE store_id = ? ORDER BY id DESC LIMIT 20', storeId),
  };
}

function saveImap(storeId, b) {
  const c = cfg(storeId);
  const host = str(b.host, 120) || (/@(gmail|googlemail)\.com$/i.test(str(b.user)) ? 'imap.gmail.com' : /@(outlook|hotmail|live)\./i.test(str(b.user)) ? 'outlook.office365.com' : c.host || '');
  const novo = { ...c, imap_ativo: !!b.ativo, host, port: Number(b.port) || 993, user: str(b.user, 160), todos: !!b.todos, erro: '' };
  if (b.senha) novo.pass_enc = encrypt(String(b.senha).replace(/\s+/g, ''));
  if (b.remover) { delete novo.pass_enc; novo.imap_ativo = false; novo.user = ''; novo.host = ''; }
  if (novo.imap_ativo && (!novo.host || !novo.user || !novo.pass_enc)) throw httpError(400, 'Informe o servidor, o e-mail e a senha de app.');
  if (!c.desde || novo.user !== c.user) novo.desde = new Date(Date.now() - 2 * 864e5).toISOString();
  CRM.saveConfig(storeId, { email: novo });
}

async function imapCheck(storeId, { teste = false } = {}) {
  const c = cfg(storeId);
  if (!c.host || !c.user || !c.pass_enc) throw httpError(400, 'Configure a caixa de e-mail primeiro.');
  const { ImapFlow } = require('imapflow');
  const { simpleParser } = require('mailparser');
  const client = new ImapFlow({ host: c.host, port: c.port || 993, secure: true, auth: { user: c.user, pass: decrypt(c.pass_enc) }, logger: false, socketTimeout: 30000 });
  let lidos = 0; let leads = 0;
  try {
    await client.connect();
    if (teste) { await client.logout(); CRM.saveConfig(storeId, { email: { ...cfg(storeId), erro: '' } }); return { ok: true, lidos: 0, leads: 0 }; }
    const lock = await client.getMailboxLock('INBOX');
    try {
      const desde = new Date(c.desde || Date.now() - 864e5);
      const uids = (await client.search({ since: desde }, { uid: true })) || [];
      const novos = uids.filter((u) => u > (c.ultimo_uid || 0)).slice(-60);
      let maxUid = c.ultimo_uid || 0;
      for await (const msg of client.fetch(novos, { source: true, envelope: true, uid: true }, { uid: true })) {
        maxUid = Math.max(maxUid, msg.uid);
        const from = msg.envelope?.from?.map((f) => `${f.name || ''} <${f.address}>`).join(', ') || '';
        const subject = msg.envelope?.subject || '';
        if (!c.todos && !PORTAIS.some(([, re]) => re.test(from) || re.test(subject))) continue;
        lidos++;
        const p = await simpleParser(msg.source);
        const r = await processar(storeId, { from, subject, text: p.text || '', html: p.html || '' }, { msgId: p.messageId || `uid:${msg.uid}` });
        if (r.ok && r.lead_id) leads++;
      }
      CRM.saveConfig(storeId, { email: { ...cfg(storeId), ultimo_uid: maxUid, ultimo_check: new Date().toISOString(), erro: '' } });
    } finally { lock.release(); }
    await client.logout();
  } catch (e) {
    const msg = /auth|login|credentials|invalid/i.test(e.responseText || e.message) ? 'O e-mail recusou o login. Confira o e-mail e a senha de app.' : (e.responseText || e.message || 'Falha ao ler a caixa de e-mail.');
    CRM.saveConfig(storeId, { email: { ...cfg(storeId), erro: msg, ultimo_check: new Date().toISOString() } });
    try { await client.logout(); } catch { /* conexão já fechada */ }
    throw httpError(400, msg);
  }
  return { ok: true, lidos, leads };
}

// Verifica as caixas de e-mail das lojas a cada 3 minutos.
let timer = null;
function startPolling() {
  if (timer || process.env.GIROAUTO_SKIP_IMAP) return;
  timer = setInterval(async () => {
    for (const s of all(`SELECT id, crm_config FROM stores WHERE crm_config LIKE '%"imap_ativo":true%'`)) {
      await imapCheck(s.id).catch((e) => console.error('imap', s.id, e.message));
    }
  }, 3 * 60 * 1000);
  timer.unref?.();
}

// Corpo do webhook: Postmark, Mailgun, SendGrid, Cloudflare Email Workers ou JSON simples.
function fromWebhook(b) {
  const pick = (...ks) => { for (const k of ks) if (b[k]) return typeof b[k] === 'object' ? (b[k].text || b[k].Email || JSON.stringify(b[k])) : String(b[k]); return ''; };
  return {
    from: pick('from', 'From', 'sender', 'FromFull'), subject: pick('subject', 'Subject'),
    text: pick('text', 'TextBody', 'body-plain', 'stripped-text', 'plain'), html: pick('html', 'HtmlBody', 'body-html'),
    msgId: pick('message-id', 'Message-Id', 'MessageID', 'messageId'),
  };
}

module.exports = { parse, processar, acharVeiculo, publicCfg, saveImap, imapCheck, startPolling, storeByToken, fromWebhook, htmlParaTexto, token };
