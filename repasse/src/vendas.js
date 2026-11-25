// Vendas e cadastro de compradores (semelhante ao GiroAuto da loja)
import { q, um, todos } from './db.js'
import { contaId } from './contexto.js'

export const soDigitos = (t) => String(t || '').replace(/\D/g, '')
// telefone brasileiro normalizado: DDD + número (sem 55)
export function normTel (t) {
  let d = soDigitos(t)
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2)
  return d
}

const limpar = (c = {}) => ({
  nome: String(c.nome || '').trim(),
  telefone: normTel(c.telefone),
  documento: soDigitos(c.documento) || null,
  cidade: String(c.cidade || '').trim() || null,
  uf: String(c.uf || '').trim().toUpperCase().slice(0, 2) || null,
  tipo: ['lojista', 'repassador', 'particular'].includes(c.tipo) ? c.tipo : 'lojista',
  email: String(c.email || '').trim() || null,
  obs: String(c.obs || '').trim() || null
})

// Acha pelo id, ou pelo telefone; senão cria. Atualiza os dados informados.
export async function salvarComprador (dados) {
  const c = limpar(dados)
  if (!c.nome) throw new Error('Informe o nome do comprador')
  if (!c.telefone || c.telefone.length < 10) throw new Error('Informe o WhatsApp do comprador com DDD')
  const C = contaId()
  let atual = dados.id ? await um('SELECT * FROM repasse.compradores WHERE id = $1 AND conta_id = $2', [Number(dados.id) || 0, C]) : null
  if (!atual) atual = await um('SELECT * FROM repasse.compradores WHERE conta_id = $2 AND telefone = $1 ORDER BY id LIMIT 1', [c.telefone, C])
  if (atual) {
    await q(`UPDATE repasse.compradores SET nome = $2, telefone = $3, documento = COALESCE($4, documento), cidade = COALESCE($5, cidade),
      uf = COALESCE($6, uf), tipo = $7, email = COALESCE($8, email), obs = COALESCE($9, obs), atualizado_em = now() WHERE id = $1`,
    [atual.id, c.nome, c.telefone, c.documento, c.cidade, c.uf, c.tipo, c.email, c.obs])
    return atual.id
  }
  const r = await um(`INSERT INTO repasse.compradores (conta_id, nome, telefone, documento, cidade, uf, tipo, email, obs)
    VALUES ($9,$1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [c.nome, c.telefone, c.documento, c.cidade, c.uf, c.tipo, c.email, c.obs, C])
  return r.id
}

// Marca o anúncio como vendido, com comprador e dados da venda
export async function registrarVenda (anuncioId, { comprador, valor, data, pagamento, obs }) {
  if (!/^[0-9a-f-]{36}$/.test(String(anuncioId))) throw new Error('Anúncio não encontrado')
  const a = await um('SELECT id, preco_repasse, status FROM repasse.anuncios WHERE id = $1 AND conta_id = $2', [anuncioId, contaId()])
  if (!a) throw new Error('Anúncio não encontrado')
  const compradorId = await salvarComprador(comprador || {})
  const v = Math.round(Number(String(valor ?? '').replace(/[^\d]/g, ''))) || a.preco_repasse || null
  await q(`UPDATE repasse.anuncios SET status = 'vendido', vendido_em = now(), encerrado_em = now(), proximo_envio = NULL,
    comprador_id = $2, venda_valor = $3, venda_data = COALESCE($4::date, CURRENT_DATE), venda_pagamento = $5, venda_obs = $6
    WHERE id = $1`, [anuncioId, compradorId, v, data || null, pagamento || null, obs || null])
  return { compradorId }
}

export async function desfazerVenda (anuncioId) {
  await q(`UPDATE repasse.anuncios SET status = 'pendente', vendido_em = NULL, encerrado_em = NULL, comprador_id = NULL,
    venda_valor = NULL, venda_data = NULL, venda_pagamento = NULL, venda_obs = NULL, criado_em = now() WHERE id = $1 AND conta_id = $2`, [anuncioId, contaId()])
}

export async function listarCompradores (busca = '') {
  const p = [contaId()]
  let w = 'c.conta_id = $1'
  if (busca) { p.push('%' + busca + '%'); w += ` AND (c.nome ILIKE $2 OR c.telefone ILIKE $2 OR c.cidade ILIKE $2 OR c.documento ILIKE $2)` }
  return todos(`SELECT c.*, count(a.id)::int AS compras, COALESCE(sum(a.venda_valor), 0)::bigint AS total,
      COALESCE(sum(a.venda_valor - a.preco_original) FILTER (WHERE a.preco_original > 0), 0)::bigint AS lucro,
      max(a.venda_data) AS ultima_compra,
      COALESCE(json_agg(json_build_object('id', a.id, 'codigo', a.codigo, 'titulo', concat_ws(' ', a.marca, a.modelo, a.ano_modelo), 'valor', a.venda_valor, 'data', a.venda_data) ORDER BY a.venda_data DESC) FILTER (WHERE a.id IS NOT NULL), '[]') AS veiculos
    FROM repasse.compradores c LEFT JOIN repasse.anuncios a ON a.comprador_id = c.id AND a.status = 'vendido'
    WHERE ${w} GROUP BY c.id ORDER BY max(a.venda_data) DESC NULLS LAST, c.nome`, p)
}
