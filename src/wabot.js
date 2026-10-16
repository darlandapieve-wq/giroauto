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
    pronto: !!(c.token && c.phone_id), ativo: !!bot.whatsapp, waba_id: c.waba_id || '', inscrito: !!c.inscrito, webhook: c.webhook || '', tem_app_secret: !!c.app_secret_enc,
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
  // Ativação em um clique: webhook do app, conta do WhatsApp (WABA) e inscrição da conta no app.
  if (b.inscrever) {
    const c = cfgOf(get('SELECT * FROM stores WHERE id = ?', storeId));
    if (!c.token || !c.phone_id) throw httpError(400, 'Configure primeiro o token e o ID do número (WhatsApp automático).');
    const info = await tokenInfo(c.token, c.phone_id).catch((e) => { diag.push(e.message); return null; });
    if (!raw.waba_id && info?.waba_ids?.length) raw.waba_id = info.waba_ids[0];
    if (!raw.waba_id) throw httpError(400, `Não consegui descobrir a conta do WhatsApp Business pelo token. Informe o ID da conta (WABA) que aparece em WhatsApp > Configuração da API.${diag.length ? ` (Meta: ${diag.slice(-3).join(' · ')})` : ''}`);
    // Webhook no app da Meta do GiroAuto (se o token for desse app): feito pela API, sem abrir o painel da Meta.
    if (config.meta.appId && config.meta.appSecret && (!info?.app_id || String(info.app_id) === String(config.meta.appId))) {
      raw.webhook = await assinarWebhook().then(() => 'ok').catch((e) => `erro: ${e.message}`);
    } else raw.webhook = 'outro_app';
    const r = await fetch(graph(`${raw.waba_id}/subscribed_apps`), { method: 'POST', headers: { Authorization: `Bearer ${c.token}` } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) throw httpError(400, `A Meta recusou: ${d.error?.message || `HTTP ${r.status}`}`);
    raw.inscrito = true;
    run('UPDATE stores SET wa_cloud = ? WHERE id = ?', JSON.stringify(raw), storeId);
    require('./bot').saveBotConfig(storeId, { whatsapp: b.ativo !== undefined ? !!b.ativo : true });
  }
  return status(storeId);
}

// Descobre o app e as contas do WhatsApp Business ligadas ao token da loja (vários caminhos da API da Meta).
const diag = [];
async function tokenInfo(token, phoneId) {
  const ids = new Set(); let appId;
  const pega = async (u, opts) => { const r = await fetch(u, opts); const d = await r.json().catch(() => ({})); if (d.error) diag.push(`${u.split('?')[0].split('/').slice(-2).join('/')}: ${d.error.message}`); return d; };
  if (config.meta.appId && config.meta.appSecret) {
    const d = (await pega(`${graph('debug_token')}?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(`${config.meta.appId}|${config.meta.appSecret}`)}`)).data || {};
    appId = d.app_id;
    for (const g of d.granular_scopes || []) if (/whatsapp_business/.test(g.scope)) for (const t of g.target_ids || []) ids.add(String(t));
  }
  // Contas do WhatsApp das empresas do token: escolhe a que tem o número da loja.
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const contas = [];
  const b = await pega(`${graph('me/businesses')}?fields=owned_whatsapp_business_accounts{id,phone_numbers{id}},client_whatsapp_business_accounts{id,phone_numbers{id}}&limit=50`, auth);
  for (const biz of b.data || []) for (const k of ['owned_whatsapp_business_accounts', 'client_whatsapp_business_accounts']) for (const w of biz[k]?.data || []) contas.push(w);
  for (const t of ids) {
    if (contas.some((w) => w.id === t)) continue;
    const w = await pega(`${graph(t)}?fields=id,phone_numbers{id}`, auth);
    if (w.id) contas.push(w);
  }
  const certa = contas.find((w) => (w.phone_numbers?.data || []).some((p) => String(p.id) === String(phoneId)));
  const lista = certa ? [certa.id, ...ids] : [...ids, ...contas.map((w) => w.id)];
  return { app_id: appId, waba_ids: [...new Set(lista)] };
}

// Assina o campo "messages" do WhatsApp no app da Meta, apontando para o webhook do GiroAuto.
async function assinarWebhook() {
  const body = new URLSearchParams({ object: 'whatsapp_business_account', callback_url: webhookUrl(), verify_token: verifyToken(), fields: 'messages', include_values: 'true', access_token: `${config.meta.appId}|${config.meta.appSecret}` });
  const r = await fetch(graph(`${config.meta.appId}/subscriptions`), { method: 'POST', body });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error?.message || `HTTP ${r.status}`);
  return true;
}

/* ---------------- Verificação e registro do número (v2.11.5) ---------------- */
// Um número novo na conta do WhatsApp começa "Não verificado": a Meta manda um código por SMS (ou ligação),
// o código é confirmado e o número é registrado na Cloud API com um PIN de 6 dígitos (guardado criptografado).
async function metaCall(c, path, { method = 'GET', body } = {}) {
  const r = await fetch(graph(path), {
    method, headers: { Authorization: `Bearer ${c.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000),
  }).catch(() => null);
  const d = r ? await r.json().catch(() => ({})) : {};
  if (!r || !r.ok || d.error) {
    const e = d.error || {};
    const det = [e.error_user_msg, e.error_data?.details].filter(Boolean).join(' — ');
    throw httpError(400, `A Meta recusou: ${e.message || (r ? `HTTP ${r.status}` : 'sem resposta')}${det ? ` (${det})` : ''}${e.code ? ` [código ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ''}]` : ''}`);
  }
  return d;
}
function lojaWa(storeId) {
  const store = get('SELECT * FROM stores WHERE id = ?', storeId);
  const c = cfgOf(store);
  if (!c.token || !c.phone_id) throw httpError(400, 'Configure primeiro o token e o ID do número (WhatsApp automático).');
  return { c, raw: json(store.wa_cloud, {}) };
}
const gravaRaw = (storeId, raw) => run('UPDATE stores SET wa_cloud = ? WHERE id = ?', JSON.stringify(raw), storeId);

async function numero(storeId) {
  const { c, raw } = lojaWa(storeId);
  const d = await metaCall(c, `${c.phone_id}?fields=display_phone_number,verified_name,code_verification_status,status,name_status,quality_rating,platform_type`);
  const registrado = d.platform_type === 'CLOUD_API' || d.status === 'CONNECTED' || (!!raw.registrado && !d.platform_type && !d.status);
  return {
    phone_id: c.phone_id, numero: d.display_phone_number || '', nome: d.verified_name || '',
    verificado: d.code_verification_status === 'VERIFIED' || registrado, codigo_status: d.code_verification_status || '',
    status: d.status || '', nome_status: d.name_status || '', qualidade: d.quality_rating || '', registrado, tem_pin: !!raw.pin_enc,
  };
}

async function pedirCodigo(storeId, metodo) {
  const { c } = lojaWa(storeId);
  await metaCall(c, `${c.phone_id}/request_code`, { method: 'POST', body: { code_method: metodo === 'VOICE' ? 'VOICE' : 'SMS', language: 'pt_BR' } });
  return { ok: true, metodo: metodo === 'VOICE' ? 'VOICE' : 'SMS' };
}

async function registrarNumero(storeId) {
  const { c, raw } = lojaWa(storeId);
  let pin = ''; try { pin = raw.pin_enc ? decrypt(raw.pin_enc) : ''; } catch { pin = ''; }
  if (!/^\d{6}$/.test(pin)) pin = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  await metaCall(c, `${c.phone_id}/register`, { method: 'POST', body: { messaging_product: 'whatsapp', pin } });
  raw.pin_enc = encrypt(pin); raw.registrado = true;
  gravaRaw(storeId, raw);
  return numero(storeId).catch(() => ({ phone_id: c.phone_id, verificado: true, registrado: true, tem_pin: true }));
}

async function confirmarCodigo(storeId, codigo) {
  const { c } = lojaWa(storeId);
  const code = String(codigo ?? '').replace(/\D/g, '');
  if (code.length < 4 || code.length > 8) throw httpError(400, 'Digite o código que chegou por SMS ou ligação (só os números).');
  await metaCall(c, `${c.phone_id}/verify_code`, { method: 'POST', body: { code } });
  return registrarNumero(storeId);
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

// Ativação feita uma vez pelo sistema (pedido do administrador): lojas com o WhatsApp oficial configurado
// e ainda não inscritas recebem a ativação do assistente no WhatsApp ao iniciar o servidor.
async function ativacaoInicial() {
  if (process.env.GIROAUTO_SKIP_WA_AUTO || readSetting('wa_auto_v2113')) return;
  run("INSERT INTO settings (key, value) VALUES ('wa_auto_v2113', 'rodando') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  const res = [];
  for (const s of all("SELECT id, name, wa_cloud FROM stores WHERE wa_cloud LIKE '%token_enc%'")) {
    const c = cfgOf(s);
    if (!c.token || !c.phone_id || c.inscrito) continue;
    try { const st = await salvar(s.id, { inscrever: true, ativo: true }); res.push(`${s.name}: ok (WABA ${st.waba_id}, webhook ${st.webhook})`); }
    catch (e) { res.push(`${s.name}: ${e.message}`); }
  }
  const txt = res.join(' | ') || 'nenhuma loja pendente';
  console.log('Ativação do assistente no WhatsApp:', txt);
  run("UPDATE settings SET value = ? WHERE key = 'wa_auto_v2113'", txt.slice(0, 1000));
}

module.exports = { ativacaoInicial, numero, pedirCodigo, confirmarCodigo, registrarNumero, verifyToken, webhookUrl, status, salvar, assinaturaOk, processar, responderComoLoja, pausar, conversaDoLead, sendText, sidDe };
