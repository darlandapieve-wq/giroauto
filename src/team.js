// Equipe da loja: dono (administrador da loja) e vendedores com permissões escolhidas pelo dono.
const { get, all, run } = require('./db');

const PERMS = {
  cadastrar: 'Cadastrar e editar veículos (inclui fotos e importação de planilha)',
  precos: 'Alterar preço e criar ofertas',
  excluir: 'Excluir veículos',
  publicar: 'Publicar, republicar e divulgar (Marketplace, Instagram, OLX, Webmotors)',
  vender: 'Marcar veículo como vendido e acompanhar a transferência do documento',
  campanhas: 'Campanhas pagas no Facebook e Instagram',
  financeiro: 'Ver e lançar compra, custos, venda e margem',
  gestao: 'Ver o painel de gestão e resultados (DRE, estoque, vendas)',
  parceiros: 'Parceiros e localização dos carros (oficina, funilaria…)',
  config: 'Configurações da loja (exceto equipe)',
};
const ALL = Object.keys(PERMS);
const DEFAULT_SELLER = ['cadastrar', 'publicar', 'vender'];

function permsOf(user) {
  if (!user) return new Set();
  if (user.role === 'admin') return new Set(ALL);
  let list = [];
  try { list = JSON.parse(user.permissions || '[]'); } catch { list = []; }
  return new Set(list.filter((p) => PERMS[p]));
}

// Middleware: exige a permissão. O dono da loja tem todas.
function can(perm) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Entre na sua conta para continuar.' });
    if (!req.user.perms?.has(perm)) return res.status(403).json({ error: `Seu usuário não tem permissão para: ${PERMS[perm].toLowerCase()}. Peça ao administrador da loja.` });
    next();
  };
}

// Middleware: basta uma das permissões.
function canAny(...perms) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Entre na sua conta para continuar.' });
    if (!perms.some((p) => req.user.perms?.has(p))) return res.status(403).json({ error: `Seu usuário não tem permissão para: ${PERMS[perms[0]].toLowerCase()}. Peça ao administrador da loja.` });
    next();
  };
}

function requireOwner(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Entre na sua conta para continuar.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Só o administrador da loja pode gerenciar a equipe.' });
  next();
}

function cleanPerms(list) {
  return [...new Set((Array.isArray(list) ? list : []).filter((p) => PERMS[p]))];
}

function list(storeId) {
  return all('SELECT id, name, email, role, permissions, active, created_at FROM users WHERE store_id = ? ORDER BY role = \'admin\' DESC, name', storeId)
    .map((u) => ({ ...u, active: !!u.active, permissions: u.role === 'admin' ? ALL : [...permsOf(u)] }));
}

module.exports = { PERMS, ALL, DEFAULT_SELLER, permsOf, can, canAny, requireOwner, cleanPerms, list, get, run };
