// Placa borrada: IA (simulada) localiza a placa, a região é borrada e a versão pública é usada no envio
// node test/teste-placa.js
import assert from 'node:assert/strict'
import fs from 'node:fs'
process.env.DATA_DIR = '/tmp/gr-teste-placa'; fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true })
process.env.ANTHROPIC_API_KEY = 'teste'
const sharp = (await import('sharp')).default
const { q, um } = await import('../src/db.js')
;(await import('../src/contexto.js')).entrarConta(1)
const { carregarConfig, atualizarConfig } = await import('../src/config.js')
const P = await import('../src/pipeline.js')
const PL = await import('../src/placa.js')
const { fotoCapa, salvarFotos } = await import('../src/fotos.js')
const { EXEMPLOS } = await import('../src/exemplos.js')
await carregarConfig()
await atualizarConfig({ ia: { modo: 'desligado' }, fipe: { consultar: false } })

// foto 1280x960 com "placa" branca com listras pretas em (600,700)-(800,760)
const placa = await sharp({ create: { width: 200, height: 60, channels: 3, background: '#fff' } })
  .composite([0, 40, 80, 120, 160].map(x => ({ input: { create: { width: 14, height: 40, channels: 3, background: '#000' } }, left: x + 10, top: 10 }))).png().toBuffer()
const ruido = (w, h, seed) => { const b = Buffer.alloc(w * h * 3); let x = seed; for (let i = 0; i < b.length; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; b[i] = 60 + (x >> 16) % 120 } return sharp(b, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer() }
const foto = await sharp(await ruido(1280, 960, 3)).composite([{ input: placa, left: 540, top: 450 }]).jpeg().toBuffer()
const semPlaca = await sharp(await ruido(800, 600, 9)).jpeg().toBuffer()

let pedido
globalThis.fetch = async (url, op) => {
  pedido = JSON.parse(op.body)
  // IA "vê" a imagem reduzida (768 de lado): placa em 324,270 – 444,306
  return { ok: true, json: async () => ({ content: [{ type: 'tool_use', name: 'placas', input: { imagens: [{ imagem: 1, placas: [{ x1: 324, y1: 270, x2: 444, y2: 306 }] }, { imagem: 2, placas: [] }] } }] }) }
}
const a = await P.montarAnuncio({ texto: EXEMPLOS[0], origem: { grupoNome: 'X', remetenteId: 'r' } })
await salvarFotos(a.id, [foto, semPlaca])
await PL.prepararFotosPublicas(a.id)
assert.equal(pedido.messages[0].content.filter(c => c.type === 'image').length, 2, 'duas fotos num pedido')
const fs2 = await (await import('../src/db.js')).todos('SELECT placa_status, dados, dados_publico FROM repasse.fotos WHERE anuncio_id = $1 ORDER BY ordem', [a.id])
assert.deepEqual(fs2.map(f => f.placa_status), ['borrada', 'sem-placa'])
assert.equal(fs2[1].dados_publico, null)
// a região da placa ficou uniforme (sem as listras) e o resto da foto igual
// a foto é guardada com no máximo 1080 px de lado: converte a posição da placa para essa escala
const k = 1080 / 1280
const reg = async (b) => sharp(await sharp(Buffer.from(b)).extract({ left: Math.round(540 * k), top: Math.round(450 * k), width: Math.round(200 * k), height: Math.round(60 * k) }).toBuffer()).stats()
const antes = await reg(fs2[0].dados); const depois = await reg(fs2[0].dados_publico)
assert.ok(depois.channels[0].stdev < antes.channels[0].stdev / 3, `placa borrada (desvio ${antes.channels[0].stdev.toFixed(0)} → ${depois.channels[0].stdev.toFixed(0)})`)
const canto = async (b) => (await sharp(await sharp(Buffer.from(b)).extract({ left: 10, top: 10, width: 100, height: 100 }).toBuffer()).stats()).channels[2].mean
assert.ok(Math.abs(await canto(fs2[0].dados) - await canto(fs2[0].dados_publico)) < 6, 'resto da foto igual')
// envio usa a versão pública
const capa = await fotoCapa(a.id)
assert.ok((await reg(capa)).channels[0].stdev < antes.channels[0].stdev / 3, 'capa enviada é a borrada')
// não reprocessa
pedido = null; await PL.prepararFotosPublicas(a.id); assert.equal(pedido, null)
// fila: só a capa dos pendentes é verificada (as demais na aprovação)
const b = await P.montarAnuncio({ texto: EXEMPLOS[1], origem: { grupoNome: 'X', remetenteId: 'r2' } })
await salvarFotos(b.id, [foto, semPlaca])
pedido = null
await PL.prepararCapasDaFila()
assert.equal(pedido.messages[0].content.filter(c => c.type === 'image').length, 1, 'só a capa do pendente')
const fb = await (await import('../src/db.js')).todos('SELECT placa_status FROM repasse.fotos WHERE anuncio_id = $1 ORDER BY ordem', [b.id])
assert.deepEqual(fb.map(f => f.placa_status), ['borrada', null])
pedido = null; await PL.prepararCapasDaFila(); assert.equal(pedido, null, 'não repete')
console.log('✓ placa: localizada pela IA, borrada com folga, versão pública usada no envio')
process.exit(0)
