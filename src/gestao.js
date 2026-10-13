// Gestão da loja (v2.0): compra, custos, venda e margem por carro; parceiros e localização; indicadores.
const { get, all, run, logEvent } = require('./db');
const V = require('./vehicles');

const COST_CATS = {
  mecanica: 'Mecânica', eletrica: 'Elétrica', funilaria: 'Funilaria e pintura', estetica: 'Estética / polimento', lavagem: 'Lavagem',
  pneus: 'Pneus', pecas: 'Peças', documentacao: 'Documentação / transferência', despachante: 'Despachante', vistoria: 'Vistoria / laudo',
  frete: 'Frete / guincho', anuncio: 'Anúncios', comissao: 'Comissão de compra', ipva: 'IPVA / multas', outros: 'Outros',
};
const PARTNER_TYPES = {
  oficina: 'Oficina mecânica', eletrica: 'Auto elétrica', funilaria: 'Funilaria e pintura', estetica: 'Estética automotiva', lavador: 'Lavador',
  pneus: 'Borracharia / pneus', vidros: 'Vidros / insulfilm', loja_parceira: 'Loja parceira', despachante: 'Despachante', vistoria: 'Vistoria', outro: 'Outro',
};
const LOCAL = {
  patio: 'No pátio da loja', manutencao: 'Em manutenção', loja_parceira: 'Em loja parceira', cliente: 'Com cliente (test drive / avaliação)', outro: 'Outro local',
};

const int = (x) => { const n = parseInt(String(x ?? '').replace(/\D/g, ''), 10); return Number.isFinite(n) ? n : 0; };
const str = (x, max = 200) => String(x ?? '').trim().slice(0, max);
const date = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(String(x || '')) ? String(x) : null);
const httpError = (status, message) => Object.assign(new Error(message), { status });
const daysBetween = (a, b = new Date()) => {
  if (!a) return 0;
  const t = Date.parse(String(a).length <= 10 ? `${a}T12:00:00Z` : String(a).replace(' ', 'T') + (String(a).endsWith('Z') ? '' : 'Z'));
  return Math.max(0, Math.floor(((b instanceof Date ? b.getTime() : Date.parse(b)) - t) / 864e5));
};

/* ---------------- Financeiro do carro ---------------- */

function costsOf(vehicleId) {
  return all(`SELECT c.*, p.nome AS parceiro_nome FROM vehicle_costs c LEFT JOIN partners p ON p.id = c.parceiro_id
              WHERE c.vehicle_id = ? ORDER BY COALESCE(c.data, c.created_at), c.id`, vehicleId);
}

// Valores de lucro (bruto e líquido), previstos (pelo preço do anúncio) e reais (pela venda).
function finance(v, store) {
  const custos = all('SELECT valor FROM vehicle_costs WHERE vehicle_id = ?', v.id).reduce((s, c) => s + c.valor, 0);
  const impostosPct = Number(store?.impostos_pct || 0) / 100;
  const preco = V.precoAnuncio(v) || 0;
  const consig = v.proprietario_tipo === 'consignado' || v.proprietario_tipo === 'procuracao';
  // Base: o que a loja pagou (próprio) ou o que vai repassar ao dono (consignado/procuração).
  const baseFor = (venda) => {
    if (!consig) return v.compra_valor || 0;
    if (v.consig_repasse) return v.consig_repasse;
    if (v.consig_comissao_pct) return Math.round(venda * (1 - v.consig_comissao_pct / 100));
    return v.compra_valor || 0;
  };
  const calc = (venda, comissao) => {
    if (!venda) return null;
    if (!baseFor(venda)) return null; // sem valor de compra/repasse não dá para calcular lucro
    const bruto = venda - baseFor(venda) - custos;
    const liquido = bruto - (comissao || 0) - Math.round(venda * impostosPct);
    return { venda, base: baseFor(venda), bruto, liquido, margem_pct: venda ? Math.round((liquido / venda) * 1000) / 10 : 0 };
  };
  const investido = (consig ? 0 : (v.compra_valor || 0)) + custos;
  return {
    custos_total: custos,
    investido,
    previsto: calc(preco, 0),
    real: v.status === 'vendido' ? calc(v.venda_valor || 0, v.venda_comissao) : null,
    base_label: consig ? 'Repasse ao dono' : 'Valor de compra',
    falta_base: !(consig ? (v.consig_repasse || v.consig_comissao_pct || v.compra_valor) : v.compra_valor),
  };
}

function saveFinance(storeId, vehicleId, body) {
  const v = V.findVehicle(storeId, vehicleId);
  if (!v) throw httpError(404, 'Veículo não encontrado.');
  const f = {
    compra_valor: int(body.compra_valor), compra_data: date(body.compra_data), compra_de: str(body.compra_de, 120),
    consig_repasse: int(body.consig_repasse),
  };
  if (v.status === 'vendido' || body.venda_valor !== undefined) {
    Object.assign(f, {
      venda_valor: int(body.venda_valor), venda_comprador: str(body.venda_comprador, 120), venda_pagamento: str(body.venda_pagamento, 60),
      venda_comissao: int(body.venda_comissao), venda_vendedor_id: body.venda_vendedor_id ? Number(body.venda_vendedor_id) : null,
    });
  }
  const cols = Object.keys(f);
  run(`UPDATE vehicles SET ${cols.map((c) => `${c}=?`).join(',')}, updated_at=datetime('now') WHERE id=?`, ...cols.map((c) => f[c]), v.id);
}

function addCost(storeId, vehicleId, body, userId) {
  const v = V.findVehicle(storeId, vehicleId);
  if (!v) throw httpError(404, 'Veículo não encontrado.');
  const valor = int(body.valor);
  if (!valor) throw httpError(400, 'Informe o valor do custo.');
  const parceiro = body.parceiro_id ? get('SELECT id FROM partners WHERE id = ? AND store_id = ?', Number(body.parceiro_id), storeId) : null;
  run('INSERT INTO vehicle_costs (vehicle_id, categoria, descricao, valor, data, parceiro_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    v.id, COST_CATS[body.categoria] ? body.categoria : 'outros', str(body.descricao, 200), valor, date(body.data) || new Date().toISOString().slice(0, 10), parceiro?.id || null, userId);
}

function deleteCost(storeId, vehicleId, costId) {
  const v = V.findVehicle(storeId, vehicleId);
  if (!v) throw httpError(404, 'Veículo não encontrado.');
  run('DELETE FROM vehicle_costs WHERE id = ? AND vehicle_id = ?', Number(costId), v.id);
}

/* ---------------- Parceiros e localização ---------------- */

const waNumber = (x) => { const n = String(x || '').replace(/\D/g, ''); return n ? (n.startsWith('55') ? n : '55' + n) : ''; };

function partners(storeId, includeInactive) {
  return all(`SELECT p.*, (SELECT COUNT(*) FROM vehicles v WHERE v.local_parceiro_id = p.id AND v.status != 'vendido' AND v.local_status != 'patio') AS carros
              FROM partners p WHERE p.store_id = ? ${includeInactive ? '' : 'AND p.active = 1'} ORDER BY p.tipo, p.nome`, storeId)
    .map((p) => ({ ...p, active: !!p.active, tipo_label: PARTNER_TYPES[p.tipo] || p.tipo, wa: waNumber(p.whatsapp) }));
}

function savePartner(storeId, id, body) {
  const d = { nome: str(body.nome, 120), tipo: PARTNER_TYPES[body.tipo] ? body.tipo : 'outro', contato: str(body.contato, 120), whatsapp: str(body.whatsapp, 20), endereco: str(body.endereco, 200), obs: str(body.obs, 500) };
  if (!d.nome) throw httpError(400, 'Informe o nome do parceiro.');
  if (id) {
    const p = get('SELECT id FROM partners WHERE id = ? AND store_id = ?', Number(id), storeId);
    if (!p) throw httpError(404, 'Parceiro não encontrado.');
    run('UPDATE partners SET nome=?, tipo=?, contato=?, whatsapp=?, endereco=?, obs=?, active=? WHERE id=?', d.nome, d.tipo, d.contato, d.whatsapp, d.endereco, d.obs, body.active === false ? 0 : 1, p.id);
    return p.id;
  }
  return run('INSERT INTO partners (store_id, nome, tipo, contato, whatsapp, endereco, obs) VALUES (?, ?, ?, ?, ?, ?, ?)', storeId, d.nome, d.tipo, d.contato, d.whatsapp, d.endereco, d.obs).lastInsertRowid;
}

function setLocation(storeId, vehicleId, body, userId) {
  const v = V.findVehicle(storeId, vehicleId);
  if (!v) throw httpError(404, 'Veículo não encontrado.');
  const status = LOCAL[body.status] ? body.status : 'patio';
  let parceiro = null;
  if (status !== 'patio' && body.parceiro_id) {
    parceiro = get('SELECT id, nome FROM partners WHERE id = ? AND store_id = ?', Number(body.parceiro_id), storeId);
    if (!parceiro) throw httpError(404, 'Parceiro não encontrado.');
  }
  const obs = str(body.obs, 300);
  run(`UPDATE vehicles SET local_status=?, local_parceiro_id=?, local_desde=datetime('now'), local_previsao=?, local_obs=?, updated_at=datetime('now') WHERE id=?`,
    status, parceiro?.id || null, status === 'patio' ? null : date(body.previsao), status === 'patio' ? '' : obs, v.id);
  run('INSERT INTO vehicle_moves (vehicle_id, status, parceiro_id, obs, user_id) VALUES (?, ?, ?, ?, ?)', v.id, status, parceiro?.id || null, obs, userId);
  logEvent(storeId, `${v.marca} ${v.modelo}: ${LOCAL[status].toLowerCase()}${parceiro ? ` (${parceiro.nome})` : ''}`);
}

function moves(vehicleId) {
  return all(`SELECT m.*, p.nome AS parceiro_nome, u.name AS user_name FROM vehicle_moves m
              LEFT JOIN partners p ON p.id = m.parceiro_id LEFT JOIN users u ON u.id = m.user_id
              WHERE m.vehicle_id = ? ORDER BY m.id DESC LIMIT 50`, vehicleId).map((m) => ({ ...m, status_label: LOCAL[m.status] || m.status }));
}

// Mensagem pronta para pedir o andamento do serviço pelo WhatsApp do parceiro.
function followUpLink(store, v, partner) {
  const wa = waNumber(partner?.whatsapp);
  if (!wa) return '';
  const carro = [v.marca, v.modelo, v.versao, v.ano_modelo].filter(Boolean).join(' ');
  const desde = v.local_desde ? new Date(String(v.local_desde).replace(' ', 'T') + 'Z').toLocaleDateString('pt-BR') : '';
  const msg = `Olá${partner.contato ? ' ' + partner.contato.split(' ')[0] : ''}, tudo bem? Aqui é da ${store.name}. Como está o andamento do serviço no ${carro}${v.placa ? ` (placa ${v.placa})` : ''}${desde ? `, que está aí desde ${desde}` : ''}? Tem previsão de entrega?`;
  return `https://wa.me/${wa}?text=${encodeURIComponent(msg)}`;
}

/* ---------------- Indicadores ---------------- */

function results(storeId, q = {}) {
  const store = get('SELECT * FROM stores WHERE id = ?', storeId);
  const from = date(q.from) || new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10);
  const to = date(q.to) || new Date().toISOString().slice(0, 10);
  const tipo = V.PROPRIEDADE.some((p) => p.key === q.tipo) ? q.tipo : '';
  const vendedor = q.vendedor ? Number(q.vendedor) : null;
  const filtro = (v) => (!tipo || v.proprietario_tipo === tipo);
  const all_ = all('SELECT * FROM vehicles WHERE store_id = ?', storeId);
  const estoque = all_.filter((v) => v.status !== 'vendido' && filtro(v));
  const vendidos = all_.filter((v) => v.status === 'vendido' && filtro(v) && (!vendedor || v.venda_vendedor_id === vendedor)
    && v.vendido_em && v.vendido_em.slice(0, 10) >= from && v.vendido_em.slice(0, 10) <= to);

  const linhas = vendidos.map((v) => {
    const f = finance(v, store);
    const dias = daysBetween(v.compra_data || v.created_at, new Date(String(v.vendido_em).replace(' ', 'T') + 'Z'));
    return {
      id: v.id, titulo: V.title(v), placa: v.placa, tipo: v.proprietario_tipo, vendido_em: v.vendido_em, dias,
      venda: f.real?.venda || 0, base: f.real?.base || 0, custos: f.custos_total, bruto: f.real?.bruto ?? null, liquido: f.real?.liquido ?? null,
      margem_pct: f.real?.margem_pct ?? null, vendedor_id: v.venda_vendedor_id,
    };
  });
  const sum = (arr, k) => arr.reduce((s, x) => s + (Number(x[k]) || 0), 0);
  const avg = (arr, k) => (arr.length ? Math.round(sum(arr, k) / arr.length) : 0);
  const comVenda = linhas.filter((l) => l.venda);
  const idade = estoque.map((v) => daysBetween(v.compra_data || v.created_at));
  const paradoDias = store.parado_dias || 25;
  const finEstoque = estoque.map((v) => finance(v, store));

  // Vendas dos últimos 6 meses (para o gráfico).
  const meses = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = d.toISOString().slice(0, 7);
    const vs = all_.filter((v) => v.status === 'vendido' && filtro(v) && String(v.vendido_em || '').startsWith(key));
    const lucro = vs.reduce((s, v) => s + (finance(v, store).real?.liquido || 0), 0);
    meses.push({ mes: key, vendidos: vs.length, lucro });
  }

  return {
    periodo: { from, to }, filtros: { tipo, vendedor },
    kpis: {
      vendidos: linhas.length,
      faturamento: sum(comVenda, 'venda'),
      lucro_bruto: sum(comVenda, 'bruto'),
      lucro_liquido: sum(comVenda, 'liquido'),
      margem_media_pct: comVenda.length ? Math.round((sum(comVenda, 'liquido') / Math.max(1, sum(comVenda, 'venda'))) * 1000) / 10 : 0,
      ticket_medio: avg(comVenda, 'venda'),
      lucro_medio: avg(comVenda, 'liquido'),
      dias_medios_venda: avg(linhas, 'dias'),
      sem_valor_venda: linhas.filter((l) => !l.venda).length,
      estoque_qtd: estoque.length,
      estoque_valor_venda: estoque.reduce((s, v) => s + (V.precoAnuncio(v) || 0), 0),
      capital_investido: finEstoque.reduce((s, f) => s + f.investido, 0),
      lucro_previsto_estoque: finEstoque.reduce((s, f) => s + (f.previsto?.liquido || 0), 0),
      idade_media_estoque: idade.length ? Math.round(idade.reduce((a, b) => a + b, 0) / idade.length) : 0,
      parados: idade.filter((d) => d >= paradoDias).length,
      parados_60: idade.filter((d) => d >= 60).length,
      em_manutencao: estoque.filter((v) => v.local_status && v.local_status !== 'patio').length,
      consignados: estoque.filter((v) => v.proprietario_tipo === 'consignado' || v.proprietario_tipo === 'procuracao').length,
      custo_medio_preparacao: estoque.length + vendidos.length
        ? Math.round([...estoque, ...vendidos].reduce((s, v) => s + finance(v, store).custos_total, 0) / (estoque.length + vendidos.length)) : 0,
      // Giro: vendidos no período ÷ estoque médio (aproximado pelo estoque atual + vendidos).
      giro: estoque.length + linhas.length ? Math.round((linhas.length / (estoque.length + linhas.length)) * 100) : 0,
    },
    parado_dias: paradoDias,
    vendidos: linhas.sort((a, b) => String(b.vendido_em).localeCompare(String(a.vendido_em))),
    meses,
  };
}

module.exports = { COST_CATS, PARTNER_TYPES, LOCAL, costsOf, finance, saveFinance, addCost, deleteCost, partners, savePartner, setLocation, moves, followUpLink, results, daysBetween, waNumber };
