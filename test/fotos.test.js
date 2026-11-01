// GiroAuto Fotos (v2.16): login da loja e do Repasse, ensaio a partir do estoque, ângulos novos pela IA,
// arte 4:5 e 9:16, ZIP, fotos de volta no carro, modo manual. IA simulada e GiroAuto Repasse simulado.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const sharp = require('sharp');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'giro-fotos-'));
let base, server, rpServer;
const AID = crypto.randomUUID(); const FID = crypto.randomUUID();

const foto = (cor = '#20242c') => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="100%" height="100%" fill="#c9c2b0"/>
  <rect x="200" y="420" width="800" height="220" rx="40" fill="${cor}"/><circle cx="380" cy="650" r="80" fill="#111"/><circle cx="820" cy="650" r="80" fill="#111"/></svg>`)).jpeg().toBuffer();

function cliente() {
  let jar = {};
  return async (method, url, body, { bruto } = {}) => {
    const headers = { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') };
    let b;
    if (body instanceof FormData) b = body; else if (body !== undefined) { b = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    const r = await fetch(base + url, { method, headers, body: b, redirect: 'manual' });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); const v = kv.slice(i + 1); if (v) jar[kv.slice(0, i)] = v; else delete jar[kv.slice(0, i)]; }
    if (bruto) return r;
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j };
  };
}

async function esperar(c, id, cond, ms = 30000) {
  const fim = Date.now() + ms;
  for (;;) {
    const r = await c('GET', `/api/fotos/ensaios/${id}`);
    if (cond(r.body)) return r.body;
    if (Date.now() > fim) throw new Error('tempo esgotado: ' + JSON.stringify({ s: r.body.status, g: r.body.geradas?.map((g) => g.status), a: r.body.artes }));
    await new Promise((x) => setTimeout(x, 150));
  }
}

before(async () => {
  // GiroAuto Repasse simulado (API)
  const fotoRp = await foto('#9aa0a8');
  const R = express(); R.use(express.json());
  R.post('/api/login', (req, res) => {
    if (req.body.email === 'rp@x.com' && req.body.senha === 'senha-rp') { res.setHeader('Set-Cookie', 'sessao=abc.1.3.sig; Path=/; HttpOnly'); return res.json({ ok: true }); }
    res.status(401).json({ erro: 'E-mail ou senha incorretos' });
  });
  const ok = (req, res, next) => (/sessao=abc/.test(req.headers.cookie || '') ? next() : res.status(401).json({ erro: 'login necessário' }));
  R.get('/api/estado', ok, (req, res) => res.json({ sessao: { usuario: 'Beto' }, conta: { id: 3, nome: 'Oeste Repasses' }, config: { negocio: { nome: 'Oeste Repasses', contato: '(44) 9 9999-0000' } } }));
  R.get('/api/anuncios', ok, (req, res) => res.json(String(req.query.status).includes('pendente') ? [{ id: AID, numeroFila: 12, status: 'pendente', precoRepasse: 69300, fipe: 72000, dados: { marca: 'Hyundai', modelo: 'HB20', versao: 'Comfort 1.0 Turbo', anoModelo: 2024, ano: 2024, km: 46000, cor: 'Prata', categoria: 'hatch' }, fotos: [{ id: FID, ordem: 0, capa: true }] }] : []));
  R.get('/fotos/:id', ok, (req, res) => (req.params.id === FID ? res.type('jpeg').send(fotoRp) : res.status(404).end()));
  await new Promise((r) => { rpServer = R.listen(0, '127.0.0.1', r); });

  Object.assign(process.env, {
    GIROAUTO_SKIP_ENV: '1', GIROAUTO_SKIP_WA_AUTO: '1', DATA_DIR: tmp, GIROAUTO_DB: path.join(tmp, 'test.db'),
    PUBLIC_URL: 'http://localhost:9', FOTOS_IA: 'simulado', REPASSE_URL: `http://127.0.0.1:${rpServer.address().port}`,
  });
  const app = require('../src/server');
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => { server?.close(); rpServer?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

let lojaC; let vid;

test('página /fotos e login com a conta da loja', async () => {
  const c = cliente();
  const pg = await c('GET', '/fotos', undefined, { bruto: true });
  assert.equal(pg.status, 200);
  assert.match(await pg.text(), /\/fotos\/fotos\.js/);
  assert.equal((await c('GET', '/api/fotos/sessao')).status, 401);
  await c('POST', '/api/auth/register', { loja: 'Topcar', nome: 'Darlan', email: 'd@x.com', senha: '12345678' });
  await c('PUT', '/api/store', { name: 'Topcar', whatsapp: '5544999158307', city: 'Assis Chateaubriand' });
  await c('POST', '/api/auth/logout');
  assert.equal((await c('POST', '/api/fotos/login', { email: 'd@x.com', senha: 'errada00' })).status, 401);
  const r = await c('POST', '/api/fotos/login', { email: 'd@x.com', senha: '12345678' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.loja, r.body.repasse], [true, false]);
  const s = (await c('GET', '/api/fotos/sessao')).body;
  assert.equal(s.espacos[0].tipo, 'loja');
  assert.equal(s.modelos.length, 9);
  assert.equal(s.provedor, 'simulado');
  // o mesmo login vale no painel
  assert.equal((await c('GET', '/api/me')).status, 200);
  lojaC = c;
});

test('ensaio do estoque com 1 foto: a IA cria os ângulos que faltam; arte, ZIP e fotos de volta no carro', async () => {
  const c = lojaC;
  let r = await c('POST', '/api/vehicles', { marca: 'Nissan', modelo: 'Sentra', versao: '2.0 16V', ano_fab: 2023, ano_modelo: 2024, km: 55000, preco: 122000, cambio: 'Automático', combustivel: 'Flex', cor: 'Preto', carroceria: 'Sedã', destaques: ['pericia_premium', 'revisoes'] });
  assert.equal(r.status, 201, JSON.stringify(r.body).slice(0, 200));
  vid = r.body.id;
  const fd = new FormData(); fd.append('fotos', new Blob([await foto()], { type: 'image/jpeg' }), 'a.jpg');
  r = await c('POST', `/api/vehicles/${vid}/photos`, fd);
  assert.equal(r.status, 200);

  const est = (await c('GET', '/api/fotos/origens/loja')).body;
  assert.equal(est.length, 1);
  assert.equal(est[0].veiculo.carroceria, 'Sedã');

  r = await c('POST', '/api/fotos/ensaios', { origem: 'loja', origem_id: String(vid) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.id;
  let e = (await c('GET', `/api/fotos/ensaios/${id}`)).body;
  assert.equal(e.originais.length, 1);
  assert.equal(e.loja.nome, 'Topcar');
  assert.equal(e.novos_angulos, true);

  await c('PUT', `/api/fotos/ensaios/${id}`, { modelo: '06', quantidade: 7, placa_modo: 'loja' });
  r = await c('POST', `/api/fotos/ensaios/${id}/gerar`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  e = await esperar(c, id, (x) => x.status === 'pronto' && x.artes.length === 2 && x.artes.every((a) => a.status === 'pronta'));
  assert.equal(e.geradas.length, 7);
  assert.equal(e.geradas[0].angulo, '');
  assert.deepEqual(e.geradas.slice(1).map((g) => g.angulo), ['f34e', 't34d', 'lat', 'f34d', 'fr', 'tr'], 'sem interior: só ângulos externos');
  assert.ok(e.geradas[1].angulo_nome.startsWith('Frente 3/4'));

  const img = await c('GET', e.geradas[0].url, undefined, { bruto: true });
  assert.deepEqual(Object.values((({ width, height }) => ({ width, height }))(await sharp(Buffer.from(await img.arrayBuffer())).metadata())), [1080, 1350]);
  const a916 = await c('GET', e.artes.find((a) => a.formato === '9:16').url, undefined, { bruto: true });
  assert.equal((await sharp(Buffer.from(await a916.arrayBuffer())).metadata()).height, 1920);

  await c('PUT', `/api/fotos/ensaios/${id}/fotos/${e.geradas[0].id}`, { status: 'aprovada' });
  await c('PUT', `/api/fotos/ensaios/${id}/fotos/${e.geradas[1].id}`, { status: 'aprovada' });
  await c('POST', `/api/fotos/ensaios/${id}/fotos/${e.geradas[2].id}/refazer`, { instrucao: 'mais luz' });
  e = await esperar(c, id, (x) => x.status === 'pronto' && x.geradas[2].status === 'pronta');

  const z = await c('GET', `/api/fotos/ensaios/${id}/zip`, undefined, { bruto: true });
  assert.equal(z.status, 200);
  const nomes = Buffer.from(await z.arrayBuffer()).toString('latin1');
  for (const n of ['fotos/01.jpg', 'fotos/02.jpg', 'arte-4x5.jpg', 'arte-9x16.jpg', 'texto-do-anuncio.txt']) assert.ok(nomes.includes(n), n);
  assert.ok(!nomes.includes('fotos/03.jpg'), 'só as aprovadas');

  r = await c('POST', `/api/fotos/ensaios/${id}/enviar-loja`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.total_na_loja, 3);

  // dados só da arte
  e = (await c('PUT', `/api/fotos/ensaios/${id}`, { veiculo: { preco_oferta: 118900 } })).body;
  assert.equal(e.veiculo.preco_oferta, 118900);
  assert.equal((await c('GET', `/api/vehicles/${vid}`)).body.preco_oferta || 0, 0);

  // excluir o ensaio não apaga as fotos que foram para o carro
  await c('DELETE', `/api/fotos/ensaios/${id}`);
  const v = (await c('GET', `/api/vehicles/${vid}`)).body;
  for (const p of v.photos) assert.equal((await c('GET', new URL(p.url).pathname, undefined, { bruto: true })).status, 200);
});

test('Repasse: login pela API do Repasse, fila e ensaio; quem é só do Repasse não vê a loja', async () => {
  const c = cliente();
  const r = await c('POST', '/api/fotos/login', { email: 'rp@x.com', senha: 'senha-rp' });
  assert.deepEqual([r.status, r.body.loja, r.body.repasse], [200, false, true]);
  const s = (await c('GET', '/api/fotos/sessao')).body;
  assert.deepEqual(s.espacos.map((x) => x.id), ['repasse:3']);
  assert.equal((await c('GET', '/api/fotos/origens/loja')).status, 400);
  const fila = (await c('GET', '/api/fotos/origens/repasse?grupo=fila')).body;
  assert.equal(fila[0].codigo, 'F-0012');
  assert.equal(fila[0].veiculo.preco, 69300);
  assert.equal((await c('GET', fila[0].capa, undefined, { bruto: true })).status, 200);
  const n = await c('POST', '/api/fotos/ensaios', { origem: 'repasse', origem_id: AID });
  assert.equal(n.status, 201, JSON.stringify(n.body));
  const e = (await c('GET', `/api/fotos/ensaios/${n.body.id}`)).body;
  assert.equal(e.loja.nome, 'Oeste Repasses');
  assert.equal(e.veiculo.carroceria, 'Hatch');
  assert.equal(e.originais.length, 1);
  assert.ok((await c('GET', '/api/fotos/ensaios')).body.every((x) => x.espaco === 'repasse:3'));
});

test('usuário da loja conecta o Repasse; modo manual com o texto pronto', async () => {
  const c = lojaC;
  assert.equal((await c('POST', '/api/fotos/repasse/conectar', { email: 'rp@x.com', senha: 'errada' })).status, 401);
  assert.equal((await c('POST', '/api/fotos/repasse/conectar', { email: 'rp@x.com', senha: 'senha-rp' })).status, 200);
  assert.equal((await c('GET', '/api/fotos/sessao')).body.espacos.length, 2);

  const { id } = (await c('POST', '/api/fotos/ensaios', { origem: 'avulso', espaco: 'loja:1', veiculo: { marca: 'Fiat', modelo: 'Strada', cor: 'vermelha', placa: 'abc-1d23', preco: 99990 } })).body;
  let e = (await c('GET', `/api/fotos/ensaios/${id}`)).body;
  assert.equal(e.veiculo.placa, 'ABC1D23');
  assert.equal(e.espaco, 'loja:1');
  const fd = new FormData();
  fd.append('fotos', new Blob([await foto('#a01818')], { type: 'image/jpeg' }), 'a.jpg');
  fd.append('fotos', new Blob([await foto('#a01818')], { type: 'image/jpeg' }), 'b.jpg');
  e = (await c('POST', `/api/fotos/ensaios/${id}/originais`, fd)).body;
  await c('PUT', `/api/fotos/ensaios/${id}/originais/${e.originais[1].id}`, { tipo: 'interior' });
  await c('PUT', `/api/fotos/ensaios/${id}`, { quantidade: 10, modelo: 'P', personalizado_texto: 'pátio da loja com fachada azul' });

  process.env.FOTOS_IA = '';
  e = (await c('POST', `/api/fotos/ensaios/${id}/gerar`)).body; // sem chave: provedor manual
  assert.equal(e.status, 'manual');
  assert.ok(e.geradas.some((g) => ['painel', 'bancos'].includes(g.angulo)), 'com foto do interior, também cria interior');
  assert.ok(e.geradas.every((g) => /fachada azul/.test(g.prompt_pt)));
  for (const g of e.geradas) {
    const f = new FormData(); f.append('foto', new Blob([await foto('#333')], { type: 'image/jpeg' }), 'x.jpg');
    e = (await c('POST', `/api/fotos/ensaios/${id}/fotos/${g.id}/manual`, f)).body;
  }
  process.env.FOTOS_IA = 'simulado';
  e = await esperar(c, id, (x) => x.status === 'pronto' && x.artes.length === 2 && x.artes.every((a) => a.status === 'pronta'));
  assert.equal(e.geradas.filter((g) => g.status === 'pronta').length, 10);
});

test('grátis pelo app do Gemini no ensaio e troca automática quando a cota da IA acaba', async () => {
  const c = lojaC;
  const { id } = (await c('POST', '/api/fotos/ensaios', { origem: 'loja', origem_id: String(vid) })).body;
  // cota esgotada: as fotos viram "aguardando imagem" com o texto pronto, não erro
  process.env.FOTOS_IA = 'sem-cota';
  await c('PUT', `/api/fotos/ensaios/${id}`, { quantidade: 7 });
  await c('POST', `/api/fotos/ensaios/${id}/gerar`);
  let e = await esperar(c, id, (x) => x.status === 'manual');
  assert.ok(e.geradas.every((g) => g.status === 'manual'), JSON.stringify(e.geradas.map((g) => g.status)));
  assert.match(e.geradas[0].erro, /Gemini/);
  assert.ok(e.geradas[0].prompt_pt.length > 50);
  // escolha no próprio ensaio, mesmo sem chave nenhuma
  process.env.FOTOS_IA = '';
  e = (await c('PUT', `/api/fotos/ensaios/${id}`, { provedor: 'manual' })).body;
  assert.equal(e.provedor, 'manual');
  e = (await c('POST', `/api/fotos/ensaios/${id}/gerar`)).body;
  assert.equal(e.status, 'manual');
  assert.ok(e.geradas.every((g) => g.status === 'manual' && !g.erro));
  process.env.FOTOS_IA = 'simulado';
  await c('DELETE', `/api/fotos/ensaios/${id}`);
});

test('comando da IA: fidelidade e ângulo novo', () => {
  const M = require('../src/fotos/modelos');
  const ens = { modelo: '04', formato: '9:16', placa_modo: 'manter', loja: { nome: 'Topcar' } };
  assert.match(M.prompt({ ensaio: ens, tipo: 'exterior' }), /exact same vehicle/);
  const n = M.promptNovoAngulo({ ensaio: ens, angulo: 't34d', nRef: 2 });
  assert.match(n, /first 2 images are reference/);
  assert.match(n, /rear three-quarter/);
  assert.match(n, /do not invent accessories/);
  assert.match(n, /1080x1920/);
  assert.deepEqual(M.plano([{ id: 1, tipo: 'exterior' }, { id: 2, tipo: 'exterior' }], 4, false).map((x) => x.original_id), [1, 2, 1, 2]);
});
