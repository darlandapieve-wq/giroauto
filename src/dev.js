// Acesso do desenvolvedor (v2.7): lojas cadastradas, uso e métricas gerais, e a caixa de sugestões e erros.
// Só o usuário marcado como administrador do sistema (is_admin, o primeiro cadastrado) enxerga.
const { get, all, run } = require('./db');
const config = require('./config');

const TIPOS = { erro: 'Erro / problema', melhoria: 'Melhoria', funcionalidade: 'Nova funcionalidade', duvida: 'Dúvida', outro: 'Outro' };
const STATUS = { novo: 'Novo', analise: 'Em análise', planejado: 'Planejado', andamento: 'Em desenvolvimento', feito: 'Feito', descartado: 'Não será feito' };
const PRIORIDADES = { '': '—', baixa: 'Baixa', media: 'Média', alta: 'Alta', urgente: 'Urgente' };
const str = (x, max = 200) => String(x ?? '').trim().slice(0, max);
const httpError = (status, message) => Object.assign(new Error(message), { status });

function requireDev(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Entre na sua conta para continuar.' });
  if (!get('SELECT is_admin FROM users WHERE id = ?', req.user.id)?.is_admin) return res.status(403).json({ error: 'Acesso só para o desenvolvedor do sistema.' });
  next();
}

/* ---------------- Sugestões e erros (usuários) ---------------- */

function createFeedback(user, b) {
  const titulo = str(b.titulo, 140);
  if (!titulo) throw httpError(400, 'Escreva um título curto para o seu apontamento.');
  const tipo = TIPOS[b.tipo] ? b.tipo : 'melhoria';
  return run('INSERT INTO feedback (store_id, user_id, tipo, titulo, descricao, tela, versao, navegador) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    user.storeId, user.id, tipo, titulo, str(b.descricao, 4000), str(b.tela, 80), str(b.versao, 20), str(b.navegador, 200)).lastInsertRowid;
}

const fbOut = (f) => ({ ...f, tipo_label: TIPOS[f.tipo] || f.tipo, status_label: STATUS[f.status] || f.status, prioridade_label: PRIORIDADES[f.prioridade || ''] || '' });

function myFeedback(user) {
  return all('SELECT * FROM feedback WHERE store_id = ? ORDER BY id DESC LIMIT 100', user.storeId).map(fbOut);
}

/* ---------------- Visão do desenvolvedor ---------------- */

function count(sql, ...p) { return get(sql, ...p)?.n || 0; }

function overview() {
  const lojas = all(`SELECT s.id, s.name, s.slug, s.city, s.state, s.whatsapp, s.created_at, s.pub_mode, s.logo_file,
      (SELECT COUNT(*) FROM users u WHERE u.store_id = s.id) AS usuarios,
      (SELECT MAX(u.last_seen) FROM users u WHERE u.store_id = s.id) AS ultimo_acesso,
      (SELECT u.email FROM users u WHERE u.store_id = s.id AND u.role = 'admin' ORDER BY u.id LIMIT 1) AS email_dono,
      (SELECT u.name FROM users u WHERE u.store_id = s.id AND u.role = 'admin' ORDER BY u.id LIMIT 1) AS nome_dono,
      (SELECT COUNT(*) FROM vehicles v WHERE v.store_id = s.id AND v.status != 'vendido') AS estoque,
      (SELECT COUNT(*) FROM vehicles v WHERE v.store_id = s.id AND v.status = 'publicado') AS publicados,
      (SELECT COUNT(*) FROM vehicles v WHERE v.store_id = s.id AND v.status = 'vendido') AS vendidos,
      (SELECT COUNT(*) FROM vehicles v WHERE v.store_id = s.id AND v.status = 'vendido' AND v.vendido_em >= datetime('now','-30 days')) AS vendidos_30,
      (SELECT COALESCE(SUM(v.venda_valor),0) FROM vehicles v WHERE v.store_id = s.id AND v.status = 'vendido' AND v.vendido_em >= datetime('now','-30 days')) AS faturamento_30,
      (SELECT MAX(t.last_seen) FROM ext_tokens t WHERE t.store_id = s.id) AS extensao_vista,
      (SELECT COUNT(*) FROM ext_jobs j WHERE j.store_id = s.id AND j.status = 'concluido' AND j.updated_at >= datetime('now','-30 days')) AS publicacoes_30,
      (SELECT COUNT(*) FROM campaigns c WHERE c.store_id = s.id) AS campanhas,
      (SELECT COUNT(*) FROM contacts c WHERE c.store_id = s.id) AS contatos,
      (SELECT COUNT(*) FROM feedback f WHERE f.store_id = s.id) AS feedbacks,
      (SELECT MAX(e.created_at) FROM events e WHERE e.store_id = s.id) AS ultima_acao,
      (SELECT 1 FROM meta_connections m WHERE m.store_id = s.id AND m.token_enc IS NOT NULL AND m.token_enc != '') AS meta_ok
    FROM stores s ORDER BY s.id DESC`).map((l) => ({ ...l, meta_ok: !!l.meta_ok, logo_url: l.logo_file ? `/media/${l.logo_file}` : '' }));
  const ativa = (l, dias) => [l.ultimo_acesso, l.ultima_acao, l.extensao_vista].some((d) => d && Date.parse(String(d).replace(' ', 'T') + 'Z') >= Date.now() - dias * 864e5);
  // Novas lojas e vendas por mês (últimos 6 meses).
  const meses = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const key = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7);
    meses.push({
      mes: key,
      lojas: count(`SELECT COUNT(*) n FROM stores WHERE substr(created_at,1,7) = ?`, key),
      veiculos: count(`SELECT COUNT(*) n FROM vehicles WHERE substr(created_at,1,7) = ?`, key),
      vendas: count(`SELECT COUNT(*) n FROM vehicles WHERE status = 'vendido' AND substr(vendido_em,1,7) = ?`, key),
    });
  }
  return {
    versao: require('../package.json').version,
    url: config.publicUrl,
    kpis: {
      lojas: lojas.length,
      ativas_7: lojas.filter((l) => ativa(l, 7)).length,
      ativas_30: lojas.filter((l) => ativa(l, 30)).length,
      novas_30: lojas.filter((l) => Date.parse(String(l.created_at).replace(' ', 'T') + 'Z') >= Date.now() - 30 * 864e5).length,
      usuarios: count('SELECT COUNT(*) n FROM users'),
      usuarios_7: count(`SELECT COUNT(*) n FROM users WHERE last_seen >= datetime('now','-7 days')`),
      veiculos: count('SELECT COUNT(*) n FROM vehicles'),
      estoque: count(`SELECT COUNT(*) n FROM vehicles WHERE status != 'vendido'`),
      publicados: count(`SELECT COUNT(*) n FROM vehicles WHERE status = 'publicado'`),
      vendidos_30: count(`SELECT COUNT(*) n FROM vehicles WHERE status = 'vendido' AND vendido_em >= datetime('now','-30 days')`),
      faturamento_30: count(`SELECT COALESCE(SUM(venda_valor),0) n FROM vehicles WHERE status = 'vendido' AND vendido_em >= datetime('now','-30 days')`),
      publicacoes_30: count(`SELECT COUNT(*) n FROM ext_jobs WHERE status = 'concluido' AND updated_at >= datetime('now','-30 days')`),
      falhas_30: count(`SELECT COUNT(*) n FROM ext_jobs WHERE status = 'falhou' AND updated_at >= datetime('now','-30 days')`),
      extensoes_ativas: count(`SELECT COUNT(DISTINCT store_id) n FROM ext_tokens WHERE last_seen >= datetime('now','-7 days')`),
      meta_conectadas: lojas.filter((l) => l.meta_ok).length,
      campanhas: count('SELECT COUNT(*) n FROM campaigns'),
      contatos: count('SELECT COUNT(*) n FROM contacts'),
      mensagens: count(`SELECT COUNT(*) n FROM wa_sends WHERE status = 'enviado'`),
      feedback_abertos: count(`SELECT COUNT(*) n FROM feedback WHERE status IN ('novo','analise','planejado','andamento')`),
      feedback_novos: count(`SELECT COUNT(*) n FROM feedback WHERE status = 'novo'`),
    },
    lojas, meses,
    eventos: all(`SELECT e.message, e.created_at, s.name AS loja, s.id AS store_id FROM events e JOIN stores s ON s.id = e.store_id ORDER BY e.id DESC LIMIT 40`),
  };
}

function storeDetail(id) {
  const s = get('SELECT id, name, slug, city, state, whatsapp, phone, created_at, pub_mode, daily_limit, parado_dias FROM stores WHERE id = ?', Number(id));
  if (!s) throw httpError(404, 'Loja não encontrada.');
  return {
    loja: s,
    usuarios: all('SELECT id, name, email, role, active, created_at, last_seen FROM users WHERE store_id = ? ORDER BY role = \'admin\' DESC, name', s.id),
    status: all(`SELECT status, COUNT(*) n FROM vehicles WHERE store_id = ? GROUP BY status`, s.id),
    eventos: all('SELECT message, created_at FROM events WHERE store_id = ? ORDER BY id DESC LIMIT 60', s.id),
    feedback: all('SELECT * FROM feedback WHERE store_id = ? ORDER BY id DESC LIMIT 50', s.id).map(fbOut),
    extensao: all('SELECT label, created_at, last_seen FROM ext_tokens WHERE store_id = ? ORDER BY last_seen DESC', s.id),
  };
}

function feedbackList() {
  return all(`SELECT f.*, s.name AS loja, u.name AS usuario, u.email AS email FROM feedback f
              LEFT JOIN stores s ON s.id = f.store_id LEFT JOIN users u ON u.id = f.user_id ORDER BY
              CASE f.status WHEN 'novo' THEN 0 WHEN 'analise' THEN 1 WHEN 'andamento' THEN 2 WHEN 'planejado' THEN 3 ELSE 4 END, f.id DESC LIMIT 500`).map(fbOut);
}

function updateFeedback(id, b) {
  const f = get('SELECT * FROM feedback WHERE id = ?', Number(id));
  if (!f) throw httpError(404, 'Apontamento não encontrado.');
  const status = STATUS[b.status] ? b.status : f.status;
  const prioridade = b.prioridade !== undefined && PRIORIDADES[b.prioridade] !== undefined ? b.prioridade : f.prioridade;
  const resposta = b.resposta !== undefined ? str(b.resposta, 2000) : f.resposta;
  run(`UPDATE feedback SET status = ?, prioridade = ?, resposta = ?, updated_at = datetime('now') WHERE id = ?`, status, prioridade, resposta, f.id);
}

module.exports = { TIPOS, STATUS, PRIORIDADES, requireDev, createFeedback, myFeedback, overview, storeDetail, feedbackList, updateFeedback };
