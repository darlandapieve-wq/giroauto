// Recorte automático de fotos: separa prints com várias fotos empilhadas (galeria/conversa do WhatsApp)
// e remove barras, bordas brancas/pretas, separadores e as marcas de hora sobre a foto.
import sharp from 'sharp'

const LARG = 200 // largura da análise (imagem reduzida, rápido)

// Uma linha (ou coluna) é "interface" quando quase toda ela tem a mesma cor clara ou escura
function ehInterface (valores, borda = false) {
  const hist = new Map()
  for (const v of valores) { const b = v >> 3; hist.set(b, (hist.get(b) || 0) + 1) }
  let melhor = 0; let cor = 0
  for (const [b, n] of hist) {
    const viz = n + (hist.get(b - 1) || 0) + (hist.get(b + 1) || 0)
    if (viz > melhor) { melhor = viz; cor = b << 3 }
  }
  const unif = melhor / valores.length
  const extremo = cor >= 216 || cor <= 32
  // perto do topo/rodapé (barra de status/navegação do celular) aceita qualquer cinza bem uniforme
  return (unif >= 0.82 && extremo) || (borda && unif >= 0.93)
}

// trechos consecutivos de "foto" (não interface) com tamanho mínimo
function trechos (marcas, minimo) {
  const out = []; let ini = null
  for (let i = 0; i <= marcas.length; i++) {
    const foto = i < marcas.length && !marcas[i]
    if (foto && ini === null) ini = i
    if (!foto && ini !== null) { if (i - ini >= minimo) out.push([ini, i]); ini = null }
  }
  return out
}

export async function recortarFotos (buf) {
  const base = sharp(buf).rotate()
  const meta = await base.metadata()
  const W = meta.autoOrient?.width || meta.width
  const H = meta.autoOrient?.height || meta.height
  if (!W || !H) return [buf]
  const esc = LARG / W
  const h = Math.max(1, Math.round(H * esc))
  const { data } = await sharp(buf).rotate().resize(LARG, h, { fit: 'fill' }).grayscale().raw().toBuffer({ resolveWithObject: true })
  const px = (x, y) => data[y * LARG + x]

  // linhas de interface
  const linhas = []
  for (let y = 0; y < h; y++) {
    const row = new Array(LARG); for (let x = 0; x < LARG; x++) row[x] = px(x, y)
    linhas.push(ehInterface(row, y < h * 0.1 || y > h * 0.9))
  }
  let paineis = trechos(linhas, Math.max(6, Math.round(h * 0.12)))
  if (!paineis.length) return [buf]

  const interfaceTotal = linhas.filter(Boolean).length / h
  const telaCelular = H / W > 1.55
  const ehPrint = paineis.length >= 2 || (telaCelular && interfaceTotal > 0.03)

  const saidas = []
  for (let [y0, y1] of paineis) {
    // colunas de interface dentro do painel (bordas laterais)
    const cols = []
    for (let x = 0; x < LARG; x++) {
      const col = []; for (let y = y0; y < y1; y++) col.push(px(x, y))
      cols.push(ehInterface(col))
    }
    const tc = trechos(cols, Math.round(LARG * 0.3))
    const [x0, x1] = tc.length ? tc.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a)) : [0, LARG]

    let top = y0 / esc; let bot = y1 / esc
    const alt = bot - top
    if (ehPrint) {
      bot -= alt * 0.11 // hora e ✓✓ sobre o canto inferior da foto
      if (telaCelular && y0 / h < 0.12) top += alt * 0.13 // cabeçalho "Você · 17 fotos" sobre a primeira foto
    }
    const left = Math.round(x0 / esc); const right = Math.round(x1 / esc)
    const caixa = {
      left: Math.max(0, left + 2), top: Math.max(0, Math.round(top) + 2),
      width: Math.min(W, right) - Math.max(0, left + 2) - 2,
      height: Math.min(H, Math.round(bot)) - Math.max(0, Math.round(top) + 2) - 2
    }
    if (caixa.width < 200 || caixa.height < 150) continue
    // sem nada a recortar: devolve a original
    if (!ehPrint && caixa.width > W * 0.97 && caixa.height > H * 0.97) return [buf]
    saidas.push(await sharp(buf).rotate().extract(caixa).jpeg({ quality: 90 }).toBuffer())
  }
  return saidas.length ? saidas : [buf]
}
