// Pendências dos carros (v2.13): multas, IPVA, licenciamento, restrições, gravame, recall e outras,
// nos carros em estoque ou já vendidos, com valor, vencimento, responsável, situação e histórico.
const { get, all, run, tx, logEvent } = require('./db');
const V = require('./vehicles');

const TIPOS = {
  multa: 'Multa',
  ipva: 'IPVA atrasado',
  licenciamento: 'Licenciamento',
  restricao_judicial: 'Restrição judicial (Renajud)',
  gravame: 'Gravame / alienação fiduciária',
  restricao_administrativa: 'Restrição administrativa (Detran)',
  bloqueio_furto: 'Bloqueio de furto/roubo',
  recall: 'Recall pendente',
  vistoria: 'Vistoria / laudo',
  documento: 'Documento (2ª via de CRV, CRLV)',
  sinistro: 'Sinistro / seguradora',
  outro: 'Outra pendência',
};
const STATUS = { aberta: 'Aberta', andamento: 'Em andamento', resolvida: 'Resolvida', cancelada: 'Cancelada' };
const RESPONSAVEL = { loja: 'Loja', antigo_dono: 'Antigo dono / quem vendeu', comprador: 'Comprador', consignatario: 'Consignatário', despachante: 'Despachante', outro: 'Outro' };
const FECHADAS = ['resolvida', 'cancelada'];

const str = (x, max = 300) => String(x ?? '').trim().slice(0, max);
const httpError = (status, message) => Object.assign(new Error(message), { status });
const data = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(String(x || '')) ? String(x) : null);
const valor = (x) => Math.max(0, Math.round((Number(String(x ?? '').replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) || 0) * 100) / 100);
const hoje = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);

function veiculoDaLoja(storeId, vehicleId) {
  const v = get('SELECT * FROM vehicles WHERE id = ? AND store_id = ?', Number(vehicleId), storeId);
  if (!v) throw httpError(404, 'Veículo não encontrado.');
  return v;
}
function find(storeId, id) {
  const p = get('SELECT * FROM pendencias WHERE id = ? AND store_id = ?', Number(id), storeId);
  if (!p) throw httpError(404, 'Pendência não encontrada.');
  return p;
}

function serialize(p, v) {
  const aberta = !FECHADAS.includes(p.status);
  const venc = p.vencimento;
  const dias = venc ? Math.round((Date.parse(venc + 'T12:00:00Z') - Date.parse(hoje() + 'T12:00:00Z')) / 864e5) : null;
  return {
    ...p, aberta, tipo_label: TIPOS[p.tipo] || p.tipo, status_label: STATUS[p.status] || p.status, responsavel_label: RESPONSAVEL[p.responsavel] || p.responsavel,
    vencida: aberta && dias !== null && dias < 0, vence_em: dias,
    veiculo: v ? { id: v.id, titulo: V.title(v), placa: v.placa || '', status: v.status, vendido: v.status === 'vendido', comprador: v.venda_comprador || '', comprador_tel: v.comprador_tel || '' } : null,
  };
}

function list(storeId, { vehicleId } = {}) {
  const rows = vehicleId
    ? all('SELECT * FROM pendencias WHERE store_id = ? AND vehicle_id = ? ORDER BY id DESC', storeId, Number(vehicleId))
    : all('SELECT * FROM pendencias WHERE store_id = ? ORDER BY id DESC', storeId);
  const vs = new Map(all('SELECT * FROM vehicles WHERE store_id = ?', storeId).map((v) => [v.id, v]));
  return rows.map((p) => serialize(p, vs.get(p.vehicle_id)))
    .sort((a, b) => (b.aberta - a.aberta) || (b.vencida - a.vencida) || String(a.vencimento || '9999').localeCompare(String(b.vencimento || '9999')) || b.id - a.id);
}

// Resumo por carro, para o aviso no Estoque e no Painel.
function abertasPorVeiculo(storeId) {
  const m = {};
  for (const r of all(`SELECT vehicle_id, COUNT(*) n, SUM(valor) total, SUM(CASE WHEN vencimento IS NOT NULL AND vencimento < ? THEN 1 ELSE 0 END) vencidas
                       FROM pendencias WHERE store_id = ? AND status NOT IN ('resolvida','cancelada') GROUP BY vehicle_id`, hoje(), storeId)) {
    m[r.vehicle_id] = { n: r.n, total: r.total || 0, vencidas: r.vencidas || 0 };
  }
  return m;
}

function save(storeId, id, b, userId) {
  const atual = id ? find(storeId, id) : null;
  const v = veiculoDaLoja(storeId, b.vehicle_id ?? atual?.vehicle_id);
  const d = {
    tipo: TIPOS[b.tipo] ? b.tipo : (atual?.tipo || 'outro'),
    descricao: str(b.descricao ?? atual?.descricao, 300),
    valor: b.valor !== undefined ? valor(b.valor) : (atual?.valor || 0),
    vencimento: b.vencimento !== undefined ? data(b.vencimento) : (atual?.vencimento || null),
    responsavel: RESPONSAVEL[b.responsavel] ? b.responsavel : (atual?.responsavel || 'loja'),
    status: STATUS[b.status] ? b.status : (atual?.status || 'aberta'),
  };
  if (d.tipo === 'outro' && !d.descricao) throw httpError(400, 'Descreva a pendência (ex.: multa de velocidade, débito no Detran).');
  const obs = str(b.obs, 1000);
  const fechou = FECHADAS.includes(d.status) && (!atual || !FECHADAS.includes(atual.status));
  return tx(() => {
    let pid;
    if (atual) {
      run(`UPDATE pendencias SET vehicle_id=?, tipo=?, descricao=?, valor=?, vencimento=?, responsavel=?, status=?, obs=?, resolvido_em=?, updated_at=datetime('now') WHERE id=?`,
        v.id, d.tipo, d.descricao, d.valor, d.vencimento, d.responsavel, d.status, obs || atual.obs || '', FECHADAS.includes(d.status) ? (atual.resolvido_em || (fechou ? hoje() : null)) : null, atual.id);
      pid = atual.id;
      if (d.status !== atual.status || obs) run('INSERT INTO pendencia_moves (pendencia_id, status, obs, user_id) VALUES (?, ?, ?, ?)', pid, d.status, obs, userId || null);
    } else {
      pid = run(`INSERT INTO pendencias (store_id, vehicle_id, tipo, descricao, valor, vencimento, responsavel, status, obs, resolvido_em, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        storeId, v.id, d.tipo, d.descricao, d.valor, d.vencimento, d.responsavel, d.status, obs, FECHADAS.includes(d.status) ? hoje() : null, userId || null).lastInsertRowid;
      run('INSERT INTO pendencia_moves (pendencia_id, status, obs, user_id) VALUES (?, ?, ?, ?)', pid, d.status, obs || 'Pendência registrada', userId || null);
    }
    const nome = `${TIPOS[d.tipo]}${d.descricao ? ` (${d.descricao.slice(0, 60)})` : ''}`;
    if (!atual) logEvent(storeId, `Pendência no ${V.title(v)}: ${nome}`);
    else if (fechou) logEvent(storeId, `Pendência ${STATUS[d.status].toLowerCase()} no ${V.title(v)}: ${nome}`);
    return Number(pid);
  });
}

function moves(storeId, id) {
  const p = find(storeId, id);
  return all(`SELECT m.*, u.name AS user_name FROM pendencia_moves m LEFT JOIN users u ON u.id = m.user_id WHERE m.pendencia_id = ? ORDER BY m.id DESC LIMIT 100`, p.id)
    .map((m) => ({ ...m, status_label: STATUS[m.status] || m.status }));
}

function remove(storeId, id) {
  const p = find(storeId, id);
  run('DELETE FROM pendencias WHERE id = ?', p.id);
  return true;
}

module.exports = { TIPOS, STATUS, RESPONSAVEL, list, save, moves, remove, abertasPorVeiculo };
