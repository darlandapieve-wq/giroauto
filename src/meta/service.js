// Integração com a Meta: conexão OAuth, ativos (contas, páginas), catálogo e campanhas.
const fs = require('node:fs');
const path = require('node:path');
const graph = require('./graph');
const config = require('../config');
const { get, run, all, logEvent } = require('../db');
const { encrypt, decrypt } = require('../crypto');
const { feedUrl, vehicleUrl } = require('../feed');

const REDIRECT_PATH = '/api/meta/callback';
const redirectUri = () => `${config.publicUrl}${REDIRECT_PATH}`;

function isConfigured() {
  return !!(config.meta.appId && config.meta.appSecret);
}

function connectUrl(state) {
  const u = new URL(`${config.meta.dialogUrl}/${config.meta.apiVersion}/dialog/oauth`);
  u.searchParams.set('client_id', config.meta.appId);
  u.searchParams.set('redirect_uri', redirectUri());
  u.searchParams.set('state', state);
  u.searchParams.set('response_type', 'code');
  if (config.meta.loginConfigId) u.searchParams.set('config_id', config.meta.loginConfigId);
  else u.searchParams.set('scope', config.meta.scopes.join(','));
  return u.toString();
}

async function exchangeCode(code) {
  const short = await graph.get('/oauth/access_token', null, {
    client_id: config.meta.appId,
    client_secret: config.meta.appSecret,
    redirect_uri: redirectUri(),
    code,
  });
  // Troca por token de longa duração (cerca de 60 dias).
  const long = await graph.get('/oauth/access_token', null, {
    grant_type: 'fb_exchange_token',
    client_id: config.meta.appId,
    client_secret: config.meta.appSecret,
    fb_exchange_token: short.access_token,
  });
  const token = long.access_token || short.access_token;
  const expiresIn = Number(long.expires_in || short.expires_in || 0);
  const me = await graph.get('/me', token, { fields: 'id,name' });
  return { token, expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null, me };
}

function saveConnection(storeId, { token, expiresAt, me }) {
  const exists = get('SELECT store_id FROM meta_connections WHERE store_id = ?', storeId);
  if (exists) {
    run(`UPDATE meta_connections SET fb_user_id=?, fb_user_name=?, token_enc=?, token_expires_at=?, updated_at=datetime('now') WHERE store_id=?`,
      me.id, me.name, encrypt(token), expiresAt, storeId);
  } else {
    run(`INSERT INTO meta_connections (store_id, fb_user_id, fb_user_name, token_enc, token_expires_at) VALUES (?,?,?,?,?)`,
      storeId, me.id, me.name, encrypt(token), expiresAt);
  }
  logEvent(storeId, `Conta do Facebook de ${me.name} conectada`);
}

function connection(storeId) {
  return get('SELECT * FROM meta_connections WHERE store_id = ?', storeId);
}

function tokenFor(storeId) {
  const c = connection(storeId);
  if (!c?.token_enc) throw httpError(400, 'Conecte a conta do Facebook da loja antes de continuar.');
  if (c.token_expires_at && c.token_expires_at < Date.now()) {
    throw httpError(401, 'A conexão com o Facebook expirou. Conecte de novo em Configurações.');
  }
  return { conn: c, token: decrypt(c.token_enc) };
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function publicStatus(storeId) {
  const c = connection(storeId);
  if (!c?.token_enc) return { configured: isConfigured(), connected: false };
  return {
    configured: isConfigured(),
    connected: true,
    user: c.fb_user_name,
    expires_at: c.token_expires_at,
    expired: !!(c.token_expires_at && c.token_expires_at < Date.now()),
    business_id: c.business_id,
    ad_account_id: c.ad_account_id,
    ad_account_name: c.ad_account_name,
    currency: c.currency,
    page_id: c.page_id,
    page_name: c.page_name,
    ig_user_id: c.ig_user_id,
    ig_username: c.ig_username,
    whatsapp_number: c.whatsapp_number,
    catalog_id: c.catalog_id,
    feed_id: c.feed_id,
    catalog_synced_at: c.catalog_synced_at,
    ready: !!(c.ad_account_id && c.page_id),
  };
}

async function listAssets(storeId) {
  const { token } = tokenFor(storeId);
  const [adAccounts, pages, businesses] = await Promise.all([
    graph.getAll('/me/adaccounts', token, { fields: 'id,name,currency,account_status' }),
    graph.getAll('/me/accounts', token, { fields: 'id,name,instagram_business_account{id,username}' }),
    graph.getAll('/me/businesses', token, { fields: 'id,name' }).catch(() => []),
  ]);
  return {
    ad_accounts: adAccounts.map((a) => ({
      id: a.id, name: a.name, currency: a.currency, active: a.account_status === 1,
    })),
    pages: pages.map((p) => ({
      id: p.id, name: p.name,
      ig_user_id: p.instagram_business_account?.id || '',
      ig_username: p.instagram_business_account?.username || '',
    })),
    businesses: businesses.map((b) => ({ id: b.id, name: b.name })),
  };
}

async function saveSettings(storeId, body) {
  const assets = await listAssets(storeId);
  const acc = assets.ad_accounts.find((a) => a.id === body.ad_account_id);
  const page = assets.pages.find((p) => p.id === body.page_id);
  if (body.ad_account_id && !acc) throw httpError(400, 'Conta de anúncios não encontrada nesta conexão.');
  if (body.page_id && !page) throw httpError(400, 'Página não encontrada nesta conexão.');
  const biz = body.business_id ? assets.businesses.find((b) => b.id === body.business_id) : null;
  if (body.business_id && !biz) throw httpError(400, 'Portfólio empresarial não encontrado nesta conexão.');
  const wa = String(body.whatsapp_number || '').replace(/\D/g, '');
  run(`UPDATE meta_connections SET ad_account_id=?, ad_account_name=?, currency=?, page_id=?, page_name=?,
       ig_user_id=?, ig_username=?, business_id=?, whatsapp_number=?, updated_at=datetime('now') WHERE store_id=?`,
    acc?.id || '', acc?.name || '', acc?.currency || 'BRL', page?.id || '', page?.name || '',
    page?.ig_user_id || '', page?.ig_username || '', biz?.id || '', wa, storeId);
  return publicStatus(storeId);
}

async function searchCities(storeId, q) {
  const { token } = tokenFor(storeId);
  const r = await graph.get('/search', token, {
    type: 'adgeolocation', q, location_types: ['city'], country_code: 'BR', limit: 8,
  });
  return (r.data || []).map((c) => ({ key: c.key, name: c.name, region: c.region || '' }));
}

/* ---------------- Catálogo ---------------- */

async function setupCatalog(storeId) {
  const { conn, token } = tokenFor(storeId);
  const store = get('SELECT * FROM stores WHERE id = ?', storeId);
  if (!conn.business_id) throw httpError(400, 'Escolha o portfólio empresarial (Business) da loja em Configurações.');
  let catalogId = conn.catalog_id;
  if (!catalogId) {
    const cat = await graph.post(`/${conn.business_id}/owned_product_catalogs`, token, {
      name: `${store.name} · Veículos (GiroAuto)`,
      vertical: 'vehicles',
    });
    catalogId = cat.id;
  }
  let feedId = conn.feed_id;
  if (!feedId) {
    const feed = await graph.post(`/${catalogId}/product_feeds`, token, {
      name: 'Estoque GiroAuto',
      schedule: { interval: 'HOURLY', url: feedUrl(store) },
    });
    feedId = feed.id;
  }
  run(`UPDATE meta_connections SET catalog_id=?, feed_id=?, updated_at=datetime('now') WHERE store_id=?`, catalogId, feedId, storeId);
  logEvent(storeId, 'Catálogo de veículos criado na Meta');
  await syncCatalog(storeId);
  return publicStatus(storeId);
}

async function syncCatalog(storeId) {
  const { conn, token } = tokenFor(storeId);
  if (!conn.feed_id) throw httpError(400, 'Crie o catálogo antes de sincronizar.');
  const store = get('SELECT * FROM stores WHERE id = ?', storeId);
  await graph.post(`/${conn.feed_id}/uploads`, token, { url: feedUrl(store) });
  run(`UPDATE meta_connections SET catalog_synced_at=datetime('now') WHERE store_id=?`, storeId);
  return publicStatus(storeId);
}

/* ---------------- Campanhas ---------------- */

const MODES = {
  whatsapp: { label: 'Conversas no WhatsApp', objective: 'OUTCOME_ENGAGEMENT' },
  messenger: { label: 'Conversas no Messenger', objective: 'OUTCOME_ENGAGEMENT' },
  catalogo: { label: 'Catálogo dinâmico', objective: 'OUTCOME_TRAFFIC' },
};

const fmtBRL = (n) => 'R$ ' + Number(n).toLocaleString('pt-BR');

function buildTargeting(c) {
  return {
    geo_locations: {
      cities: [{ key: c.city_key, radius: c.radius_km, distance_unit: 'kilometer' }],
    },
    age_min: c.age_min,
    age_max: c.age_max,
    publisher_platforms: ['facebook', 'instagram'],
    facebook_positions: ['feed', 'marketplace', 'story'],
    instagram_positions: ['stream', 'story', 'explore'],
    targeting_automation: { advantage_audience: 0 },
  };
}

async function uploadImage(adAccountId, token, photo) {
  const file = await require('../storage').ensureLocal(photo.filename);
  if (!file) throw httpError(404, 'Foto do veículo não encontrada no armazenamento.');
  const bytes = fs.readFileSync(file).toString('base64');
  const r = await graph.post(`/${adAccountId}/adimages`, token, { bytes });
  const first = Object.values(r.images || {})[0];
  if (!first?.hash) throw httpError(502, 'A Meta não devolveu o identificador da imagem enviada.');
  return first.hash;
}

function ctaFor(mode) {
  if (mode === 'whatsapp') return { type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP' } };
  if (mode === 'messenger') return { type: 'MESSAGE_PAGE', value: { app_destination: 'MESSENGER' } };
  return { type: 'LEARN_MORE' };
}

function linkFor(mode, store, v) {
  if (mode === 'whatsapp') return 'https://api.whatsapp.com/send';
  if (mode === 'messenger') return 'https://fb.com/messenger_doc/';
  return v ? vehicleUrl(store, v) : `${config.publicUrl}/v/${store.slug}`;
}

async function buildCreative(ctx) {
  const { mode, conn, token, store, campaign, vehicles } = ctx;
  const message = campaign.message || `Seminovos revisados na ${store.name}. Chame e agende seu test drive.`;
  const storySpec = { page_id: conn.page_id };
  if (conn.ig_user_id) storySpec.instagram_user_id = conn.ig_user_id;

  if (mode === 'catalogo') {
    storySpec.template_data = {
      message,
      link: `${config.publicUrl}/v/${store.slug}`,
      name: '{{vehicle.year}} {{vehicle.make}} {{vehicle.model}}',
      description: '{{vehicle.price}}',
      call_to_action: ctaFor(mode),
      multi_share_end_card: false,
    };
    return graph.post(`/${conn.ad_account_id}/adcreatives`, token, {
      name: `${campaign.name} · criativo`,
      product_set_id: ctx.productSetId,
      object_story_spec: storySpec,
    });
  }

  const cards = [];
  for (const v of vehicles.slice(0, 10)) {
    const hash = await uploadImage(conn.ad_account_id, token, v.photos[0]);
    cards.push({
      image_hash: hash,
      link: linkFor(mode, store, v),
      name: `${v.titulo} · ${fmtBRL(v.preco)}`.slice(0, 100),
      description: `${Number(v.km).toLocaleString('pt-BR')} km${v.cambio ? ' · ' + v.cambio : ''}`,
      call_to_action: ctaFor(mode),
    });
  }
  let linkData;
  if (cards.length === 1) {
    const c = cards[0];
    linkData = {
      image_hash: c.image_hash, link: c.link, message, name: c.name,
      description: c.description, call_to_action: c.call_to_action,
    };
  } else {
    linkData = {
      link: linkFor(mode, store),
      message,
      child_attachments: cards,
      multi_share_optimized: true,
      multi_share_end_card: false,
      call_to_action: ctaFor(mode),
    };
  }
  storySpec.link_data = linkData;
  return graph.post(`/${conn.ad_account_id}/adcreatives`, token, {
    name: `${campaign.name} · criativo`,
    object_story_spec: storySpec,
  });
}

/**
 * Cria campanha, conjunto, criativo e anúncio na conta de anúncios da loja.
 * Tudo nasce PAUSADO; se `activate` for verdadeiro, ativa no final.
 * Em caso de erro no meio do caminho, apaga o que já tinha sido criado.
 */
async function launchCampaign(storeId, campaignId, { activate }) {
  const { conn, token } = tokenFor(storeId);
  if (!conn.ad_account_id || !conn.page_id) throw httpError(400, 'Escolha a conta de anúncios e a Página da loja em Configurações.');
  const store = get('SELECT * FROM stores WHERE id = ?', storeId);
  const c = get('SELECT * FROM campaigns WHERE id = ? AND store_id = ?', campaignId, storeId);
  const { serialize } = require('../vehicles');
  const vehicles = all(
    `SELECT v.* FROM vehicles v JOIN campaign_vehicles cv ON cv.vehicle_id = v.id WHERE cv.campaign_id = ?`, c.id,
  ).map(serialize);
  const mode = c.mode;
  if (mode === 'whatsapp' && !conn.whatsapp_number) {
    throw httpError(400, 'Informe o número de WhatsApp da loja em Configurações > Facebook e Instagram.');
  }
  if (mode === 'catalogo' && !conn.catalog_id) throw httpError(400, 'Crie o catálogo de veículos antes de usar o modo Catálogo dinâmico.');
  if (mode !== 'catalogo' && vehicles.some((v) => !v.photos.length)) throw httpError(400, 'Todos os veículos da campanha precisam de ao menos uma foto.');

  const created = {};
  try {
    const camp = await graph.post(`/${conn.ad_account_id}/campaigns`, token, {
      name: c.name,
      objective: MODES[mode].objective,
      status: 'PAUSED',
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false,
      ...(mode === 'catalogo' ? { promoted_object: { product_catalog_id: conn.catalog_id } } : {}),
    });
    created.campaign = camp.id;

    if (mode === 'catalogo') {
      const ps = await graph.post(`/${conn.catalog_id}/product_sets`, token, {
        name: `${c.name} (${c.id})`,
        filter: { retailer_id: { is_any: vehicles.map((v) => `giro-${v.id}`) } },
      });
      created.productSet = ps.id;
    }

    const adsetParams = {
      name: `${c.name} · público`,
      campaign_id: created.campaign,
      daily_budget: c.daily_budget_cents,
      billing_event: 'IMPRESSIONS',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      start_time: c.start_time,
      end_time: c.end_time,
      targeting: buildTargeting(c),
      status: 'PAUSED',
    };
    if (mode === 'whatsapp') Object.assign(adsetParams, {
      destination_type: 'WHATSAPP',
      optimization_goal: 'CONVERSATIONS',
      promoted_object: { page_id: conn.page_id, whatsapp_phone_number: conn.whatsapp_number },
    });
    if (mode === 'messenger') Object.assign(adsetParams, {
      destination_type: 'MESSENGER',
      optimization_goal: 'CONVERSATIONS',
      promoted_object: { page_id: conn.page_id },
    });
    if (mode === 'catalogo') Object.assign(adsetParams, {
      optimization_goal: 'LINK_CLICKS',
      promoted_object: { product_set_id: created.productSet },
    });
    const adset = await graph.post(`/${conn.ad_account_id}/adsets`, token, adsetParams);
    created.adset = adset.id;

    const creative = await buildCreative({ mode, conn, token, store, campaign: c, vehicles, productSetId: created.productSet });
    created.creative = creative.id;

    const ad = await graph.post(`/${conn.ad_account_id}/ads`, token, {
      name: `${c.name} · anúncio`,
      adset_id: created.adset,
      creative: { creative_id: created.creative },
      status: 'PAUSED',
    });
    created.ad = ad.id;

    run(`UPDATE campaigns SET meta_campaign_id=?, meta_adset_id=?, meta_creative_id=?, meta_ad_id=?, meta_product_set_id=?,
         status='pausada', error='' WHERE id=?`,
      created.campaign, created.adset, created.creative, created.ad, created.productSet || '', c.id);

    if (activate) await setCampaignStatus(storeId, c.id, 'ACTIVE');
    logEvent(storeId, `Campanha "${c.name}" criada na Meta${activate ? ' e ativada' : ' (pausada para revisão)'}`);
    return get('SELECT * FROM campaigns WHERE id = ?', c.id);
  } catch (err) {
    // Desfaz o que foi criado (apagar a campanha remove conjunto e anúncio).
    if (created.campaign) await graph.del(`/${created.campaign}`, token).catch(() => {});
    if (created.productSet) await graph.del(`/${created.productSet}`, token).catch(() => {});
    const msg = err.title ? `${err.title}: ${err.message}` : err.message;
    run(`UPDATE campaigns SET status='erro', error=? WHERE id=?`, msg, c.id);
    logEvent(storeId, `Falha ao criar a campanha "${c.name}": ${msg}`);
    throw err;
  }
}

async function setCampaignStatus(storeId, campaignId, status) {
  const { token } = tokenFor(storeId);
  const c = get('SELECT * FROM campaigns WHERE id = ? AND store_id = ?', campaignId, storeId);
  if (!c?.meta_campaign_id) throw httpError(400, 'Esta campanha ainda não existe na Meta.');
  if (status === 'ACTIVE') {
    // Anúncio e conjunto primeiro, campanha por último.
    await graph.post(`/${c.meta_ad_id}`, token, { status: 'ACTIVE' });
    await graph.post(`/${c.meta_adset_id}`, token, { status: 'ACTIVE' });
    await graph.post(`/${c.meta_campaign_id}`, token, { status: 'ACTIVE' });
    run(`UPDATE campaigns SET status='ativa' WHERE id=?`, c.id);
  } else if (status === 'PAUSED') {
    await graph.post(`/${c.meta_campaign_id}`, token, { status: 'PAUSED' });
    run(`UPDATE campaigns SET status='pausada' WHERE id=?`, c.id);
  } else if (status === 'ARCHIVED') {
    await graph.post(`/${c.meta_campaign_id}`, token, { status: 'ARCHIVED' });
    run(`UPDATE campaigns SET status='encerrada' WHERE id=?`, c.id);
  }
  return get('SELECT * FROM campaigns WHERE id = ?', c.id);
}

const CONVERSATION_ACTIONS = [
  'onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.total_messaging_connection',
];

async function refreshStats(storeId, campaignId) {
  const { token } = tokenFor(storeId);
  const c = get('SELECT * FROM campaigns WHERE id = ? AND store_id = ?', campaignId, storeId);
  if (!c?.meta_campaign_id) return null;
  const r = await graph.get(`/${c.meta_campaign_id}/insights`, token, {
    fields: 'impressions,reach,clicks,spend,actions', date_preset: 'maximum',
  });
  const row = r.data?.[0] || {};
  const actions = row.actions || [];
  const conv = actions.find((a) => CONVERSATION_ACTIONS.includes(a.action_type));
  const stats = {
    impressions: Number(row.impressions || 0),
    reach: Number(row.reach || 0),
    clicks: Number(row.clicks || 0),
    spend: Number(row.spend || 0),
    conversations: Number(conv?.value || 0),
  };
  const meta = await graph.get(`/${c.meta_campaign_id}`, token, { fields: 'effective_status' }).catch(() => null);
  let status = c.status;
  if (meta?.effective_status === 'ACTIVE') status = 'ativa';
  else if (meta?.effective_status === 'PAUSED' || meta?.effective_status === 'CAMPAIGN_PAUSED') status = 'pausada';
  else if (meta?.effective_status === 'ARCHIVED' || meta?.effective_status === 'DELETED') status = 'encerrada';
  else if (meta?.effective_status === 'IN_PROCESS' || meta?.effective_status === 'PENDING_REVIEW') status = 'analise';
  else if (meta?.effective_status === 'DISAPPROVED' || meta?.effective_status === 'WITH_ISSUES') status = 'reprovada';
  if (c.end_time && Date.parse(c.end_time) < Date.now() && status !== 'erro') status = 'encerrada';
  run(`UPDATE campaigns SET stats_json=?, stats_at=datetime('now'), status=? WHERE id=?`, JSON.stringify(stats), status, c.id);
  return stats;
}

module.exports = {
  MODES, isConfigured, connectUrl, exchangeCode, saveConnection, publicStatus, listAssets, saveSettings,
  searchCities, setupCatalog, syncCatalog, launchCampaign, setCampaignStatus, refreshStats, httpError, buildTargeting,
};
