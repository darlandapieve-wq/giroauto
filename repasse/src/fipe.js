// Consulta FIPE: (1) por placa, se houver provedor configurado; (2) por marca/modelo/versão/ano
// usando a API pública FIPE (fipe.parallelum.com.br). Resultados ficam em cache no banco.
import { kvGet, kvSet } from './db.js'

const BASE = process.env.FIPE_API_URL || 'https://fipe.parallelum.com.br/api/v2'
const TOKEN = process.env.FIPE_TOKEN || '' // opcional: aumenta o limite diário da API
const DIA = 86400e3

const semAcento = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const tokens = (s) => semAcento(s).replace(/[^a-z0-9.]+/g, ' ').trim().split(/\s+/).filter(Boolean)
const reais = (s) => s ? parseInt(String(s).replace(/[^\d,]/g, '').split(',')[0], 10) : null

async function get (caminho) {
  const r = await fetch(BASE + caminho, { headers: TOKEN ? { 'X-Subscription-Token': TOKEN } : {} })
  if (!r.ok) throw new Error(`FIPE ${r.status}`)
  return r.json()
}

async function emCache (chave, dias, fn) {
  const c = await kvGet('fipe:' + chave)
  if (c && Date.now() - c.ts < dias * DIA) return c.v
  const v = await fn()
  await kvSet('fipe:' + chave, { ts: Date.now(), v })
  return v
}

const ALIAS = { 'Chevrolet': ['gm - chevrolet', 'chevrolet'], 'Volkswagen': ['vw - volkswagen', 'volkswagen'], 'Mercedes-Benz': ['mercedes-benz'], 'Citroen': ['citroen'], 'Chery': ['caoa chery', 'chery'], 'Land Rover': ['land rover'], 'RAM': ['ram'] }

async function acharMarca (marca, tipo) {
  const marcas = await emCache(`marcas:${tipo}`, 30, () => get(`/${tipo}/brands`))
  const alvos = (ALIAS[marca] || [marca]).map(semAcento)
  return marcas.find(m => alvos.includes(semAcento(m.name))) || marcas.find(m => alvos.some(a => semAcento(m.name).includes(a)))
}

// pontua o nome do modelo FIPE contra modelo + versão + motor do anúncio
export function pontuar (nomeFipe, d) {
  const tf = tokens(nomeFipe)
  const tm = tokens(d.modelo)
  if (!tm.every(t => tf.includes(t) || tf.some(x => x.startsWith(t)))) return -1
  let p = 10
  const extras = [...tokens(d.versao), ...tokens(d.motor)].filter(t => !tm.includes(t))
  for (const t of new Set(extras)) if (tf.includes(t)) p += t.match(/\d\.\d/) ? 4 : 3
  if (d.cambio === 'Automático' && tf.some(t => /^aut/.test(t))) p += 2
  if (d.cambio === 'Manual' && tf.some(t => /^aut/.test(t))) p -= 2
  if (d.combustivel === 'Diesel' && tf.some(t => /diesel|tdi|^d$/.test(t))) p += 2
  p -= Math.max(0, tf.length - tm.length - extras.length) * 0.3 // prefere nomes mais curtos quando empata
  return p
}

const COMB = { Gasolina: 1, Flex: 1, Etanol: 2, Diesel: 3, Elétrico: 4, Híbrido: 1 }

export async function fipePorModelo (d) {
  if (!d.marca || !d.modelo || !d.anoModelo) return null
  const tipo = 'cars'
  const chave = semAcento(`${d.marca}|${d.modelo}|${d.versao || ''}|${d.motor || ''}|${d.anoModelo}|${d.combustivel || ''}|${d.cambio || ''}`)
  return emCache('modelo:' + chave, 15, async () => {
    const marca = await acharMarca(d.marca, tipo)
    if (!marca) return null
    const modelos = await emCache(`modelos:${tipo}:${marca.code}`, 15, () => get(`/${tipo}/brands/${marca.code}/models`))
    const cands = modelos.map(m => ({ m, p: pontuar(m.name, d) })).filter(x => x.p >= 0).sort((a, b) => b.p - a.p).slice(0, 6)
    for (const { m, p } of cands) {
      const anos = await emCache(`anos:${tipo}:${marca.code}:${m.code}`, 15, () => get(`/${tipo}/brands/${marca.code}/models/${m.code}/years`))
      const prefer = COMB[d.combustivel] || 1
      const ano = anos.find(a => a.code === `${d.anoModelo}-${prefer}`) || anos.find(a => a.code.startsWith(`${d.anoModelo}-`))
      if (!ano) continue
      const preco = await get(`/${tipo}/brands/${marca.code}/models/${m.code}/years/${ano.code}`)
      return {
        valor: reais(preco.price),
        codigoFipe: preco.codeFipe,
        modeloFipe: preco.model,
        anoFipe: ano.name,
        referencia: preco.referenceMonth,
        fonte: 'modelo',
        confianca: p >= 16 ? 'alta' : p >= 12 ? 'média' : 'baixa'
      }
    }
    return null
  })
}

// Provedor de placa configurável. Ex.: PLACA_API_URL="https://provedor.com/consulta/{placa}/{token}" e PLACA_API_TOKEN
export const placaDisponivel = () => !!process.env.PLACA_API_URL

export async function fipePorPlaca (placa, anoModelo) {
  if (!placaDisponivel() || !placa) return null
  const p = placa.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return emCache('placa:' + p, 30, async () => {
    const url = process.env.PLACA_API_URL.replace('{placa}', p).replace('{token}', process.env.PLACA_API_TOKEN || '')
    const r = await fetch(url, { headers: process.env.PLACA_API_TOKEN && !process.env.PLACA_API_URL.includes('{token}') ? { Authorization: `Bearer ${process.env.PLACA_API_TOKEN}` } : {} })
    if (!r.ok) throw new Error(`Placa ${r.status}`)
    const j = await r.json()
    // Formatos variam entre provedores: procura os campos mais comuns
    const lista = j.fipe?.dados || j.fipe || j.FIPE || j.dados_fipe || []
    const arr = Array.isArray(lista) ? lista : [lista]
    const melhor = arr.sort((a, b) => (b.score || 0) - (a.score || 0))[0] || {}
    const codigo = melhor.codigo_fipe || melhor.codigoFipe || j.codigo_fipe || j.codigoFipe
    let valor = reais(melhor.texto_valor || melhor.valor || melhor.Valor || j.valor_fipe)
    let ref = melhor.mes_referencia || melhor.referencia || null
    // sem valor no retorno: consulta pelo código FIPE
    if (!valor && codigo && anoModelo) {
      try {
        const anos = await get(`/cars/${codigo}/years`)
        const a = anos.find(x => x.code.startsWith(`${anoModelo}-`))
        if (a) { const pr = await get(`/cars/${codigo}/years/${a.code}`); valor = reais(pr.price); ref = pr.referenceMonth }
      } catch {}
    }
    return {
      valor,
      codigoFipe: codigo || null,
      modeloFipe: melhor.texto_modelo || j.MODELO || j.modelo || null,
      marcaPlaca: j.MARCA || j.marca || null,
      anoPlaca: j.anoModelo || j.ano_modelo || j.ano || null,
      referencia: ref,
      fonte: 'placa',
      confianca: valor ? 'alta' : 'baixa'
    }
  })
}

export async function consultarFipe (d, cfgFipe) {
  if (!cfgFipe.consultar) return null
  if (d.fipe && !cfgFipe.sempreConsultar) return null
  if (cfgFipe.usarPlaca && d.placa && placaDisponivel()) {
    try { const r = await fipePorPlaca(d.placa, d.anoModelo); if (r?.valor) return r } catch {}
  }
  return fipePorModelo(d)
}
