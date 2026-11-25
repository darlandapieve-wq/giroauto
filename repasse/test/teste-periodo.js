// Teste: guardar mensagens, agrupar foto+texto e gerar a fila de "hoje": node test/teste-periodo.js
import assert from 'node:assert/strict'
import fs from 'node:fs'
process.env.DATA_DIR = '/tmp/gr-teste-periodo'; fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true })
const { q, um, todos } = await import('../src/db.js')
const { carregarConfig, atualizarConfig } = await import('../src/config.js')
const P = await import('../src/pipeline.js')
const { EXEMPLOS } = await import('../src/exemplos.js')
const sharp = (await import('sharp')).default
;(await import('../src/contexto.js')).entrarConta(1)
await carregarConfig()
await atualizarConfig({ ia: { modo: 'desligado' }, fipe: { consultar: false } })
const foto = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#933' } }).jpeg().toBuffer()
P.usarWhatsAppDeTeste({ conectado: () => true, baixarBruto: async () => foto, baixarMidia: async () => foto, baixarFotos: async () => [foto], buscarHistorico: async () => {} })

const G = 'fonte@g.us'
await P.garantirGrupo(G, 'Fonte teste')
await q('UPDATE repasse.grupos SET arquivado = false, fonte = true WHERE jid = $1', [G])
await P.garantirGrupo('arq@g.us', 'Arquivado')
await P.recarregarGrupos()
const base = Date.now() - 3600e3
let n = 0
const msg = (rem, texto, img, dt) => P.receberMensagem({ chatJid: G, remetente: { id: rem, nome: rem }, texto, midia: img ? {} : null, id: 'm' + (++n), ts: base + dt * 1000, bruto: img ? '{"x":1}' : '{"key":{}}', historico: true })
// anunciante A: 3 fotos e depois o texto; anunciante B: texto com foto (legenda) e outra foto; A de novo 10 min depois com outro carro
await msg('A', null, true, 0); await msg('A', null, true, 2); await msg('A', null, true, 4); await msg('A', EXEMPLOS[0], false, 6)
await msg('B', EXEMPLOS[1], true, 10); await msg('B', null, true, 12)
await msg('A', EXEMPLOS[2], true, 600)
await msg('A', 'bom dia grupo', false, 900)
await P.receberMensagem({ chatJid: 'arq@g.us', remetente: { id: 'C' }, texto: EXEMPLOS[5], id: 'x1', ts: base, historico: true })
assert.equal((await um('SELECT count(*)::int n FROM repasse.mensagens')).n, 8, 'só guarda mensagens de conversas não arquivadas')

await P.gerarFilaDoPeriodo({ jids: [G], desde: base - 1000 })
const an = await todos('SELECT a.modelo, a.status, (SELECT count(*)::int FROM repasse.fotos f WHERE f.anuncio_id = a.id) fotos FROM repasse.anuncios a ORDER BY modelo')
console.log(an)
assert.deepEqual(an.filter(a => a.status === 'pendente').map(a => [a.modelo, a.fotos]), [['Civic', 3], ['Onix', 2], ['Strada', 1]])
assert.equal(P.estadoLote().criados, 3)
assert.equal((await um('SELECT count(*)::int n FROM repasse.mensagens WHERE NOT processado')).n, 0, 'tudo marcado como processado')
// rodar de novo não duplica
await P.gerarFilaDoPeriodo({ jids: [G], desde: base - 1000 })
assert.equal((await um(`SELECT count(*)::int n FROM repasse.anuncios WHERE status = 'pendente'`)).n, 3)
// mesmo veículo repostado (km arredondado diferente, outro anunciante, preço menor) -> fica só o mais barato
const onix = (km, preco) => `SEM RETOQUE\nCHEVROLET\n*ÔNIX RS 1.0 TURBO AUTOMÁTICO*\nANO 2025\n${km} MIL KM\nVALOR ${preco}`
const r1 = await P.montarAnuncio({ texto: onix(23, '77.600'), origem: { grupoNome: 'X', remetenteId: 'A' } })
const r2 = await P.montarAnuncio({ texto: onix(24, '75.990'), origem: { grupoNome: 'Y', remetenteId: 'B' } })
const r3 = await P.montarAnuncio({ texto: onix(23, '79.000'), origem: { grupoNome: 'Z', remetenteId: 'C' } })
assert.ok(r2.id && !r2.repetidoDe, 'mais barato substitui')
assert.equal((await um('SELECT status FROM repasse.anuncios WHERE id = $1', [r1.id])).status, 'descartado')
assert.equal(r3.repetidoDe, r2.id, 'mais caro vira repetido')
assert.equal((await um(`SELECT count(*)::int n FROM repasse.anuncios WHERE status = 'pendente' AND modelo = 'Onix' AND ano_modelo = 2025`)).n, 1)
assert.ok(!P.mesmoVeiculo({ modelo: 'S10', anoModelo: 2023, km: 158000 }, { modelo: 'S10', anoModelo: 2023, km: 170000 }), 'km bem diferente = outro carro')
// código GA só na aprovação, em sequência
const semCod = await um('SELECT codigo, numero_fila FROM repasse.anuncios WHERE id = $1', [r2.id])
assert.equal(semCod.codigo, null, 'pendente sem código GA'); assert.ok(semCod.numero_fila > 0, 'tem número de fila')
await P.aprovarAnuncio(r2.id)
const ap = await um('SELECT codigo, status, texto FROM repasse.anuncios WHERE id = $1', [r2.id])
assert.equal(ap.status, 'aprovado'); assert.match(ap.codigo, /^GA-0001$/); assert.ok(ap.texto.includes('GA-0001'), 'código no texto')
await P.gravarEstatisticas()
const st = await um("SELECT mensagens, anuncios FROM repasse.grupos WHERE jid = 'fonte@g.us'")
assert.ok(st.mensagens >= 8 && st.anuncios >= 3, 'estatísticas gravadas em lote')
console.log('✓ período: mensagens guardadas, fotos agrupadas, fila gerada sem duplicar, mesmo veículo mantém o menor valor')
process.exit(0)
