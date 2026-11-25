// Testa a integração com a IA simulando a resposta da API (sem gastar créditos): node test/teste-ia.js
import assert from 'node:assert/strict'
import fs from 'node:fs'
process.env.DATA_DIR = '/tmp/gr-teste-ia'; fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true })
process.env.ANTHROPIC_API_KEY = 'teste'
let corpo = null
globalThis.fetch = async (url, op) => {
  if (!String(url).includes('anthropic')) throw new Error('sem rede')
  corpo = JSON.parse(op.body)
  return { ok: true, json: async () => ({ content: [{ type: 'tool_use', name: 'registrar_anuncio', input: { eh_anuncio: true, marca: 'Jeep', modelo: 'Compass', versao: 'Longitude 2.0 Flex', ano_fabricacao: 2019, ano_modelo: 2020, km: 70000, preco: 105000, cambio: 'Automático', combustivel: 'Flex', cidade: 'Maringá-PR', categoria: 'suv', opcionais: ['teto solar'], situacao: ['único dono'], alertas: [], placa: 'ABC1D23', descricao: 'Compass Longitude impecável, único dono, revisões em dia.' } }], usage: {} }) }
}
const { carregarConfig } = await import('../src/config.js')
const { analisar } = await import('../src/pipeline.js')
;(await import('../src/contexto.js')).entrarConta(1)
await carregarConfig()
const d = await analisar('vendo jipinho compass longi 19 20 70mil rodado 105 maringa chama', { temFoto: true })
assert.equal(corpo.tool_choice.name, 'registrar_anuncio'); assert.ok(corpo.model.startsWith('claude-'))
assert.equal(d.modelo, 'Compass'); assert.equal(d.preco, 105000); assert.equal(d.categoria, 'suv'); assert.equal(d.placa, 'ABC1D23')
assert.ok(d.descricaoIA.includes('Compass')); assert.ok(d.pontos >= 10)
console.log('✓ IA: requisição montada e resposta mesclada corretamente')
process.exit(0)
