// Vídeo de divulgação do carro (v2.23): 15 s, vertical, com as fotos escolhidas, legendas, cartão final
// (logo, preço, WhatsApp) e música da biblioteca do GiroAuto ou enviada pela loja (com o trecho escolhido).
// Gerado no servidor com FFmpeg, um vídeo por vez (memória do Render), em segundo plano com progresso.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const config = require('./config');
const { get, run, logEvent } = require('./db');
const V = require('./vehicles');
const storage = require('./storage');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const W = 1080, H = 1920;            // telas montadas em alta e o vídeo sai em 720x1280 (leve para o Render e bom para Reels/Status)
const OUT_W = 720, OUT_H = 1280, FPS = 30, DUR = 15, X = 0.35;
const MUSICAS = [
  { id: 'energia', nome: 'Energia', desc: 'Eletrônica animada' },
  { id: 'pop', nome: 'Pop', desc: 'Leve e alegre' },
  { id: 'rock', nome: 'Rock', desc: 'Guitarra e bateria' },
  { id: 'chill', nome: 'Chill', desc: 'Calma, para carros premium' },
  { id: 'epico', nome: 'Épico', desc: 'Cinematográfica' },
];
const musicaPadrao = (id) => path.join(__dirname, '..', 'assets', 'musicas', `${id}.m4a`);
const httpError = (status, message) => Object.assign(new Error(message), { status });
const str = (x, max = 80) => String(x ?? '').trim().slice(0, max);
const brl = (n) => `R$ ${Number(n || 0).toLocaleString('pt-BR')}`;
const foneBr = (t) => { const d = String(t || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''); return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : t; };
const dirVideos = () => path.join(config.dataDir, 'videos');

/* ---------------- Músicas da loja (trechos de 30 s guardados no armazenamento) ---------------- */
function musicasDaLoja(storeId) {
  try { return JSON.parse(get('SELECT value FROM settings WHERE key = ?', `video_musicas_${storeId}`)?.value || '[]'); } catch { return []; }
}
function gravarMusicas(storeId, lista) {
  run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`, `video_musicas_${storeId}`, JSON.stringify(lista.slice(0, 30)));
}
function biblioteca(storeId) {
  return { padrao: MUSICAS.map((m) => ({ ...m, url: `/musicas/${m.id}.m4a` })), loja: musicasDaLoja(storeId).map((m) => ({ ...m, url: `/media/${m.file}` })) };
}
async function removerMusica(storeId, file) {
  const lista = musicasDaLoja(storeId);
  if (!lista.some((m) => m.file === file)) throw httpError(404, 'Música não encontrada.');
  gravarMusicas(storeId, lista.filter((m) => m.file !== file));
  fs.rm(path.join(config.dataDir, 'media', file), () => {});
  storage.removeMedia([file]).catch(() => {});
}

/* ---------------- Telas ---------------- */
let fontes = false;
function canvas() {
  const cv = require('@napi-rs/canvas');
  if (!fontes) {
    const F = path.join(__dirname, '..', 'assets', 'fonts');
    cv.GlobalFonts.registerFromPath(path.join(F, 'Montserrat_800ExtraBold.ttf'), 'GV Black');
    cv.GlobalFonts.registerFromPath(path.join(F, 'Montserrat_600SemiBold.ttf'), 'GV Semi');
    fontes = true;
  }
  return cv;
}
// Texto que cabe na largura: diminui a fonte até caber.
function caber(ctx, texto, fonte, tam, max) { let t = tam; do { ctx.font = `${t}px "${fonte}"`; t -= 2; } while (ctx.measureText(texto).width > max && t > 20); return ctx.font; }
function pilula(ctx, texto, y, cor) {
  ctx.font = caber(ctx, texto, 'GV Black', 50, W - 200);
  const w = Math.min(W - 80, ctx.measureText(texto).width + 90);
  ctx.fillStyle = cor; ctx.beginPath(); ctx.roundRect((W - w) / 2, y, w, 106, 53); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(texto, W / 2, y + 55);
}

// Monta em 1080x1920 e grava em 810x1440: o FFmpeg trabalha com quadros menores (memória do Render) e o vídeo sai em 720x1280.
async function salvarTela(img, destino) {
  const buf = await img.jpeg({ quality: 95 }).toBuffer();
  await require('sharp')(buf).resize(810, 1440).jpeg({ quality: 90 }).toFile(destino);
}

async function telaFoto(arquivo, { titulo, sub, legenda }, destino) {
  const sharp = require('sharp');
  const fundo = await sharp(arquivo).rotate().resize(W, H, { fit: 'cover' }).blur(40).modulate({ brightness: 0.45 }).toBuffer();
  const foto = await sharp(arquivo).rotate().resize(W, 1240, { fit: 'cover' }).toBuffer();
  const cv = canvas(); const c = cv.createCanvas(W, H); const ctx = c.getContext('2d');
  if (titulo) {
    const g = ctx.createLinearGradient(0, 0, 0, 520); g.addColorStop(0, 'rgba(0,0,0,.75)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, 520);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fff'; ctx.font = caber(ctx, titulo, 'GV Black', 84, W - 80); ctx.fillText(titulo, W / 2, 230);
    if (sub) { ctx.fillStyle = '#f5b301'; ctx.font = caber(ctx, sub, 'GV Semi', 52, W - 120); ctx.fillText(sub, W / 2, 310); }
  }
  if (legenda) pilula(ctx, legenda, 1570, '#d71920');
  await salvarTela(sharp(fundo).composite([{ input: foto, top: 340, left: 0 }, { input: await c.encode('png'), top: 0, left: 0 }]), destino);
}

async function telaFinal(store, v, { whatsapp, fundo: fotoFundo }, destino) {
  const sharp = require('sharp');
  const fundo = await sharp(fotoFundo).rotate().resize(W, H, { fit: 'cover' }).blur(30).modulate({ brightness: 0.3 }).toBuffer();
  const camadas = [{ input: fundo, top: 0, left: 0 }];
  const logo = store.logo_file ? await storage.ensureLocal(store.logo_file).catch(() => null) : null;
  let topoTexto = 560;
  if (logo) {
    const l = await sharp(logo).resize(820, 330, { fit: 'contain', background: '#ffffff' }).flatten({ background: '#ffffff' }).toBuffer();
    const cartao = await sharp({ create: { width: 900, height: 380, channels: 3, background: '#ffffff' } }).composite([{ input: l, top: 25, left: 40 }]).png().toBuffer();
    camadas.push({ input: cartao, top: 230, left: 90 }); topoTexto = 770;
  }
  const cv = canvas(); const c = cv.createCanvas(W, H); const ctx = c.getContext('2d');
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  if (!logo) { ctx.fillStyle = '#fff'; ctx.font = caber(ctx, store.name.toUpperCase(), 'GV Black', 96, W - 100); ctx.fillText(store.name.toUpperCase(), W / 2, 420); }
  const nome = [v.marca, v.modelo, v.versao, v.ano_modelo].filter(Boolean).join(' ');
  ctx.fillStyle = '#fff'; ctx.font = caber(ctx, nome, 'GV Black', 60, W - 100); ctx.fillText(nome, W / 2, topoTexto);
  const oferta = V.ofertaAtiva(v);
  let y = topoTexto + 120;
  if (oferta) {
    const de = `de ${brl(v.preco)}`; ctx.fillStyle = '#bbb'; ctx.font = '54px "GV Semi"'; ctx.fillText(de, W / 2, y);
    const wDe = ctx.measureText(de).width; ctx.fillRect(W / 2 - wDe / 2, y - 18, wDe, 4); y += 150;
  } else y += 60;
  const preco = V.precoAnuncio(v);
  if (preco) { ctx.fillStyle = '#f5b301'; ctx.font = caber(ctx, brl(preco), 'GV Black', 140, W - 80); ctx.fillText(brl(preco), W / 2, y); }
  if (whatsapp) pilula(ctx, `WhatsApp ${foneBr(whatsapp)}`, y + 110, '#1faa55');
  const cidade = [store.city, store.state].filter(Boolean).join(' · ');
  if (cidade) { ctx.fillStyle = '#fff'; ctx.font = '48px "GV Semi"'; ctx.fillText(cidade, W / 2, y + 340); }
  camadas.push({ input: await c.encode('png'), top: 0, left: 0 });
  await salvarTela(sharp({ create: { width: W, height: H, channels: 3, background: '#000' } }).composite(camadas), destino);
}

// Legendas sugeridas: cor e câmbio na primeira foto; destaques do carro nas seguintes.
function sugestoes(v) {
  const s = [[v.cor, v.cambio].filter(Boolean).join(' · ')];
  for (const k of V.destaquesOf(v)) s.push(V.DESTAQUE[k].label);
  return s;
}
function padrao(storeId, v) {
  const mc = get('SELECT whatsapp_number FROM meta_connections WHERE store_id = ?', storeId);
  const st = get('SELECT whatsapp FROM stores WHERE id = ?', storeId);
  const sug = sugestoes(v);
  return {
    whatsapp: mc?.whatsapp_number || st?.whatsapp || '',
    fotos: V.photosOf(v.id).slice(0, 8).map((p, i) => ({ file: p.filename, url: V.mediaUrl(p.filename), legenda: sug[i] || '' })),
    titulo: [v.marca, v.modelo, v.versao].filter(Boolean).join(' ').toUpperCase(),
    sub: [v.ano_fab && v.ano_modelo ? `${v.ano_fab}/${v.ano_modelo}` : v.ano_modelo, v.km ? `${Number(v.km).toLocaleString('pt-BR')} km` : ''].filter(Boolean).join(' · '),
    ...biblioteca(storeId),
  };
}

/* ---------------- FFmpeg ---------------- */
function ffmpeg(args, { duracao, aoProgresso } = {}) {
  return new Promise((ok, falha) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let erro = '';
    p.stdout.on('data', (d) => { const m = String(d).match(/out_time_us=(\d+)/g); if (m && duracao && aoProgresso) aoProgresso(Math.min(1, Number(m.at(-1).split('=')[1]) / 1e6 / duracao)); });
    p.stderr.on('data', (d) => { erro = (erro + d).slice(-1500); });
    p.on('error', (e) => falha(httpError(500, e.code === 'ENOENT' ? 'O FFmpeg não está instalado neste servidor.' : e.message)));
    p.on('close', (code) => (code === 0 ? ok() : falha(httpError(500, `Falha ao montar o vídeo: ${erro.split('\n').filter(Boolean).slice(-2).join(' ')}`))));
  });
}

/* ---------------- Fila (um vídeo por vez) ---------------- */
const jobs = new Map();
let fila = Promise.resolve();

function limparAntigos() {
  const d = dirVideos();
  if (!fs.existsSync(d)) return;
  for (const f of fs.readdirSync(d)) { const p = path.join(d, f); try { if (Date.now() - fs.statSync(p).mtimeMs > 6 * 3600e3) fs.rmSync(p, { recursive: true, force: true }); } catch { /* segue */ } }
  for (const [id, j] of jobs) if (Date.now() - j.criado > 6 * 3600e3) jobs.delete(id);
}

/**
 * Agenda a geração. b: { fotos:[{file, legenda}], whatsapp, titulo, sub, musica:{tipo:'padrao'|'loja'|'upload', id|file, inicio}, salvar_musica, nome_musica }
 * upload: { path, originalname } do arquivo de música enviado (multer).
 */
function gerar(user, vehicleId, b = {}, upload = null) {
  const v = V.findVehicle(user.storeId, vehicleId);
  if (!v) throw httpError(404, 'Veículo não encontrado.');
  const daLoja = new Set(V.photosOf(v.id).map((p) => p.filename));
  const fotos = (Array.isArray(b.fotos) ? b.fotos : []).filter((f) => daLoja.has(f?.file)).slice(0, 8).map((f) => ({ file: f.file, legenda: str(f.legenda, 40) }));
  if (fotos.length < 2) throw httpError(400, 'Escolha pelo menos 2 fotos.');
  const m = b.musica || {};
  let audio;
  if (m.tipo === 'upload') { if (!upload?.path) throw httpError(400, 'Envie o arquivo da música.'); audio = { arquivo: upload.path, inicio: Math.max(0, Number(m.inicio) || 0) }; }
  else if (m.tipo === 'loja') { const x = musicasDaLoja(user.storeId).find((y) => y.file === m.file); if (!x) throw httpError(404, 'Música da loja não encontrada.'); audio = { media: x.file, inicio: Math.max(0, Number(m.inicio) || 0) }; }
  else { const x = MUSICAS.find((y) => y.id === m.id) || MUSICAS[0]; audio = { arquivo: musicaPadrao(x.id), inicio: Math.max(0, Math.min(15, Number(m.inicio) || 0)) }; }
  limparAntigos();
  const id = crypto.randomBytes(8).toString('hex');
  const job = { id, storeId: user.storeId, vehicleId: v.id, status: 'na_fila', progresso: 0, etapa: 'Na fila', erro: '', criado: Date.now(), arquivo: null, nome: `${[v.marca, v.modelo, v.ano_modelo].filter(Boolean).join('-')}`.toLowerCase().normalize('NFD').replace(/[^a-z0-9-]+/g, '-') };
  jobs.set(id, job);
  fila = fila.then(() => montar(user, v, job, { ...b, fotos }, audio, upload)).catch(() => {});
  return publico(job);
}

async function montar(user, v, job, b, audio, upload) {
  const dir = path.join(dirVideos(), job.id);
  try {
    job.status = 'gerando'; job.etapa = 'Preparando as fotos';
    fs.mkdirSync(dir, { recursive: true });
    const store = get('SELECT * FROM stores WHERE id = ?', job.storeId);
    const arquivos = [];
    for (const [i, f] of b.fotos.entries()) {
      const src = await storage.ensureLocal(f.file);
      if (!src) continue;
      const dest = path.join(dir, `t${i}.jpg`);
      await telaFoto(src, { titulo: i === 0 ? str(b.titulo, 40) : '', sub: i === 0 ? str(b.sub, 50) : '', legenda: f.legenda }, dest);
      arquivos.push(dest); job.progresso = 0.15 * (i + 1) / b.fotos.length;
    }
    if (arquivos.length < 2) throw httpError(400, 'Não consegui ler as fotos escolhidas.');
    const final = path.join(dir, 'final.jpg');
    await telaFinal(store, v, { whatsapp: str(b.whatsapp, 20), fundo: await storage.ensureLocal(b.fotos[0].file) }, final);
    job.progresso = 0.2;

    // Música: trecho de 15 s a partir do início escolhido (o arquivo enviado pode virar música da loja: 30 s em m4a).
    let musica = audio.arquivo;
    if (audio.media) musica = await storage.ensureLocal(audio.media);
    if (!musica) throw httpError(404, 'Não encontrei o arquivo da música.');
    if (upload && b.salvar_musica) {
      const nome = `${crypto.randomBytes(16).toString('hex')}.m4a`;
      const destino = path.join(config.dataDir, 'media', nome);
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      await ffmpeg(['-y', '-ss', String(audio.inicio), '-t', '30', '-i', musica, '-vn', '-ac', '2', '-c:a', 'aac', '-b:a', '128k', '-af', 'afade=t=in:d=0.3', destino]);
      await storage.saveMedia(nome).catch((e) => console.error('música da loja', e.message));
      gravarMusicas(job.storeId, [{ file: nome, nome: str(b.nome_musica || upload.originalname || 'Música da loja', 60).replace(/\.\w+$/, ''), em: new Date().toISOString() }, ...musicasDaLoja(job.storeId)]);
    }

    // Tempo de cada tela: o cartão final fica 3,5 s; as fotos dividem o resto (com as transições).
    job.etapa = 'Montando o vídeo';
    const n = arquivos.length; const fimD = 3.5;
    const d = (DUR + 0.2 - fimD + n * X) / n;
    const telas = [...arquivos, final]; const durs = [...Array(n).fill(d), fimD];
    const TRANS = ['fade', 'slideleft', 'fade', 'slideleft', 'fade', 'slideleft', 'fade', 'slideleft'];
    const args = ['-y'];
    telas.forEach((t, i) => args.push('-loop', '1', '-t', durs[i].toFixed(3), '-i', t));
    args.push('-ss', String(audio.inicio), '-i', musica);
    const f = telas.map((_, i) => {
      const fr = Math.round(durs[i] * FPS); const passo = ((i === n ? 0.02 : 0.06) / fr).toFixed(6);
      return `[${i}:v]zoompan=z='1+${passo}*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${fr}:s=${OUT_W}x${OUT_H}:fps=${FPS},setsar=1,format=yuv420p[v${i}]`;
    });
    let prev = 'v0'; let acc = durs[0];
    for (let i = 1; i < telas.length; i++) {
      f.push(`[${prev}][v${i}]xfade=transition=${i === telas.length - 1 ? 'circleopen' : TRANS[i - 1]}:duration=${X}:offset=${(acc - X).toFixed(3)}[x${i}]`);
      prev = `x${i}`; acc += durs[i] - X;
    }
    f.push(`[${telas.length}:a]aformat=channel_layouts=stereo,apad,afade=t=in:d=0.3,afade=t=out:st=${DUR - 1.4}:d=1.4[a]`);
    const saida = path.join(dir, 'video.mp4');
    args.push('-filter_complex', f.join(';'), '-map', `[${prev}]`, '-map', '[a]', '-t', String(DUR),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-threads', '1', '-filter_complex_threads', '1',
      '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', saida);
    await ffmpeg(args, { duracao: DUR, aoProgresso: (p) => { job.progresso = 0.2 + p * 0.8; } });
    job.arquivo = saida; job.status = 'pronto'; job.progresso = 1; job.etapa = 'Pronto';
    logEvent(job.storeId, `Vídeo gerado: ${[v.marca, v.modelo, v.ano_modelo].filter(Boolean).join(' ')} (${user.name || 'usuário'})`);
  } catch (e) {
    job.status = 'erro'; job.erro = e.message; job.etapa = 'Erro';
    console.error('vídeo', job.id, e.message);
  } finally {
    for (const x of fs.existsSync(dir) ? fs.readdirSync(dir) : []) if (x !== 'video.mp4') fs.rm(path.join(dir, x), () => {});
    if (upload?.path) fs.rm(upload.path, () => {});
  }
}

const publico = (j) => ({ id: j.id, status: j.status, progresso: Math.round(j.progresso * 100), etapa: j.etapa, erro: j.erro, url: j.status === 'pronto' ? `/api/videos/${j.id}/arquivo` : null });
function situacao(user, id) {
  const j = jobs.get(String(id));
  if (!j || j.storeId !== user.storeId) throw httpError(404, 'Vídeo não encontrado (o servidor pode ter reiniciado). Gere de novo.');
  return { ...publico(j), posicao: j.status === 'na_fila' ? [...jobs.values()].filter((x) => x.status === 'na_fila' && x.criado < j.criado).length + 1 : 0 };
}
function arquivo(user, id) {
  const j = jobs.get(String(id));
  if (!j || j.storeId !== user.storeId || !j.arquivo || !fs.existsSync(j.arquivo)) throw httpError(404, 'Vídeo não encontrado. Gere de novo.');
  return { path: j.arquivo, nome: `${j.nome || 'video'}.mp4` };
}

function register(app, { team, wrap }) {
  const multer = require('multer');
  const up = multer({ dest: path.join(require('node:os').tmpdir(), 'giro-musicas'), limits: { fileSize: 25 * 1024 * 1024, files: 1 } }).single('musica');
  app.get('/musicas/:id.m4a', (req, res) => {
    const m = MUSICAS.find((x) => x.id === req.params.id);
    if (!m) return res.status(404).end();
    res.setHeader('Cache-Control', 'public, max-age=604800'); res.type('audio/mp4').sendFile(musicaPadrao(m.id));
  });
  app.get('/api/vehicles/:id/video', team.can('publicar'), (req, res) => {
    const v = V.findVehicle(req.user.storeId, req.params.id);
    if (!v) throw httpError(404, 'Veículo não encontrado.');
    res.json(padrao(req.user.storeId, v));
  });
  app.post('/api/vehicles/:id/video', team.can('publicar'), up, (req, res) => {
    let b = req.body || {};
    if (typeof b.dados === 'string') { try { b = JSON.parse(b.dados); } catch { throw httpError(400, 'Dados do vídeo inválidos.'); } }
    if (req.file && !/^audio\/|video\/mp4|application\/octet-stream/.test(req.file.mimetype)) { fs.rm(req.file.path, () => {}); throw httpError(400, 'Envie um arquivo de áudio (MP3, M4A, WAV…).'); }
    res.status(202).json(gerar(req.user, req.params.id, b, req.file ? { path: req.file.path, originalname: req.file.originalname } : null));
  });
  app.get('/api/videos/:job', team.can('publicar'), (req, res) => res.json(situacao(req.user, req.params.job)));
  app.get('/api/videos/:job/arquivo', team.can('publicar'), (req, res) => {
    const a = arquivo(req.user, req.params.job);
    if (req.query.baixar) res.attachment(a.nome);
    res.type('video/mp4').sendFile(a.path);
  });
  app.delete('/api/videos/musicas/:file', team.can('publicar'), wrap(async (req, res) => { await removerMusica(req.user.storeId, req.params.file); res.json(biblioteca(req.user.storeId)); }));
}

module.exports = { register, gerar, situacao, arquivo, padrao, biblioteca, MUSICAS };
