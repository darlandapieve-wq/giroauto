// Assistente de atendimento: vitrine (roteiro e IA simulada), WhatsApp simulado, alimentar anúncio pelo código, pausa
// node test/teste-assistente.js
import assert from 'node:assert/strict'
import fs from 'node:fs'
process.env.DATA_DIR = '/tmp/gr-teste-assis'; fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true })
delete process.env.ANTHROPIC_API_KEY
const { q, um, todos } = await import('../src/db.js')
;(await import('../src/contexto.js')).entrarConta(1)
const { carregarConfig, atualizarConfig } = await import('../src/config.js')
const P = await import('../src/pipeline.js')
const A = await import('../src/assistente.js')
const W = await import('../src/atendimento.js')
const { EXEMPLOS } = await import('../src/exemplos.js')
const sharp = (await import('sharp')).default
await carregarConfig()
await atualizarConfig({ ia: { modo: 'desligado' }, fipe: { consultar: false }, assistente: { whatsapp: true, numeroAtendimento: '45 3333-0000', numerosAdmin: ['45 99999-0001'], fotosPorPedido: 2 } })
const foto = (cor) => sharp({ create: { width: 640, height: 480, channels: 3, background: cor } }).jpeg().toBuffer()

const a1 = await P.montarAnuncio({ texto: EXEMPLOS[2], fotos: [await foto('#336'), await foto('#633')], origem: { grupoNome: 'X', remetenteId: 'r1' } })
await P.aprovarAnuncio(a1.id)
await q(`UPDATE repasse.anuncios SET status = 'circulando' WHERE id = $1`, [a1.id])
const { codigo } = await um('SELECT codigo FROM repasse.anuncios WHERE id = $1', [a1.id])
assert.deepEqual(A.codigosNoTexto(`quero o ${codigo.toLowerCase()} e o ga 7`), [codigo, 'GA-0007'])

// vitrine sem IA (roteiro)
let r = await A.conversar({ codigo, ip: '1.1.1.1', base: '/vitrine' })
assert.ok(r.mensagens[0].texto.includes(codigo), 'saudação cita o veículo da página')
const sid = r.sid
r = await A.conversar({ sid, texto: 'manda mais fotos', codigo, ip: '1.1.1.1' })
assert.equal(r.fotosDe?.codigo, codigo); assert.ok(r.mensagens[0].veiculos[0].fotos.length >= 2, 'fotos no chat')
r = await A.conversar({ sid, texto: 'Carlos', codigo, ip: '1.1.1.1' })
r = await A.conversar({ sid, texto: '45 99888-7777', codigo, ip: '1.1.1.1' })
const lead = await um('SELECT * FROM repasse.leads WHERE conversa_id = $1', [sid])
assert.equal(lead.telefone, '45998887777'); assert.equal(lead.codigo, codigo); assert.equal(lead.origem, 'assistente-vitrine')
r = await A.conversar({ sid, texto: 'quero fechar', codigo, ip: '1.1.1.1' })
assert.ok(r.chamarHumano && r.acoes.includes('humano'))

// IA simulada (Claude)
process.env.ANTHROPIC_API_KEY = 'teste'
let pedido = null
globalThis.fetch = async (url, op) => {
  pedido = JSON.parse(op.body)
  return { ok: true, json: async () => ({ content: [{ type: 'tool_use', name: 'responder', input: { resposta: 'É uma Strada 2022, sai por R$ 90 mil. Quer as fotos?', mostrar_codigos: [codigo, 'GA-9999'], fotos_de: null, lead: { nome: 'Ana', pagamento: 'avista', lojista: true }, temperatura: 'quente', chamar_humano: false } }] }) }
}
r = await A.conversar({ texto: 'tem picape?', ip: '2.2.2.2' })
assert.equal(pedido.tool_choice.name, 'responder'); assert.ok(pedido.system.includes(codigo), 'estoque no prompt'); assert.ok(!pedido.system.includes('agendar visita') || pedido.system.includes('NÃO agende'))
assert.equal(r.mensagens[0].veiculos.length, 1, 'só códigos existentes')
const conv = await um('SELECT dados FROM repasse.conversas WHERE id = $1', [r.sid])
assert.equal(conv.dados.pagamento, 'avista'); assert.equal(conv.dados.lojista, true)
delete process.env.ANTHROPIC_API_KEY

// WhatsApp simulado
const enviados = []
// trava: conectado num número que não é o de atendimento (ex.: pessoal) -> não responde
const pessoal = { contaId: 1, estado: { eu: { id: '5544999158307:5@s.whatsapp.net' } }, ctx: (fn) => fn(), enviar: async () => { throw new Error('não devia responder no número pessoal') } }
await W.mensagemDeCliente(pessoal, { chat: '5545911112222@s.whatsapp.net', numero: '5545911112222@s.whatsapp.net', texto: 'aceita carnê?', nome: 'X' })
await new Promise(res => setTimeout(res, 7000))
const cx = { contaId: 1, estado: { eu: { id: '554533330000:3@s.whatsapp.net' } }, ctx: (fn) => fn(), enviar: async (jid, texto, foto) => { enviados.push({ jid, texto, foto: !!foto }) }, baixarMidia: async () => foto('#090'), baixarFotos: async () => [await foto('#090')] }
const cli = '5545988887777@s.whatsapp.net'
await W.mensagemDeCliente(cx, { chat: cli, numero: cli, texto: `oi, tem fotos do ${codigo}?`, nome: 'João' })
await new Promise(res => setTimeout(res, 9000))
assert.ok(enviados.some(e => e.jid === cli && e.texto), 'respondeu o cliente')
assert.equal(enviados.filter(e => e.jid === cli && e.foto).length, 2, 'mandou as fotos (limite 2)')
// cliente quer fechar -> avisa o responsável e pausa
enviados.length = 0
await W.mensagemDeCliente(cx, { chat: cli, numero: cli, texto: 'quero fechar negócio', nome: 'João' })
await new Promise(res => setTimeout(res, 9000))
assert.ok(enviados.some(e => e.jid === '5545999990001@s.whatsapp.net' && e.texto.includes('Cliente quer falar')), 'avisou o responsável')
enviados.length = 0
await W.mensagemDeCliente(cx, { chat: cli, numero: cli, texto: 'oi?', nome: 'João' })
await new Promise(res => setTimeout(res, 9000))
assert.equal(enviados.length, 0, 'pausada: não responde')

// você alimentando o anúncio pelo código (texto + 2 fotos)
const antes = (await um('SELECT count(*)::int n FROM repasse.fotos WHERE anuncio_id = $1', [a1.id])).n
W.mensagemDoAdmin(cx, { chat: 'eu@s.whatsapp.net', texto: `${codigo} pneus novos, revisão em dia`, midia: {} })
W.mensagemDoAdmin(cx, { chat: 'eu@s.whatsapp.net', texto: '', midia: {} })
await new Promise(res => setTimeout(res, 10000))
const depois = await um('SELECT info_extra, (SELECT count(*)::int FROM repasse.fotos WHERE anuncio_id = $1) n FROM repasse.anuncios WHERE id = $1', [a1.id])
assert.equal(depois.n, antes + 2, 'fotos adicionadas'); assert.ok(depois.info_extra.includes('pneus novos') && !depois.info_extra.includes(codigo))
assert.ok(enviados.some(e => e.jid === 'eu@s.whatsapp.net' && e.texto.startsWith('✅')), 'confirmou')
// sem código depois: vale o último por 15 min
W.mensagemDoAdmin(cx, { chat: 'eu@s.whatsapp.net', texto: 'aceita troca', midia: null })
await new Promise(res => setTimeout(res, 9000))
assert.ok((await um('SELECT info_extra FROM repasse.anuncios WHERE id = $1', [a1.id])).info_extra.includes('aceita troca'))
assert.equal(W.numeroAdmin('5545999990001@s.whatsapp.net'), true); assert.equal(W.numeroAdmin(cli), false)

// limpeza de arquivados: descartado há 49 h some, vendido fica
const a2 = await P.montarAnuncio({ texto: EXEMPLOS[0], origem: { grupoNome: 'X', remetenteId: 'r2' } })
const a3 = await P.montarAnuncio({ texto: EXEMPLOS[1], origem: { grupoNome: 'X', remetenteId: 'r3' } })
await q(`UPDATE repasse.anuncios SET status = 'descartado', encerrado_em = now() - interval '49 hours' WHERE id = $1`, [a2.id])
await q(`UPDATE repasse.anuncios SET status = 'vendido', encerrado_em = now() - interval '90 days' WHERE id = $1`, [a3.id])
assert.ok(await P.excluirArquivados() >= 1)
assert.equal(await um('SELECT 1 x FROM repasse.anuncios WHERE id = $1', [a2.id]), null, 'arquivado excluído')
assert.ok(await um('SELECT 1 x FROM repasse.anuncios WHERE id = $1', [a3.id]), 'vendido permanece')

console.log('✓ assistente: vitrine, IA, WhatsApp (fotos, aviso, pausa), alimentar por código, limpeza de arquivados')
process.exit(0)
