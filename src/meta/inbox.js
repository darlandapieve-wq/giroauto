// v2.20: mensagens e comentários da Página do Facebook e do Instagram entram no CRM.
// Recebe o webhook da Meta (objetos "page" e "instagram"): Messenger, Direct do Instagram,
// comentários nas publicações (orgânicas e de anúncios) e a origem do anúncio (referral).
// Só registra: nenhuma resposta automática é enviada.
const crypto = require('node:crypto');
const config = require('../config');
const graph = require('./graph');
const { get, all, run } = require('../db');

const PAGE_FIELDS = 'messages,messaging_postbacks,messaging_referrals,feed';
const IG_FIELDS = 'messages,comments';
const PERMISSOES = ['pages_messaging', 'pages_manage_metadata', 'pages_read_user_content', 'instagram_basic', 'instagram_manage_messages'];
const CANAL = { messenger: 'Messenger', fb_comentario: 'comentário no Facebook', instagram: 'Direct do Instagram', ig_comentario: 'comentário no Instagram' };

const str = (x, max = 500) => String(x ?? '').trim().slice(0, max);
const json = (s, d) => { try { return JSON.parse(s || ''); } catch { return d; } };
const webhookUrl = () => `${config.publicUrl}/api/meta/webhook`;
const verifyToken = () => require('../wabot').verifyToken();

function lerEstado(storeId) { return json(get('SELECT value FROM settings WHERE key = ?', `inbox_${storeId}`)?.value, {}); }
function gravarEstado(storeId, e) {
  run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`, `inbox_${storeId}`, JSON.stringify(e));
}

// Token da Página (pedido com o token do usuário conectado), guardado só em memória.
const tokensPagina = new Map();
async function tokenDaPagina(storeId) {
  const c = tokensPagina.get(storeId);
  if (c && Date.now() - c.at < 6 * 3600e3) return c.token;
  const { conn, token } = require('./service').tokenFor(storeId);
  if (!conn.page_id) throw Object.assign(new Error('Escolha a Página da loja em Configurações > Facebook e Instagram.'), { status: 400 });
  const p = await graph.get(`/${conn.page_id}`, token, { fields: 'access_token' });
  if (!p.access_token) throw new Error('A Meta não devolveu o acesso à Página (você é administrador dela?).');
  tokensPagina.set(storeId, { token: p.access_token, at: Date.now() });
  return p.access_token;
}

/* ---------------- Ativação ---------------- */
// 1) webhook do app (page + instagram) apontando para o GiroAuto; 2) Página inscrita no app.
// O Instagram profissional ligado à Página chega pelo mesmo app, sem inscrição separada.
async function ativar(storeId) {
  const { conn, token } = require('./service').tokenFor(storeId);
  if (!conn.page_id) throw Object.assign(new Error('Escolha a Página da loja em Configurações > Facebook e Instagram.'), { status: 400 });
  const e = { at: new Date().toISOString(), page_id: conn.page_id, ig_user_id: conn.ig_user_id || '' };
  const perms = await require('../channels').grantedPermissions(token).catch(() => null);
  e.faltam = perms ? PERMISSOES.filter((p) => !perms.granted.includes(p) && (conn.ig_user_id || !p.startsWith('instagram'))) : [];
  const appTok = `${config.meta.appId}|${config.meta.appSecret}`;
  const assinar = (object, fields) => graph.post(`/${config.meta.appId}/subscriptions`, null, {
    object, callback_url: webhookUrl(), verify_token: verifyToken(), fields, include_values: 'true', access_token: appTok,
  }).then(() => 'ok').catch((x) => `erro: ${x.message}`);
  e.app_page = await assinar('page', PAGE_FIELDS);
  e.app_instagram = conn.ig_user_id ? await assinar('instagram', IG_FIELDS) : 'sem Instagram ligado à Página';
  tokensPagina.delete(storeId);
  e.pagina = await tokenDaPagina(storeId)
    .then((pt) => graph.post(`/${conn.page_id}/subscribed_apps`, pt, { subscribed_fields: PAGE_FIELDS }))
    .then(() => 'ok').catch((x) => `erro: ${x.message}`);
  gravarEstado(storeId, e);
  require('../db').logEvent(storeId, `Mensagens do Facebook/Instagram no CRM: Página ${e.pagina}, webhook ${e.app_page}`);
  return status(storeId);
}

function status(storeId) {
  const e = lerEstado(storeId);
  const conn = get('SELECT page_id, page_name, ig_user_id, ig_username FROM meta_connections WHERE store_id = ?', storeId) || {};
  const mudouPagina = e.page_id && e.page_id !== conn.page_id;
  return {
    permissao_ligada: (config.meta.extraScopes || []).includes('mensagens'),
    ativo: e.pagina === 'ok' && e.app_page === 'ok' && !mudouPagina,
    mudou_pagina: !!mudouPagina,
    pagina: e.pagina || '', app_page: e.app_page || '', app_instagram: e.app_instagram || '', faltam: e.faltam || [], at: e.at || null,
    page_name: conn.page_name || '', ig_username: conn.ig_username || '', webhook_url: webhookUrl(),
    ultima: get(`SELECT MAX(m.created_at) t FROM chat_messages m JOIN chat_sessions s ON s.id = m.session_id WHERE s.store_id = ? AND s.canal IN ('messenger','instagram') AND m.papel = 'user'`, storeId)?.t || null,
    conversas_7d: get(`SELECT COUNT(*) n FROM chat_sessions WHERE store_id = ? AND canal IN ('messenger','instagram') AND updated_at >= datetime('now','-7 days')`, storeId).n,
  };
}

/* ---------------- Recebimento ---------------- */
const jaVisto = (id, storeId) => {
  if (!id) return false;
  if (get('SELECT 1 FROM wa_inbound WHERE id = ?', id)) return true;
  run('INSERT INTO wa_inbound (id, store_id) VALUES (?, ?)', id, storeId);
  return false;
};

function textoDaMensagem(m) {
  if (!m) return '';
  if (m.text) return m.text;
  const tipos = (m.attachments || []).map((a) => a.type);
  if (tipos.includes('audio')) return '[o cliente mandou um áudio]';
  if (tipos.includes('image')) return '[o cliente mandou uma foto]';
  if (tipos.includes('video')) return '[o cliente mandou um vídeo]';
  if (tipos.includes('file')) return '[o cliente mandou um arquivo]';
  if (tipos.length) return '[o cliente mandou um anexo]';
  return '';
}

// Telefone digitado na conversa ("me chama no 44 99999-0000"): vira o telefone do lead.
function foneNoTexto(t) {
  const m = String(t || '').match(/(?:\+?55[\s-]?)?\(?\d{2}\)?[\s-]?(?:9[\s.-]?)?\d{4}[\s.-]?\d{4}/);
  if (!m) return '';
  const tel = require('../contatos').fone(m[0]);
  return tel && tel.length >= 10 && tel.length <= 11 ? tel : '';
}

// Anúncio de origem (clique para o Messenger/Direct): liga o lead à campanha e ao carro, quando for um só.
function campanhaDoAnuncio(storeId, ref) {
  if (!ref?.ad_id) return null;
  const c = get('SELECT id, name FROM campaigns WHERE store_id = ? AND meta_ad_id = ?', storeId, String(ref.ad_id));
  const vs = c ? all('SELECT vehicle_id FROM campaign_vehicles WHERE campaign_id = ?', c.id) : [];
  return { nome: c?.name || ref.ads_context_data?.ad_title || `anúncio ${ref.ad_id}`, vehicle_id: vs.length === 1 ? vs[0].vehicle_id : null };
}

async function nomeDoPerfil(storeId, id, instagram) {
  try {
    const pt = await tokenDaPagina(storeId);
    const p = await graph.get(`/${id}`, pt, { fields: instagram ? 'name,username' : 'first_name,last_name' });
    return instagram ? (p.name || (p.username ? `@${p.username}` : '')) : [p.first_name, p.last_name].filter(Boolean).join(' ');
  } catch { return ''; }
}

/**
 * Registra no CRM: uma conversa (chat_sessions) por pessoa e canal, com o lead ligado a ela.
 * @param {object} store
 * @param {{canal:'messenger'|'instagram', tipo:string, remetente:string, nome?:string, texto:string, anuncio?:object, link?:string}} m
 */
async function registrar(store, m) {
  const CRM = require('../crm');
  const BOT = require('../bot');
  const texto = str(m.texto, 2000);
  if (!texto || !m.remetente) return null;
  const sid = crypto.createHash('sha1').update(`${m.canal}:${store.id}:${m.remetente}`).digest('hex').slice(0, 24);
  const sess = BOT.sessao(store.id, sid, { fixo: sid, canal: m.canal, contato: m.remetente });
  const rotulo = CANAL[m.tipo] || m.canal;
  run('INSERT INTO chat_messages (session_id, papel, texto, meta) VALUES (?, ?, ?, ?)', sid, 'user', texto, JSON.stringify({ tipo: m.tipo, link: m.link || '' }));
  run(`UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?`, sid);
  const tel = foneNoTexto(texto);
  let leadId = sess.lead_id && get('SELECT id FROM leads WHERE id = ?', sess.lead_id) ? sess.lead_id : null;
  if (!leadId) {
    const nome = m.nome || await nomeDoPerfil(store.id, m.remetente, m.canal === 'instagram') || `Cliente do ${m.canal === 'instagram' ? 'Instagram' : 'Messenger'}`;
    const detalhe = [rotulo, m.anuncio ? `anúncio "${m.anuncio.nome}"` : ''].filter(Boolean).join(' · ');
    leadId = CRM.createLead(store.id, {
      nome, telefone: tel, mensagem: texto, origem_detalhe: detalhe, vehicle_id: m.anuncio?.vehicle_id || null,
      obs: m.link ? `Publicação: ${m.link}` : '',
    }, { origem: m.canal === 'instagram' ? 'instagram' : 'messenger' }).id;
    run('UPDATE chat_sessions SET lead_id = ? WHERE id = ?', leadId, sid);
  } else {
    CRM.addEvent(leadId, 'contato', `Cliente (${rotulo}): ${texto}`);
    if (tel) run(`UPDATE leads SET telefone = ? WHERE id = ? AND COALESCE(telefone, '') = ''`, tel, leadId);
  }
  run(`UPDATE leads SET ultimo_contato = datetime('now'), updated_at = datetime('now') WHERE id = ?`, leadId);
  return leadId;
}

// Corpo do webhook (assinatura já conferida). Erros de um item não param os outros.
async function processar(payload) {
  const obj = payload?.object;
  if (obj !== 'page' && obj !== 'instagram') return;
  const ig = obj === 'instagram';
  for (const entry of payload.entry || []) {
    const contaId = String(entry.id || '');
    const conn = get(`SELECT store_id FROM meta_connections WHERE ${ig ? 'ig_user_id' : 'page_id'} = ?`, contaId);
    if (!conn) continue;
    const store = get('SELECT * FROM stores WHERE id = ?', conn.store_id);
    const canal = ig ? 'instagram' : 'messenger';
    for (const ev of entry.messaging || []) {
      try {
        const de = String(ev.sender?.id || '');
        if (!de || de === contaId || ev.message?.is_echo) continue;
        if (jaVisto(ev.message?.mid || (ev.postback ? `pb:${de}:${ev.timestamp}` : ''), store.id)) continue;
        const ref = ev.referral || ev.message?.referral || ev.postback?.referral;
        const texto = textoDaMensagem(ev.message) || ev.postback?.title || (ref ? '[abriu a conversa pelo anúncio]' : '');
        await registrar(store, { canal, tipo: canal, remetente: de, texto, anuncio: campanhaDoAnuncio(store.id, ref) });
      } catch (e) { console.error('inbox mensagem', store.id, e.message); }
    }
    for (const ch of entry.changes || []) {
      try {
        const v = ch.value || {};
        if (!ig && ch.field === 'feed' && v.item === 'comment' && v.verb === 'add') {
          const de = String(v.from?.id || '');
          if (!de || de === contaId || jaVisto(`fbc:${v.comment_id}`, store.id)) continue;
          await registrar(store, { canal: 'messenger', tipo: 'fb_comentario', remetente: de, nome: v.from?.name || '', texto: v.message || '[comentário sem texto]', link: v.post_id ? `https://facebook.com/${v.post_id}` : '' });
        } else if (ig && ch.field === 'comments') {
          const de = String(v.from?.id || '');
          if (!de || de === contaId || jaVisto(`igc:${v.id}`, store.id)) continue;
          await registrar(store, { canal: 'instagram', tipo: 'ig_comentario', remetente: de, nome: v.from?.username ? `@${v.from.username}` : '', texto: v.text || '[comentário sem texto]' });
        }
      } catch (e) { console.error('inbox comentário', store.id, e.message); }
    }
  }
}

function register(app, { team, wrap }) {
  app.get('/api/meta/webhook', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === verifyToken()) return res.type('text').send(String(req.query['hub.challenge'] || ''));
    res.sendStatus(403);
  });
  app.post('/api/meta/webhook', (req, res) => {
    if (!require('../wabot').assinaturaOk(req.rawBody, req.get('x-hub-signature-256'))) return res.sendStatus(401);
    res.sendStatus(200);
    processar(req.body).catch((e) => console.error('meta webhook', e.message));
  });
  app.get('/api/meta/inbox', team.can('config'), (req, res) => res.json(status(req.user.storeId)));
  app.post('/api/meta/inbox/ativar', team.can('config'), wrap(async (req, res) => res.json(await ativar(req.user.storeId))));
}

module.exports = { register, ativar, status, processar, registrar, foneNoTexto, PERMISSOES };
