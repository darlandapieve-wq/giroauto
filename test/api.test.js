const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMock } = require('./mock-graph');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'giro-'));
let base, server, mockServer, mock, cookie = '', extToken = '';

// JPEG mínimo válido (1x1 px)
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

async function api(method, url, body, headers = {}) {
  const opts = { method, headers: { ...headers }, redirect: 'manual' };
  if (cookie) opts.headers.cookie = cookie;
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(base + url, opts);
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}

before(async () => {
  mock = createMock();
  await new Promise((r) => { mockServer = mock.app.listen(0, r); });
  Object.assign(process.env, {
    GIROAUTO_SKIP_ENV: '1',
    DATA_DIR: tmp,
    GIROAUTO_DB: path.join(tmp, 'test.db'),
    META_APP_ID: '123',
    META_APP_SECRET: 'secret',
    META_GRAPH_URL: `http://127.0.0.1:${mockServer.address().port}`,
    PUBLIC_URL: 'http://localhost:9',
  });
  const app = require('../src/server');
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => { server?.close(); mockServer?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

let vehicleId;

test('cadastro e login', async () => {
  let r = await api('POST', '/api/auth/register', { loja: 'Autos Paraná', nome: 'Darlan', email: 'd@x.com', senha: '12345678' });
  assert.equal(r.status, 200);
  r = await api('GET', '/api/me');
  assert.equal(r.body.store.slug, 'autos-parana');
  cookie = '';
  r = await api('POST', '/api/auth/login', { email: 'd@x.com', senha: 'errada00' });
  assert.equal(r.status, 401);
  r = await api('POST', '/api/auth/login', { email: 'd@x.com', senha: '12345678' });
  assert.equal(r.status, 200);
});

test('veículo com fotos e publicação pela extensão', async () => {
  let r = await api('POST', '/api/vehicles', {
    marca: 'Chevrolet', modelo: 'Onix', versao: 'LT 1.0 Turbo', ano_fab: 2021, ano_modelo: 2022, km: '48.200',
    preco: 'R$ 74.900', cambio: 'Automático', combustivel: 'Flex', carroceria: 'Hatch', cor: 'Prata', cor_interna: 'Preto', catalogo: true,
  });
  assert.equal(r.status, 201);
  vehicleId = r.body.id;
  assert.equal(r.body.km, 48200);
  assert.equal(r.body.preco, 74900);
  assert.equal(r.body.cor_interna, 'Preto');

  r = await api('POST', `/api/vehicles/${vehicleId}/publish`);
  assert.equal(r.status, 400, 'sem foto não publica');

  const fd = new FormData();
  fd.append('fotos', new Blob([JPG], { type: 'image/jpeg' }), 'a.jpg');
  fd.append('fotos', new Blob([JPG], { type: 'image/jpeg' }), 'b.jpg');
  r = await api('POST', `/api/vehicles/${vehicleId}/photos`, fd);
  assert.equal(r.status, 200);
  assert.equal(r.body.photos.length, 2);
  const [p1, p2] = r.body.photos.map((p) => p.id);
  r = await api('PUT', `/api/vehicles/${vehicleId}/photos/order`, { ids: [p2, p1] });
  assert.equal(r.body.photos[0].id, p2);

  const media = await fetch(base + new URL(r.body.photos[0].url).pathname);
  assert.equal(media.status, 200);
  assert.equal(media.headers.get('access-control-allow-origin'), '*');

  r = await api('POST', `/api/vehicles/${vehicleId}/publish`);
  assert.equal(r.status, 200);
  r = await api('POST', `/api/vehicles/${vehicleId}/publish`);
  assert.equal(r.status, 409, 'não duplica tarefa');

  // pareamento
  r = await api('POST', '/api/extension/pair-code');
  const code = r.body.code;
  const saved = cookie; cookie = '';
  r = await api('POST', '/api/ext/pair', { code: 'ERRADO' });
  assert.equal(r.status, 400);
  r = await api('POST', '/api/ext/pair', { code });
  assert.equal(r.status, 200);
  extToken = r.body.token;
  const auth = { authorization: `Bearer ${extToken}` };
  r = await api('GET', '/api/ext/next', undefined, auth);
  assert.equal(r.body.job.type, 'publicar');
  assert.equal(r.body.vehicle.photos.length, 2);
  r = await api('POST', `/api/ext/jobs/${r.body.job.id}`, { status: 'concluido', listing_url: 'https://www.facebook.com/marketplace/item/123/' }, auth);
  assert.equal(r.status, 200);
  r = await api('GET', '/api/ext/next', undefined, auth);
  assert.equal(r.body.job, null);
  cookie = saved;

  r = await api('GET', `/api/vehicles/${vehicleId}`);
  assert.equal(r.body.status, 'publicado');
  assert.equal(r.body.fb_listing_url, 'https://www.facebook.com/marketplace/item/123/');

  r = await api('POST', `/api/vehicles/${vehicleId}/republish`);
  assert.equal(r.status, 409, 'bloqueia antes de 7 dias');
  r = await api('POST', `/api/vehicles/${vehicleId}/republish`, { force: true });
  assert.equal(r.status, 200);
});

test('feed do catálogo e página pública', async () => {
  const me = await api('GET', '/api/meta/status');
  const u = new URL(me.body.feed_url);
  const csv = await (await fetch(base + u.pathname + u.search)).text();
  const [head, row] = csv.trim().split('\n');
  assert.match(head, /^vehicle_id,title,/);
  assert.match(head, /image\[1\]\.url/);
  assert.match(row, /giro-\d+,2022 Chevrolet Onix LT 1\.0 Turbo/);
  assert.match(row, /74900 BRL/);
  assert.match(row, /HATCHBACK/);
  const bad = await fetch(base + u.pathname + '?k=errado');
  assert.equal(bad.status, 404);
  const page = await (await fetch(`${base}/v/autos-parana/${vehicleId}`)).text();
  assert.match(page, /Chevrolet Onix/);
});

test('conexão com a Meta e campanha no WhatsApp', async () => {
  let r = await api('GET', '/api/meta/connect');
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get('location'));
  assert.equal(loc.searchParams.get('client_id'), '123');
  assert.match(loc.searchParams.get('scope'), /ads_management/);
  // O caso de uso "API de Marketing" rejeita estas permissões ("Invalid Scopes"); só vão se o administrador ligar.
  assert.doesNotMatch(loc.searchParams.get('scope'), /catalog_management|pages_manage_ads|instagram_basic/);
  let sc = await api('PUT', '/api/admin/meta-app/scopes', { scopes: ['catalogo', 'pages_manage_ads'] });
  assert.equal(sc.status, 200);
  assert.deepEqual(sc.body.optional_scopes.filter((o) => o.enabled).map((o) => o.key), ['catalogo']);
  r = await api('GET', '/api/meta/connect');
  assert.match(new URL(r.headers.get('location')).searchParams.get('scope'), /catalog_management/);
  assert.doesNotMatch(new URL(r.headers.get('location')).searchParams.get('scope'), /pages_manage_ads/);
  await api('PUT', '/api/admin/meta-app/scopes', { scopes: [] });
  const st = loc.searchParams.get('state');
  r = await api('GET', `/api/meta/callback?code=abc&state=${st}`);
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /meta=ok/);

  r = await api('GET', '/api/meta/assets');
  assert.equal(r.body.pages[0].ig_user_id, 'ig_1');
  r = await api('PUT', '/api/meta/settings', { ad_account_id: 'act_111', page_id: 'page_1', business_id: 'biz_1', whatsapp_number: '(44) 99999-0000' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ready, true);
  assert.equal(r.body.whatsapp_number, '44999990000');

  r = await api('GET', '/api/meta/cities?q=Assis');
  assert.equal(r.body[0].key, '242789');

  // sem appsecret_proof errado: confere que o proof é enviado
  assert.ok(mock.calls.find((c) => c.path === '/me/adaccounts').params.appsecret_proof);

  mock.calls.length = 0;
  r = await api('POST', '/api/campaigns', {
    name: 'Onix outubro', mode: 'whatsapp', daily_budget: '25', days: 7, radius_km: 40,
    city_key: '242789', city_name: 'Assis Chateaubriand, PR', vehicle_ids: [vehicleId], activate: true,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.status, 'ativa');

  const camp = mock.calls.find((c) => c.path === '/act_111/campaigns');
  assert.equal(camp.params.objective, 'OUTCOME_ENGAGEMENT');
  assert.equal(camp.params.status, 'PAUSED');
  assert.deepEqual(camp.params.special_ad_categories, []);
  const adset = mock.calls.find((c) => c.path === '/act_111/adsets');
  assert.equal(adset.params.daily_budget, 2500);
  assert.equal(adset.params.destination_type, 'WHATSAPP');
  assert.equal(adset.params.optimization_goal, 'CONVERSATIONS');
  assert.equal(adset.params.promoted_object.whatsapp_phone_number, '44999990000');
  assert.deepEqual(adset.params.targeting.publisher_platforms, ['facebook', 'instagram']);
  assert.equal(adset.params.targeting.targeting_automation.advantage_audience, 0);
  assert.equal(adset.params.targeting.geo_locations.cities[0].radius, 40);
  assert.ok(mock.calls.find((c) => c.path === '/act_111/adimages'));
  const creative = mock.calls.find((c) => c.path === '/act_111/adcreatives');
  assert.equal(creative.params.object_story_spec.instagram_user_id, 'ig_1');
  assert.equal(creative.params.object_story_spec.link_data.call_to_action.type, 'WHATSAPP_MESSAGE');
  const activations = mock.calls.filter((c) => c.method === 'POST' && c.params.status === 'ACTIVE');
  assert.equal(activations.length, 3);

  r = await api('GET', '/api/campaigns?refresh=1');
  assert.equal(r.body[0].stats.conversations, 7);
  assert.equal(r.body[0].stats.spend, 31.5);

  r = await api('POST', `/api/campaigns/${r.body[0].id}/pause`);
  assert.equal(r.body.status, 'pausada');
});

test('falha na Meta desfaz o que foi criado', async () => {
  mock.calls.length = 0;
  mock.state.failOn = { method: 'POST', re: /\/adsets$/ };
  const r = await api('POST', '/api/campaigns', {
    name: 'Vai falhar', mode: 'messenger', daily_budget: 10, days: 3, radius_km: 20,
    city_key: '242789', city_name: 'Assis', vehicle_ids: [vehicleId],
  });
  mock.state.failOn = null;
  assert.equal(r.status, 502);
  assert.match(r.body.error, /Público pequeno demais/);
  assert.equal(r.body.campaign.status, 'erro');
  assert.ok(mock.calls.find((c) => c.method === 'DELETE'), 'apagou a campanha criada');
});

test('catálogo e campanha de catálogo dinâmico', async () => {
  let r = await api('POST', '/api/meta/catalog/setup');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.catalog_id && r.body.feed_id);
  const cat = mock.calls.find((c) => c.path === '/biz_1/owned_product_catalogs');
  assert.equal(cat.params.vertical, 'vehicles');
  mock.calls.length = 0;
  r = await api('POST', '/api/campaigns', {
    name: 'Catálogo', mode: 'catalogo', daily_budget: 15, days: 10, radius_km: 50,
    city_key: '242789', city_name: 'Assis', vehicle_ids: [vehicleId],
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.status, 'pausada');
  const camp = mock.calls.find((c) => c.path === '/act_111/campaigns');
  assert.equal(camp.params.objective, 'OUTCOME_TRAFFIC');
  assert.ok(camp.params.promoted_object.product_catalog_id);
  const creative = mock.calls.find((c) => c.path === '/act_111/adcreatives');
  assert.ok(creative.params.product_set_id);
  assert.match(creative.params.object_story_spec.template_data.name, /\{\{vehicle\.make\}\}/);
  // Um veículo só: imagem única (carrossel com 1 item dá erro #194 na Meta).
  assert.equal(creative.params.object_story_spec.template_data.format_option, 'single_image');
  assert.equal(creative.params.object_story_spec.template_data.multi_share_end_card, undefined);
});

test('publicação assistida (sem extensão): fotos em zip e registro manual', async () => {
  let r = await api('GET', '/api/me');
  assert.equal(r.body.store.pub_mode, 'manual');
  const res = await fetch(`${base}/api/vehicles/${vehicleId}/photos.zip`, { headers: { cookie } });
  assert.equal(res.status, 200);
  const zip = Buffer.from(await res.arrayBuffer());
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt16LE(zip.length - 22 + 8), 2, 'duas fotos no zip');
  r = await api('POST', `/api/vehicles/${vehicleId}/mark-published`, { listing_url: 'http://evil.com' });
  assert.equal(r.status, 400);
  r = await api('POST', `/api/vehicles/${vehicleId}/mark-published`, { listing_url: 'https://www.facebook.com/marketplace/item/999/?ref=x' });
  assert.equal(r.status, 200);
  assert.equal(r.body.fb_listing_url, 'https://www.facebook.com/marketplace/item/999/');
  const jobs = await api('GET', '/api/jobs');
  assert.ok(!jobs.body.some((j) => j.status === 'pendente'), 'cancelou tarefas da extensão');
});

test('vendido no modo assistido pede exclusão manual', async () => {
  // cria e publica um segundo veículo
  let r = await api('POST', '/api/vehicles', { marca: 'Fiat', modelo: 'Strada', ano_modelo: 2022, km: 1000, preco: 100000 });
  const id2 = r.body.id;
  await api('POST', `/api/vehicles/${id2}/mark-published`, {});
  r = await api('POST', `/api/vehicles/${id2}/sold`);
  assert.equal(r.body.excluir_manual, true);
  const jobs = await api('GET', '/api/jobs');
  assert.ok(!jobs.body.some((j) => j.vehicle_id === id2 && j.type === 'excluir'));
});

test('vendido gera exclusão do anúncio e aviso de campanha', async () => {
  let m = await api('PUT', '/api/store/pub-mode', { mode: 'extensao' });
  assert.equal(m.status, 200);
  const r = await api('POST', `/api/vehicles/${vehicleId}/sold`);
  assert.equal(r.status, 200);
  const jobs = await api('GET', '/api/jobs');
  assert.ok(jobs.body.find((j) => j.type === 'excluir' && j.status === 'pendente'));
  assert.ok(jobs.body.find((j) => j.type === 'republicar' && j.status === 'cancelado'));
  assert.equal(r.body.excluir_manual, false);
});

test('administrador configura o app da Meta pelo painel', async () => {
  let r = await api('GET', '/api/me');
  assert.equal(r.body.user.is_admin, true, 'primeiro usuário é administrador');
  r = await api('GET', '/api/admin/meta-app');
  assert.equal(r.body.source, 'env');
  assert.match(r.body.redirect_uri, /\/api\/meta\/callback$/);
  r = await api('PUT', '/api/admin/meta-app', { app_id: '123', app_secret: 'curta' });
  assert.equal(r.status, 400);
  mock.state.failOn = { method: 'GET', re: /oauth\/access_token$/ };
  r = await api('PUT', '/api/admin/meta-app', { app_id: '1234567890', app_secret: 'a'.repeat(32) });
  mock.state.failOn = null;
  assert.equal(r.status, 400);
  assert.match(r.body.error, /não aceitou/);
  r = await api('PUT', '/api/admin/meta-app', { app_id: '1234567890', app_secret: 'b'.repeat(32) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.source, 'painel');
  assert.equal(r.body.app_id, '1234567890');
  r = await api('GET', '/api/meta/connect');
  assert.equal(new URL(r.headers.get('location')).searchParams.get('client_id'), '1234567890');
  for (const p of ['/privacidade', '/exclusao-de-dados', '/termos']) assert.equal((await fetch(base + p)).status, 200);

  // outra loja não é administradora
  const saved = cookie; cookie = '';
  r = await api('POST', '/api/auth/register', { loja: 'Outra Loja', nome: 'Ana', email: 'ana@x.com', senha: '12345678' });
  r = await api('GET', '/api/me');
  assert.equal(r.body.user.is_admin, false);
  r = await api('PUT', '/api/admin/meta-app', { app_id: '999999', app_secret: 'c'.repeat(32) });
  assert.equal(r.status, 403);
  cookie = saved;
});

test('preenchimento automático: veículo escolhido, ponte e favorito', async () => {
  let r = await api('POST', '/api/vehicles', { marca: 'Jeep', modelo: 'Renegade', ano_modelo: 2019, km: 81000, preco: 84500 });
  const id = r.body.id;
  r = await api('POST', '/api/assist/start', { vehicle_id: id });
  assert.equal(r.status, 400, 'sem foto não inicia');
  const fd = new FormData();
  fd.append('fotos', new Blob([JPG], { type: 'image/jpeg' }), 'a.jpg');
  await api('POST', `/api/vehicles/${id}/photos`, fd);
  r = await api('POST', '/api/assist/start', { vehicle_id: id });
  assert.equal(r.status, 200);
  r = await api('GET', '/api/assist/current');
  assert.equal(r.body.vehicle.id, id);
  assert.equal(r.body.vehicle.photos.length, 1);
  assert.equal((await fetch(base + '/ponte')).status, 200);
  const bm = await (await fetch(base + '/bookmarklet.js')).text();
  assert.match(bm, /__GIRO_ORIGIN__/);
  assert.ok(!/innerHTML/.test(bm), 'favorito não usa innerHTML');
  r = await api('GET', '/health');
  assert.equal(r.body.version, require('../package.json').version);
});

test('público personalizado, interesses, posicionamentos e alcance estimado', async () => {
  let r = await api('GET', '/api/meta/interests?q=carros');
  assert.equal(r.status, 200);
  assert.equal(r.body[0].name, 'Automóveis');
  const aud = { city_key: '242789', city_name: 'Assis', radius_km: 30, age_min: 25, age_max: 55, audience_mode: 'manual', genders: '1',
    interests: [{ id: r.body[0].id, name: r.body[0].name }], placements: 'manual', positions: ['fb_marketplace', 'ig_reels'] };
  r = await api('POST', '/api/meta/reach', aud);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.lower, 38000);
  const est = mock.calls.find((c) => c.path.endsWith('/reachestimate'));
  assert.deepEqual(est.params.targeting_spec.genders, [1]);
  assert.equal(est.params.targeting_spec.flexible_spec[0].interests[0].id, '6003176678152');
  assert.deepEqual(est.params.targeting_spec.facebook_positions, ['marketplace']);
  assert.deepEqual(est.params.targeting_spec.instagram_positions, ['reels']);

  // campanha com Advantage+ e posicionamento automático
  const v = await api('POST', '/api/vehicles', { marca: 'Ford', modelo: 'Ka', ano_modelo: 2019, km: 50000, preco: 45000 });
  const fd = new FormData(); fd.append('fotos', new Blob([JPG], { type: 'image/jpeg' }), 'a.jpg');
  await api('POST', `/api/vehicles/${v.body.id}/photos`, fd);
  await api('POST', `/api/vehicles/${v.body.id}/ready`);
  mock.calls.length = 0;
  const amanha = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
  r = await api('POST', '/api/campaigns', { name: 'Ka Advantage', mode: 'messenger', daily_budget: 12, days: 5, radius_km: 25,
    city_key: '242789', city_name: 'Assis', vehicle_ids: [v.body.id], audience_mode: 'advantage', age_min: 30, placements: 'auto', start_date: amanha });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const adset = mock.calls.find((c) => c.path === '/act_111/adsets');
  const t = adset.params.targeting;
  assert.equal(t.targeting_automation.advantage_audience, 1);
  assert.equal(t.age_min, 25, 'idade mínima limitada a 25 no Advantage+');
  assert.equal(t.publisher_platforms, undefined, 'posicionamento automático');
  assert.ok(adset.params.start_time.startsWith(amanha), 'começa na data escolhida');
});

test('v1.10: arte com preço (única imagem gerada) e duplicação', async () => {
  const arts = require('../src/arts');
  let r = await api('POST', '/api/vehicles', { marca: 'Volkswagen', modelo: 'Fox', versao: 'Track 1.6', ano_fab: 2015, ano_modelo: 2016, km: 98500, preco: 54900, cambio: 'Manual', combustivel: 'Flex', cor: 'Prata', carroceria: 'Hatch',
    destaques: ['teto_solar', 'convite_visita'], descricao: 'Volkswagen Fox Track 1.6 2015/2016\n\n✔ 98.500 km rodados\n✔ Câmbio manual\n✔ Flex\n✔ Cor prata\n✔ Teto solar\n\nCarro de garagem, revisado.\n\nAuto Center · Assis/PR. Chame para agendar uma visita ou test drive.' });
  const id = r.body.id;
  const fd = new FormData();
  for (const n of ['a', 'b', 'c']) fd.append('fotos', new Blob([JPG], { type: 'image/jpeg' }), `${n}.jpg`);
  await api('POST', `/api/vehicles/${id}/photos`, fd);
  await arts.idle();
  r = await api('GET', `/api/vehicles/${id}/arts`);
  assert.equal(r.body.length, 1, 'só a arte com preço');
  assert.equal(r.body[0].status, 'pronta', JSON.stringify(r.body[0]));
  const card1 = r.body[0].filename;
  const img = await fetch(base + '/media/' + card1);
  assert.equal(Buffer.from(await img.arrayBuffer()).readUInt16BE(0), 0xffd8, 'arte em JPEG');

  // Mudar o preço refaz a arte.
  await api('PUT', `/api/vehicles/${id}`, { ...(await api('GET', `/api/vehicles/${id}`)).body, preco: 52900 });
  await arts.idle();
  r = await api('GET', `/api/vehicles/${id}/arts`);
  assert.notEqual(r.body[0].filename, card1);
  assert.equal((await fetch(base + '/media/' + card1)).status, 404, 'arte antiga apagada');

  // Legenda do Instagram sem repetições: título, itens e convite aparecem uma vez só.
  const cd = await api('GET', `/api/vehicles/${id}/channel-data`);
  const cap = cd.body.caption;
  assert.equal((cap.match(/Fox Track/g) || []).length, 1, cap);
  assert.equal((cap.match(/98\.500 km/g) || []).length, 1, cap);
  assert.equal((cap.match(/Teto solar/g) || []).length, 1, cap);
  assert.match(cap, /Carro de garagem, revisado\./);
  assert.doesNotMatch(cap, /test drive/, 'o contato da loja já está na legenda');

  // Duplicar: mesmos dados e fotos copiadas; editar a cópia não muda o original.
  r = await api('POST', `/api/vehicles/${id}/duplicate`);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const dup = r.body;
  assert.notEqual(dup.id, id);
  assert.equal(dup.modelo, 'Fox');
  assert.equal(dup.preco, 52900);
  assert.deepEqual(dup.destaques, ['teto_solar', 'convite_visita']);
  assert.equal(dup.photos.length, 3);
  const orig = (await api('GET', `/api/vehicles/${id}`)).body;
  assert.ok(dup.photos.every((p) => !orig.photos.some((o) => o.filename === p.filename)), 'fotos são cópias');
  assert.equal(dup.status, 'pronto');
  assert.equal(dup.fb_listing_url, '');
  await api('PUT', `/api/vehicles/${dup.id}`, { ...dup, cor: 'Branco', preco: 50000 });
  await api('DELETE', `/api/vehicles/${dup.id}/photos/${dup.photos[0].id}`);
  const again = (await api('GET', `/api/vehicles/${id}`)).body;
  assert.equal(again.cor, 'Prata');
  assert.equal(again.preco, 52900);
  assert.equal(again.photos.length, 3);
  assert.equal((await fetch(again.photos[0].url.replace(/^https?:\/\/[^/]+/, base))).status, 200, 'foto do original continua');
  await api('DELETE', `/api/vehicles/${dup.id}`);
  await arts.idle();
  globalThis.__foxId = id;
});

test('v1.7: Instagram, Webmotors, OLX e exclusão do veículo', async () => {
  const id = globalThis.__foxId;
  process.env.IG_POLL_MS = '10';
  mock.calls.length = 0;
  let r = await api('GET', `/api/vehicles/${id}/channel-data`);
  assert.match(r.body.caption, /Volkswagen Fox/);
  assert.match(r.body.caption, /R\$ 52\.900/);
  assert.ok(r.body.fields.find((f) => f.label === 'Quilometragem' && f.value === '98500'));

  r = await api('POST', `/api/vehicles/${id}/instagram`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.instagram.status, 'publicando');
  for (let i = 0; i < 100; i++) {
    r = await api('GET', `/api/vehicles/${id}`);
    if (r.body.canais.instagram?.status !== 'publicando') break;
    await new Promise((res) => setTimeout(res, 50));
  }
  assert.equal(r.body.canais.instagram.status, 'publicado', JSON.stringify(r.body.canais));
  assert.equal(r.body.canais.instagram.url, 'https://www.instagram.com/p/TESTE123/');
  const items = mock.calls.filter((c) => c.path === '/ig_1/media' && c.params.is_carousel_item);
  assert.equal(items.length, 4, 'arte + 3 fotos');
  assert.match(items[0].params.image_url, /\/media\/[a-f0-9]{32}\.jpg$/);
  const carousel = mock.calls.find((c) => c.path === '/ig_1/media' && c.params.media_type === 'CAROUSEL');
  assert.equal(carousel.params.children.split(',').length, 4);
  assert.match(carousel.params.caption, /#volkswagen/);
  assert.ok(mock.calls.find((c) => c.path === '/ig_1/media_publish'));

  // Permissões: lista o que foi concedido; sem permissão de publicar, explica o que falta.
  r = await api('GET', '/api/meta/permissions');
  assert.ok(r.body.granted.includes('instagram_content_publish'));
  const ch = require('../src/channels');
  assert.match(ch.permissionHelp({ granted: ['instagram_basic'], declined: [] }), /instagram_content_publish/);
  assert.match(ch.permissionHelp({ granted: ['instagram_basic'], declined: ['instagram_content_publish'] }), /Editar acesso/);

  // Instagram direto (login do Instagram): conecta e publica sem passar pela Página.
  const mp = `http://127.0.0.1:${mockServer.address().port}`;
  Object.assign(process.env, { INSTAGRAM_AUTH_URL: `${mp}/igauth`, INSTAGRAM_API_URL: `${mp}/igapi`, INSTAGRAM_GRAPH_URL: `${mp}/ig` });
  r = await api('GET', '/api/instagram/connect');
  assert.equal(r.status, 400, 'sem o app do Instagram configurado');
  r = await api('PUT', '/api/admin/instagram-app', { app_id: '998877', app_secret: 'c'.repeat(32) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await api('GET', '/api/instagram/connect');
  const igLoc = new URL(r.headers.get('location'));
  assert.equal(igLoc.searchParams.get('client_id'), '998877');
  assert.match(igLoc.searchParams.get('scope'), /instagram_business_content_publish/);
  assert.match(igLoc.searchParams.get('redirect_uri'), /\/api\/instagram\/callback$/);
  r = await api('GET', `/api/instagram/callback?code=igcode&state=${igLoc.searchParams.get('state')}`);
  assert.match(r.headers.get('location'), /ig=ok/);
  const cdIg = await api('GET', `/api/vehicles/${id}/channel-data`);
  assert.equal(cdIg.body.instagram.direct.username, '_box85_');
  r = await api('POST', `/api/vehicles/${id}/instagram`, {});
  for (let i = 0; i < 100; i++) {
    r = await api('GET', `/api/vehicles/${id}`);
    if (r.body.canais.instagram?.status !== 'publicando') break;
    await new Promise((res) => setTimeout(res, 50));
  }
  assert.equal(r.body.canais.instagram.status, 'publicado', JSON.stringify(r.body.canais));
  assert.equal(r.body.canais.instagram.url, 'https://www.instagram.com/p/DIRETO/');
  assert.ok(mock.state.igCalls.find((c) => c.path === '/1789/media_publish'), 'publicou pela API do Instagram');
  await api('POST', '/api/instagram/disconnect');

  r = await api('POST', `/api/vehicles/${id}/listings/olx`, { url: 'https://www.webmotors.com.br/x' });
  assert.equal(r.status, 400, 'link de outro site é recusado');
  r = await api('POST', `/api/vehicles/${id}/listings/olx`, { url: 'https://pr.olx.com.br/regiao-de-maringa/autos/fox-123' });
  assert.equal(r.status, 200);
  r = await api('POST', `/api/vehicles/${id}/listings/webmotors`, { url: '' });
  assert.equal(r.status, 200);
  r = await api('GET', `/api/vehicles/${id}`);
  assert.deepEqual(Object.keys(r.body.canais).sort(), ['instagram', 'olx', 'webmotors']);
  r = await api('DELETE', `/api/vehicles/${id}/listings/webmotors`);
  assert.equal(r.body.webmotors, undefined);

  // Vendido: lembra de retirar os anúncios dos outros sites.
  r = await api('POST', `/api/vehicles/${id}/sold`);
  assert.deepEqual(r.body.remover.map((x) => x.channel).sort(), ['instagram', 'olx']);

  // Excluir o vendido apaga tudo, inclusive as imagens geradas.
  const artFile = (await api('GET', `/api/vehicles/${id}/arts`)).body[0].filename;
  r = await api('DELETE', `/api/vehicles/${id}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.remover, []);
  assert.equal((await api('GET', `/api/vehicles/${id}`)).status, 404);
  assert.equal((await fetch(base + '/media/' + artFile)).status, 404);

  // Excluir um veículo publicado é permitido e devolve o anúncio do Marketplace para retirar.
  r = await api('POST', '/api/vehicles', { marca: 'Fiat', modelo: 'Uno', ano_modelo: 2015, km: 1000, preco: 30000 });
  const uno = r.body.id;
  await api('POST', `/api/vehicles/${uno}/mark-published`, { listing_url: 'https://www.facebook.com/marketplace/item/123/' });
  r = await api('DELETE', `/api/vehicles/${uno}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.remover[0].channel, 'marketplace');
  assert.equal(r.body.remover[0].url, 'https://www.facebook.com/marketplace/item/123/');
});

test('v1.8: destaques, transparência e preço de oferta', async () => {
  const base1 = { marca: 'Honda', modelo: 'Civic', versao: 'EXL 2.0', ano_fab: 2018, ano_modelo: 2019, km: 70000, preco: 99900, cambio: 'CVT', combustivel: 'Flex', cor: 'Preto', carroceria: 'Sedã', descricao: 'Carro muito conservado.' };
  let r = await api('POST', '/api/vehicles', { ...base1, destaques: ['pericia_aprovada', 'pericia_premium', 'pneus_novos', 'pneus_seminovos', 'leilao', 'xyz'] });
  assert.equal(r.status, 201);
  const id = r.body.id;
  assert.deepEqual(r.body.destaques, ['pericia_aprovada', 'pneus_novos', 'leilao'], 'um por grupo e só itens conhecidos');
  assert.match(r.body.descricao_anuncio, /Carro muito conservado\.\n\n⚠️ Transparência: Veículo com passagem por leilão\./);
  r = await api('GET', '/api/me');
  assert.ok(r.body.options.destaques.find((d) => d.key === 'sinistro' && d.alerta));

  // Se a descrição já cita o leilão, não repete.
  r = await api('PUT', `/api/vehicles/${id}`, { ...base1, descricao: 'Veículo de leilão, laudo aprovado.', destaques: ['leilao', 'sem_retoques'] });
  assert.equal(r.body.descricao_anuncio, 'Veículo de leilão, laudo aprovado.');
  let cd = await api('GET', `/api/vehicles/${id}/channel-data`);
  assert.match(cd.body.caption, /✅ Pintura original, sem retoques/);
  assert.ok(cd.body.fields.find((f) => f.label === 'Descrição').value.includes('✔ Pintura original, sem retoques'));
  assert.equal(cd.body.instagram.ig_user_id, 'ig_1');

  // Preço de oferta: vale só se menor que o preço; vai para os anúncios, o catálogo e o preenchimento.
  r = await api('PUT', `/api/vehicles/${id}`, { ...base1, preco_oferta: 120000 });
  assert.equal(r.body.oferta_ativa, false, 'oferta maior que o preço é ignorada');
  await api('POST', `/api/vehicles/${id}/photos`, (() => { const f = new FormData(); f.append('fotos', new Blob([JPG], { type: 'image/jpeg' }), 'a.jpg'); return f; })());
  await api('POST', `/api/vehicles/${id}/mark-published`, {});
  r = await api('GET', `/api/vehicles/${id}`);
  assert.equal(r.body.pode_republicar, false);
  await new Promise((res) => setTimeout(res, 1100));
  r = await api('PUT', `/api/vehicles/${id}`, { ...base1, preco_oferta: '94.900', catalogo: true });
  assert.equal(r.body.oferta_ativa, true);
  assert.equal(r.body.preco_anuncio, 94900);
  assert.equal(r.body.pode_republicar, true, 'oferta nova libera republicar com o preço de ocasião');
  assert.equal(r.body.oferta_nova, true);
  cd = await api('GET', `/api/vehicles/${id}/channel-data`);
  assert.match(cd.body.caption, /OFERTA: de R\$ 99\.900 por R\$ 94\.900/);
  assert.equal(cd.body.fields.find((f) => f.label === 'Preço').value, '94900');
  const store = require('../src/db').get('SELECT * FROM stores WHERE id = (SELECT store_id FROM vehicles WHERE id = ?)', id);
  const csv = await (await fetch(`${base}/feed/${store.slug}.csv?k=${store.feed_key}`)).text();
  assert.match(csv, /sale_price/);
  assert.match(csv, /94900 BRL/);
  await api('POST', '/api/assist/start', { vehicle_id: id });
  const cur = await api('GET', '/api/assist/current');
  assert.equal(cur.body.vehicle.preco, 94900, 'o preenchimento no Facebook usa o preço de oferta');
  // Tirar a oferta volta ao preço normal.
  r = await api('PUT', `/api/vehicles/${id}`, { ...base1, preco_oferta: '' });
  assert.equal(r.body.oferta_ativa, false);
  assert.equal(r.body.preco_anuncio, 99900);
});

test('v2.0: placa, FIPE, proprietário, procuração e importação', async () => {
  const mp = `http://127.0.0.1:${mockServer.address().port}`;
  Object.assign(process.env, { PLATE_URL_TEMPLATE: `${mp}/placafipe/placa/{placa}`, FIPE_API_URL: `${mp}/fipe` });
  let r = await api('GET', '/api/plate/abc-1d23');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.encontrado, true);
  assert.equal(r.body.marca, 'Volkswagen');
  assert.equal(r.body.modelo, 'Fox');
  assert.equal(r.body.versao, 'Track 1.6 Flex 8V 5p');
  assert.equal(r.body.ano_fab, 2015); assert.equal(r.body.ano_modelo, 2016);
  assert.equal(r.body.cor, 'Prata'); assert.equal(r.body.combustivel, 'Flex');
  assert.equal(r.body.fipe, 49846); assert.equal(r.body.fipe_codigo, '005340-6');
  r = await api('GET', '/api/plate/ABC1D23');
  assert.equal(r.body.cache, true, 'segunda consulta vem do cache');
  r = await api('GET', '/api/plate/BLQ1A23');
  assert.equal(r.body.precisa_extensao, true, 'site bloqueado: painel tenta pela extensão');
  assert.match(r.body.url, /BLQ1A23/);
  r = await api('POST', '/api/plate/BLQ1A23/html', { html: '<table><tr><td>Marca:</td><td>GM</td></tr><tr><td>Modelo:</td><td>ONIX LT</td></tr><tr><td>Ano:</td><td>2020</td></tr></table>' });
  assert.equal(r.body.marca, 'Chevrolet'); assert.equal(r.body.modelo, 'Onix');
  r = await api('GET', '/api/plate/XX12');
  assert.equal(r.status, 400);
  // v2.1: se a primeira fonte falha, tenta a segunda (keplaca) antes de pedir a extensão.
  process.env.PLATE_URL_TEMPLATE = `${mp}/fora-do-ar/{placa},${mp}/placafipe/placa/{placa}`;
  r = await api('GET', '/api/plate/QPB5I85');
  assert.equal(r.body.encontrado, true, JSON.stringify(r.body)); assert.equal(r.body.modelo, 'Fox');
  process.env.PLATE_URL_TEMPLATE = `${mp}/placafipe/placa/{placa},${mp}/fora-do-ar/{placa}`;
  require('../src/db').run("DELETE FROM plate_cache WHERE placa = 'BLQ1A23'");
  r = await api('GET', '/api/plate/BLQ1A23');
  assert.equal(r.body.precisa_extensao, true); assert.equal(r.body.urls.length, 2);
  process.env.PLATE_URL_TEMPLATE = `${mp}/placafipe/placa/{placa}`;

  // Tabela FIPE gratuita: marca -> modelo -> ano -> preço
  r = await api('GET', '/api/fipe/carros/marcas');
  assert.equal(r.body[0].codigo, '59');
  r = await api('GET', '/api/fipe/carros/marcas/59/modelos/5585/anos/2016-1');
  assert.equal(r.body.marca, 'Volkswagen'); assert.equal(r.body.versao, 'Track 1.6 Flex 8V 5p');
  assert.equal(r.body.fipe, 49846); assert.equal(r.body.fipe_ref, 'outubro de 2026');

  // Proprietário, consignação e procuração (documento privado)
  r = await api('POST', '/api/vehicles', { marca: 'Volkswagen', modelo: 'Fox', ano_modelo: 2016, km: 98500, preco: 54900, fipe: 49846, placa: 'ABC1D23', fipe_codigo: '005340-6',
    proprietario_tipo: 'consignado', doc_tipo: 'procuracao', proprietario_nome: 'João da Silva', proprietario_tel: '(44) 98888-7777', procuracao_validade: '2027-01-31', consig_comissao_pct: '8,5' });
  const id = r.body.id;
  assert.equal(r.body.proprietario_tipo, 'consignado');
  assert.equal(r.body.doc_tipo, 'procuracao');
  assert.equal(r.body.consig_comissao_pct, 8.5);
  // Compatibilidade: o valor antigo "procuracao" no proprietário vira consignado + documentação por procuração.
  const legado = await api('POST', '/api/vehicles', { marca: 'Fiat', modelo: 'Uno', proprietario_tipo: 'procuracao' });
  assert.equal(legado.body.proprietario_tipo, 'consignado'); assert.equal(legado.body.doc_tipo, 'procuracao');
  const loja = await api('POST', '/api/vehicles', { marca: 'Fiat', modelo: 'Uno', proprietario_tipo: 'proprio', doc_tipo: 'renave' });
  assert.equal(loja.body.proprietario_tipo, 'proprio'); assert.equal(loja.body.doc_tipo, 'renave');
  await api('DELETE', `/api/vehicles/${legado.body.id}`); await api('DELETE', `/api/vehicles/${loja.body.id}`);
  assert.equal(r.body.fipe_diff_pct, 10.1);
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
  const fd = new FormData(); fd.append('arquivo', new Blob([pdf], { type: 'application/pdf' }), 'proc.pdf');
  r = await api('POST', `/api/vehicles/${id}/procuracao`, fd);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.tem_procuracao, true);
  const docName = require('../src/db').get('SELECT procuracao_file f FROM vehicles WHERE id = ?', id).f;
  assert.match(docName, /^doc-[a-f0-9]{32}\.pdf$/);
  assert.equal((await fetch(`${base}/media/${docName}`)).status, 404, 'procuração não é pública');
  const pr = await fetch(`${base}/api/vehicles/${id}/procuracao`, { headers: { cookie } });
  assert.equal(pr.status, 200);
  assert.equal(pr.headers.get('content-type'), 'application/pdf');

  // Importação: modelo, prévia e gravação
  const t = await fetch(`${base}/api/import/modelo.xlsx`, { headers: { cookie } });
  assert.equal(t.status, 200);
  const xlsx = Buffer.from(await t.arrayBuffer());
  let up = new FormData(); up.append('planilha', new Blob([xlsx]), 'modelo.xlsx');
  r = await api('POST', '/api/import/preview', up);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.linhas.length, 1);
  assert.equal(r.body.linhas[0].preco, 54900);
  assert.deepEqual(r.body.linhas[0].destaques, ['pericia_aprovada', 'teto_solar']);
  const csv = 'Marca;Modelo;Ano;KM;Valor;Câmbio;Situação;Valor de compra;Data de compra\nFiat;Argo Drive 1.0;2021;45.000;R$ 72.900,00;manual;Consignado;65000;05/09/2026\nHonda;;2019;;;;;;\n';
  up = new FormData(); up.append('planilha', new Blob([csv], { type: 'text/csv' }), 'estoque.csv');
  r = await api('POST', '/api/import/preview', up);
  assert.equal(r.body.linhas.length, 2);
  const [argo, ruim] = r.body.linhas;
  assert.equal(argo.preco, 72900); assert.equal(argo.km, 45000); assert.equal(argo.cambio, 'Manual');
  assert.equal(argo.proprietario_tipo, 'consignado'); assert.equal(argo.compra_valor, 65000); assert.equal(argo.compra_data, '2026-09-05');
  assert.equal(ruim.ok, false);
  r = await api('POST', '/api/import/commit', { linhas: r.body.linhas });
  assert.deepEqual(r.body, { importados: 1, pulados: 1 });
  const imp = (await api('GET', '/api/vehicles')).body.find((v) => v.modelo.startsWith('Argo'));
  assert.equal(imp.status, 'rascunho');
  assert.equal(imp.compra_valor, 65000);
  globalThis.__v2 = { id, argo: imp.id };
});

test('v2.0: equipe e permissões do vendedor', async () => {
  let r = await api('POST', '/api/team', { name: 'Carlos Vendedor', email: 'carlos@x.com', senha: 'vende1234', permissions: ['cadastrar', 'vender', 'xyz'] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const carlos = r.body.users.find((u) => u.email === 'carlos@x.com');
  assert.deepEqual(carlos.permissions.sort(), ['cadastrar', 'vender']);
  const adminCookie = cookie;
  cookie = '';
  await api('POST', '/api/auth/login', { email: 'carlos@x.com', senha: 'vende1234' });
  r = await api('GET', '/api/me');
  assert.deepEqual(r.body.user.perms.sort(), ['cadastrar', 'vender']);
  const v = (await api('GET', `/api/vehicles/${globalThis.__v2.id}`)).body;
  assert.equal(v.compra_valor, undefined, 'sem permissão financeira não vê valores de compra');
  assert.equal(v.financeiro, undefined);
  r = await api('POST', `/api/vehicles/${v.id}/publish`); assert.equal(r.status, 403);
  r = await api('DELETE', `/api/vehicles/${v.id}`); assert.equal(r.status, 403);
  r = await api('GET', '/api/results'); assert.equal(r.status, 403);
  r = await api('PUT', `/api/vehicles/${v.id}`, { ...v, preco: 50000 }); assert.equal(r.status, 403, 'não altera preço');
  r = await api('PUT', `/api/vehicles/${v.id}`, { ...v, km: 99000 }); assert.equal(r.status, 200, 'mas edita os dados');
  r = await api('GET', '/api/team'); assert.equal(r.status, 403, 'só o dono gerencia a equipe');
  // Dono desativa o vendedor: a sessão cai.
  const sellerCookie = cookie;
  cookie = adminCookie;
  r = await api('PUT', `/api/team/${carlos.id}`, { active: false });
  assert.equal(r.body.users.find((u) => u.id === carlos.id).active, false);
  cookie = sellerCookie;
  r = await api('GET', '/api/me'); assert.equal(r.status, 401);
  cookie = adminCookie;
  await api('PUT', `/api/team/${carlos.id}`, { active: true });
  globalThis.__carlos = carlos.id;
});

test('v2.0: gestão (custos, venda, parceiros, localização) e resultados', async () => {
  const { id } = globalThis.__v2;
  let r = await api('PUT', '/api/store/gestao', { parado_dias: 25, impostos_pct: '2' });
  assert.equal(r.body.impostos_pct, 2);
  // Carro próprio: compra 40.000 + custos 2.500, anunciado por 54.900
  await api('PUT', `/api/vehicles/${id}`, { ...(await api('GET', `/api/vehicles/${id}`)).body, proprietario_tipo: 'proprio' });
  r = await api('PUT', `/api/vehicles/${id}/finance`, { compra_valor: '40.000', compra_data: '2026-08-20', compra_de: 'João' });
  assert.equal(r.status, 200);
  r = await api('POST', '/api/partners', { nome: 'Oficina do Zé', tipo: 'oficina', contato: 'José', whatsapp: '(44) 99999-1111' });
  const ze = r.body.partners[0];
  assert.equal(ze.wa, '5544999991111');
  await api('POST', `/api/vehicles/${id}/costs`, { categoria: 'mecanica', descricao: 'Troca de embreagem', valor: '1800', parceiro_id: ze.id });
  await api('POST', `/api/vehicles/${id}/costs`, { categoria: 'estetica', descricao: 'Polimento', valor: 700 });
  r = await api('GET', `/api/vehicles/${id}/finance`);
  assert.equal(r.body.costs.length, 2);
  assert.equal(r.body.finance.custos_total, 2500);
  assert.equal(r.body.finance.previsto.bruto, 54900 - 40000 - 2500);
  assert.equal(r.body.finance.previsto.liquido, 54900 - 40000 - 2500 - Math.round(54900 * 0.02));
  // Localização: vai para a oficina; link de WhatsApp pronto para pedir o andamento.
  r = await api('PUT', `/api/vehicles/${id}/location`, { status: 'manutencao', parceiro_id: ze.id, previsao: '2026-10-20', obs: 'Embreagem' });
  assert.equal(r.body.local_label, 'Em manutenção');
  assert.equal(r.body.local_parceiro.nome, 'Oficina do Zé');
  assert.match(r.body.followup_url, /^https:\/\/wa\.me\/5544999991111\?text=.*andamento/);
  assert.match(decodeURIComponent(r.body.followup_url), /ABC1D23/);
  r = await api('GET', `/api/vehicles/${id}/moves`);
  assert.equal(r.body[0].parceiro_nome, 'Oficina do Zé');
  r = await api('GET', '/api/partners');
  assert.equal(r.body.partners[0].carros, 1);
  await api('PUT', `/api/vehicles/${id}/location`, { status: 'patio' });
  // Carro parado e oferta com um clique
  require('../src/db').run(`UPDATE vehicles SET created_at = datetime('now', '-30 days'), compra_data = NULL WHERE id = ?`, id);
  r = await api('GET', `/api/vehicles/${id}`);
  assert.equal(r.body.parado, true); assert.ok(r.body.dias_estoque >= 30);
  r = await api('GET', `/api/vehicles/${id}/offer-suggestion`);
  assert.ok(r.body.sugestao < 54900 && r.body.sugestao >= 49846, String(r.body.sugestao));
  assert.match(String(r.body.sugestao), /900$/);
  r = await api('POST', `/api/vehicles/${id}/offer`, { preco_oferta: r.body.sugestao });
  assert.equal(r.body.oferta_ativa, true);
  // Venda com dados e resultados do mês
  r = await api('POST', `/api/vehicles/${id}/sold`, { venda_valor: '52.000', venda_comprador: 'Maria', venda_pagamento: 'Financiado', venda_comissao: 500, venda_vendedor_id: globalThis.__carlos });
  assert.equal(r.status, 200);
  r = await api('GET', `/api/vehicles/${id}/finance`);
  assert.equal(r.body.finance.real.bruto, 52000 - 40000 - 2500);
  assert.equal(r.body.finance.real.liquido, 52000 - 40000 - 2500 - 500 - 1040);
  r = await api('GET', '/api/results');
  assert.equal(r.status, 200);
  assert.equal(r.body.kpis.vendidos >= 1, true);
  const linha = r.body.vendidos.find((l) => l.id === id);
  assert.equal(linha.liquido, 7960);
  assert.equal(r.body.meses.length, 12);
  r = await api('GET', `/api/results?vendedor=${globalThis.__carlos}`);
  assert.deepEqual(r.body.vendidos.map((l) => l.id), [id]);
  r = await api('GET', '/api/results?tipo=consignado');
  assert.equal(r.body.vendidos.length, 0);
});

test('v2.1: gestão no cadastro, custos previstos, venda completa, documentação, despesas e DRE', async () => {
  const D = require('../src/db');
  // Cadastro já com a gestão do carro: compra, origem, data, manutenção feita e custo previsto.
  let r = await api('POST', '/api/vehicles', { marca: 'Honda', modelo: 'Fit', versao: 'EX 1.5', ano_modelo: 2018, km: 70000, preco: 70000, placa: 'HFT2E18', proprietario_tipo: 'proprio', doc_tipo: 'renave' });
  const id = r.body.id;
  r = await api('PUT', `/api/vehicles/${id}/finance`, { compra_valor: 58000, compra_data: '2026-09-01', compra_origem: 'troca', compra_de: 'Cliente Pedro' });
  assert.equal(r.status, 200);
  r = await api('POST', `/api/vehicles/${id}/costs`, { categoria: 'mecanica', descricao: 'Revisão', valor: 900 });
  r = await api('POST', `/api/vehicles/${id}/costs`, { categoria: 'pneus', descricao: '4 pneus', valor: 1600, status: 'previsto' });
  r = await api('GET', `/api/vehicles/${id}/finance`);
  assert.equal(r.body.finance.custos_realizados, 900);
  assert.equal(r.body.finance.custos_previstos, 1600);
  assert.equal(r.body.finance.previsto.bruto, 70000 - 58000 - 2500);
  assert.equal(r.body.finance.investido, 58900);
  assert.equal(r.body.vehicle.compra_origem, 'troca');
  const prev = r.body.costs.find((c) => c.previsto);
  r = await api('PUT', `/api/vehicles/${id}/costs/${prev.id}`, { status: 'realizado', valor: 1500 });
  r = await api('GET', `/api/vehicles/${id}/finance`);
  assert.equal(r.body.finance.custos_realizados, 2400); assert.equal(r.body.finance.custos_previstos, 0);
  // Atualização parcial não apaga o resto.
  await api('PUT', `/api/vehicles/${id}/finance`, { compra_de: 'Pedro Souza' });
  r = await api('GET', `/api/vehicles/${id}/finance`);
  assert.equal(r.body.vehicle.compra_valor, 58000); assert.equal(r.body.vehicle.compra_de, 'Pedro Souza');
  // Parceiro criado direto do pop-up devolve o id para já ficar selecionado.
  r = await api('POST', '/api/partners', { nome: 'Despachante Rápido', tipo: 'despachante', whatsapp: '44988887777' });
  assert.equal(r.status, 201); assert.ok(r.body.id); assert.ok(r.body.partners.some((p) => p.id === r.body.id));
  // Venda completa com data, comprador, financiamento, troca e documento já preenchido.
  r = await api('POST', `/api/vehicles/${id}/sold`, { venda_valor: '68.500', venda_data: '2026-10-02', venda_pagamento: 'Financiamento', venda_entrada: 20000, venda_financeira: 'BV',
    venda_troca_valor: 15000, venda_troca_desc: 'Gol 2014', venda_comprador: 'Ana Lima', comprador_doc: '123.456.789-00', comprador_tel: '(44) 97777-6666', venda_comissao: 600, venda_obs: 'Garantia 3 meses', doc_status: 'preenchido' });
  assert.equal(r.status, 200);
  const v = D.get('SELECT * FROM vehicles WHERE id = ?', id);
  assert.equal(v.vendido_em.slice(0, 10), '2026-10-02'); assert.equal(v.venda_valor, 68500); assert.equal(v.venda_entrada, 20000);
  assert.equal(v.venda_financeira, 'BV'); assert.equal(v.venda_troca_valor, 15000); assert.equal(v.comprador_tel, '(44) 97777-6666'); assert.equal(v.doc_status, 'preenchido');
  // Documentação: lista, etapas, histórico e WhatsApp do comprador.
  r = await api('GET', '/api/docs');
  let doc = r.body.docs.find((x) => x.id === id);
  assert.equal(doc.status, 'preenchido'); assert.equal(doc.comprador, 'Ana Lima'); assert.match(doc.wa_url, /^https:\/\/wa\.me\/5544977776666/);
  r = await api('PUT', `/api/vehicles/${id}/doc`, { status: 'vistoria', obs: 'Vistoria dia 10' });
  assert.equal(r.status, 200);
  r = await api('PUT', `/api/vehicles/${id}/doc`, { status: 'entregue', entrega: '2026-10-12' });
  doc = r.body.docs.find((x) => x.id === id);
  assert.equal(doc.done, true); assert.equal(doc.entrega, '2026-10-12');
  r = await api('GET', `/api/vehicles/${id}/doc`);
  assert.deepEqual(r.body.map((m) => m.status), ['entregue', 'vistoria', 'preenchido']);
  // Edição posterior da venda.
  r = await api('PUT', `/api/vehicles/${id}/sale`, { venda_valor: 68000 });
  assert.equal(D.get('SELECT venda_valor FROM vehicles WHERE id = ?', id).venda_valor, 68000);
  assert.equal(D.get('SELECT venda_comprador FROM vehicles WHERE id = ?', id).venda_comprador, 'Ana Lima');
  // Despesas da loja (com repetição mensal) e DRE.
  r = await api('POST', '/api/expenses', { data: '2026-10-05', categoria: 'aluguel', descricao: 'Pátio', valor: 3000, repetir: 3 });
  assert.equal(r.status, 201);
  r = await api('GET', '/api/expenses?from=2026-10-01&to=2026-12-31');
  assert.equal(r.body.despesas.length, 3);
  r = await api('GET', '/api/results?from=2026-10-01&to=2026-10-31');
  const l = r.body.vendidos.find((x) => x.id === id);
  const imp = Math.round(68000 * 0.02);
  assert.equal(l.liquido, 68000 - 58000 - 2400 - 600 - imp);
  assert.equal(l.origem, 'troca'); assert.equal(l.pagamento, 'Financiamento');
  assert.equal(r.body.dre.despesas_loja, 3000);
  assert.equal(r.body.dre.resultado, r.body.dre.lucro_operacoes - 3000);
  assert.ok(r.body.faixas_venda.length === 6 && r.body.marcas.some((m) => m.label === 'Honda'));
  assert.ok(r.body.origens.some((o) => o.chave === 'troca'));
  r = await api('GET', '/api/results?from=2026-10-01&to=2026-10-31&origem=leilao');
  assert.equal(r.body.vendidos.length, 0);
  const csv = await fetch(`${base}/api/results.csv?from=2026-10-01&to=2026-10-31`, { headers: { cookie } });
  const txt = await csv.text();
  assert.match(txt, /Honda Fit/); assert.match(txt, /Ana Lima/); assert.match(txt.split('\r\n')[0], /Lucro líquido/);
  r = await api('GET', '/api/me');
  assert.ok(r.body.options.documentacao.some((x) => x.key === 'renave'));
  assert.ok(r.body.options.origem.some((x) => x.key === 'leilao'));
  assert.ok(r.body.options.doc_status.entregue);
});

test('v2.2: margem da loja, edição de custos, comunicação de venda, comissão em despesa, repasse e placa colada', async () => {
  const D = require('../src/db');
  // Parceria com margem fixa de R$ 4.000: a loja ganha a margem menos os custos.
  let r = await api('POST', '/api/vehicles', { marca: 'Toyota', modelo: 'Corolla', ano_modelo: 2020, preco: 100000, placa: 'TOY2C20', proprietario_tipo: 'parceria', margem_tipo: 'valor', margem_fixa: '4.000' });
  const id = r.body.id;
  assert.equal(r.body.margem_tipo, 'valor'); assert.equal(r.body.margem_fixa, 4000);
  await api('POST', `/api/vehicles/${id}/costs`, { categoria: 'estetica', descricao: 'Polimento', valor: 500 });
  r = await api('GET', `/api/vehicles/${id}/finance`);
  assert.equal(r.body.finance.terceiro, true);
  assert.equal(r.body.finance.previsto.base, 96000);
  assert.equal(r.body.finance.previsto.bruto, 3500);
  // Margem em %: 6% de 100.000.
  r = await api('PUT', `/api/vehicles/${id}`, { ...(await api('GET', `/api/vehicles/${id}`)).body, proprietario_tipo: 'outro', margem_tipo: 'pct', consig_comissao_pct: '6' });
  r = await api('GET', `/api/vehicles/${id}/finance`);
  assert.equal(r.body.finance.previsto.base, 94000);
  // Edição de custo: descrição e valor.
  const c = r.body.costs[0];
  await api('PUT', `/api/vehicles/${id}/costs/${c.id}`, { descricao: 'Polimento e vitrificação', valor: 800 });
  r = await api('GET', `/api/vehicles/${id}/finance`);
  assert.equal(r.body.costs[0].descricao, 'Polimento e vitrificação'); assert.equal(r.body.finance.custos_total, 800);
  // Venda e etapa nova de documento (comunicação de venda entre transferência e transferido).
  await api('POST', `/api/vehicles/${id}/sold`, { venda_valor: 100000, venda_data: '2026-10-08', venda_vendedor_id: globalThis.__carlos });
  r = await api('GET', '/api/docs');
  const keys = Object.keys(r.body.status);
  assert.equal(keys.indexOf('comunicacao'), keys.indexOf('transferencia') + 1);
  assert.equal(keys.indexOf('transferido'), keys.indexOf('comunicacao') + 1);
  r = await api('PUT', `/api/vehicles/${id}/doc`, { status: 'comunicacao' });
  assert.equal(r.body.docs.find((x) => x.id === id).status_label, 'Comunicação de venda realizada');
  // Venda pode ser editada depois de vendida (veículo e venda).
  r = await api('PUT', `/api/vehicles/${id}`, { ...(await api('GET', `/api/vehicles/${id}`)).body, km: 45000 });
  assert.equal(r.status, 200); assert.equal(r.body.km, 45000); assert.equal(r.body.status, 'vendido');
  // Comissão lançada como despesa, com vendedor: entra em comissões, não em despesas fixas.
  r = await api('POST', '/api/expenses', { data: '2026-10-09', categoria: 'comissao', valor: 700 });
  assert.equal(r.status, 400);
  r = await api('POST', '/api/expenses', { data: '2026-10-09', categoria: 'comissao', valor: 700, vendedor_id: globalThis.__carlos, vehicle_id: id, descricao: 'Comissão Corolla' });
  assert.equal(r.status, 201);
  r = await api('GET', '/api/results?from=2026-10-01&to=2026-10-31');
  assert.equal(r.body.dre.comissoes_extra, 700);
  assert.equal(r.body.dre.despesas_loja, 3000);
  assert.ok(r.body.vendedores.find((g) => g.chave === globalThis.__carlos).comissao >= 700);
  r = await api('GET', '/api/expenses?from=2026-10-01&to=2026-10-31');
  assert.ok(r.body.despesas.some((e) => e.vendedor_nome && e.veiculo.startsWith('Toyota Corolla')));
  // Grupos de repasse: preço, texto, grupos e registro de envio.
  r = await api('POST', '/api/vehicles', { marca: 'Chevrolet', modelo: 'Onix', versao: 'LT 1.0', ano_fab: 2019, ano_modelo: 2020, km: 60000, preco: 62000, fipe: 64000, placa: 'ONX1A23', cor: 'Branco', destaques: ['leilao'] });
  const ox = r.body.id;
  r = await api('PUT', `/api/vehicles/${ox}/repasse-preco`, { preco_repasse: '56.500' });
  assert.equal(r.body.preco_repasse, 56500);
  assert.match(r.body.texto, /REPASSE/); assert.match(r.body.texto, /R\$ 56\.500/); assert.match(r.body.texto, /leilão/i); assert.match(r.body.texto, /Placa ON\*\*\*23/); assert.match(r.body.texto, /Onix LT 1\.0 2020/);
  assert.match(r.body.texto, /\/v\/[a-z0-9-]+$/); assert.doesNotMatch(r.body.texto, /Documento:|ONX1A23/);
  r = await api('PUT', `/api/vehicles/${ox}/repasse-preco`, { detalhes: 'Duas chaves' });
  assert.match(r.body.texto, /ℹ️ Detalhes: Duas chaves/); assert.equal(r.body.preco_repasse, 56500);
  r = await api('PUT', '/api/store/repasse-grupos', { grupos: [{ nome: 'Repasse PR', link: 'https://chat.whatsapp.com/abc' }, { nome: '' }] });
  assert.equal(r.body.grupos.length, 1); assert.equal(r.body.grupos[0].tipo, 'whatsapp');
  r = await api('POST', `/api/vehicles/${ox}/repasse`, { grupos: ['Repasse PR'] });
  assert.equal(r.body.posts[0].grupo, 'Repasse PR');
  // O preço de repasse não vai para o anúncio.
  r = await api('GET', `/api/vehicles/${ox}`);
  assert.doesNotMatch(r.body.descricao_anuncio || '', /56\.500/);
  // Placa: texto copiado da página (sem extensão).
  const txt = 'Marca: FORD\nModelo: ECOSPORT XLT2.0FLEX\nAno: 2009\nAno Modelo: 2009\nCor: Prata\nCombustível: Alcool / Gasolina\nUF: PR\nMunicípio: MARIPA\n003271-9\tEcoSport XLT 2.0/ 2.0 Flex 16V 5p Mec.\tR$ 34.084,00\n';
  r = await api('POST', '/api/plate/ART9H77/html', { html: txt, url: 'https://placafipe.com/placa/ART9H77' });
  assert.equal(r.body.marca, 'Ford'); assert.equal(r.body.modelo, 'Ecosport'); assert.equal(r.body.combustivel, 'Flex');
  assert.equal(r.body.fipe, 34084); assert.equal(r.body.municipio_placa, 'MARIPA - PR'); assert.match(r.body.versao, /^XLT 2\.0/);
  D.run("DELETE FROM plate_cache WHERE placa = 'ART9H77'");
});

test('v2.4: contatos, histórico, mensagens em massa, contas a pagar e painel', async () => {
  process.env.WA_DELAY_MS = '0';
  // Contatos vêm sozinhos dos cadastros: consignatário, comprador e parceiro.
  let r = await api('POST', '/api/vehicles', { marca: 'Fiat', modelo: 'Toro', ano_modelo: 2021, preco: 120000, placa: 'TOR1A21', proprietario_tipo: 'consignado', proprietario_nome: 'Paulo Lima', proprietario_tel: '(44) 98888-1234', margem_tipo: 'pct', consig_comissao_pct: '5' });
  const toro = r.body.id;
  await api('POST', `/api/vehicles/${toro}/sold`, { venda_valor: 118000, venda_comprador: 'Joana Reis', comprador_tel: '44 97777-4321', doc_status: 'pendente' });
  r = await api('GET', '/api/contacts');
  assert.equal(r.status, 200);
  const paulo = r.body.contatos.find((c) => c.telefone === '44988881234');
  const joana = r.body.contatos.find((c) => c.telefone === '44977774321');
  assert.ok(paulo.papeis.includes('consignatario')); assert.ok(joana.papeis.includes('comprador')); assert.equal(joana.compras, 1);
  assert.ok(r.body.contatos.some((c) => c.papeis.includes('fornecedor')), 'parceiros entram como fornecedores');
  // O mesmo contato pode ter vários papéis ao longo do tempo: Paulo agora compra um carro.
  r = await api('POST', '/api/vehicles', { marca: 'Jeep', modelo: 'Renegade', ano_modelo: 2022, preco: 110000 });
  await api('POST', `/api/vehicles/${r.body.id}/sold`, { venda_valor: 108000, venda_comprador: 'Paulo Lima', comprador_tel: '5544988881234' });
  r = await api('GET', `/api/contacts/${paulo.id}`);
  assert.deepEqual(r.body.contato.papeis.sort(), ['comprador', 'consignatario']);
  assert.ok(r.body.historico.some((e) => /Deixou o .*Toro.*consignação/.test(e.texto)));
  assert.ok(r.body.historico.some((e) => /Comprou o .*Renegade/.test(e.texto)));
  r = await api('POST', `/api/contacts/${paulo.id}/notes`, { tipo: 'ligacao', texto: 'Quer trocar por uma picape em 2027' });
  assert.equal(r.status, 201);
  r = await api('GET', `/api/contacts/${paulo.id}`);
  assert.equal(r.body.historico[0].tipo, 'ligacao');
  // Contato manual, duplicado e opt-out.
  r = await api('POST', '/api/contacts', { nome: 'Lead da feira', telefone: '44 96666-5555', papeis: ['lead'] });
  assert.equal(r.status, 201); const lead = r.body.id;
  r = await api('POST', '/api/contacts', { nome: 'Outro', telefone: '(44) 96666-5555' });
  assert.equal(r.status, 409);
  r = await api('POST', '/api/contacts', { nome: 'Sem zap', telefone: '44 95555-0000', papeis: ['cliente'] });
  const semZap = r.body.id;
  r = await api('POST', '/api/contacts', { nome: 'Não quer', telefone: '44 94444-3333', opt_out: true });
  const optout = r.body.id;
  // Envio assistido: links prontos e marcação manual.
  r = await api('POST', '/api/wa/campaigns', { nome: 'Feirão', mensagem: 'Oi {nome}! Sábado tem feirão na {loja}.', contatos: [paulo.id, lead, optout] });
  assert.equal(r.status, 201);
  let w = (await api('GET', `/api/wa/campaigns/${r.body.id}`)).body;
  assert.equal(w.envios.length, 2, 'quem pediu para não receber fica de fora');
  assert.match(w.envios[0].texto, /^Oi Paulo! Sábado tem feirão na /);
  assert.match(w.envios[0].link, /^https:\/\/web\.whatsapp\.com\/send\?phone=5544988881234&text=/);
  w = (await api('PUT', `/api/wa/campaigns/${w.id}/sends/${w.envios[0].id}`, { status: 'enviado' })).body;
  assert.equal(w.enviados, 1); assert.equal(w.status, 'aberta');
  // Envio automático pela API oficial (sem configuração é recusado).
  r = await api('POST', '/api/wa/campaigns', { nome: 'Pós-venda', mensagem: 'Oi {nome}', modo: 'api', contatos: [lead] });
  assert.equal(r.status, 400);
  r = await api('PUT', '/api/wa/config', { token: 'EAAGtoken', phone_id: '1234567890', template: 'Campanha_Loja', lang: 'pt_BR', params: 2 });
  assert.equal(r.body.configurado, true); assert.equal(r.body.template, 'campanha_loja');
  mock.state.waCalls = [];
  r = await api('POST', '/api/wa/campaigns', { nome: 'Pós-venda', mensagem: 'Como está o carro?\nConte com a gente.', modo: 'api', contatos: [lead, semZap] });
  for (let i = 0; i < 40 && (await api('GET', `/api/wa/campaigns/${r.body.id}`)).body.status !== 'concluida'; i++) await new Promise((ok) => setTimeout(ok, 50));
  w = (await api('GET', `/api/wa/campaigns/${r.body.id}`)).body;
  assert.equal(w.status, 'concluida'); assert.equal(w.enviados, 1); assert.equal(w.falhas, 1);
  assert.match(w.envios.find((e) => e.status === 'falha').erro, /sem WhatsApp/);
  const call = mock.state.waCalls[0];
  assert.equal(call.phone, '1234567890'); assert.equal(call.auth, 'Bearer EAAGtoken');
  assert.equal(call.body.template.name, 'campanha_loja');
  assert.deepEqual(call.body.template.components[0].parameters.map((p) => p.text), ['Lead', 'Como está o carro? · Conte com a gente.']);
  r = await api('GET', `/api/contacts/${lead}`);
  assert.ok(r.body.historico.some((e) => e.tipo === 'campanha'));
  // Contas a pagar: lançada em aberto, aparece no painel e pode ser paga.
  const venc = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
  await api('POST', '/api/expenses', { data: venc, categoria: 'energia', descricao: 'Copel', valor: 640, pago: false });
  r = await api('GET', '/api/painel');
  assert.equal(r.status, 200);
  const conta = r.body.financeiro.contas.find((c) => c.descricao === 'Copel');
  assert.equal(conta.vencida, true);
  assert.ok(r.body.alertas.some((a) => /vencida/.test(a.texto)));
  assert.ok(r.body.estoque.locais.length >= 1 && 'parados' in r.body.estoque && r.body.docs.pendentes >= 1);
  await api('PUT', `/api/expenses/${conta.id}/pago`, {});
  r = await api('GET', '/api/painel?periodo=30');
  assert.ok(!r.body.financeiro.contas.some((c) => c.descricao === 'Copel'));
  assert.equal(r.body.periodo.p, '30');
});

test('v2.5: venda com troca (lucro realizado em cadeia), financiamento, boleto e retorno', async () => {
  const from = '2026-10-01'; const to = '2026-10-31';
  const base0 = (await api('GET', `/api/results?from=${from}&to=${to}`)).body.kpis;
  // Cruze: compra 50.000; vendido por 60.000 = 20.000 em PIX + Ecosport na troca por 30.000 (cadastrada na hora).
  let r = await api('POST', '/api/vehicles', { marca: 'Chevrolet', modelo: 'Cruze', ano_modelo: 2017, preco: 62000, placa: 'CRZ1A17' });
  const cruze = r.body.id;
  await api('PUT', `/api/vehicles/${cruze}/finance`, { compra_valor: 50000, compra_de: 'Seu Zé', compra_de_tel: '44 93333-2222' });
  r = await api('POST', `/api/vehicles/${cruze}/sold`, { venda_data: '2026-10-10', venda_entrada: 20000, venda_troca_valor: 30000, venda_pagamento: 'PIX + Troca',
    venda_comprador: 'Ana Troca', comprador_tel: '44 92222-1111', troca_novo: { marca: 'Ford', modelo: 'Ecosport', ano: 2015, placa: 'ECO1B15' } });
  assert.equal(r.status, 200);
  const D = require('../src/db');
  const cz = D.get('SELECT * FROM vehicles WHERE id = ?', cruze);
  assert.equal(cz.venda_valor, 50000 + 0 || 50000, 'total = PIX + troca'); // 20.000 + 30.000
  const eco = D.get('SELECT * FROM vehicles WHERE id = ?', cz.venda_troca_id);
  assert.equal(eco.modelo, 'Ecosport'); assert.equal(eco.compra_valor, 30000); assert.equal(eco.compra_origem, 'troca'); assert.equal(eco.troca_de_id, cruze);
  assert.equal(eco.compra_de, 'Ana Troca');
  r = await api('GET', `/api/vehicles/${cruze}/finance`);
  assert.equal(r.body.finance.troca_pendente, true);
  // Decisão da loja: o lucro da venda com troca entra na data da venda.
  r = await api('GET', `/api/results?from=${from}&to=${to}`);
  assert.equal(r.body.kpis.lucro_liquido - base0.lucro_liquido, 50000 - 50000 - Math.round(50000 * 0.02));
  assert.ok(r.body.em_troca.some((x) => x.id === cruze && /Ecosport/.test(x.troca_titulo)));
  assert.ok(r.body.vendidos.find((l) => l.id === cruze).em_troca);
  assert.equal(r.body.kpis.trocas_estoque_valor, 30000);
  // Ecosport vendida: 10.000 de entrada + 25.000 financiados (BV, 48x) + 2 boletos de 1.000 + retorno de 1.200 da financeira.
  r = await api('POST', `/api/vehicles/${eco.id}/sold`, { venda_data: '2026-10-20', venda_entrada: 10000, venda_financiado: 25000, venda_financeira: 'BV', venda_fin_parcelas: 48, venda_fin_parcela: 790, venda_boleto_qtd: 2, venda_boleto_valor: 1000, venda_retorno: 1200 });
  const ev = D.get('SELECT * FROM vehicles WHERE id = ?', eco.id);
  assert.equal(ev.venda_valor, 37000); assert.equal(ev.venda_fin_parcelas, 48); assert.equal(ev.venda_retorno, 1200);
  r = await api('GET', `/api/vehicles/${eco.id}/finance`);
  assert.equal(r.body.finance.real.bruto, 37000 + 1200 - 30000);
  r = await api('GET', `/api/results?from=${from}&to=${to}`);
  const imp = (x) => Math.round(x * 0.02);
  const lucroCruze = 50000 - 50000 - imp(50000);
  const lucroEco = 37000 + 1200 - 30000 - imp(37000);
  assert.equal(r.body.kpis.lucro_liquido - base0.lucro_liquido, lucroCruze + lucroEco);
  assert.ok(!r.body.em_troca.some((x) => x.id === cruze));
  assert.equal(r.body.dre.retorno_financiamento - (base0.retorno_financiamento || 0) >= 1200, true);
  // Quem vendeu o carro para a loja vira contato.
  r = await api('GET', '/api/contacts');
  assert.ok(r.body.contatos.find((c) => c.telefone === '44933332222').papeis.includes('vendeu'));
});

test('v2.0: agenda de republicação, QR, folha A4, painel TV e fotos prontas', async () => {
  const sched = require('../src/schedule');
  const db = require('../src/db');
  const storeId = db.get('SELECT id FROM stores LIMIT 1').id;
  let r = await api('PUT', '/api/store/schedule', { ativo: true, dias: [0, 1, 2, 3, 4, 5, 6], horarios: ['10:00', '25:99'], por_vez: 2 });
  assert.deepEqual(r.body.horarios, ['10:00']);
  await api('PUT', '/api/store/pub-mode', { mode: 'extensao' });
  // Dois carros publicados há 10 dias
  const ids = [];
  for (const m of ['Gol', 'Uno']) {
    const v = await api('POST', '/api/vehicles', { marca: 'X', modelo: m, ano_modelo: 2015, km: 1, preco: 30000 });
    db.run(`UPDATE vehicles SET status='publicado', publicado_em=datetime('now','-10 days') WHERE id=?`, v.body.id);
    ids.push(v.body.id);
  }
  const at = new Date(); at.setUTCHours(13, 5, 0, 0); // 10:05 em Brasília
  const n1 = sched.tick(storeId, at);
  assert.equal(n1, 2);
  assert.equal(sched.tick(storeId, at), 0, 'o mesmo horário não roda duas vezes');
  const jobs = db.all(`SELECT * FROM ext_jobs WHERE type='republicar' AND note LIKE 'Agendada%'`);
  assert.ok(ids.every((id) => jobs.some((j) => j.vehicle_id === id)));
  const cedo = new Date(at); cedo.setUTCHours(12, 0, 0, 0);
  db.run('DELETE FROM rep_runs');
  assert.equal(sched.tick(storeId, cedo), 0, 'antes do horário não faz nada');
  await api('PUT', '/api/store/schedule', { ativo: false });

  const v = (await api('GET', '/api/vehicles')).body.find((x) => x.status !== 'vendido' && x.photos.length);
  const slug = db.get('SELECT slug FROM stores WHERE id = ?', storeId).slug;
  let q = await fetch(`${base}/qr/${slug}/${v.id}.png`);
  assert.equal(q.status, 200); assert.equal(q.headers.get('content-type'), 'image/png');
  q = await fetch(`${base}/imprimir/${v.id}?modo=pb`, { headers: { cookie } });
  const html = await q.text();
  assert.equal(q.status, 200);
  assert.match(html, /size:A4/); assert.match(html, /data:image\/png;base64/);
  assert.equal((await fetch(`${base}/imprimir/${v.id}`)).status, 401, 'folha só pelo painel');
  q = await fetch(`${base}/tv/${slug}`); assert.equal(q.status, 200);
  q = await (await fetch(`${base}/tv/${slug}/dados`)).json();
  assert.ok(q.veiculos.length >= 1); assert.match(q.veiculos[0].qr, /^data:image\/png/);

  // Fotos prontas: reduzir tamanho + marca d'água com o logo
  const { createCanvas } = require('@napi-rs/canvas');
  const big = createCanvas(3000, 2000); big.getContext('2d').fillStyle = '#346'; big.getContext('2d').fillRect(0, 0, 3000, 2000);
  const logo = createCanvas(400, 200); logo.getContext('2d').fillStyle = '#f00'; logo.getContext('2d').fillRect(0, 0, 400, 200);
  let fd = new FormData(); fd.append('logo', new Blob([await logo.encode('png')], { type: 'image/png' }), 'logo.png');
  r = await api('POST', '/api/store/logo', fd);
  assert.match(r.body.logo_url, /\/media\/[a-f0-9]{32}\.png$/);
  await api('PUT', '/api/store/photos', { reduzir: true, max_lado: 1600, marca_dagua: true, posicao: 'inferior_direita', opacidade: 100, tamanho: 20 });
  fd = new FormData(); fd.append('fotos', new Blob([await big.encode('png')], { type: 'image/png' }), 'grande.png');
  r = await api('POST', `/api/vehicles/${v.id}/photos`, fd);
  const nova = r.body.photos[r.body.photos.length - 1];
  assert.match(nova.filename, /\.jpg$/, 'convertida para JPEG');
  const { loadImage } = require('@napi-rs/canvas');
  const img = await loadImage(Buffer.from(await (await fetch(`${base}/media/${nova.filename}`)).arrayBuffer()));
  assert.equal(img.width, 1600);
  const px = createCanvas(img.width, img.height); const cx = px.getContext('2d'); cx.drawImage(img, 0, 0);
  const [rr, gg] = cx.getImageData(1500, 1000, 1, 1).data;
  assert.ok(rr > 200 && gg < 60, `logo no canto: ${rr},${gg}`);
  await api('PUT', '/api/store/photos', { reduzir: false, marca_dagua: false });
  // Foto editada (desfoque) substitui a original na mesma posição
  fd = new FormData(); fd.append('foto', new Blob([JPG], { type: 'image/jpeg' }), 'editada.jpg');
  r = await api('PUT', `/api/vehicles/${v.id}/photos/${nova.id}/file`, fd);
  assert.equal(r.status, 200);
  assert.notEqual(r.body.photos.find((p) => p.id === nova.id).filename, nova.filename);
});
