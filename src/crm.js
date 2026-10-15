// CRM (v2.9): leads de todas as origens num funil, distribuição entre vendedores, histórico, visitas e tarefas.
const { get, all, run, tx, logEvent } = require('./db');
const C = require('./contatos');
const V = require('./vehicles');

const ETAPAS = [
  ['novo', 'Novo'], ['atendimento', 'Em atendimento'], ['qualificado', 'Qualificado'], ['visita', 'Visita agendada'],
  ['visitou', 'Visitou'], ['proposta', 'Proposta'], ['vendido', 'Vendido'], ['perdido', 'Perdido'],
];
const ETAPA = Object.fromEntries(ETAPAS);
const ABERTAS = ['novo', 'atendimento', 'qualificado', 'visita', 'visitou', 'proposta'];
const ORIGENS = {
  vitrine: 'Site da loja', qr: 'QR code no carro', bot: 'Assistente do site', whatsapp: 'WhatsApp', instagram: 'Instagram',
  facebook: 'Facebook', marketplace: 'Marketplace', webmotors: 'Webmotors', olx: 'OLX', icarros: 'iCarros', mobiauto: 'Mobiauto',
  mercadolivre: 'Mercado Livre', napista: 'NaPista', portal: 'Outro portal', loja: 'Visita na loja', telefone: 'Telefone',
  indicacao: 'Indicação', cliente: 'Cliente antigo', outro: 'Outro',
};
const MOTIVOS = ['Comprou em outra loja', 'Preço / negociação', 'Financiamento não aprovado', 'Avaliação da troca', 'Sem resposta / desistiu', 'Carro já vendido', 'Só pesquisando', 'Outro'];
const TEMPERATURAS = { quente: 'Quente', morno: 'Morno', frio: 'Frio' };
const VISITA_STATUS = { agendada: 'Agendada', confirmada: 'Confirmada', realizada: 'Compareceu', faltou: 'Não compareceu', cancelada: 'Cancelada' };
const VISITA_TIPOS = { visita: 'Visita', test_drive: 'Test-drive', avaliacao: 'Avaliação da troca', entrega: 'Entrega' };
const PAGAMENTOS = { '': '—', avista: 'À vista', financiado: 'Financiado', troca: 'Troca + diferença', consorcio: 'Consórcio', indefinido: 'Ainda não sabe' };

const str = (x, max = 200) => String(x ?? '').trim().slice(0, max);
const httpError = (status, message) => Object.assign(new Error(message), { status });
const int = (x) => { const n = parseInt(String(x ?? '').replace(/\D/g, ''), 10); return Number.isFinite(n) ? n : 0; };
const json = (s, d) => { try { return JSON.parse(s || ''); } catch { return d; } };
const agora = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

/* ---------------- Configuração ---------------- */
const CFG_PADRAO = { distribuicao: 'rodizio', vendedores: [], sla_min: 15, horarios: 'Segunda a sexta, das 8h às 18h; sábado, das 8h às 12h.', rr: 0 };
function config(storeId) {
  return { ...CFG_PADRAO, ...json(get('SELECT crm_config FROM stores WHERE id = ?', storeId)?.crm_config, {}) };
}
function saveConfig(storeId, patch) {
  const c = { ...config(storeId), ...patch };
  run('UPDATE stores SET crm_config = ? WHERE id = ?', JSON.stringify(c), storeId);
  return c;
}
function publicConfig(storeId) {
  const c = config(storeId);
  return { distribuicao: c.distribuicao, vendedores: c.vendedores, sla_min: c.sla_min, horarios: c.horarios };
}
function updateConfig(storeId, b) {
  const users = new Set(all('SELECT id FROM users WHERE store_id = ?', storeId).map((u) => u.id));
  return saveConfig(storeId, {
    distribuicao: ['rodizio', 'manual'].includes(b.distribuicao) ? b.distribuicao : 'rodizio',
    vendedores: (Array.isArray(b.vendedores) ? b.vendedores : []).map(Number).filter((id) => users.has(id)),
    sla_min: Math.min(1440, Math.max(1, int(b.sla_min) || 15)),
    horarios: str(b.horarios, 300),
  });
}

// Quem recebe leads: os escolhidos na configuração, ou todos os usuários ativos que podem vender.
function vendedores(storeId) {
  const T = require('./team');
  const c = config(storeId);
  const ativos = all('SELECT id, name, role, permissions FROM users WHERE store_id = ? AND active = 1 ORDER BY id', storeId);
  const podem = ativos.filter((u) => T.permsOf(u).has('vender'));
  const escolhidos = c.vendedores.length ? podem.filter((u) => c.vendedores.includes(u.id)) : podem;
  return escolhidos.length ? escolhidos : podem;
}

function distribuir(storeId) {
  const c = config(storeId);
  if (c.distribuicao !== 'rodizio') return null;
  const vs = vendedores(storeId);
  if (!vs.length) return null;
  const i = vs.findIndex((u) => u.id === c.rr);
  const prox = vs[(i + 1) % vs.length];
  saveConfig(storeId, { rr: prox.id });
  return prox.id;
}

/* ---------------- Leads ---------------- */
function addEvent(leadId, tipo, texto, userId = null) {
  run('INSERT INTO lead_events (lead_id, tipo, texto, user_id) VALUES (?, ?, ?, ?)', leadId, tipo, str(texto, 4000), userId);
}

function veiculoDaLoja(storeId, id) {
  const n = Number(id) || 0;
  return n ? get('SELECT id, marca, modelo, versao, ano_modelo, placa FROM vehicles WHERE id = ? AND store_id = ?', n, storeId) : null;
}

/**
 * Cria um lead (ou junta ao lead em aberto do mesmo telefone).
 * @returns {{ id: number, novo: boolean }}
 */
function createLead(storeId, b, { userId = null, origem } = {}) {
  const tel = C.fone(b.telefone);
  const email = str(b.email, 160).toLowerCase();
  const nome = str(b.nome, 120);
  if (tel && (tel.length < 10 || tel.length > 11)) throw httpError(400, 'Telefone inválido: informe DDD + número.');
  if (!tel && !email && !nome) throw httpError(400, 'Informe ao menos o nome e o telefone do cliente.');
  const org = ORIGENS[origem || b.origem] ? (origem || b.origem) : 'outro';
  const veic = veiculoDaLoja(storeId, b.vehicle_id);
  const msg = str(b.mensagem, 2000);
  return tx(() => {
    const aberto = (tel && get(`SELECT * FROM leads WHERE store_id = ? AND telefone = ? AND etapa IN (${ABERTAS.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 1`, storeId, tel, ...ABERTAS))
      || (email && get(`SELECT * FROM leads WHERE store_id = ? AND email = ? AND etapa IN (${ABERTAS.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 1`, storeId, email, ...ABERTAS));
    if (aberto) {
      const sets = ['ultimo_contato = ?', "updated_at = datetime('now')"]; const vals = [agora()];
      if (!aberto.nome && nome) { sets.push('nome = ?'); vals.push(nome); }
      if (!aberto.email && email) { sets.push('email = ?'); vals.push(email); }
      if (!aberto.vehicle_id && veic) { sets.push('vehicle_id = ?'); vals.push(veic.id); }
      run(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`, ...vals, aberto.id);
      addEvent(aberto.id, 'contato', `Novo contato pelo ${ORIGENS[org]}${veic ? ` sobre o ${V.title(veic)}` : ''}${msg ? `: "${msg}"` : ''}`, userId);
      return { id: aberto.id, novo: false };
    }
    const contactId = tel ? C.upsert(storeId, { nome, telefone: tel, papel: 'lead', origem: ORIGENS[org] }) : null;
    const vendedor = Number(b.vendedor_id) || distribuir(storeId);
    const id = Number(run(`INSERT INTO leads (store_id, contact_id, nome, telefone, email, origem, origem_detalhe, vehicle_id, interesse, orcamento, troca, pagamento, temperatura, etapa, vendedor_id, obs, ultimo_contato, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'novo', ?, ?, ?, ?)`,
    storeId, contactId, nome, tel, email, org, str(b.origem_detalhe, 200), veic?.id || null, str(b.interesse, 300), int(b.orcamento), str(b.troca, 300),
    PAGAMENTOS[b.pagamento] !== undefined ? b.pagamento : '', TEMPERATURAS[b.temperatura] ? b.temperatura : 'morno', vendedor || null, str(b.obs, 2000), agora(), userId).lastInsertRowid);
    if (userId) run('UPDATE leads SET primeira_resposta_em = created_at WHERE id = ?', id);
    addEvent(id, 'criado', `Lead criado (${ORIGENS[org]})${veic ? ` — interesse no ${V.title(veic)}` : ''}${msg ? `: "${msg}"` : ''}`, userId);
    if (vendedor) addEvent(id, 'vendedor', `Distribuído para ${get('SELECT name FROM users WHERE id = ?', vendedor)?.name || 'vendedor'}`, null);
    logEvent(storeId, `Novo lead: ${nome || tel || email} (${ORIGENS[org]})`);
    return { id, novo: true };
  });
}

function find(storeId, id) {
  const l = get('SELECT * FROM leads WHERE id = ? AND store_id = ?', Number(id), storeId);
  if (!l) throw httpError(404, 'Lead não encontrado.');
  return l;
}

// Vendedor sem a permissão de gestão vê só os seus leads e os ainda sem dono.
function podeVer(user, l) {
  return user.perms.has('gestao') || !l.vendedor_id || l.vendedor_id === user.id;
}
function findFor(user, id) {
  const l = find(user.storeId, id);
  if (!podeVer(user, l)) throw httpError(403, 'Este lead está com outro vendedor.');
  return l;
}

function minutosDesde(d) { return d ? Math.floor((Date.now() - Date.parse(String(d).replace(' ', 'T') + 'Z')) / 60000) : null; }

function serialize(l, extra = {}) {
  const sla = extra.sla_min || 15;
  const espera = !l.primeira_resposta_em && ABERTAS.includes(l.etapa) ? minutosDesde(l.created_at) : null;
  return {
    ...l, etapa_label: ETAPA[l.etapa] || l.etapa, origem_label: ORIGENS[l.origem] || l.origem,
    temperatura_label: TEMPERATURAS[l.temperatura] || '', pagamento_label: PAGAMENTOS[l.pagamento] || '',
    sem_resposta_min: espera, atrasado: espera !== null && espera > sla, idade_dias: Math.floor((minutosDesde(l.created_at) || 0) / 1440),
    ...extra.fields,
  };
}

function list(user, q = {}) {
  const sid = user.storeId;
  const cfg = config(sid);
  const conds = ['l.store_id = ?']; const p = [sid];
  if (!user.perms.has('gestao') || q.meus === '1') { conds.push('(l.vendedor_id = ? OR l.vendedor_id IS NULL)'); p.push(user.id); }
  if (q.vendedor_id) { conds.push('l.vendedor_id = ?'); p.push(Number(q.vendedor_id)); }
  if (q.origem && ORIGENS[q.origem]) { conds.push('l.origem = ?'); p.push(q.origem); }
  // Fechados (vendido/perdido) só dos últimos 60 dias, para o funil não pesar.
  conds.push(`(l.etapa IN (${ABERTAS.map(() => '?').join(',')}) OR l.updated_at >= datetime('now','-60 days'))`); p.push(...ABERTAS);
  const rows = all(`SELECT l.*, u.name AS vendedor_nome, v.marca, v.modelo, v.versao, v.ano_modelo, v.placa, v.status AS v_status,
      (SELECT filename FROM photos f WHERE f.vehicle_id = l.vehicle_id ORDER BY position, id LIMIT 1) AS foto,
      (SELECT MIN(data_hora) FROM lead_visits x WHERE x.lead_id = l.id AND x.status IN ('agendada','confirmada') AND x.data_hora >= datetime('now','-3 hours')) AS proxima_visita,
      (SELECT MIN(vence_em) FROM lead_tasks t WHERE t.lead_id = l.id AND t.feita_em IS NULL) AS proxima_tarefa,
      (SELECT COUNT(*) FROM lead_events e WHERE e.lead_id = l.id) AS eventos
    FROM leads l LEFT JOIN users u ON u.id = l.vendedor_id LEFT JOIN vehicles v ON v.id = l.vehicle_id
    WHERE ${conds.join(' AND ')} ORDER BY l.updated_at DESC LIMIT 800`, ...p);
  return rows.map((l) => serialize(l, { sla_min: cfg.sla_min, fields: {
    veiculo: l.vehicle_id && l.marca ? { id: l.vehicle_id, titulo: `${l.marca} ${l.modelo}${l.ano_modelo ? ' ' + l.ano_modelo : ''}`, placa: l.placa, status: l.v_status, foto: l.foto ? `/media/${l.foto}` : '' } : null,
  } }));
}

function detail(user, id) {
  const l = findFor(user, id);
  const cfg = config(user.storeId);
  const veic = l.vehicle_id ? get('SELECT * FROM vehicles WHERE id = ?', l.vehicle_id) : null;
  return {
    lead: serialize({ ...l, vendedor_nome: l.vendedor_id ? get('SELECT name FROM users WHERE id = ?', l.vendedor_id)?.name : '' }, { sla_min: cfg.sla_min }),
    veiculo: veic ? { id: veic.id, titulo: V.title(veic), preco: V.precoAnuncio(veic), placa: veic.placa, status: veic.status, km: veic.km, foto: (get('SELECT filename FROM photos WHERE vehicle_id = ? ORDER BY position, id LIMIT 1', veic.id) || {}).filename } : null,
    eventos: all('SELECT e.*, u.name AS user_name FROM lead_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.lead_id = ? ORDER BY e.id DESC LIMIT 300', l.id),
    visitas: all('SELECT x.*, u.name AS vendedor_nome FROM lead_visits x LEFT JOIN users u ON u.id = x.vendedor_id WHERE x.lead_id = ? ORDER BY x.data_hora DESC', l.id).map(visitOut),
    tarefas: all('SELECT t.*, u.name AS vendedor_nome FROM lead_tasks t LEFT JOIN users u ON u.id = t.vendedor_id WHERE t.lead_id = ? ORDER BY t.feita_em IS NOT NULL, t.vence_em', l.id),
    conversa: all('SELECT m.papel, m.texto, m.created_at FROM chat_messages m JOIN chat_sessions s ON s.id = m.session_id WHERE s.lead_id = ? ORDER BY m.id LIMIT 400', l.id),
  };
}

function marcaResposta(l) {
  if (!l.primeira_resposta_em) run('UPDATE leads SET primeira_resposta_em = ? WHERE id = ?', agora(), l.id);
}

function update(user, id, b) {
  const l = findFor(user, id);
  const sets = []; const vals = [];
  const set = (col, v) => { if (v !== undefined && v !== l[col]) { sets.push(`${col} = ?`); vals.push(v); } };
  if (b.nome !== undefined) set('nome', str(b.nome, 120));
  if (b.telefone !== undefined) {
    const t = C.fone(b.telefone);
    if (t && (t.length < 10 || t.length > 11)) throw httpError(400, 'Telefone inválido: informe DDD + número.');
    set('telefone', t);
    if (t && t !== l.telefone) set('contact_id', C.upsert(user.storeId, { nome: b.nome ?? l.nome, telefone: t, papel: 'lead', origem: ORIGENS[l.origem] }));
  }
  if (b.email !== undefined) set('email', str(b.email, 160).toLowerCase());
  if (b.origem !== undefined && ORIGENS[b.origem]) set('origem', b.origem);
  if (b.vehicle_id !== undefined) set('vehicle_id', veiculoDaLoja(user.storeId, b.vehicle_id)?.id || null);
  if (b.interesse !== undefined) set('interesse', str(b.interesse, 300));
  if (b.orcamento !== undefined) set('orcamento', int(b.orcamento));
  if (b.troca !== undefined) set('troca', str(b.troca, 300));
  if (b.pagamento !== undefined && PAGAMENTOS[b.pagamento] !== undefined) set('pagamento', b.pagamento);
  if (b.temperatura !== undefined && TEMPERATURAS[b.temperatura]) set('temperatura', b.temperatura);
  if (b.obs !== undefined) set('obs', str(b.obs, 2000));
  if (b.vendedor_id !== undefined) {
    const vid = Number(b.vendedor_id) || null;
    if (vid && !get('SELECT 1 FROM users WHERE id = ? AND store_id = ?', vid, user.storeId)) throw httpError(400, 'Vendedor não encontrado.');
    if (vid !== l.vendedor_id) {
      if (!user.perms.has('gestao') && vid !== user.id) throw httpError(403, 'Só quem tem acesso à gestão repassa leads para outro vendedor.');
      set('vendedor_id', vid);
      addEvent(l.id, 'vendedor', vid ? `Repassado para ${get('SELECT name FROM users WHERE id = ?', vid)?.name}` : 'Sem vendedor', user.id);
    }
  }
  if (b.etapa !== undefined && ETAPA[b.etapa] && b.etapa !== l.etapa) {
    if (b.etapa === 'perdido' && !str(b.motivo_perda)) throw httpError(400, 'Informe o motivo da perda.');
    set('etapa', b.etapa); sets.push("etapa_em = datetime('now')");
    if (b.etapa === 'perdido') set('motivo_perda', str(b.motivo_perda, 200));
    addEvent(l.id, 'etapa', `${ETAPA[l.etapa]} → ${ETAPA[b.etapa]}${b.etapa === 'perdido' ? ` (${str(b.motivo_perda, 200)})` : ''}`, user.id);
    if (!['novo'].includes(b.etapa)) marcaResposta(l);
    if (!l.vendedor_id && b.vendedor_id === undefined) { sets.push('vendedor_id = ?'); vals.push(user.id); }
  }
  if (!sets.length) return;
  run(`UPDATE leads SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`, ...vals, l.id);
}

const NOTA = { nota: '📝 Anotação', whatsapp: '💬 WhatsApp', ligacao: '📞 Ligação', email: '✉️ E-mail', visita: '🏪 Visita', proposta: '💰 Proposta' };
function note(user, id, b) {
  const l = findFor(user, id);
  const tipo = NOTA[b.tipo] ? b.tipo : 'nota';
  const texto = str(b.texto, 4000) || (tipo === 'whatsapp' ? 'Conversa iniciada pelo WhatsApp' : tipo === 'ligacao' ? 'Ligação feita' : '');
  if (!texto) throw httpError(400, 'Escreva a anotação.');
  addEvent(l.id, tipo, texto, user.id);
  if (tipo !== 'nota') marcaResposta(l);
  const sets = ["updated_at = datetime('now')", 'ultimo_contato = ?']; const vals = [agora()];
  if (l.etapa === 'novo' && tipo !== 'nota') { sets.push("etapa = 'atendimento'", "etapa_em = datetime('now')"); addEvent(l.id, 'etapa', 'Novo → Em atendimento', user.id); }
  if (!l.vendedor_id) { sets.push('vendedor_id = ?'); vals.push(user.id); }
  run(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`, ...vals, l.id);
  if (l.contact_id && tipo !== 'nota') C.addNote(user.storeId, l.contact_id, { tipo: tipo === 'whatsapp' ? 'mensagem' : tipo === 'ligacao' ? 'ligacao' : tipo === 'proposta' ? 'proposta' : 'nota', texto }, user.id);
}

/* ---------------- Visitas ---------------- */
function visitOut(x) { return { ...x, status_label: VISITA_STATUS[x.status] || x.status, tipo_label: VISITA_TIPOS[x.tipo] || x.tipo }; }
function dataHora(s) {
  const m = String(s || '').match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) throw httpError(400, 'Informe a data e a hora da visita.');
  return `${m[1]} ${m[2]}:${m[3]}:00`;
}

function addVisit(user, b, { origem = '' } = {}) {
  const sid = user.storeId;
  const l = b.lead_id ? findFor(user, b.lead_id) : null;
  const dh = dataHora(b.data_hora);
  const veic = veiculoDaLoja(sid, b.vehicle_id ?? l?.vehicle_id);
  const vend = Number(b.vendedor_id) || l?.vendedor_id || (user.id || null);
  const id = Number(run(`INSERT INTO lead_visits (store_id, lead_id, vehicle_id, vendedor_id, data_hora, tipo, status, obs, created_by) VALUES (?, ?, ?, ?, ?, ?, 'agendada', ?, ?)`,
    sid, l?.id || null, veic?.id || null, vend, dh, VISITA_TIPOS[b.tipo] ? b.tipo : 'visita', str(b.obs, 500) || origem, user.id || null).lastInsertRowid);
  if (l) {
    addEvent(l.id, 'visita', `${VISITA_TIPOS[b.tipo] || 'Visita'} agendada para ${fmt(dh)}${veic ? ` (${V.title(veic)})` : ''}${origem ? ` — ${origem}` : ''}`, user.id || null);
    if (['novo', 'atendimento', 'qualificado'].includes(l.etapa)) {
      run(`UPDATE leads SET etapa = 'visita', etapa_em = datetime('now'), updated_at = datetime('now') WHERE id = ?`, l.id);
      addEvent(l.id, 'etapa', `${ETAPA[l.etapa]} → Visita agendada`, user.id || null);
    }
    if (user.id) marcaResposta(l);
  }
  return id;
}

function fmt(dh) {
  const m = String(dh).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  return m ? `${m[3]}/${m[2]} às ${m[4]}h${m[5] !== '00' ? m[5] : ''}` : dh;
}

function updateVisit(user, id, b) {
  const x = get('SELECT * FROM lead_visits WHERE id = ? AND store_id = ?', Number(id), user.storeId);
  if (!x) throw httpError(404, 'Visita não encontrada.');
  const sets = []; const vals = [];
  if (b.status && VISITA_STATUS[b.status] && b.status !== x.status) { sets.push('status = ?'); vals.push(b.status); }
  if (b.data_hora) { sets.push('data_hora = ?'); vals.push(dataHora(b.data_hora)); }
  if (b.obs !== undefined) { sets.push('obs = ?'); vals.push(str(b.obs, 500)); }
  if (b.vendedor_id !== undefined) { sets.push('vendedor_id = ?'); vals.push(Number(b.vendedor_id) || null); }
  if (!sets.length) return;
  run(`UPDATE lead_visits SET ${sets.join(', ')} WHERE id = ?`, ...vals, x.id);
  if (x.lead_id && b.status && b.status !== x.status) {
    const l = get('SELECT * FROM leads WHERE id = ?', x.lead_id);
    addEvent(l.id, 'visita', `${VISITA_TIPOS[x.tipo] || 'Visita'} de ${fmt(b.data_hora ? dataHora(b.data_hora) : x.data_hora)}: ${VISITA_STATUS[b.status]}`, user.id);
    if (b.status === 'realizada' && ['novo', 'atendimento', 'qualificado', 'visita'].includes(l.etapa)) {
      run(`UPDATE leads SET etapa = 'visitou', etapa_em = datetime('now'), updated_at = datetime('now') WHERE id = ?`, l.id);
      addEvent(l.id, 'etapa', `${ETAPA[l.etapa]} → Visitou`, user.id);
    }
  }
}

function visits(user, q = {}) {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const meus = !user.perms.has('gestao') || q.meus === '1';
  return all(`SELECT x.*, l.nome AS lead_nome, l.telefone AS lead_tel, u.name AS vendedor_nome, v.marca, v.modelo, v.ano_modelo, v.placa
    FROM lead_visits x LEFT JOIN leads l ON l.id = x.lead_id LEFT JOIN users u ON u.id = x.vendedor_id LEFT JOIN vehicles v ON v.id = x.vehicle_id
    WHERE x.store_id = ? AND substr(x.data_hora,1,10) BETWEEN ? AND ? ${meus ? 'AND (x.vendedor_id = ? OR x.vendedor_id IS NULL)' : ''} ORDER BY x.data_hora`,
  ...(meus ? [user.storeId, from, to, user.id] : [user.storeId, from, to])).map((x) => ({ ...visitOut(x), veiculo: x.marca ? `${x.marca} ${x.modelo}${x.ano_modelo ? ' ' + x.ano_modelo : ''}` : '' }));
}

/* ---------------- Tarefas ---------------- */
function addTask(user, b) {
  const l = b.lead_id ? findFor(user, b.lead_id) : null;
  const titulo = str(b.titulo, 200);
  if (!titulo) throw httpError(400, 'Descreva a tarefa.');
  const vence = /^\d{4}-\d{2}-\d{2}/.test(b.vence_em || '') ? String(b.vence_em).replace('T', ' ').slice(0, 16) : new Date().toISOString().slice(0, 10);
  const id = Number(run('INSERT INTO lead_tasks (store_id, lead_id, vendedor_id, titulo, vence_em, created_by) VALUES (?, ?, ?, ?, ?, ?)',
    user.storeId, l?.id || null, Number(b.vendedor_id) || l?.vendedor_id || user.id, titulo, vence, user.id).lastInsertRowid);
  if (l) addEvent(l.id, 'tarefa', `Tarefa: ${titulo} (até ${vence.slice(8, 10)}/${vence.slice(5, 7)})`, user.id);
  return id;
}
function doneTask(user, id, feita = true) {
  const t = get('SELECT * FROM lead_tasks WHERE id = ? AND store_id = ?', Number(id), user.storeId);
  if (!t) throw httpError(404, 'Tarefa não encontrada.');
  run(`UPDATE lead_tasks SET feita_em = ${feita ? "datetime('now')" : 'NULL'} WHERE id = ?`, t.id);
  if (feita && t.lead_id) addEvent(t.lead_id, 'tarefa', `Concluída: ${t.titulo}`, user.id);
}
function tasks(user, q = {}) {
  const meus = !user.perms.has('gestao') || q.meus === '1';
  return all(`SELECT t.*, l.nome AS lead_nome, l.telefone AS lead_tel, u.name AS vendedor_nome FROM lead_tasks t LEFT JOIN leads l ON l.id = t.lead_id LEFT JOIN users u ON u.id = t.vendedor_id
    WHERE t.store_id = ? AND (t.feita_em IS NULL OR t.feita_em >= datetime('now','-2 days')) ${meus ? 'AND t.vendedor_id = ?' : ''} ORDER BY t.feita_em IS NOT NULL, t.vence_em LIMIT 400`,
  ...(meus ? [user.storeId, user.id] : [user.storeId]));
}

/* ---------------- Relatório ---------------- */
function stats(user, q = {}) {
  const sid = user.storeId;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : new Date().toISOString().slice(0, 10);
  const leads = all(`SELECT * FROM leads WHERE store_id = ? AND substr(created_at,1,10) BETWEEN ? AND ?`, sid, from, to);
  const vis = all(`SELECT * FROM lead_visits WHERE store_id = ? AND substr(data_hora,1,10) BETWEEN ? AND ?`, sid, from, to);
  const resp = (ls) => {
    const t = ls.filter((l) => l.primeira_resposta_em).map((l) => (Date.parse(l.primeira_resposta_em.replace(' ', 'T') + 'Z') - Date.parse(l.created_at.replace(' ', 'T') + 'Z')) / 60000).filter((n) => n >= 0);
    return t.length ? Math.round(t.reduce((a, b) => a + b, 0) / t.length) : null;
  };
  const grupo = (key, label) => {
    const m = new Map();
    for (const l of leads) {
      const k = l[key] ?? '';
      if (!m.has(k)) m.set(k, { chave: k, nome: label(k), leads: 0, visitas: 0, vendidos: 0, perdidos: 0, abertos: 0, _ls: [] });
      const g = m.get(k); g.leads++; g._ls.push(l);
      if (l.etapa === 'vendido') g.vendidos++; else if (l.etapa === 'perdido') g.perdidos++; else g.abertos++;
      if (['visitou', 'proposta', 'vendido'].includes(l.etapa) || vis.some((x) => x.lead_id === l.id && x.status === 'realizada')) g.visitas++;
    }
    return [...m.values()].map(({ _ls, ...g }) => ({ ...g, conversao: g.leads ? Math.round((g.vendidos / g.leads) * 1000) / 10 : 0, resposta_min: resp(_ls) })).sort((a, b) => b.leads - a.leads);
  };
  const nomes = Object.fromEntries(all('SELECT id, name FROM users WHERE store_id = ?', sid).map((u) => [u.id, u.name]));
  const motivos = {};
  for (const l of leads) if (l.etapa === 'perdido') motivos[l.motivo_perda || 'Sem motivo'] = (motivos[l.motivo_perda || 'Sem motivo'] || 0) + 1;
  return {
    from, to,
    kpis: {
      leads: leads.length, vendidos: leads.filter((l) => l.etapa === 'vendido').length, perdidos: leads.filter((l) => l.etapa === 'perdido').length,
      abertos: leads.filter((l) => ABERTAS.includes(l.etapa)).length, resposta_min: resp(leads),
      sem_resposta: all(`SELECT COUNT(*) n FROM leads WHERE store_id = ? AND primeira_resposta_em IS NULL AND etapa IN (${ABERTAS.map(() => '?').join(',')})`, sid, ...ABERTAS)[0].n,
      visitas_agendadas: vis.length, visitas_realizadas: vis.filter((x) => x.status === 'realizada').length, faltas: vis.filter((x) => x.status === 'faltou').length,
    },
    origens: grupo('origem', (k) => ORIGENS[k] || k),
    vendedores: grupo('vendedor_id', (k) => nomes[k] || 'Sem vendedor'),
    motivos: Object.entries(motivos).map(([motivo, n]) => ({ motivo, n })).sort((a, b) => b.n - a.n),
  };
}

// Resumo para o menu e o painel: leads novos e atrasados, visitas de hoje e tarefas vencidas do usuário.
function resumo(user) {
  const sid = user.storeId; const cfg = config(sid);
  const meus = !user.perms.has('gestao');
  const f = meus ? 'AND (vendedor_id = ? OR vendedor_id IS NULL)' : '';
  const pv = meus ? [user.id] : [];
  const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  return {
    novos: get(`SELECT COUNT(*) n FROM leads WHERE store_id = ? AND etapa = 'novo' ${f}`, sid, ...pv).n,
    atrasados: get(`SELECT COUNT(*) n FROM leads WHERE store_id = ? AND primeira_resposta_em IS NULL AND etapa IN (${ABERTAS.map(() => '?').join(',')}) AND created_at <= datetime('now', ?) ${f}`, sid, ...ABERTAS, `-${cfg.sla_min} minutes`, ...pv).n,
    visitas_hoje: get(`SELECT COUNT(*) n FROM lead_visits WHERE store_id = ? AND substr(data_hora,1,10) = ? AND status IN ('agendada','confirmada') ${f}`, sid, hoje, ...pv).n,
    tarefas_vencidas: get(`SELECT COUNT(*) n FROM lead_tasks WHERE store_id = ? AND feita_em IS NULL AND substr(vence_em,1,10) <= ? ${meus ? 'AND vendedor_id = ?' : ''}`, sid, hoje, ...pv).n,
  };
}

// Venda concluída: o lead em aberto do mesmo telefone vira "vendido".
function onSold(storeId, vehicleId, userId) {
  const v = get('SELECT * FROM vehicles WHERE id = ?', vehicleId);
  const tel = C.fone(v?.comprador_tel);
  if (!tel) return;
  const l = get(`SELECT * FROM leads WHERE store_id = ? AND telefone = ? AND etapa IN (${ABERTAS.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 1`, storeId, tel, ...ABERTAS);
  if (!l) return;
  run(`UPDATE leads SET etapa = 'vendido', etapa_em = datetime('now'), updated_at = datetime('now'), vehicle_id = COALESCE(vehicle_id, ?) WHERE id = ?`, v.id, l.id);
  addEvent(l.id, 'etapa', `${ETAPA[l.etapa]} → Vendido (${V.title(v)})`, userId || null);
}

/* ---------------- Captação pública (site e QR) ---------------- */
const hits = new Map();
function limite(chave, max, janelaMs) {
  const t = Date.now();
  const arr = (hits.get(chave) || []).filter((x) => t - x < janelaMs);
  if (arr.length >= max) return false;
  arr.push(t); hits.set(chave, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] > janelaMs) hits.delete(k);
  return true;
}

function publicLead(store, b, ip) {
  if (b.site) return { ok: true }; // campo-isca para robôs
  if (!limite(`lead:${ip}`, 8, 3600e3)) throw httpError(429, 'Muitos envios. Tente de novo mais tarde ou chame no WhatsApp.');
  const tel = C.fone(b.telefone);
  if (tel.length < 10 || tel.length > 11) throw httpError(400, 'Informe seu WhatsApp com DDD.');
  if (!str(b.nome)) throw httpError(400, 'Informe seu nome.');
  const origem = b.origem === 'qr' ? 'qr' : 'vitrine';
  const r = createLead(store.id, { nome: b.nome, telefone: tel, email: b.email, vehicle_id: b.vehicle_id, mensagem: [b.mensagem, b.visita ? 'Quer agendar uma visita.' : ''].filter(Boolean).join(' ') }, { origem });
  if (b.visita) run("UPDATE leads SET temperatura = 'quente' WHERE id = ?", r.id);
  return { ok: true };
}

module.exports = {
  ETAPAS, ABERTAS, ORIGENS, MOTIVOS, TEMPERATURAS, VISITA_STATUS, VISITA_TIPOS, PAGAMENTOS, NOTA,
  config, saveConfig, publicConfig, updateConfig, vendedores, createLead, find, findFor, list, detail, update, note, addEvent,
  addVisit, updateVisit, visits, addTask, doneTask, tasks, stats, resumo, onSold, publicLead, limite, marcaResposta,
};
