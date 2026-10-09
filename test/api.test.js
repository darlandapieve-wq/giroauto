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

test('v1.7: imagens geradas (arte e estacionamento com IA)', async () => {
  const arts = require('../src/arts');
  process.env.GEMINI_URL = `http://127.0.0.1:${mockServer.address().port}`;
  let r = await api('POST', '/api/vehicles', { marca: 'Volkswagen', modelo: 'Fox', versao: 'Track 1.6', ano_fab: 2015, ano_modelo: 2016, km: 98500, preco: 54900, cambio: 'Manual', combustivel: 'Flex', cor: 'Prata', carroceria: 'Hatch' });
  const id = r.body.id;
  const fd = new FormData();
  for (const n of ['a', 'b', 'c']) fd.append('fotos', new Blob([JPG], { type: 'image/jpeg' }), `${n}.jpg`);
  await api('POST', `/api/vehicles/${id}/photos`, fd);
  await arts.idle();
  r = await api('GET', `/api/vehicles/${id}/arts`);
  assert.equal(r.body[0].status, 'pronta', JSON.stringify(r.body[0]));
  assert.match(r.body[0].url, /\/media\/[a-f0-9]{32}\.jpg$/);
  assert.ok(r.body.slice(1).every((a) => a.status === 'manual'), 'sem IA configurada, as fotos no estacionamento ficam no modo à mão (grátis)');
  // Modo à mão: instruções prontas e envio da imagem feita no ChatGPT/Gemini.
  let pr = await api('GET', `/api/vehicles/${id}/arts/prompts`);
  assert.equal(pr.body.length, 4);
  assert.match(pr.body[0].prompt, /Mantenha exatamente o mesmo carro/);
  assert.match(pr.body[0].source_url, /\/media\//);
  const up = new FormData(); up.append('imagem', new Blob([JPG], { type: 'image/jpeg' }), 'feita-no-chatgpt.jpg');
  pr = await api('POST', `/api/vehicles/${id}/arts/2/upload`, up);
  assert.equal(pr.status, 200, JSON.stringify(pr.body));
  assert.equal(pr.body[1].status, 'pronta');
  assert.equal(pr.body[1].manual, true);
  const manualFile = pr.body[1].filename;
  const card1 = r.body[0].filename;
  const img = await fetch(base + '/media/' + card1);
  assert.equal(img.status, 200);
  const buf = Buffer.from(await img.arrayBuffer());
  assert.equal(buf.readUInt16BE(0), 0xffd8, 'arte em JPEG');

  // Mudar o preço refaz a arte (e só ela).
  await api('PUT', `/api/vehicles/${id}`, { marca: 'Volkswagen', modelo: 'Fox', versao: 'Track 1.6', ano_fab: 2015, ano_modelo: 2016, km: 98500, preco: 52900, cambio: 'Manual', combustivel: 'Flex', cor: 'Prata', carroceria: 'Hatch' });
  await arts.idle();
  r = await api('GET', `/api/vehicles/${id}/arts`);
  assert.notEqual(r.body[0].filename, card1);
  assert.equal((await fetch(base + '/media/' + card1)).status, 404, 'arte antiga apagada');

  // Chave da IA: inválida é recusada; válida libera as imagens 2 a 5.
  r = await api('PUT', '/api/admin/ai', { key: 'AIzaERRADA12345678901234567890123456' });
  assert.equal(r.status, 400);
  r = await api('PUT', '/api/admin/ai', { key: 'AIzaTESTKEY1234567890123456789012345', auto: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.configured, true);
  await arts.idle();
  r = await api('GET', `/api/vehicles/${id}/arts`);
  assert.equal(r.body[1].filename, manualFile, 'a imagem enviada pela loja não é substituída sozinha');
  r = await api('POST', `/api/vehicles/${id}/arts/regenerate`, { slots: [2, 3, 4, 5] });
  assert.equal(r.status, 200);
  await arts.idle();
  r = await api('GET', `/api/vehicles/${id}/arts`);
  assert.ok(r.body.every((a) => a.status === 'pronta'), JSON.stringify(r.body));
  assert.notEqual(r.body[1].filename, manualFile, 'Refazer troca a imagem enviada');
  const calls = mock.state.geminiCalls;
  assert.ok(calls.length >= 4, 'gera as 4 imagens (e as dos outros veículos em estoque)');
  assert.equal(calls[0].model, 'gemini-nano-banana-2.1');
  const parts = calls[0].body.contents[0].parts;
  assert.match(parts[0].text, /parking/);
  assert.match(parts[0].text, /Keep the exact same car/);
  assert.equal(parts[1].inline_data.mime_type, 'image/jpeg');
  assert.equal(calls[0].body.generationConfig.responseFormat.image.aspectRatio, '4:5');

  // Trocar a foto de origem de uma imagem refaz só ela; erro de cota aparece para a loja.
  const v = await api('GET', `/api/vehicles/${id}`);
  mock.state.geminiFail = true;
  r = await api('PUT', `/api/vehicles/${id}/arts/3/source`, { photo_id: v.body.photos[2].id });
  assert.equal(r.status, 200);
  await arts.idle();
  r = await api('GET', `/api/vehicles/${id}/arts`);
  assert.equal(r.body[2].status, 'erro');
  assert.match(r.body[2].error, /Limite de uso/);
  assert.equal(r.body[2].photo_id, v.body.photos[2].id);
  assert.equal(r.body[1].status, 'pronta');
  mock.state.geminiFail = false;

  // Pollinations (cota gratuita): mesma geração por outro serviço.
  r = await api('PUT', '/api/admin/ai', { provider: 'pollinations', pollinations_key: 'chave-errada' });
  assert.equal(r.status, 400);
  r = await api('PUT', '/api/admin/ai', { provider: 'pollinations', pollinations_key: 'sk_teste1234567890' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.provider, 'pollinations');
  process.env.POLLINATIONS_URL = process.env.GEMINI_URL;
  mock.state.pollCalls = [];
  r = await api('POST', `/api/vehicles/${id}/arts/regenerate`, { slots: [4] });
  await arts.idle();
  r = await api('GET', `/api/vehicles/${id}/arts`);
  assert.equal(r.body[3].status, 'pronta', JSON.stringify(r.body[3]));
  assert.equal(mock.state.pollCalls.length, 1);
  assert.equal(mock.state.pollCalls[0].auth, 'Bearer sk_teste1234567890');
  assert.equal(mock.state.pollCalls[0].model, 'kontext');
  mock.state.pollFail = 402;
  r = await api('POST', `/api/vehicles/${id}/arts/regenerate`, { slots: [5] });
  await arts.idle();
  r = await api('GET', `/api/vehicles/${id}/arts`);
  assert.match(r.body[4].error, /Cota gratuita do dia/);
  mock.state.pollFail = 0;
  await api('PUT', '/api/admin/ai', { provider: 'gemini' });

  // Zip com as imagens geradas.
  const z = await fetch(`${base}/api/vehicles/${id}/photos.zip?so=artes`, { headers: { cookie } });
  assert.equal(z.status, 200);
  assert.match(Buffer.from(await z.arrayBuffer()).toString('latin1'), /arte-01\.jpg/);
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
  assert.equal(items.length, 6, 'arte + 2 imagens no estacionamento prontas (duas deram erro) + 3 fotos');
  assert.match(items[0].params.image_url, /\/media\/[a-f0-9]{32}\.jpg$/);
  const carousel = mock.calls.find((c) => c.path === '/ig_1/media' && c.params.media_type === 'CAROUSEL');
  assert.equal(carousel.params.children.split(',').length, 6);
  assert.match(carousel.params.caption, /#volkswagen/);
  assert.ok(mock.calls.find((c) => c.path === '/ig_1/media_publish'));

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
