// GiroAuto Repasse — servidor web (painel + API). Local: http://localhost:3210
import './silenciar-libsignal.js' // primeiro: não deixa chaves da sessão do WhatsApp irem para o log
import { iniciarMonitorMemoria, memoria } from './memoria.js'
import express from 'express'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { conectar, q, um, todos, usandoPostgres, lerUrlBanco, kvGet, kvSet } from './db.js'
import { cfg, atualizarConfig, CONFIG_PADRAO } from './config.js'
import { conexao, conexaoSeExistir, todasConexoes } from './whatsapp.js'
import { temSessao } from './wa-auth.js'
import { comConta, contaId } from './contexto.js'
import {
  carregarTodasConfigs, contasAtivas, buscarConta, contaPorSlug, criarConta, atualizarConta, redefinirSenha,
  autenticar, trocarSenha, usuarioValido, limparCacheUsuarios, metricasContas, limparCacheAtivas
} from './contas.js'
import {
  definirContasAtivas, montarAnuncio, analisar, regerarTexto, regerarTodos, aprovarAnuncio, definirPrecoRepasse, grupoReconhecido,
  estadoEnvio, destinosPara, iniciarAgendador, gerarFilaDoPeriodo, estadoLote, deduplicarFila, recarregarGrupos, limparCacheContatos
} from './pipeline.js'
import { avaliarFiltros, camposDoAnuncio, renderizar, precoFinal, CAMPOS_DISPONIVEIS } from './formatter.js'
import { CATEGORIAS } from './categorias.js'
import { listarFotos, lerFoto, definirCapa, apagarFoto, recortarExistentes } from './fotos.js'
import { iaDisponivel } from './ia.js'
import { placaDisponivel } from './fipe.js'
import { bus, logDe, registrar, avisar } from './eventos.js'
import { conversar, listarConversas, lerConversa, pausarConversa } from './assistente.js'
import { EXEMPLOS } from './exemplos.js'
import { registrarVenda, desfazerVenda, salvarComprador, listarCompradores, normTel } from './vendas.js'
import { listaVitrine, itemVitrine, fotoPublica, registrarLead, paginaLista, paginaItem } from './vitrine.js'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const PORTA = Number(process.env.PORT || 3210)
const HOST = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1')
const DEMO = process.argv.includes('--demo') || process.env.DEMO === '1'
const SENHA = process.env.ADMIN_SENHA || ''
const SEGREDO = process.env.SESSAO_SEGREDO || crypto.createHash('sha256').update('giroauto:' + SENHA).digest('hex')

// Atrás do proxy da Loja (giroauto.onrender.com/repasse), os links absolutos da vitrine levam esse prefixo
const prefixoProxy = (req) => { const p = String(req.get('x-forwarded-prefix') || ''); return /^\/[a-z0-9_-]{1,30}$/i.test(p) ? p : '' }

// Na nuvem, sem as variáveis essenciais (ou sem conseguir abrir o banco), sobe só uma página explicando
const NUVEM = HOST !== '127.0.0.1'
const faltando = NUVEM ? [!SENHA && 'Falta ADMIN_SENHA (senha do painel)', !process.env.DATABASE_URL && 'Falta DATABASE_URL (conexão do Supabase)'].filter(Boolean) : []
if (!faltando.length) {
  try { await conectar() } catch (e) {
    if (!NUVEM) throw e
    faltando.push('Não conectou ao banco: ' + e.message, ...diagnosticoUrl(process.env.DATABASE_URL), 'Nova tentativa automática em 2 minutos.')
    setTimeout(() => process.exit(1), 120e3) // o Render reinicia o serviço e tenta de novo
  }
}
function diagnosticoUrl (url) {
  const r = lerUrlBanco(url.trim())
  if (r.connectionString) return ['A DATABASE_URL não está no formato postgresql://usuario:senha@host:porta/postgres']
  const d = [`Lido: usuário <b>${r.user}</b>, servidor <b>${r.host}</b>, porta <b>${r.port}</b>, banco <b>${r.database}</b>, senha com ${r.password.length} caracteres`]
  if (/[[\]]/.test(r.password)) d.push('A senha contém colchetes [ ] — remova-os (eles só marcavam o lugar da senha)')
  if (/YOUR-PASSWORD|SUA-SENHA/i.test(r.password)) d.push('A senha ainda está como texto de exemplo')
  if (r.password !== r.password.trim()) d.push('Há espaço antes ou depois da senha')
  if (!r.user.includes('.')) d.push('No Session pooler o usuário deve ser postgres.SEU_REF')
  return d
}
if (faltando.length) {
  const app = express()
  app.get('/saude', (req, res) => res.json({ ok: true, configuracao: 'pendente' }))
  app.use((req, res) => res.status(503).type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>GiroAuto Repasse</title><body style="font:16px system-ui;max-width:600px;margin:40px auto;padding:0 16px">
    <h2>GiroAuto Repasse — configuração pendente</h2><p>Ajuste no Render (Environment):</p>
    <ul>${faltando.map(f => `<li>${f}</li>`).join('')}</ul><p>O serviço reinicia sozinho depois de salvar.</p></body>`))
  app.listen(PORTA, HOST, () => console.log('Configuração pendente:', faltando.join(' | ').replace(/<\/?b>/g, '')))
  await new Promise(() => {})
}

await carregarTodasConfigs()
definirContasAtivas(contasAtivas)
if (DEMO) await comConta(1, async () => (await import('./demo.js')).semearDemo())

const app = express()
app.set('trust proxy', 1)
app.use(express.json({ limit: '2mb' }))

// ---------------- Login ----------------
// Cookie assinado: exp.usuario.conta.assinatura — usuario 0 = desenvolvedor (ADMIN_SENHA)
const assinar = (txt) => crypto.createHmac('sha256', SEGREDO).update(String(txt)).digest('hex')
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=').map(decodeURIComponent)).filter(c => c[0]))
function gravarSessao (req, res, uid, conta) {
  const exp = Date.now() + 30 * 86400e3
  const corpo = `${exp}.${uid}.${conta}`
  res.setHeader('Set-Cookie', `sessao=${corpo}.${assinar(corpo)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${req.secure ? '; Secure' : ''}`)
}
// Login único com o GiroAuto (v0.9.1): pela Loja (giroauto.onrender.com/repasse), o administrador já logado lá
// chega com o cabeçalho x-giro-sso = "<ms>.<quem>.<hmac>", assinado com GIRO_SSO_SEGREDO (o mesmo nos dois
// serviços) e válido por 2 minutos. Vale como a sessão de desenvolvedor (a mesma da ADMIN_SENHA), conta 1.
// O cookie de sessão, se existir, tem prioridade (o desenvolvedor pode estar operando outra conta).
const SSO = process.env.GIRO_SSO_SEGREDO || ''
function lerSso (req) {
  if (SSO.length < 32) return null
  const [ts, quem, sig] = String(req.get('x-giro-sso') || '').split('.')
  if (!ts || !quem || !sig || Math.abs(Date.now() - Number(ts)) > 120e3) return null
  const esperado = crypto.createHmac('sha256', SSO).update(`${ts}.${quem}`).digest('base64url')
  if (sig.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null
  return { dev: true, uid: 0, conta: 1, sso: quem }
}
async function lerSessao (req) {
  return (await lerSessaoCookie(req)) || lerSso(req)
}
async function lerSessaoCookie (req) {
  if (!SENHA) return { dev: true, uid: 0, conta: Number(cookies(req).conta_local) || 1 } // computador local sem senha
  const partes = (cookies(req).sessao || '').split('.')
  if (partes.length !== 4) return null
  const [exp, uid, conta, sig] = partes
  const corpo = `${exp}.${uid}.${conta}`
  if (Number(exp) < Date.now() || sig.length !== 64 || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(assinar(corpo)))) return null
  if (uid === '0') return { dev: true, uid: 0, conta: Number(conta) || 1 }
  const u = await usuarioValido(Number(uid))
  return u ? { dev: false, uid: u.id, conta: u.contaId, usuario: u } : null
}
const tentativas = new Map()
app.post('/api/login', async (req, res) => {
  const ip = req.ip
  const t = tentativas.get(ip) || { n: 0, ate: 0 }
  if (t.ate > Date.now()) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos.' })
  const email = String(req.body?.email || '').trim()
  const senha = String(req.body?.senha || '')
  const falhou = (msg = 'E-mail ou senha incorretos') => {
    t.n++; if (t.n >= 5) { t.ate = Date.now() + 10 * 60e3; t.n = 0 }
    tentativas.set(ip, t)
    return res.status(401).json({ erro: msg })
  }
  // desenvolvedor: sem e-mail (ou "admin") + ADMIN_SENHA
  if (!email || email.toLowerCase() === 'admin') {
    const ok = SENHA && senha && crypto.timingSafeEqual(crypto.createHash('sha256').update(senha).digest(), crypto.createHash('sha256').update(SENHA).digest())
    if (!ok) return falhou()
    tentativas.delete(ip); gravarSessao(req, res, 0, 1); return res.json({ ok: true, dev: true })
  }
  try {
    const u = await autenticar(email, senha)
    if (!u) return falhou()
    tentativas.delete(ip); gravarSessao(req, res, u.id, u.contaId); res.json({ ok: true, trocarSenha: u.trocarSenha })
  } catch (e) { return falhou(e.message) }
})
app.post('/api/logout', (req, res) => { res.setHeader('Set-Cookie', 'sessao=; Path=/; Max-Age=0'); res.json({ ok: true }) })
app.get('/saude', (req, res) => res.json({ ok: true, conexoes: todasConexoes().map(c => ({ conta: c.contaId, status: c.estado.status })) }))
// ---------------- Vitrine pública (sem login) ----------------
// /vitrine = conta 1 (endereço já divulgado); /v/<slug> = vitrine de cada repassador
const vit = express.Router({ mergeParams: true })
vit.use(async (req, res, next) => {
  const conta = req.params.slug ? await contaPorSlug(req.params.slug) : await buscarConta(1)
  if (!conta || !conta.ativo) return res.status(404).type('html').send('<meta charset="utf-8"><p style="font:16px system-ui;padding:20px">Vitrine não encontrada.</p>')
  req.base = prefixoProxy(req) + (req.params.slug ? `/v/${conta.slug}` : '/vitrine')
  comConta(conta.id, () => cfg().vitrine?.ativa === false ? res.status(404).send('Vitrine desativada') : next())
})
vit.get('/', (req, res) => res.type('html').send(paginaLista(req.base)))
vit.get('/dados.json', async (req, res) => { res.set('Cache-Control', 'no-store'); res.json(await listaVitrine(req.base)) })
vit.get('/foto/:id', async (req, res) => {
  if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return res.status(404).end()
  const b = await fotoPublica(req.params.id)
  if (!b) return res.status(404).end()
  res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600' }).send(b)
})
const limiteLead = new Map()
vit.post('/lead', async (req, res) => {
  const t = limiteLead.get(req.ip) || []; const agora = Date.now()
  const rec = t.filter(x => agora - x < 3600e3); if (rec.length >= 10) return res.status(429).json({ erro: 'Muitas solicitações. Tente mais tarde.' })
  try { await registrarLead(req.body || {}); limiteLead.set(req.ip, [...rec, agora]); registrar('info', 'Novo interessado pela vitrine'); avisar('leads', {}); res.json({ ok: true }) } catch (e) { res.status(400).json({ erro: e.message }) }
})
// atendimento da vitrine (assistente)
vit.post('/chat', async (req, res) => {
  try {
    const b = req.body || {}
    res.json(await conversar({ sid: String(b.sid || ''), texto: String(b.texto || ''), codigo: String(b.codigo || ''), canal: 'site', ip: req.ip, base: req.base }))
  } catch (e) { res.status(e.status || 500).json({ erro: e.status ? e.message : 'Não foi possível responder agora.' }); if (!e.status) registrar('erro', 'Assistente: ' + e.message) }
})
vit.get('/:codigo', async (req, res) => {
  const i = await itemVitrine(req.params.codigo, req.base)
  if (!i) return res.status(404).type('html').send(`<meta charset="utf-8"><p style="font:16px system-ui;padding:20px">Este veículo não está mais disponível. <a href="${req.base}">Ver os disponíveis</a></p>`)
  res.type('html').send(paginaItem(i, `${req.protocol}://${req.get('host')}`, req.base))
})
app.use('/vitrine', vit)
app.use('/v/:slug', vit)

app.get('/login', (req, res) => res.sendFile(path.join(DIR, '..', 'public', 'login.html')))
app.use(['/api', '/fotos'], async (req, res, next) => {
  const s = await lerSessao(req).catch(() => null)
  if (!s) return res.status(401).json({ erro: 'login necessário' })
  req.sessao = s
  comConta(s.conta, next) // tudo daqui em diante enxerga só os dados desta conta
})
app.get('/', async (req, res, next) => (await lerSessao(req).catch(() => null)) ? next() : res.redirect('login'))
const soDev = (req, res, next) => req.sessao?.dev ? next() : res.status(403).json({ erro: 'Acesso só para o desenvolvedor' })
app.use(express.static(path.join(DIR, '..', 'public')))

const n = (v) => v == null ? null : Number(v)
const dataIso = (v) => v ? new Date(v).getTime() : null

// ---------------- Estado geral ----------------
app.get('/api/estado', async (req, res) => {
  const C = contaId()
  const cont = await todos('SELECT status, count(*)::int AS n FROM repasse.anuncios WHERE conta_id = $1 GROUP BY status', [C])
  const g = await um(`SELECT count(*) FILTER (WHERE fonte)::int AS fontes, count(*) FILTER (WHERE destino)::int AS destinos FROM repasse.grupos WHERE conta_id = $1`, [C])
  const conta = await um('SELECT id, nome, slug FROM repasse.contas WHERE id = $1', [C])
  res.json({
    sessao: { dev: req.sessao.dev, usuario: req.sessao.usuario?.nome || (req.sessao.dev ? 'Desenvolvedor' : ''), trocarSenha: !!req.sessao.usuario?.trocarSenha },
    conta,
    contas: req.sessao.dev ? await todos('SELECT id, nome, ativo FROM repasse.contas ORDER BY id') : undefined,
    conexao: { ...(conexaoSeExistir(C)?.estado || { status: 'desconectado', qr: null }), ultimoEvento: conexaoSeExistir(C)?.ultimoEvento || null },
    demo: DEMO,
    config: cfg(),
    campos: CAMPOS_DISPONIVEIS,
    categorias: CATEGORIAS,
    recursos: { ia: iaDisponivel(), placa: placaDisponivel(), banco: usandoPostgres ? 'Postgres (nuvem)' : 'local', login: !!SENHA && !req.sessao.sso },
    contagem: Object.fromEntries(cont.map(c => [c.status, c.n])),
    grupos: g,
    envio: estadoEnvio(),
    lote: estadoLote(),
    log: logDe(C).slice(0, 60)
  })
})

app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  res.flushHeaders()
  const minha = req.sessao.conta
  const fn = (e) => { if (e.conta === minha) res.write(`event: ${e.evento}\ndata: ${JSON.stringify(e.dados)}\n\n`) }
  bus.on('evento', fn)
  const ping = setInterval(() => res.write(': ping\n\n'), 25000)
  req.on('close', () => { bus.off('evento', fn); clearInterval(ping) })
})

app.post('/api/config', async (req, res) => {
  const b = req.body || {}
  const c = await atualizarConfig(b)
  // mudanças que alteram o texto: aplica aos anúncios que ainda estão na fila/circulação
  const atualizados = (b.modelo || b.negocio || b.edicao) ? await regerarTodos() : 0
  if (atualizados) registrar('info', `Texto de ${atualizados} anúncio(s) atualizado pelo novo modelo`)
  res.json({ ...c, _atualizados: atualizados })
})
app.post('/api/config/restaurar-modelo', async (req, res) => { const c = await atualizarConfig({ modelo: structuredClone(CONFIG_PADRAO.modelo) }); res.json({ ...c, _atualizados: await regerarTodos() }) })

// ---------------- Grupos e contatos ----------------
app.get('/api/grupos', async (req, res) => {
  const gs = await todos('SELECT * FROM repasse.grupos WHERE conta_id = $1 ORDER BY fonte DESC, destino DESC, anuncios DESC, nome', [contaId()])
  res.json(gs.map(g => ({ ...g, ultimo_anuncio: dataIso(g.ultimo_anuncio), reconhecido: grupoReconhecido(g) })))
})
app.post('/api/grupos/sincronizar', async (req, res) => {
  try { await conexao().sincronizarGrupos(); res.json({ ok: true }) } catch (e) { res.status(400).json({ erro: e.message }) }
})
app.post('/api/grupos/:jid', async (req, res) => {
  const b = req.body || {}
  const C = contaId()
  const g = await um('SELECT * FROM repasse.grupos WHERE conta_id = $1 AND jid = $2', [C, req.params.jid])
  if (!g) return res.status(404).json({ erro: 'grupo não encontrado' })
  let { fonte, destino } = g
  if ('fonte' in b) fonte = !!b.fonte
  if ('destino' in b) destino = !!b.destino
  if (b.destino === true) fonte = false // um grupo não é fonte e destino ao mesmo tempo
  if (b.fonte === true) destino = false
  const arquivado = 'arquivado' in b ? !!b.arquivado : g.arquivado
  if (arquivado) { fonte = false; destino = false }
  await q(`UPDATE repasse.grupos SET arquivado = $6, fonte = $2, destino = $3, somente_confiaveis = $4, regras = $5::jsonb WHERE conta_id = $7 AND jid = $1`,
    [g.jid, fonte, destino, 'somenteConfiaveis' in b ? !!b.somenteConfiaveis : g.somente_confiaveis, JSON.stringify(b.regras ?? g.regras ?? {}), arquivado, C])
  await recarregarGrupos()
  res.json(await um('SELECT * FROM repasse.grupos WHERE conta_id = $1 AND jid = $2', [C, g.jid]))
})

app.get('/api/contatos', async (req, res) => {
  const cs = await todos('SELECT * FROM repasse.contatos WHERE conta_id = $1 ORDER BY anuncios DESC LIMIT 500', [contaId()])
  res.json(cs.map(c => ({ ...c, ultimo_anuncio: dataIso(c.ultimo_anuncio) })))
})
app.post('/api/contatos/:id', async (req, res) => {
  if (!['normal', 'confiavel', 'bloqueado'].includes(req.body?.status)) return res.status(400).json({ erro: 'status inválido' })
  await q('UPDATE repasse.contatos SET status = $2 WHERE conta_id = $3 AND id = $1', [req.params.id, req.body.status, contaId()])
  limparCacheContatos()
  res.json({ ok: true })
})

// ---------------- Anúncios ----------------
async function formatar (a, gruposDestino, pre = null) {
  const fotos = pre ? (pre.fotos.get(a.id) || []) : await listarFotos(a.id)
  const envios = pre ? (pre.envios.get(a.id) || []) : await todos('SELECT grupo_nome, ts, ok, erro, preco, rodada FROM repasse.envios WHERE anuncio_id = $1 ORDER BY ts DESC LIMIT 20', [a.id])
  if (!pre && a.comprador_id) pre = { compradores: new Map([[a.comprador_id, await um('SELECT * FROM repasse.compradores WHERE id = $1 AND conta_id = $2', [a.comprador_id, contaId()])]]) }
  return {
    id: a.id, codigo: a.codigo, numeroFila: a.numero_fila, status: a.status, criadoEm: dataIso(a.criado_em),
    origem: { grupoJid: a.grupo_jid, grupoNome: a.grupo_nome, remetenteId: a.remetente_id, remetenteNome: a.remetente_nome },
    dados: a.dados, texto: a.texto, motivos: a.motivos, nota: a.nota, infoExtra: a.info_extra || '',
    precoOriginal: n(a.preco_original), precoRepasse: n(a.preco_repasse), fipe: n(a.fipe),
    vezesRecebido: a.vezes_recebido, ultimoRecebido: dataIso(a.ultimo_recebido),
    repetir: a.repetir, repetirHoras: n(a.repetir_horas), vezesEnviado: a.vezes_enviado,
    reducaoAtiva: a.reducao_ativa, reducaoPasso: n(a.reducao_passo), reducaoPiso: n(a.reducao_piso),
    venda: a.status === 'vendido' || a.venda_valor ? { valor: n(a.venda_valor), data: a.venda_data, pagamento: a.venda_pagamento, obs: a.venda_obs, compradorId: a.comprador_id, comprador: pre?.compradores?.get(a.comprador_id) || null } : null,
    excluiEm: ['descartado', 'encerrado', 'filtrado'].includes(a.status) && cfg().limpeza?.excluirArquivadosHoras ? dataIso(new Date(new Date(a.encerrado_em || a.criado_em).getTime() + cfg().limpeza.excluirArquivadosHoras * 3600e3)) : null,
    ultimoEnvio: dataIso(a.ultimo_envio), proximoEnvio: dataIso(a.proximo_envio), encerradoEm: dataIso(a.encerrado_em), vendidoEm: dataIso(a.vendido_em), textoEditado: a.texto_editado,
    fotos, envios: envios.map(e => ({ ...e, ts: dataIso(e.ts) })),
    destinos: (await destinosPara(a, gruposDestino)).map(d => ({ nome: d.nome, recusa: d.recusa }))
  }
}

app.get('/api/anuncios', async (req, res) => {
  const { status = 'pendente', busca = '' } = req.query
  const lim = Math.min(Number(req.query.limite) || 120, 300)
  const params = [contaId()]
  let where = 'conta_id = $1'
  if (status !== 'todos') { params.push(status.split(',')); where += ` AND status = ANY($${params.length})` }
  if (busca) { params.push('%' + busca + '%'); where += ` AND (codigo ILIKE $${params.length} OR ('F-' || lpad(numero_fila::text, 4, '0')) ILIKE $${params.length} OR modelo ILIKE $${params.length} OR marca ILIKE $${params.length} OR remetente_nome ILIKE $${params.length} OR grupo_nome ILIKE $${params.length})` }
  // margem = FIPE − valor pedido pelo anunciante
  const MARGEM = '(fipe - preco_original)'
  const MARGEM_PCT = '(CASE WHEN fipe > 0 THEN 100.0 * (fipe - preco_original) / fipe END)'
  // origem (grupo ou contato); 'simulador' = sem grupo
  if (req.query.grupo === 'simulador') where += ' AND grupo_jid IS NULL'
  else if (req.query.grupo) { params.push(req.query.grupo); where += ` AND grupo_jid = $${params.length}` }
  // período de entrada na fila (datas no horário de Brasília)
  if (req.query.desde) { params.push(`${req.query.desde}T00:00:00-03:00`); where += ` AND criado_em >= $${params.length}::timestamptz` }
  if (req.query.ate) { params.push(`${req.query.ate}T23:59:59.999-03:00`); where += ` AND criado_em <= $${params.length}::timestamptz` }
  // marca, modelo, categoria (lista), ano
  if (req.query.marca) { params.push(req.query.marca); where += ` AND marca = $${params.length}` }
  if (req.query.modelo) { params.push(req.query.modelo); where += ` AND modelo = $${params.length}` }
  if (req.query.categoria) { params.push(String(req.query.categoria).split(',')); where += ` AND categoria = ANY($${params.length})` }
  if (req.query.premium === '1') where += ` AND (dados->>'premium')::boolean IS TRUE`
  if (req.query.anoMin) { params.push(Number(req.query.anoMin)); where += ` AND ano_modelo >= $${params.length}` }
  if (req.query.anoMax) { params.push(Number(req.query.anoMax)); where += ` AND ano_modelo <= $${params.length}` }
  if (req.query.precoMax) { params.push(Number(req.query.precoMax)); where += ` AND preco_repasse <= $${params.length}` }
  if (req.query.margemMin) { params.push(Number(req.query.margemMin)); where += ` AND ${MARGEM} >= $${params.length}` }
  if (req.query.margemPctMin) { params.push(Number(req.query.margemPctMin)); where += ` AND ${MARGEM_PCT} >= $${params.length}` }
  const ordens = { margem: `${MARGEM} DESC NULLS LAST`, margemPct: `${MARGEM_PCT} DESC NULLS LAST`, menorPreco: 'preco_original ASC NULLS LAST', maiorPreco: 'preco_original DESC NULLS LAST', antigos: 'criado_em ASC', recebidoDesc: 'COALESCE(ultimo_recebido, criado_em) DESC', recebidoAsc: 'COALESCE(ultimo_recebido, criado_em) ASC', publicadoDesc: 'ultimo_envio DESC NULLS LAST', publicadoAsc: 'ultimo_envio ASC NULLS LAST', anoDesc: 'ano_modelo DESC NULLS LAST', kmAsc: 'km ASC NULLS LAST' }
  const ordem = ordens[req.query.ordem] ? ordens[req.query.ordem] + ', criado_em DESC' : status.includes('circulando') ? 'proximo_envio NULLS LAST, ultimo_envio DESC' : status === 'vendido' ? 'vendido_em DESC' : status === 'encerrado' ? 'encerrado_em DESC' : 'criado_em DESC'
  const rows = await todos(`SELECT * FROM repasse.anuncios WHERE ${where} ORDER BY ${ordem} LIMIT ${lim}`, params)
  const gd = await todos('SELECT jid, nome, regras FROM repasse.grupos WHERE conta_id = $1 AND destino', [contaId()])
  // fotos e envios de todos os anúncios da página em 2 consultas (em vez de 2 por anúncio)
  const ids = rows.map(r => r.id)
  const agrupar = (lista) => lista.reduce((m, x) => { if (!m.has(x.anuncio_id)) m.set(x.anuncio_id, []); m.get(x.anuncio_id).push(x); return m }, new Map())
  const [fts, evs] = ids.length ? await Promise.all([
    todos('SELECT id, anuncio_id, ordem, capa, largura, altura, bytes FROM repasse.fotos WHERE anuncio_id = ANY($1) ORDER BY ordem', [ids]),
    todos('SELECT anuncio_id, grupo_nome, ts, ok, erro, preco, rodada FROM repasse.envios WHERE anuncio_id = ANY($1) ORDER BY ts DESC', [ids])
  ]) : [[], []]
  const cIds = [...new Set(rows.map(r => r.comprador_id).filter(Boolean))]
  const comps = cIds.length ? await todos('SELECT * FROM repasse.compradores WHERE conta_id = $2 AND id = ANY($1)', [cIds, contaId()]) : []
  const pre = { fotos: agrupar(fts), envios: agrupar(evs), compradores: new Map(comps.map(c => [c.id, c])) }
  res.json(await Promise.all(rows.map(a => formatar(a, gd, pre))))
})

// ações em massa: { ids:[], acao: 'aprovado' | 'descartado' | 'pendente' }
// valores disponíveis para os filtros (com contagem), conforme a aba/status
app.get('/api/anuncios/facetas', async (req, res) => {
  const status = String(req.query.status || 'pendente').split(',')
  const P = [status, contaId()]
  const [grupos, marcas, modelos, cats, anos] = await Promise.all([
    todos(`SELECT a.grupo_jid AS jid, COALESCE(g.nome, a.grupo_nome, 'Simulador') AS nome, g.tipo, count(*)::int AS n
      FROM repasse.anuncios a LEFT JOIN repasse.grupos g ON g.jid = a.grupo_jid AND g.conta_id = a.conta_id WHERE a.conta_id = $2 AND a.status = ANY($1) GROUP BY 1, 2, 3 ORDER BY n DESC`, P),
    todos(`SELECT marca AS nome, count(*)::int n FROM repasse.anuncios WHERE conta_id = $2 AND status = ANY($1) AND marca IS NOT NULL GROUP BY 1 ORDER BY 1`, P),
    todos(`SELECT marca, modelo AS nome, count(*)::int n FROM repasse.anuncios WHERE conta_id = $2 AND status = ANY($1) AND modelo IS NOT NULL GROUP BY 1, 2 ORDER BY 2`, P),
    todos(`SELECT categoria AS id, count(*)::int n FROM repasse.anuncios WHERE conta_id = $2 AND status = ANY($1) AND categoria IS NOT NULL GROUP BY 1 ORDER BY n DESC`, P),
    um(`SELECT min(ano_modelo) AS min, max(ano_modelo) AS max FROM repasse.anuncios WHERE conta_id = $2 AND status = ANY($1)`, P)
  ])
  res.json({ grupos: grupos.map(r => ({ ...r, jid: r.jid || 'simulador' })), marcas, modelos, categorias: cats, anos })
})

app.post('/api/anuncios/lote', async (req, res) => {
  const { ids = [], acao } = req.body || {}
  if (!ids.length) return res.json({ alterados: 0 })
  const regras = {
    aprovado: [`'pendente'`, `status = 'aprovado'`],
    descartado: [`'pendente','aprovado','filtrado','erro'`, `status = 'descartado', encerrado_em = now(), proximo_envio = NULL, nota = COALESCE(nota || ' · ', '') || 'Removido em massa'`],
    pendente: [`'descartado','filtrado','encerrado'`, `status = 'pendente', criado_em = now(), encerrado_em = NULL`],
    encerrado: [`'circulando','enviado','aprovado'`, `status = 'encerrado', encerrado_em = now(), proximo_envio = NULL`]
  }
  if (!regras[acao]) return res.status(400).json({ erro: 'ação inválida' })
  const [de, set] = regras[acao]
  let n = 0
  if (acao === 'aprovado') {
    const ok = await todos(`SELECT id FROM repasse.anuncios WHERE conta_id = $2 AND id = ANY($1::uuid[]) AND status IN ('pendente','filtrado') ORDER BY criado_em`, [ids, contaId()])
    for (const r of ok) await aprovarAnuncio(r.id)
    n = ok.length
  } else {
    const r = await q(`UPDATE repasse.anuncios SET ${set} WHERE conta_id = $2 AND id = ANY($1::uuid[]) AND status IN (${de})`, [ids, contaId()])
    n = r.rowCount ?? r.affectedRows ?? 0
  }
  registrar('info', `${n} anúncio(s) ${acao === 'descartado' ? 'removidos da fila' : acao === 'aprovado' ? 'aprovados' : 'recuperados'} em massa`)
  avisar('fila', {})
  res.json({ alterados: n })
})
app.post('/api/anuncios/deduplicar', async (req, res) => res.json({ removidos: await deduplicarFila() }))
app.post('/api/anuncios/aprovar-todos', async (req, res) => {
  const ids = (await todos(`SELECT id FROM repasse.anuncios WHERE conta_id = $1 AND status = 'pendente' ORDER BY criado_em`, [contaId()])).map(r => r.id)
  for (const id of ids) await aprovarAnuncio(id)
  avisar('fila', {})
  res.json({ aprovados: ids.length })
})

app.post('/api/anuncios/:id', async (req, res) => {
  const b = req.body || {}
  const id = req.params.id
  if (!/^[0-9a-f-]{36}$/.test(id)) return res.status(404).json({ erro: 'anúncio não encontrado' })
  const a = await um('SELECT * FROM repasse.anuncios WHERE id = $1 AND conta_id = $2', [id, contaId()])
  if (!a) return res.status(404).json({ erro: 'anúncio não encontrado' })
  if (typeof b.texto === 'string' && b.texto !== a.texto) await q('UPDATE repasse.anuncios SET texto = $2, texto_editado = true WHERE id = $1', [id, b.texto])
  if (b.precoRepasse != null && Number(b.precoRepasse) !== Number(a.preco_repasse)) await definirPrecoRepasse(id, Math.round(Number(b.precoRepasse)))
  if ('repetir' in b || 'repetirHoras' in b) {
    await q(`UPDATE repasse.anuncios SET repetir = $2::boolean, repetir_horas = $3::numeric,
      status = CASE WHEN status = 'enviado' AND $2::boolean THEN 'circulando' WHEN status = 'circulando' AND NOT $2::boolean THEN 'enviado' ELSE status END,
      proximo_envio = CASE WHEN $2::boolean AND ultimo_envio IS NOT NULL THEN ultimo_envio + ($3::numeric * interval '1 hour') ELSE proximo_envio END
      WHERE id = $1`, [id, 'repetir' in b ? !!b.repetir : a.repetir, String(b.repetirHoras ?? a.repetir_horas ?? cfg().repeticao.intervaloHoras)])
  }
  if ('reducaoAtiva' in b || 'reducaoPasso' in b || 'reducaoPiso' in b) {
    const num = (v, padrao) => v === undefined ? padrao : (v === null || v === '' ? null : Math.round(Number(v)))
    await q('UPDATE repasse.anuncios SET reducao_ativa = $2, reducao_passo = $3, reducao_piso = $4 WHERE id = $1', [id,
      'reducaoAtiva' in b ? !!b.reducaoAtiva : a.reducao_ativa, num(b.reducaoPasso, a.reducao_passo), num(b.reducaoPiso, a.reducao_piso)])
  }
  if (typeof b.nota === 'string') await q('UPDATE repasse.anuncios SET nota = $2 WHERE id = $1', [id, b.nota || null])
  if (typeof b.infoExtra === 'string') await q('UPDATE repasse.anuncios SET info_extra = $2 WHERE id = $1', [id, b.infoExtra.trim().slice(0, 4000) || null])
  if (b.capa) await definirCapa(id, b.capa)
  if (b.regerar) await regerarTexto(id)
  if (b.status) {
    const s = b.status
    if (!['pendente', 'aprovado', 'descartado', 'encerrado', 'vendido'].includes(s)) return res.status(400).json({ erro: 'status inválido' })
    if (s === 'aprovado') { await aprovarAnuncio(id) } else if (s === 'pendente' && a.status === 'vendido') { await desfazerVenda(id) } else
    await q(`UPDATE repasse.anuncios SET status = $2::text,
      encerrado_em = CASE WHEN $2::text IN ('encerrado','vendido','descartado') THEN now() ELSE NULL END,
      vendido_em = CASE WHEN $2::text = 'vendido' THEN now() ELSE NULL END,
      proximo_envio = CASE WHEN $2::text IN ('encerrado','vendido','descartado') THEN NULL ELSE proximo_envio END
      WHERE id = $1`, [id, s])
  }
  if (b.enviarAgora) {
    await q(`UPDATE repasse.anuncios SET status = CASE WHEN status IN ('circulando') THEN status ELSE 'aprovado' END, proximo_envio = now() WHERE id = $1`, [id])
  }
  const gd = await todos('SELECT jid, nome, regras FROM repasse.grupos WHERE conta_id = $1 AND destino', [contaId()])
  res.json(await formatar(await um('SELECT * FROM repasse.anuncios WHERE id = $1', [id]), gd))
})

// exclusão manual (vendidos só saem assim)
app.post('/api/anuncios/:id/excluir', async (req, res) => {
  if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return res.status(404).json({ erro: 'anúncio não encontrado' })
  const r = await q(`DELETE FROM repasse.anuncios WHERE id = $1 AND conta_id = $2 AND status NOT IN ('circulando','aprovado')`, [req.params.id, contaId()])
  if (!(r.rowCount ?? r.affectedRows)) return res.status(400).json({ erro: 'Encerre o anúncio antes de excluir' })
  registrar('info', 'Anúncio excluído manualmente'); avisar('fila', {}); res.json({ ok: true })
})

// ---------------- Venda e compradores ----------------
app.post('/api/anuncios/:id/vender', async (req, res) => {
  try { const r = await registrarVenda(req.params.id, req.body || {}); registrar('info', 'Venda registrada'); avisar('fila', {}); res.json(r) } catch (e) { res.status(400).json({ erro: e.message }) }
})
app.get('/api/compradores', async (req, res) => res.json(await listarCompradores(String(req.query.busca || ''))))
app.get('/api/compradores/buscar', async (req, res) => {
  const t = normTel(req.query.tel || '')
  const r = t.length >= 8 ? await todos('SELECT * FROM repasse.compradores WHERE conta_id = $2 AND telefone LIKE $1 ORDER BY atualizado_em DESC LIMIT 5', ['%' + t, contaId()]) : []
  res.json(r)
})
app.post('/api/compradores', async (req, res) => {
  try { res.json({ id: await salvarComprador(req.body || {}) }) } catch (e) { res.status(400).json({ erro: e.message }) }
})
// ---------------- Conversas da assistente ----------------
app.get('/api/conversas', async (req, res) => res.json(await listarConversas()))
app.get('/api/conversas/:id', async (req, res) => { const c = await lerConversa(req.params.id); c ? res.json(c) : res.status(404).json({ erro: 'conversa não encontrada' }) })
app.post('/api/conversas/:id/pausar', async (req, res) => { await pausarConversa(req.params.id, !!req.body?.pausar); res.json({ ok: true }) })

// ---------------- Interessados (vitrine) ----------------
app.get('/api/leads', async (req, res) => {
  res.json(await todos(`SELECT l.*, concat_ws(' ', a.marca, a.modelo, a.ano_modelo) AS veiculo, a.status AS veiculo_status
    FROM repasse.leads l LEFT JOIN repasse.anuncios a ON a.id = l.anuncio_id WHERE l.conta_id = $1 ORDER BY l.criado_em DESC LIMIT 300`, [contaId()]))
})
app.post('/api/leads/:id', async (req, res) => {
  const b = req.body || {}
  if (b.status && !['novo', 'contato', 'negociando', 'ganho', 'perdido'].includes(b.status)) return res.status(400).json({ erro: 'status inválido' })
  await q('UPDATE repasse.leads SET status = COALESCE($2, status), obs = COALESCE($3, obs), atualizado_em = now() WHERE id = $1 AND conta_id = $4', [Number(req.params.id), b.status || null, b.obs ?? null, contaId()])
  res.json({ ok: true })
})

app.get('/fotos/:id', async (req, res) => {
  const buf = await lerFoto(req.params.id, req.query.publico === '1')
  if (!buf) return res.status(404).end()
  res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' }).send(buf)
})
const recortando = new Set()
app.post('/api/fotos/recortar-existentes', async (req, res) => {
  const C = contaId()
  if (!recortando.has(C)) { recortando.add(C); recortarExistentes(cfg().edicao.maxFotosBanco).then(r => { registrar('info', `Fotos recortadas em ${r.recortados} de ${r.anuncios} anúncios`); avisar('fila', {}) }).finally(() => recortando.delete(C)) }
  res.json({ iniciado: true })
})
app.post('/api/fotos/:id/apagar', async (req, res) => { await apagarFoto(req.params.id); res.json({ ok: true }) })

// Gera a fila com as mensagens guardadas de um período (padrão: hoje, desde 00:00 de Brasília)
app.post('/api/fila/gerar-periodo', async (req, res) => {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
  const desde = req.body?.desde ? new Date(req.body.desde).getTime() : new Date(`${hoje}T00:00:00-03:00`).getTime()
  const jids = (await todos('SELECT jid FROM repasse.grupos WHERE conta_id = $1 AND fonte AND NOT arquivado', [contaId()])).map(r => r.jid).filter(j => !req.body?.jids?.length || req.body.jids.includes(j))
  if (!jids.length) return res.status(400).json({ erro: 'Nenhuma fonte marcada' })
  if (estadoLote().rodando) return res.status(409).json({ erro: 'Já há uma geração em andamento' })
  gerarFilaDoPeriodo({ jids, desde, buscarHistorico: req.body?.buscarHistorico !== false }).catch(e => registrar('erro', 'Gerar fila: ' + e.message))
  res.json({ iniciado: true, fontes: jids.length, desde })
})
app.get('/api/fila/gerar-periodo', (req, res) => res.json(estadoLote()))

// ---------------- Relatórios ----------------
app.get('/api/relatorios', async (req, res) => {
  const dias = String(Math.min(Math.max(Number(req.query.dias) || 30, 1), 365))
  const periodo = `conta_id = $2 AND criado_em > now() - ($1 || ' days')::interval`
  const P = [dias, contaId()]
  const agregados = `count(*)::int AS recebidos,
    count(*) FILTER (WHERE status <> 'filtrado')::int AS validos,
    count(*) FILTER (WHERE vezes_enviado > 0)::int AS retransmitidos,
    count(*) FILTER (WHERE status = 'encerrado')::int AS encerrados,
    count(*) FILTER (WHERE status = 'vendido')::int AS vendidos,
    COALESCE(sum(venda_valor) FILTER (WHERE status = 'vendido'), 0)::bigint AS faturamento,
    COALESCE(sum(venda_valor - preco_original) FILTER (WHERE status = 'vendido' AND preco_original > 0), 0)::bigint AS lucro,
    count(*) FILTER (WHERE status = 'descartado')::int AS descartados,
    round(avg(preco_original))::int AS preco_medio,
    round(avg(CASE WHEN fipe > 0 AND preco_original > 0 THEN 100.0 * preco_original / fipe END))::int AS pct_fipe`
  const [totais, porGrupo, porAnunciante, porDestino, porCategoria, porMarca, porDia] = await Promise.all([
    um(`SELECT ${agregados} FROM repasse.anuncios WHERE ${periodo}`, P),
    todos(`SELECT COALESCE(grupo_nome, 'Simulador') AS nome, ${agregados} FROM repasse.anuncios WHERE ${periodo} GROUP BY 1 ORDER BY recebidos DESC`, P),
    todos(`SELECT COALESCE(remetente_nome, remetente_id, '—') AS nome, remetente_id AS id, ${agregados} FROM repasse.anuncios WHERE ${periodo} GROUP BY 1, 2 ORDER BY recebidos DESC LIMIT 50`, P),
    todos(`SELECT grupo_nome AS nome, count(*) FILTER (WHERE ok)::int AS envios, count(DISTINCT anuncio_id)::int AS anuncios, count(*) FILTER (WHERE NOT ok)::int AS falhas
           FROM repasse.envios WHERE conta_id = $2 AND ts > now() - ($1 || ' days')::interval GROUP BY 1 ORDER BY envios DESC`, P),
    todos(`SELECT COALESCE(categoria, '?') AS nome, count(*)::int AS n FROM repasse.anuncios WHERE ${periodo} AND status <> 'filtrado' GROUP BY 1 ORDER BY n DESC`, P),
    todos(`SELECT COALESCE(marca, '?') AS nome, count(*)::int AS n FROM repasse.anuncios WHERE ${periodo} AND status <> 'filtrado' GROUP BY 1 ORDER BY n DESC LIMIT 12`, P),
    todos(`SELECT to_char(date_trunc('day', criado_em AT TIME ZONE 'America/Sao_Paulo'), 'DD/MM') AS dia, count(*) FILTER (WHERE status <> 'filtrado')::int AS validos
           FROM repasse.anuncios WHERE ${periodo} GROUP BY date_trunc('day', criado_em AT TIME ZONE 'America/Sao_Paulo'), 1 ORDER BY date_trunc('day', criado_em AT TIME ZONE 'America/Sao_Paulo')`, P)
  ])
  res.json({ dias: Number(dias), totais, porGrupo, porAnunciante, porDestino, porCategoria: porCategoria.map(c => ({ ...c, nome: CATEGORIAS[c.nome] || c.nome })), porMarca, porDia })
})

// ---------------- Simulador ----------------
app.get('/api/exemplos', (req, res) => res.json(EXEMPLOS))
app.post('/api/simular', async (req, res) => {
  const c = req.body.config ? { ...cfg(), ...req.body.config } : cfg()
  const dados = await analisar(req.body.texto || '', { temFoto: !!req.body.temFoto, usarIA: !!req.body.usarIA })
  const motivos = avaliarFiltros(dados, c, { temMidia: !!req.body.temFoto })
  const precoRepasse = precoFinal(dados.preco, c.edicao.ajustePreco)
  const mensagem = renderizar(camposDoAnuncio(dados, c, { codigo: `${c.negocio.prefixoCodigo}-0000`, precoRepasse }), c.modelo)
  const destinos = (await destinosPara({ dados, preco_repasse: precoRepasse })).map(d => ({ nome: d.nome, recusa: d.recusa }))
  res.json({ dados, motivos, mensagem, precoRepasse, destinos })
})
app.post('/api/simular/fila', async (req, res) => {
  res.json(await montarAnuncio({ texto: req.body.texto || '', origem: { grupoNome: 'Simulador', remetenteNome: 'Você' }, forcar: !!req.body.forcar }))
})

// ---------------- Da Loja GiroAuto (v0.9) ----------------
// A Loja manda um carro do estoque para a Fila (sempre pendente: você confere e aprova aqui).
// Fotos: só endereços /media/<arquivo> da própria Loja (LOJA_URL), baixadas aqui.
const LOJA_URL = () => (process.env.LOJA_URL || 'https://giroauto.onrender.com').replace(/\/+$/, '')
const FOTO_LOJA = /^\/media\/[a-f0-9]{32}\.(jpg|png|webp)$/
async function baixarFotoDaLoja (endereco) {
  const u = new URL(endereco, LOJA_URL())
  if (u.origin !== new URL(LOJA_URL()).origin || !FOTO_LOJA.test(u.pathname)) return null
  const r = await fetch(u, { signal: AbortSignal.timeout(20000) })
  if (!r.ok) return null
  const b = Buffer.from(await r.arrayBuffer())
  return b.length && b.length <= 15 * 1024 * 1024 ? b : null
}
app.post('/api/da-loja/anuncio', async (req, res) => {
  const b = req.body || {}
  const v = b.veiculo || {}
  const loja = b.loja || {}
  const chave = `${Number(loja.id) || 0}:${Number(v.id) || 0}`
  if (!v.marca || !v.modelo || !(Number(v.preco) > 0)) return res.status(400).json({ erro: 'Informe marca, modelo e o preço de repasse.' })
  const ja = await um(`SELECT id, codigo, status FROM repasse.anuncios WHERE conta_id = $1 AND dados->'origemLoja'->>'chave' = $2
    AND status IN ('pendente','aprovado','circulando','enviado') ORDER BY criado_em DESC LIMIT 1`, [contaId(), chave])
  if (ja) return res.json({ ...ja, jaExistia: true })
  const fotos = []
  for (const f of (Array.isArray(b.fotos) ? b.fotos : []).slice(0, 20)) {
    try { const x = await baixarFotoDaLoja(String(f)); if (x) fotos.push(x) } catch {}
  }
  const ano = v.ano_modelo || v.ano_fab
  const r = await montarAnuncio({
    texto: String(b.texto || '').slice(0, 4000) || `${v.marca} ${v.modelo} ${ano || ''}`,
    fotos,
    origem: { grupoNome: 'Loja GiroAuto', remetenteNome: String(loja.nome || 'Loja').slice(0, 80) },
    forcar: true, // carro da própria loja: não passa pelos filtros das fontes
    naFila: true,
    precoFixo: Number(v.preco),
    dadosFixos: {
      marca: v.marca, modelo: v.modelo, versao: v.versao || null, ano: v.ano_fab && v.ano_modelo && v.ano_fab !== v.ano_modelo ? `${v.ano_fab}/${v.ano_modelo}` : (ano ? String(ano) : null),
      anoModelo: ano ? Number(ano) : null, km: Number(v.km) || null, preco: Number(v.preco), fipe: Number(v.fipe) || null,
      cambio: v.cambio || null, combustivel: v.combustivel || null, cor: v.cor || null, cidade: loja.cidade || null,
      origemLoja: { chave, loja: String(loja.nome || ''), veiculoId: Number(v.id) || null }
    }
  })
  res.json({ ...r, fotos: fotos.length })
})

// ---------------- Controle ----------------
app.post('/api/envio/pausar', (req, res) => {
  const e = estadoEnvio()
  e.pausado = !!req.body.pausado
  registrar('info', e.pausado ? 'Envios pausados' : 'Envios retomados')
  res.json(e)
})
app.post('/api/whatsapp/conectar', async (req, res) => {
  if (DEMO) return res.status(400).json({ erro: 'Modo demonstração' })
  const c = conexao()
  if (!['conectado', 'conectando', 'aguardando-qr', 'aguardando-trava'].includes(c.estado.status)) c.ligar().catch(e => registrar('erro', 'WhatsApp: ' + e.message))
  res.json({ ok: true })
})
app.post('/api/whatsapp/sair', async (req, res) => { await conexao().sair(); res.json({ ok: true }) })

// ---------------- Minha conta ----------------
app.post('/api/minha-conta/senha', async (req, res) => {
  if (req.sessao.dev) return res.status(400).json({ erro: 'A senha do desenvolvedor é a ADMIN_SENHA do Render' })
  try { await trocarSenha(req.sessao.uid, req.body?.atual, req.body?.nova); limparCacheUsuarios(); res.json({ ok: true }) } catch (e) { res.status(400).json({ erro: e.message }) }
})

// ---------------- Desenvolvedor: repassadores ----------------
app.get('/api/dev/contas', soDev, async (req, res) => {
  const ms = await metricasContas()
  const mem = process.memoryUsage()
  res.json({
    contas: ms.map(m => ({ ...m, whatsapp: conexaoSeExistir(m.id)?.estado?.status || 'desligado', numero: conexaoSeExistir(m.id)?.estado?.eu?.id?.split(':')[0] || null })),
    servidor: { memoriaMB: Math.round(mem.rss / 1048576), memoria: memoria(), conexoes: todasConexoes().filter(c => c.conectado()).length, uptimeH: Math.round(process.uptime() / 360) / 10 }
  })
})
app.post('/api/dev/contas', soDev, async (req, res) => {
  try { const r = await criarConta(req.body || {}); res.json(r) } catch (e) { res.status(400).json({ erro: e.message }) }
})
app.post('/api/dev/contas/:id', soDev, async (req, res) => {
  const id = Number(req.params.id)
  try {
    await atualizarConta(id, req.body || {})
    limparCacheUsuarios()
    if (req.body?.ativo === false) conexaoSeExistir(id)?.parar()
    res.json({ ok: true })
  } catch (e) { res.status(400).json({ erro: e.message }) }
})
app.post('/api/dev/contas/:id/senha', soDev, async (req, res) => {
  try { res.json(await redefinirSenha(Number(req.params.id))) } catch (e) { res.status(400).json({ erro: e.message }) }
})
// o desenvolvedor passa a operar outra conta
app.post('/api/dev/entrar/:id', soDev, async (req, res) => {
  const c = await buscarConta(Number(req.params.id))
  if (!c) return res.status(404).json({ erro: 'conta não encontrada' })
  if (!SENHA) res.setHeader('Set-Cookie', `conta_local=${c.id}; Path=/; SameSite=Lax`)
  else gravarSessao(req, res, 0, c.id)
  res.json({ ok: true })
})

// um erro solto não derruba o servidor (e o WhatsApp junto)
process.on('unhandledRejection', (e) => console.error('Erro não tratado:', e?.stack || e))
process.on('uncaughtException', (e) => console.error('Exceção não tratada:', e?.stack || e))

// Desligamento (deploy, suspensão, hibernação): fecha o WhatsApp com end() — nunca logout() — e libera a trava,
// para o próximo servidor conectar sem esperar a trava expirar.
let encerrando = false
async function encerrar (sinal) {
  if (encerrando) return
  encerrando = true
  console.log(`${sinal} recebido: desligando o WhatsApp (sem sair da conta) e liberando a trava…`)
  setTimeout(() => process.exit(0), 10e3)
  await Promise.allSettled(todasConexoes().map(c => c.encerrar()))
  console.log('WhatsApp desligado e trava liberada.')
  process.exit(0)
}
process.on('SIGTERM', () => encerrar('SIGTERM'))
process.on('SIGINT', () => encerrar('SIGINT'))

app.listen(PORTA, HOST, () => {
  console.log(`\n  GiroAuto Repasse em http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORTA}  (banco: ${usandoPostgres ? 'Postgres' : 'local'})\n`)
  if (!SENHA) console.log('  Sem ADMIN_SENHA: painel sem login (somente neste computador).\n')
  iniciarAgendador()
  iniciarMonitorMemoria()
  // Plano gratuito do Render hiberna após ~15 min sem acesso: um "ping" no próprio endereço público o mantém acordado
  const publico = process.env.KEEPALIVE_URL || process.env.RENDER_EXTERNAL_URL
  if (publico && process.env.KEEPALIVE !== '0') {
    setInterval(() => fetch(publico.replace(/\/$/, '') + '/saude').catch(() => {}), 10 * 60e3)
    console.log('  Mantendo o serviço acordado com ping a cada 10 min.')
  }
  // v0.7: km passou a sair em faixa — refaz uma vez os textos não editados à mão
  ;(async () => {
    for (const id of await contasAtivas()) {
      await comConta(id, async () => {
        if (await kvGet(`v07-km-faixa:${id}`)) return
        const n = await regerarTodos()
        await kvSet(`v07-km-faixa:${id}`, true)
        if (n) registrar('info', `${n} texto(s) refeitos com o km em faixa`)
      }).catch(e => console.error('v0.7 km:', e.message))
    }
  })()
  if (DEMO) { console.log('  Modo demonstração: WhatsApp desligado.\n'); return }
  ;(async () => {
    for (const id of await contasAtivas()) {
      // conta 1 sempre (já em uso); as demais só se já escanearam o QR alguma vez
      if (id === 1 || await temSessao(id)) {
        // ligar() espera a trava de conexão única; não bloqueia as outras contas
        await comConta(id, () => { conexao(id).ligar().catch(e => registrar('erro', 'Falha ao iniciar WhatsApp: ' + e.message)) })
        await new Promise(r => setTimeout(r, 3000))
      }
    }
  })()
})
