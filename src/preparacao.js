// Preparação e custos dos carros (v2.14/v2.15): o que falta arrumar antes de vender e o que já foi feito, com o custo.
const { get, all, run, tx, logEvent } = require('./db');

// v2.15: uma lista só por carro — serviços a fazer (preparação) e o que já foi feito, com o custo. As categorias são as
// mesmas dos custos do carro, e cada item com valor é o próprio lançamento de custo (previsto enquanto a fazer, realizado quando feito).
const CATS = require('./gestao').COST_CATS;
const STATUS = { pendente: 'A fazer', andamento: 'Em andamento', feito: 'Feito' };

// Palavras que indicam a categoria, para não precisar escolher.
const PISTAS = [
  ['funilaria', /pint|para-?choque|parachoque|amass|risc|funil|lataria|porta|cap[oô]|retoque|ferrugem|massa|polir? (a )?pe[cç]a|verniz/i],
  ['eletrica', /l[aâ]mpada|bateria|el[eé]tric|vidro el[eé]tric|trava|alarme|som|r[aá]dio|central|luz|seta|buzina|chicote|sensor|c[aâ]mera/i],
  ['interior', /banco|rasg|forro|tape[cç]|carpete|volante|painel|tapete|cinto|costur|teto/i],
  ['vidros', /vidro|para-?brisa|parabrisa|farol|far[oó]is|lanterna|retrovisor|insulfilm|pel[ií]cula/i],
  ['pneus', /pneu|roda|calota|alinha|balance|estepe|borrach/i],
  ['documentacao', /transfer[eê]ncia|documento|crlv|crv|dut|licenciamento|vistoria cautelar|laudo/i],
  ['despachante', /despachante/i],
  ['frete', /frete|guincho|reboque|transporte/i],
  ['comissao', /comiss[aã]o/i],
  ['ipva', /ipva|multa/i],
  ['anuncio', /an[uú]ncio|webmotors|olx|impulsion/i],
  ['pecas', /pe[cç]a|compra de/i],
  ['lavagem', /^lava|lavagem|lavar/i],
  ['estetica', /polimento|higieniz|cristaliz|limpeza|odor|cheiro|enceramento|vitrifica|detalh/i],
  ['mecanica', /[oó]leo|freio|pastilha|motor|embreagem|suspens|amortecedor|correia|vela|filtro|revis|ar[- ]condicionado|escapamento|radiador|c[aâ]mbio|vazamento|barulho|ru[ií]do/i],
];
function categoriaDe(texto) { return (PISTAS.find(([, re]) => re.test(String(texto || ''))) || ['outros'])[0]; }

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
  const itens = all("SELECT p.*, pa.nome AS parceiro_nome FROM preparacao p LEFT JOIN partners pa ON pa.id = p.parceiro_id WHERE p.vehicle_id = ? ORDER BY CASE p.status WHEN 'feito' THEN 1 ELSE 0 END, CASE WHEN p.status = 'feito' THEN COALESCE(p.feito_em, '') END DESC, p.id", vehicleId).map(out);
  const abertos = itens.filter((i) => !i.feito);
  return {
    total: itens.length, abertos: abertos.length, feitos: itens.length - abertos.length, atrasados: abertos.filter((i) => i.atrasado).length,
    custo_aberto: abertos.reduce((s, i) => s + (i.custo || 0), 0), custo_feito: itens.filter((i) => i.feito).reduce((s, i) => s + (i.custo || 0), 0), itens,
  };
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
  const corpo = { valor: p.custo, categoria: CATS[p.categoria] ? p.categoria : 'outros', descricao: p.descricao, status, parceiro_id: p.parceiro_id || null, data: p.status === 'feito' ? p.feito_em : (p.prazo || null) };
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
    const status = STATUS[x.status] ? x.status : 'pendente';
    const id = Number(run(`INSERT INTO preparacao (store_id, vehicle_id, descricao, categoria, status, custo, prazo, parceiro_id, obs, feito_em, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      storeId, v.id, x.descricao, categoria, status, int(x.custo ?? x.valor), data(x.prazo), parceiro, str(x.obs, 500), status === 'feito' ? (data(x.data) || hoje()) : null, userId || null).lastInsertRowid);
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
    custo: b.custo !== undefined ? int(b.custo) : b.valor !== undefined ? int(b.valor) : p.custo,
    prazo: b.prazo !== undefined ? data(b.prazo) : p.prazo,
    parceiro_id: b.parceiro_id !== undefined ? (b.parceiro_id ? get('SELECT id FROM partners WHERE id = ? AND store_id = ?', Number(b.parceiro_id), storeId)?.id || null : null) : p.parceiro_id,
    obs: b.obs !== undefined ? str(b.obs, 500) : p.obs,
  };
  const ficouPronto = d.status === 'feito' && p.status !== 'feito';
  tx(() => {
    run(`UPDATE preparacao SET descricao=?, categoria=?, status=?, custo=?, prazo=?, parceiro_id=?, obs=?, feito_em=?, updated_at=datetime('now') WHERE id=?`,
      d.descricao, d.categoria, d.status, d.custo, d.prazo, d.parceiro_id, d.obs, d.status === 'feito' ? (data(b.data) || p.feito_em || hoje()) : null, p.id);
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
    if (p.cost_id) run('DELETE FROM vehicle_costs WHERE id = ? AND vehicle_id = ?', p.cost_id, p.vehicle_id);
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

// Compatibilidade com as rotas antigas de custos (/api/vehicles/:id/costs): tudo passa pela lista única.
function custoParaItem(b) {
  return { descricao: str(b.descricao) || CATS[b.categoria] || 'Custo', categoria: CATS[b.categoria] ? b.categoria : 'outros', custo: b.valor, parceiro_id: b.parceiro_id, data: b.data,
    status: b.status === 'previsto' ? 'pendente' : 'feito' };
}
function addCusto(storeId, vehicleId, b, userId) {
  if (!int(b.valor)) throw httpError(400, 'Informe o valor do custo.');
  return add(storeId, vehicleId, custoParaItem(b), userId)[0];
}
function itemDoCusto(storeId, vehicleId, costId) {
  return get('SELECT * FROM preparacao WHERE store_id = ? AND vehicle_id = ? AND cost_id = ?', storeId, Number(vehicleId), Number(costId));
}
function updateCusto(storeId, vehicleId, costId, b, userId) {
  const p = itemDoCusto(storeId, vehicleId, costId);
  if (!p) return require('./gestao').updateCost(storeId, vehicleId, costId, b);
  const up = {};
  if (b.status) up.status = b.status === 'previsto' ? (p.status === 'feito' ? 'pendente' : p.status) : 'feito';
  if (b.valor !== undefined) up.custo = b.valor;
  for (const k of ['descricao', 'categoria', 'parceiro_id', 'data']) if (b[k] !== undefined) up[k] = b[k];
  return update(storeId, p.id, up, userId);
}
function removeCusto(storeId, vehicleId, costId) {
  const p = itemDoCusto(storeId, vehicleId, costId);
  if (p) return remove(storeId, p.id);
  require('./gestao').deleteCost(storeId, vehicleId, costId);
}

// Uma vez: custos lançados antes da v2.15 viram itens da lista (feitos ou a fazer), e "outro" vira "outros".
function migrar() {
  run("UPDATE preparacao SET categoria = 'outros' WHERE categoria = 'outro'");
  run("UPDATE vehicle_costs SET descricao = substr(descricao, 13) WHERE descricao LIKE 'Preparação: %'");
  const soltos = all(`SELECT c.*, v.store_id FROM vehicle_costs c JOIN vehicles v ON v.id = c.vehicle_id
    WHERE NOT EXISTS (SELECT 1 FROM preparacao p WHERE p.cost_id = c.id)`);
  if (!soltos.length) return 0;
  tx(() => soltos.forEach((c) => run(`INSERT INTO preparacao (store_id, vehicle_id, descricao, categoria, status, custo, parceiro_id, cost_id, feito_em, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`, c.store_id, c.vehicle_id, str(c.descricao).replace(/^Preparação:\s*/, '') || CATS[c.categoria] || 'Custo',
  CATS[c.categoria] ? c.categoria : 'outros', c.status === 'previsto' ? 'pendente' : 'feito', c.valor || 0, c.parceiro_id || null, c.id, c.status === 'previsto' ? null : (c.data || null), c.created_by || null, c.created_at)));
  return soltos.length;
}
try { migrar(); } catch (e) { console.error('preparacao migrar', e.message); }

module.exports = { migrar, addCusto, updateCusto, removeCusto, CATS, STATUS, categoriaDe, doVeiculo, list, add, update, remove, painel };
