// Repassadores (contas), usuários, senhas e métricas para o painel do desenvolvedor.
import crypto from 'node:crypto'
import { q, um, todos } from './db.js'
import { carregarConfig, atualizarConfig } from './config.js'
import { comConta } from './contexto.js'

// ---------- senhas (scrypt) ----------
export function hashSenha (senha) {
  const sal = crypto.randomBytes(16).toString('hex')
  return `${sal}:${crypto.scryptSync(String(senha), sal, 32).toString('hex')}`
}
export function confereSenha (senha, hash) {
  const [sal, h] = String(hash || '').split(':')
  if (!sal || !h) return false
  const calc = crypto.scryptSync(String(senha), sal, 32)
  return crypto.timingSafeEqual(calc, Buffer.from(h, 'hex'))
}
// senha temporária fácil de ditar: 3 sílabas + 3 números
export function senhaTemporaria () {
  const s = ['ba', 'ce', 'di', 'fo', 'gu', 'la', 'me', 'ni', 'po', 'ru', 'sa', 'te', 'vi', 'zo']
  const r = (n) => crypto.randomInt(n)
  return s[r(14)] + s[r(14)] + s[r(14)] + String(r(900) + 100)
}

const slugify = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'repassador'
const prefixoDe = (nome) => (String(nome).normalize('NFD').replace(/[^A-Za-z ]/g, '').trim().split(/\s+/).map(p => p[0]).join('').toUpperCase().slice(0, 3) || 'RP')

// ---------- contas ativas (cache curto) ----------
let cacheAtivas = { ts: 0, ids: [1] }
export async function contasAtivas () {
  if (Date.now() - cacheAtivas.ts > 30e3) cacheAtivas = { ts: Date.now(), ids: (await todos('SELECT id FROM repasse.contas WHERE ativo ORDER BY id')).map(r => r.id) }
  return cacheAtivas.ids
}
export const limparCacheAtivas = () => { cacheAtivas.ts = 0 }

export async function carregarTodasConfigs () {
  for (const r of await todos('SELECT id FROM repasse.contas')) await carregarConfig(r.id)
}

export const buscarConta = (id) => um('SELECT id, nome, slug, ativo FROM repasse.contas WHERE id = $1', [id])
export const contaPorSlug = (slug) => um('SELECT id, nome, slug, ativo FROM repasse.contas WHERE slug = $1', [slug])

// ---------- criação e manutenção ----------
export async function criarConta ({ nome, responsavel, email, telefone, cidade, obs }) {
  nome = String(nome || '').trim(); email = String(email || '').trim().toLowerCase()
  if (!nome) throw new Error('Informe o nome do repassador')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Informe um e-mail válido (é o login do repassador)')
  if (await um('SELECT 1 AS x FROM repasse.usuarios WHERE email = $1', [email])) throw new Error('Já existe um usuário com este e-mail')
  let slug = slugify(nome); let i = 1
  while (await um('SELECT 1 AS x FROM repasse.contas WHERE slug = $1', [slug])) slug = `${slugify(nome)}-${++i}`
  const c = await um(`INSERT INTO repasse.contas (nome, slug, responsavel, email, telefone, cidade, obs) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [nome, slug, responsavel || null, email, telefone || null, cidade || null, obs || null])
  const senha = senhaTemporaria()
  await q('INSERT INTO repasse.usuarios (conta_id, nome, email, senha_hash) VALUES ($1,$2,$3,$4)', [c.id, responsavel || nome, email, hashSenha(senha)])
  await comConta(c.id, async () => {
    await carregarConfig(c.id)
    await atualizarConfig({ negocio: { nome, contato: telefone || '', prefixoCodigo: prefixoDe(nome) } })
  })
  limparCacheAtivas()
  return { id: c.id, slug, email, senha }
}

export async function atualizarConta (id, b) {
  const campos = ['nome', 'responsavel', 'email', 'telefone', 'cidade', 'obs']
  const sets = []; const vals = [id]
  for (const k of campos) if (k in b) { vals.push(String(b[k] ?? '').trim() || null); sets.push(`${k} = $${vals.length}`) }
  if ('ativo' in b) { vals.push(!!b.ativo); sets.push(`ativo = $${vals.length}`) }
  if (sets.length) await q(`UPDATE repasse.contas SET ${sets.join(', ')} WHERE id = $1`, vals)
  if ('email' in b && b.email) await q('UPDATE repasse.usuarios SET email = $2 WHERE conta_id = $1', [id, String(b.email).trim().toLowerCase()])
  limparCacheAtivas()
}

export async function redefinirSenha (contaId) {
  const senha = senhaTemporaria()
  const r = await q('UPDATE repasse.usuarios SET senha_hash = $2, trocar_senha = true WHERE conta_id = $1', [contaId, hashSenha(senha)])
  if (!(r.rowCount ?? r.affectedRows)) throw new Error('Esta conta não tem usuário')
  const u = await um('SELECT email FROM repasse.usuarios WHERE conta_id = $1 ORDER BY id LIMIT 1', [contaId])
  return { email: u.email, senha }
}

// ---------- login de repassador ----------
export async function autenticar (email, senha) {
  const u = await um(`SELECT u.*, c.ativo AS conta_ativa FROM repasse.usuarios u JOIN repasse.contas c ON c.id = u.conta_id WHERE u.email = $1`, [String(email || '').trim().toLowerCase()])
  if (!u || !confereSenha(senha, u.senha_hash)) return null
  if (!u.ativo || !u.conta_ativa) throw new Error('Acesso bloqueado. Fale com o administrador.')
  await q('UPDATE repasse.usuarios SET ultimo_acesso = now() WHERE id = $1', [u.id])
  return { id: u.id, contaId: u.conta_id, nome: u.nome, email: u.email, trocarSenha: u.trocar_senha }
}

export async function trocarSenha (usuarioId, atual, nova) {
  const u = await um('SELECT senha_hash FROM repasse.usuarios WHERE id = $1', [usuarioId])
  if (!u || !confereSenha(atual, u.senha_hash)) throw new Error('Senha atual incorreta')
  if (String(nova || '').length < 6) throw new Error('A nova senha precisa de pelo menos 6 caracteres')
  await q('UPDATE repasse.usuarios SET senha_hash = $2, trocar_senha = false WHERE id = $1', [usuarioId, hashSenha(nova)])
}

// usuário ainda válido? (checado a cada requisição, com cache de 60 s)
const cacheUsuarios = new Map()
export async function usuarioValido (id) {
  const c = cacheUsuarios.get(id)
  if (c && Date.now() - c.ts < 60e3) return c.u
  const u = await um(`SELECT u.id, u.conta_id, u.nome, u.email, u.trocar_senha, (u.ativo AND c.ativo) AS ok FROM repasse.usuarios u
    JOIN repasse.contas c ON c.id = u.conta_id WHERE u.id = $1`, [id])
  const v = u?.ok ? { id: u.id, contaId: u.conta_id, nome: u.nome, email: u.email, trocarSenha: u.trocar_senha } : null
  cacheUsuarios.set(id, { ts: Date.now(), u: v })
  if (v) q('UPDATE repasse.contas SET ultimo_acesso = now() WHERE id = $1 AND (ultimo_acesso IS NULL OR ultimo_acesso < now() - interval \'5 minutes\')', [v.contaId]).catch(() => {})
  return v
}
export const limparCacheUsuarios = () => cacheUsuarios.clear()

// ---------- métricas de todas as contas (painel do desenvolvedor) ----------
export async function metricasContas () {
  const contas = await todos(`SELECT c.*, (SELECT email FROM repasse.usuarios u WHERE u.conta_id = c.id ORDER BY id LIMIT 1) AS login,
    (SELECT max(ultimo_acesso) FROM repasse.usuarios u WHERE u.conta_id = c.id) AS ultimo_login FROM repasse.contas c ORDER BY c.id`)
  const [an, gr, ev, cp, ld] = await Promise.all([
    todos(`SELECT conta_id,
      count(*) FILTER (WHERE status = 'pendente')::int AS pendentes,
      count(*) FILTER (WHERE status IN ('circulando','enviado'))::int AS circulacao,
      count(*) FILTER (WHERE status = 'vendido')::int AS vendidos,
      count(*) FILTER (WHERE status = 'vendido' AND vendido_em > now() - interval '30 days')::int AS vendidos30,
      COALESCE(sum(venda_valor) FILTER (WHERE status = 'vendido'), 0)::bigint AS faturamento,
      COALESCE(sum(venda_valor - preco_original) FILTER (WHERE status = 'vendido' AND preco_original > 0), 0)::bigint AS lucro,
      count(*) FILTER (WHERE criado_em > now() - interval '7 days')::int AS recebidos7,
      count(*) FILTER (WHERE codigo IS NOT NULL)::int AS aprovados,
      max(criado_em) AS ultimo_anuncio
      FROM repasse.anuncios GROUP BY conta_id`),
    todos(`SELECT conta_id, count(*) FILTER (WHERE fonte)::int AS fontes, count(*) FILTER (WHERE destino)::int AS destinos, count(*)::int AS grupos FROM repasse.grupos GROUP BY conta_id`),
    todos(`SELECT conta_id, count(*) FILTER (WHERE ok AND ts > now() - interval '7 days')::int AS envios7, count(*) FILTER (WHERE NOT ok AND ts > now() - interval '7 days')::int AS falhas7, max(ts) AS ultimo_envio FROM repasse.envios GROUP BY conta_id`),
    todos('SELECT conta_id, count(*)::int AS compradores FROM repasse.compradores GROUP BY conta_id'),
    todos(`SELECT conta_id, count(*)::int AS leads, count(*) FILTER (WHERE status = 'novo')::int AS leads_novos FROM repasse.leads GROUP BY conta_id`)
  ])
  const por = (lista) => new Map(lista.map(x => [x.conta_id, x]))
  const [A, G, E, C, L] = [por(an), por(gr), por(ev), por(cp), por(ld)]
  return contas.map(c => ({ ...c, ...(A.get(c.id) || {}), ...(G.get(c.id) || {}), ...(E.get(c.id) || {}), ...(C.get(c.id) || {}), ...(L.get(c.id) || {}) }))
}
