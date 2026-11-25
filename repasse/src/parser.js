// Extrai os dados de um anúncio de veículo a partir do texto livre da mensagem.
// Tudo é heurístico (regex + dicionário). Cada campo extraído pode ser corrigido
// manualmente na fila de aprovação antes do envio.

const MODELOS = {
  Chevrolet: ['onix plus', 'onix', 'prisma', 'cruze', 'tracker', 'spin', 'cobalt', 's10', 'trailblazer', 'montana', 'celta', 'corsa', 'classic', 'agile', 'sonic', 'captiva', 'equinox', 'camaro', 'astra', 'vectra', 'zafira', 'meriva', 'blazer', 'kadett', 'monza', 'omega', 'silverado'],
  Volkswagen: ['gol', 'voyage', 'polo', 'virtus', 't-cross', 'tcross', 'nivus', 'taos', 'tiguan', 'jetta', 'golf', 'fox', 'crossfox', 'spacefox', 'saveiro', 'amarok', 'up', 'fusca', 'parati', 'santana', 'bora', 'passat', 'kombi', 'up!'],
  Fiat: ['strada', 'toro', 'mobi', 'argo', 'cronos', 'pulse', 'fastback', 'uno', 'palio', 'siena', 'grand siena', 'punto', 'linea', 'idea', 'doblo', 'fiorino', 'ducato', 'bravo', 'weekend', 'freemont', '500', 'titano', 'tempra', 'marea', 'stilo'],
  Ford: ['ka', 'fiesta', 'focus', 'ecosport', 'ranger', 'fusion', 'edge', 'territory', 'bronco', 'maverick', 'courier', 'f-250', 'f250', 'f-1000', 'escort', 'mondeo'],
  Toyota: ['corolla cross', 'corolla', 'hilux sw4', 'sw4', 'hilux', 'etios', 'yaris', 'rav4', 'camry', 'prius', 'bandeirante'],
  Honda: ['civic', 'city', 'fit', 'hr-v', 'hrv', 'wr-v', 'wrv', 'cr-v', 'crv', 'accord', 'zr-v'],
  Hyundai: ['hb20s', 'hb20x', 'hb20', 'creta', 'tucson', 'ix35', 'santa fe', 'azera', 'elantra', 'veloster', 'i30', 'hr'],
  Renault: ['kwid', 'sandero', 'logan', 'duster oroch', 'oroch', 'duster', 'captur', 'kardian', 'stepway', 'clio', 'megane', 'fluence', 'scenic', 'master', 'symbol'],
  Nissan: ['kicks', 'versa', 'march', 'sentra', 'frontier', 'livina', 'tiida'],
  Jeep: ['renegade', 'compass', 'commander', 'wrangler', 'cherokee'],
  Peugeot: ['208', '2008', '3008', '308', '408', '207', '206', 'partner', 'expert'],
  Citroen: ['c3 aircross', 'c3', 'c4 cactus', 'c4 lounge', 'c4', 'aircross', 'jumpy', 'xsara picasso', 'basalt'],
  Mitsubishi: ['l200 triton', 'triton', 'l200', 'pajero sport', 'pajero tr4', 'pajero', 'asx', 'outlander', 'eclipse cross', 'lancer'],
  Kia: ['sportage', 'cerato', 'picanto', 'soul', 'sorento', 'stonic', 'bongo'],
  Chery: ['tiggo 2', 'tiggo 3x', 'tiggo 5x', 'tiggo 7', 'tiggo 8', 'tiggo', 'arrizo', 'qq', 'celer'],
  CAOA: [],
  BYD: ['dolphin mini', 'dolphin', 'song plus', 'song pro', 'seal', 'yuan plus', 'king', 'shark'],
  GWM: ['haval h6', 'haval', 'ora 03'],
  BMW: ['320i', '328i', 'x1', 'x3', 'x5', 'x6', '118i', '120i'],
  'Mercedes-Benz': ['classe a', 'classe c', 'c180', 'c200', 'c250', 'gla', 'glc', 'sprinter', 'accelo'],
  Audi: ['a3', 'a4', 'a5', 'q3', 'q5', 'q7'],
  'Land Rover': ['evoque', 'discovery sport', 'discovery', 'defender', 'freelander'],
  Suzuki: ['jimny', 'vitara', 'grand vitara', 'swift', 's-cross'],
  RAM: ['rampage', '1500', '2500', '3500'],
  Volvo: ['xc40', 'xc60', 'xc90'],
  JAC: ['t40', 't50', 't60', 'e-js1'],
  Lifan: ['x60', 'x80']
}

const ALIAS_MARCA = {
  chevrolet: 'Chevrolet', gm: 'Chevrolet', chev: 'Chevrolet',
  volkswagen: 'Volkswagen', vw: 'Volkswagen', volks: 'Volkswagen',
  fiat: 'Fiat', ford: 'Ford', toyota: 'Toyota', honda: 'Honda', hyundai: 'Hyundai',
  renault: 'Renault', nissan: 'Nissan', jeep: 'Jeep', peugeot: 'Peugeot',
  citroen: 'Citroen', 'citroën': 'Citroen', mitsubishi: 'Mitsubishi', kia: 'Kia',
  chery: 'Chery', 'caoa chery': 'Chery', byd: 'BYD', gwm: 'GWM', bmw: 'BMW',
  mercedes: 'Mercedes-Benz', 'mercedes-benz': 'Mercedes-Benz', audi: 'Audi',
  'land rover': 'Land Rover', suzuki: 'Suzuki', ram: 'RAM', volvo: 'Volvo', jac: 'JAC', lifan: 'Lifan'
}

const UFS = 'AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO'

const OPCIONAIS = [
  ['ar condicionado', /\bar[\s-]*(condicionado|cond\.?|digital)?\b(?![a-z])|\bar\b/i],
  ['direção hidráulica/elétrica', /dire[cç][aã]o\s*(hidr|el[eé]t|assist)|\bdh\b/i],
  ['vidros elétricos', /vidros?\s*el[eé]t|\bvte?\b/i],
  ['travas elétricas', /travas?\s*el[eé]t|\bvte\b/i],
  ['multimídia', /multim[ií]dia|central\s*multi|android\s*auto|carplay/i],
  ['bancos de couro', /\bcouro\b/i],
  ['teto solar', /teto\s*(solar|panor)/i],
  ['câmera de ré', /c[aâ]mera\s*(de\s*)?r[eé]/i],
  ['sensor de estacionamento', /sensor(es)?\s*(de\s*)?(estac|r[eé]|park)/i],
  ['rodas de liga', /rodas?\s*(de\s*)?liga|\baro\s*\d{2}/i],
  ['piloto automático', /piloto\s*autom|controle\s*de\s*cruzeiro/i],
  ['alarme', /\balarme\b/i],
  ['airbag', /air\s*bags?/i],
  ['freio ABS', /\babs\b/i],
  ['4x4', /\b4x4\b/i]
]

const SITUACAO = [
  ['aceita troca', /aceit[oa]\s*(troca|carro|moto)|pego\s*troca/i],
  ['financia', /financi/i],
  ['único dono', /[uú]nic[oa]\s*don[oa]/i],
  ['IPVA pago', /ipva\s*(\d{4}\s*)?(pago|quitado|ok)/i],
  ['quitado', /\bquitado\b/i],
  ['laudo cautelar aprovado', /laudo|cautelar/i],
  ['manual e chave reserva', /chave\s*reserva|manual\s*e\s*chave/i],
  ['revisado', /revisad[oa]|revis[oõ]es\s*(em\s*dia|na\s*concession)/i]
]

const ALERTAS = [
  ['leilão', /leil[aã]o/i],
  ['sinistro', /sinistr/i],
  ['recuperado de financeira', /recuperad[oa]\s*(de\s*)?financ/i],
  ['débitos', /d[eé]bito|multas?\s*(pendente|em aberto)|\bdetran\s*atrasad/i],
  ['sem documento', /sem\s*doc|documento\s*atrasad/i]
]

const CORES = { branco: 'Branco', branca: 'Branco', preto: 'Preto', preta: 'Preto', prata: 'Prata', cinza: 'Cinza', vermelho: 'Vermelho', vermelha: 'Vermelho', azul: 'Azul', verde: 'Verde', amarelo: 'Amarelo', amarela: 'Amarelo', bege: 'Bege', marrom: 'Marrom', dourado: 'Dourado', dourada: 'Dourado', laranja: 'Laranja', vinho: 'Vinho', grafite: 'Grafite', champagne: 'Champagne' }

const PROCURA = /\b(procuro|procurando|compro|quero comprar|algu[eé]m (tem|vende|teria)|preciso de um|busco)\b/i
const GATILHOS = /\b(repasse|vendo|vende-se|a venda|à venda|oportunidade|abaixo da fipe|baixou|queima|aceito proposta|valor)\b/i

const RE_FONE = /(?:\+?55[\s.-]*)?\(?\b\d{2}\)?[\s.-]*9?[\s.-]*\d{4}[\s.-]?\d{4}\b/g
const RE_LINK = /\b(?:https?:\/\/|www\.|wa\.me\/|chat\.whatsapp\.com\/)\S+/gi
const RE_PLACA = /\b[A-Z]{3}[-\s]?\d[A-Z0-9]\d{2}\b/g
const RE_EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]/gu

function semAcento (s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function escapeRe (s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// "98.900", "98900", "98 mil", "98k", "98,9 mil", "R$ 98.900,00"
export function lerValor (txt) {
  if (!txt) return null
  const t = txt.toLowerCase().replace(/r\$\s*/, '').trim()
  let m = t.match(/^(\d{1,3}(?:[.,]\d{1,3})?)\s*(mil|k)\b/)
  if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * 1000)
  m = t.match(/^(\d{1,3}(?:\.\d{3})+)(?:,\d{2})?/)
  if (m) return parseInt(m[1].replace(/\./g, ''), 10)
  m = t.match(/^(\d{4,7})(?:[.,]\d{2})?\b/)
  if (m) return parseInt(m[1], 10)
  return null
}

function linhas (texto) {
  return texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
}

function acharModelo (texto) {
  const baixo = semAcento(texto.toLowerCase())
  let melhor = null
  for (const [marca, modelos] of Object.entries(MODELOS)) {
    for (const mod of modelos) {
      const re = new RegExp(`(^|[^a-z0-9])${escapeRe(semAcento(mod))}(?![a-z0-9])`, 'i')
      const m = baixo.match(re)
      if (m) {
        const pos = m.index + m[1].length
        // modelos mais longos (ex.: "onix plus") vencem os curtos; depois o que aparece primeiro
        if (!melhor || mod.length > melhor.mod.length || (mod.length === melhor.mod.length && pos < melhor.pos)) {
          melhor = { marca, mod, pos }
        }
      }
    }
  }
  return melhor
}

function acharMarca (texto) {
  const baixo = semAcento(texto.toLowerCase())
  for (const [alias, marca] of Object.entries(ALIAS_MARCA)) {
    if (new RegExp(`(^|[^a-z])${escapeRe(semAcento(alias))}(?![a-z])`).test(baixo)) return marca
  }
  return null
}

function acharAno (texto) {
  const semFones = texto.replace(RE_FONE, ' ')
  let m = semFones.match(/\b((?:19[89]|20[0-3])\d)\s*[/\\-]\s*((?:19[89]|20[0-3])\d|\d{2})\b/)
  if (m) {
    const fab = parseInt(m[1], 10)
    let mod = parseInt(m[2], 10)
    if (mod < 100) mod += Math.floor(fab / 100) * 100
    if (mod >= fab && mod - fab <= 1) return { fab, mod, txt: `${fab}/${mod}` }
  }
  m = semFones.match(/\b(\d{2})\s*\/\s*(\d{2})\b(?!\s*\/)/)
  if (m) {
    const a = parseInt(m[1], 10); const b = parseInt(m[2], 10)
    const ok = (x) => x >= 80 || x <= 35
    if (ok(a) && ok(b) && (b - a === 0 || b - a === 1)) {
      const fab = a >= 80 ? 1900 + a : 2000 + a
      return { fab, mod: fab + (b - a), txt: `${fab}/${fab + (b - a)}` }
    }
  }
  m = semFones.match(/\bano\s*:?\s*((?:19[89]|20[0-3])\d)\b/i) ||
      semFones.match(/(?<![\d.,])((?:19[89]|20[0-3])\d)(?![\d.,]|\s*(mil|km|k\b))/i)
  if (m) {
    const a = parseInt(m[1], 10)
    return { fab: a, mod: a, txt: String(a) }
  }
  return null
}

function acharKm (texto) {
  const t = texto.replace(RE_FONE, ' ')
  // "KM 42.000" (rótulo antes) tem prioridade; depois "42.000 km" — sempre na mesma linha
  let m = t.match(/\b(?:km|quilometragem|rodado|rodou)[ \t]*[:=.]?[ \t]*(\d{1,3}(?:[. ]\d{3})+|\d{1,3}(?:[.,]\d)?[ \t]*mil|\d{1,6})(?![\d/])/i)
  if (!m) m = t.match(/(\d{1,3}(?:[. ]\d{3})+|\d{1,3}(?:[.,]\d)?[ \t]*mil|\d{1,6})[ \t]*(?:mil[ \t]*)?(?:km|quil[oô]metros|rodados?)\b/i)
  if (!m) return null
  const bruto = m[1].toLowerCase()
  let n
  if (/mil/.test(bruto) || /mil\s*km/i.test(m[0])) n = Math.round(parseFloat(bruto.replace(/mil/, '').replace(',', '.').trim()) * 1000)
  else n = parseInt(bruto.replace(/[.\s]/g, ''), 10)
  if (/\d{1,3}\s*mil\s*km/i.test(m[0]) && n < 1000) n *= 1000
  return Number.isFinite(n) ? n : null
}

function acharPrecos (texto) {
  const ls = linhas(texto.replace(RE_FONE, ' '))
  let fipe = null; let preco = null
  const reNum = /(r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d{1,3}(?:[.,]\d{1,3})?\s*(?:mil|k)\b|\d{4,7}(?:,\d{2})?)/gi
  for (const l of ls) {
    const baixo = l.toLowerCase()
    let l2 = l
    const iFipe = baixo.search(/fipe/)
    if (iFipe >= 0) {
      const depois = [...l.slice(iFipe).matchAll(reNum)].map(x => lerValor(x[0])).filter(v => v && v >= 3000)
      if (depois.length) fipe = depois[0]
      l2 = l.slice(0, iFipe)
      if (!l2.trim()) continue
    }
    const candidatos = [...l2.matchAll(reNum)]
      .filter(x => !/^(19[89]|20[0-3])\d$/.test(x[2].trim()))
      .filter(x => !/^\s*(mil\s*)?(km|quil|rod)/i.test(l2.slice(x.index + x[0].length, x.index + x[0].length + 8)))
      .map(x => {
        const antes = l2.slice(Math.max(0, x.index - 16), x.index).toLowerCase()
        return { v: lerValor(x[0]), forte: !!x[1] || /(valor|pre[cç]o|repasse|por|vendo|r\$)\s*:?\s*$/.test(antes), km: !x[1] && /(km|rodad\w*|quilometragem)[ \t]*[:=.]?[ \t]*$/i.test(antes) }
      })
      .filter(x => !x.km)
      .filter(x => x.v && x.v >= 3000 && x.v <= 5000000)
    for (const c of candidatos) {
      if (!preco || (c.forte && !preco.forte)) preco = c
    }
  }
  return { preco: preco ? preco.v : null, fipe }
}

function acharCidade (texto) {
  const reUf = new RegExp(`([A-ZÀ-Ú][A-Za-zÀ-ú'.]+(?:[ \\t]+(?:d[aeo]s?[ \\t]+)?[A-ZÀ-Ú][A-Za-zÀ-ú'.]+){0,3})[ \\t]*[-/–,][ \\t]*(${UFS})\\b`)
  const m = texto.match(reUf)
  if (m) return `${m[1].trim()}-${m[2]}`
  const m2 = texto.match(/(?:cidade|local|localiza[cç][aã]o|📍)\s*:?\s*([^\n]{3,40})/i)
  if (m2) return m2[1].replace(RE_EMOJI, '').trim()
  return null
}

function primeiroQue (texto, pares) {
  return pares.filter(([, re]) => re.test(texto)).map(([nome]) => nome)
}

function acharVersao (texto, modelo) {
  if (!modelo) return null
  const ls = linhas(texto)
  const re = new RegExp(`(^|[^a-z0-9])${escapeRe(semAcento(modelo))}(?![a-z0-9])`, 'i')
  const linha = ls.find(l => re.test(semAcento(l)))
  if (!linha) return null
  const limpa = semAcento(linha)
  const m = limpa.match(re)
  let resto = linha.slice(m.index + m[0].length)
  resto = resto
    .replace(RE_EMOJI, ' ')
    .replace(/\b(19[89]|20[0-3])\d\s*([/-]\s*\d{2,4})?/g, ' ')
    .replace(/\b\d{2}\s*\/\s*\d{2}\b/g, ' ')
    .replace(/\b\d[\d.]*\s*(mil\s*)?km\b/gi, ' ')
    .replace(new RegExp(`\\b(${Object.keys(CORES).join('|')}|flex|gasolina|diesel|etanol|manual|autom[aá]tico)\\b`, 'gi'), ' ')
    .replace(/r\$.*$/i, ' ')
    .replace(/\b\d{1,3}(\.\d{3})+.*$/, ' ')
    .replace(/[*_~|]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return resto ? resto.slice(0, 40).trim() : null
}

function titulo (s) {
  return s.replace(/\S+/g, p => {
    if (/^[\d.,]+$|^[a-z]{1,3}\d|\d[a-z]/i.test(p)) return p.toUpperCase()
    if (/^[A-Z]{2,4}$/.test(p) && !/^(DE|DA|DO|E)$/.test(p)) return p // siglas: LT, EXL, SRX
    return p[0].toUpperCase() + p.slice(1).toLowerCase()
  })
}

// Texto original sem telefones, links, placas e menções (para usar como {descricao_limpa})
export function limparTexto (texto, opts = {}) {
  let t = texto
  if (opts.removerTelefones !== false) t = t.replace(RE_FONE, '')
  if (opts.removerLinks !== false) t = t.replace(RE_LINK, '')
  if (opts.removerPlaca) t = t.replace(RE_PLACA, '')
  if (opts.removerMencoes !== false) t = t.replace(/@\d{6,}/g, '')
  if (opts.removerEmojis) t = t.replace(RE_EMOJI, '')
  for (const termo of (opts.removerTermos || [])) {
    if (termo.trim()) t = t.replace(new RegExp(escapeRe(termo.trim()), 'gi'), '')
  }
  // remove linhas que ficaram só com rótulo de contato
  t = t.split('\n').filter(l => !/^\s*[\p{P}\p{S}\s]*(chama|chamar|contato|whats|zap|fone|tel|ligar|falar com)[\s\p{P}\p{S}]*(no|com|pv|privado)?[\s\p{P}\p{S}]*$/iu.test(l)).join('\n')
  return t.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

export function parseAnuncio (texto, extra = {}) {
  const original = (texto || '').trim()
  const modelo = acharModelo(original)
  const marca = modelo ? modelo.marca : acharMarca(original)
  const ano = acharAno(original)
  const km = acharKm(original)
  const { preco, fipe } = acharPrecos(original)
  const baixo = original.toLowerCase()
  const cambio = /autom[aá]tic|\bcvt\b|tiptronic|\bdsg\b/i.test(baixo) ? 'Automático'
    : /automatizad|dualogic|i-?motion|easytronic/i.test(baixo) ? 'Automatizado'
      : /manual|mec[aâ]nic/i.test(baixo) ? 'Manual' : null
  const combustivel = /h[ií]brid/i.test(baixo) ? 'Híbrido'
    : /el[eé]tric[oa]\b(?!s)/i.test(baixo) && !/vidros?\s*el|travas?\s*el|dire[cç][aã]o\s*el/i.test(baixo) ? 'Elétrico'
      : /diesel/i.test(baixo) ? 'Diesel'
        : /flex|total\s*flex/i.test(baixo) ? 'Flex'
          : /gasolina/i.test(baixo) ? 'Gasolina'
            : /etanol|[aá]lcool/i.test(baixo) ? 'Etanol' : null
  const motor = (original.match(/\b([1-6][.,]\d)\s*(?:(turbo|tsi|tfsi|t200|t270|16v|8v|v6|v8))?\b/i) || [])[0]?.trim() || null
  const corAchada = Object.keys(CORES).find(c => new RegExp(`\\b${c}\\b`, 'i').test(semAcento(baixo)))
  const telefones = [...new Set((original.match(RE_FONE) || []).map(f => f.replace(/\D/g, '')))]
  const placa = (original.match(RE_PLACA) || [])[0] || null
  const opcionais = primeiroQue(original, OPCIONAIS)
  const situacao = primeiroQue(original, SITUACAO)
  const alertas = primeiroQue(original, ALERTAS)
  const ehProcura = PROCURA.test(original)

  // Pontuação de "parece anúncio de veículo"
  let pontos = 0
  const motivos = []
  if (preco) { pontos += 3; motivos.push('preço') }
  if (ano) { pontos += 3; motivos.push('ano') }
  if (km !== null) { pontos += 2; motivos.push('km') }
  if (modelo) { pontos += 2; motivos.push('modelo') } else if (marca) { pontos += 1; motivos.push('marca') }
  if (cambio || combustivel) { pontos += 1; motivos.push('câmbio/combustível') }
  if (extra.temMidia) { pontos += 1; motivos.push('foto') }
  if (GATILHOS.test(original)) { pontos += 1; motivos.push('palavra de venda') }
  if (fipe) { pontos += 1; motivos.push('FIPE') }
  if (ehProcura) { pontos -= 6; motivos.push('parece PROCURA/COMPRA') }
  if (original.length < 15) pontos -= 3

  const nomeModelo = modelo ? titulo(modelo.mod) : null
  const versao = acharVersao(original, modelo ? modelo.mod : null)

  return {
    marca,
    modelo: nomeModelo,
    versao: versao ? titulo(versao) : null,
    motor,
    ano: ano ? ano.txt : null,
    anoModelo: ano ? ano.mod : null,
    km,
    preco,
    fipe,
    abaixoFipe: preco && fipe && fipe > preco ? fipe - preco : null,
    cambio,
    combustivel,
    cor: corAchada ? CORES[corAchada] : null,
    cidade: acharCidade(original),
    opcionais,
    situacao,
    alertas,
    placa,
    telefones,
    ehProcura,
    pontos,
    motivos,
    textoOriginal: original
  }
}
