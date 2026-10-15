// Assistente no WhatsApp (v2.11): recebe as mensagens do número da loja pela API oficial (webhook da Meta),
// responde com o mesmo assistente de vendas do site, manda as fotos dos carros e registra tudo no CRM.
// Quando o cliente pede um atendente ou um vendedor responde pelo GiroAuto, o assistente pausa naquela conversa.
const crypto = require('node:crypto');
const config = require('./config');
const { get, all, run } = require('./db');
const { encrypt, decrypt } = require('./crypto');
const C = require('./contatos');
const CRM = require('./crm');

const str = (x, max = 500) => String(x ?? '').trim().slice(0, max);
const httpError = (status, message) => Object.assign(new Error(message), { status });
const graph = (p) => `${config.meta.graphUrl}/${config.meta.apiVersion}/${p}`;
const json = (s, d) => { try { return JSON.parse(s || ''); } catch { return d; } };

/* ---------------- Configuração ---------------- */
function readSetting(k) { return get('SELECT value FROM settings WHERE key = ?', k)?.value || ''; }
function verifyToken() {
  let t = readSetting('wa_verify_token');
  if (!t) { t = crypto.randomBytes(16).toString('hex'); run("INSERT INTO settings (key, value) VALUES ('wa_verify_token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", t); }
  return t;
}
const webhookUrl = () => `${config.publicUrl}/api/wa/webhook`;

function cfgOf(store) { return C.cloudCfg ? C.cloudCfg(store) : {}; }

function status(storeId) {
  const store = get('SELECT * FROM stores WHERE id = ?', storeId);
  const c = cfgOf(store);
  const bot = require('./bot').botConfig(storeId);
  return {
    pronto: !!(c.token && c.phone_id), ativo: !!bot.whatsapp, waba_id: c.waba_id || '', inscrito: !!c.inscrito, tem_app_secret: !!c.app_secret_enc,
    webhook_url: webhookUrl(), ultima: get(`SELECT MAX(m.created_at) t FROM chat_messages m JOIN chat_sessions s ON s.id = m.session_id WHERE s.store_id = ? AND s.canal = 'whatsapp' AND m.papel = 'user'`, storeId)?.t || null,
    conversas_7d: get(`SELECT COUNT(*) n FROM chat_sessions WHERE store_id = ? AND canal = 'whatsapp' AND updated_at >= datetime('now','-7 days')`, storeId).n,
  };
}

async function salvar(storeId, b) {
  const store = get('SELECT * FROM stores WHERE id = ?', storeId);
  const raw = json(store.wa_cloud, {});
  if (b.waba_id !== undefined) raw.waba_id = str(b.waba_id, 40).replace(/\D/g, '');
  if (b.app_secret) raw.app_secret_enc = encrypt(str(b.app_secret, 100));
  if (b.app_secret === '') delete raw.app_secret_enc;
  run('UPDATE stores SET wa_cloud = ? WHERE id = ?', JSON.stringify(raw), storeId);
  if (b.ativo !== undefined) require('./bot').saveBotConfig(storeId, { whatsapp: !!b.ativo });
  // Inscreve a conta do WhatsApp (WABA) no app, para a Meta mandar as mensagens para o GiroAuto.
  if (b.inscrever) {
    const c = cfgOf(get('SELECT * FROM stores WHERE id = ?', storeId));
    if (!c.token || !c.phone_id) throw httpError(400, 'Configure primeiro o token e o ID do número (WhatsApp automático).');
    if (!raw.waba_id) throw httpError(400, 'Informe o ID da conta do WhatsApp Business (WABA).');
    const r = await fetch(graph(`${raw.waba_id}/subscribed_apps`), { method: 'POST', headers: { Authorization: `Bearer ${c.token}` } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) throw httpError(400, `A Meta recusou: ${d.error?.message || `HTTP ${r.status}`}`);
    raw.inscrito = true;
    run('UPDATE stores SET wa_cloud = ? WHERE id = ?', JSON.stringify(raw), storeId);
  }
  return status(storeId);
}

/* ---------------- Envio ---------------- */
async function send(c, body) {
  const r = await fetch(graph(`${c.phone_id}/messages`), {
    method: 'POST', headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...body }), signal: AbortSignal.timeout(20000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) {
    const code = d.error?.code;
    const msg = code === 131047 || /re-engagement|24 hours/i.test(d.error?.message || '')
      ? 'Passaram mais de 24 horas desde a última mensagem do cliente: o WhatsApp só permite responder com um modelo aprovado.'
      : d.error?.error_data?.details || d.error?.message || `HTTP ${r.status}`;
    throw httpError(400, msg);
  }
  return d.messages?.[0]?.id || '';
}
const sendText = (c, to, text) => send(c, { to, type: 'text', text: { body: String(text).slice(0, 4000), preview_url: true } });
const sendImage = (c, to, link, caption) => send(c, { to, type: 'image', image: { link, ...(caption ? { caption: String(caption).slice(0, 1000) } : {}) } });

/* ---------------- Recebimento ---------------- */
function assinaturaOk(raw, header) {
  const sig = String(header || '').replace(/^sha256=/, '');
  if (!sig || !raw) return false;
  const segredos = [config.meta.appSecret];
  for (const s of all(`SELECT wa_cloud FROM stores WHERE wa_cloud LIKE '%app_secret_enc%'`)) {
    try { segredos.push(decrypt(JSON.parse(s.wa_cloud).app_secret_enc)); } catch { /* ignora */ }
  }
  return segredos.filter(Boolean).some((sec) => {
    const h = crypto.createHmac('sha256', sec).update(raw).digest('hex');
    return h.length === sig.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(sig));
  });
}

const sidDe = (storeId, tel) => crypto.createHash('sha1').update(`wa:${storeId}:${tel}`).digest('hex').slice(0, 24);
const brl = (n) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR');

async function transcrever(c, mediaId) {
  const key = require('./settings').chatAi().key;
  if (!key) return '';
  const m = await (await fetch(graph(mediaId), { headers: { Authorization: `Bearer ${c.token}` } })).json().catch(() => ({}));
  if (!m.url) return '';
  const bin = Buffer.from(await (await fetch(m.url, { headers: { Authorization: `Bearer ${c.token}` } })).arrayBuffer());
  if (bin.length > 15 * 1024 * 1024) return '';
  const base = (process.env.GEMINI_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
  for (const model of ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite']) {
    const r = await fetch(`${base}/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Transcreva este áudio (português do Brasil). Responda só com o texto falado.' }, { inline_data: { mime_type: (m.mime_type || 'audio/ogg').split(';')[0], data: bin.toString('base64') } }] }] }),
    }).catch(() => null);
    if (!r || !r.ok) continue;
    const d = await r.json().catch(() => ({}));
    const t = (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
    if (t) return t;
  }
  return '';
}

async function textoDe(c, msg) {
  switch (msg.type) {
    case 'text': return msg.text?.body || '';
    case 'button': return msg.button?.text || '';
    case 'interactive': return msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '';
    case 'audio': {
      const t = await transcrever(c, msg.audio?.id).catch(() => '');
      return t ? `🎤 ${t}` : '[o cliente mandou um áudio que não consegui ouvir]';
    }
    case 'image': return `[o cliente mandou uma foto${msg.image?.caption ? `: ${msg.image.caption}` : ''}]`;
    case 'video': return '[o cliente mandou um vídeo]';
    case 'document': return `[o cliente mandou um documento${msg.document?.filename ? ` (${msg.document.filename})` : ''}]`;
    case 'location': return '[o cliente mandou a localização]';
    case 'sticker': return '[figurinha]';
    default: return '';
  }
}

// Processa o corpo do webhook (já com a assinatura conferida).
async function processar(payload) {
  for (const entry of payload?.entry || []) {
    for (const ch of entry.changes || []) {
      if (ch.field !== 'messages') continue;
      const v = ch.value || {};
      const phoneId = String(v.metadata?.phone_number_id || '');
      if (!phoneId || !v.messages?.length) continue;
      const store = all(`SELECT * FROM stores WHERE wa_cloud LIKE ?`, `%${phoneId}%`).find((s) => cfgOf(s).phone_id === phoneId);
      if (!store) continue;
      const c = cfgOf(store);
      const perfis = Object.fromEntries((v.contacts || []).map((k) => [k.wa_id, k.profile?.name || '']));
      for (const msg of v.messages) {
        try {
          if (get('SELECT 1 FROM wa_inbound WHERE id = ?', msg.id)) continue;
          run('INSERT INTO wa_inbound (id, store_id) VALUES (?, ?)', msg.id, store.id);
          await responder(store, c, msg, perfis[msg.from] || '');
        } catch (e) { console.error('wa bot', store.id, e.message); }
      }
    }
  }
}

async function responder(store, c, msg, perfil) {
  const BOT = require('./bot');
  const from = String(msg.from || '');
  const tel = C.fone(from);
  const texto = await textoDe(c, msg);
  if (!texto) return;
  const sid = sidDe(store.id, tel);
  const bot = BOT.botConfig(store.id);
  const sess = BOT.sessao(store.id, sid, { fixo: sid, canal: 'whatsapp', contato: tel });
  const pausado = sess.pausado_ate && Date.parse(sess.pausado_ate.replace(' ', 'T') + 'Z') > Date.now();
  if (!bot.whatsapp || pausado) {
    // Só registra: o vendedor responde (pelo GiroAuto ou pelo celular).
    run('INSERT INTO chat_messages (session_id, papel, texto) VALUES (?, ?, ?)', sid, 'user', texto);
    run(`UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?`, sid);
    let leadId = sess.lead_id;
    if (!leadId) {
      leadId = CRM.createLead(store.id, { nome: perfil, telefone: tel, mensagem: texto }, { origem: 'whatsapp' }).id;
      run('UPDATE chat_sessions SET lead_id = ? WHERE id = ?', leadId, sid);
    } else CRM.addEvent(leadId, 'whatsapp', `Cliente no WhatsApp: ${texto}`);
    run(`UPDATE leads SET ultimo_contato = datetime('now'), updated_at = datetime('now') WHERE id = ?`, leadId);
    return;
  }
  send(c, { status: 'read', message_id: msg.id }).catch(() => {});
  const r = await BOT.conversar(store, { sid, texto }, { canal: 'whatsapp', telefone: tel, perfil });
  const resp = r.mensagens?.[0];
  if (resp?.texto) await sendText(c, from, resp.texto);
  // Fotos dos carros indicados pela IA (no máximo 6 imagens por resposta).
  let enviadas = 0;
  for (const v of resp?.veiculos || []) {
    const fotos = v.fotos.length > 3 ? v.fotos.slice(0, 6) : v.fotos.slice(0, 1);
    for (const [i, f] of fotos.entries()) {
      if (enviadas >= 6) break;
      const legenda = i === 0 ? `${v.titulo} ${v.ano}\n${Number(v.km || 0).toLocaleString('pt-BR')} km · ${brl(v.preco)}${v.oferta ? ' (oferta)' : ''}\n${config.publicUrl}${v.url}` : '';
      await sendImage(c, from, `${config.publicUrl}${f}`, legenda).catch((e) => console.error('wa foto', e.message));
      enviadas++;
    }
  }
}

/* ---------------- Vendedor responde pelo GiroAuto ---------------- */
async function responderComoLoja(user, leadId, texto) {
  const l = CRM.findFor(user, leadId);
  const t = str(texto, 4000);
  if (!t) throw httpError(400, 'Escreva a mensagem.');
  if (!l.telefone) throw httpError(400, 'Este lead não tem telefone.');
  const store = get('SELECT * FROM stores WHERE id = ?', user.storeId);
  const c = cfgOf(store);
  if (!c.token || !c.phone_id) throw httpError(400, 'O WhatsApp automático (API oficial) não está configurado nesta loja.');
  await sendText(c, `55${l.telefone}`, t);
  const sid = sidDe(store.id, l.telefone);
  require('./bot').sessao(store.id, sid, { fixo: sid, canal: 'whatsapp', contato: l.telefone });
  run('UPDATE chat_sessions SET lead_id = COALESCE(lead_id, ?), pausado_ate = datetime(\'now\', \'+12 hours\'), updated_at = datetime(\'now\') WHERE id = ?', l.id, sid);
  run('INSERT INTO chat_messages (session_id, papel, texto, meta) VALUES (?, ?, ?, ?)', sid, 'loja', t, JSON.stringify({ user: user.name || '' }));
  CRM.note(user, l.id, { tipo: 'whatsapp', texto: `Você no WhatsApp: ${t}` });
}

// Liga/desliga o assistente numa conversa (o vendedor assume ou devolve para o assistente).
function pausar(user, leadId, pausar = true) {
  const l = CRM.findFor(user, leadId);
  const sid = sidDe(user.storeId, l.telefone || '');
  if (!get('SELECT 1 FROM chat_sessions WHERE id = ?', sid)) return { pausado: false };
  run(`UPDATE chat_sessions SET pausado_ate = ${pausar ? "datetime('now', '+30 days')" : 'NULL'} WHERE id = ?`, sid);
  if (!pausar) run('UPDATE leads SET precisa_humano = 0 WHERE id = ?', l.id);
  CRM.addEvent(l.id, 'bot', pausar ? 'Assistente pausado nesta conversa do WhatsApp (vendedor assumiu)' : 'Assistente voltou a responder nesta conversa do WhatsApp', user.id);
  return { pausado: pausar };
}
function conversaDoLead(user, leadId) {
  const l = CRM.findFor(user, leadId);
  if (!l.telefone) return null;
  const s = get('SELECT * FROM chat_sessions WHERE id = ?', sidDe(user.storeId, l.telefone));
  if (!s) return null;
  return { pausado: !!(s.pausado_ate && Date.parse(s.pausado_ate.replace(' ', 'T') + 'Z') > Date.now()) };
}

module.exports = { verifyToken, webhookUrl, status, salvar, assinaturaOk, processar, responderComoLoja, pausar, conversaDoLead, sendText, sidDe };
