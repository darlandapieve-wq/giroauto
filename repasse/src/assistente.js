// Assistente de atendimento do repasse (vitrine e WhatsApp), adaptada da assistente do GiroAuto da loja.
// Diferenças: não agenda visita; é objetiva para fechar a venda; manda mais fotos e informações quando pedem;
// passa para você quando o cliente quer fechar, fazer proposta ou falar com uma pessoa.
// Você alimenta cada veículo mandando para o WhatsApp conectado uma mensagem com o código (ex.: GA-0003)
// seguida de fotos e/ou informações: tudo vai para o banco do anúncio e a assistente passa a usar.
import crypto from 'node:crypto'
import { q, um, todos } from './db.js'
import { cfg } from './config.js'
import { contaId } from './contexto.js'
import { registrar, avisar } from './eventos.js'
import { iaDisponivel } from './ia.js'
import { normTel } from './vendas.js'
import { prepararFoto, recortarTodas } from './fotos.js'
import { CATEGORIAS } from './categorias.js'
import { faixaKm } from './formatter.js'

const C = () => contaId()
const str = (x, max = 500) => String(x ?? '').trim().slice(0, max)
const brl = (n) => n == null ? '' : 'R$ ' + Math.round(n).toLocaleString('pt-BR')
const ATIVOS = `('circulando','enviado')`
const PAGAMENTOS = ['avista', 'financiado', 'troca', 'indefinido']
export const RE_TEL = /(?:\+?55\s?)?\(?\b([1-9]{2})\)?[\s.-]?(9?)[\s.-]?(\d{4})[-.\s]?(\d{4})\b/
const httpErro = (status, message) => Object.assign(new Error(message), { status })

export const configAssistente = () => cfg().assistente || {}

// ---------------- Veículos ----------------
async function veiculosAtivos () {
  return todos(`SELECT a.id, a.codigo, a.dados, a.preco_repasse, a.fipe, a.ano_modelo, a.info_extra,
      (SELECT count(*)::int FROM repasse.fotos f WHERE f.anuncio_id = a.id) AS n_fotos
    FROM repasse.anuncios a WHERE a.conta_id = $1 AND a.status IN ${ATIVOS} AND a.codigo IS NOT NULL
    ORDER BY COALESCE(a.ultimo_envio, a.criado_em) DESC LIMIT 120`, [C()])
}
export async function anuncioPorCodigo (codigo, soAtivos = false) {
  const cod = normCodigo(codigo)
  if (!cod) return null
  return um(`SELECT * FROM repasse.anuncios WHERE conta_id = $1 AND upper(codigo) = $2 ${soAtivos ? `AND status IN ${ATIVOS}` : ''}`, [C(), cod])
}
// "ga 3", "GA-0003", "ga0003" -> "GA-0003" (prefixo da conta)
export function normCodigo (t) {
  const m = String(t || '').toUpperCase().match(/\b([A-Z]{1,4})\s?-?\s?(\d{1,5})\b/)
  if (!m) return null
  return `${m[1]}-${m[2].padStart(4, '0')}`
}
export function codigosNoTexto (t) {
  const pref = (cfg().negocio?.prefixoCodigo || 'GA').toUpperCase()
  const re = new RegExp(`\\b${pref}\\s?-?\\s?(\\d{1,5})\\b`, 'gi')
  return [...String(t || '').matchAll(re)].map(m => `${pref}-${m[1].padStart(4, '0')}`)
}
const tituloDe = (d = {}) => [d.marca, d.modelo, d.versao].filter(Boolean).join(' ')

function linhaVeiculo (a, mostrarFipe) {
  const d = a.dados || {}
  const fipe = a.fipe || d.fipeConsulta?.valor
  const partes = [
    a.codigo, tituloDe(d), d.ano, faixaKm(d.km), brl(a.preco_repasse),
    mostrarFipe && fipe ? `FIPE ${brl(fipe)}` : '', d.cambio, d.combustivel, d.cor, d.cidade ? `em ${d.cidade}` : '',
    CATEGORIAS[d.categoria] || '', `${a.n_fotos} foto(s)`,
    d.opcionais?.length ? `opcionais: ${d.opcionais.join(', ')}` : '',
    d.situacao?.length ? `situação: ${d.situacao.join(', ')}` : '',
    d.alertas?.length ? `atenção: ${d.alertas.join(', ')}` : '',
    d.descricaoIA ? `descrição: ${str(d.descricaoIA.replace(/\s+/g, ' '), 260)}` : '',
    a.info_extra ? `INFORMAÇÕES DO RESPONSÁVEL: ${str(a.info_extra.replace(/\s+/g, ' '), 700)}` : ''
  ]
  return partes.filter(Boolean).join(' | ')
}

async function fotosDe (anuncioId, n) {
  return todos('SELECT id FROM repasse.fotos WHERE anuncio_id = $1 ORDER BY capa DESC, ordem LIMIT $2', [anuncioId, n])
}
async function cartao (codigo, todas, base) {
  const a = await anuncioPorCodigo(codigo, true)
  if (!a) return null
  const d = a.dados || {}
  const fs = await fotosDe(a.id, todas ? Math.max(3, configAssistente().fotosPorPedido || 6) : 3)
  return { codigo: a.codigo, titulo: tituloDe(d), ano: d.ano || '', km: faixaKm(d.km), preco: a.preco_repasse, fotos: fs.map(f => `${base}/foto/${f.id}`), url: `${base}/${encodeURIComponent(a.codigo)}` }
}

function agoraSP () {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date())
}

// ---------------- Prompt ----------------
function montarPrompt (bot, sess, vAtual, vs, canal) {
  const n = cfg().negocio || {}
  const d = sess.dados || {}
  const wa = canal === 'whatsapp'
  return `Você é ${bot.nome || 'Assistente'}, assistente de vendas de ${n.nome || 'um repasse de veículos'}, conversando com um interessado ${wa ? 'pelo WhatsApp' : 'pelo chat da vitrine de repasse'}.

É REPASSE: veículos usados vendidos abaixo da FIPE, no estado em que se encontram, normalmente para lojistas, revendedores e quem quer pagar menos. Os compradores são objetivos e decidem rápido.

OBJETIVO: levar à VENDA de forma objetiva. Responda a dúvida, dê os dados do veículo, mande mais fotos e informações quando pedirem e conduza ao fechamento. Quando o cliente quiser fechar, reservar, fazer proposta/contraproposta, negociar valor, ou pedir uma pessoa, marque "chamar_humano": true e diga que o responsável vai falar com ele ${wa ? 'aqui mesmo' : 'pelo WhatsApp'} em instantes. NÃO agende visitas nem test-drive.

COMO RESPONDER:
- Português do Brasil, direto e cordial, sem enrolação. Mensagens CURTAS (até 3 frases), uma pergunta por vez. Sem emojis em excesso.
- Para informar um veículo, cite o código (ex.: ${vs[0]?.codigo || 'GA-0001'}), o carro, ano, a faixa de km e o valor de repasse. Informe o km SEMPRE como faixa (ex.: "faixa de 45 mil km"), nunca o número exato.
- Quando pedirem fotos (ou "mais fotos"), preencha "fotos_de" com o código: as fotos vão logo depois da sua mensagem. Para sugerir veículos, use "mostrar_codigos" (no máximo 3).
- PAGAMENTO: ${bot.pagamento || 'somente à vista, via PIX'}. Não ofereça nem sugira financiamento, parcelamento, troca, cartão ou consórcio. Se o cliente perguntar por outra forma, diga com cordialidade que o repasse é ${bot.pagamento || 'só à vista no PIX'} (a não ser que as regras do responsável abaixo digam algo diferente).
- Perguntas úteis para fechar: se é lojista e de que cidade é.
- Valor: o preço informado é o valor de repasse${bot.mostrarFipe ? ' (pode comparar com a FIPE)' : ''}. Você NÃO dá desconto nem aceita proposta: passe para o responsável.
- Use SÓ os dados abaixo. Não invente opcionais, estado, documentação, laudo, histórico ou condições. Se não souber, diga que confirma com o responsável e marque "chamar_humano" se o cliente precisar da resposta para decidir.
- Nunca informe de quem é o veículo, grupo de origem, telefone de terceiros ou placa.
- Se o veículo procurado não estiver na lista, diga que não está disponível no momento e ofereça os mais parecidos.
- Assuntos fora de veículos e da compra: volte educadamente ao atendimento.
${wa ? '' : '- Peça o NOME no início e o WHATSAPP quando o cliente demonstrar interesse (para o responsável continuar). Se ele informar telefone, preencha "lead.telefone" (DDD + número).\n'}
DADOS DO NEGÓCIO: ${n.nome || ''}${n.contato ? ` · contato ${n.contato}` : ''}. Agora: ${agoraSP()}.
${bot.instrucoes ? `\nREGRAS E INFORMAÇÕES DO RESPONSÁVEL (siga):\n${bot.instrucoes}\n` : ''}
VEÍCULOS DISPONÍVEIS (código | carro | ano | km | valor de repasse | ...):
${vs.map(a => linhaVeiculo(a, bot.mostrarFipe)).join('\n') || '(nenhum veículo disponível no momento)'}
${vAtual ? `\nO cliente está vendo o veículo ${vAtual.codigo} (${tituloDe(vAtual.dados)}).` : ''}
${wa ? `\nCANAL WhatsApp: você já tem o número do cliente; não peça WhatsApp.${d.nome_perfil ? ` O nome do perfil é "${d.nome}".` : ''}` : ''}
O QUE JÁ SABEMOS DO CLIENTE: ${JSON.stringify({ nome: d.nome || null, whatsapp: d.telefone || null, cidade: d.cidade || null, pagamento: d.pagamento || null, lojista: d.lojista ?? null, interesse: d.interesse || null })}

Responda SEMPRE usando a ferramenta "responder".`
}

const FERRAMENTA = {
  name: 'responder',
  description: 'Envia a resposta ao cliente e registra o que se sabe dele.',
  input_schema: {
    type: 'object',
    properties: {
      resposta: { type: 'string', description: 'texto para o cliente' },
      mostrar_codigos: { type: 'array', items: { type: 'string' }, description: 'códigos dos veículos a mostrar (até 3)' },
      fotos_de: { type: ['string', 'null'], description: 'código do veículo cujas fotos o cliente pediu' },
      lead: {
        type: 'object',
        properties: {
          nome: { type: 'string' }, telefone: { type: 'string' }, cidade: { type: 'string' },
          pagamento: { type: 'string', enum: [...PAGAMENTOS, ''] }, lojista: { type: ['boolean', 'null'] },
          interesse: { type: 'string', description: 'resumo curto do que procura' }
        }
      },
      temperatura: { type: 'string', enum: ['quente', 'morno', 'frio'] },
      chamar_humano: { type: 'boolean' },
      motivo_humano: { type: 'string', description: 'por que precisa do responsável (fechar, proposta, dúvida…)' }
    },
    required: ['resposta', 'chamar_humano']
  }
}

async function chamarClaude (sistema, historico) {
  const msgs = []
  for (const m of historico) {
    const role = m.papel === 'user' ? 'user' : 'assistant'
    if (!msgs.length && role === 'assistant') msgs.push({ role: 'user', content: '(o cliente abriu a conversa)' })
    const ult = msgs.at(-1)
    if (ult && ult.role === role) ult.content += '\n' + m.texto
    else msgs.push({ role, content: m.texto || '' })
  }
  if (msgs.at(-1)?.role !== 'user') msgs.push({ role: 'user', content: '(continue)' })
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: cfg().ia?.modelo || 'claude-haiku-5-5', max_tokens: 800, system: sistema,
      tools: [FERRAMENTA], tool_choice: { type: 'tool', name: 'responder' }, messages: msgs
    }),
    signal: AbortSignal.timeout(30000)
  })
  if (!r.ok) throw new Error(`IA respondeu ${r.status}: ${(await r.text()).slice(0, 160)}`)
  const j = await r.json()
  const uso = j.content?.find(c => c.type === 'tool_use')
  if (!uso?.input?.resposta) throw new Error('IA sem resposta')
  return uso.input
}

// ---------------- Roteiro sem IA (ou se a IA falhar) ----------------
function roteiro (sess, texto, vAtual, historico, canal) {
  const d = sess.dados || {}
  const out = { resposta: '', mostrar_codigos: [], fotos_de: null, lead: {}, temperatura: 'morno', chamar_humano: false }
  const m = String(texto).match(RE_TEL)
  if (m) out.lead.telefone = m[1] + m[2] + m[3] + m[4]
  const cods = codigosNoTexto(texto)
  const alvo = cods[0] || vAtual?.codigo
  if (/foto|imagem|v[ií]deo|mais info|detalhe/i.test(texto) && alvo) out.fotos_de = alvo
  const ultimoBot = [...historico].reverse().find(x => x.papel === 'bot')?.texto || ''
  if (!d.nome && /seu nome/i.test(ultimoBot) && !m) {
    const n = String(texto).replace(/^(meu nome é|me chamo|sou o|sou a|sou)\s+/i, '').replace(/[^\p{L}\s'-]/gu, '').trim().split(/\s+/).slice(0, 3).join(' ')
    if (n.length >= 2 && n.length <= 40) out.lead.nome = n.replace(/\b\p{L}/gu, c => c.toUpperCase())
  }
  const nome = d.nome || out.lead.nome
  const tel = d.telefone || out.lead.telefone
  if (/fech|reserv|propost|desconto|menor valor|pessoa|atendente|respons|negoci/i.test(texto)) out.chamar_humano = true
  const pagamento = (configAssistente().pagamento || 'somente à vista, via PIX')
  if (/financ|parcel|troca|cart[aã]o|cons[oó]rcio|entrada|forma de pagamento|como (é|e) o pagamento|aceita/i.test(texto) && !out.chamar_humano) {
    out.resposta = `O pagamento do repasse é ${pagamento}.` + (canal !== 'whatsapp' && !nome ? ' Qual é o seu nome?' : canal !== 'whatsapp' && !tel ? ' Me passa seu WhatsApp com DDD que o responsável te chama?' : ' Quer fechar?')
    return out
  }
  if (out.fotos_de) out.resposta = `Segue as fotos do ${out.fotos_de}.` + (canal !== 'whatsapp' && !nome ? ' Qual é o seu nome?' : canal !== 'whatsapp' && !tel ? ' Me passa seu WhatsApp com DDD que o responsável te chama?' : '')
  else if (out.chamar_humano) out.resposta = 'Certo! Vou chamar o responsável para falar com você' + (canal === 'whatsapp' ? ' aqui mesmo.' : tel ? ' pelo WhatsApp.' : '. Me passa seu WhatsApp com DDD?')
  else if (canal !== 'whatsapp' && !nome) out.resposta = `Olá! ${vAtual ? `O ${vAtual.codigo} está disponível. ` : ''}Qual é o seu nome?`
  else if (canal !== 'whatsapp' && !tel) out.resposta = `Prazer, ${nome.split(' ')[0]}! Me passa seu WhatsApp com DDD que o responsável te chama com fotos e condições.`
  else { out.resposta = 'Anotado! O responsável vai te chamar em instantes para fechar os detalhes.'; out.chamar_humano = true; out.temperatura = 'quente' }
  if (vAtual && historico.filter(x => x.papel === 'user').length === 1 && !out.fotos_de) out.mostrar_codigos = [vAtual.codigo]
  return out
}

// ---------------- Conversas ----------------
async function sessao ({ sid, canal = 'site', contato = '', ip = '', anuncioId = null }) {
  let s = null
  if (sid && /^[a-f0-9]{24}$/.test(sid)) s = await um('SELECT * FROM repasse.conversas WHERE id = $1 AND conta_id = $2', [sid, C()])
  if (!s && canal === 'whatsapp' && contato) s = await um(`SELECT * FROM repasse.conversas WHERE conta_id = $1 AND canal = 'whatsapp' AND contato = $2 ORDER BY criado_em DESC LIMIT 1`, [C(), contato])
  if (!s) {
    const id = crypto.randomBytes(12).toString('hex')
    await q('INSERT INTO repasse.conversas (id, conta_id, canal, contato, ip, anuncio_id) VALUES ($1,$2,$3,$4,$5,$6)', [id, C(), canal, contato || null, str(ip, 60) || null, anuncioId])
    s = await um('SELECT * FROM repasse.conversas WHERE id = $1', [id])
  }
  return { ...s, dados: s.dados || {} }
}
const historicoDe = async (id, n = 24) => (await todos('SELECT papel, texto FROM repasse.conversa_msgs WHERE conversa_id = $1 ORDER BY id DESC LIMIT $2', [id, n])).reverse()
const gravarMsg = (id, papel, texto, meta = {}) => q('INSERT INTO repasse.conversa_msgs (conversa_id, papel, texto, meta) VALUES ($1,$2,$3,$4::jsonb)', [id, papel, texto, JSON.stringify(meta)])

function boasVindas (bot, vAtual) {
  if (bot.boasVindas) return bot.boasVindas
  const n = cfg().negocio?.nome || 'repasse'
  return vAtual
    ? `Olá! Sou ${bot.nome || 'a assistente'} do ${n} 👋 Quer saber mais do ${tituloDe(vAtual.dados)} (${vAtual.codigo})? Posso mandar mais fotos e informações.`
    : `Olá! Sou ${bot.nome || 'a assistente'} do ${n} 👋 Procura algum veículo? Me diga o modelo, a faixa de valor ou o código do anúncio.`
}

// limites simples em memória contra abuso da vitrine
const limites = new Map()
function dentroDoLimite (chave, max, janelaMs) {
  const agora = Date.now()
  const l = (limites.get(chave) || []).filter(t => agora - t < janelaMs)
  if (l.length >= max) return false
  l.push(agora); limites.set(chave, l)
  return true
}

/**
 * Processa uma mensagem do cliente (vitrine ou WhatsApp).
 * @returns {{ sid, mensagens: [{papel, texto, veiculos}], whatsapp, acoes, fotosDe: {anuncioId, codigo}|null, chamarHumano, resumo }}
 */
export async function conversar ({ sid, texto = '', codigo = '', canal = 'site', contato = '', perfil = '', ip = '', base = '/vitrine' }) {
  const bot = configAssistente()
  const wa = canal === 'whatsapp'
  if (!wa && bot.ativo === false) throw httpErro(403, 'Atendimento desativado.')
  const vPagina = codigo ? await anuncioPorCodigo(codigo, true) : null
  const sess = await sessao({ sid, canal, contato, ip, anuncioId: vPagina?.id || null })
  if (wa) {
    if (!sess.dados.telefone && /^\d{10,13}$/.test(normTel(contato.split('@')[0])) && contato.endsWith('@s.whatsapp.net')) sess.dados.telefone = normTel(contato.split('@')[0])
    if (!sess.dados.nome && perfil) { sess.dados.nome = str(perfil, 60); sess.dados.nome_perfil = true }
  }
  const vAtual = vPagina || (sess.anuncio_id ? await um(`SELECT * FROM repasse.anuncios WHERE id = $1 AND status IN ${ATIVOS}`, [sess.anuncio_id]) : null)
  if (vPagina && sess.anuncio_id !== vPagina.id) await q('UPDATE repasse.conversas SET anuncio_id = $2 WHERE id = $1', [sess.id, vPagina.id])
  texto = str(texto, 1000)

  // abertura: devolve o que já houve (ou a saudação)
  if (!texto) {
    const ja = await todos('SELECT papel, texto, meta FROM repasse.conversa_msgs WHERE conversa_id = $1 ORDER BY id', [sess.id])
    if (ja.length) {
      const mensagens = []
      for (const m of ja) mensagens.push({ papel: m.papel === 'user' ? 'user' : 'bot', texto: m.texto, veiculos: (await Promise.all((m.meta?.codigos || []).map(c => cartao(c, c === m.meta?.fotos_de, base)))).filter(Boolean) })
      return { sid: sess.id, mensagens, acoes: [] }
    }
    const t = boasVindas(bot, vAtual)
    await gravarMsg(sess.id, 'bot', t)
    return { sid: sess.id, mensagens: [{ papel: 'bot', texto: t, veiculos: [] }], acoes: [] }
  }

  if (!wa && (!dentroDoLimite(`ip:${ip}`, 60, 3600e3) || !dentroDoLimite(`s:${sess.id}`, 40, 86400e3) || !dentroDoLimite(`c:${C()}`, 800, 86400e3))) {
    throw httpErro(429, 'Muitas mensagens agora. Fale conosco pelo WhatsApp, por favor.')
  }
  if (wa && !dentroDoLimite(`w:${sess.id}`, 80, 86400e3)) return { sid: sess.id, mensagens: [], acoes: ['limite'] }

  await gravarMsg(sess.id, 'user', texto)
  const historico = await historicoDe(sess.id)
  const vs = await veiculosAtivos()

  let r = null; let via = 'ia'
  if (iaDisponivel()) {
    try { r = await chamarClaude(montarPrompt(bot, sess, vAtual, vs, canal), historico) } catch (e) { registrar('aviso', 'Assistente (IA): ' + e.message); via = 'falha' }
  }
  if (!r) { r = roteiro(sess, texto, vAtual, historico, canal); via = via === 'falha' ? 'falha' : 'roteiro' }

  // dados do cliente
  const L = r.lead && typeof r.lead === 'object' ? r.lead : {}
  const d = { ...sess.dados }
  const tel = normTel(L.telefone || '')
  if (tel.length >= 10 && tel.length <= 11) d.telefone = tel
  else { const m = texto.match(RE_TEL); if (m) d.telefone = m[1] + m[2] + m[3] + m[4] }
  if (str(L.nome) && !/^(cliente|não informado)$/i.test(L.nome)) { d.nome = str(L.nome, 80); delete d.nome_perfil }
  if (str(L.cidade)) d.cidade = str(L.cidade, 80)
  if (PAGAMENTOS.includes(L.pagamento) && L.pagamento) d.pagamento = L.pagamento
  if (typeof L.lojista === 'boolean') d.lojista = L.lojista
  if (str(L.interesse)) d.interesse = str(L.interesse, 200)
  if (r.temperatura) d.temperatura = r.temperatura

  // veículos a mostrar (só os ativos desta conta)
  const ativos = new Set(vs.map(v => v.codigo.toUpperCase()))
  const norm = (c) => normCodigo(c)
  const fotosDeCod = norm(r.fotos_de) && ativos.has(norm(r.fotos_de)) ? norm(r.fotos_de) : null
  const cods = [...new Set([...(Array.isArray(r.mostrar_codigos) ? r.mostrar_codigos : []).map(norm), fotosDeCod].filter(c => c && ativos.has(c)))].slice(0, 3)
  const veiculos = wa ? [] : (await Promise.all(cods.map(c => cartao(c, c === fotosDeCod, base)))).filter(Boolean)

  const acoes = []
  const resumo = historico.slice(-8).map(m => `${m.papel === 'user' ? 'Cliente' : 'Assistente'}: ${m.texto}`).join('\n')
  // lead (aba Clientes → Interessados) assim que há nome ou telefone
  const vLead = vAtual || (cods[0] ? vs.find(v => v.codigo.toUpperCase() === cods[0]) : null)
  let leadId = sess.lead_id
  if (d.telefone || d.nome || wa) {
    if (!leadId) {
      const l = await um(`INSERT INTO repasse.leads (conta_id, nome, telefone, mensagem, anuncio_id, codigo, origem, conversa_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [C(), d.nome || null, d.telefone || (wa ? contato : null), `Conversa com a assistente (${wa ? 'WhatsApp' : 'vitrine'})`, vLead?.id || null, vLead?.codigo || null, wa ? 'assistente-whatsapp' : 'assistente-vitrine', sess.id])
      leadId = l.id
      acoes.push('lead'); avisar('leads', {})
    } else {
      await q(`UPDATE repasse.leads SET nome = COALESCE(nome, $2), telefone = COALESCE(telefone, $3), anuncio_id = COALESCE(anuncio_id, $4), codigo = COALESCE(codigo, $5), atualizado_em = now() WHERE id = $1`,
        [leadId, d.nome || null, d.telefone || null, vLead?.id || null, vLead?.codigo || null])
    }
  }

  let resposta = str(r.resposta, 1500)
  let whatsapp = ''
  if (r.chamar_humano) {
    acoes.push('humano')
    const n = normTel(cfg().negocio?.contato || '')
    if (!wa && n.length >= 10) whatsapp = `https://wa.me/55${n}?text=${encodeURIComponent(`Olá! Vim pela vitrine${d.nome ? `, sou ${d.nome}` : ''}${vLead ? ` e tenho interesse no ${tituloDe(vLead.dados)} (${vLead.codigo})` : ''}.`)}`
    if (leadId) await q(`UPDATE repasse.leads SET status = CASE WHEN status = 'novo' THEN 'negociando' ELSE status END, obs = $2, atualizado_em = now() WHERE id = $1`, [leadId, `🙋 ${str(r.motivo_humano, 120) || 'Quer falar com o responsável'}\n${resumo}`.slice(0, 2000)])
    if (wa) await q(`UPDATE repasse.conversas SET pausado_ate = now() + interval '12 hours', precisa_humano = true WHERE id = $1`, [sess.id])
    else await q('UPDATE repasse.conversas SET precisa_humano = true WHERE id = $1', [sess.id])
    registrar('info', `🙋 Cliente quer o responsável${vLead ? ` (${vLead.codigo})` : ''}: ${d.nome || d.telefone || 'sem nome'}`)
  }
  await q(`UPDATE repasse.conversas SET dados = $2::jsonb, nome = $3, telefone = $4, lead_id = $5, atualizado_em = now() WHERE id = $1`,
    [sess.id, JSON.stringify(d), d.nome || null, d.telefone || null, leadId || null])
  await gravarMsg(sess.id, 'bot', resposta, { codigos: cods, fotos_de: fotosDeCod, via, acoes })
  avisar('conversas', { id: sess.id })
  const fotosDe = fotosDeCod ? vs.find(v => v.codigo.toUpperCase() === fotosDeCod) : null
  return {
    sid: sess.id, mensagens: [{ papel: 'bot', texto: resposta, veiculos }], whatsapp, acoes, via,
    fotosDe: fotosDe ? { anuncioId: fotosDe.id, codigo: fotosDe.codigo } : null,
    chamarHumano: !!r.chamar_humano, motivo: str(r.motivo_humano, 200), resumo, cliente: d, veiculo: vLead
  }
}

// ---------------- Alimentar o anúncio (você manda código + fotos/informações) ----------------
export async function alimentarAnuncio (codigo, { texto = '', fotos = [] } = {}) {
  const a = await anuncioPorCodigo(codigo)
  if (!a) throw new Error(`Código ${codigo} não encontrado`)
  let nFotos = 0
  if (fotos.length) {
    const atual = await um('SELECT count(*)::int n, COALESCE(max(ordem), -1)::int mx FROM repasse.fotos WHERE anuncio_id = $1', [a.id])
    const limite = Math.max(30, cfg().edicao?.maxFotosBanco || 12)
    const novas = (await recortarTodas(fotos, limite)).slice(0, Math.max(0, limite - atual.n))
    let ordem = atual.mx + 1
    for (const b of novas) {
      const { data, largura, altura } = await prepararFoto(b)
      await q(`INSERT INTO repasse.fotos (id, anuncio_id, ordem, capa, largura, altura, bytes, dados) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [crypto.randomUUID(), a.id, ordem++, atual.n === 0 && nFotos === 0, largura, altura, data.length, data])
      nFotos++
    }
  }
  const pref = a.codigo.split('-')[0]
  const info = str(String(texto).replace(new RegExp(`\\b${pref}\\s?-?\\s?\\d{1,5}\\b`, 'gi'), '').replace(/^[\s:;,.–-]+/, ''), 2000)
  if (info.length >= 3) {
    const dia = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(new Date())
    await q(`UPDATE repasse.anuncios SET info_extra = left(trim(COALESCE(info_extra || E'\\n', '') || $2), 4000) WHERE id = $1`, [a.id, `[${dia}] ${info}`])
  }
  if (nFotos || info.length >= 3) { avisar('fila', { id: a.id }); registrar('info', `${a.codigo}: ${[nFotos ? `${nFotos} foto(s)` : '', info.length >= 3 ? 'informações' : ''].filter(Boolean).join(' e ')} adicionada(s) por você`) }
  return { codigo: a.codigo, titulo: tituloDe(a.dados), fotos: nFotos, info: info.length >= 3, status: a.status }
}

// ---------------- Painel: conversas ----------------
export async function listarConversas () {
  return todos(`SELECT c.id, c.canal, c.contato, c.nome, c.telefone, c.precisa_humano, c.pausado_ate, c.criado_em, c.atualizado_em, c.dados,
      a.codigo, (SELECT texto FROM repasse.conversa_msgs m WHERE m.conversa_id = c.id ORDER BY id DESC LIMIT 1) AS ultima,
      (SELECT count(*)::int FROM repasse.conversa_msgs m WHERE m.conversa_id = c.id AND papel = 'user') AS msgs
    FROM repasse.conversas c LEFT JOIN repasse.anuncios a ON a.id = c.anuncio_id
    WHERE c.conta_id = $1 AND EXISTS (SELECT 1 FROM repasse.conversa_msgs m WHERE m.conversa_id = c.id AND papel = 'user')
    ORDER BY c.atualizado_em DESC LIMIT 200`, [C()])
}
export async function lerConversa (id) {
  const c = await um('SELECT * FROM repasse.conversas WHERE id = $1 AND conta_id = $2', [id, C()])
  if (!c) return null
  return { ...c, mensagens: await todos('SELECT papel, texto, meta, ts FROM repasse.conversa_msgs WHERE conversa_id = $1 ORDER BY id', [id]) }
}
export async function pausarConversa (id, pausar) {
  await q(`UPDATE repasse.conversas SET pausado_ate = ${pausar ? "now() + interval '30 days'" : 'NULL'}, precisa_humano = CASE WHEN $3 THEN precisa_humano ELSE false END WHERE id = $1 AND conta_id = $2`, [id, C(), !!pausar])
}
export async function pausadaPorHumano (contato) {
  // você respondeu à mão nesta conversa do WhatsApp: a assistente fica quieta por 12 h
  await q(`UPDATE repasse.conversas SET pausado_ate = GREATEST(COALESCE(pausado_ate, now()), now() + interval '12 hours') WHERE conta_id = $1 AND canal = 'whatsapp' AND contato = $2`, [C(), contato])
}
export async function conversaPausada (contato) {
  const r = await um(`SELECT pausado_ate > now() AS p FROM repasse.conversas WHERE conta_id = $1 AND canal = 'whatsapp' AND contato = $2 ORDER BY criado_em DESC LIMIT 1`, [C(), contato])
  return !!r?.p
}
export { fotosDe }
