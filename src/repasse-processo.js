// Repasse dentro do serviço da Loja (v2.24). Um serviço só no Render = as 750 h grátis do mês são gastas uma vez.
// O Repasse (pasta repasse/, ESM, Express 5) roda como processo filho em 127.0.0.1, porta interna, e a Loja
// continua falando com ele pelo proxy /repasse e por REPASSE_URL — o mesmo caminho de antes, só que local.
// Montar o Repasse como Router no mesmo processo (decisão do CLAUDE.md) fica para depois; assim o código dos
// dois apps não muda e um erro de um não derruba o outro.
//
// Variáveis: o filho NÃO herda o ambiente da Loja (segredos da Meta, Supabase etc.). Recebe só o básico, as
// REPASSE_* sem o prefixo (REPASSE_DATABASE_URL → DATABASE_URL, REPASSE_ADMIN_SENHA → ADMIN_SENHA…) e o
// GIRO_SSO_SEGREDO, que é o mesmo nos dois.
const { spawn } = require('node:child_process');
const path = require('node:path');

const PASTA = path.resolve(__dirname, '..', 'repasse');
const BASICAS = ['PATH', 'HOME', 'LANG', 'NODE_ENV', 'MALLOC_ARENA_MAX', 'GIRO_SSO_SEGREDO', 'RENDER_INSTANCE_ID', 'MEMORIA_LOG_MIN'];

const ativo = () => process.env.REPASSE_INTERNO === '1';
const porta = () => Number(process.env.REPASSE_PORTA_INTERNA || 10001);
const urlInterna = () => `http://127.0.0.1:${porta()}`;

function ambienteDoFilho(env = process.env, portaLoja = env.PORT || 3333) {
  const out = {};
  for (const k of BASICAS) if (env[k] != null) out[k] = env[k];
  for (const [k, v] of Object.entries(env)) {
    if (k.startsWith('REPASSE_') && !['REPASSE_INTERNO', 'REPASSE_PORTA_INTERNA', 'REPASSE_URL'].includes(k)) out[k.slice(8)] = v;
  }
  Object.assign(out, {
    PORT: String(porta()),
    HOST: '127.0.0.1',
    TZ: 'America/Sao_Paulo', // era o TZ do Dockerfile do Repasse
    KEEPALIVE: '0', // quem mantém o serviço acordado agora é a Loja (src/acordado.js), com janela de horário
    LOJA_URL: `http://127.0.0.1:${portaLoja}`,
  });
  return out;
}

let filho = null;
let parando = false;
let tentativas = 0;

function iniciar() {
  if (!ativo() || filho) return;
  // o proxy e a integração passam a falar com o Repasse local
  process.env.REPASSE_URL = urlInterna();
  const args = ['--no-warnings=ExperimentalWarning', 'src/server.js'];
  if (process.env.REPASSE_DEMO === '1') args.push('--demo');
  filho = spawn(process.execPath, args, { cwd: PASTA, env: ambienteDoFilho(), stdio: ['ignore', 'inherit', 'inherit'] });
  const desde = Date.now();
  console.log(`Repasse iniciado no mesmo serviço (pid ${filho.pid}, ${urlInterna()}).`);
  filho.on('exit', (codigo, sinal) => {
    filho = null;
    if (parando) return;
    // caiu sozinho: religa com espera crescente (zera se ficou de pé por mais de 10 min)
    if (Date.now() - desde > 10 * 60e3) tentativas = 0;
    const espera = Math.min(5 * 60e3, 5e3 * 2 ** tentativas++);
    console.error(`Repasse parou (código ${codigo}, sinal ${sinal}). Religando em ${Math.round(espera / 1000)} s.`);
    setTimeout(iniciar, espera).unref();
  });
}

// SIGTERM (deploy, hibernação): o Repasse fecha o WhatsApp com end() e libera a trava; espera até 15 s.
function parar() {
  parando = true;
  if (!filho) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(() => { try { filho && filho.kill('SIGKILL'); } catch {} resolve(); }, 15e3);
    filho.once('exit', () => { clearTimeout(t); resolve(); });
    filho.kill('SIGTERM');
  });
}

module.exports = { ativo, iniciar, parar, ambienteDoFilho, urlInterna };
