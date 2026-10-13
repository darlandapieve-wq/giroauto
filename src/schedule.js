// Republicação agendada (v2.0). A extensão consulta o servidor a cada minuto; quando chega um horário
// marcado pela loja, o servidor coloca na fila os carros que já podem ser republicados.
// Não precisa de clique: só que o computador esteja ligado, com o Chrome aberto e a extensão ativa.
const config = require('./config');
const { get, all, run, logEvent } = require('./db');

const DEFAULT = { ativo: false, dias: [1, 2, 3, 4, 5, 6], horarios: ['09:00'], por_vez: 3 };

function parse(store) {
  let o = {};
  try { o = JSON.parse(store?.rep_schedule || '{}'); } catch { o = {}; }
  return { ...DEFAULT, ...o };
}

function clean(b) {
  const dias = [...new Set((Array.isArray(b.dias) ? b.dias : []).map(Number).filter((d) => d >= 0 && d <= 6))].sort();
  const horarios = [...new Set((Array.isArray(b.horarios) ? b.horarios : []).map(String).filter((h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h)))].sort().slice(0, 6);
  return { ativo: !!b.ativo, dias, horarios: horarios.length ? horarios : ['09:00'], por_vez: Math.max(1, Math.min(20, parseInt(b.por_vez, 10) || 3)) };
}

// Horário de Brasília (sem horário de verão desde 2019).
function nowBr(d = new Date()) {
  const t = new Date(d.getTime() - 3 * 3600e3);
  return { date: t.toISOString().slice(0, 10), dow: t.getUTCDay(), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

function republishable(storeId, limit) {
  const days = config.republishDays;
  return all(`SELECT v.id FROM vehicles v
    WHERE v.store_id = ? AND v.status = 'publicado' AND v.organico = 1
      AND (julianday('now') - julianday(v.publicado_em) >= ? OR (v.preco_oferta > 0 AND v.oferta_desde > v.publicado_em))
      AND NOT EXISTS (SELECT 1 FROM ext_jobs j WHERE j.vehicle_id = v.id AND j.status IN ('pendente','em_andamento'))
    ORDER BY v.publicado_em ASC LIMIT ?`, storeId, days, limit).map((r) => r.id);
}

// Chamado a cada consulta da extensão. Devolve quantos carros entraram na fila.
function tick(storeId, now = new Date()) {
  const st = get('SELECT pub_mode, daily_limit, rep_schedule FROM stores WHERE id = ?', storeId);
  if (!st || st.pub_mode !== 'extensao') return 0;
  const sc = parse(st);
  if (!sc.ativo) return 0;
  const n = nowBr(now);
  if (!sc.dias.includes(n.dow)) return 0;
  let added = 0;
  for (const h of sc.horarios) {
    const [hh, mm] = h.split(':').map(Number);
    const at = hh * 60 + mm;
    if (n.minutes < at || n.minutes > at + 180) continue; // vale até 3 horas depois do horário marcado
    const slot = `${n.date} ${h}`;
    if (get('SELECT 1 FROM rep_runs WHERE store_id = ? AND slot = ?', storeId, slot)) continue;
    run('INSERT INTO rep_runs (store_id, slot) VALUES (?, ?)', storeId, slot);
    const hoje = get(`SELECT COUNT(*) n FROM ext_jobs WHERE store_id = ? AND type IN ('publicar','republicar')
      AND status IN ('pendente','em_andamento','concluido') AND date(created_at, '-3 hours') = ?`, storeId, n.date).n;
    const vagas = Math.max(0, Math.min(sc.por_vez, (st.daily_limit || 15) - hoje));
    for (const id of republishable(storeId, vagas)) {
      run('INSERT INTO ext_jobs (store_id, vehicle_id, type, note) VALUES (?, ?, ?, ?)', storeId, id, 'republicar', `Agendada (${h})`);
      added++;
    }
    if (added) logEvent(storeId, `Republicação agendada das ${h}: ${added} veículo(s) na fila`);
  }
  run(`DELETE FROM rep_runs WHERE store_id = ? AND slot < ?`, storeId, new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10));
  return added;
}

module.exports = { parse, clean, tick, nowBr, republishable, DEFAULT };
