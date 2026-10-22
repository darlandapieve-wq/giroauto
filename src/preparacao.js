// Preparação dos carros (v2.14): o que falta arrumar antes de vender (repintar para-choque, trocar lâmpada, costurar banco…).
// Cada item pode ter custo previsto: ele entra nos custos do carro como "previsto" e vira "realizado" quando o item é feito.
const { get, all, run, tx, logEvent } = require('./db');

const CATS = {
  funilaria: 'Funilaria e pintura', mecanica: 'Mecânica', eletrica: 'Elétrica e lâmpadas', interior: 'Bancos e interior',
  estetica: 'Estética e limpeza', pneus: 'Pneus e rodas', vidros: 'Vidros e faróis', outro: 'Outro',
};
// Categoria equivalente nos custos do carro (Gestão).
const CUSTO_CAT = { funilaria: 'funilaria', mecanica: 'mecanica', eletrica: 'eletrica', interior: 'outros', estetica: 'estetica', pneus: 'pneus', vidros: 'outros', outro: 'outros' };
const STATUS = { pendente: 'A fazer', andamento: 'Em andamento', feito: 'Feito' };

// Palavras que indicam a categoria, para não precisar escolher.
const PISTAS = [
  ['funilaria', /pint|para-?choque|parachoque|amass|risc|funil|lataria|porta|cap[oô]|retoque|ferrugem|massa|polir? (a )?pe[cç]a|verniz/i],
  ['eletrica', /l[aâ]mpada|bateria|el[eé]tric|vidro el[eé]tric|trava|alarme|som|r[aá]dio|central|luz|seta|buzina|chicote|sensor|c[aâ]mera/i],
  ['interior', /banco|rasg|forro|tape[cç]|carpete|volante|painel|tapete|cinto|costur|teto/i],
  ['vidros', /vidro|para-?brisa|parabrisa|farol|far[oó]is|lanterna|retrovisor|insulfilm|pel[ií]cula/i],
  ['pneus', /pneu|roda|calota|alinha|balance|estepe/i],
  ['estetica', /lav|polimento|higieniz|cristaliz|limpeza|odor|cheiro|enceramento|vitrifica|detalh/i],
  ['mecanica', /[oó]leo|freio|pastilha|motor|embreagem|suspens|amortecedor|correia|vela|filtro|revis|ar[- ]condicionado|escapamento|radiador|c[aâ]mbio|vazamento|barulho|ru[ií]do/i],
];
function categoriaDe(texto) { return (PISTAS.find(([, re]) => re.test(String(texto || ''))) || ['outro'])[0]; }

const str = (x, max = 200) => String(x ?? '').trim().slice(0, max);
const int = (x) => { const n = Math.round(Number(String(x ?? '').replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) || 0); return Math.max(0, n); };
const data = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(String(x || '')) ? String(x) : null);
const hoje = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const httpError = (status, message) => Object.assign(new Error(message), { status });

function veiculo(storeId, id) {
  const v = get('SELECT * FROM vehicles WHERE id = ? AND store_id = ?', Number(id), storeId);
  if (!v) throw httpError(404, 'Veículo não encontrado.');
  return v;
}
function find(storeId, id) {
  const p = get('SELECT * FROM preparacao WHERE id = ? AND store_id = ?', Number(id), storeId);
  if (!p) throw httpError(404, 'Item de preparação não encontrado.');
  return p;
}
const titulo = (v) => [v.marca, v.modelo].filter(Boolean).join(' ') || 'carro';

function out(p) {
  const atrasado = p.status !== 'feito' && p.prazo && p.prazo < hoje();
  return { ...p, categoria_label: CATS[p.categoria] || p.categoria, status_label: STATUS[p.status] || p.status, feito: p.status === 'feito', atrasado: !!atrasado };
}

// Resumo usado no card do carro (estoque, gestão, painel).
function doVeiculo(vehicleId) {
  const itens = all("SELECT * FROM preparacao WHERE vehicle_id = ? ORDER BY CASE status WHEN 'feito' THEN 1 ELSE 0 END, id", vehicleId).map(out);
  const abertos = itens.filter((i) => !i.feito);
  return { total: itens.length, abertos: abertos.length, feitos: itens.length - abertos.length, atrasados: abertos.filter((i) => i.atrasado).length, custo_aberto: abertos.reduce((s, i) => s + (i.custo || 0), 0), itens };
}

function list(storeId, { vehicleId, abertos } = {}) {
  const w = ['p.store_id = ?']; const a = [storeId];
  if (vehicleId) { w.push('p.vehicle_id = ?'); a.push(Number(vehicleId)); }
  if (abertos) w.push("p.status != 'feito'");
  return all(`SELECT p.*, v.marca, v.modelo, v.ano_modelo, v.placa, v.status AS veiculo_status, pa.nome AS parceiro_nome, u.name AS autor
    FROM preparacao p JOIN vehicles v ON v.id = p.vehicle_id LEFT JOIN partners pa ON pa.id = p.parceiro_id LEFT JOIN users u ON u.id = p.created_by
    WHERE ${w.join(' AND ')} ORDER BY CASE p.status WHEN 'feito' THEN 2 WHEN 'andamento' THEN 0 ELSE 1 END, COALESCE(p.prazo, '9999'), p.id`, ...a)
    .map((p) => ({ ...out(p), veiculo: { id: p.vehicle_id, titulo: [p.ano_modelo, p.marca, p.modelo].filter(Boolean).join(' '), placa: p.placa || '', status: p.veiculo_status } }));
}

// Custo ligado ao item: previsto enquanto não é feito, realizado quando fica pronto.
function syncCusto(storeId, p, userId) {
  const G = require('./gestao');
  const c = p.cost_id ? get('SELECT * FROM vehicle_costs WHERE id = ? AND vehicle_id = ?', p.cost_id, p.vehicle_id) : null;
  const status = p.status === 'feito' ? 'realizado' : 'previsto';
  if (!p.custo) {
    if (c && c.status === 'previsto') run('DELETE FROM vehicle_costs WHERE id = ?', c.id);
    if (c) run('UPDATE preparacao SET cost_id = NULL WHERE id = ?', p.id);
    return;
  }
  const corpo = { valor: p.custo, categoria: CUSTO_CAT[p.categoria] || 'outros', descricao: `Preparação: ${p.descricao}`, status, parceiro_id: p.parceiro_id || null };
  if (c) G.updateCost(storeId, p.vehicle_id, c.id, corpo);
  else run('UPDATE preparacao SET cost_id = ? WHERE id = ?', Number(G.addCost(storeId, p.vehicle_id, corpo, userId)), p.id);
}

// Aceita um item ({descricao}) ou vários ({itens: [...]} ou texto com um item por linha).
function add(storeId, vehicleId, b, userId) {
  const v = veiculo(storeId, vehicleId);
  let lista = Array.isArray(b.itens) ? b.itens : [b];
  lista = lista.flatMap((x) => (typeof x === 'string' ? x : x.descricao || '').split(/\n|;/).map((d) => ({ ...(typeof x === 'object' ? x : {}), descricao: d })))
    .map((x) => ({ ...x, descricao: str(x.descricao).replace(/^[-•*\s]+/, '') })).filter((x) => x.descricao);
  if (!lista.length) throw httpError(400, 'Descreva o que precisa ser feito (ex.: repintar para-choque).');
  const ids = tx(() => lista.slice(0, 40).map((x) => {
    const categoria = CATS[x.categoria] ? x.categoria : categoriaDe(x.descricao);
    const parceiro = x.parceiro_id ? get('SELECT id FROM partners WHERE id = ? AND store_id = ?', Number(x.parceiro_id), storeId)?.id || null : null;
    const id = Number(run(`INSERT INTO preparacao (store_id, vehicle_id, descricao, categoria, status, custo, prazo, parceiro_id, obs, created_by) VALUES (?, ?, ?, ?, 'pendente', ?, ?, ?, ?, ?)`,
      storeId, v.id, x.descricao, categoria, int(x.custo), data(x.prazo), parceiro, str(x.obs, 500), userId || null).lastInsertRowid);
    syncCusto(storeId, find(storeId, id), userId);
    return id;
  }));
  logEvent(storeId, `Preparação do ${titulo(v)}: ${lista.length === 1 ? lista[0].descricao : `${lista.length} itens`}`);
  return ids;
}

function update(storeId, id, b, userId) {
  const p = find(storeId, id);
  const d = {
    descricao: b.descricao !== undefined ? str(b.descricao) || p.descricao : p.descricao,
    categoria: CATS[b.categoria] ? b.categoria : p.categoria,
    status: STATUS[b.status] ? b.status : p.status,
    custo: b.custo !== undefined ? int(b.custo) : p.custo,
    prazo: b.prazo !== undefined ? data(b.prazo) : p.prazo,
    parceiro_id: b.parceiro_id !== undefined ? (b.parceiro_id ? get('SELECT id FROM partners WHERE id = ? AND store_id = ?', Number(b.parceiro_id), storeId)?.id || null : null) : p.parceiro_id,
    obs: b.obs !== undefined ? str(b.obs, 500) : p.obs,
  };
  const ficouPronto = d.status === 'feito' && p.status !== 'feito';
  tx(() => {
    run(`UPDATE preparacao SET descricao=?, categoria=?, status=?, custo=?, prazo=?, parceiro_id=?, obs=?, feito_em=?, updated_at=datetime('now') WHERE id=?`,
      d.descricao, d.categoria, d.status, d.custo, d.prazo, d.parceiro_id, d.obs, d.status === 'feito' ? (p.feito_em || hoje()) : null, p.id);
    syncCusto(storeId, find(storeId, p.id), userId);
  });
  if (ficouPronto) {
    const v = get('SELECT * FROM vehicles WHERE id = ?', p.vehicle_id);
    const resta = get("SELECT COUNT(*) n FROM preparacao WHERE vehicle_id = ? AND status != 'feito'", p.vehicle_id).n;
    logEvent(storeId, `Preparação do ${titulo(v)}: ${d.descricao} feito${resta ? ` (faltam ${resta})` : ' — carro pronto'}`);
  }
  return out(find(storeId, p.id));
}

function remove(storeId, id) {
  const p = find(storeId, id);
  tx(() => {
    if (p.cost_id) run("DELETE FROM vehicle_costs WHERE id = ? AND status = 'previsto'", p.cost_id);
    run('DELETE FROM preparacao WHERE id = ?', p.id);
  });
}

// Quadro "Preparação" do painel: carros com itens a fazer.
function painel(storeId) {
  const itens = list(storeId, { abertos: true }).filter((i) => i.veiculo.status !== 'vendido');
  const porCarro = new Map();
  for (const i of itens) { if (!porCarro.has(i.vehicle_id)) porCarro.set(i.vehicle_id, { ...i.veiculo, itens: [] }); porCarro.get(i.vehicle_id).itens.push({ id: i.id, descricao: i.descricao, status: i.status, atrasado: i.atrasado, categoria_label: i.categoria_label }); }
  const carros = [...porCarro.values()].sort((a, b) => b.itens.length - a.itens.length);
  return { itens: itens.length, carros: carros.length, atrasados: itens.filter((i) => i.atrasado).length, custo: itens.reduce((s, i) => s + (i.custo || 0), 0), lista: carros.slice(0, 12) };
}

module.exports = { CATS, STATUS, categoriaDe, doVeiculo, list, add, update, remove, painel };
