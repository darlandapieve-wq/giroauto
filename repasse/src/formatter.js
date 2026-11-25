// Aplica filtros, ajuste de preço e o modelo de mensagem configurado.
import { limparTexto } from './parser.js'
import { CATEGORIAS } from './categorias.js'

const moeda = (v) => v == null ? '' : 'R$ ' + Math.round(v).toLocaleString('pt-BR')
const milhar = (v) => v == null ? '' : Math.round(v).toLocaleString('pt-BR')

export function precoFinal (preco, ajuste) {
  if (preco == null || !ajuste?.ativo) return preco
  let p = ajuste.tipo === 'percentual' ? preco * (1 + (Number(ajuste.valor) || 0) / 100) : preco + (Number(ajuste.valor) || 0)
  const arr = Number(ajuste.arredondar) || 0
  if (arr > 0) p = Math.ceil(p / arr) * arr
  return Math.round(p)
}

function contem (texto, termos) {
  const t = texto.toLowerCase()
  return (termos || []).filter(x => x && x.trim()).find(x => t.includes(x.trim().toLowerCase()))
}

// Retorna lista de motivos de reprovação (vazia = aprovado nos filtros)
// limite numérico válido? (vazio, zero, negativo ou ano fora de 1950–2100 = sem limite)
const lim = (v, ano = false) => { const n = Number(v); return Number.isFinite(n) && n > 0 && (!ano || (n >= 1950 && n <= 2100)) ? n : null }

export function avaliarFiltros (dados, cfg, { temMidia }) {
  const f = cfg.filtros
  const r = []
  if (dados.pontos < cfg.pontuacaoMinima) r.push(`pontuação ${dados.pontos} < ${cfg.pontuacaoMinima}`)
  if (f.ignorarProcura && dados.ehProcura) r.push('mensagem de procura/compra')
  if (f.exigirPreco && !dados.preco) r.push('sem preço')
  if (f.exigirFoto && !temMidia) r.push('sem foto')
  if (f.exigirAno && !dados.anoModelo) r.push('sem ano')
  if (f.ignorarComAlertas && dados.alertas.length) r.push('alerta: ' + dados.alertas.join(', '))
  if (lim(f.anoMin, true) && dados.anoModelo && dados.anoModelo < f.anoMin) r.push(`ano < ${f.anoMin}`)
  if (lim(f.anoMax, true) && dados.anoModelo && dados.anoModelo > f.anoMax) r.push(`ano > ${f.anoMax}`)
  if (lim(f.precoMin) && dados.preco && dados.preco < f.precoMin) r.push(`preço < ${moeda(f.precoMin)}`)
  if (lim(f.precoMax) && dados.preco && dados.preco > f.precoMax) r.push(`preço > ${moeda(f.precoMax)}`)
  if (lim(f.kmMax) && dados.km && dados.km > f.kmMax) r.push(`km > ${milhar(f.kmMax)}`)
  if (f.somenteAbaixoFipe && !(fipeDe(dados) && dados.preco && fipeDe(dados) > dados.preco)) r.push('não está abaixo da FIPE (ou FIPE não informada)')
  if (f.marcasPermitidas?.length && !f.marcasPermitidas.includes(dados.marca)) r.push(`marca fora da lista (${dados.marca || '?'})`)
  if (f.palavrasObrigatorias?.filter(Boolean).length && !contem(dados.textoOriginal, f.palavrasObrigatorias)) r.push('nenhuma palavra obrigatória')
  const bloq = contem(dados.textoOriginal, f.palavrasBloqueadas)
  if (bloq) r.push(`palavra bloqueada: "${bloq}"`)
  return r
}

export const fipeDe = (d) => d.fipe || d.fipeConsulta?.valor || null

export function camposDoAnuncio (dados, cfg, { codigo, precoRepasse } = {}) {
  const pf = precoRepasse ?? precoFinal(dados.preco, cfg.edicao.ajustePreco)
  const fipe = fipeDe(dados)
  const abaixo = pf && fipe && fipe > pf ? fipe - pf : null
  return {
    marca: dados.marca || '',
    modelo: dados.modelo || '',
    versao: dados.versao || '',
    motor: dados.motor || '',
    ano: dados.ano || '',
    km: faixaKm(dados.km), // no repasse o km vai em faixa, não o número exato
    km_exato: dados.km != null ? milhar(dados.km) + ' km' : '',
    preco: moeda(pf),
    preco_original: moeda(dados.preco),
    fipe: moeda(fipe),
    abaixo_fipe: abaixo ? moeda(abaixo) : '',
    categoria: CATEGORIAS[dados.categoria] || '',
    cambio: dados.cambio || '',
    combustivel: dados.combustivel || '',
    cor: dados.cor || '',
    cidade: dados.cidade || '',
    opcionais: (dados.opcionais || []).join(', '),
    situacao: (dados.situacao || []).join(' • '),
    alertas: (dados.alertas || []).join(', '),
    descricao_ia: dados.descricaoIA || '',
    descricao_limpa: limparTexto(dados.textoOriginal || '', cfg.edicao),
    codigo: codigo || '',
    negocio: cfg.negocio.nome || '',
    contato: cfg.negocio.contato || ''
  }
}

// KM genérico: "faixa de 45 mil km" (arredonda para 5 mil; acima de 100 mil, para 10 mil)
export function faixaKm (km) {
  if (km == null || km === '' || isNaN(km)) return ''
  km = Number(km)
  if (km <= 5000) return 'até 5 mil km'
  const passo = km >= 100000 ? 10000 : 5000
  const r = Math.round(km / passo) * passo
  return `faixa de ${(r / 1000).toLocaleString('pt-BR')} mil km`
}

export const CAMPOS_DISPONIVEIS = ['marca', 'modelo', 'versao', 'motor', 'ano', 'km', 'km_exato', 'preco', 'preco_original', 'fipe', 'abaixo_fipe', 'categoria', 'cambio', 'combustivel', 'cor', 'cidade', 'opcionais', 'situacao', 'alertas', 'descricao_ia', 'descricao_limpa', 'codigo', 'negocio', 'contato']

// ---------- Regras de cada grupo destino ----------
// regras: { categorias:[], premium:'qualquer'|'so'|'nao', precoMin, precoMax, anoMin, anoMax, kmMax,
//           marcas:[], combustiveis:[], cambio:'', acrescimo }
export function destinoAceita (dados, precoRepasse, regras = {}) {
  const r = regras || {}
  const preco = precoRepasse ?? dados.preco
  if (r.categorias?.length && !r.categorias.includes(dados.categoria)) return `categoria ${CATEGORIAS[dados.categoria] || '?'}`
  if (r.premium === 'so' && !dados.premium) return 'não é premium'
  if (r.premium === 'nao' && dados.premium) return 'é premium'
  if (lim(r.precoMin) && (!preco || preco < r.precoMin)) return 'preço abaixo do mínimo'
  if (lim(r.precoMax) && (!preco || preco > r.precoMax)) return 'preço acima do máximo'
  if (lim(r.anoMin, true) && (!dados.anoModelo || dados.anoModelo < r.anoMin)) return 'ano abaixo do mínimo'
  if (lim(r.anoMax, true) && dados.anoModelo && dados.anoModelo > r.anoMax) return 'ano acima do máximo'
  if (lim(r.kmMax) && dados.km && dados.km > r.kmMax) return 'km acima do máximo'
  if (r.marcas?.length && !r.marcas.includes(dados.marca)) return 'marca fora da lista'
  if (r.combustiveis?.length && !r.combustiveis.includes(dados.combustivel)) return 'combustível fora da lista'
  if (r.cambio && dados.cambio && r.cambio !== dados.cambio) return 'câmbio diferente'
  return null
}

export function renderizar (campos, modelo) {
  const saida = []
  for (const linha of modelo) {
    if (!linha.ativo) continue
    const usados = [...linha.texto.matchAll(/\{(\w+)\}/g)].map(m => m[1])
    // linha com campo obrigatório vazio é descartada (no cabeçalho basta ter algum preenchido)
    const vazios = usados.filter(u => !campos[u])
    if (usados.length && (linha.id === 'cab' ? vazios.length === usados.length : vazios.length)) continue
    const txt = linha.texto.replace(/\{(\w+)\}/g, (_, k) => campos[k] ?? '').replace(/[ \t]{2,}/g, ' ')
      .replace(/\*[ \t]*([^*\n]*?)[ \t]*\*/g, (_, x) => x ? `*${x}*` : '')
    saida.push(txt.replace(/[ \t]+$/, ''))
  }
  return saida.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
