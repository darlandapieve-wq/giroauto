// Integração Loja ↔ GiroAuto Repasse (v2.18).
// - Do Repasse para a Loja: um anúncio da Fila ou em circulação vira carro do estoque, com fotos, dados,
//   FIPE e valor de compra = preço de repasse.
// - Da Loja para o Repasse: o carro vai para a Fila do Repasse (pendente), onde é conferido e aprovado.
// A Loja fala com o Repasse em nome da pessoa, com a sessão dela no Repasse: o cookie "sessao" de quem entrou
// pelo menu (/repasse, mesmo domínio) ou a conexão guardada pelo GiroAuto Fotos.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const auth = require('./auth');
const team = require('./team');
const storage = require('./storage');
const V = require('./vehicles');
const RP = require('./fotos/repasse');
const repasse = require('./repasse');
const { get, all, run, tx, logEvent } = require('./db');

const falha = (status, message) => Object.assign(new Error(message), { status });
const w = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const SEM_LOGIN = 'Entre no GiroAuto Repasse (item Repasse do menu) e tente de novo.';

function sessao(req) {
  const s = RP.ler(req)?.sessao || auth.parseCookies(req.headers.cookie).sessao;
  return s ? { sessao: s } : null;
}
function exigirSessao(req) {
  const s = sessao(req);
  if (!s) throw falha(409, SEM_LOGIN);
  return s;
}
const traduzir = (e) => (e.status === 401 ? falha(409, SEM_LOGIN) : e);

const int = (x) => { const n = parseInt(String(x ?? '').replace(/\D/g, ''), 10); return Number.isFinite(n) ? n : null; };
// "2018/2019" → 2018 (primeiro ano), "2019" → 2019
const ano = (x) => { const m = String(x ?? '').match(/(19|20)\d{2}/); return m ? Number(m[0]) : null; };
const txt = (x, max = 80) => String(x ?? '').trim().slice(0, max);

async function salvarFoto(storeId, buffer) {
  const st = get('SELECT foto_opts, logo_file FROM stores WHERE id = ?', storeId);
  const P = require('./photos');
  const fo = P.opts(st);
  const dir = path.join(config.dataDir, 'media');
  fs.mkdirSync(dir, { recursive: true });
  let nome = crypto.randomBytes(16).toString('hex') + '.jpg';
  fs.writeFileSync(path.join(dir, nome), buffer);
  if (fo.reduzir || fo.marca_dagua) {
    const logo = fo.marca_dagua && st.logo_file ? await storage.ensureLocal(st.logo_file).catch(() => null) : null;
    try { nome = await P.processFile(dir, nome, fo, logo); } catch (e) { console.error('Foto do Repasse:', e.message); }
  }
  await storage.saveMedia(nome);
  return nome;
}

function register(app) {
  // Anúncios do Repasse (Fila e em circulação), marcando os que já estão no estoque.
  app.get('/api/repasse/anuncios', team.can('cadastrar'), w(async (req, res) => {
    const s = exigirSessao(req);
    let lista;
    try { lista = await RP.anuncios(s, ['fila', 'circulacao'].includes(req.query.grupo) ? req.query.grupo : 'todos'); } catch (e) { throw traduzir(e); }
    const ja = new Map(all(`SELECT id, repasse_origem_id FROM vehicles WHERE store_id = ? AND repasse_origem_id <> ''`, req.user.storeId).map((r) => [r.repasse_origem_id, r.id]));
    // carro que a própria loja mandou para o Repasse: aponta para ele em vez de oferecer importar
    const daLoja = (a) => (String(a.origem_loja?.chave || '').startsWith(`${req.user.storeId}:`) ? Number(a.origem_loja.veiculoId) || null : null);
    res.json(lista.map((a) => ({ ...a, capa: a.capa ? a.capa.replace('/api/fotos/repasse/foto/', '/api/repasse/foto/') : '', no_estoque: ja.get(a.id) || daLoja(a), da_loja: !!daLoja(a) })));
  }));

  app.get('/api/repasse/foto/:id', team.can('cadastrar'), w(async (req, res) => {
    const b = await RP.foto(exigirSessao(req), req.params.id).catch(() => null);
    if (!b) return res.status(404).end();
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' }).send(b);
  }));

  // Repasse → estoque da loja
  app.post('/api/repasse/importar', team.can('cadastrar'), w(async (req, res) => {
    const s = exigirSessao(req);
    const id = String(req.body?.id || '');
    const ja = get(`SELECT id FROM vehicles WHERE store_id = ? AND repasse_origem_id = ?`, req.user.storeId, id);
    if (ja) return res.json({ id: ja.id, jaExistia: true });
    let a;
    try { a = await RP.anuncio(s, id); } catch (e) { throw traduzir(e); }
    if (!a) throw falha(404, 'Anúncio não encontrado no Repasse (só a Fila e os em circulação).');
    const propria = a.dados?.origemLoja;
    if (String(propria?.chave || '').startsWith(`${req.user.storeId}:`) && V.findVehicle(req.user.storeId, propria.veiculoId)) {
      return res.json({ id: Number(propria.veiculoId), jaExistia: true, da_loja: true });
    }
    const v = a.veiculo || {};
    if (!v.marca || !v.modelo) throw falha(400, 'O anúncio do Repasse não tem marca e modelo reconhecidos.');
    const buffers = (await Promise.all(a.fotos.slice(0, 20).map((f) => RP.foto(s, f).catch(() => null)))).filter(Boolean);
    const nomes = [];
    for (const b of buffers) { try { nomes.push(await salvarFoto(req.user.storeId, b)); } catch (e) { console.error('Foto do Repasse:', e.message); } }
    const de = [a.origem?.remetenteNome, a.origem?.grupoNome].filter(Boolean).join(' · ');
    const hoje = new Date().toISOString().slice(0, 10);
    const novoId = tx(() => {
      const r = run(`INSERT INTO vehicles (store_id, marca, modelo, versao, ano_fab, ano_modelo, km, preco, fipe, placa, cor, cambio, combustivel, carroceria,
          descricao, status, compra_valor, compra_data, compra_origem, compra_de, repasse_origem_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, '', 'rascunho', ?, ?, 'loja', ?, ?, ?)`,
      req.user.storeId, txt(v.marca), txt(v.modelo), txt(v.versao), ano(v.ano_fab) || ano(v.ano_modelo), ano(v.ano_modelo) || ano(v.ano_fab), int(v.km) || 0, int(v.fipe) || 0,
      txt(v.placa, 10).toUpperCase(), txt(v.cor, 30), txt(v.cambio, 30), txt(v.combustivel, 30), txt(v.carroceria, 30),
      int(a.preco_repasse) || int(v.preco) || 0, hoje, txt(de, 120), a.id, req.user.id);
      nomes.forEach((n, i) => run('INSERT INTO photos (vehicle_id, filename, mime, position) VALUES (?, ?, ?, ?)', r.lastInsertRowid, n, 'image/jpeg', i));
      return r.lastInsertRowid;
    });
    logEvent(req.user.storeId, `${v.marca} ${v.modelo} trazido do GiroAuto Repasse${a.codigo ? ` (${a.codigo})` : ''}`);
    if (nomes.length) require('./arts').schedule(novoId);
    res.status(201).json({ id: novoId, fotos: nomes.length, aviso: buffers.length < a.fotos.length ? `${a.fotos.length - buffers.length} foto(s) não vieram.` : '' });
  }));

  // Estoque da loja → Fila do Repasse
  app.post('/api/vehicles/:id/repasse/fila', team.can('publicar'), w(async (req, res) => {
    const s = exigirSessao(req);
    const v = V.findVehicle(req.user.storeId, req.params.id);
    if (!v) throw falha(404, 'Veículo não encontrado.');
    if (v.status === 'vendido') throw falha(400, 'Este carro já foi vendido.');
    if (!(v.preco_repasse > 0)) throw falha(400, 'Defina o preço de repasse acima e salve antes de enviar.');
    const store = get('SELECT * FROM stores WHERE id = ?', req.user.storeId);
    const base = config.publicUrl.replace(/\/+$/, '');
    const fotos = V.photosOf(v.id).slice(0, 20).map((p) => `${base}/media/${p.filename}`);
    const corpo = {
      // sem o link da vitrine (🔗) e o contato da loja (📞): o Repasse usa o modelo e o contato dele
      texto: repasse.texto(store, v).split('\n').filter((l) => !/^(🔗|📞)/u.test(l.trim())).join('\n'), fotos,
      loja: { id: store.id, nome: store.name, cidade: [store.city, store.state].filter(Boolean).join('/') },
      veiculo: { id: v.id, marca: v.marca, modelo: v.modelo, versao: v.versao, ano_fab: v.ano_fab, ano_modelo: v.ano_modelo, km: v.km, preco: v.preco_repasse, fipe: v.fipe, cambio: v.cambio, combustivel: v.combustivel, cor: v.cor },
    };
    let data;
    try { ({ data } = await RP.chamar('/api/da-loja/anuncio', { sessao: s.sessao, metodo: 'POST', corpo, timeout: 90000 })); } catch (e) { throw traduzir(e); }
    if (!data.jaExistia) {
      repasse.record(v.id, 'GiroAuto Repasse (Fila)', req.user.id);
      logEvent(req.user.storeId, `${v.marca} ${v.modelo} enviado para a Fila do GiroAuto Repasse`);
    }
    res.json({ ...data, dados: repasse.data(store, V.findVehicle(req.user.storeId, v.id)) });
  }));
}

module.exports = { register, sessao };
