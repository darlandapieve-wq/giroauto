// Banco de dados: Postgres (Supabase) quando DATABASE_URL existe; senão PGlite local (data/pglite).
// Todas as tabelas ficam no schema "repasse", separado do resto do projeto Supabase.
import path from 'node:path'
import fs from 'node:fs'

let cliente
export const usandoPostgres = !!process.env.DATABASE_URL

// Lê a string de conexão aceitando senha com símbolos (#, @, /, %…) sem precisar codificar
export function lerUrlBanco (url) {
  const m = url.match(/^postgres(?:ql)?:\/\/([^:]+):(.*)@([^@/:]+)(?::(\d+))?(?:\/([^?#]*))?(?:\?.*)?$/)
  if (!m) return { connectionString: url }
  let senha = m[2]
  try { if (/%[0-9a-f]{2}/i.test(senha)) senha = decodeURIComponent(senha) } catch {}
  return { user: decodeURIComponent(m[1]), password: senha, host: m[3], port: Number(m[4] || 5432), database: m[5] || 'postgres' }
}

export async function conectar () {
  if (cliente) return cliente
  if (usandoPostgres) {
    const pg = (await import('pg')).default
    const pool = new pg.Pool({
      ...lerUrlBanco(process.env.DATABASE_URL.trim()),
      ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
      max: 10
    })
    pool.on('error', (e) => console.error('Banco:', e.message))
    cliente = { query: (sql, p) => pool.query(sql, p) }
  } else {
    const { PGlite } = await import('@electric-sql/pglite')
    const dir = path.resolve(process.env.DATA_DIR || './data', 'pglite')
    fs.mkdirSync(dir, { recursive: true })
    const db = new PGlite(dir)
    cliente = { query: (sql, p) => db.query(sql, p) }
  }
  await migrar()
  return cliente
}

export const q = async (sql, p = []) => (await conectar()).query(sql, p)
export const um = async (sql, p) => (await q(sql, p)).rows[0] || null
export const todos = async (sql, p) => (await q(sql, p)).rows

async function migrar () {
  const passos = [
    'CREATE SCHEMA IF NOT EXISTS repasse',
    `CREATE TABLE IF NOT EXISTS repasse.kv (chave text PRIMARY KEY, valor jsonb NOT NULL, atualizado timestamptz DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS repasse.wa_auth (id text PRIMARY KEY, valor text NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS repasse.grupos (
      jid text PRIMARY KEY, nome text, fonte boolean DEFAULT false, destino boolean DEFAULT false,
      somente_confiaveis boolean DEFAULT false, sou_admin boolean DEFAULT false, participantes int DEFAULT 0,
      comunidade text, comunidade_nome text, somente_admins boolean DEFAULT false,
      regras jsonb DEFAULT '{}'::jsonb, mensagens int DEFAULT 0, anuncios int DEFAULT 0,
      ultimo_anuncio timestamptz, criado_em timestamptz DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS repasse.contatos (
      id text PRIMARY KEY, nome text, status text DEFAULT 'normal', anuncios int DEFAULT 0,
      grupos jsonb DEFAULT '[]'::jsonb, ultimo_anuncio timestamptz)`,
    'CREATE SEQUENCE IF NOT EXISTS repasse.seq_codigo',
    `CREATE TABLE IF NOT EXISTS repasse.anuncios (
      id uuid PRIMARY KEY, codigo text UNIQUE, status text NOT NULL, criado_em timestamptz DEFAULT now(),
      grupo_jid text, grupo_nome text, remetente_id text, remetente_nome text,
      marca text, modelo text, categoria text, ano_modelo int, km int,
      preco_original int, preco_repasse int, fipe int,
      dados jsonb NOT NULL, texto text, motivos jsonb DEFAULT '[]'::jsonb,
      fp1 text, fp2 text, vezes_recebido int DEFAULT 1, ultimo_recebido timestamptz DEFAULT now(),
      repetir boolean DEFAULT false, repetir_horas numeric, vezes_enviado int DEFAULT 0,
      ultimo_envio timestamptz, proximo_envio timestamptz, encerrado_em timestamptz, nota text)`,
    'ALTER TABLE repasse.anuncios ADD COLUMN IF NOT EXISTS reducao_ativa boolean DEFAULT false',
    'ALTER TABLE repasse.anuncios ADD COLUMN IF NOT EXISTS reducao_passo int',
    'ALTER TABLE repasse.anuncios ADD COLUMN IF NOT EXISTS reducao_piso int',
    "ALTER TABLE repasse.grupos ADD COLUMN IF NOT EXISTS arquivado boolean DEFAULT true",
    "ALTER TABLE repasse.grupos ADD COLUMN IF NOT EXISTS tipo text DEFAULT 'grupo'",
    `CREATE TABLE IF NOT EXISTS repasse.mensagens (
      id text PRIMARY KEY, chat_jid text NOT NULL, ts timestamptz NOT NULL, remetente_id text, remetente_nome text,
      texto text, tem_imagem boolean DEFAULT false, bruto text, processado boolean DEFAULT false)`,
    'CREATE INDEX IF NOT EXISTS mensagens_chat_ts_idx ON repasse.mensagens (chat_jid, ts)',
    'ALTER TABLE repasse.anuncios ADD COLUMN IF NOT EXISTS texto_editado boolean DEFAULT false',
    'ALTER TABLE repasse.anuncios ADD COLUMN IF NOT EXISTS vendido_em timestamptz',
    'CREATE SEQUENCE IF NOT EXISTS repasse.seq_fila',
    "ALTER TABLE repasse.anuncios ADD COLUMN IF NOT EXISTS numero_fila int DEFAULT nextval('repasse.seq_fila')",
    `CREATE TABLE IF NOT EXISTS repasse.compradores (
      id serial PRIMARY KEY, nome text NOT NULL, telefone text, documento text, cidade text, uf text,
      tipo text DEFAULT 'lojista', email text, obs text, criado_em timestamptz DEFAULT now(), atualizado_em timestamptz DEFAULT now())`,
    'CREATE INDEX IF NOT EXISTS compradores_tel_idx ON repasse.compradores (telefone)',
    'ALTER TABLE repasse.anuncios ADD COLUMN IF NOT EXISTS comprador_id int',
    'ALTER TABLE repasse.anuncios ADD COLUMN IF NOT EXISTS venda_valor int',
    'ALTER TABLE repasse.anuncios ADD COLUMN IF NOT EXISTS venda_data date',
    'ALTER TABLE repasse.anuncios ADD COLUMN IF NOT EXISTS venda_pagamento text',
    'ALTER TABLE repasse.anuncios ADD COLUMN IF NOT EXISTS venda_obs text',
    `CREATE TABLE IF NOT EXISTS repasse.leads (
      id serial PRIMARY KEY, nome text, telefone text, mensagem text, anuncio_id uuid, codigo text,
      origem text DEFAULT 'vitrine', status text DEFAULT 'novo', obs text, criado_em timestamptz DEFAULT now(), atualizado_em timestamptz DEFAULT now())`,
    'CREATE INDEX IF NOT EXISTS leads_criado_idx ON repasse.leads (criado_em)',
    'CREATE INDEX IF NOT EXISTS anuncios_status_idx ON repasse.anuncios (status, criado_em)',
    'CREATE INDEX IF NOT EXISTS anuncios_fp1_idx ON repasse.anuncios (fp1)',
    'CREATE INDEX IF NOT EXISTS anuncios_fp2_idx ON repasse.anuncios (fp2)',
    `CREATE TABLE IF NOT EXISTS repasse.fotos (
      id uuid PRIMARY KEY, anuncio_id uuid REFERENCES repasse.anuncios(id) ON DELETE CASCADE,
      ordem int DEFAULT 0, capa boolean DEFAULT false, largura int, altura int, bytes int,
      dados bytea NOT NULL, criado_em timestamptz DEFAULT now())`,
    'CREATE INDEX IF NOT EXISTS fotos_anuncio_idx ON repasse.fotos (anuncio_id, ordem)',
    `CREATE TABLE IF NOT EXISTS repasse.envios (
      id bigserial PRIMARY KEY, anuncio_id uuid REFERENCES repasse.anuncios(id) ON DELETE CASCADE,
      grupo_jid text, grupo_nome text, ts timestamptz DEFAULT now(), ok boolean, erro text,
      preco int, rodada int)`,
    'CREATE INDEX IF NOT EXISTS envios_ts_idx ON repasse.envios (ts)'
  ]
  for (const s of passos) await cliente.query(s)
  await migrarContas()
  await migrarAssistente()
}

// ---------- v0.6: assistente de atendimento ----------
async function migrarAssistente () {
  for (const s of [
    `CREATE TABLE IF NOT EXISTS repasse.conversas (
      id text PRIMARY KEY, conta_id int NOT NULL, canal text NOT NULL DEFAULT 'site', contato text, nome text, telefone text,
      anuncio_id uuid, lead_id int, dados jsonb DEFAULT '{}'::jsonb, pausado_ate timestamptz, precisa_humano boolean DEFAULT false,
      ip text, criado_em timestamptz DEFAULT now(), atualizado_em timestamptz DEFAULT now())`,
    'CREATE INDEX IF NOT EXISTS conversas_conta_idx ON repasse.conversas (conta_id, atualizado_em DESC)',
    'CREATE INDEX IF NOT EXISTS conversas_contato_idx ON repasse.conversas (conta_id, canal, contato)',
    `CREATE TABLE IF NOT EXISTS repasse.conversa_msgs (
      id bigserial PRIMARY KEY, conversa_id text NOT NULL REFERENCES repasse.conversas(id) ON DELETE CASCADE,
      papel text NOT NULL, texto text, meta jsonb DEFAULT '{}'::jsonb, ts timestamptz DEFAULT now())`,
    'CREATE INDEX IF NOT EXISTS conversa_msgs_idx ON repasse.conversa_msgs (conversa_id, id)',
    'ALTER TABLE repasse.anuncios ADD COLUMN IF NOT EXISTS info_extra text',
    'ALTER TABLE repasse.leads ADD COLUMN IF NOT EXISTS conversa_id text',
    // v0.7: placa borrada nas fotos públicas
    'ALTER TABLE repasse.fotos ADD COLUMN IF NOT EXISTS placa_status text',
    'ALTER TABLE repasse.fotos ADD COLUMN IF NOT EXISTS placa_caixas jsonb',
    'ALTER TABLE repasse.fotos ADD COLUMN IF NOT EXISTS dados_publico bytea'
  ]) await cliente.query(s)
}

// ---------- v0.5: vários repassadores (contas) ----------
// Os dados que já existiam passam a ser da conta 1. Idempotente: pode rodar a cada início.
const TABELAS_CONTA = ['grupos', 'contatos', 'anuncios', 'mensagens', 'envios', 'compradores', 'leads']
async function colunasPk (tabela) {
  const r = await cliente.query(`SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = ('repasse.' || $1)::regclass AND i.indisprimary`, [tabela])
  return r.rows.map(x => x.attname)
}
async function migrarContas () {
  const Q = (s, p) => cliente.query(s, p)
  await Q(`CREATE TABLE IF NOT EXISTS repasse.contas (
    id serial PRIMARY KEY, nome text NOT NULL, slug text UNIQUE, ativo boolean DEFAULT true,
    responsavel text, email text, telefone text, cidade text, obs text,
    seq_codigo int DEFAULT 0, seq_fila int DEFAULT 0, criado_em timestamptz DEFAULT now(), ultimo_acesso timestamptz)`)
  await Q(`CREATE TABLE IF NOT EXISTS repasse.usuarios (
    id serial PRIMARY KEY, conta_id int NOT NULL, nome text, email text UNIQUE NOT NULL, senha_hash text NOT NULL,
    ativo boolean DEFAULT true, trocar_senha boolean DEFAULT true, criado_em timestamptz DEFAULT now(), ultimo_acesso timestamptz)`)
  const existe = (await Q('SELECT 1 FROM repasse.contas WHERE id = 1')).rows.length
  if (!existe) {
    const cfg = (await Q("SELECT valor FROM repasse.kv WHERE chave = 'config'")).rows[0]?.valor
    await Q(`INSERT INTO repasse.contas (id, nome, slug) VALUES (1, $1, 'giroauto-repasse')`, [cfg?.negocio?.nome || 'GiroAuto Repasse'])
    await Q(`SELECT setval(pg_get_serial_sequence('repasse.contas', 'id'), 1)`)
  }
  for (const t of TABELAS_CONTA) {
    await Q(`ALTER TABLE repasse.${t} ADD COLUMN IF NOT EXISTS conta_id int DEFAULT 1`)
    await Q(`UPDATE repasse.${t} SET conta_id = 1 WHERE conta_id IS NULL`)
    await Q(`ALTER TABLE repasse.${t} ALTER COLUMN conta_id SET NOT NULL`)
    await Q(`ALTER TABLE repasse.${t} ALTER COLUMN conta_id DROP DEFAULT`)
    await Q(`CREATE INDEX IF NOT EXISTS ${t}_conta_idx ON repasse.${t} (conta_id)`)
  }
  // chaves primárias passam a incluir a conta (o mesmo grupo pode estar no WhatsApp de dois repassadores)
  for (const [t, col] of [['grupos', 'jid'], ['contatos', 'id'], ['mensagens', 'id']]) {
    const pk = await colunasPk(t)
    if (pk.length === 1) {
      await Q(`ALTER TABLE repasse.${t} DROP CONSTRAINT ${t}_pkey`)
      await Q(`ALTER TABLE repasse.${t} ADD PRIMARY KEY (conta_id, ${col})`)
    }
  }
  await Q('ALTER TABLE repasse.anuncios DROP CONSTRAINT IF EXISTS anuncios_codigo_key')
  await Q('CREATE UNIQUE INDEX IF NOT EXISTS anuncios_conta_codigo_idx ON repasse.anuncios (conta_id, codigo)')
  await Q('ALTER TABLE repasse.anuncios ALTER COLUMN numero_fila DROP DEFAULT')
  // sequências por conta (código GA e número da fila) a partir do que já existe
  await Q(`UPDATE repasse.contas c SET
    seq_codigo = GREATEST(c.seq_codigo, COALESCE((SELECT max(substring(codigo from '[0-9]+$')::int) FROM repasse.anuncios a WHERE a.conta_id = c.id AND codigo ~ '[0-9]+$'), 0)),
    seq_fila = GREATEST(c.seq_fila, COALESCE((SELECT max(numero_fila) FROM repasse.anuncios a WHERE a.conta_id = c.id), 0))`)
  // sessão do WhatsApp e configuração da conta 1
  await Q(`UPDATE repasse.wa_auth SET id = 'c1:' || id WHERE id !~ '^c[0-9]+:'`)
  await Q(`INSERT INTO repasse.kv (chave, valor) SELECT 'config:1', valor FROM repasse.kv WHERE chave = 'config' ON CONFLICT (chave) DO NOTHING`)
  await Q(`DELETE FROM repasse.kv WHERE chave = 'config'`)
}

// próximo número de uma sequência da conta ('seq_codigo' | 'seq_fila')
export async function proximo (contaId, seq) {
  if (!['seq_codigo', 'seq_fila'].includes(seq)) throw new Error('sequência inválida')
  return (await um(`UPDATE repasse.contas SET ${seq} = ${seq} + 1 WHERE id = $1 RETURNING ${seq} AS n`, [contaId])).n
}

// ---------- chave/valor (configuração, caches) ----------
export async function kvGet (chave) {
  const r = await um('SELECT valor FROM repasse.kv WHERE chave = $1', [chave])
  return r ? r.valor : null
}
export async function kvSet (chave, valor) {
  await q(`INSERT INTO repasse.kv (chave, valor, atualizado) VALUES ($1, $2::jsonb, now())
           ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado = now()`, [chave, JSON.stringify(valor)])
}
