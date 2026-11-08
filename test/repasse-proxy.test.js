// /repasse/* da Loja → serviço do Repasse (proxy em streaming). Usa um Repasse falso local.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { register, ajustarLocation } = require('../src/repasse-proxy');

function servidor(app) {
  return new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
}

test('proxy do Repasse: redireciona, repassa corpo, cookies, Location e eventos', async (t) => {
  const falso = express();
  falso.use(express.json());
  falso.get('/', (req, res) => res.redirect('/login'));
  falso.get('/login', (req, res) => res.send('login ' + req.get('x-forwarded-prefix')));
  falso.post('/api/login', (req, res) => { res.setHeader('Set-Cookie', 'sessao=abc; Path=/; HttpOnly'); res.json({ ok: req.body.senha === 'x' }); });
  falso.get('/api/eco', (req, res) => res.json({ cookie: req.headers.cookie || '', q: req.query.q, sso: req.headers['x-giro-sso'] || '' }));
  falso.get('/api/events', (req, res) => { res.set({ 'Content-Type': 'text/event-stream' }); res.flushHeaders(); res.write('event: oi\ndata: 1\n\n'); });
  const up = await servidor(falso);
  process.env.REPASSE_URL = `http://127.0.0.1:${up.address().port}`;

  const loja = express();
  register(loja);
  loja.use(require('compression')());
  loja.get('/health', (req, res) => res.send('ok'));
  const srv = await servidor(loja);
  const L = `http://127.0.0.1:${srv.address().port}`;
  t.after(() => { for (const s of [up, srv]) { s.closeAllConnections(); s.close(); } delete process.env.REPASSE_URL; });

  let r = await fetch(L + '/repasse?a=1', { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/repasse/?a=1');

  r = await fetch(L + '/repasse/', { redirect: 'manual' });
  assert.equal(r.headers.get('location'), '/repasse/login', 'Location do Repasse ganha o prefixo');

  assert.equal(await (await fetch(L + '/repasse/login')).text(), 'login /repasse');

  r = await fetch(L + '/repasse/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha: 'x' }) });
  assert.deepEqual(await r.json(), { ok: true }, 'corpo JSON chega intacto');
  assert.match(r.headers.get('set-cookie'), /^sessao=abc/);

  assert.deepEqual(await (await fetch(L + '/repasse/api/eco?q=1', { headers: { cookie: 'sessao=abc', 'x-giro-sso': 'forjado.pelo.navegador' } })).json(), { cookie: 'sessao=abc', q: '1', sso: '' }, 'x-giro-sso do navegador nunca passa');

  // eventos chegam antes de a resposta terminar (sem buffer da compressão)
  await new Promise((ok, erro) => {
    const req = http.get(L + '/repasse/api/events', (res) => {
      assert.match(res.headers['content-type'], /^text\/event-stream/);
      res.once('data', (d) => { assert.match(String(d), /event: oi/); req.destroy(); ok(); });
    });
    req.on('error', (e) => (e.code === 'ECONNRESET' ? null : erro(e)));
    setTimeout(() => erro(new Error('evento não chegou')), 3000);
  });

  assert.equal(await (await fetch(L + '/health')).text(), 'ok', 'resto da Loja intacto');
});

test('proxy do Repasse: serviço fora do ar mostra página amigável', async (t) => {
  process.env.REPASSE_URL = 'http://127.0.0.1:9'; // porta fechada
  const loja = express(); register(loja);
  const srv = await servidor(loja);
  t.after(() => { srv.close(); delete process.env.REPASSE_URL; });
  const r = await fetch(`http://127.0.0.1:${srv.address().port}/repasse/`);
  assert.equal(r.status, 502);
  assert.match(await r.text(), /acordando/);
});

test('ajustarLocation só reescreve endereços do próprio Repasse', () => {
  const base = new URL('https://giroauto-repasse.onrender.com/');
  assert.equal(ajustarLocation('/login', base), '/repasse/login');
  assert.equal(ajustarLocation('login', base), '/repasse/login');
  assert.equal(ajustarLocation('https://giroauto-repasse.onrender.com/#x', base), '/repasse/#x');
  assert.equal(ajustarLocation('https://outro.site/a', base), 'https://outro.site/a');
});
