// Recorte de prints com várias fotos: node test/teste-recorte.js
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { recortarFotos } from '../src/recorte.js'

// "foto" com textura (ruído) 800x600
const ruido = (w, h, seed) => {
  const b = Buffer.alloc(w * h * 3)
  let s = seed
  for (let i = 0; i < b.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; b[i] = 40 + (s >> 16) % 180 }
  return sharp(b, { raw: { width: w, height: h, channels: 3 } }).jpeg().toBuffer()
}
const foto = await ruido(800, 600, 7)
const so = await recortarFotos(foto)
assert.equal(so.length, 1); assert.equal(so[0], foto, 'foto comum fica intacta')

// print de celular: barra branca, 2 fotos separadas por faixa branca, rodapé
const print = await sharp({ create: { width: 800, height: 1700, channels: 3, background: '#ffffff' } })
  .composite([{ input: await ruido(800, 600, 1), left: 0, top: 120 }, { input: await ruido(800, 600, 2), left: 0, top: 800 }]).jpeg().toBuffer()
const partes = await recortarFotos(print)
assert.equal(partes.length, 2, 'separa as duas fotos')
for (const p of partes) { const m = await sharp(p).metadata(); assert.ok(m.width >= 780 && m.height >= 440 && m.height <= 600, `tamanho ${m.width}x${m.height}`) }

// foto com tarjas pretas laterais
const tarja = await sharp({ create: { width: 1000, height: 600, channels: 3, background: '#000' } })
  .composite([{ input: await ruido(700, 600, 3), left: 150, top: 0 }]).jpeg().toBuffer()
const [semTarja] = await recortarFotos(tarja)
const mt = await sharp(semTarja).metadata()
assert.ok(mt.width <= 720 && mt.width >= 680, 'tira tarjas pretas: ' + mt.width)
console.log('✓ recorte: print separado em fotos, tarjas removidas, foto comum intacta')
