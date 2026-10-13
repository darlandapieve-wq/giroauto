// Busca de dados pela placa sem API paga (v2.0).
// 1) Lê a página pública do placafipe.com.br (pelo servidor ou, se o site bloquear, pela extensão no navegador da loja).
// 2) Tabela FIPE gratuita (Parallelum) para escolher Marca → Modelo → Ano quando a placa não resolver.
const { get, run } = require('./db');

// Páginas públicas de consulta por placa (a primeira que responder com dados vale).
const PLATE_URLS = () => (process.env.PLATE_URL_TEMPLATE || 'https://placafipe.com/placa/{placa},https://www.keplaca.com/placa/{placa}').split(',').map((x) => x.trim()).filter(Boolean);
const FIPE_URL = () => (process.env.FIPE_API_URL || 'https://parallelum.com.br/fipe/api/v1').replace(/\/+$/, '');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

const cleanPlate = (p) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const validPlate = (p) => /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(p);
const plateUrls = (p) => PLATE_URLS().map((u) => u.replace('{placa}', encodeURIComponent(p)));
const plateUrl = (p) => plateUrls(p)[0];

/* ---------------- Leitura do HTML ---------------- */

const decode = (s) => String(s)
  .replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/\s+/g, ' ').trim();
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

// Pares "rótulo: valor" em tabelas (td/th), listas (dt/dd) ou texto ("Marca: VW").
function pairs(html) {
  const out = {};
  const put = (k, v) => { const key = norm(k); const val = decode(v); if (key && val && !(key in out) && key.length < 40) out[key] = val; };
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => c[1]);
    if (cells.length === 2) put(decode(cells[0]).replace(/:$/, ''), cells[1]);
  }
  for (const m of html.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi)) put(decode(m[1]).replace(/:$/, ''), m[2]);
  // Texto copiado da página (sem HTML): uma informação por linha, "Marca: FORD" ou "Marca<TAB>FORD".
  if (!/<[a-z]/i.test(html)) {
    for (const line of String(html).split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-zÀ-ú /]{2,30}?)\s*(?::|\t)\s*(.+?)\s*$/);
      if (m && !/R\$/.test(m[2])) put(m[1], m[2]);
    }
  }
  const LABELS = 'Marca|Modelo|Importado|Ano Modelo|Ano|Cor|Cilindrada|Pot[êe]ncia|Combust[íi]vel|Chassi|Motor|Passageiros|UF|Munic[íi]pio|Segmento|Sub ?segmento|Esp[ée]cie|Capacidade';
  const text = decode(html);
  const re = new RegExp(`\\b(${LABELS})\\s*:\\s*(.{1,60}?)(?=\\s+(?:${LABELS})\\s*:|\\s+C[óo]digo|\\s+Tabela|$)`, 'g');
  for (const m of text.matchAll(re)) put(m[1], m[2]);
  return out;
}

// Linhas da tabela FIPE da página: código FIPE (000000-0), modelo e valor.
function fipeRows(html) {
  const rows = [];
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => decode(c[1]));
    const code = cells.find((c) => /^\d{6}-\d$/.test(c));
    const valor = cells.find((c) => /R\$\s*[\d.]+,\d{2}/.test(c));
    if (code && valor) {
      const modelo = cells.filter((c) => c !== code && c !== valor && c.length > 3 && !/^\d{4}$/.test(c)).sort((a, b) => b.length - a.length)[0] || '';
      rows.push({ codigo: code, modelo, valor: Math.round(Number(valor.replace(/[^\d,]/g, '').replace(',', '.'))) });
    }
  }
  if (!rows.length) {
    // Texto copiado da página (sem tabelas): "003271-9 EcoSport XLT 2.0 Flex 16V 5p Mec. R$ 34.084,00".
    const text = decode(html);
    for (const m of text.matchAll(/(\d{6}-\d)\s+(.{4,90}?)\s+R\$\s*([\d.]+,\d{2})/g)) {
      rows.push({ codigo: m[1], modelo: m[2].replace(/^\s*\|?\s*/, '').replace(/\s*\|\s*$/, '').trim(), valor: Math.round(Number(m[3].replace(/\./g, '').replace(',', '.'))) });
    }
  }
  return rows;
}

function pick(p, ...keys) {
  for (const k of keys) { const v = p[norm(k)]; if (v) return v; }
  return '';
}

const COMB = { flex: 'Flex', 'alcool gasolina': 'Flex', 'alcoolgasolina': 'Flex', gasolina: 'Gasolina', alcool: 'Etanol', etanol: 'Etanol', diesel: 'Diesel', eletrico: 'Elétrico', hibrido: 'Híbrido', gnv: 'GNV' };
const CORES = ['Branco', 'Prata', 'Cinza', 'Preto', 'Vermelho', 'Azul', 'Verde', 'Marrom', 'Bege', 'Amarelo', 'Laranja', 'Dourado', 'Vinho'];

function mapCor(c) {
  const n = norm(c);
  const hit = CORES.find((x) => n.startsWith(norm(x).slice(0, 4)));
  return hit || (n ? 'Outra' : '');
}
function mapComb(c) {
  const n = norm(c).replace(/\s+/g, ' ');
  for (const [k, v] of Object.entries(COMB)) if (n.includes(k)) return v;
  return '';
}

// Separa "VW/FOX TRACK 1.6" ou "VOLKSWAGEN FOX" em marca e modelo.
const MARCAS = { VW: 'Volkswagen', GM: 'Chevrolet', CHEV: 'Chevrolet', CHEVROLET: 'Chevrolet', FIAT: 'Fiat', FORD: 'Ford', HONDA: 'Honda', TOYOTA: 'Toyota', HYUNDAI: 'Hyundai', RENAULT: 'Renault', NISSAN: 'Nissan', JEEP: 'Jeep', PEUGEOT: 'Peugeot', CITROEN: 'Citroën', MITSUBISHI: 'Mitsubishi', KIA: 'Kia', VOLKSWAGEN: 'Volkswagen', 'M.BENZ': 'Mercedes-Benz', MERCEDES: 'Mercedes-Benz', BMW: 'BMW', AUDI: 'Audi', CAOA: 'Caoa Chery', CHERY: 'Chery', YAMAHA: 'Yamaha', SUZUKI: 'Suzuki', 'I/': '' };
const title = (s) => String(s).toLowerCase().replace(/(^|\s|-)\S/g, (c) => c.toUpperCase()).replace(/\b(\d)\.(\d)\b/g, '$1.$2');

function splitMarcaModelo(mm, marcaHint) {
  let s = String(mm || '').replace(/^I\//, '').trim();
  let marca = marcaHint || '';
  const m = s.match(/^([A-Z.]+)\s*\/\s*(.+)$/);
  if (m) { marca = marca || MARCAS[m[1]] || title(m[1]); s = m[2]; }
  else {
    const first = s.split(/\s+/)[0];
    if (!marca && MARCAS[first.toUpperCase()]) { marca = MARCAS[first.toUpperCase()]; s = s.slice(first.length).trim(); }
  }
  const words = s.split(/\s+/).filter(Boolean);
  const modelo = title(words.shift() || '');
  return { marca: marca ? (MARCAS[String(marca).toUpperCase()] || title(marca)) : '', modelo, versao: words.map((w) => (/\d/.test(w) || (/^[A-Z]{2,4}$/.test(w) && !/^(MEC|AUT|FLEX)$/.test(w)) ? w : title(w))).join(' ').replace(/\/ /g, '/') };
}

// Escolhe a versão FIPE mais parecida com o modelo do documento (ex.: "ETIOS HB X VSC MT", 1329 cc).
const SYN = { MT: 'MEC', MEC: 'MEC', AT: 'AUT', AUT: 'AUT', AUTOMATICO: 'AUT', MANUAL: 'MEC', HB: '5P', HATCH: '5P', SD: '4P', SEDAN: '4P', FLEX: 'FLEX', TB: 'TURBO', TURBO: 'TURBO', CD: 'CD', CS: 'CS' };
function toks(s) {
  return norm(s).toUpperCase().split(/\s+/).filter(Boolean).map((t) => SYN[t] || t);
}
function scoreFipe(modeloDoc, extra, f) {
  const a = new Set(toks(modeloDoc));
  const b = toks(f.modelo);
  let sc = 0;
  for (const t of b) if (a.has(t)) sc += t.length > 2 ? 2 : 1;
  const litros = extra.cilindrada ? (Math.round(Number(String(extra.cilindrada).replace(/\D/g, '')) / 100) / 10).toFixed(1) : '';
  if (litros && new RegExp(`\\b${litros.replace('.', '\\.')}\\b`).test(f.modelo)) sc += 3;
  if (/flex/i.test(extra.combustivel || '') || /alcool.*gasolina/i.test(norm(extra.combustivel || ''))) { if (/flex/i.test(f.modelo)) sc += 1; }
  if (/diesel/i.test(extra.combustivel || '') && /diesel/i.test(f.modelo)) sc += 2;
  const cv = Number(String(extra.potencia || '').replace(/\D/g, ''));
  if (cv && new RegExp(`\\b${cv}\\s?cv\\b`, 'i').test(f.modelo)) sc += 2;
  return sc;
}

function parse(html, placa) {
  const p = pairs(html);
  const fipes = fipeRows(html);
  const mm = pick(p, 'Marca/Modelo', 'Marca Modelo');
  let marca = pick(p, 'Marca'); let modelo = pick(p, 'Modelo');
  let versao = '';
  if (mm || /\//.test(modelo)) ({ marca, modelo, versao } = splitMarcaModelo(mm || modelo, marca));
  else if (modelo) {
    const sp = splitMarcaModelo(modelo, marca);
    modelo = sp.modelo; versao = sp.versao; marca = sp.marca || title(marca);
  }
  const anoTxt = pick(p, 'Ano', 'Ano Fabricacao', 'Ano de Fabricacao', 'Ano/Modelo');
  const anoMod = pick(p, 'Ano Modelo');
  const anos = (anoTxt.match(/\d{4}/g) || []).map(Number);
  const ano_fab = anos[0] || null;
  const ano_modelo = Number((anoMod.match(/\d{4}/) || [])[0]) || anos[1] || ano_fab;
  const modeloDoc = pick(p, 'Modelo') || mm;
  const extra = { cilindrada: pick(p, 'Cilindrada'), potencia: pick(p, 'Potencia'), combustivel: pick(p, 'Combustivel') };
  const ordenadas = fipes.map((f) => ({ ...f, score: scoreFipe(modeloDoc, extra, f) })).sort((x, y) => y.score - x.score);
  const fipe = ordenadas[0] || null;
  // A versão da FIPE é mais completa ("Track 1.6 Flex 8V 5p") que a do documento ("Track Mb").
  if (fipe) { const sp = splitMarcaModelo(fipe.modelo, marca); if (sp.versao && (!versao || norm(sp.modelo) === norm(modelo))) versao = sp.versao; }
  const out = {
    placa, marca, modelo, versao, ano_fab, ano_modelo,
    cor: mapCor(pick(p, 'Cor')), combustivel: mapComb(pick(p, 'Combustivel')),
    municipio_placa: [pick(p, 'Municipio'), pick(p, 'UF')].filter(Boolean).join(' - '),
    chassi_final: (pick(p, 'Chassi').match(/[A-Z0-9*]{3,}$/i) || [''])[0],
    fipe: fipe?.valor || 0, fipe_codigo: fipe?.codigo || '', fipe_opcoes: ordenadas.slice(0, 15), fipes: ordenadas, fonte: '',
    modelo_documento: modeloDoc, cilindrada: extra.cilindrada, potencia: extra.potencia,
  };
  out.encontrado = !!(out.marca && out.modelo);
  return out;
}

/* ---------------- Busca ---------------- */

async function fetchServer(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const u = new URL(url);
    const r = await fetch(url, {
      headers: {
        'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8', 'Cache-Control': 'no-cache', Referer: `${u.origin}/`,
        'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'same-origin', 'Upgrade-Insecure-Requests': '1',
      },
      redirect: 'follow', signal: ctrl.signal,
    });
    const html = await r.text();
    if (!r.ok || /just a moment|cf-chl|captcha|verify you are human/i.test(html)) return { blocked: true, status: r.status };
    return { html };
  } catch (e) { return { blocked: true, error: e.message }; }
  finally { clearTimeout(t); }
}

function cached(placa) {
  const r = get(`SELECT data_json FROM plate_cache WHERE placa = ? AND created_at > datetime('now', '-60 days')`, placa);
  return r ? JSON.parse(r.data_json) : null;
}
function remember(placa, data) {
  run(`INSERT INTO plate_cache (placa, data_json) VALUES (?, ?) ON CONFLICT(placa) DO UPDATE SET data_json = excluded.data_json, created_at = datetime('now')`, placa, JSON.stringify(data));
}

// Tenta pelo servidor. Se o site bloquear, devolve { precisa_extensao, url } para o painel tentar pela extensão.
// Diagnóstico: status de cada fonte para o servidor (não devolve dados do veículo).
let diagCache = null;
async function diag(p) {
  const placa = cleanPlate(p);
  if (!validPlate(placa)) return { erro: 'placa inválida' };
  if (diagCache && diagCache.placa === placa && diagCache.t > Date.now() - 5 * 60e3) return diagCache.r;
  const fontes = [];
  for (const url of plateUrls(placa)) {
    const host = new URL(url).hostname;
    const r = await fetchServer(url);
    if (!r.html) { fontes.push({ host, ok: false, status: r.status || null, erro: r.error ? 'sem resposta' : 'bloqueado' }); continue; }
    const d = parse(r.html, placa);
    fontes.push({ host, ok: d.encontrado, tamanho: r.html.length, campos: ['marca', 'modelo', 'ano_fab', 'cor', 'combustivel'].filter((k) => d[k]), fipe_linhas: d.fipes.length });
  }
  const r = { fontes, em: new Date().toISOString() };
  diagCache = { placa, t: Date.now(), r };
  return r;
}

async function lookup(placaRaw) {
  const placa = cleanPlate(placaRaw);
  if (!validPlate(placa)) throw Object.assign(new Error('Placa inválida. Use o formato ABC1234 ou ABC1D23.'), { status: 400 });
  const c = cached(placa);
  if (c) return { ...c, cache: true };
  for (const url of plateUrls(placa)) {
    const r = await fetchServer(url);
    if (!r.html) continue;
    const d = parse(r.html, placa);
    d.fonte = new URL(url).hostname.replace(/^www\./, '');
    if (d.encontrado) { remember(placa, d); return d; }
  }
  return { placa, encontrado: false, precisa_extensao: true, url: plateUrl(placa), urls: plateUrls(placa) };
}

// HTML trazido pela extensão (navegador da loja).
function fromHtml(placaRaw, html, url) {
  const placa = cleanPlate(placaRaw);
  const d = parse(String(html || ''), placa);
  try { d.fonte = url ? new URL(url).hostname.replace(/^www\./, '') : 'navegador'; } catch { d.fonte = 'navegador'; }
  if (d.encontrado) remember(placa, d);
  return d;
}

/* ---------------- Tabela FIPE gratuita ---------------- */

// "VW - VolksWagen" -> "Volkswagen"; "GM - Chevrolet" -> "Chevrolet"; "Fiat" -> "Fiat".
function fipeMarca(nome) {
  const parts = String(nome || '').split(' - ');
  return MARCAS[parts[0].trim().toUpperCase()] || title(parts[1] || parts[0]);
}

const fipeCache = new Map();
async function fipeGet(path) {
  const hit = fipeCache.get(path);
  if (hit && hit.t > Date.now() - 6 * 3600e3) return hit.v;
  const r = await fetch(`${FIPE_URL()}${path}`, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw Object.assign(new Error(r.status === 429 ? 'Limite diário da Tabela FIPE gratuita atingido. Tente mais tarde.' : `Tabela FIPE indisponível (${r.status}).`), { status: 502 });
  const v = await r.json();
  fipeCache.set(path, { t: Date.now(), v });
  return v;
}
const TIPOS = ['carros', 'motos', 'caminhoes'];
const tipo = (t) => (TIPOS.includes(t) ? t : 'carros');
const fipeMarcas = (t) => fipeGet(`/${tipo(t)}/marcas`);
const fipeModelos = (t, marca) => fipeGet(`/${tipo(t)}/marcas/${encodeURIComponent(marca)}/modelos`).then((r) => r.modelos || []);
const fipeAnos = (t, marca, modelo) => fipeGet(`/${tipo(t)}/marcas/${encodeURIComponent(marca)}/modelos/${encodeURIComponent(modelo)}/anos`);
async function fipePreco(t, marca, modelo, ano) {
  const r = await fipeGet(`/${tipo(t)}/marcas/${encodeURIComponent(marca)}/modelos/${encodeURIComponent(modelo)}/anos/${encodeURIComponent(ano)}`);
  const sp = splitMarcaModelo(r.Modelo, r.Marca);
  return {
    marca: fipeMarca(r.Marca), modelo: sp.modelo, versao: sp.versao,
    ano_modelo: r.AnoModelo === 32000 ? new Date().getFullYear() : r.AnoModelo,
    combustivel: mapComb(r.Combustivel), fipe: Math.round(Number(String(r.Valor).replace(/[^\d,]/g, '').replace(',', '.'))),
    fipe_codigo: r.CodigoFipe, fipe_ref: String(r.MesReferencia || '').trim(), fonte: 'Tabela FIPE',
  };
}

module.exports = { diag, fipeMarca, lookup, fromHtml, parse, cleanPlate, validPlate, plateUrl, plateUrls, scoreFipe, fipeMarcas, fipeModelos, fipeAnos, fipePreco, splitMarcaModelo };
