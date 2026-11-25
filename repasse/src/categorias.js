// Classificação do veículo por tipo (para as regras de cada grupo destino)
export const CATEGORIAS = {
  hatch: 'Hatch', sedan: 'Sedã', suv: 'SUV', picape: 'Picape', utilitario: 'Utilitário/Van', minivan: 'Minivan', esportivo: 'Esportivo/Cupê'
}

const MAPA = {
  picape: ['strada', 'toro', 's10', 'montana', 'hilux', 'ranger', 'amarok', 'saveiro', 'frontier', 'l200', 'triton', 'l200 triton', 'oroch', 'duster oroch', 'maverick', 'rampage', 'titano', 'courier', 'f-250', 'f250', 'f-1000', 'silverado', 'shark', 'king', '1500', '2500', '3500', 'fiorino strada', 'bandeirante', 't40', 'poer'],
  suv: ['tracker', 'trailblazer', 'captiva', 'equinox', 'blazer', 't-cross', 'tcross', 'nivus', 'taos', 'tiguan', 'pulse', 'fastback', 'ecosport', 'edge', 'territory', 'bronco', 'corolla cross', 'sw4', 'hilux sw4', 'rav4', 'hr-v', 'hrv', 'wr-v', 'wrv', 'cr-v', 'crv', 'zr-v', 'creta', 'tucson', 'ix35', 'santa fe', 'duster', 'captur', 'kardian', 'kicks', 'renegade', 'compass', 'commander', 'wrangler', 'cherokee', '2008', '3008', 'c3 aircross', 'aircross', 'c4 cactus', 'basalt', 'pajero', 'pajero sport', 'pajero tr4', 'asx', 'outlander', 'eclipse cross', 'sportage', 'sorento', 'stonic', 'soul', 'tiggo', 'tiggo 2', 'tiggo 3x', 'tiggo 5x', 'tiggo 7', 'tiggo 8', 'song plus', 'song pro', 'yuan plus', 'haval', 'haval h6', 'x1', 'x3', 'x5', 'x6', 'gla', 'glc', 'q3', 'q5', 'q7', 'evoque', 'discovery', 'discovery sport', 'defender', 'freelander', 'jimny', 'vitara', 'grand vitara', 's-cross', 'xc40', 'xc60', 'xc90', 't50', 't60', 'x60', 'x80'],
  sedan: ['onix plus', 'prisma', 'cruze', 'cobalt', 'classic', 'vectra', 'omega', 'monza', 'voyage', 'virtus', 'jetta', 'santana', 'bora', 'passat', 'cronos', 'siena', 'grand siena', 'linea', 'tempra', 'marea', 'fusion', 'mondeo', 'corolla', 'etios sedan', 'camry', 'civic', 'city', 'accord', 'hb20s', 'elantra', 'azera', 'logan', 'fluence', 'symbol', 'versa', 'sentra', 'c4 lounge', 'lancer', 'cerato', 'arrizo', 'seal', '320i', '328i', 'classe c', 'c180', 'c200', 'c250', 'a4', '408'],
  utilitario: ['kombi', 'ducato', 'fiorino', 'master', 'sprinter', 'jumpy', 'expert', 'partner', 'bongo', 'hr', 'doblo', 'accelo'],
  minivan: ['spin', 'zafira', 'meriva', 'idea', 'livina', 'freemont', 'xsara picasso', 'scenic'],
  esportivo: ['camaro', 'veloster', 'a5', 'mustang', '911']
}
const PARA_CATEGORIA = Object.fromEntries(Object.entries(MAPA).flatMap(([c, ms]) => ms.map(m => [m, c])))

export function categorizar (dados, premiumCfg) {
  const mod = (dados.modelo || '').toLowerCase()
  let categoria = dados.categoria || PARA_CATEGORIA[mod] || (dados.modelo ? 'hatch' : null)
  if (/sedan|sed[aã]\b/i.test(dados.versao || '')) categoria = 'sedan'
  if (/cabine|cd\b|cs\b/i.test(dados.versao || '') && categoria !== 'utilitario') categoria = 'picape'
  const preco = dados.preco || 0
  const premium = !!(premiumCfg?.marcas?.includes(dados.marca) || (premiumCfg?.precoAcima && preco >= premiumCfg.precoAcima))
  return { categoria, premium }
}
