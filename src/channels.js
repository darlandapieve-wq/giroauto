// Outros canais de publicação (v1.7): Instagram (pela API da Meta), Webmotors e OLX (assistidos).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const storage = require('./storage');
const graph = require('./meta/graph');
const meta = require('./meta/service');
const arts = require('./arts');
const card = require('./arts/card');
const { get, all, run, logEvent } = require('./db');
const V = require('./vehicles');

const CHANNELS = {
  instagram: { label: 'Instagram', url: 'https://www.instagram.com/' },
  webmotors: { label: 'Webmotors', url: 'https://www.webmotors.com.br/', host: /(^|\.)webmotors\.com\.br$/ },
  olx: { label: 'OLX', url: 'https://www2.olx.com.br/desapega', host: /(^|\.)olx\.com\.br$/ },
};

const fmtInt = (n) => Number(n || 0).toLocaleString('pt-BR');

function listingsOf(vehicleId) {
  const out = {};
  for (const r of all('SELECT * FROM listings WHERE vehicle_id = ?', vehicleId)) {
    out[r.channel] = { status: r.status, url: r.url || '', error: r.error || '', published_at: r.published_at || null };
  }
  return out;
}

function upsert(vehicleId, channel, fields) {
  const cur = get('SELECT 1 FROM listings WHERE vehicle_id = ? AND channel = ?', vehicleId, channel);
  const cols = Object.keys(fields);
  if (cur) run(`UPDATE listings SET ${cols.map((c) => `${c}=?`).join(',')}, updated_at=datetime('now') WHERE vehicle_id=? AND channel=?`, ...cols.map((c) => fields[c]), vehicleId, channel);
  else run(`INSERT INTO listings (vehicle_id, channel, ${cols.join(',')}) VALUES (?, ?, ${cols.map(() => '?').join(',')})`, vehicleId, channel, ...cols.map((c) => fields[c]));
}

function httpError(status, message) { return Object.assign(new Error(message), { status }); }

/* ---------------- Texto do anúncio ---------------- */

function adTitle(v) {
  return [v.marca, v.modelo, v.versao, v.ano_fab && v.ano_modelo ? `${v.ano_fab}/${v.ano_modelo}` : (v.ano_modelo || v.ano_fab)].filter(Boolean).join(' ');
}

function hashtag(s) {
  return '#' + String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function caption(v, store) {
  const desc = V.descricaoAnuncio(v);
  const preco = V.ofertaAtiva(v) ? `🔥 OFERTA: de R$ ${fmtInt(v.preco)} por R$ ${fmtInt(v.preco_oferta)}` : v.preco ? `💰 R$ ${fmtInt(v.preco)}` : '💰 Consulte o valor';
  const linhas = [
    `🚗 ${adTitle(v)}`,
    preco,
    '',
    [v.km ? `📍 ${fmtInt(v.km)} km` : '', v.cambio ? `⚙️ Câmbio ${v.cambio.toLowerCase()}` : '', v.combustivel ? `⛽ ${v.combustivel}` : '', v.cor ? `🎨 ${v.cor}` : ''].filter(Boolean).join('\n'),
  ];
  // Destaques marcados que a descrição ainda não cita.
  const extras = V.destaquesOf(v).map((k) => V.DESTAQUE[k]).filter((d) => !d.alerta && !desc.toLowerCase().includes(d.texto.toLowerCase()));
  if (extras.length) linhas.push(extras.map((d) => `✅ ${d.texto}`).join('\n'));
  const corpo = String(v.descricao || '').trim() ? desc : desc.replace(V.title(v), '').trim();
  if (corpo) linhas.push('', corpo);
  const contato = store.whatsapp || store.phone;
  linhas.push('', `📲 ${contato ? `Chame no WhatsApp: ${contato}` : 'Chame no direct'}${store.name ? `\n🏪 ${store.name}` : ''}${store.city ? ` · ${store.city}${store.state ? '/' + store.state : ''}` : ''}`);
  const tags = [hashtag(v.marca), hashtag(v.modelo), hashtag(`${v.marca}${v.modelo}`), '#carrosusados', '#seminovos', '#carros', store.city ? hashtag(store.city) : '', store.city ? hashtag(`carros${store.city}`) : '']
    .filter((t) => t && t.length > 2);
  linhas.push('', [...new Set(tags)].slice(0, 12).join(' '));
  return linhas.join('\n').slice(0, 2150);
}

// Descrição para os sites: a da loja, os destaques que ela não cita e os avisos de transparência.
function descricaoComDestaques(v) {
  const desc = V.descricaoAnuncio(v);
  const extras = V.destaquesOf(v).map((k) => V.DESTAQUE[k]).filter((d) => !d.alerta && !desc.toLowerCase().includes(d.texto.toLowerCase()));
  const oferta = V.ofertaAtiva(v) ? `OFERTA: de R$ ${fmtInt(v.preco)} por R$ ${fmtInt(v.preco_oferta)}.\n\n` : '';
  return `${oferta}${desc}${extras.length ? `\n\n${extras.map((d) => `✔ ${d.texto}`).join('\n')}` : ''}`;
}

// Campos prontos para copiar nos sites (Webmotors e OLX).
function fields(v, store) {
  return [
    ['Título', adTitle(v)],
    ['Marca', v.marca], ['Modelo', v.modelo], ['Versão', v.versao],
    ['Ano de fabricação', v.ano_fab || ''], ['Ano do modelo', v.ano_modelo || ''],
    ['Quilometragem', v.km ? String(v.km) : ''], ['Preço', V.precoAnuncio(v) ? String(V.precoAnuncio(v)) : ''],
    ['Câmbio', v.cambio], ['Combustível', v.combustivel], ['Carroceria', v.carroceria], ['Cor', v.cor],
    ['Placa', v.placa], ['CEP', store.postal_code || ''],
    ['Descrição', descricaoComDestaques(v)],
  ].filter(([, val]) => val !== '' && val !== null && val !== undefined).map(([label, value]) => ({ label, value: String(value) }));
}

/* ---------------- Instagram ---------------- */

const running = new Set();

async function waitContainer(id, token) {
  for (let i = 0; i < 40; i++) {
    const r = await graph.get(`/${id}`, token, { fields: 'status_code,status' });
    if (!r.status_code || r.status_code === 'FINISHED') return;
    if (r.status_code === 'ERROR' || r.status_code === 'EXPIRED') throw httpError(502, `O Instagram não aceitou a imagem: ${r.status || r.status_code}`);
    await new Promise((res) => setTimeout(res, Number(process.env.IG_POLL_MS || 3000)));
  }
  throw httpError(504, 'O Instagram demorou demais para processar as imagens. Tente de novo.');
}

// Prepara até 10 imagens JPEG 1080x1350 em endereços públicos: arte, estacionamento e fotos originais.
async function prepareImages(vehicleId) {
  const media = path.join(config.dataDir, 'media');
  const sources = [
    ...arts.readyFiles(vehicleId),
    ...all('SELECT filename FROM photos WHERE vehicle_id = ? ORDER BY position, id', vehicleId).map((p) => p.filename),
  ].slice(0, 10);
  const out = [];
  for (const f of sources) {
    const file = await storage.ensureLocal(f);
    if (!file) continue;
    const name = crypto.randomBytes(16).toString('hex') + '.jpg';
    fs.writeFileSync(path.join(media, name), await card.toPortraitJpeg(file));
    out.push(name);
  }
  return out;
}

async function publishInstagram(storeId, vehicleId, { caption: custom } = {}) {
  const v = get('SELECT * FROM vehicles WHERE id = ? AND store_id = ?', vehicleId, storeId);
  if (!v) throw httpError(404, 'Veículo não encontrado.');
  if (v.status === 'vendido') throw httpError(409, 'Veículo vendido não pode ser publicado.');
  const { conn, token } = meta.tokenFor(storeId);
  if (!conn.ig_user_id) {
    throw httpError(400, 'Nenhum perfil do Instagram ligado. O administrador precisa ligar "Publicar no Instagram" em Configurações > App da Meta, conectar o Facebook de novo e escolher a Página que tem o Instagram da loja.');
  }
  if (!all('SELECT 1 FROM photos WHERE vehicle_id = ?', v.id).length) throw httpError(400, 'Cadastre ao menos uma foto do veículo.');
  if (running.has(v.id)) throw httpError(409, 'Este veículo já está sendo publicado no Instagram.');
  if (!/^https:\/\//.test(config.publicUrl) && !/\/\/(localhost|127\.0\.0\.1)[:/]/.test(config.publicUrl)) throw httpError(400, 'O Instagram só baixa imagens de endereços HTTPS públicos. Use o painel on-line.');
  const store = get('SELECT * FROM stores WHERE id = ?', storeId);
  const text = String(custom || '').trim().slice(0, 2150) || caption(v, store);
  upsert(v.id, 'instagram', { status: 'publicando', error: '' });
  running.add(v.id);
  // Roda em segundo plano: o Instagram leva de alguns segundos a um minuto.
  (async () => {
    let files = [];
    try {
      files = await prepareImages(v.id);
      if (!files.length) throw httpError(400, 'Nenhuma foto encontrada para publicar.');
      const urls = files.map((f) => `${config.publicUrl}/media/${f}`);
      let creationId;
      if (urls.length === 1) {
        creationId = (await graph.post(`/${conn.ig_user_id}/media`, token, { image_url: urls[0], caption: text })).id;
      } else {
        const children = [];
        for (const u of urls) children.push((await graph.post(`/${conn.ig_user_id}/media`, token, { image_url: u, is_carousel_item: true })).id);
        for (const c of children) await waitContainer(c, token);
        creationId = (await graph.post(`/${conn.ig_user_id}/media`, token, { media_type: 'CAROUSEL', children: children.join(','), caption: text })).id;
      }
      await waitContainer(creationId, token);
      const pub = await graph.post(`/${conn.ig_user_id}/media_publish`, token, { creation_id: creationId });
      let permalink = '';
      try { permalink = (await graph.get(`/${pub.id}`, token, { fields: 'permalink' })).permalink || ''; } catch { /* sem link: segue */ }
      upsert(v.id, 'instagram', { status: 'publicado', url: permalink, external_id: String(pub.id || ''), error: '', published_at: new Date().toISOString().slice(0, 19).replace('T', ' ') });
      logEvent(storeId, `${v.marca} ${v.modelo} publicado no Instagram`);
    } catch (e) {
      let msg = e instanceof graph.MetaError ? `${e.title ? e.title + ': ' : ''}${e.message}` : e.message;
      // Sem permissão (#10/#200): confere na Meta o que o token recebeu e diz o que falta.
      if (e instanceof graph.MetaError && [10, 200].includes(Number(e.code))) {
        const p = await grantedPermissions(token).catch(() => null);
        msg = permissionHelp(p) || msg;
      }
      upsert(v.id, 'instagram', { status: 'erro', error: String(msg).slice(0, 900) });
    } finally {
      running.delete(v.id);
      // As cópias temporárias ficam alguns minutos para o Instagram terminar de baixar.
      const t = setTimeout(() => files.forEach((f) => fs.rm(path.join(config.dataDir, 'media', f), () => {})), 10 * 60 * 1000);
      if (t.unref) t.unref();
    }
  })();
  return listingsOf(v.id);
}

// Permissões concedidas ao token da loja: { granted: [...], declined: [...] }.
async function grantedPermissions(token) {
  const r = await graph.get('/me/permissions', token, {});
  const out = { granted: [], declined: [] };
  for (const p of r.data || []) (p.status === 'granted' ? out.granted : out.declined).push(p.permission);
  return out;
}

function permissionHelp(p) {
  if (!p) return '';
  const need = ['instagram_basic', 'instagram_content_publish', 'pages_read_engagement', 'pages_show_list'];
  const falta = need.filter((x) => !p.granted.includes(x));
  if (!falta.length) {
    return 'A Meta recusou a publicação mesmo com as permissões concedidas. Confira se o Instagram é uma conta profissional ligada à Página escolhida e se você tem função de administrador na Página.';
  }
  const recusada = falta.filter((x) => p.declined.includes(x));
  if (recusada.length) {
    return `Na hora de conectar, a permissão ${recusada.join(', ')} ficou desmarcada. Clique em Conectar Facebook de novo, depois em "Editar acesso", e deixe marcados a Página e o Instagram da loja.`;
  }
  return `O Facebook não entregou a permissão ${falta.join(', ')} para o GiroAuto. No app da Meta (developers.facebook.com > GiroAuto > Casos de uso), o caso de uso de Instagram precisa estar na opção "com login do Facebook" e ter ${falta.join(' e ')} adicionadas (botão Adicionar em Personalizar > Permissões). Depois clique em Conectar Facebook de novo no GiroAuto.`;
}

/* ---------------- Webmotors e OLX (assistidos) ---------------- */

function markPublished(storeId, vehicleId, channel, url) {
  const ch = CHANNELS[channel];
  if (!ch || channel === 'instagram') throw httpError(400, 'Canal inválido.');
  const v = get('SELECT * FROM vehicles WHERE id = ? AND store_id = ?', vehicleId, storeId);
  if (!v) throw httpError(404, 'Veículo não encontrado.');
  if (v.status === 'vendido') throw httpError(409, 'Veículo vendido não pode ser publicado.');
  const link = String(url || '').trim();
  if (link) {
    let host = '';
    try { host = new URL(link).hostname; } catch { /* inválido */ }
    if (!/^https:\/\//.test(link) || !ch.host.test(host)) throw httpError(400, `Cole o link do anúncio no site da ${ch.label} (começa com https:// e é do site ${ch.label.toLowerCase()}).`);
  }
  upsert(v.id, channel, { status: 'publicado', url: link, error: '', published_at: new Date().toISOString().slice(0, 19).replace('T', ' ') });
  logEvent(storeId, `${v.marca} ${v.modelo} registrado como publicado na ${ch.label}`);
  return listingsOf(v.id);
}

function unmark(storeId, vehicleId, channel) {
  const v = get('SELECT id FROM vehicles WHERE id = ? AND store_id = ?', vehicleId, storeId);
  if (!v) throw httpError(404, 'Veículo não encontrado.');
  run('DELETE FROM listings WHERE vehicle_id = ? AND channel = ?', v.id, channel);
  return listingsOf(v.id);
}

// Anúncios que a loja precisa retirar à mão (vendido ou excluído).
function manualRemovals(vehicleId) {
  return all(`SELECT channel, url FROM listings WHERE vehicle_id = ? AND status = 'publicado'`, vehicleId)
    .map((r) => ({ channel: r.channel, label: CHANNELS[r.channel]?.label || r.channel, url: r.url || CHANNELS[r.channel]?.url || '' }));
}

module.exports = { grantedPermissions, permissionHelp, CHANNELS, listingsOf, caption, fields, publishInstagram, markPublished, unmark, manualRemovals, adTitle };
