// Fluxo: mensagem -> mapeamento -> agrupamento (fotos + texto) -> extração (regras + IA)
//        -> categoria/FIPE -> filtros -> repetidos -> fila -> envio (com repetição periódica)
import crypto from 'node:crypto'
import { q, um, todos } from './db.js'
import { cfg } from './config.js'
import { parseAnuncio } from './parser.js'
import { avaliarFiltros, camposDoAnuncio, renderizar, precoFinal, destinoAceita } from './formatter.js'
import { categorizar } from './categorias.js'
import { analisarComIA, mesclarComIA, anuncioIncerto, iaDisponivel } from './ia.js'
import { consultarFipe } from './fipe.js'
import { salvarFotos, fotoCapa, miniaturaParaIA, recortarTodas } from './fotos.js'
import { registrar, avisar } from './eventos.js'
import { contaId, comConta } from './contexto.js'
import { proximo, kvGet, kvSet } from './db.js'
import { prepararFotosPublicas, prepararPendentes, prepararCapasDaFila } from './placa.js'
import { conexao, conexaoSeExistir } from './whatsapp.js'

const C = () => contaId()
let waFalso = null
const wa = () => waFalso || conexaoSeExistir(C())
// testes: troca a conexão real por uma simulada
export function usarWhatsAppDeTeste (fake) { waFalso = fake }

// estado em memória de cada conta (caches, fila de agrupamento, envio, geração em lote)
const estados = new Map()
export function est (id = C()) {
  if (!estados.has(id)) {
    estados.set(id, {
      cacheGrupos: null, pendStats: new Map(), pendContatos: new Map(), cacheStatus: new Map(), buffers: new Map(),
      lote: { rodando: false, etapa: '', total: 0, feitos: 0, criados: 0, repetidos: 0, filtrados: 0 },
      envio: { pausado: false, proximoEm: 0, enviando: false }
    })
  }
  return estados.get(id)
}

const moeda = (v) => v == null ? '' : 'R$ ' + Math.round(v).toLocaleString('pt-BR')

// ---------------- Mapeamento ----------------
// Grupos ficam em memória (o banco está longe: cada consulta custa ~0,1 s). Contadores são somados
// em memória e gravados em lote a cada 20 s, para não travar quando chegam centenas de mensagens.
export async function recarregarGrupos () {
  const e = est()
  e.cacheGrupos = new Map((await todos('SELECT * FROM repasse.grupos WHERE conta_id = $1', [C()])).map(g => [g.jid, g]))
  return e.cacheGrupos
}
async function grupos () { return est().cacheGrupos || recarregarGrupos() }

export async function garantirGrupo (jid, nome, tipo = 'grupo') {
  const cache = await grupos()
  const g = cache.get(jid)
  if (g && (!nome || g.nome === nome)) return g
  const novo = await um(`INSERT INTO repasse.grupos (conta_id, jid, nome, tipo) VALUES ($4, $1, $2, $3)
           ON CONFLICT (conta_id, jid) DO UPDATE SET nome = COALESCE(EXCLUDED.nome, repasse.grupos.nome) RETURNING *`, [jid, nome || null, tipo, C()])
  cache.set(jid, novo)
  return novo
}

function registrarEstatistica (grupo, remetente, ehAnuncio) {
  const { pendStats, pendContatos } = est()
  const s = pendStats.get(grupo.jid) || { m: 0, a: 0 }
  s.m++; if (ehAnuncio) s.a++
  pendStats.set(grupo.jid, s)
  grupo.mensagens = (grupo.mensagens || 0) + 1
  if (ehAnuncio) { grupo.anuncios = (grupo.anuncios || 0) + 1; grupo.ultimo_anuncio = new Date() }
  if (!ehAnuncio || !remetente.id) return
  const c = pendContatos.get(remetente.id) || { nome: null, n: 0, grupos: new Set() }
  c.n++; c.grupos.add(grupo.jid); if (remetente.nome) c.nome = remetente.nome
  pendContatos.set(remetente.id, c)
}

export async function gravarEstatisticas () {
  const { pendStats, pendContatos } = est()
  const stats = [...pendStats]; pendStats.clear()
  const conts = [...pendContatos]; pendContatos.clear()
  for (const [jid, s] of stats) {
    await q(`UPDATE repasse.grupos SET mensagens = mensagens + $2, anuncios = anuncios + $3,
             ultimo_anuncio = CASE WHEN $3 > 0 THEN now() ELSE ultimo_anuncio END WHERE jid = $1 AND conta_id = $4`, [jid, s.m, s.a, C()])
  }
  for (const [id, c] of conts) {
    await q(`INSERT INTO repasse.contatos (conta_id, id, nome, anuncios, grupos, ultimo_anuncio) VALUES ($5, $1, $2, $3, $4::jsonb, now())
             ON CONFLICT (conta_id, id) DO UPDATE SET nome = COALESCE(EXCLUDED.nome, repasse.contatos.nome), anuncios = repasse.contatos.anuncios + $3,
             ultimo_anuncio = now(),
             grupos = (SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements(repasse.contatos.grupos || $4::jsonb) x)`,
    [id, c.nome, c.n, JSON.stringify([...c.grupos]), C()])
  }
  if (stats.length) avisar('mapa', {})
}

async function statusContato (id) {
  const { cacheStatus } = est()
  if (!cacheStatus.size || cacheStatus.get('__ts') < Date.now() - 60e3) {
    cacheStatus.clear()
    for (const r of await todos(`SELECT id, status FROM repasse.contatos WHERE conta_id = $1 AND status <> 'normal'`, [C()])) cacheStatus.set(r.id, r.status)
    cacheStatus.set('__ts', Date.now())
  }
  return cacheStatus.get(id) || 'normal'
}
export function limparCacheContatos () { est().cacheStatus.clear() }

export function grupoReconhecido (g) {
  const { minAnuncios, minPercentual } = cfg().reconhecerGrupo
  const pct = g.mensagens ? (100 * g.anuncios / g.mensagens) : 0
  return g.anuncios >= minAnuncios && pct >= minPercentual
}

// ---------------- Recebimento ----------------

// chatJid: grupo ou contato individual. Mensagens de conversas não arquivadas ficam guardadas
// (tabela mensagens) para permitir gerar a fila de um período, ex.: "postagens de hoje".
export async function receberMensagem ({ chatJid, chatNome, tipo = 'grupo', remetente, texto, midia, id, ts, bruto, historico }) {
  const pontos = texto ? parseAnuncio(texto, { temMidia: !!midia }).pontos : 0
  const ehAnuncio = pontos >= cfg().pontuacaoMinima
  if (tipo === 'contato' && !ehAnuncio && !(await grupos()).has(chatJid)) return
  const grupo = await garantirGrupo(chatJid, chatNome, tipo)
  registrarEstatistica(grupo, remetente, ehAnuncio)

  if (!grupo.arquivado && id) {
    await q(`INSERT INTO repasse.mensagens (conta_id, id, chat_jid, ts, remetente_id, remetente_nome, texto, tem_imagem, bruto)
             VALUES ($9,$1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (conta_id, id) DO NOTHING`,
    [id, chatJid, new Date(ts || Date.now()), remetente.id || null, remetente.nome || null, texto || null, !!midia, bruto || null, C()])
  }
  if (historico || !grupo.fonte) return

  const st = remetente.id ? await statusContato(remetente.id) : 'normal'
  if (st === 'bloqueado') return
  if (grupo.somente_confiaveis && st !== 'confiavel') return

  const { buffers } = est()
  const conta = C()
  const chave = `${chatJid}|${remetente.id}`
  const b = buffers.get(chave) || { grupoJid: chatJid, grupoNome: grupo.nome, remetente, textos: [], midias: [], ids: [], timer: null }
  if (texto) b.textos.push(texto)
  if (midia) b.midias.push(midia)
  if (id) b.ids.push(id)
  clearTimeout(b.timer)
  b.timer = setTimeout(() => comConta(conta, () => {
    buffers.delete(chave)
    processarLote(b).catch(e => registrar('erro', 'Falha ao processar anúncio: ' + e.message))
  }), cfg().agruparSegundos * 1000)
  buffers.set(chave, b)
}

async function processarLote (b) {
  const texto = b.textos.join('\n').trim()
  if (texto) {
    const fotos = []
    if (wa()) {
      for (const m of b.midias.slice(0, cfg().edicao.maxFotosBanco)) {
        try { fotos.push(...await wa().baixarFotos(m)) } catch (e) { registrar('erro', 'Não baixou foto/vídeo: ' + e.message) }
      }
    }
    await montarAnuncio({
      texto,
      fotos,
      origem: { grupoJid: b.grupoJid, grupoNome: b.grupoNome, remetenteId: b.remetente.id, remetenteNome: b.remetente.nome }
    })
  }
  if (b.ids.length) await q('UPDATE repasse.mensagens SET processado = true WHERE conta_id = $2 AND id = ANY($1)', [b.ids, C()])
}

// ---------------- Gerar fila de um período (ex.: postagens de hoje) ----------------
export const estadoLote = () => est().lote

// junta mensagens seguidas do mesmo remetente: texto + fotos enviadas em sequência = 1 anúncio
export function montarLotes (rows, janelaMs = 120e3) {
  const lotes = []
  let cur = null
  for (const r of rows) {
    const t = new Date(r.ts).getTime()
    const continua = cur && cur.chat === r.chat_jid && cur.rem === r.remetente_id && t - cur.fim <= janelaMs
    const textoNovoCompleto = r.texto && cur?.texto && parseAnuncio(r.texto).pontos >= 4
    if (!continua || textoNovoCompleto) {
      cur = { chat: r.chat_jid, chatNome: r.chat_nome, rem: r.remetente_id, remNome: r.remetente_nome, texto: '', brutos: [], ids: [], fim: t }
      lotes.push(cur)
    }
    if (r.texto) cur.texto = (cur.texto ? cur.texto + '\n' : '') + r.texto
    if (r.tem_imagem && r.bruto) cur.brutos.push(r.bruto)
    cur.ids.push(r.id)
    cur.fim = t
    if (r.remetente_nome) cur.remNome = r.remetente_nome
  }
  return lotes
}

export async function gerarFilaDoPeriodo ({ jids, desde, buscarHistorico = true, ate = null, automatico = false }) {
  const estadoLote = est().lote
  if (estadoLote.rodando) { if (automatico) return; throw new Error('Já há uma geração de fila em andamento') }
  Object.assign(estadoLote, { rodando: true, etapa: 'Buscando histórico no WhatsApp…', total: 0, feitos: 0, criados: 0, repetidos: 0, filtrados: 0 })
  avisar('lote', estadoLote)
  try {
    if (buscarHistorico && wa()?.buscarHistorico) {
      for (const jid of jids) {
        try { await wa().buscarHistorico(jid, desde) } catch (e) { registrar('aviso', `Histórico de ${jid}: ${e.message}`) }
      }
    }
    estadoLote.etapa = 'Montando anúncios…'
    const rows = await todos(`SELECT m.*, g.nome AS chat_nome FROM repasse.mensagens m JOIN repasse.grupos g ON g.jid = m.chat_jid AND g.conta_id = m.conta_id
      WHERE m.conta_id = $3 AND m.chat_jid = ANY($1) AND m.ts >= $2 AND m.ts <= $4 AND NOT m.processado ORDER BY m.chat_jid, m.remetente_id, m.ts`, [jids, new Date(desde), C(), new Date(ate || Date.now() + 60e3)])
    const lotes = montarLotes(rows)
    estadoLote.total = lotes.length
    avisar('lote', estadoLote)
    const bloqueados = new Set((await todos(`SELECT id FROM repasse.contatos WHERE conta_id = $1 AND status = 'bloqueado'`, [C()])).map(r => r.id))
    for (const l of lotes) {
      try {
        if (l.texto.trim() && !bloqueados.has(l.rem) && parseAnuncio(l.texto, { temMidia: l.brutos.length > 0 }).pontos >= 2) {
          const fotos = []
          for (const b of l.brutos.slice(0, cfg().edicao.maxFotosBanco)) {
            try { fotos.push(...await wa().baixarFotos(b)) } catch {}
          }
          const r = await montarAnuncio({ texto: l.texto, fotos, origem: { grupoJid: l.chat, grupoNome: l.chatNome, remetenteId: l.rem, remetenteNome: l.remNome } })
          if (r.repetidoDe) estadoLote.repetidos++
          else if (r.status === 'filtrado') estadoLote.filtrados++
          else estadoLote.criados++
        }
        await q('UPDATE repasse.mensagens SET processado = true WHERE conta_id = $2 AND id = ANY($1)', [l.ids, C()])
      } catch (e) { registrar('erro', 'Lote: ' + e.message) }
      estadoLote.feitos++
      if (estadoLote.feitos % 5 === 0) avisar('lote', estadoLote)
    }
    await deduplicarFila()
    if (!automatico || estadoLote.criados || estadoLote.repetidos || estadoLote.filtrados) registrar('info', `${automatico ? 'Mensagens atrasadas processadas' : 'Fila do período gerada'}: ${estadoLote.criados} anúncios novos, ${estadoLote.repetidos} repetidos, ${estadoLote.filtrados} filtrados`)
  } finally {
    estadoLote.rodando = false
    estadoLote.etapa = 'Concluído'
    avisar('lote', estadoLote)
    avisar('fila', {})
  }
}

// ---------------- Montagem do anúncio ----------------
const kmK = (km) => km ? Math.round(km / 1000) : ''
function impressoes (d, remetenteId) {
  if (d.modelo && d.anoModelo) {
    return [
      `${remetenteId || ''}|${d.modelo}|${d.anoModelo}|${kmK(d.km)}`.toLowerCase(),
      `${d.modelo}|${d.anoModelo}|${kmK(d.km)}|${d.preco || ''}`.toLowerCase()
    ]
  }
  const h = crypto.createHash('sha1').update(d.textoOriginal.toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex')
  return [h, h]
}

export async function analisar (texto, { foto = null, temFoto = false, usarIA = true } = {}) {
  const c = cfg()
  let dados = parseAnuncio(texto, { temMidia: temFoto || !!foto })
  let erroIA = null
  const valeIA = usarIA && iaDisponivel() && c.ia.modo !== 'desligado' && dados.pontos >= Math.max(2, c.pontuacaoMinima - 4) &&
    (c.ia.modo === 'sempre' || c.ia.reescreverDescricao || anuncioIncerto(dados, c.pontuacaoMinima))
  if (valeIA) {
    try {
      const mini = foto && c.ia.lerPlacaNaFoto ? await miniaturaParaIA(foto) : null
      dados = mesclarComIA(dados, await analisarComIA({ texto, foto: mini, cfgIa: c.ia }))
    } catch (e) { erroIA = e.message; registrar('aviso', 'IA: ' + e.message) }
  }
  Object.assign(dados, categorizar(dados, c.premium))
  try {
    const f = await consultarFipe(dados, c.fipe)
    if (f?.valor) dados.fipeConsulta = f
  } catch (e) { dados.fipeErro = e.message }
  if (erroIA) dados.erroIA = erroIA
  return dados
}

// dadosFixos / precoFixo / naFila: anúncio vindo da Loja GiroAuto (dados já conhecidos, preço de repasse definido
// pela loja, sem o ajuste de preço do Repasse, e sempre para a Fila, mesmo no modo automático)
export async function montarAnuncio ({ texto, fotos = [], origem, forcar = false, dadosFixos = null, precoFixo = null, naFila = false }) {
  const c = cfg()
  fotos = await recortarTodas(fotos, c.edicao.maxFotosBanco) // separa prints e tira barras/hora
  const dados = await analisar(texto, { foto: fotos[0] || null, temFoto: fotos.length > 0 })
  if (dadosFixos) {
    for (const [k, v] of Object.entries(dadosFixos)) if (v !== undefined && v !== null && v !== '') dados[k] = v
    Object.assign(dados, categorizar(dados, c.premium)) // categoria pela marca/modelo corretos
  }
  const motivos = forcar ? [] : avaliarFiltros(dados, c, { temMidia: fotos.length > 0 })
  const [fp1, fp2] = impressoes(dados, origem.remetenteId)

  // Mesmo veículo já na fila/circulação? (repostagem da fonte ou de outro anunciante)
  let substituir = null
  if (!forcar && !motivos.length) {
    const existente = await acharMesmoVeiculo(dados, fp1, fp2)
    if (existente) {
      const naFila = ['pendente', 'aprovado'].includes(existente.status)
      const maisBarato = dados.preco && existente.preco_original && dados.preco < existente.preco_original
      const igualOuMaisBarato = dados.preco && (!existente.preco_original || dados.preco <= existente.preco_original)
      if (naFila && existente.status === 'pendente' && igualOuMaisBarato) {
        substituir = existente // fica a postagem mais recente e de menor valor
      } else {
        await q(`UPDATE repasse.anuncios SET vezes_recebido = vezes_recebido + 1, ultimo_recebido = now(),
                 nota = COALESCE($2, nota) WHERE id = $1 AND conta_id = $3`,
        [existente.id, maisBarato ? `Recebido de novo por ${moeda(dados.preco)} (aqui: ${moeda(existente.preco_original)}) em ${origem.grupoNome || 'outra fonte'}` : null, C()])
        registrar('repetido', `${existente.codigo || ''} ${dados.modelo || ''} recebido de novo${maisBarato ? ' mais barato' : ''}`)
        avisar('fila', {})
        return { repetidoDe: existente.id }
      }
    }
  }

  const aprovado = motivos.length === 0
  const id = crypto.randomUUID()
  // o código (GA-0001…) só nasce na aprovação: segue a sequência dos anúncios aprovados
  const codigo = aprovado && !naFila && c.envio.modo === 'automatico' ? await novoCodigo() : null
  const precoRepasse = precoFixo > 0 ? Math.round(precoFixo) : precoFinal(dados.preco, c.edicao.ajustePreco)
  const texto2 = renderizar(camposDoAnuncio(dados, c, { codigo, precoRepasse }), c.modelo)
  const status = !aprovado ? 'filtrado' : (!naFila && c.envio.modo === 'automatico' ? 'aprovado' : 'pendente')

  await q(`INSERT INTO repasse.anuncios (id, codigo, status, grupo_jid, grupo_nome, remetente_id, remetente_nome,
      marca, modelo, categoria, ano_modelo, km, preco_original, preco_repasse, fipe, dados, texto, motivos, fp1, fp2,
      repetir, repetir_horas, reducao_ativa, reducao_passo, reducao_piso, conta_id, numero_fila)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18::jsonb,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
  [id, codigo, status, origem.grupoJid || null, origem.grupoNome || null, origem.remetenteId || null, origem.remetenteNome || null,
    dados.marca, dados.modelo, dados.categoria, dados.anoModelo, dados.km, dados.preco, precoRepasse,
    dados.fipe || dados.fipeConsulta?.valor || null, JSON.stringify(dados), texto2, JSON.stringify(motivos), fp1, fp2,
    c.repeticao.padraoAtivo, c.repeticao.intervaloHoras,
    c.reducaoPreco.padraoAtivo, c.reducaoPreco.passo, pisoPadrao(dados.preco, precoRepasse, c.reducaoPreco), C(), await proximo(C(), 'seq_fila')])

  if (aprovado && fotos.length) {
    try { await salvarFotos(id, fotos) } catch (e) { registrar('erro', 'Fotos: ' + e.message) }
    agendarCapas()
  }
  if (substituir) {
    await q(`UPDATE repasse.anuncios SET status = 'descartado', encerrado_em = now(), nota = $2 WHERE id = $1 AND conta_id = $3`,
      [substituir.id, `Substituído por postagem mais recente do mesmo veículo por ${moeda(dados.preco)} (${origem.grupoNome || 'outra fonte'})`, C()])
    await q('UPDATE repasse.anuncios SET vezes_recebido = vezes_recebido + $2 WHERE id = $1', [id, substituir.vezes_recebido || 1])
  }
  avisar('fila', { id })
  registrar(aprovado ? 'anuncio' : 'filtrado', `${codigo || ''} ${dados.marca || ''} ${dados.modelo || ''} ${dados.ano || ''} — ${aprovado ? status : motivos.join('; ')}`.replace(/\s+/g, ' ').trim())
  return { id, codigo, status, motivos }
}

export function pisoPadrao (precoPedido, precoRepasse, r) {
  if (r.piso === 'nenhum' || !precoPedido) return null
  return Math.min(precoRepasse || Infinity, precoPedido + (Number(r.pisoMargem) || 0))
}

// Antes de cada reenvio: baixa o valor pelo passo, respeitando o piso. Retorna o novo valor (ou null)
export async function aplicarReducao (a) {
  if (!a.reducao_ativa || !a.preco_repasse || !(a.reducao_passo > 0)) return null
  const piso = a.reducao_piso || 0
  const novo = Math.max(piso, a.preco_repasse - a.reducao_passo)
  if (novo >= a.preco_repasse) return null
  await definirPrecoRepasse(a.id, novo)
  return novo
}

// Depois de mudar o modelo (ou dados do negócio), atualiza o texto dos anúncios ainda ativos.
// Textos editados à mão são preservados (use "Refazer texto" no card para aplicar o modelo neles).
const norm = (s) => (s || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

// Mesmo veículo: mesma marca/modelo/ano e km parecida (±3%, mín. 2 mil); sem km, preço a até 1% e mesma cor/versão
export function mesmoVeiculo (a, b) {
  if (!a.modelo || !b.modelo || norm(a.modelo) !== norm(b.modelo)) return false
  if (a.marca && b.marca && norm(a.marca) !== norm(b.marca)) return false
  if (!a.anoModelo || a.anoModelo !== b.anoModelo) return false
  if (a.km && b.km) return Math.abs(a.km - b.km) <= Math.max(2000, 0.03 * Math.max(a.km, b.km))
  if (a.cor && b.cor && norm(a.cor) !== norm(b.cor)) return false
  return !!(a.preco && b.preco && Math.abs(a.preco - b.preco) <= 0.01 * Math.max(a.preco, b.preco))
}

async function acharMesmoVeiculo (dados, fp1, fp2) {
  const c = cfg()
  const cand = await todos(`SELECT id, codigo, status, preco_original, vezes_recebido, dados, fp1, fp2 FROM repasse.anuncios
    WHERE conta_id = $6 AND status IN ('pendente','aprovado','circulando','enviado')
      AND (fp1 = $1 OR fp2 = $2 OR (lower(modelo) = lower($3) AND ano_modelo = $4))
      AND (status IN ('pendente','aprovado','circulando') OR criado_em > now() - ($5 || ' hours')::interval)
    ORDER BY criado_em DESC LIMIT 30`, [fp1, fp2, dados.modelo || '', dados.anoModelo || 0, String(c.envio.dedupHoras), C()])
  return cand.find(x => x.fp1 === fp1 || x.fp2 === fp2 || mesmoVeiculo(dados, x.dados)) || null
}

// Limpa repetidos que já estão na fila: por veículo, fica o de menor valor (empate: o mais recente)
export async function deduplicarFila () {
  const rows = await todos(`SELECT id, codigo, dados, preco_original, criado_em, vezes_recebido FROM repasse.anuncios
    WHERE conta_id = $1 AND status = 'pendente' ORDER BY preco_original NULLS LAST, criado_em DESC`, [C()])
  const ficam = []
  let removidos = 0
  for (const r of rows) {
    const igual = ficam.find(f => mesmoVeiculo(r.dados, f.dados))
    if (!igual) { ficam.push(r); continue }
    await q(`UPDATE repasse.anuncios SET status = 'descartado', encerrado_em = now(), nota = $2 WHERE id = $1`, [r.id, `Repetido (mesmo veículo; ficou o de menor valor: ${moeda(igual.preco_original)})`])
    await q('UPDATE repasse.anuncios SET vezes_recebido = vezes_recebido + $2 WHERE id = $1', [igual.id, r.vezes_recebido || 1])
    removidos++
  }
  if (removidos) { registrar('info', `${removidos} anúncio(s) repetido(s) removidos da fila`); avisar('fila', {}) }
  return removidos
}

export async function novoCodigo () {
  const n = await proximo(C(), 'seq_codigo')
  return `${cfg().negocio.prefixoCodigo}-${String(n).padStart(4, '0')}`
}

// Aprova um anúncio: dá o próximo código da sequência e refaz o texto com ele
export async function aprovarAnuncio (id) {
  const a = await um('SELECT codigo, status FROM repasse.anuncios WHERE id = $1 AND conta_id = $2', [id, C()])
  if (!a) return null
  if (!a.codigo) await q('UPDATE repasse.anuncios SET codigo = $2 WHERE id = $1', [id, await novoCodigo()])
  await q(`UPDATE repasse.anuncios SET status = 'aprovado', motivos = '[]'::jsonb WHERE id = $1`, [id])
  const r = await um('SELECT texto_editado, texto, codigo FROM repasse.anuncios WHERE id = $1', [id])
  if (!r.texto_editado) await regerarTexto(id)
  else if (!r.texto.includes(r.codigo)) await q('UPDATE repasse.anuncios SET texto = $2 WHERE id = $1', [id, `${r.texto}\n🔖 Cód.: ${r.codigo}`])
  prepararFotosPublicas(id).catch(e => registrar('aviso', 'Placa: ' + e.message)) // borra a placa já na aprovação
  return id
}

export async function regerarTodos () {
  const rows = await todos(`SELECT id FROM repasse.anuncios WHERE conta_id = $1 AND status IN ('pendente','aprovado','circulando','enviado','erro','filtrado') AND NOT texto_editado`, [C()])
  for (const r of rows) await regerarTexto(r.id)
  return rows.length
}

export async function regerarTexto (id) {
  const a = await um('SELECT * FROM repasse.anuncios WHERE id = $1 AND conta_id = $2', [id, C()])
  const t = renderizar(camposDoAnuncio(a.dados, cfg(), { codigo: a.codigo, precoRepasse: a.preco_repasse }), cfg().modelo)
  await q('UPDATE repasse.anuncios SET texto = $2, texto_editado = false WHERE id = $1', [id, t])
  return t
}

// Novo valor de repasse: troca o preço no texto (mantém suas edições) ou regera
export async function definirPrecoRepasse (id, novo) {
  const a = await um('SELECT preco_repasse, texto FROM repasse.anuncios WHERE id = $1 AND conta_id = $2', [id, C()])
  let texto = a.texto
  const antigo = moeda(a.preco_repasse)
  await q('UPDATE repasse.anuncios SET preco_repasse = $2 WHERE id = $1', [id, novo])
  if (antigo && texto.includes(antigo)) {
    texto = texto.split(antigo).join(moeda(novo))
    await q('UPDATE repasse.anuncios SET texto = $2 WHERE id = $1', [id, texto])
    return texto
  }
  return regerarTexto(id)
}

// ---------------- Envio ----------------
export const estadoEnvio = () => est().envio

function dentroDoHorario (e) {
  const agora = new Date(new Date().toLocaleString('en-US', { timeZone: process.env.TZ_LOCAL || 'America/Sao_Paulo' }))
  const hm = agora.getHours() * 60 + agora.getMinutes()
  const [hi, mi] = e.horarioInicio.split(':').map(Number)
  const [hf, mf] = e.horarioFim.split(':').map(Number)
  const ini = hi * 60 + mi; const fim = hf * 60 + mf
  return ini <= fim ? (hm >= ini && hm < fim) : (hm >= ini || hm < fim)
}

export async function destinosPara (a, grupos = null) {
  grupos ||= await todos('SELECT jid, nome, regras FROM repasse.grupos WHERE conta_id = $1 AND destino', [C()])
  return grupos.map(g => ({ jid: g.jid, nome: g.nome, regras: g.regras || {}, recusa: destinoAceita(a.dados, a.preco_repasse, g.regras) }))
}

async function proximoParaEnviar () {
  return (await um(`SELECT * FROM repasse.anuncios WHERE conta_id = $1 AND status = 'aprovado' ORDER BY criado_em LIMIT 1`, [C()])) ||
         (await um(`SELECT * FROM repasse.anuncios WHERE conta_id = $1 AND status = 'circulando' AND proximo_envio <= now() ORDER BY proximo_envio LIMIT 1`, [C()]))
}

async function enviarAnuncio (a) {
  const c = cfg()
  if (a.vezes_enviado > 0) {
    const novo = await aplicarReducao(a)
    if (novo) {
      registrar('info', `${a.codigo}: valor reduzido para ${moeda(novo)}${novo === a.reducao_piso ? ' (piso)' : ''}`)
      a = await um('SELECT * FROM repasse.anuncios WHERE id = $1 AND conta_id = $2', [a.id, C()])
    }
  }
  const destinos = (await destinosPara(a)).filter(d => !d.recusa)
  const rodada = a.vezes_enviado + 1
  let ok = 0
  if (!destinos.length) {
    await q(`UPDATE repasse.anuncios SET status = 'erro', nota = 'Nenhum grupo destino aceita este anúncio pelas regras' WHERE id = $1`, [a.id])
    registrar('aviso', `${a.codigo}: nenhum destino aceita pelas regras`)
    return
  }
  if (c.edicao.enviarFoto) await prepararFotosPublicas(a.id).catch(e => registrar('aviso', 'Placa: ' + e.message))
  const capa = c.edicao.enviarFoto ? await fotoCapa(a.id) : null
  for (const d of destinos) {
    // carro da própria Loja GiroAuto: o preço de repasse já é o final definido lá; o acréscimo do grupo é só para terceiros
    const extra = a.dados?.origemLoja ? 0 : (Number(d.regras.acrescimo) || 0)
    const preco = (a.preco_repasse || 0) + extra
    const texto = extra && a.preco_repasse ? a.texto.split(moeda(a.preco_repasse)).join(moeda(preco)) : a.texto
    try {
      await wa().enviar(d.jid, texto, capa)
      ok++
      await q('INSERT INTO repasse.envios (conta_id, anuncio_id, grupo_jid, grupo_nome, ok, preco, rodada) VALUES ($6,$1,$2,$3,true,$4,$5)', [a.id, d.jid, d.nome, preco || null, rodada, C()])
    } catch (e) {
      await q('INSERT INTO repasse.envios (conta_id, anuncio_id, grupo_jid, grupo_nome, ok, erro, preco, rodada) VALUES ($7,$1,$2,$3,false,$4,$5,$6)', [a.id, d.jid, d.nome, e.message, preco || null, rodada, C()])
      registrar('erro', `Falha ao enviar ${a.codigo} para ${d.nome}: ${e.message}`)
    }
    await new Promise(r => setTimeout(r, 3000 + Math.random() * 4000))
  }
  const r = c.repeticao
  const continua = ok > 0 && a.repetir && (!r.maxVezes || rodada < r.maxVezes)
  await q(`UPDATE repasse.anuncios SET vezes_enviado = $2, ultimo_envio = now(),
           status = $3, proximo_envio = CASE WHEN $4::boolean THEN now() + ($5::numeric * interval '1 hour') ELSE NULL END
           WHERE id = $1`,
  [a.id, rodada, ok === 0 ? 'erro' : (continua ? 'circulando' : 'enviado'), continua, String(a.repetir_horas || r.intervaloHoras)])
  registrar('envio', `${a.codigo} ${rodada > 1 ? `(${rodada}ª vez) ` : ''}enviado para ${ok} grupo(s)`)
}

async function cicloEnvio () {
  const e = cfg().envio
  const estadoEnvio = est().envio
  if (estadoEnvio.pausado || estadoEnvio.enviando || !wa()?.conectado()) return
  if (Date.now() < estadoEnvio.proximoEm || !dentroDoHorario(e)) return
  const n = await um(`SELECT count(DISTINCT (anuncio_id, rodada))::int AS n FROM repasse.envios WHERE conta_id = $1 AND ok AND ts > now() - interval '1 hour'`, [C()])
  if (n.n >= e.limitePorHora) return
  const a = await proximoParaEnviar()
  if (!a) return
  estadoEnvio.enviando = true
  try { await enviarAnuncio(a) } finally {
    estadoEnvio.enviando = false
    const s = e.intervaloMinSeg + Math.random() * Math.max(0, e.intervaloMaxSeg - e.intervaloMinSeg)
    estadoEnvio.proximoEm = Date.now() + s * 1000
    avisar('fila', {})
  }
}

// ---------------- Manutenção diária ----------------
async function expirarPendentes () {
  const h = cfg().fila?.expirarPendentesHoras
  if (!h) return
  const r = await q(`UPDATE repasse.anuncios SET status = 'descartado', encerrado_em = now(), nota = COALESCE(nota || ' · ', '') || 'Saiu da fila: ' || $1 || ' h sem aprovação'
    WHERE conta_id = $2 AND status = 'pendente' AND criado_em < now() - ($1 || ' hours')::interval`, [String(h), C()])
  const n = r.rowCount ?? r.affectedRows ?? 0
  if (n) { registrar('info', `${n} anúncio(s) saíram da fila por passar de ${h} h sem aprovação`); avisar('fila', {}) }
}

async function manutencao () {
  const c = cfg()
  if (c.repeticao.encerrarAposDias) {
    await q(`UPDATE repasse.anuncios SET status = 'encerrado', encerrado_em = now(), nota = COALESCE(nota, 'Encerrado automaticamente pelo prazo')
             WHERE conta_id = $2 AND status = 'circulando' AND criado_em < now() - ($1 || ' days')::interval`, [String(c.repeticao.encerrarAposDias), C()])
  }
  await q(`DELETE FROM repasse.mensagens WHERE conta_id = $1 AND ts < now() - interval '4 days'`, [C()])
}

// Arquivados (descartados, encerrados, barrados pelos filtros) ficam só por um prazo (padrão 48 h);
// depois o anúncio é excluído com fotos e histórico de envios. Vendidos nunca entram aqui.
export const ARQUIVADOS = `('descartado','encerrado','filtrado')`
export async function excluirArquivados () {
  const h = Number(cfg().limpeza?.excluirArquivadosHoras)
  if (!h) return 0
  const r = await q(`DELETE FROM repasse.anuncios WHERE conta_id = $2 AND status IN ${ARQUIVADOS}
    AND COALESCE(encerrado_em, criado_em) < now() - ($1 || ' hours')::interval`, [String(h), C()])
  const n = r.rowCount ?? r.affectedRows ?? 0
  if (n) { registrar('info', `${n} anúncio(s) arquivado(s) há mais de ${h} h foram excluídos com suas fotos`); avisar('fila', {}) }
  return n
}

// Roda uma tarefa para cada conta ativa (cada uma no seu contexto)
let contasAtivas = async () => [1]
export function definirContasAtivas (fn) { contasAtivas = fn }
async function paraCada (nome, fn) {
  for (const id of await contasAtivas()) {
    await comConta(id, () => fn().catch(e => registrar('erro', `${nome}: ${e.message}`)))
  }
}

// Mensagens das fontes que chegaram atrasadas (servidor fora do ar, celular sem internet, reconexão):
// o WhatsApp as entrega como histórico, sem passar pelo recebimento ao vivo. A cada 10 min, processa as
// das últimas 24 h que ainda não viraram anúncio (as de 3 min para cá ficam para o recebimento ao vivo).
// Correção única (v0.7.1): anúncios que foram para Filtrados só porque o "KM máx." ficou negativo (-21).
// Como filtrados não guardam fotos, reprocessa as mensagens originais (traz fotos, IA e placa borrada).
export async function recuperarFiltradosPorKm () {
  const chave = `v071-km:${C()}`
  if (await kvGet(chave)) return
  if (!wa()?.conectado?.() || est().lote.rodando) return // tenta no próximo ciclo
  const ads = await todos(`SELECT id, grupo_jid, remetente_id, dados->>'textoOriginal' AS txt FROM repasse.anuncios
    WHERE conta_id = $1 AND status = 'filtrado' AND motivos::text LIKE '%km > -%'
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(motivos) m WHERE m NOT LIKE 'km > -%')`, [C()])
  let desde = Date.now(); let reprocessar = 0; let semMensagem = 0
  for (const a of ads) {
    const ms = a.grupo_jid ? await todos(`SELECT ts FROM repasse.mensagens WHERE conta_id = $1 AND chat_jid = $2 AND remetente_id IS NOT DISTINCT FROM $3
      AND texto IS NOT NULL AND length(texto) > 10 AND position(texto in $4) > 0`, [C(), a.grupo_jid, a.remetente_id, a.txt || '']) : []
    if (ms.length) {
      const t = ms.map(m => new Date(m.ts).getTime())
      const ini = Math.min(...t) - 150e3; const fim = Math.max(...t) + 150e3
      await q(`UPDATE repasse.mensagens SET processado = false WHERE conta_id = $1 AND chat_jid = $2 AND remetente_id IS NOT DISTINCT FROM $3 AND ts BETWEEN $4 AND $5`,
        [C(), a.grupo_jid, a.remetente_id, new Date(ini), new Date(fim)])
      await q('DELETE FROM repasse.anuncios WHERE id = $1', [a.id])
      desde = Math.min(desde, ini); reprocessar++
    } else {
      // mensagem original já não existe: volta para a fila sem fotos
      await q(`UPDATE repasse.anuncios SET status = 'pendente', motivos = '[]'::jsonb, criado_em = now(), encerrado_em = NULL WHERE id = $1`, [a.id])
      semMensagem++
    }
  }
  if (reprocessar) {
    const jids = (await todos('SELECT jid FROM repasse.grupos WHERE conta_id = $1 AND fonte AND NOT arquivado', [C()])).map(r => r.jid)
    await gerarFilaDoPeriodo({ jids, desde, buscarHistorico: false })
  }
  await kvSet(chave, { reprocessados: reprocessar, semMensagem, em: new Date().toISOString() })
  if (ads.length) { registrar('info', `Correção do KM máx.: ${reprocessar} anúncio(s) reprocessados com fotos, ${semMensagem} voltaram para a fila`); avisar('fila', {}) }
}

export async function processarAtrasadas () {
  if (!wa()?.conectado?.()) return
  await recuperarFiltradosPorKm().catch(e => registrar('erro', 'Correção do KM: ' + e.message))
  const jids = (await todos('SELECT jid FROM repasse.grupos WHERE conta_id = $1 AND fonte AND NOT arquivado', [C()])).map(r => r.jid)
  if (!jids.length) return
  const pend = await um(`SELECT count(*)::int n FROM repasse.mensagens WHERE conta_id = $1 AND chat_jid = ANY($2) AND NOT processado
    AND ts > now() - interval '24 hours' AND ts < now() - interval '3 minutes'`, [C(), jids])
  if (!pend?.n) return
  await gerarFilaDoPeriodo({ jids, desde: Date.now() - 24 * 3600e3, ate: Date.now() - 3 * 60e3, buscarHistorico: false, automatico: true })
}

// junta os anúncios que chegam em sequência e borra as capas em lote (4 fotos por chamada à IA)
function agendarCapas () {
  const e = est(); const conta = C()
  clearTimeout(e.tCapas)
  e.tCapas = setTimeout(() => comConta(conta, () => prepararCapasDaFila().catch(err => registrar('aviso', 'Placa: ' + err.message))), 30e3)
}

export function iniciarAgendador () {
  setInterval(() => paraCada('Atrasadas', processarAtrasadas), 10 * 60e3)
  setInterval(() => paraCada('Placas', prepararPendentes), 5 * 60e3)
  setInterval(() => paraCada('Placas da fila', prepararCapasDaFila), 3 * 60e3)
  // envio: cada conta tem seu próprio ritmo; roda em paralelo entre contas
  setInterval(async () => { for (const id of await contasAtivas()) comConta(id, () => cicloEnvio().catch(e => registrar('erro', 'Envio: ' + e.message))) }, 5000)
  setInterval(() => paraCada('Estatísticas', gravarEstatisticas), 20000)
  setInterval(() => paraCada('Manutenção', manutencao), 6 * 3600e3)
  setTimeout(() => paraCada('Manutenção', manutencao), 60e3)
  setInterval(() => paraCada('Expirar', expirarPendentes), 15 * 60e3)
  setInterval(() => paraCada('Excluir arquivados', excluirArquivados), 3600e3)
  setTimeout(() => paraCada('Excluir arquivados', excluirArquivados), 90e3)
  setTimeout(() => paraCada('Expirar', expirarPendentes), 30e3)
}
