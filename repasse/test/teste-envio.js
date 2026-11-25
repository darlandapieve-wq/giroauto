// Teste do fluxo completo sem WhatsApp real: fila -> aprovação -> envio com regras -> repetição
// node test/teste-envio.js
import assert from 'node:assert/strict'
import fs from 'node:fs'
process.env.DATA_DIR = '/tmp/gr-teste-envio'
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true })
const { q, um, todos } = await import('../src/db.js')
const { carregarConfig, atualizarConfig } = await import('../src/config.js')
const P = await import('../src/pipeline.js')
const { EXEMPLOS } = await import('../src/exemplos.js')
const sharp = (await import('sharp')).default

;(await import('../src/contexto.js')).entrarConta(1)
await carregarConfig()
await atualizarConfig({ envio: { horarioInicio: '00:00', horarioFim: '23:59', intervaloMinSeg: 0, intervaloMaxSeg: 0 }, ia: { modo: 'desligado' }, fipe: { consultar: false }, repeticao: { padraoAtivo: true } })
const enviados = []
P.usarWhatsAppDeTeste({ conectado: () => true, enviar: async (jid, texto, foto) => { enviados.push({ jid, texto, foto: !!foto }) }, baixarMidia: async () => null, baixarFotos: async () => [null] })

for (const [jid, regras] of [['geral@g.us', {}], ['picapes@g.us', { categorias: ['picape'] }], ['premium@g.us', { premium: 'so', acrescimo: 3000 }]]) {
  await P.garantirGrupo(jid, jid.split('@')[0])
  await q('UPDATE repasse.grupos SET destino = true, regras = $2::jsonb WHERE jid = $1', [jid, JSON.stringify(regras)])
}
const foto = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#336' } }).jpeg().toBuffer()
const a1 = await P.montarAnuncio({ texto: EXEMPLOS[2], fotos: [foto, foto], origem: { grupoNome: 'X', remetenteId: 'r1' } }) // Strada (picape)
const a2 = await P.montarAnuncio({ texto: EXEMPLOS[5], fotos: [foto], origem: { grupoNome: 'X', remetenteId: 'r2' } }) // Hilux SW4 (premium)
const rep = await P.montarAnuncio({ texto: EXEMPLOS[2].replace('88.500', '89.500'), origem: { grupoNome: 'Y', remetenteId: 'r1' } })
assert.ok(rep.repetidoDe, 'anúncio repetido deve ser reconhecido')
assert.equal((await um('SELECT count(*)::int n FROM repasse.fotos WHERE anuncio_id = $1', [a1.id])).n, 2, 'banco de fotos')

await P.definirPrecoRepasse(a2.id, 225000)
await q(`UPDATE repasse.anuncios SET status = 'aprovado' WHERE id = ANY($1)`, [[a1.id, a2.id]])
P.iniciarAgendador()
const esperar = async (cond, s = 60) => { for (let i = 0; i < s * 2; i++) { if (await cond()) return; await new Promise(r => setTimeout(r, 500)) } throw new Error('tempo esgotado') }
await esperar(async () => (await um(`SELECT count(*)::int n FROM repasse.anuncios WHERE status = 'circulando'`)).n === 2)

const porJid = (j) => enviados.filter(e => e.jid === j)
assert.equal(porJid('geral@g.us').length, 2, 'geral recebe os dois')
assert.equal(porJid('picapes@g.us').length, 1, 'picapes recebe só a Strada')
assert.ok(porJid('picapes@g.us')[0].texto.includes('Strada'))
assert.equal(porJid('premium@g.us').length, 1, 'premium recebe só a Hilux')
assert.ok(porJid('premium@g.us')[0].texto.includes('R$ 228.000'), 'acréscimo do grupo premium aplicado')
assert.ok(porJid('geral@g.us').some(e => e.texto.includes('R$ 225.000')), 'novo valor de repasse aplicado')
assert.ok(enviados.every(e => e.foto), 'foto + texto na mesma mensagem')
const s = await um('SELECT proximo_envio, vezes_enviado FROM repasse.anuncios WHERE id = $1', [a1.id])
assert.equal(s.vezes_enviado, 1)
const horas = (new Date(s.proximo_envio) - Date.now()) / 3600e3
assert.ok(horas > 23 && horas <= 24, 'próximo envio em 24 h')

// repetição com redução: passo 1.000, piso 89.000 (valor atual 90.000) -> 2ª vez sai por 89.000
await q(`UPDATE repasse.anuncios SET reducao_ativa = true, reducao_passo = 1000, reducao_piso = 89000, proximo_envio = now() WHERE id = $1`, [a1.id])
await esperar(async () => (await um('SELECT vezes_enviado FROM repasse.anuncios WHERE id = $1', [a1.id])).vezes_enviado === 2)
const rodadas = await todos('SELECT DISTINCT rodada FROM repasse.envios WHERE anuncio_id = $1 ORDER BY rodada', [a1.id])
assert.deepEqual(rodadas.map(r => r.rodada), [1, 2])
const envR2 = await todos('SELECT preco FROM repasse.envios WHERE anuncio_id = $1 AND rodada = 2', [a1.id])
assert.ok(envR2.every(e => e.preco === 89000), 'valor reduzido na 2ª vez')
assert.ok(enviados.at(-1).texto.includes('R$ 89.000') || enviados.at(-2).texto.includes('R$ 89.000'), 'texto com novo valor')
// 3ª vez: já está no piso, mantém
await q(`UPDATE repasse.anuncios SET proximo_envio = now() WHERE id = $1`, [a1.id])
await esperar(async () => (await um('SELECT vezes_enviado FROM repasse.anuncios WHERE id = $1', [a1.id])).vezes_enviado === 3)
assert.ok((await todos('SELECT preco FROM repasse.envios WHERE anuncio_id = $1 AND rodada = 3', [a1.id])).every(e => e.preco === 89000), 'não passa do piso')
// carro vindo da Loja GiroAuto: o preço de repasse definido lá é final (sem o acréscimo do grupo premium)
const daLoja = await P.montarAnuncio({ texto: EXEMPLOS[5], fotos: [foto], origem: { grupoNome: 'Loja GiroAuto', remetenteNome: 'Loja' }, forcar: true, naFila: true, precoFixo: 230000,
  dadosFixos: { origemLoja: { chave: '1:99', loja: 'Loja', veiculoId: 99 } } })
assert.equal(daLoja.status, 'pendente', 'da Loja vai para a Fila')
await q(`UPDATE repasse.anuncios SET status = 'aprovado' WHERE id = $1`, [daLoja.id])
await esperar(async () => (await um('SELECT vezes_enviado FROM repasse.anuncios WHERE id = $1', [daLoja.id])).vezes_enviado === 1)
const envLoja = await todos('SELECT grupo_jid, preco FROM repasse.envios WHERE anuncio_id = $1', [daLoja.id])
assert.ok(envLoja.length && envLoja.every(e => e.preco === 230000), 'carro da Loja sai com o preço exato em todos os grupos (sem acréscimo)')
assert.ok(enviados.filter(e => e.jid === 'premium@g.us').at(-1).texto.includes('R$ 230.000'), 'texto do grupo premium com o preço da Loja')
console.log(`✓ fluxo de envio ok: ${enviados.length} mensagens, regras por destino, acréscimo, repetição, redução até o piso, repetido detectado, carro da Loja sem acréscimo`)
process.exit(0)
