// GiroAuto Fotos (v2.16): ensaios fotográficos com IA e artes com as informações do veículo.
// Usa o banco, o armazenamento de fotos (Supabase) e a chave de IA do próprio GiroAuto.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const config = require('../config');
const storage = require('../storage');
const settings = require('../settings');
const { get, all, run } = require('../db');
const card = require('../arts/card');
const M = require('./modelos');
const V = require('./veiculo');
const ia = require('./ia');

const erro = (status, msg) => Object.assign(new Error(msg), { status });
const MAX_ORIGINAIS = 20;
const FORMATOS_ARTE = ['4:5', '9:16'];

/* ---------------- Configuração (administrador da plataforma) ---------------- */
// A IA (provedor, chave e modelo) é a mesma de Configurações > Imagens com IA. Aqui ficam só os limites.
const CFG_PADRAO = { limiteDiario: 120, simultaneas: 2, verificar: true };
function cfg() {
  let c = {};
  try { c = JSON.parse(get("SELECT value FROM settings WHERE key = 'fotos_cfg'")?.value || '{}'); } catch { c = {}; }
  return { ...CFG_PADRAO, ...c };
}
function salvarCfg(b) {
  const c = cfg();
  if (b.limiteDiario !== undefined) c.limiteDiario = Math.max(0, Math.min(5000, Number(b.limiteDiario) || 0));
  if (b.simultaneas !== undefined) c.simultaneas = Math.max(1, Math.min(4, Number(b.simultaneas) || 1));
  if (b.verificar !== undefined) c.verificar = !!b.verificar;
  run(`INSERT INTO settings (key, value) VALUES ('fotos_cfg', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`, JSON.stringify(c));
  return c;
}

// Provedor efetivo: FOTOS_IA=simulado (testes) ou o de Configurações > Imagens com IA.
function provedor() {
  if (process.env.FOTOS_IA === 'simulado') return { nome: 'simulado' };
  if (process.env.FOTOS_IA === 'sem-cota') return { nome: 'simulado', semCota: true }; // testes: a IA responde "cota esgotada"
  const a = settings.ai();
  if (a.provider === 'gemini') return { nome: 'gemini', chave: a.gemini.key, modelo: a.gemini.model };
  if (a.provider === 'pollinations') return { nome: 'pollinations', chave: a.pollinations.key, modelo: a.pollinations.model };
  return { nome: 'manual' };
}
function faltaIa() {
  const p = provedor();
  if ((p.nome === 'gemini' || p.nome === 'pollinations') && !p.chave) return 'Falta a chave da IA de imagens. O administrador cadastra em Configurações > Imagens com IA.';
  return '';
}
const NOMES_IA = { gemini: 'Google Gemini', pollinations: 'Pollinations', manual: 'manual (você gera no ChatGPT ou no Gemini e envia a imagem)', simulado: 'simulada (teste)' };

/* ---------------- Arquivos (mesmo armazenamento das fotos dos carros) ---------------- */
const mediaDir = () => path.join(config.dataDir, 'media');
async function salvar(buffer) {
  const nome = crypto.randomBytes(16).toString('hex') + '.jpg';
  fs.mkdirSync(mediaDir(), { recursive: true });
  fs.writeFileSync(path.join(mediaDir(), nome), buffer);
  await storage.saveMedia(nome);
  return nome;
}
async function ler(nome) {
  if (!nome) return null;
  const f = await storage.ensureLocal(nome).catch(() => null);
  return f ? fs.readFileSync(f) : null;
}
function apagar(nomes) {
  const lista = (Array.isArray(nomes) ? nomes : [nomes]).filter((n) => n && storage.SAFE.test(n));
  if (!lista.length) return;
  // Não apaga um arquivo que ainda é foto de algum carro (ex.: foto copiada do estoque).
  const emUso = new Set(all(`SELECT filename FROM photos WHERE filename IN (${lista.map(() => '?').join(',')})`, ...lista).map((r) => r.filename));
  const livres = lista.filter((n) => !emUso.has(n));
  livres.forEach((n) => fs.rm(path.join(mediaDir(), n), { force: true }, () => {}));
  storage.removeMedia(livres).catch(() => {});
}
const url = (nome) => (nome ? `/media/${nome}` : '');

async function prepararFoto(buffer, lado = 2048) {
  try {
    const img = sharp(buffer, { failOn: 'none' }).rotate();
    const meta = await img.metadata();
    if (!meta.width || !meta.height) throw new Error();
    const out = await img.resize(lado, lado, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
    return { buffer: out.data, largura: out.info.width, altura: out.info.height };
  } catch { throw erro(400, 'Não foi possível ler a imagem. Envie JPG, PNG ou WEBP.'); }
}

/* ---------------- Leitura ---------------- */
const J = (x, d = {}) => { try { return JSON.parse(x || '') ?? d; } catch { return d; } };
function linha(e) { return e && { ...e, veiculo: J(e.veiculo), loja: J(e.loja), personalizado: J(e.personalizado), novos_angulos: !!e.novos_angulos, arte: !!e.arte }; }

function doEspaco(id, espacos) {
  const e = linha(get('SELECT * FROM fotos_ensaios WHERE id = ?', Number(id)));
  if (!e || !espacos.includes(e.espaco)) throw erro(404, 'Ensaio não encontrado.');
  return e;
}

function detalhe(id, espacos) {
  const e = doEspaco(id, espacos);
  const originais = all('SELECT * FROM fotos_originais WHERE ensaio_id = ? ORDER BY ordem, id', e.id);
  const geradas = all('SELECT * FROM fotos_geradas WHERE ensaio_id = ? ORDER BY ordem, id', e.id);
  const artes = all('SELECT * FROM fotos_artes WHERE ensaio_id = ? ORDER BY formato', e.id);
  const nomesAng = Object.fromEntries(M.ANGULOS_NOVOS.map((a) => [a.id, a.nome]));
  return {
    ...e, modelo_nome: M.doId(e.modelo)?.nome || e.modelo, titulo: V.titulo(e.veiculo),
    personalizado: { texto: e.personalizado.texto || '', referencia: url(e.personalizado.referencia) },
    originais: originais.map((o) => ({ id: o.id, ordem: o.ordem, tipo: o.tipo, url: url(o.arquivo) })),
    geradas: geradas.map((g) => ({
      id: g.id, ordem: g.ordem, original_id: g.original_id, angulo: g.angulo, angulo_nome: nomesAng[g.angulo] || '',
      variacao: g.variacao, instrucao: g.instrucao, status: g.status, erro: g.erro, fidelidade: J(g.fidelidade, null), url: url(g.arquivo),
      prompt_pt: g.status === 'manual' || g.status === 'erro' ? M.promptPt({ ensaio: e, variacao: g.variacao, instrucao: g.instrucao, angulo: g.angulo }) : '',
    })),
    artes: artes.map((a) => ({ formato: a.formato, status: a.status, erro: a.erro, url: url(a.arquivo) })),
  };
}

function listar(espacos) {
  if (!espacos.length) return [];
  const rows = all(`SELECT e.*,
      (SELECT g.arquivo FROM fotos_geradas g WHERE g.ensaio_id = e.id AND g.arquivo IS NOT NULL AND g.status IN ('aprovada','pronta') ORDER BY g.status = 'aprovada' DESC, g.ordem LIMIT 1) AS capa,
      (SELECT o.arquivo FROM fotos_originais o WHERE o.ensaio_id = e.id ORDER BY o.ordem LIMIT 1) AS capa_original,
      (SELECT count(*) FROM fotos_geradas g WHERE g.ensaio_id = e.id AND g.status IN ('pronta','aprovada')) AS prontas,
      (SELECT count(*) FROM fotos_geradas g WHERE g.ensaio_id = e.id AND g.status = 'aprovada') AS aprovadas
    FROM fotos_ensaios e WHERE e.espaco IN (${espacos.map(() => '?').join(',')}) ORDER BY e.id DESC LIMIT 200`, ...espacos);
  return rows.map((r) => {
    const v = J(r.veiculo);
    return {
      id: r.id, espaco: r.espaco, origem: r.origem, titulo: V.titulo(v), placa: v.placa || '', modelo: r.modelo,
      modelo_nome: M.doId(r.modelo)?.nome || r.modelo, quantidade: r.quantidade, status: r.status,
      prontas: r.prontas, aprovadas: r.aprovadas, criado_em: r.created_at, criado_por: r.criado_por, capa: url(r.capa || r.capa_original),
    };
  });
}

/* ---------------- Criação e edição ---------------- */
function opcoes(b, atual = {}) {
  const o = {};
  if (b.modelo !== undefined) { if (!M.doId(b.modelo)) throw erro(400, 'Escolha um modelo de ensaio.'); o.modelo = b.modelo; }
  if (b.quantidade !== undefined) { const n = Number(b.quantidade); if (![7, 8, 9, 10].includes(n)) throw erro(400, 'A quantidade deve ser 7, 8, 9 ou 10 fotos.'); o.quantidade = n; }
  if (b.formato !== undefined) { if (!M.FORMATOS[b.formato]) throw erro(400, 'Formato inválido.'); o.formato = b.formato; }
  if (b.resolucao !== undefined) o.resolucao = b.resolucao === '2K' ? '2K' : '1K';
  if (b.placa_modo !== undefined) { if (!M.PLACA[b.placa_modo]) throw erro(400, 'Opção de placa inválida.'); o.placa_modo = b.placa_modo; }
  if (b.novos_angulos !== undefined) o.novos_angulos = b.novos_angulos ? 1 : 0;
  if (b.arte !== undefined) o.arte = b.arte ? 1 : 0;
  if (b.provedor !== undefined) o.provedor = b.provedor === 'manual' ? 'manual' : '';
  if (b.veiculo !== undefined) o.veiculo = JSON.stringify(V.limpar({ ...(atual.veiculo || {}), ...b.veiculo }));
  if (b.loja !== undefined) o.loja = JSON.stringify({ nome: String(b.loja.nome || '').slice(0, 40), whatsapp: String(b.loja.whatsapp || '').slice(0, 30), cidade: String(b.loja.cidade || '').slice(0, 40) });
  if (b.personalizado_texto !== undefined) o.personalizado = JSON.stringify({ ...(atual.personalizado || {}), texto: String(b.personalizado_texto || '').slice(0, 500) });
  return o;
}

function criar({ espaco, origem, origem_id, veiculo, loja, criado_por }) {
  if (!['loja', 'repasse', 'avulso'].includes(origem)) throw erro(400, 'Origem inválida.');
  const o = opcoes({ veiculo: veiculo || {}, loja: loja || {} });
  return Number(run(`INSERT INTO fotos_ensaios (espaco, origem, origem_id, veiculo, loja, criado_por) VALUES (?,?,?,?,?,?)`,
    espaco, origem, origem_id ? String(origem_id) : null, o.veiculo, o.loja, String(criado_por || '').slice(0, 80)).lastInsertRowid);
}

function atualizar(id, espacos, b) {
  const e = doEspaco(id, espacos);
  const o = opcoes(b, e);
  const cols = Object.keys(o);
  if (cols.length) run(`UPDATE fotos_ensaios SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`, ...cols.map((c) => o[c]), e.id);
  if ((o.veiculo || o.loja) && e.status === 'pronto' && e.arte) agendarArtes(e.id);
}

async function adicionarOriginais(id, espacos, buffers) {
  const e = doEspaco(id, espacos);
  const n = get('SELECT count(*) AS n FROM fotos_originais WHERE ensaio_id = ?', e.id).n;
  if (n + buffers.length > MAX_ORIGINAIS) throw erro(400, `Limite de ${MAX_ORIGINAIS} fotos originais por ensaio.`);
  let ordem = n;
  for (const b of buffers) {
    const f = await prepararFoto(b);
    const arquivo = await salvar(f.buffer);
    run('INSERT INTO fotos_originais (ensaio_id, ordem, arquivo, largura, altura) VALUES (?,?,?,?,?)', e.id, ordem++, arquivo, f.largura, f.altura);
  }
  run("UPDATE fotos_ensaios SET updated_at = datetime('now') WHERE id = ?", e.id);
}

function editarOriginal(id, espacos, oid, { tipo, ordem }) {
  const e = doEspaco(id, espacos);
  if (tipo !== undefined) { if (!M.TIPOS[tipo]) throw erro(400, 'Tipo inválido.'); run('UPDATE fotos_originais SET tipo = ? WHERE id = ? AND ensaio_id = ?', tipo, Number(oid), e.id); }
  if (ordem === 0) {
    run('UPDATE fotos_originais SET ordem = ordem + 1 WHERE ensaio_id = ?', e.id);
    run('UPDATE fotos_originais SET ordem = 0 WHERE id = ? AND ensaio_id = ?', Number(oid), e.id);
  }
}

function apagarOriginal(id, espacos, oid) {
  const e = doEspaco(id, espacos);
  const o = get('SELECT arquivo FROM fotos_originais WHERE id = ? AND ensaio_id = ?', Number(oid), e.id);
  if (!o) return;
  run('DELETE FROM fotos_originais WHERE id = ?', Number(oid));
  run('UPDATE fotos_geradas SET original_id = NULL WHERE original_id = ?', Number(oid));
  apagar(o.arquivo);
}

async function definirReferencia(id, espacos, buffer) {
  const e = doEspaco(id, espacos);
  const arquivo = await salvar((await prepararFoto(buffer, 1536)).buffer);
  const antigo = e.personalizado.referencia;
  run("UPDATE fotos_ensaios SET personalizado = ?, updated_at = datetime('now') WHERE id = ?", JSON.stringify({ ...e.personalizado, referencia: arquivo }), e.id);
  if (antigo) apagar(antigo);
}

/* ---------------- Geração ---------------- */
function iniciar(id, espacos) {
  const e = doEspaco(id, espacos);
  const originais = all('SELECT id, tipo FROM fotos_originais WHERE ensaio_id = ? ORDER BY ordem, id', e.id);
  if (!originais.length) throw erro(400, 'Envie ao menos uma foto do veículo.');
  if (e.modelo === 'P' && !e.personalizado.texto && !e.personalizado.referencia) throw erro(400, 'No modelo personalizado, descreva o cenário ou envie uma foto de referência.');
  // 'manual' no ensaio = grátis pelo app do Gemini (ou ChatGPT): o GiroAuto prepara o texto e a foto, a pessoa gera e envia.
  const p = e.provedor === 'manual' ? 'manual' : provedor().nome;
  const falta = p === 'manual' ? '' : faltaIa();
  if (falta) throw erro(400, `${falta} Ou escolha "Grátis pelo app do Gemini" em Como gerar.`);
  const velhas = [...all('SELECT arquivo FROM fotos_geradas WHERE ensaio_id = ?', e.id), ...all('SELECT arquivo FROM fotos_artes WHERE ensaio_id = ?', e.id)].map((r) => r.arquivo);
  run('DELETE FROM fotos_geradas WHERE ensaio_id = ?', e.id);
  run('DELETE FROM fotos_artes WHERE ensaio_id = ?', e.id);
  apagar(velhas);
  const st = p === 'manual' ? 'manual' : 'pendente';
  for (const x of M.plano(originais, e.quantidade, e.novos_angulos)) {
    run('INSERT INTO fotos_geradas (ensaio_id, ordem, original_id, angulo, variacao, status) VALUES (?,?,?,?,?,?)', e.id, x.ordem, x.original_id, x.angulo, x.variacao, st);
  }
  run("UPDATE fotos_ensaios SET status = ?, updated_at = datetime('now') WHERE id = ?", p === 'manual' ? 'manual' : 'gerando', e.id);
  fila.acordar();
}

function refazer(id, espacos, gid, instrucao = '') {
  const e = doEspaco(id, espacos);
  const manual = e.provedor === 'manual' || provedor().nome === 'manual';
  const r = run(`UPDATE fotos_geradas SET status = ?, instrucao = ?, erro = '', fidelidade = NULL, updated_at = datetime('now') WHERE id = ? AND ensaio_id = ? AND status <> 'gerando'`,
    manual ? 'manual' : 'pendente', String(instrucao || '').slice(0, 300), Number(gid), e.id);
  if (!r.changes) throw erro(409, 'Esta foto já está sendo gerada.');
  run("UPDATE fotos_ensaios SET status = ?, updated_at = datetime('now') WHERE id = ?", manual ? 'manual' : 'gerando', e.id);
  fila.acordar();
}

function marcar(id, espacos, gid, status) {
  const e = doEspaco(id, espacos);
  if (!['aprovada', 'descartada', 'pronta'].includes(status)) throw erro(400, 'Situação inválida.');
  const r = run(`UPDATE fotos_geradas SET status = ?, updated_at = datetime('now') WHERE id = ? AND ensaio_id = ? AND arquivo IS NOT NULL AND status IN ('pronta','aprovada','descartada')`, status, Number(gid), e.id);
  if (!r.changes) throw erro(409, 'A foto ainda não está pronta.');
  if (e.arte && e.status === 'pronto') agendarArtes(e.id);
}

async function enviarManual(id, espacos, gid, buffer) {
  const e = doEspaco(id, espacos);
  const g = get('SELECT arquivo FROM fotos_geradas WHERE id = ? AND ensaio_id = ?', Number(gid), e.id);
  if (!g) throw erro(404, 'Foto não encontrada.');
  const f = M.FORMATOS[e.formato] || M.FORMATOS['4:5'];
  const arquivo = await salvar(await card.normalizar((await prepararFoto(buffer, 2400)).buffer, f.w, f.h));
  run(`UPDATE fotos_geradas SET arquivo = ?, status = 'pronta', erro = '', modelo_ia = 'manual', updated_at = datetime('now') WHERE id = ?`, arquivo, Number(gid));
  if (g.arquivo) apagar(g.arquivo);
  concluirSeTerminou(e.id);
}

function contarUso(espaco) {
  const dia = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); // dia em Brasília
  run('INSERT INTO fotos_uso (dia, espaco, imagens) VALUES (?, ?, 1) ON CONFLICT(dia, espaco) DO UPDATE SET imagens = imagens + 1', dia, espaco);
  return get('SELECT imagens FROM fotos_uso WHERE dia = ? AND espaco = ?', dia, espaco).imagens;
}

async function gerarUma(g) {
  const e = linha(get('SELECT * FROM fotos_ensaios WHERE id = ?', g.ensaio_id));
  if (!e) return;
  const p = provedor();
  const c = cfg();
  const falhar = (msg) => run(`UPDATE fotos_geradas SET status = 'erro', erro = ?, updated_at = datetime('now') WHERE id = ?`, String(msg).slice(0, 300), g.id);
  try {
    if (p.nome === 'manual') return falhar('Modo manual: gere a imagem no ChatGPT ou no Gemini e envie aqui.');
    if (c.limiteDiario && p.nome !== 'simulado' && contarUso(e.espaco) > c.limiteDiario) return falhar(`Limite de ${c.limiteDiario} imagens por dia atingido. Continue amanhã.`);
    const originais = all('SELECT * FROM fotos_originais WHERE ensaio_id = ? ORDER BY ordem, id', e.id);
    const o = originais.find((x) => x.id === g.original_id) || originais[0];
    if (!o) return falhar('As fotos originais foram apagadas. Envie fotos e gere de novo.');
    const base = (await prepararFoto(await ler(o.arquivo), 1536)).buffer;
    const f = M.FORMATOS[e.formato] || M.FORMATOS['4:5'];
    const referencia = e.modelo === 'P' && e.personalizado.referencia ? await ler(e.personalizado.referencia) : null;
    let prompt; let fotos;
    if (g.angulo) {
      // Ângulo novo: a IA recebe as fotos reais (até 4, capa primeiro) como referência do carro.
      fotos = [];
      for (const x of originais.slice(0, 4)) { const b = await ler(x.arquivo); if (b) fotos.push((await prepararFoto(b, 1280)).buffer); }
      prompt = M.promptNovoAngulo({ ensaio: e, angulo: g.angulo, variacao: g.variacao, instrucao: g.instrucao, nRef: fotos.length });
    } else {
      fotos = [base];
      prompt = M.prompt({ ensaio: e, variacao: g.variacao, tipo: o.tipo, instrucao: g.instrucao });
    }
    let r;
    if (p.nome === 'gemini') r = await ia.geminiEditar({ chave: p.chave, modelo: p.modelo, fotos, referencia, prompt, formato: e.formato, resolucao: e.resolucao });
    else if (p.nome === 'pollinations') r = await ia.pollinationsEditar({ chave: p.chave, modelo: p.modelo, foto: fotos[0], prompt });
    else if (p.semCota) throw new ia.IAErro('Quota exceeded for this project.', 429);
    else r = await ia.simuladoEditar({ foto: fotos[0], cores: M.doId(e.modelo)?.cores, w: f.w, h: f.h, rotulo: `${e.modelo} · ${g.ordem}${g.angulo ? ' · ' + g.angulo : ''}` });
    const k = e.resolucao === '2K' ? 2 : 1;
    const jpg = await card.normalizar(r.imagem, f.w * k, f.h * k);
    const arquivo = await salvar(jpg);
    const ok = run(`UPDATE fotos_geradas SET arquivo = ?, status = 'pronta', erro = '', modelo_ia = ?, tentativas = tentativas + 1, updated_at = datetime('now') WHERE id = ? AND status = 'gerando'`, arquivo, r.modelo, g.id);
    if (!ok.changes) { apagar(arquivo); return; }
    if (g.arquivo) apagar(g.arquivo);
    // Nota de fidelidade (não bloqueia; só marca para conferir).
    const chaveTexto = settings.chatAi().key;
    if (c.verificar && p.nome !== 'simulado' && (chaveTexto || process.env.ANTHROPIC_API_KEY)) {
      try {
        const v = await ia.verificar({ original: base, gerada: jpg, geminiKey: chaveTexto, anthropicKey: process.env.ANTHROPIC_API_KEY });
        if (v) run('UPDATE fotos_geradas SET fidelidade = ? WHERE id = ?', JSON.stringify(v), g.id);
      } catch (err) { console.error('Fotos (fidelidade):', err.message); }
    }
  } catch (err) {
    console.error(`Fotos ${g.id}:`, err.message);
    const msg = ia.amigavel(err, p.nome);
    // Cota ou crédito da IA acabou: em vez de erro, a foto (e as que estão na fila) passam para o modo grátis pelo app.
    if (semCota(err, msg)) {
      const aviso = `${msg} Termine grátis pelo app do Gemini: copie o texto, gere lá e envie a imagem aqui.`;
      run(`UPDATE fotos_geradas SET status = 'manual', erro = ?, updated_at = datetime('now') WHERE ensaio_id = ? AND (id = ? OR status = 'pendente')`, aviso.slice(0, 300), g.ensaio_id, g.id);
      return;
    }
    falhar(msg);
  }
}

const semCota = (err, msg) => [402, 429].includes(err?.status) || /cota|limite|quota|billing|faturamento|pollen|insufficient|exhausted/i.test(`${err?.message} ${msg}`);

function concluirSeTerminou(ensaioId) {
  const r = get(`SELECT sum(status IN ('pendente','gerando')) AS fila, sum(status = 'manual') AS manual,
      sum(arquivo IS NOT NULL AND status IN ('pronta','aprovada')) AS ok FROM fotos_geradas WHERE ensaio_id = ?`, ensaioId);
  if (r.fila) return;
  const status = r.manual ? 'manual' : r.ok ? 'pronto' : 'erro';
  run("UPDATE fotos_ensaios SET status = ?, updated_at = datetime('now') WHERE id = ?", status, ensaioId);
  const e = get('SELECT arte FROM fotos_ensaios WHERE id = ?', ensaioId);
  if (status === 'pronto' && e?.arte) agendarArtes(ensaioId);
}

const fila = {
  rodando: 0,
  pegar() {
    const g = get(`SELECT * FROM fotos_geradas WHERE status = 'pendente' ORDER BY ensaio_id, ordem LIMIT 1`);
    if (!g) return null;
    const r = run(`UPDATE fotos_geradas SET status = 'gerando', updated_at = datetime('now') WHERE id = ? AND status = 'pendente'`, g.id);
    return r.changes ? g : this.pegar();
  },
  acordar() {
    const max = cfg().simultaneas || 2;
    for (let i = this.rodando; i < max; i++) {
      this.rodando++;
      (async () => {
        await null; // libera o laço antes de começar (pegar() é síncrono)
        try { for (let g = this.pegar(); g; g = this.pegar()) { await gerarUma(g); concluirSeTerminou(g.ensaio_id); } }
        catch (e) { console.error('Fotos (fila):', e.message); }
        finally { this.rodando--; }
      })();
    }
  },
  async ocioso(ms = 60000) {
    const fim = Date.now() + ms;
    while (Date.now() < fim) {
      if (!get("SELECT 1 FROM fotos_geradas WHERE status IN ('pendente','gerando')") && !this.rodando && !artesRodando.size) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  },
};

/* ---------------- Artes com as informações ---------------- */
const artesRodando = new Set();
function agendarArtes(ensaioId) {
  if (artesRodando.has(ensaioId)) { artesRodando.add(`${ensaioId}+`); return; }
  artesRodando.add(ensaioId);
  setTimeout(async () => {
    try { do { artesRodando.delete(`${ensaioId}+`); await gerarArtes(ensaioId); } while (artesRodando.has(`${ensaioId}+`)); }
    catch (e) { console.error('Fotos (artes):', e.message); }
    finally { artesRodando.delete(ensaioId); }
  }, 300);
}

// Capa = primeira aprovada; miniaturas de ângulos diferentes quando possível.
function fotosParaArte(ensaioId) {
  const gs = all(`SELECT arquivo, original_id, angulo FROM fotos_geradas WHERE ensaio_id = ? AND arquivo IS NOT NULL AND status IN ('aprovada','pronta') ORDER BY status = 'aprovada' DESC, ordem`, ensaioId);
  const vistos = new Set(); const a = []; const b = [];
  for (const g of gs) { const k = g.angulo || `o${g.original_id}`; (vistos.has(k) ? b : a).push(g); vistos.add(k); }
  return [...a, ...b].slice(0, 4).map((g) => g.arquivo);
}

async function gerarArtes(ensaioId) {
  const e = linha(get('SELECT * FROM fotos_ensaios WHERE id = ?', ensaioId));
  if (!e) return;
  const imgs = (await Promise.all(fotosParaArte(ensaioId).map(ler))).filter(Boolean);
  if (!imgs.length) return;
  const loja = { name: e.loja.nome, whatsapp: e.loja.whatsapp, city: e.loja.cidade };
  for (const formato of FORMATOS_ARTE) {
    const atual = get('SELECT arquivo FROM fotos_artes WHERE ensaio_id = ? AND formato = ?', ensaioId, formato);
    run(`INSERT INTO fotos_artes (ensaio_id, formato, status) VALUES (?, ?, 'gerando') ON CONFLICT(ensaio_id, formato) DO UPDATE SET status = 'gerando', erro = ''`, ensaioId, formato);
    try {
      const arquivo = await salvar(await card.renderCard(e.veiculo, imgs, loja, formato));
      run(`UPDATE fotos_artes SET arquivo = ?, status = 'pronta', erro = '', updated_at = datetime('now') WHERE ensaio_id = ? AND formato = ?`, arquivo, ensaioId, formato);
      if (atual?.arquivo) apagar(atual.arquivo);
    } catch (err) {
      run(`UPDATE fotos_artes SET status = 'erro', erro = ? WHERE ensaio_id = ? AND formato = ?`, String(err.message).slice(0, 300), ensaioId, formato);
    }
  }
}

function refazerArtes(id, espacos) {
  const e = doEspaco(id, espacos);
  if (!fotosParaArte(e.id).length) throw erro(400, 'Gere ou aprove fotos antes de montar a arte.');
  agendarArtes(e.id);
}

/* ---------------- Pacote ---------------- */
function textoAnuncio(e) {
  const v = e.veiculo || {};
  const brl = (n) => 'R$ ' + Number(n).toLocaleString('pt-BR');
  const selos = V.SELOS.filter((s) => (v.destaques || []).includes(s.key)).map((s) => s.label);
  return [
    `${[v.marca, v.modelo, v.versao].filter(Boolean).join(' ')} ${[v.ano_fab, v.ano_modelo].filter(Boolean).join('/')}`.trim(),
    [v.km != null ? `${Number(v.km).toLocaleString('pt-BR')} km` : '', v.cambio, v.combustivel, v.cor, v.carroceria].filter(Boolean).join(' · '),
    v.preco ? (v.preco_oferta && v.preco_oferta < v.preco ? `De ${brl(v.preco)} por ${brl(v.preco_oferta)}` : brl(v.preco)) : 'Consulte o valor',
    selos.length ? `✅ ${selos.join(' · ')}` : '',
    [e.loja?.nome, e.loja?.whatsapp, e.loja?.cidade].filter(Boolean).join(' · '),
  ].filter(Boolean).join('\n');
}
const slug = (s) => String(s || 'veiculo').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'veiculo';

function pacote(id, espacos) {
  const e = doEspaco(id, espacos);
  let gs = all(`SELECT arquivo FROM fotos_geradas WHERE ensaio_id = ? AND status = 'aprovada' AND arquivo IS NOT NULL ORDER BY ordem`, e.id);
  if (!gs.length) gs = all(`SELECT arquivo FROM fotos_geradas WHERE ensaio_id = ? AND status = 'pronta' AND arquivo IS NOT NULL ORDER BY ordem`, e.id);
  const artes = all(`SELECT formato, arquivo FROM fotos_artes WHERE ensaio_id = ? AND arquivo IS NOT NULL`, e.id);
  return {
    ensaio: e, nome: `${slug(V.titulo(e.veiculo))}-ensaio-${e.modelo}`, texto: textoAnuncio(e),
    fotos: gs.map((g, i) => ({ nome: `fotos/${String(i + 1).padStart(2, '0')}.jpg`, arquivo: g.arquivo })),
    artes: artes.map((a) => ({ nome: `arte-${a.formato.replace(':', 'x')}.jpg`, arquivo: a.arquivo })),
  };
}

function excluir(id, espacos) {
  const e = doEspaco(id, espacos);
  const nomes = [
    ...all('SELECT arquivo FROM fotos_originais WHERE ensaio_id = ?', e.id), ...all('SELECT arquivo FROM fotos_geradas WHERE ensaio_id = ?', e.id),
    ...all('SELECT arquivo FROM fotos_artes WHERE ensaio_id = ?', e.id),
  ].map((r) => r.arquivo);
  if (e.personalizado.referencia) nomes.push(e.personalizado.referencia);
  run('DELETE FROM fotos_ensaios WHERE id = ?', e.id);
  apagar(nomes);
}

// Na inicialização: o que estava sendo gerado volta para a fila.
function retomar() {
  run(`UPDATE fotos_geradas SET status = 'pendente' WHERE status = 'gerando'`);
  run(`UPDATE fotos_artes SET status = 'erro', erro = 'Interrompida. Clique em Refazer artes.' WHERE status = 'gerando'`);
  fila.acordar();
}

module.exports = {
  cfg, salvarCfg, provedor, faltaIa, NOMES_IA, listar, detalhe, criar, atualizar, adicionarOriginais, editarOriginal, apagarOriginal,
  definirReferencia, iniciar, refazer, marcar, enviarManual, refazerArtes, pacote, excluir, retomar, fila, ler, doEspaco, prepararFoto,
};
