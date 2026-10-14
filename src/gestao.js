// Gestão da loja: compra, custos (realizados e previstos), venda e margem por carro; parceiros e localização;
// transferência de documentação; despesas da loja; indicadores e DRE (v2.0 + v2.1).
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
// Etapas da transferência do documento depois da venda (v2.1).
const DOC_STATUS = {
  pendente: 'Aguardando preenchimento',
  preenchido: 'ATPV-e / recibo preenchido',
  assinado: 'Assinado / firma reconhecida',
  vistoria: 'Vistoria',
  transferencia: 'Em transferência (Detran / despachante)',
  comunicacao: 'Comunicação de venda realizada',
  transferido: 'Transferido (novo CRLV emitido)',
  entregue: 'Documento entregue ao comprador',
  nao_aplica: 'Não se aplica',
};
const DOC_DONE = ['entregue', 'nao_aplica'];
const PAGAMENTOS = ['À vista', 'PIX', 'Dinheiro', 'Cartão', 'Financiamento', 'Boleto', 'Consórcio', 'Troca + volta', 'Outro'];
const EXP_CATS = {
  aluguel: 'Aluguel', salarios: 'Salários e pró-labore', energia: 'Energia', agua_internet: 'Água, telefone e internet',
  marketing: 'Marketing e anúncios', sistemas: 'Sistemas e assinaturas', contador: 'Contador', impostos: 'Impostos da loja',
  manutencao: 'Manutenção da loja', combustivel: 'Combustível', comissao: 'Comissão de vendedor', outros: 'Outros',
};
// Propriedades em que a loja ganha uma margem (o carro não é dela): consignado, parceria e outro.
const TERCEIROS = ['consignado', 'parceria', 'outro'];

const int = (x) => { const n = parseInt(String(x ?? '').replace(/\D/g, ''), 10); return Number.isFinite(n) ? n : 0; };
const str = (x, max = 200) => String(x ?? '').trim().slice(0, max);
const date = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(String(x || '')) ? String(x) : null);
const httpError = (status, message) => Object.assign(new Error(message), { status });
const toDate = (a) => new Date(String(a).length <= 10 ? `${a}T12:00:00Z` : String(a).replace(' ', 'T') + (String(a).endsWith('Z') ? '' : 'Z'));
const daysBetween = (a, b = new Date()) => {
  if (!a) return 0;
  return Math.max(0, Math.floor(((b instanceof Date ? b.getTime() : Date.parse(b)) - toDate(a).getTime()) / 864e5));
};
const ORIGEM_LABEL = Object.fromEntries(V.ORIGEM.map((o) => [o.key, o.label]));
const TIPO_LABEL = Object.fromEntries(V.PROPRIEDADE.map((o) => [o.key, o.label]));

/* ---------------- Financeiro do carro ---------------- */

function costsOf(vehicleId) {
  return all(`SELECT c.*, p.nome AS parceiro_nome FROM vehicle_costs c LEFT JOIN partners p ON p.id = c.parceiro_id
              WHERE c.vehicle_id = ? ORDER BY c.status DESC, COALESCE(c.data, c.created_at), c.id`, vehicleId)
    .map((c) => ({ ...c, categoria_label: COST_CATS[c.categoria] || c.categoria, previsto: c.status === 'previsto' }));
}

// Lucro bruto e líquido, previsto (pelo preço do anúncio) e real (pela venda). Custos previstos entram na previsão.
function finance(v, store) {
  const rows = all('SELECT valor, status FROM vehicle_costs WHERE vehicle_id = ?', v.id);
  const realizados = rows.filter((c) => c.status !== 'previsto').reduce((s, c) => s + c.valor, 0);
  const previstos = rows.filter((c) => c.status === 'previsto').reduce((s, c) => s + c.valor, 0);
  const custos = realizados + previstos;
  const impostosPct = Number(store?.impostos_pct || 0) / 100;
  const preco = V.precoAnuncio(v) || 0;
  const consig = TERCEIROS.includes(v.proprietario_tipo);
  // Base: o que a loja pagou (próprio) ou o que vai repassar ao dono (consignado, parceria, outro).
  // Repasse combinado > margem fixa da loja > margem em % > valor de compra.
  const baseFor = (venda) => {
    if (!consig) return v.compra_valor || 0;
    if (v.consig_repasse) return v.consig_repasse;
    if (v.margem_tipo === 'valor' && v.margem_fixa) return Math.max(0, venda - v.margem_fixa);
    if (v.consig_comissao_pct) return Math.round(venda * (1 - v.consig_comissao_pct / 100));
    return v.compra_valor || 0;
  };
  const calc = (venda, comissao, retorno = 0) => {
    if (!venda) return null;
    if (!baseFor(venda)) return null; // sem valor de compra/repasse não dá para calcular lucro
    const bruto = venda + retorno - baseFor(venda) - custos;
    const impostos = Math.round(venda * impostosPct);
    const liquido = bruto - (comissao || 0) - impostos;
    return { venda, retorno, base: baseFor(venda), custos, bruto, comissao: comissao || 0, impostos, liquido, margem_pct: venda ? Math.round((liquido / venda) * 1000) / 10 : 0 };
  };
  const investido = (consig ? 0 : (v.compra_valor || 0)) + realizados;
  return {
    custos_total: custos,
    custos_realizados: realizados,
    custos_previstos: previstos,
    investido,
    investimento_total: investido + previstos,
    previsto: calc(preco, 0),
    real: v.status === 'vendido' ? calc(v.venda_valor || 0, v.venda_comissao, v.venda_retorno || 0) : null,
    troca_pendente: trocaPendente(v),
    base_label: consig ? 'Repasse ao dono' : 'Valor de compra',
    terceiro: consig,
    margem_loja: consig ? (v.margem_tipo === 'valor' && v.margem_fixa ? { tipo: 'valor', valor: v.margem_fixa } : v.consig_comissao_pct ? { tipo: 'pct', valor: v.consig_comissao_pct } : null) : null,
    falta_base: !(consig ? (v.consig_repasse || (v.margem_tipo === 'valor' && v.margem_fixa) || v.consig_comissao_pct || v.compra_valor) : v.compra_valor),
  };
}

// Atualiza só os campos enviados (o formulário do carro e o modal de venda mandam partes diferentes).
function saveFinance(storeId, vehicleId, body) {
  const v = V.findVehicle(storeId, vehicleId);
  if (!v) throw httpError(404, 'Veículo não encontrado.');
  const has = (k) => body[k] !== undefined;
  const f = {};
  if (has('compra_valor')) f.compra_valor = int(body.compra_valor);
  if (has('compra_data')) f.compra_data = date(body.compra_data);
  if (has('compra_de')) f.compra_de = str(body.compra_de, 120);
  if (has('compra_de_tel')) f.compra_de_tel = str(body.compra_de_tel, 20);
  if (has('compra_origem')) f.compra_origem = ORIGEM_LABEL[body.compra_origem] ? body.compra_origem : '';
  if (has('consig_repasse')) f.consig_repasse = int(body.consig_repasse);
  if (v.status === 'vendido' || has('venda_valor')) Object.assign(f, saleFields(storeId, v, body, true));
  const cols = Object.keys(f);
  if (!cols.length) return;
  run(`UPDATE vehicles SET ${cols.map((c) => `${c}=?`).join(',')}, updated_at=datetime('now') WHERE id=?`, ...cols.map((c) => f[c]), v.id);
}

// Campos da venda (usados ao marcar como vendido e ao editar depois).
function saleFields(storeId, v, body, partial) {
  const has = (k) => !partial || body[k] !== undefined;
  const f = {};
  if (has('venda_valor')) f.venda_valor = int(body.venda_valor);
  if (has('venda_comprador')) f.venda_comprador = str(body.venda_comprador, 120);
  if (has('comprador_doc')) f.comprador_doc = str(body.comprador_doc, 20).replace(/[^0-9./-]/g, '');
  if (has('comprador_tel')) f.comprador_tel = str(body.comprador_tel, 20);
  if (has('venda_pagamento')) f.venda_pagamento = str(body.venda_pagamento, 60);
  if (has('venda_entrada')) f.venda_entrada = int(body.venda_entrada);
  if (has('venda_financeira')) f.venda_financeira = str(body.venda_financeira, 80);
  if (has('venda_troca_valor')) f.venda_troca_valor = int(body.venda_troca_valor);
  if (has('venda_troca_desc')) f.venda_troca_desc = str(body.venda_troca_desc, 200);
  if (has('venda_obs')) f.venda_obs = str(body.venda_obs, 1000);
  if (has('venda_comissao')) f.venda_comissao = int(body.venda_comissao);
  if (has('venda_vendedor_id')) {
    const s = body.venda_vendedor_id ? get('SELECT id FROM users WHERE id = ? AND store_id = ?', Number(body.venda_vendedor_id), storeId) : null;
    f.venda_vendedor_id = s?.id || null;
  }
  // v2.5: composição do pagamento (à vista + troca + financiamento + boletos, em qualquer combinação).
  for (const k of ['venda_financiado', 'venda_fin_parcelas', 'venda_fin_parcela', 'venda_retorno', 'venda_boleto_qtd', 'venda_boleto_valor']) if (has(k)) f[k] = int(body[k]);
  if (has('venda_troca_id')) {
    const t = body.venda_troca_id ? get('SELECT id FROM vehicles WHERE id = ? AND store_id = ? AND id != ?', Number(body.venda_troca_id), storeId, v.id) : null;
    f.venda_troca_id = t?.id || null;
  }
  // Total = soma das partes, quando informadas e o total não veio.
  const partes = (f.venda_entrada ?? v.venda_entrada ?? 0) + (f.venda_troca_valor ?? v.venda_troca_valor ?? 0) + (f.venda_financiado ?? v.venda_financiado ?? 0)
    + (f.venda_boleto_qtd ?? v.venda_boleto_qtd ?? 0) * (f.venda_boleto_valor ?? v.venda_boleto_valor ?? 0);
  if (has('venda_valor') && !f.venda_valor && partes) f.venda_valor = partes;
  if (body.venda_data !== undefined && date(body.venda_data)) f.vendido_em = `${body.venda_data} 12:00:00`;
  return f;
}

// Carro que entrou na troca: liga ao carro vendido e grava a compra pelo valor dado na troca.
// O lucro da venda com troca só é "realizado" quando o carro da troca for vendido (ver realizadoEm).
function applyTrade(storeId, vehicleId, body, userId) {
  const v = get('SELECT * FROM vehicles WHERE id = ? AND store_id = ?', Number(vehicleId), storeId);
  if (!v) return null;
  let trocaId = v.venda_troca_id;
  const n = body.troca_novo;
  if (!trocaId && n && str(n.marca) && str(n.modelo)) {
    const d = V.cleanInput({ marca: n.marca, modelo: n.modelo, versao: n.versao, ano_fab: n.ano, ano_modelo: n.ano, placa: n.placa, km: n.km, cor: n.cor });
    d.created_by = userId;
    const cols = Object.keys(d);
    trocaId = run(`INSERT INTO vehicles (store_id, ${cols.join(',')}) VALUES (?, ${cols.map(() => '?').join(',')})`, storeId, ...cols.map((k) => d[k])).lastInsertRowid;
    run('UPDATE vehicles SET venda_troca_id = ? WHERE id = ?', trocaId, v.id);
    if (!v.venda_troca_desc) run('UPDATE vehicles SET venda_troca_desc = ? WHERE id = ?', `${d.marca} ${d.modelo}${d.placa ? ' ' + d.placa : ''}`, v.id);
    logEvent(storeId, `${d.marca} ${d.modelo} entrou na troca do ${v.marca} ${v.modelo}`);
  }
  // Desfaz a ligação antiga se a troca mudou.
  run('UPDATE vehicles SET troca_de_id = NULL WHERE store_id = ? AND troca_de_id = ? AND id != ?', storeId, v.id, trocaId || 0);
  if (!trocaId) return null;
  const t = get('SELECT * FROM vehicles WHERE id = ?', trocaId);
  const upd = { troca_de_id: v.id, compra_origem: 'troca' };
  if (v.venda_troca_valor && (!t.compra_valor || t.troca_de_id === v.id || !t.troca_de_id)) upd.compra_valor = v.venda_troca_valor;
  if (!t.compra_data && v.vendido_em) upd.compra_data = String(v.vendido_em).slice(0, 10);
  if (!t.compra_de && v.venda_comprador) upd.compra_de = v.venda_comprador;
  if (!t.compra_de_tel && v.comprador_tel) upd.compra_de_tel = v.comprador_tel;
  const cols = Object.keys(upd);
  run(`UPDATE vehicles SET ${cols.map((c) => `${c}=?`).join(',')} WHERE id = ?`, ...cols.map((c) => upd[c]), t.id);
  return t.id;
}

// Lucro ainda "em troca": algum carro da cadeia de trocas não foi vendido.
function trocaPendente(v) {
  let cur = v;
  for (let i = 0; i < 20 && cur && cur.status === 'vendido' && cur.venda_troca_id; i++) {
    const t = get('SELECT id, status, venda_troca_id FROM vehicles WHERE id = ?', cur.venda_troca_id);
    if (!t) return false;
    if (t.status !== 'vendido') return true;
    cur = t;
  }
  return false;
}

// Data em que o lucro de uma venda fica realizado: venda sem troca = data da venda;
// venda com troca = quando o carro da troca for vendido (em cadeia, até uma venda sem troca).
function realizadoEm(v, byId, depth = 0) {
  if (!v || v.status !== 'vendido') return null;
  if (!v.venda_troca_id || depth > 20) return v.vendido_em;
  const t = byId.get(v.venda_troca_id);
  if (!t) return v.vendido_em;
  if (t.status !== 'vendido') return null;
  return realizadoEm(t, byId, depth + 1);
}

function addCost(storeId, vehicleId, body, userId) {
  const v = V.findVehicle(storeId, vehicleId);
  if (!v) throw httpError(404, 'Veículo não encontrado.');
  const valor = int(body.valor);
  if (!valor) throw httpError(400, 'Informe o valor do custo.');
  const parceiro = body.parceiro_id ? get('SELECT id FROM partners WHERE id = ? AND store_id = ?', Number(body.parceiro_id), storeId) : null;
  const status = body.status === 'previsto' ? 'previsto' : 'realizado';
  return run('INSERT INTO vehicle_costs (vehicle_id, categoria, descricao, valor, data, parceiro_id, created_by, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    v.id, COST_CATS[body.categoria] ? body.categoria : 'outros', str(body.descricao, 200), valor, date(body.data) || new Date().toISOString().slice(0, 10), parceiro?.id || null, userId, status).lastInsertRowid;
}

// Custo previsto que foi feito: vira realizado (com o valor final, se mudou).
function updateCost(storeId, vehicleId, costId, body) {
  const v = V.findVehicle(storeId, vehicleId);
  if (!v) throw httpError(404, 'Veículo não encontrado.');
  const c = get('SELECT * FROM vehicle_costs WHERE id = ? AND vehicle_id = ?', Number(costId), v.id);
  if (!c) throw httpError(404, 'Custo não encontrado.');
  const status = body.status === 'previsto' ? 'previsto' : body.status === 'realizado' ? 'realizado' : c.status;
  const valor = body.valor !== undefined ? int(body.valor) || c.valor : c.valor;
  const data = date(body.data) || (status === 'realizado' && c.status === 'previsto' ? new Date().toISOString().slice(0, 10) : c.data);
  const descricao = body.descricao !== undefined ? str(body.descricao, 200) : c.descricao;
  const categoria = COST_CATS[body.categoria] ? body.categoria : c.categoria;
  const parceiro = body.parceiro_id !== undefined ? (body.parceiro_id ? get('SELECT id FROM partners WHERE id = ? AND store_id = ?', Number(body.parceiro_id), storeId)?.id || null : null) : c.parceiro_id;
  run('UPDATE vehicle_costs SET status = ?, valor = ?, data = ?, descricao = ?, categoria = ?, parceiro_id = ? WHERE id = ?', status, valor, data, descricao, categoria, parceiro, c.id);
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
  const desde = v.local_desde ? toDate(v.local_desde).toLocaleDateString('pt-BR') : '';
  const msg = `Olá${partner.contato ? ' ' + partner.contato.split(' ')[0] : ''}, tudo bem? Aqui é da ${store.name}. Como está o andamento do serviço no ${carro}${v.placa ? ` (placa ${v.placa})` : ''}${desde ? `, que está aí desde ${desde}` : ''}? Tem previsão de entrega?`;
  return `https://wa.me/${wa}?text=${encodeURIComponent(msg)}`;
}

/* ---------------- Documentação de transferência (v2.1) ---------------- */

function setDocStatus(storeId, vehicleId, body, userId) {
  const v = V.findVehicle(storeId, vehicleId);
  if (!v) throw httpError(404, 'Veículo não encontrado.');
  if (v.status !== 'vendido') throw httpError(409, 'A transferência só é acompanhada depois da venda.');
  const status = DOC_STATUS[body.status] ? body.status : (v.doc_status || 'pendente');
  const obs = str(body.obs, 500);
  const entrega = status === 'entregue' ? (date(body.entrega) || new Date().toISOString().slice(0, 10)) : null;
  run(`UPDATE vehicles SET doc_status=?, doc_atualizado=datetime('now'), doc_obs=?, doc_entrega=? WHERE id=?`, status, obs || v.doc_obs || '', entrega, v.id);
  run('INSERT INTO doc_moves (vehicle_id, status, obs, user_id) VALUES (?, ?, ?, ?)', v.id, status, obs, userId);
  if (status !== v.doc_status) logEvent(storeId, `Documento do ${v.marca} ${v.modelo}: ${DOC_STATUS[status].toLowerCase()}`);
}

function docMoves(vehicleId) {
  return all(`SELECT m.*, u.name AS user_name FROM doc_moves m LEFT JOIN users u ON u.id = m.user_id WHERE m.vehicle_id = ? ORDER BY m.id DESC LIMIT 50`, vehicleId)
    .map((m) => ({ ...m, status_label: DOC_STATUS[m.status] || m.status }));
}

// Carros vendidos com a transferência em andamento (e os concluídos nos últimos 90 dias).
function docList(storeId) {
  const store = get('SELECT name FROM stores WHERE id = ?', storeId);
  const keys = Object.keys(DOC_STATUS);
  return all(`SELECT v.*, u.name AS vendedor_nome FROM vehicles v LEFT JOIN users u ON u.id = v.venda_vendedor_id
              WHERE v.store_id = ? AND v.status = 'vendido' ORDER BY v.vendido_em DESC`, storeId)
    .map((v) => {
      const st = v.doc_status || 'pendente';
      const done = DOC_DONE.includes(st);
      const wa = waNumber(v.comprador_tel);
      const msg = `Olá${v.venda_comprador ? ' ' + v.venda_comprador.split(' ')[0] : ''}, aqui é da ${store.name}. Passando para atualizar sobre a documentação do ${V.title(v)}${v.placa ? ` (placa ${v.placa})` : ''}: ${(DOC_STATUS[st] || '').toLowerCase()}.`;
      return {
        id: v.id, titulo: V.title(v), placa: v.placa, vendido_em: v.vendido_em, dias: daysBetween(v.vendido_em),
        comprador: v.venda_comprador, comprador_tel: v.comprador_tel, vendedor: v.vendedor_nome || '', doc_tipo: v.doc_tipo,
        status: st, status_label: DOC_STATUS[st] || st, etapa: keys.indexOf(st), done, obs: v.doc_obs || '', atualizado: v.doc_atualizado, entrega: v.doc_entrega,
        wa_url: wa ? `https://wa.me/${wa}?text=${encodeURIComponent(msg)}` : '',
      };
    })
    .filter((d) => !d.done || daysBetween(d.entrega || d.atualizado || d.vendido_em) <= 90);
}

/* ---------------- Despesas da loja (v2.1) ---------------- */

function expenses(storeId, from, to) {
  return all(`SELECT e.*, u.name AS vendedor_nome, v.marca, v.modelo, v.placa FROM store_expenses e LEFT JOIN users u ON u.id = e.vendedor_id LEFT JOIN vehicles v ON v.id = e.vehicle_id
              WHERE e.store_id = ? AND e.data >= ? AND e.data <= ? ORDER BY e.data DESC, e.id DESC`, storeId, from, to)
    .map((e) => ({ ...e, categoria_label: EXP_CATS[e.categoria] || e.categoria, veiculo: e.marca ? `${e.marca} ${e.modelo}${e.placa ? ' ' + e.placa : ''}` : '' }));
}
function addExpense(storeId, body) {
  const valor = int(body.valor);
  if (!valor) throw httpError(400, 'Informe o valor da despesa.');
  const meses = Math.max(1, Math.min(12, parseInt(body.repetir, 10) || 1));
  const d0 = date(body.data) || new Date().toISOString().slice(0, 10);
  const cat = EXP_CATS[body.categoria] ? body.categoria : 'outros';
  const vend = body.vendedor_id ? get('SELECT id FROM users WHERE id = ? AND store_id = ?', Number(body.vendedor_id), storeId)?.id || null : null;
  if (cat === 'comissao' && !vend) throw httpError(400, 'Informe o vendedor da comissão.');
  const veic = body.vehicle_id ? get('SELECT id FROM vehicles WHERE id = ? AND store_id = ?', Number(body.vehicle_id), storeId)?.id || null : null;
  for (let i = 0; i < meses; i++) {
    const d = new Date(`${d0}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + i);
    // Conta a pagar (pago=false): a data é o vencimento. Em repetição, só a primeira pode já estar paga.
    const pago = body.pago === false || body.pago === '0' ? 0 : (i === 0 ? 1 : (body.repetir_pago ? 1 : 0));
    run('INSERT INTO store_expenses (store_id, data, categoria, descricao, valor, vendedor_id, vehicle_id, pago, pago_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      storeId, d.toISOString().slice(0, 10), cat, str(body.descricao, 200), valor, vend, veic, pago, pago ? d.toISOString().slice(0, 10) : null);
  }
}
function deleteExpense(storeId, id) { run('DELETE FROM store_expenses WHERE id = ? AND store_id = ?', Number(id), storeId); }
function payExpense(storeId, id, pago = true) {
  run(`UPDATE store_expenses SET pago = ?, pago_em = CASE WHEN ? = 1 THEN date('now') ELSE NULL END WHERE id = ? AND store_id = ?`, pago ? 1 : 0, pago ? 1 : 0, Number(id), storeId);
}
// Contas em aberto: vencidas e a vencer nos próximos dias.
function contasAbertas(storeId, dias = 15) {
  return all(`SELECT * FROM store_expenses WHERE store_id = ? AND pago = 0 AND data <= date('now', '+${Number(dias)} days') ORDER BY data`, storeId)
    .map((e) => ({ ...e, categoria_label: EXP_CATS[e.categoria] || e.categoria, vencida: e.data < new Date().toISOString().slice(0, 10) }));
}

/* ---------------- Indicadores ---------------- */

const FAIXAS = [[0, 15, 'Até 15 dias'], [16, 30, '16 a 30'], [31, 45, '31 a 45'], [46, 60, '46 a 60'], [61, 90, '61 a 90'], [91, 1e9, 'Mais de 90']];
const faixaDe = (d) => FAIXAS.findIndex(([a, b]) => d >= a && d <= b);

function results(storeId, q = {}) {
  const store = get('SELECT * FROM stores WHERE id = ?', storeId);
  const from = date(q.from) || new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10);
  const to = date(q.to) || new Date().toISOString().slice(0, 10);
  const tipo = V.PROPRIEDADE.some((p) => p.key === q.tipo) ? q.tipo : '';
  const origem = ORIGEM_LABEL[q.origem] ? q.origem : '';
  const vendedor = q.vendedor ? Number(q.vendedor) : null;
  const filtro = (v) => (!tipo || v.proprietario_tipo === tipo) && (!origem || v.compra_origem === origem);
  const users = Object.fromEntries(all('SELECT id, name FROM users WHERE store_id = ?', storeId).map((u) => [u.id, u.name]));
  const all_ = all('SELECT * FROM vehicles WHERE store_id = ?', storeId);
  const estoque = all_.filter((v) => v.status !== 'vendido' && filtro(v));
  const soldIn = (v, a, b) => v.status === 'vendido' && v.vendido_em && v.vendido_em.slice(0, 10) >= a && v.vendido_em.slice(0, 10) <= b;
  const vendidos = all_.filter((v) => soldIn(v, from, to) && filtro(v) && (!vendedor || v.venda_vendedor_id === vendedor));
  const byId = new Map(all_.map((v) => [v.id, v]));

  const linha = (v) => {
    const f = finance(v, store);
    const dias = daysBetween(v.compra_data || v.created_at, toDate(v.vendido_em));
    return {
      id: v.id, titulo: V.title(v), marca: v.marca, placa: v.placa, tipo: v.proprietario_tipo, tipo_label: TIPO_LABEL[v.proprietario_tipo] || '',
      origem: v.compra_origem || '', origem_label: ORIGEM_LABEL[v.compra_origem] || 'Não informada', vendido_em: v.vendido_em, dias,
      venda: f.real?.venda || v.venda_valor || 0, base: f.real?.base || 0, custos: f.custos_total, bruto: f.real?.bruto ?? null,
      comissao: v.venda_comissao || 0, impostos: f.real?.impostos || 0, liquido: f.real?.liquido ?? null, margem_pct: f.real?.margem_pct ?? null,
      vendedor_id: v.venda_vendedor_id, vendedor: users[v.venda_vendedor_id] || '', pagamento: v.venda_pagamento || 'Não informado',
      comprador: v.venda_comprador || '', doc_status: v.doc_status || 'pendente', anunciado: V.precoAnuncio(v) || 0,
      retorno: v.venda_retorno || 0, troca_valor: v.venda_troca_valor || 0, troca_id: v.venda_troca_id || null,
      troca_titulo: v.venda_troca_id && byId.get(v.venda_troca_id) ? V.title(byId.get(v.venda_troca_id)) : (v.venda_troca_desc || ''),
      realizado_em: realizadoEm(v, byId), em_troca: !realizadoEm(v, byId),
    };
  };
  const linhas = vendidos.map(linha);
  // Lucro realizado no período: vendas sem troca no período e cadeias de troca que terminaram no período.
  const realizIn = (v, a, b) => { const r = realizadoEm(v, byId); return r && r.slice(0, 10) >= a && r.slice(0, 10) <= b; };
  const realizadas = all_.filter((v) => v.status === 'vendido' && filtro(v) && (!vendedor || v.venda_vendedor_id === vendedor) && realizIn(v, from, to)).map(linha);
  const aRealizar = all_.filter((v) => v.status === 'vendido' && filtro(v) && (!vendedor || v.venda_vendedor_id === vendedor) && !realizadoEm(v, byId)).map(linha);
  const sum = (arr, k) => arr.reduce((s, x) => s + (Number(x[k]) || 0), 0);
  const avg = (arr, k) => (arr.length ? Math.round(sum(arr, k) / arr.length) : 0);
  const comLucro = realizadas.filter((l) => l.liquido !== null);
  const paradoDias = store.parado_dias || 25;

  // Estoque com idade, investimento e lucro previsto.
  const est = estoque.map((v) => {
    const f = finance(v, store);
    const dias = daysBetween(v.compra_data || v.created_at);
    return {
      id: v.id, titulo: V.title(v), placa: v.placa, status: v.status, tipo_label: TIPO_LABEL[v.proprietario_tipo] || '', origem_label: ORIGEM_LABEL[v.compra_origem] || '',
      dias, parado: dias >= paradoDias, preco: V.precoAnuncio(v) || 0, fipe: v.fipe || 0, compra: v.proprietario_tipo === 'consignado' ? 0 : (v.compra_valor || 0),
      custos: f.custos_realizados, previstos: f.custos_previstos, investido: f.investido, lucro_previsto: f.previsto?.liquido ?? null,
      margem_prevista: f.previsto?.margem_pct ?? null, local: v.local_status && v.local_status !== 'patio' ? LOCAL[v.local_status] : '', falta_base: f.falta_base,
    };
  }).sort((a, b) => b.dias - a.dias);

  // Despesas da loja no período e DRE.
  const despAll = expenses(storeId, from, to);
  // Comissões lançadas como despesa (com o vendedor) entram na linha de comissões, não nas despesas fixas.
  const comExtra = despAll.filter((e) => e.categoria === 'comissao' && (!vendedor || e.vendedor_id === vendedor));
  const desp = despAll.filter((e) => e.categoria !== 'comissao');
  const despesas = vendedor ? 0 : desp.reduce((s, e) => s + e.valor, 0);
  const comissoesExtra = comExtra.reduce((s, e) => s + e.valor, 0);
  const porCat = {};
  if (!vendedor) desp.forEach((e) => { porCat[e.categoria_label] = (porCat[e.categoria_label] || 0) + e.valor; });
  const dre = {
    receita: sum(comLucro, 'venda'),
    retorno_financiamento: sum(comLucro, 'retorno'),
    receita_em_trocas: sum(comLucro, 'troca_valor'),
    custo_veiculos: sum(comLucro, 'base'),
    preparacao: sum(comLucro, 'custos'),
    lucro_bruto: sum(comLucro, 'bruto'),
    comissoes: sum(comLucro, 'comissao'),
    comissoes_extra: comissoesExtra,
    impostos: sum(comLucro, 'impostos'),
    lucro_operacoes: sum(comLucro, 'liquido') - comissoesExtra,
    despesas_loja: despesas,
    despesas_categorias: Object.entries(porCat).map(([categoria, valor]) => ({ categoria, valor })).sort((a, b) => b.valor - a.valor),
    resultado: sum(comLucro, 'liquido') - comissoesExtra - despesas,
    fora_do_calculo: linhas.filter((l) => !l.em_troca && l.liquido === null).length,
    // Lucro de vendas com troca que só fica realizado quando o carro da troca for vendido.
    a_realizar: aRealizar.reduce((s, l) => s + (l.liquido || 0), 0),
    a_realizar_qtd: aRealizar.length,
  };

  const group = (arr, keyFn, labelFn) => {
    const m = new Map();
    arr.forEach((l) => {
      const k = keyFn(l);
      if (!m.has(k)) m.set(k, { chave: k, label: labelFn(l), qtd: 0, faturamento: 0, lucro: 0, dias: 0, comissao: 0 });
      const g = m.get(k);
      g.qtd++; g.faturamento += l.venda || 0; g.lucro += l.liquido || 0; g.dias += l.dias; g.comissao += l.comissao || 0;
    });
    return [...m.values()].map((g) => ({ ...g, dias_medio: Math.round(g.dias / g.qtd), ticket: Math.round(g.faturamento / g.qtd) })).sort((a, b) => b.qtd - a.qtd || b.faturamento - a.faturamento);
  };

  // Últimos 12 meses (gráficos).
  const meses = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = d.toISOString().slice(0, 7);
    const ls = all_.filter((v) => v.status === 'vendido' && filtro(v) && String(v.vendido_em || '').startsWith(key)).map(linha);
    const lr = all_.filter((v) => v.status === 'vendido' && filtro(v) && String(realizadoEm(v, byId) || '').startsWith(key)).map(linha);
    const dsp = get('SELECT COALESCE(SUM(valor),0) s FROM store_expenses WHERE store_id = ? AND substr(data,1,7) = ?', storeId, key).s;
    meses.push({ mes: key, vendidos: ls.length, faturamento: sum(ls, 'venda'), lucro: sum(lr, 'liquido'), despesas: dsp, dias_medio: avg(ls, 'dias') });
  }

  const faixasVenda = FAIXAS.map(([, , label]) => ({ label, qtd: 0 }));
  linhas.forEach((l) => faixasVenda[faixaDe(l.dias)].qtd++);
  const faixasEstoque = FAIXAS.map(([, , label]) => ({ label, qtd: 0, valor: 0, investido: 0 }));
  est.forEach((e) => { const f = faixasEstoque[faixaDe(e.dias)]; f.qtd++; f.valor += e.preco; f.investido += e.investido; });

  const docs = all_.filter((v) => v.status === 'vendido' && !DOC_DONE.includes(v.doc_status || 'pendente'));
  const ord = [...comLucro].sort((a, b) => b.liquido - a.liquido);

  return {
    periodo: { from, to }, filtros: { tipo, vendedor, origem },
    kpis: {
      vendidos: linhas.length,
      faturamento: sum(linhas, 'venda'),
      lucro_bruto: dre.lucro_bruto,
      lucro_liquido: dre.lucro_operacoes,
      resultado: dre.resultado,
      despesas_loja: despesas,
      margem_media_pct: comLucro.length ? Math.round((dre.lucro_operacoes / Math.max(1, dre.receita)) * 1000) / 10 : 0,
      ticket_medio: avg(linhas.filter((l) => l.venda), 'venda'),
      lucro_medio: avg(comLucro, 'liquido'),
      dias_medios_venda: avg(linhas, 'dias'),
      desconto_medio_pct: (() => { const c = linhas.filter((l) => l.venda && l.anunciado); return c.length ? Math.round((1 - sum(c, 'venda') / sum(c, 'anunciado')) * 1000) / 10 : 0; })(),
      sem_valor_venda: linhas.filter((l) => !l.venda).length,
      sem_lucro: linhas.filter((l) => !l.em_troca && l.liquido === null).length,
      lucro_a_realizar: aRealizar.reduce((s, l) => s + (l.liquido || 0), 0),
      vendas_em_troca: aRealizar.length,
      recebido_sem_troca: sum(linhas, 'venda') - sum(linhas, 'troca_valor'),
      estoque_qtd: est.length,
      estoque_valor_venda: sum(est, 'preco'),
      estoque_fipe: sum(est, 'fipe'),
      capital_investido: sum(est, 'investido'),
      custos_previstos: sum(est, 'previstos'),
      lucro_previsto_estoque: est.reduce((s, e) => s + (e.lucro_previsto || 0), 0),
      idade_media_estoque: avg(est, 'dias'),
      parados: est.filter((e) => e.parado).length,
      parados_60: est.filter((e) => e.dias >= 60).length,
      em_manutencao: est.filter((e) => e.local).length,
      consignados: estoque.filter((v) => v.proprietario_tipo === 'consignado').length,
      docs_pendentes: docs.length,
      docs_atrasados: docs.filter((v) => daysBetween(v.vendido_em) > 30).length,
      custo_medio_preparacao: estoque.length + vendidos.length
        ? Math.round([...estoque, ...vendidos].reduce((s, v) => s + finance(v, store).custos_total, 0) / (estoque.length + vendidos.length)) : 0,
      // Giro: vendidos no período ÷ (estoque atual + vendidos).
      giro: est.length + linhas.length ? Math.round((linhas.length / (est.length + linhas.length)) * 100) : 0,
    },
    dre,
    parado_dias: paradoDias,
    vendidos: linhas.sort((a, b) => String(b.vendido_em).localeCompare(String(a.vendido_em))),
    em_troca: aRealizar.map((l) => ({ id: l.id, titulo: l.titulo, vendido_em: l.vendido_em, liquido: l.liquido, troca_id: l.troca_id, troca_titulo: l.troca_titulo })),
    estoque: est,
    meses,
    faixas_venda: faixasVenda,
    faixas_estoque: faixasEstoque,
    vendedores: (() => {
      const g = group(linhas, (l) => l.vendedor_id || 0, (l) => l.vendedor || 'Sem vendedor');
      comExtra.forEach((e) => {
        let r = g.find((x) => x.chave === e.vendedor_id);
        if (!r) { r = { chave: e.vendedor_id, label: e.vendedor_nome || 'Vendedor', qtd: 0, faturamento: 0, lucro: 0, dias: 0, comissao: 0, dias_medio: 0, ticket: 0 }; g.push(r); }
        r.comissao += e.valor;
      });
      return g;
    })(),
    pagamentos: group(linhas, (l) => l.pagamento, (l) => l.pagamento),
    origens: group(linhas, (l) => l.origem || '-', (l) => l.origem_label),
    marcas: group(linhas, (l) => l.marca, (l) => l.marca),
    tipos: group(linhas, (l) => l.tipo, (l) => l.tipo_label),
    melhores: ord.slice(0, 5),
    piores: ord.length > 5 ? ord.slice(-5).reverse() : [],
  };
}

// Planilha CSV das vendas do período (abre no Excel com ; e acentos).
function resultsCsv(storeId, q) {
  const r = results(storeId, q);
  const head = ['Data da venda', 'Veículo', 'Placa', 'Propriedade', 'Origem', 'Vendedor', 'Comprador', 'Pagamento', 'Dias até vender', 'Valor da venda', 'Compra/repasse', 'Custos', 'Lucro bruto', 'Comissão', 'Impostos', 'Lucro líquido', 'Margem %', 'Documento'];
  const cell = (x) => { const s = String(x ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = r.vendidos.map((l) => [toDate(l.vendido_em).toLocaleDateString('pt-BR'), l.titulo, l.placa, l.tipo_label, l.origem_label, l.vendedor, l.comprador, l.pagamento, l.dias,
    l.venda, l.base, l.custos, l.bruto ?? '', l.comissao, l.impostos, l.liquido ?? '', l.margem_pct === null ? '' : String(l.margem_pct).replace('.', ','), DOC_STATUS[l.doc_status] || '']);
  return '﻿' + [head, ...rows].map((x) => x.map(cell).join(';')).join('\r\n');
}

module.exports = {
  TERCEIROS, COST_CATS, PARTNER_TYPES, LOCAL, DOC_STATUS, DOC_DONE, PAGAMENTOS, EXP_CATS,
  costsOf, finance, saveFinance, saleFields, addCost, updateCost, deleteCost, partners, savePartner, setLocation, moves, followUpLink,
  applyTrade, realizadoEm, setDocStatus, docMoves, docList, expenses, addExpense, deleteExpense, payExpense, contasAbertas, results, resultsCsv, daysBetween, waNumber,
};
