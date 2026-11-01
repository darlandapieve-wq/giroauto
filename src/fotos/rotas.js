// Rotas do GiroAuto Fotos (/fotos e /api/fotos/*), dentro do GiroAuto.
// Entra com o login da loja (o mesmo do painel) ou com o login do GiroAuto Repasse.
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const multer = require('multer');
const config = require('../config');
const storage = require('../storage');
const auth = require('../auth');
const { get, run } = require('../db');
const { verifyPassword } = require('../crypto');
const V = require('../vehicles');
const plate = require('../plate');
const M = require('./modelos');
const VF = require('./veiculo');
const E = require('./ensaios');
const RP = require('./repasse');
const ia = require('./ia');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 20 } });
const falha = (status, msg) => Object.assign(new Error(msg), { status });
const w = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    const status = e.status || (e.code === 'LIMIT_FILE_SIZE' ? 400 : 500);
    if (status >= 500) console.error('Fotos:', e);
    const msg = e.code === 'LIMIT_FILE_SIZE' ? 'Foto grande demais (máximo 20 MB).' : status >= 500 && !e.status ? 'Erro interno no servidor.' : e.message;
    if (!res.headersSent) res.status(status).json({ erro: msg, error: msg });
  }
};

/* ---------------- Quem está usando ---------------- */
function quem(req) {
  const rp = RP.ler(req);
  const espacos = []; const editar = [];
  if (req.user) {
    const id = `loja:${req.user.storeId}`;
    espacos.push(id);
    if (req.user.perms?.has('cadastrar') || req.user.perms?.has('publicar')) editar.push(id);
  }
  if (rp) { espacos.push(`repasse:${rp.contaId}`); editar.push(`repasse:${rp.contaId}`); }
  return { rp, espacos, editar };
}
function exigir(req, res, next) {
  req.q = quem(req);
  if (!req.q.espacos.length) return res.status(401).json({ erro: 'Entre com o login do GiroAuto (loja) ou do GiroAuto Repasse.', error: 'Entre na sua conta.' });
  next();
}
const lojaInfo = (storeId) => {
  const s = get('SELECT name, whatsapp, phone, city, state FROM stores WHERE id = ?', storeId) || {};
  return { nome: s.name || '', whatsapp: s.whatsapp || s.phone || '', cidade: s.city || '' };
};
const isAdmin = (req) => !!(req.user && get('SELECT is_admin FROM users WHERE id = ?', req.user.id)?.is_admin);

function register(app) {
  // Página (uma só, com os próprios arquivos em /fotos/*).
  const pagina = path.join(__dirname, '..', '..', 'public', 'fotos', 'index.html');
  app.get(['/fotos', '/fotos/'], (req, res) => res.sendFile(pagina));

  /* ---- Entrar e sair ---- */
  const tentativas = new Map();
  app.post('/api/fotos/login', w(async (req, res) => {
    const t = tentativas.get(req.ip) || { n: 0, ate: 0 };
    if (t.ate > Date.now()) throw falha(429, 'Muitas tentativas. Aguarde alguns minutos.');
    const email = String(req.body?.email || '').trim().toLowerCase();
    const senha = String(req.body?.senha || '');
    if (!email || !senha) throw falha(400, 'Informe e-mail e senha.');
    const u = get('SELECT * FROM users WHERE email = ?', email);
    const lojaOk = !!(u && u.active !== 0 && verifyPassword(senha, u.pass_hash));
    let rp = null;
    try { rp = await RP.entrar(email, senha); } catch (e) { if (!lojaOk) throw e; }
    if (!lojaOk && !rp) {
      t.n++; if (t.n >= 6) { t.ate = Date.now() + 10 * 60e3; t.n = 0; }
      tentativas.set(req.ip, t);
      throw falha(401, 'E-mail ou senha incorretos.');
    }
    tentativas.delete(req.ip);
    if (lojaOk) auth.createSession(res, u.id);
    if (rp) RP.gravar(req, res, rp);
    res.json({ ok: true, loja: lojaOk, repasse: !!rp });
  }));
  app.post('/api/fotos/logout', w(async (req, res) => { auth.destroySession(req, res); RP.gravar(req, res, null); res.json({ ok: true }); }));

  // Usuário da loja que também é repassador: conecta o Repasse sem sair.
  app.post('/api/fotos/repasse/conectar', w(async (req, res) => {
    const rp = await RP.entrar(String(req.body?.email || '').trim().toLowerCase(), String(req.body?.senha || ''));
    if (!rp) throw falha(401, 'E-mail ou senha do GiroAuto Repasse incorretos.');
    RP.gravar(req, res, rp);
    res.json({ ok: true, nome: rp.nome });
  }));
  app.post('/api/fotos/repasse/desconectar', w(async (req, res) => { RP.gravar(req, res, null); res.json({ ok: true }); }));

  app.get('/api/fotos/sessao', exigir, w(async (req, res) => {
    const { rp } = req.q;
    const espacos = [];
    if (req.user) espacos.push({ id: `loja:${req.user.storeId}`, nome: lojaInfo(req.user.storeId).nome || 'Loja', tipo: 'loja' });
    if (rp) espacos.push({ id: `repasse:${rp.contaId}`, nome: rp.nome || 'Repasse', tipo: 'repasse' });
    const p = E.provedor().nome;
    res.json({
      nome: req.user?.name || rp?.usuario || '', admin: isAdmin(req), espacos, editar: req.q.editar,
      origens: { loja: !!req.user, repasse: !!rp, podeEnviarLoja: !!req.user?.perms?.has('cadastrar') },
      provedor: p, provedor_nome: E.NOMES_IA[p] || p, falta_ia: '', servidor_ia: p !== 'manual', versao: require('../../package.json').version,
      ...M.publico(), carrocerias: VF.CARROCERIAS, cambios: VF.CAMBIOS, combustiveis: VF.COMBUSTIVEIS, cores: VF.CORES, selos: VF.SELOS,
    });
  }));

  /* ---- Origens ---- */
  app.get('/api/fotos/origens/loja', exigir, w(async (req, res) => {
    if (!req.user) throw falha(400, 'Entre com o login da loja para ver o estoque.');
    const lista = V.listVehicles(req.user.storeId).filter((v) => v.status !== 'vendido');
    res.json(lista.map((v) => ({
      id: String(v.id), titulo: VF.titulo(v) || v.titulo, status: v.em_avaliacao ? 'em avaliação' : v.status, placa: v.placa || '',
      capa: v.photos?.[0]?.url || '', fotos: (v.photos || []).length, veiculo: VF.daLoja(v),
    })));
  }));
  app.get('/api/fotos/origens/repasse', exigir, w(async (req, res) => {
    if (!req.q.rp) throw falha(400, 'Conecte o GiroAuto Repasse para ver a fila e os anúncios em circulação.');
    try { res.json(await RP.anuncios(req.q.rp, req.query.grupo)); }
    catch (e) { if (e.status === 401) RP.gravar(req, res, null); throw e; }
  }));
  app.get('/api/fotos/repasse/foto/:id', exigir, w(async (req, res) => {
    const b = req.q.rp ? await RP.foto(req.q.rp, req.params.id) : null;
    if (!b) return res.status(404).end();
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' }).send(b);
  }));
  app.get('/api/fotos/placa/:placa', exigir, w(async (req, res) => {
    const d = await plate.lookup(req.params.placa);
    res.json({ ...d, veiculo: d.encontrado ? VF.limpar(d) : null });
  }));
  app.get('/api/fotos/fipe/marcas', exigir, w(async (req, res) => res.json(await plate.fipeMarcas(req.query.tipo))));
  app.get('/api/fotos/fipe/modelos/:marca', exigir, w(async (req, res) => res.json(await plate.fipeModelos(req.query.tipo, req.params.marca))));
  app.get('/api/fotos/fipe/anos/:marca/:modelo', exigir, w(async (req, res) => res.json(await plate.fipeAnos(req.query.tipo, req.params.marca, req.params.modelo))));
  app.get('/api/fotos/fipe/preco/:marca/:modelo/:ano', exigir, w(async (req, res) => {
    const d = await plate.fipePreco(req.query.tipo, req.params.marca, req.params.modelo, req.params.ano);
    res.json({ ...d, veiculo: VF.limpar({ ...d, ano_fab: d.ano_modelo }) });
  }));

  /* ---- Ensaios ---- */
  app.get('/api/fotos/ensaios', exigir, w(async (req, res) => res.json(E.listar(req.q.espacos))));

  app.post('/api/fotos/ensaios', exigir, w(async (req, res) => {
    const b = req.body || {};
    const { rp, editar } = req.q;
    let espaco; let veiculo = b.veiculo || {}; let loja = {}; let origemId = null; let buffers = [];
    if (b.origem === 'loja') {
      if (!req.user) throw falha(400, 'Entre com o login da loja.');
      espaco = `loja:${req.user.storeId}`;
      const v = V.findVehicle(req.user.storeId, b.origem_id);
      if (!v) throw falha(404, 'Veículo não encontrado no estoque.');
      veiculo = VF.daLoja(V.serialize(v)); loja = lojaInfo(req.user.storeId); origemId = v.id;
      for (const p of V.photosOf(v.id).slice(0, 20)) buffers.push(await E.ler(p.filename));
    } else if (b.origem === 'repasse') {
      if (!rp) throw falha(400, 'Conecte o GiroAuto Repasse.');
      const a = await RP.anuncio(rp, b.origem_id);
      if (!a) throw falha(404, 'Anúncio não encontrado no Repasse (só a fila e os em circulação).');
      espaco = `repasse:${rp.contaId}`; veiculo = a.veiculo; loja = rp.negocio || {}; origemId = a.id;
      buffers = await Promise.all(a.fotos.slice(0, 20).map((id) => RP.foto(rp, id).catch(() => null)));
    } else {
      espaco = editar.includes(b.espaco) ? b.espaco : editar[0];
      loja = espaco?.startsWith('loja:') ? lojaInfo(req.user.storeId) : (rp?.negocio || {});
    }
    if (!editar.includes(espaco)) throw falha(403, 'Seu usuário não tem permissão para cadastrar ou divulgar veículos. Peça ao administrador da loja.');
    const id = E.criar({ espaco, origem: b.origem || 'avulso', origem_id: origemId, veiculo, loja, criado_por: req.user?.name || rp?.usuario || '' });
    const validas = buffers.filter(Boolean);
    let aviso = buffers.length > validas.length ? `${buffers.length - validas.length} foto(s) da origem não puderam ser trazidas.` : '';
    if (validas.length) { try { await E.adicionarOriginais(id, [espaco], validas); } catch (e) { aviso = e.message; } }
    res.status(201).json({ id, aviso });
  }));

  const det = (req) => E.detalhe(req.params.id, req.q.espacos);
  app.get('/api/fotos/ensaios/:id', exigir, w(async (req, res) => res.json(det(req))));
  app.put('/api/fotos/ensaios/:id', exigir, w(async (req, res) => { E.atualizar(req.params.id, req.q.editar, req.body || {}); res.json(det(req)); }));
  app.delete('/api/fotos/ensaios/:id', exigir, w(async (req, res) => { E.excluir(req.params.id, req.q.editar); res.json({ ok: true }); }));
  app.post('/api/fotos/ensaios/:id/originais', exigir, upload.array('fotos', 20), w(async (req, res) => {
    if (!req.files?.length) throw falha(400, 'Envie fotos em JPG, PNG ou WEBP de até 20 MB.');
    await E.adicionarOriginais(req.params.id, req.q.editar, req.files.map((f) => f.buffer));
    res.json(det(req));
  }));
  app.put('/api/fotos/ensaios/:id/originais/:oid', exigir, w(async (req, res) => { E.editarOriginal(req.params.id, req.q.editar, req.params.oid, req.body || {}); res.json(det(req)); }));
  app.delete('/api/fotos/ensaios/:id/originais/:oid', exigir, w(async (req, res) => { E.apagarOriginal(req.params.id, req.q.editar, req.params.oid); res.json(det(req)); }));
  app.post('/api/fotos/ensaios/:id/referencia', exigir, upload.single('foto'), w(async (req, res) => {
    if (!req.file) throw falha(400, 'Envie a foto de referência do cenário.');
    await E.definirReferencia(req.params.id, req.q.editar, req.file.buffer);
    res.json(det(req));
  }));
  app.post('/api/fotos/ensaios/:id/gerar', exigir, w(async (req, res) => { E.iniciar(req.params.id, req.q.editar); res.json(det(req)); }));
  app.post('/api/fotos/ensaios/:id/fotos/:gid/refazer', exigir, w(async (req, res) => { E.refazer(req.params.id, req.q.editar, req.params.gid, req.body?.instrucao); res.json(det(req)); }));
  app.put('/api/fotos/ensaios/:id/fotos/:gid', exigir, w(async (req, res) => { E.marcar(req.params.id, req.q.editar, req.params.gid, req.body?.status); res.json(det(req)); }));
  app.post('/api/fotos/ensaios/:id/fotos/:gid/manual', exigir, upload.single('foto'), w(async (req, res) => {
    if (!req.file) throw falha(400, 'Envie a imagem gerada.');
    await E.enviarManual(req.params.id, req.q.editar, req.params.gid, req.file.buffer, req.query.origem);
    res.json(det(req));
  }));
  app.post('/api/fotos/ensaios/:id/fotos/:gid/erro', exigir, w(async (req, res) => { E.erroNavegador(req.params.id, req.q.editar, req.params.gid, req.body?.erro); res.json(det(req)); }));
  app.post('/api/fotos/ensaios/:id/artes', exigir, w(async (req, res) => { E.refazerArtes(req.params.id, req.q.editar); res.json(det(req)); }));

  // ZIP: fotos aprovadas (ou todas as prontas), artes e texto do anúncio.
  app.get('/api/fotos/ensaios/:id/zip', exigir, w(async (req, res) => {
    const p = E.pacote(req.params.id, req.q.espacos);
    const itens = [...p.fotos, ...p.artes];
    if (!itens.length) throw falha(400, 'Ainda não há imagens prontas neste ensaio.');
    const files = [];
    for (const it of itens) { const data = await E.ler(it.arquivo); if (data) files.push({ name: it.nome, data }); }
    files.push({ name: 'texto-do-anuncio.txt', data: Buffer.from(p.texto + '\n', 'utf8') });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${p.nome}.zip"`);
    res.send(require('../zip').buildZip(files));
  }));

  // Fotos aprovadas entram nas fotos do carro no estoque (cópias; limite de 20 fotos por carro).
  app.post('/api/fotos/ensaios/:id/enviar-loja', exigir, w(async (req, res) => {
    const p = E.pacote(req.params.id, req.q.editar);
    const e = p.ensaio;
    if (e.origem !== 'loja' || !e.origem_id || !req.user || e.espaco !== `loja:${req.user.storeId}`) throw falha(400, 'Só ensaios feitos a partir do estoque da loja voltam para o carro.');
    if (!req.user.perms?.has('cadastrar')) throw falha(403, 'Seu usuário não tem permissão para cadastrar fotos.');
    const v = V.findVehicle(req.user.storeId, e.origem_id);
    if (!v) throw falha(404, 'O carro não está mais no estoque.');
    if (!p.fotos.length) throw falha(400, 'Aprove ao menos uma foto.');
    const n = get('SELECT COUNT(*) n FROM photos WHERE vehicle_id = ?', v.id).n;
    if (n + p.fotos.length > 20) throw falha(400, `O carro já tem ${n} fotos e o limite é 20. Exclua algumas no estoque ou aprove menos fotos.`);
    let pos = (get('SELECT MAX(position) m FROM photos WHERE vehicle_id = ?', v.id).m ?? -1) + 1;
    for (const f of p.fotos) {
      const data = await E.ler(f.arquivo);
      if (!data) continue;
      const nome = crypto.randomBytes(16).toString('hex') + '.jpg';
      fs.writeFileSync(path.join(config.dataDir, 'media', nome), data);
      await storage.saveMedia(nome);
      run('INSERT INTO photos (vehicle_id, filename, mime, position) VALUES (?, ?, ?, ?)', v.id, nome, 'image/jpeg', pos++);
    }
    run(`UPDATE vehicles SET updated_at = datetime('now') WHERE id = ?`, v.id);
    require('../arts').schedule(v.id);
    res.json({ ok: true, enviadas: p.fotos.length, total_na_loja: get('SELECT COUNT(*) n FROM photos WHERE vehicle_id = ?', v.id).n });
  }));

  /* ---- Configuração (administrador da plataforma) ---- */
  app.get('/api/fotos/config', exigir, w(async (req, res) => { if (!isAdmin(req)) throw falha(403, 'Só o administrador.'); res.json(E.cfg()); }));
  app.put('/api/fotos/config', exigir, w(async (req, res) => { if (!isAdmin(req)) throw falha(403, 'Só o administrador.'); res.json(E.salvarCfg(req.body || {})); }));
  app.post('/api/fotos/config/testar', exigir, w(async (req, res) => {
    if (!isAdmin(req)) throw falha(403, 'Só o administrador.');
    const p = E.provedor();
    if (p.nome !== 'gemini' || !p.chave) throw falha(400, 'Escolha o Google Gemini e cadastre a chave em Configurações > Imagens com IA.');
    try { const m = await ia.geminiTestar(p.chave); res.json({ ok: true, imagem: m.filter((x) => /image|banana/i.test(x)).slice(0, 12) }); }
    catch (e) { throw falha(400, ia.amigavel(e, 'gemini')); }
  }));

  setTimeout(() => { try { E.retomar(); } catch (e) { console.error('Fotos (retomar):', e.message); } }, 3000).unref();
}

module.exports = { register };
