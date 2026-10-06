// Simula duas versões publicadas em servidores novos (disco vazio) e confere que os dados continuam.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMockSupabase } = require('./mock-supabase');

const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
let mock; let supaUrl;
const PORT = 4777;
const base = `http://127.0.0.1:${PORT}`;
const tmpDirs = [];

before(async () => {
  mock = createMockSupabase();
  await new Promise((r) => mock.server.listen(0, r));
  supaUrl = `http://127.0.0.1:${mock.server.address().port}`;
});
after(() => { mock.server.close(); tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })); });

// Sobe o servidor como no Render: disco novo e vazio a cada versão.
const MODES = {
  storage: { SUPABASE_SECRET_KEY: 'sb_secret_teste', SUPABASE_KEY: '', GIROAUTO_STORAGE_TOKEN: '' },
  banco: { SUPABASE_SECRET_KEY: '', SUPABASE_KEY: 'sb_publishable_teste', GIROAUTO_STORAGE_TOKEN: 'giro_token_teste' },
};
let MODE = 'storage';
async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'giro-ver-'));
  tmpDirs.push(dir);
  const child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', path.join(__dirname, '..', 'src', 'start.js')], {
    env: { ...process.env, GIROAUTO_SKIP_ENV: '1', DATA_DIR: dir, PORT: String(PORT), PUBLIC_URL: base, SUPABASE_URL: supaUrl, ...MODES[MODE], GIROAUTO_DB: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/health')).ok) return { child, dir, log: () => out }; } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill('SIGKILL');
  throw new Error('servidor não subiu: ' + out);
}
async function stop(s) {
  const done = new Promise((r) => s.child.on('exit', r));
  s.child.kill('SIGTERM');
  await done;
}

let cookie = '';
async function api(method, url, body) {
  const opts = { method, headers: cookie ? { cookie } : {} };
  if (body instanceof FormData) opts.body = body;
  else if (body) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(base + url, opts);
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function cenario(email) {
  // Versão A
  let s = await boot();
  let r = await api('POST', '/api/auth/register', { loja: 'Autos Paraná', nome: 'Darlan', email, senha: '12345678' });
  assert.equal(r.status, 200);
  r = await api('POST', '/api/vehicles', { marca: 'Chevrolet', modelo: 'Onix', ano_modelo: 2022, km: 48200, preco: 74900, cor_interna: 'Preto' });
  const id = r.body.id;
  const fd = new FormData(); fd.append('fotos', new Blob([JPG], { type: 'image/jpeg' }), 'a.jpg');
  r = await api('POST', `/api/vehicles/${id}/photos`, fd);
  assert.equal(r.status, 200);
  const photoPath = new URL(r.body.photos[0].url).pathname;
  const temFoto = MODE === 'banco' ? [...mock.files.keys()].some((k) => k.startsWith('giroauto-fotos/') && !k.includes('#tmp')) : mock.buckets.get('giroauto-fotos').size >= 1;
  assert.ok(temFoto, 'foto enviada ao Supabase');
  await stop(s); // Render desliga a versão antiga com SIGTERM
  const nomes = MODE === 'banco' ? [...mock.files.keys()] : [...mock.buckets.get('giroauto-dados').keys()].map((k) => 'giroauto-dados/' + k);
  assert.ok(nomes.includes('giroauto-dados/giroauto.db'), 'banco copiado ao desligar');
  assert.ok(nomes.some((k) => k.startsWith('giroauto-dados/copias/')), 'cópia diária');
  assert.ok(!mock.log.some((l) => l.headers.authorization), 'chave nova só no apikey');

  // Versão B: servidor novo, disco vazio
  s = await boot();
  assert.match(s.log(), /Dados restaurados do Supabase/);
  r = await api('GET', '/api/me'); // sessão continua válida
  assert.equal(r.status, 200, 'sessão preservada');
  assert.equal(r.body.store.name, 'Autos Paraná');
  r = await api('GET', '/api/vehicles');
  assert.equal(r.body.length, 1);
  assert.equal(r.body[0].modelo, 'Onix');
  assert.equal(r.body[0].cor_interna, 'Preto');
  const img = await fetch(base + photoPath);
  assert.equal(img.status, 200, 'foto servida a partir do Supabase');
  assert.equal(Buffer.from(await img.arrayBuffer()).length, JPG.length);
  r = await api('GET', '/api/admin/storage');
  assert.equal(r.body.enabled, true);

  // Alteração sem desligar: a cópia sai em poucos segundos
  r = await api('POST', '/api/vehicles', { marca: 'Fiat', modelo: 'Strada', ano_modelo: 2022, km: 1000, preco: 100000 });
  await new Promise((res) => setTimeout(res, 4500));
  s.child.kill('SIGKILL'); // queda brusca, sem tempo de salvar
  await new Promise((res) => s.child.on('exit', res));

  s = await boot();
  r = await api('POST', '/api/auth/login', { email, senha: '12345678' });
  r = await api('GET', '/api/vehicles');
  assert.equal(r.body.length, 2, 'alteração copiada automaticamente');
  await stop(s);
}

test('modo Storage (chave secreta): dados continuam entre versões', async () => { MODE = 'storage'; cookie = ''; await cenario('s@x.com'); });
test('modo banco (chave publicável + senha do servidor): dados continuam entre versões', async () => { MODE = 'banco'; cookie = ''; await cenario('b@x.com'); });

test('não inicia com chave errada (para não sobrescrever a cópia guardada)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'giro-bad-')); tmpDirs.push(dir);
  const child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', path.join(__dirname, '..', 'src', 'start.js')], {
    env: { ...process.env, GIROAUTO_SKIP_ENV: '1', DATA_DIR: dir, PORT: '4778', SUPABASE_URL: supaUrl, SUPABASE_SECRET_KEY: 'errada', GIROAUTO_DB: '' },
  });
  const code = await new Promise((r) => child.on('exit', r));
  assert.equal(code, 1);
  const c2 = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', path.join(__dirname, '..', 'src', 'start.js')], {
    env: { ...process.env, GIROAUTO_SKIP_ENV: '1', DATA_DIR: dir, PORT: '4778', SUPABASE_URL: supaUrl, SUPABASE_KEY: 'sb_publishable_teste', GIROAUTO_STORAGE_TOKEN: 'senha_errada', GIROAUTO_DB: '' },
  });
  assert.equal(await new Promise((r) => c2.on('exit', r)), 1, 'senha do servidor errada não inicia');
  assert.ok(mock.buckets.get('giroauto-dados').has('giroauto.db'));
});
