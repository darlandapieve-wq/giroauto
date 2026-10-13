// Importação de estoque por planilha (v2.0): CSV ou Excel (.xlsx), com prévia antes de gravar.
const ExcelJS = require('exceljs');
const V = require('./vehicles');

const COLS = [
  ['placa', 'Placa', ['placa']],
  ['marca', 'Marca', ['marca', 'fabricante', 'montadora']],
  ['modelo', 'Modelo', ['modelo']],
  ['versao', 'Versão', ['versao', 'versão', 'versao modelo']],
  ['ano_fab', 'Ano fabricação', ['ano fabricacao', 'ano fab', 'fabricacao', 'ano de fabricacao', 'ano fabr']],
  ['ano_modelo', 'Ano modelo', ['ano modelo', 'ano', 'modelo ano', 'ano mod']],
  ['km', 'Quilometragem', ['km', 'quilometragem', 'kilometragem', 'quilometros']],
  ['preco', 'Preço de venda', ['preco', 'preço', 'valor', 'preco de venda', 'valor de venda', 'preco venda']],
  ['preco_oferta', 'Preço de oferta', ['preco de oferta', 'oferta', 'preco oferta', 'promocao']],
  ['fipe', 'FIPE', ['fipe', 'valor fipe', 'tabela fipe']],
  ['cor', 'Cor', ['cor', 'cor externa']],
  ['cor_interna', 'Cor interna', ['cor interna']],
  ['cambio', 'Câmbio', ['cambio', 'câmbio', 'transmissao']],
  ['combustivel', 'Combustível', ['combustivel', 'combustível']],
  ['carroceria', 'Carroceria', ['carroceria', 'tipo', 'categoria']],
  ['descricao', 'Descrição', ['descricao', 'descrição', 'observacoes', 'obs']],
  ['renavam', 'Renavam', ['renavam']],
  ['chassi', 'Chassi', ['chassi']],
  ['proprietario_tipo', 'Situação (próprio, consignado, procuração)', ['situacao', 'propriedade', 'tipo de estoque', 'proprietario tipo']],
  ['proprietario_nome', 'Proprietário', ['proprietario', 'dono', 'nome do proprietario']],
  ['compra_valor', 'Valor de compra', ['valor de compra', 'compra', 'custo de compra', 'preco de compra']],
  ['compra_data', 'Data de compra', ['data de compra', 'data compra', 'entrada', 'data de entrada']],
  ['destaques', 'Destaques (separados por vírgula)', ['destaques', 'opcionais', 'itens']],
];

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function mapHeader(h) {
  const n = norm(h);
  if (!n) return null;
  for (const [key, , syn] of COLS) if (syn.some((x) => norm(x) === n)) return key;
  for (const [key, , syn] of COLS) if (syn.some((x) => n.startsWith(norm(x)))) return key;
  return null;
}

function parseCsv(text) {
  const t = String(text).replace(/^﻿/, '');
  const firstLine = t.split(/\r?\n/)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : (firstLine.includes('\t') ? '\t' : ',');
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim()));
}

async function parseXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (r) => {
    const vals = [];
    for (let i = 1; i <= r.cellCount; i++) {
      let v = r.getCell(i).value;
      if (v && typeof v === 'object') v = v.result ?? v.text ?? (v instanceof Date ? v.toISOString().slice(0, 10) : v.richText?.map((x) => x.text).join('') ?? '');
      vals.push(v == null ? '' : String(v));
    }
    rows.push(vals);
  });
  return rows;
}

const money = (x) => {
  const s = String(x ?? '').replace(/[R$\s]/g, '');
  if (!s) return 0;
  // 54.900,00 | 54900 | 54,900.00
  const n = /,\d{1,2}$/.test(s) ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
};
const pickList = (x, list) => list.find((o) => norm(o) === norm(x)) || list.find((o) => norm(x) && norm(o).startsWith(norm(x).slice(0, 4))) || '';
const dateBr = (x) => {
  const s = String(x || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
};

function toVehicle(raw) {
  const tipo = norm(raw.proprietario_tipo);
  const destaques = String(raw.destaques || '').split(/[,;|]/).map((d) => V.DESTAQUES.find((o) => norm(o.label) === norm(d) || norm(o.texto) === norm(d))?.key).filter(Boolean);
  const body = {
    ...raw,
    km: String(raw.km || '').replace(/\D/g, ''),
    preco: money(raw.preco), preco_oferta: money(raw.preco_oferta), fipe: money(raw.fipe),
    cor: pickList(raw.cor, V.CORES), cor_interna: pickList(raw.cor_interna, V.CORES),
    cambio: pickList(raw.cambio, V.CAMBIOS) || (/auto/.test(norm(raw.cambio)) ? 'Automático' : ''),
    combustivel: pickList(raw.combustivel, V.COMBUSTIVEIS) || (/alcool|gasolina/.test(norm(raw.combustivel)) ? 'Flex' : ''),
    carroceria: pickList(raw.carroceria, V.CARROCERIAS),
    proprietario_tipo: tipo.startsWith('consig') ? 'consignado' : tipo.startsWith('procura') ? 'procuracao' : tipo.startsWith('parc') ? 'parceria' : tipo.startsWith('repas') ? 'repasse' : 'proprio',
    destaques,
  };
  const v = V.cleanInput(body);
  return { v, compra_valor: money(raw.compra_valor), compra_data: dateBr(raw.compra_data) };
}

async function preview(file) {
  const isX = /\.xlsx$/i.test(file.originalname) || /spreadsheetml/.test(file.mimetype);
  let rows;
  if (isX) rows = await parseXlsx(file.buffer);
  else {
    let text = file.buffer.toString('utf8');
    if (text.includes('�')) text = file.buffer.toString('latin1');
    rows = parseCsv(text);
  }
  if (!rows.length) throw Object.assign(new Error('A planilha está vazia.'), { status: 400 });
  // Acha a linha de cabeçalho (a primeira com "marca" e "modelo").
  let hi = rows.findIndex((r) => r.map(mapHeader).includes('marca') && r.map(mapHeader).includes('modelo'));
  if (hi < 0) throw Object.assign(new Error('Não achei as colunas "Marca" e "Modelo". Use o modelo de planilha do GiroAuto.'), { status: 400 });
  const keys = rows[hi].map(mapHeader);
  const out = [];
  for (const r of rows.slice(hi + 1).slice(0, 1000)) {
    const raw = {};
    keys.forEach((k, i) => { if (k) raw[k] = String(r[i] ?? '').trim(); });
    if (!raw.marca && !raw.modelo) continue;
    const { v, compra_valor, compra_data } = toVehicle(raw);
    const problemas = [];
    if (!v.marca || !v.modelo) problemas.push('falta marca ou modelo');
    if (!v.preco) problemas.push('sem preço');
    if (!v.ano_modelo) problemas.push('sem ano do modelo');
    out.push({ ...v, destaques: JSON.parse(v.destaques), compra_valor, compra_data, problemas, ok: !!(v.marca && v.modelo) });
  }
  return { colunas: rows[hi].map((h, i) => ({ planilha: h, campo: keys[i] ? COLS.find((c) => c[0] === keys[i])[1] : null })), linhas: out };
}

function templateCsv() {
  const head = COLS.map((c) => c[1]).join(';');
  const ex = ['ABC1D23', 'Volkswagen', 'Fox', 'Track 1.6', '2015', '2016', '98500', '54900', '', '49846', 'Prata', 'Preto', 'Manual', 'Flex', 'Hatch', 'Carro revisado.', '', '', 'Próprio', '', '42000', '01/10/2026', 'Perícia aprovada, Teto solar'].join(';');
  return `﻿${head}\n${ex}\n`;
}

async function templateXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Estoque');
  ws.addRow(COLS.map((c) => c[1]));
  ws.addRow(['ABC1D23', 'Volkswagen', 'Fox', 'Track 1.6', 2015, 2016, 98500, 54900, '', 49846, 'Prata', 'Preto', 'Manual', 'Flex', 'Hatch', 'Carro revisado.', '', '', 'Próprio', '', 42000, '01/10/2026', 'Perícia aprovada, Teto solar']);
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((c) => { c.width = 16; });
  return wb.xlsx.writeBuffer();
}

module.exports = { preview, templateCsv, templateXlsx, COLS, parseCsv, mapHeader, money };
