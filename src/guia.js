// Guia "Primeiros passos" (v2.12): situação de cada etapa da configuração de uma loja nova,
// do cadastro às integrações (Marketplace, Facebook/Instagram, WhatsApp oficial, IA, portais).
const config = require('./config');
const { get } = require('./db');

const json = (s, d) => { try { return JSON.parse(s || ''); } catch { return d; } };
const seguro = (fn, d) => { try { return fn(); } catch { return d; } };

function status(storeId) {
  const store = get('SELECT * FROM stores WHERE id = ?', storeId) || {};
  const meta = require('./meta/service');
  const metaApp = !!seguro(() => meta.isConfigured(), false);
  const m = get('SELECT * FROM meta_connections WHERE store_id = ?', storeId) || {};
  const metaOk = !!m.token_enc && !(m.token_expires_at && m.token_expires_at < Date.now());
  const ig = seguro(() => require('./instagram').status(storeId), {});
  const igApp = !!seguro(() => (() => { const a = require('./settings').instagramApp(); return a.id && a.secret; })(), false);
  const wa = json(store.wa_cloud, {});
  const bot = seguro(() => require('./bot').botConfig(storeId), {});
  const email = seguro(() => require('./crm').config(storeId).email || {}, {});
  const ia = !!seguro(() => require('./settings').chatAi().key, '');
  const n = (sql, ...a) => get(sql, ...a)?.n || 0;
  const veiculos = n("SELECT COUNT(*) n FROM vehicles WHERE store_id = ? AND status != 'rascunho'", storeId);
  const extVista = get('SELECT MAX(last_seen) t FROM ext_tokens WHERE store_id = ?', storeId)?.t || null;
  const contrato = json(store.contrato_loja, {});

  return {
    app_url: config.publicUrl,
    vitrine_url: `${config.publicUrl}/v/${store.slug}`,
    meta_app_id: config.meta.appId || '',
    plataforma: { meta_app: metaApp, ig_app: igApp, ia },
    etapas: {
      conta: true,
      loja: !!((store.whatsapp || store.phone) && store.city && store.address),
      logo: !!store.logo_file,
      contrato: !!(contrato && (contrato.cnpj || contrato.razao_social)),
      equipe: n('SELECT COUNT(*) n FROM users WHERE store_id = ?', storeId) > 1,
      estoque: veiculos > 0,
      marketplace: store.pub_mode !== 'extensao' || !!extVista,
      marketplace_modo: store.pub_mode || '',
      extensao_vista: extVista,
      meta: metaOk && !!m.page_id && !!m.ad_account_id,
      meta_conectado: metaOk,
      meta_expirado: !!m.token_enc && !metaOk,
      instagram: !!(m.ig_user_id || ig.connected),
      catalogo: !!m.catalog_id,
      wa_token: !!(wa.token_enc && wa.phone_id),
      wa_inscrito: !!wa.inscrito,
      wa_registrado: !!wa.registrado,
      wa_modelo: !!wa.template,
      bot_site: !!bot.ativo,
      bot_whatsapp: !!bot.whatsapp,
      portais: !!(email.imap_ativo && !email.erro),
      ia,
    },
  };
}

module.exports = { status };
