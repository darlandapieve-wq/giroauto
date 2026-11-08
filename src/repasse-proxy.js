// GiroAuto Repasse dentro da Loja, em /repasse/ (v2.17).
// O Repasse continua sendo um serviço separado no Render (ver CLAUDE.md: unificar os serviços só quando a
// memória couber). Aqui a Loja só repassa as requisições de /repasse/* para ele, em streaming: nada fica em
// memória, e os eventos em tempo real (EventSource) passam direto. Login, cookies (sessao) e dados são os do Repasse.
const http = require('node:http');
const https = require('node:https');

const PREFIXO = '/repasse';
const alvo = () => new URL((process.env.REPASSE_URL || 'https://giroauto-repasse.onrender.com').replace(/\/+$/, '') + '/');
// cabeçalhos que não atravessam proxy
const SALTO = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host']);

function paginaAcordando(res, msg) {
  if (res.headersSent) return res.end();
  res.status(502).type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="20"><title>GiroAuto Repasse</title>
<body style="font:16px system-ui;max-width:560px;margin:60px auto;padding:0 16px;color:#222">
<h2>GiroAuto Repasse está acordando…</h2><p>${msg}</p><p>Esta página tenta de novo sozinha em 20 segundos.</p>
<p><a href="/">← Voltar ao GiroAuto</a></p></body>`);
}

// Location do Repasse → endereço dentro de /repasse
function ajustarLocation(loc, base) {
  if (!loc) return loc;
  try {
    const u = new URL(loc, base);
    if (u.origin !== base.origin) return loc;
    return PREFIXO + u.pathname + u.search + u.hash;
  } catch { return loc; }
}

function repassar(req, res) {
  const base = alvo();
  const destino = new URL(req.url.replace(/^\/+/, ''), base); // req.url já vem sem o /repasse
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!SALTO.has(k)) headers[k] = v;
  headers.host = destino.host;
  headers['x-forwarded-proto'] = req.protocol || 'https';
  headers['x-forwarded-host'] = req.get('host') || '';
  headers['x-forwarded-for'] = [req.headers['x-forwarded-for'], req.socket.remoteAddress].filter(Boolean).join(', ');
  headers['x-forwarded-prefix'] = PREFIXO;
  // v2.19.1: login único. Nunca repassa um x-giro-sso vindo do navegador; só a Loja o gera, para o administrador logado.
  delete headers['x-giro-sso'];
  const sso = require('./sso');
  if (sso.ativo() && sso.podeRepasse(req.user)) headers['x-giro-sso'] = sso.token(`loja${req.user.id}`);

  const cliente = destino.protocol === 'http:' ? http : https;
  const pr = cliente.request(destino, { method: req.method, headers }, (up) => {
    const out = {};
    for (const [k, v] of Object.entries(up.headers)) if (!SALTO.has(k)) out[k] = v;
    if (out.location) out.location = ajustarLocation(out.location, base);
    res.writeHead(up.statusCode || 502, out);
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    up.pipe(res);
  });
  pr.setTimeout(60000, () => pr.destroy(new Error('O Repasse demorou para responder.')));
  pr.on('error', (e) => paginaAcordando(res, e.message.includes('demorou') ? 'O serviço demorou para responder (no plano gratuito ele pode estar ligando).' : 'Não foi possível falar com o serviço agora.'));
  res.on('close', () => { if (!res.writableFinished) pr.destroy(); });
  req.pipe(pr);
}

function register(app) {
  // /repasse → /repasse/ (os caminhos do Repasse são relativos à barra final)
  app.use(PREFIXO, (req, res) => {
    const [caminho, consulta] = req.originalUrl.split(/\?(.*)/s);
    if (caminho === PREFIXO) return res.redirect(302, PREFIXO + '/' + (consulta ? '?' + consulta : ''));
    // eventos em tempo real sem buffer (o SSE do Repasse precisa chegar na hora)
    res.setHeader('X-Accel-Buffering', 'no');
    require('./auth').loadUser(req, res, () => repassar(req, res)); // quem está logado na Loja (para o login único)
  });
}

module.exports = { register, ajustarLocation };
