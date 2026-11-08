// GiroAuto Fotos ↔ GiroAuto Repasse, pela API do Repasse (sem acesso ao banco dele):
// login do repassador, anúncios da fila e em circulação, e as fotos de cada anúncio.
// A sessão do Repasse fica cifrada num cookie próprio do GiroAuto (giro_fotos_rp).
const { encrypt, decrypt } = require('../crypto');
const { parseCookies } = require('../auth');
const V = require('./veiculo');

const URL_REPASSE = () => (process.env.REPASSE_URL || 'https://giroauto-repasse.onrender.com').replace(/\/+$/, '');
const COOKIE = 'giro_fotos_rp';
const FILA = ['pendente'];
const CIRCULACAO = ['aprovado', 'circulando', 'enviado'];

class RepasseErro extends Error { constructor(msg, status) { super(msg); this.status = status; } }

async function chamar(caminho, { sessao, metodo = 'GET', corpo, binario = false, timeout = 30000 } = {}) {
  const headers = { Accept: binario ? 'image/*' : 'application/json' };
  if (sessao) headers.Cookie = `sessao=${sessao}`;
  if (corpo) headers['Content-Type'] = 'application/json';
  let r;
  try {
    r = await fetch(URL_REPASSE() + caminho, { method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined, redirect: 'manual', signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    throw new RepasseErro(e.name === 'TimeoutError' ? 'O GiroAuto Repasse demorou para responder (pode estar acordando). Tente de novo em 1 minuto.' : 'Não foi possível falar com o GiroAuto Repasse.', 502);
  }
  if (binario) return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) throw new RepasseErro('A sessão do GiroAuto Repasse expirou. Conecte de novo.', 401);
  if (!r.ok) throw new RepasseErro(data.erro || `GiroAuto Repasse respondeu ${r.status}.`, r.status);
  return { data, res: r };
}

// Devolve null se o e-mail/senha não forem do Repasse.
async function entrar(email, senha) {
  let res;
  try { ({ res } = await chamar('/api/login', { metodo: 'POST', corpo: { email, senha } })); }
  catch (e) { if (e.status === 401 || e.status === 429) return null; throw e; }
  const set = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || ''];
  const sessao = set.map((c) => /(?:^|;\s*)sessao=([^;]+)/.exec(c)?.[1]).find(Boolean);
  if (!sessao) return null;
  const { data } = await chamar('/api/estado', { sessao });
  return {
    sessao, contaId: data.conta?.id || 1, nome: data.conta?.nome || 'Repasse', usuario: data.sessao?.usuario || '',
    negocio: { nome: data.config?.negocio?.nome || data.conta?.nome || '', whatsapp: data.config?.negocio?.contato || '', cidade: '' },
  };
}

function gravar(req, res, s) {
  const secure = req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
  const v = s ? encrypt(JSON.stringify(s)) : '';
  res.append('Set-Cookie', `${COOKIE}=${encodeURIComponent(v)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${s ? 30 * 86400 : 0}${secure}`);
}
function ler(req) {
  const v = parseCookies(req.headers.cookie)[COOKIE];
  if (!v) return null;
  try { return JSON.parse(decrypt(v)); } catch { return null; }
}

function doAnuncio(a) {
  const d = a.dados || {};
  return V.doRepasse({ ...a, marca: d.marca, modelo: d.modelo, categoria: d.categoria, ano_modelo: d.anoModelo, km: d.km, preco_repasse: a.precoRepasse, fipe: a.fipe });
}

async function anuncios(s, grupo = 'todos') {
  const st = grupo === 'fila' ? FILA : grupo === 'circulacao' ? CIRCULACAO : [...FILA, ...CIRCULACAO];
  const { data } = await chamar(`/api/anuncios?status=${st.join(',')}&limite=300`, { sessao: s.sessao, timeout: 45000 });
  return (Array.isArray(data) ? data : []).map((a) => {
    const v = doAnuncio(a);
    const capa = (a.fotos || []).find((f) => f.capa) || (a.fotos || [])[0];
    return {
      id: a.id, codigo: a.codigo || (a.numeroFila ? `F-${String(a.numeroFila).padStart(4, '0')}` : ''),
      situacao: FILA.includes(a.status) ? 'Fila' : 'Em circulação', status: a.status,
      titulo: V.titulo(v), n_fotos: (a.fotos || []).length, origem_loja: a.dados?.origemLoja || null, capa: capa ? `/api/fotos/repasse/foto/${capa.id}` : '', veiculo: v,
    };
  });
}

async function anuncio(s, id) {
  if (!/^[0-9a-f-]{36}$/.test(String(id))) return null;
  const { data } = await chamar(`/api/anuncios?status=${[...FILA, ...CIRCULACAO].join(',')}&limite=300`, { sessao: s.sessao, timeout: 45000 });
  const a = (Array.isArray(data) ? data : []).find((x) => x.id === id);
  if (!a) return null;
  const fotos = [...(a.fotos || [])].sort((x, y) => (y.capa ? 1 : 0) - (x.capa ? 1 : 0) || x.ordem - y.ordem);
  return { id: a.id, veiculo: doAnuncio(a), fotos: fotos.map((f) => f.id), origem: a.origem || {}, codigo: a.codigo || '', preco_repasse: a.precoRepasse || 0, dados: a.dados || {} };
}

// Foto original (o painel do Repasse guarda a original; a versão com a placa borrada é só para fora).
const foto = (s, id) => (/^[0-9a-f-]{36}$/.test(String(id)) ? chamar(`/fotos/${id}`, { sessao: s.sessao, binario: true }) : null);

module.exports = { entrar, gravar, ler, anuncios, anuncio, foto, chamar, URL_REPASSE, RepasseErro };
