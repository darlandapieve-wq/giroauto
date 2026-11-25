// Atendimento pelo WhatsApp conectado de cada conta:
// - clientes (conversas individuais que não são fontes de anúncio) → assistente responde, manda fotos e chama você;
// - você (seus números ou a conversa "você mesmo") → código GA-xxxx + fotos/informações alimentam o anúncio;
// - quando você responde à mão numa conversa, a assistente fica quieta nela por 12 h.
import { q, um } from './db.js'
import { cfg } from './config.js'
import { registrar } from './eventos.js'
import { normTel } from './vendas.js'
import { conversar, alimentarAnuncio, codigosNoTexto, configAssistente, conversaPausada, pausadaPorHumano, fotosDe } from './assistente.js'
import { lerFoto } from './fotos.js'

const buffers = new Map() // `${conta}|${chat}` -> { ... }
const digitos = (t) => normTel(String(t || '').split('@')[0].split(':')[0])
const ehMesmoNumero = (a, b) => { const x = digitos(a); const y = digitos(b); return x.length >= 10 && y.length >= 10 && (x === y || x.slice(-8) === y.slice(-8) && x.slice(0, 2) === y.slice(0, 2)) }
const jidDe = (num) => `55${normTel(num)}@s.whatsapp.net`

export function numeroAdmin (numero) {
  return (configAssistente().numerosAdmin || []).some(n => ehMesmoNumero(n, numero))
}
const ignorado = (numero) => (configAssistente().ignorarNumeros || []).some(n => ehMesmoNumero(n, numero))

// ---------- você alimentando os anúncios ----------
export function mensagemDoAdmin (cx, { chat, texto, midia }) {
  const chave = `${cx.contaId}|adm|${chat}`
  const b = buffers.get(chave) || { textos: [], midias: [], timer: null }
  if (texto) b.textos.push(texto)
  if (midia) b.midias.push(midia)
  clearTimeout(b.timer)
  b.timer = setTimeout(() => cx.ctx(() => { buffers.delete(chave); processarAdmin(cx, chat, b).catch(e => registrar('erro', 'Alimentar anúncio: ' + e.message)) }), 8000)
  buffers.set(chave, b)
}
const ativos = new Map() // `${conta}|${chat}` -> { codigo, ate }
async function processarAdmin (cx, chat, b) {
  const texto = b.textos.join('\n').trim()
  const cods = codigosNoTexto(texto)
  const k = `${cx.contaId}|${chat}`
  let codigo = cods[0]
  if (!codigo) { const a = ativos.get(k); if (a && a.ate > Date.now()) codigo = a.codigo }
  if (!codigo) {
    if (b.midias.length || /^(ajuda|\?)$/i.test(texto)) await cx.enviar(chat, `Para guardar no anúncio, mande o código junto (ex.: ${cfg().negocio?.prefixoCodigo || 'GA'}-0003) e depois as fotos ou informações. Vale por 15 min.`)
    return
  }
  ativos.set(k, { codigo, ate: Date.now() + 15 * 60e3 })
  const fotos = []
  for (const m of b.midias.slice(0, 20)) { try { fotos.push(...await cx.baixarFotos(m)) } catch (e) { registrar('aviso', 'Foto não baixou: ' + e.message) } }
  try {
    const r = await alimentarAnuncio(codigo, { texto, fotos })
    const tot = await um('SELECT count(*)::int n FROM repasse.fotos f JOIN repasse.anuncios a ON a.id = f.anuncio_id WHERE a.codigo = $1 AND a.conta_id = $2', [r.codigo, cx.contaId])
    const feito = [r.fotos ? `+${r.fotos} foto(s)` : '', r.info ? 'informações salvas' : ''].filter(Boolean).join(' e ')
    await cx.enviar(chat, feito
      ? `✅ ${r.codigo} ${r.titulo}: ${feito} (${tot.n} foto(s) no total).${['circulando', 'enviado'].includes(r.status) ? ' A assistente já usa.' : ' Atenção: este anúncio não está em circulação.'}`
      : `${r.codigo} ${r.titulo} selecionado. Mande as fotos ou informações nos próximos 15 min.`)
  } catch (e) { await cx.enviar(chat, `⚠️ ${e.message}`) }
}

// ---------- clientes ----------
export async function mensagemDeCliente (cx, { chat, numero, texto, nome, temMidia }) {
  const a = configAssistente()
  if (!a.whatsapp || ignorado(numero)) return
  // trava: só responde se o WhatsApp conectado for o número de atendimento cadastrado (nunca o número pessoal)
  const conectado = cx.estado?.eu?.id || cx.sock?.user?.id || ''
  if (!a.numeroAtendimento || !ehMesmoNumero(a.numeroAtendimento, conectado)) return
  const fonte = await um('SELECT fonte, arquivado FROM repasse.grupos WHERE conta_id = $1 AND jid = $2', [cx.contaId, chat])
  if (fonte?.fonte) return // contato que é fonte de anúncios (ex.: um repassador): não é cliente
  if (!texto && temMidia) texto = '(o cliente enviou uma imagem)'
  if (!texto) return
  const chave = `${cx.contaId}|cli|${chat}`
  const b = buffers.get(chave) || { textos: [], timer: null }
  b.textos.push(texto)
  clearTimeout(b.timer)
  b.timer = setTimeout(() => cx.ctx(() => { buffers.delete(chave); responderCliente(cx, chat, numero, nome, b.textos.join('\n')).catch(e => registrar('erro', 'Assistente WhatsApp: ' + e.message)) }), 6000)
  buffers.set(chave, b)
}

async function responderCliente (cx, chat, numero, nome, texto) {
  if (await conversaPausada(chat)) {
    // registra a mensagem mesmo pausada (para o histórico), sem responder
    const s = await um(`SELECT id FROM repasse.conversas WHERE conta_id = $1 AND canal = 'whatsapp' AND contato = $2 ORDER BY criado_em DESC LIMIT 1`, [cx.contaId, chat])
    if (s) await q('INSERT INTO repasse.conversa_msgs (conversa_id, papel, texto) VALUES ($1, $2, $3)', [s.id, 'user', texto])
    return
  }
  const contato = numero && /^\d{10,13}$/.test(digitos(numero)) ? `${chat}` : chat
  const r = await conversar({ canal: 'whatsapp', contato, perfil: nome, texto })
  for (const m of r.mensagens) if (m.texto) await cx.enviar(chat, m.texto)
  if (r.fotosDe) {
    const fs = await fotosDe(r.fotosDe.anuncioId, Math.max(1, configAssistente().fotosPorPedido || 6))
    for (const f of fs) {
      const buf = await lerFoto(f.id, true) // placa borrada
      if (buf) { await cx.enviar(chat, '', buf); await new Promise(res => setTimeout(res, 900)) }
    }
  }
  if (r.chamarHumano && configAssistente().avisarAdmin !== false) {
    const tel = digitos(numero)
    const aviso = `🙋 *Cliente quer falar com você*${r.veiculo ? `\n🚗 ${r.veiculo.codigo} ${[r.veiculo.dados?.marca, r.veiculo.dados?.modelo, r.veiculo.dados?.ano].filter(Boolean).join(' ')}` : ''}
👤 ${r.cliente?.nome || nome || 'sem nome'}${tel.length >= 10 ? ` · wa.me/55${tel}` : ''}${r.motivo ? `\n📝 ${r.motivo}` : ''}

${r.resumo.split('\n').slice(-4).join('\n')}

A assistente pausou nesta conversa por 12 h. Responda direto para o cliente.`
    for (const n of configAssistente().numerosAdmin || []) {
      try { await cx.enviar(jidDe(n), aviso) } catch (e) { registrar('aviso', 'Aviso ao responsável: ' + e.message) }
    }
  }
}

export async function respostaManual (cx, chat) {
  await pausadaPorHumano(chat)
}
