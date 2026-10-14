// Rotas da v2.0 (parte 2): placa e FIPE, oferta para carro parado, agenda de republicação,
// fotos prontas e logo, foto editada (desfoque), QR code, folha A4, painel TV e importação de planilha.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const config = require('./config');
const storage = require('./storage');
const V = require('./vehicles');
const team = require('./team');
const auth = require('./auth');
const plate = require('./plate');
const photos = require('./photos');
const schedule = require('./schedule');
const printables = require('./printables');
const importer = require('./importer');
const { get, all, run, tx, logEvent } = require('./db');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (status, message) => Object.assign(new Error(message), { status });
const own = (req) => {
  const v = V.findVehicle(req.user.storeId, req.params.id);
  if (!v) throw fail(404, 'Veículo não encontrado.');
  return v;
};
const mediaDir = () => path.join(config.dataDir, 'media');

// Oferta sugerida: perto da FIPE quando o preço está acima dela; senão, 4% abaixo. Termina em 900.
function sugerirOferta(v) {
  const p = v.preco || 0;
  if (!p) return 0;
  let alvo = p * 0.96;
  if (v.fipe && p > v.fipe * 1.02) alvo = Math.max(v.fipe * 1.01, p * 0.92);
  const r = Math.floor((alvo + 100) / 1000) * 1000 - 100;
  return r > 0 && r < p ? r : Math.round(p * 0.97);
}

function register(app) {
  /* ---------------- Placa e Tabela FIPE ---------------- */
  app.get('/api/plate/:placa', team.can('cadastrar'), wrap(async (req, res) => res.json(await plate.lookup(req.params.placa))));
  app.post('/api/plate/:placa/html', team.can('cadastrar'), (req, res) => {
    const d = plate.fromHtml(req.params.placa, req.body?.html, req.body?.url);
    if (!d.encontrado) throw fail(404, 'Não foi possível ler os dados desta placa. Use a Tabela FIPE abaixo ou preencha à mão.');
    res.json(d);
  });
  app.get('/api/fipe/:tipo/marcas', auth.requireUser, wrap(async (req, res) => res.json(await plate.fipeMarcas(req.params.tipo))));
  app.get('/api/fipe/:tipo/marcas/:m/modelos', auth.requireUser, wrap(async (req, res) => res.json(await plate.fipeModelos(req.params.tipo, req.params.m))));
  app.get('/api/fipe/:tipo/marcas/:m/modelos/:mo/anos', auth.requireUser, wrap(async (req, res) => res.json(await plate.fipeAnos(req.params.tipo, req.params.m, req.params.mo))));
  app.get('/api/fipe/:tipo/marcas/:m/modelos/:mo/anos/:a', auth.requireUser, wrap(async (req, res) => res.json(await plate.fipePreco(req.params.tipo, req.params.m, req.params.mo, req.params.a))));

  // Diagnóstico das fontes de placa (sem dados do veículo): quais sites respondem ao servidor.
  app.get('/health/placa', wrap(async (req, res) => res.json(await plate.diag(req.query.p || 'ART9H77'))));

  /* ---------------- Grupos de repasse (v2.2) ---------------- */
  const repasse = require('./repasse');
  app.get('/api/vehicles/:id/repasse', auth.requireUser, (req, res) => {
    const store = get('SELECT * FROM stores WHERE id = ?', req.user.storeId);
    res.json(repasse.data(store, own(req)));
  });
  // Preço de repasse (precisa da permissão de preços) e detalhes para o texto do grupo.
  app.put('/api/vehicles/:id/repasse-preco', team.canAny('precos', 'publicar'), (req, res) => {
    const v = own(req);
    const b = req.body || {};
    if (b.preco_repasse !== undefined) {
      if (!req.user.perms.has('precos')) throw fail(403, 'Seu usuário não pode alterar preços. Peça ao administrador da loja.');
      run(`UPDATE vehicles SET preco_repasse = ?, updated_at = datetime('now') WHERE id = ?`, parseInt(String(b.preco_repasse).replace(/\D/g, ''), 10) || 0, v.id);
    }
    if (b.detalhes !== undefined) run('UPDATE vehicles SET repasse_detalhes = ? WHERE id = ?', String(b.detalhes).trim().slice(0, 300), v.id);
    const store = get('SELECT * FROM stores WHERE id = ?', req.user.storeId);
    res.json(repasse.data(store, V.findVehicle(req.user.storeId, v.id)));
  });
  app.post('/api/vehicles/:id/repasse', team.can('publicar'), (req, res) => {
    const v = own(req);
    const n = repasse.record(v.id, req.body?.grupos, req.user.id);
    if (n) logEvent(req.user.storeId, `${v.marca} ${v.modelo} enviado para ${n} grupo(s) de repasse`);
    const store = get('SELECT * FROM stores WHERE id = ?', req.user.storeId);
    res.json(repasse.data(store, V.findVehicle(req.user.storeId, v.id)));
  });
  app.put('/api/store/repasse-grupos', team.canAny('publicar', 'config'), (req, res) => res.json({ grupos: repasse.saveGroups(req.user.storeId, req.body?.grupos) }));

  /* ---------------- Carro parado: oferta com um clique ---------------- */
  app.get('/api/vehicles/:id/offer-suggestion', auth.requireUser, (req, res) => {
    const v = V.serialize(own(req));
    res.json({ sugestao: sugerirOferta(v), preco: v.preco, fipe: v.fipe, dias: v.dias_estoque, fipe_diff_pct: v.fipe_diff_pct, publicado: v.status === 'publicado' });
  });
  app.post('/api/vehicles/:id/offer', team.can('precos'), (req, res) => {
    const v = own(req);
    const valor = parseInt(String(req.body?.preco_oferta ?? '').replace(/\D/g, ''), 10) || 0;
    if (!valor || valor >= v.preco) throw fail(400, 'A oferta precisa ser menor que o preço atual.');
    run(`UPDATE vehicles SET preco_oferta = ?, oferta_desde = datetime('now'), updated_at = datetime('now') WHERE id = ?`, valor, v.id);
    logEvent(req.user.storeId, `Oferta de R$ ${valor.toLocaleString('pt-BR')} no ${v.marca} ${v.modelo}`);
    require('./arts').schedule(v.id);
    res.json(V.serialize(V.findVehicle(req.user.storeId, v.id)));
  });

  /* ---------------- Agenda de republicação ---------------- */
  app.get('/api/store/schedule', auth.requireUser, (req, res) => {
    const st = get('SELECT rep_schedule, pub_mode, daily_limit FROM stores WHERE id = ?', req.user.storeId);
    res.json({ ...schedule.parse(st), pub_mode: st.pub_mode, daily_limit: st.daily_limit, prontos: schedule.republishable(req.user.storeId, 100).length });
  });
  app.put('/api/store/schedule', team.can('config'), (req, res) => {
    const sc = schedule.clean(req.body || {});
    run('UPDATE stores SET rep_schedule = ? WHERE id = ?', JSON.stringify(sc), req.user.storeId);
    res.json(sc);
  });

  /* ---------------- Fotos prontas e logo ---------------- */
  app.get('/api/store/photos', auth.requireUser, (req, res) => {
    const st = get('SELECT foto_opts, logo_file FROM stores WHERE id = ?', req.user.storeId);
    res.json({ ...photos.opts(st), logo_url: st.logo_file ? `${config.publicUrl}/media/${st.logo_file}` : '' });
  });
  app.put('/api/store/photos', team.can('config'), (req, res) => {
    const o = photos.clean(req.body || {});
    run('UPDATE stores SET foto_opts = ? WHERE id = ?', JSON.stringify(o), req.user.storeId);
    res.json(o);
  });
  const uploadImg = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 1 },
    fileFilter: (_req, f, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(f.mimetype)) });
  app.post('/api/store/logo', team.can('config'), uploadImg.single('logo'), wrap(async (req, res) => {
    if (!req.file) throw fail(400, 'Envie o logo em PNG (de preferência com fundo transparente), JPG ou WEBP.');
    const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[req.file.mimetype];
    const name = crypto.randomBytes(16).toString('hex') + ext;
    fs.mkdirSync(mediaDir(), { recursive: true });
    fs.writeFileSync(path.join(mediaDir(), name), req.file.buffer);
    await storage.saveMedia(name);
    const old = get('SELECT logo_file FROM stores WHERE id = ?', req.user.storeId).logo_file;
    run('UPDATE stores SET logo_file = ? WHERE id = ?', name, req.user.storeId);
    if (old) { fs.rm(path.join(mediaDir(), old), () => {}); storage.removeMedia([old]).catch(() => {}); }
    res.json({ logo_url: `${config.publicUrl}/media/${name}` });
  }));

  // Foto editada no painel (desfoque da placa): substitui a foto mantendo a posição.
  app.put('/api/vehicles/:id/photos/:pid/file', team.can('cadastrar'), uploadImg.single('foto'), wrap(async (req, res) => {
    const v = own(req);
    const p = get('SELECT * FROM photos WHERE id = ? AND vehicle_id = ?', Number(req.params.pid), v.id);
    if (!p) throw fail(404, 'Foto não encontrada.');
    if (!req.file) throw fail(400, 'Envie a foto editada.');
    const name = crypto.randomBytes(16).toString('hex') + '.jpg';
    fs.writeFileSync(path.join(mediaDir(), name), req.file.buffer);
    await storage.saveMedia(name);
    run('UPDATE photos SET filename = ?, mime = ? WHERE id = ?', name, 'image/jpeg', p.id);
    fs.rm(path.join(mediaDir(), p.filename), () => {});
    storage.removeMedia([p.filename]).catch(() => {});
    require('./arts').schedule(v.id);
    res.json(V.serialize(V.findVehicle(req.user.storeId, v.id)));
  }));

  /* ---------------- QR code, folha A4 e painel TV ---------------- */
  app.get('/qr/:slug/:id.png', wrap(async (req, res) => {
    const store = get('SELECT * FROM stores WHERE slug = ?', req.params.slug);
    const v = store && V.findVehicle(store.id, req.params.id);
    if (!v) return res.status(404).send('Não encontrado');
    res.type('png').setHeader('Cache-Control', 'public, max-age=86400');
    res.send(await printables.qrPng(printables.vehicleUrl(store, v)));
  }));
  app.get('/imprimir/:id', auth.requireUser, wrap(async (req, res) => {
    const store = get('SELECT * FROM stores WHERE id = ?', req.user.storeId);
    const v = V.findVehicle(req.user.storeId, req.params.id);
    if (!v) return res.status(404).send('Veículo não encontrado');
    res.send(await printables.a4(store, v, req.query.modo === 'pb' ? 'pb' : 'cor'));
  }));
  app.get('/tv/:slug', (req, res) => {
    const store = get('SELECT * FROM stores WHERE slug = ?', req.params.slug);
    if (!store) return res.status(404).send('Loja não encontrada');
    res.send(printables.tv(store));
  });
  app.get('/tv/:slug/dados', wrap(async (req, res) => {
    const store = get('SELECT * FROM stores WHERE slug = ?', req.params.slug);
    if (!store) return res.status(404).json({ error: 'Loja não encontrada' });
    const vs = all(`SELECT * FROM vehicles WHERE store_id = ? AND status IN ('pronto','publicado') ORDER BY updated_at DESC LIMIT 60`, store.id).map(V.serialize);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ veiculos: await printables.tvData(store, vs) });
  }));

  /* ---------------- Importação de planilha ---------------- */
  const uploadSheet = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
  app.get('/api/import/modelo.csv', auth.requireUser, (req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="modelo-estoque-giroauto.csv"');
    res.send(importer.templateCsv());
  });
  app.get('/api/import/modelo.xlsx', auth.requireUser, wrap(async (req, res) => {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="modelo-estoque-giroauto.xlsx"');
    res.send(Buffer.from(await importer.templateXlsx()));
  }));
  app.post('/api/import/preview', team.can('cadastrar'), uploadSheet.single('planilha'), wrap(async (req, res) => {
    if (!req.file) throw fail(400, 'Envie a planilha em .xlsx ou .csv.');
    res.json(await importer.preview(req.file));
  }));
  app.post('/api/import/commit', team.can('cadastrar'), (req, res) => {
    const linhas = Array.isArray(req.body?.linhas) ? req.body.linhas.slice(0, 1000) : [];
    const fin = req.user.perms.has('financeiro');
    let n = 0; let pulados = 0;
    tx(() => {
      for (const l of linhas) {
        const d = V.cleanInput(l);
        if (!d.marca || !d.modelo) { pulados++; continue; }
        if (d.placa && get('SELECT 1 FROM vehicles WHERE store_id = ? AND placa = ? AND status != \'vendido\'', req.user.storeId, d.placa)) { pulados++; continue; }
        d.created_by = req.user.id;
        if (fin) { d.compra_valor = parseInt(l.compra_valor, 10) || 0; d.compra_data = /^\d{4}-\d{2}-\d{2}$/.test(l.compra_data || '') ? l.compra_data : null; }
        if (V.ORIGEM.some((x) => x.key === l.compra_origem)) d.compra_origem = l.compra_origem;
        if (d.preco_oferta) d.oferta_desde = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const cols = Object.keys(d);
        run(`INSERT INTO vehicles (store_id, ${cols.join(',')}) VALUES (?, ${cols.map(() => '?').join(',')})`, req.user.storeId, ...cols.map((k) => d[k]));
        n++;
      }
    });
    logEvent(req.user.storeId, `${n} veículo(s) importado(s) de planilha`);
    res.json({ importados: n, pulados });
  });
}

module.exports = { register, sugerirOferta };
