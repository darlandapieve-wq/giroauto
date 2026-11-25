// Placa borrada nas fotos que saem para fora (grupo de destino, vitrine e assistente).
// A IA (visão do Claude) indica onde está a placa em cada foto; aqui a região é pixelada e borrada com folga.
// O original fica guardado (painel); a versão pública vai em fotos.dados_publico.
import sharp from 'sharp'
import { q, todos, um } from './db.js'
import { cfg } from './config.js'
import { contaId } from './contexto.js'
import { iaDisponivel } from './ia.js'
import { registrar, avisar } from './eventos.js'

const LADO = 768 // tamanho enviado à IA (lado maior)
export const borrarAtivo = () => cfg().edicao?.borrarPlaca !== false && iaDisponivel()

const FERRAMENTA = {
  name: 'placas',
  description: 'Informa onde estão as placas de veículos em cada imagem.',
  input_schema: {
    type: 'object',
    properties: {
      imagens: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            imagem: { type: 'integer', description: 'número da imagem (1, 2, …)' },
            placas: {
              type: 'array',
              description: 'retângulo de cada placa visível (inclusive parcial, inclinada ou pequena), em pixels da imagem como enviada',
              items: { type: 'object', properties: { x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' } }, required: ['x1', 'y1', 'x2', 'y2'] }
            }
          },
          required: ['imagem', 'placas']
        }
      }
    },
    required: ['imagens']
  }
}

// Recebe buffers JPEG; devolve, para cada um, a lista de caixas em pixels do ORIGINAL
export async function detectarPlacas (buffers) {
  const reduzidas = []
  for (const b of buffers) {
    const meta = await sharp(b).metadata()
    const esc = Math.min(1, LADO / Math.max(meta.width, meta.height))
    const w = Math.round(meta.width * esc); const h = Math.round(meta.height * esc)
    const img = await sharp(b).resize(w, h).jpeg({ quality: 80 }).toBuffer()
    reduzidas.push({ img, w, h, esc })
  }
  const conteudo = []
  reduzidas.forEach((r, i) => {
    conteudo.push({ type: 'text', text: `Imagem ${i + 1} (${r.w}x${r.h} pixels):` })
    conteudo.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: r.img.toString('base64') } })
  })
  conteudo.push({ type: 'text', text: 'Para cada imagem, localize todas as placas de veículo (placa Mercosul ou modelo antigo, dianteira ou traseira, de qualquer veículo na foto). Dê o retângulo justo de cada placa em pixels. Se não houver placa visível, devolva lista vazia para a imagem.' })
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: cfg().ia?.modeloPlaca || 'claude-haiku-5-5', max_tokens: 1200,
      system: 'Você localiza placas de veículos em fotos para que sejam borradas (privacidade). Seja preciso nas coordenadas e não omita placas parcialmente visíveis.',
      tools: [FERRAMENTA], tool_choice: { type: 'tool', name: 'placas' },
      messages: [{ role: 'user', content: conteudo }]
    }),
    signal: AbortSignal.timeout(60000)
  })
  if (!r.ok) throw new Error(`IA respondeu ${r.status}: ${(await r.text()).slice(0, 160)}`)
  const j = await r.json()
  const saida = j.content?.find(c => c.type === 'tool_use')?.input?.imagens || []
  return reduzidas.map((red, i) => {
    const item = saida.find(x => Number(x.imagem) === i + 1)
    return (item?.placas || []).map(p => ({
      x1: Math.min(p.x1, p.x2) / red.esc, y1: Math.min(p.y1, p.y2) / red.esc,
      x2: Math.max(p.x1, p.x2) / red.esc, y2: Math.max(p.y1, p.y2) / red.esc
    })).filter(c => c.x2 - c.x1 > 2 && c.y2 - c.y1 > 2)
  })
}

// Pixela + borra cada caixa, com folga (a IA nem sempre acerta o contorno exato)
export async function borrar (buf, caixas) {
  if (!caixas.length) return null
  const meta = await sharp(buf).metadata()
  const W = meta.width; const H = meta.height
  const camadas = []
  for (const c of caixas) {
    const w = c.x2 - c.x1; const h = c.y2 - c.y1
    const fx = Math.max(w * 0.35, W * 0.015); const fy = Math.max(h * 0.6, H * 0.015)
    const left = Math.max(0, Math.floor(c.x1 - fx)); const top = Math.max(0, Math.floor(c.y1 - fy))
    const width = Math.min(W - left, Math.ceil(w + 2 * fx)); const height = Math.min(H - top, Math.ceil(h + 2 * fy))
    if (width < 4 || height < 4) continue
    const pequeno = await sharp(buf).extract({ left, top, width, height }).resize(Math.max(2, Math.round(width / 18)), Math.max(2, Math.round(height / 18))).toBuffer()
    const bloco = await sharp(pequeno).resize(width, height, { kernel: 'nearest' }).blur(Math.max(2, Math.min(width, height) / 10)).jpeg().toBuffer()
    camadas.push({ input: bloco, left, top })
  }
  if (!camadas.length) return null
  return sharp(buf).composite(camadas).jpeg({ quality: 72, mozjpeg: true }).toBuffer()
}

// Processa as fotos ainda não verificadas de um anúncio (até "max"), em lotes de 4 por chamada à IA
export async function prepararFotosPublicas (anuncioId, max = 6) {
  if (!borrarAtivo()) return 0
  const fs = await todos(`SELECT f.id, f.dados FROM repasse.fotos f JOIN repasse.anuncios a ON a.id = f.anuncio_id
    WHERE f.anuncio_id = $1 AND a.conta_id = $2 AND f.placa_status IS NULL ORDER BY f.capa DESC, f.ordem LIMIT $3`, [anuncioId, contaId(), max])
  return processarFotos(fs)
}

// Detecta e borra uma lista de fotos {id, dados}, 4 por chamada à IA
async function processarFotos (fs) {
  let n = 0
  for (let i = 0; i < fs.length; i += 4) {
    const lote = fs.slice(i, i + 4)
    const bufs = lote.map(f => Buffer.from(f.dados))
    let caixas
    try { caixas = await detectarPlacas(bufs) } catch (e) { registrar('aviso', 'Placa (IA): ' + e.message); return n }
    for (let k = 0; k < lote.length; k++) {
      const pub = await borrar(bufs[k], caixas[k] || []).catch(() => null)
      await q('UPDATE repasse.fotos SET placa_status = $2, placa_caixas = $3::jsonb, dados_publico = $4 WHERE id = $1 AND placa_status IS NULL',
        [lote[k].id, pub ? 'borrada' : 'sem-placa', JSON.stringify(caixas[k] || []), pub])
      n++
    }
  }
  if (n) avisar('fila', {})
  return n
}

// Na fila (pendentes): só a foto de capa, que é a que vai para o grupo — barato e já aparece borrada para você
// conferir. As demais fotos são verificadas quando o anúncio é aprovado.
let rodandoCapas = new Set()
export async function prepararCapasDaFila () {
  if (!borrarAtivo()) return
  const C = contaId()
  if (rodandoCapas.has(C)) return
  rodandoCapas.add(C)
  try {
    for (let volta = 0; volta < 10; volta++) {
      // Escolhe a capa de cada anúncio sem trazer os bytes; só baixa do banco as (até 8) que ainda faltam verificar.
      // Antes, as capas de toda a fila eram baixadas a cada 3 min — gerava vários GB/mês de saída no Supabase.
      const falta = await todos(`SELECT f.id, f.dados FROM repasse.fotos f WHERE f.id IN (
          SELECT c.id FROM (SELECT DISTINCT ON (f2.anuncio_id) f2.id, f2.placa_status FROM repasse.fotos f2
            JOIN repasse.anuncios a ON a.id = f2.anuncio_id
            WHERE a.conta_id = $1 AND a.status IN ('pendente','filtrado') ORDER BY f2.anuncio_id, f2.capa DESC, f2.ordem) c
          WHERE c.placa_status IS NULL LIMIT 8)`, [C])
      if (!falta.length) return
      if (!(await processarFotos(falta))) return // IA falhou: tenta no próximo ciclo
    }
  } finally { rodandoCapas.delete(C) }
}

// Fotos de anúncios aprovados/em circulação ainda sem verificação (rodado periodicamente)
export async function prepararPendentes () {
  if (!borrarAtivo()) return
  const ads = await todos(`SELECT DISTINCT a.id FROM repasse.anuncios a JOIN repasse.fotos f ON f.anuncio_id = a.id
    WHERE a.conta_id = $1 AND a.status IN ('aprovado','circulando','enviado') AND f.placa_status IS NULL LIMIT 10`, [contaId()])
  for (const { id } of ads) await prepararFotosPublicas(id)
}

// versão para fora: borrada se houver; original se não tiver placa (ou ainda não verificada)
export async function fotoParaEnvio (fotoId) {
  const r = await um('SELECT COALESCE(dados_publico, dados) AS d FROM repasse.fotos WHERE id = $1', [fotoId])
  return r ? Buffer.from(r.d) : null
}
