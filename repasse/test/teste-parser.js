// Teste rápido do extrator: node test/teste-parser.js
import assert from 'node:assert/strict'
import { parseAnuncio } from '../src/parser.js'
import { EXEMPLOS } from '../src/exemplos.js'

const casos = [
  [EXEMPLOS[0], { modelo: 'Civic', ano: '2018/2019', km: 68000, preco: 98900, fipe: 105000, cidade: 'Cascavel-PR' }],
  [EXEMPLOS[1], { modelo: 'Onix', ano: '2020/2021', km: 45000, preco: 62000, cidade: 'Toledo-PR' }],
  [EXEMPLOS[2], { modelo: 'Strada', ano: '2022', km: 39500, preco: 88500, fipe: 94300 }],
  [EXEMPLOS[5], { modelo: 'Hilux SW4', ano: '2019/2020', km: 110000, preco: 219900, cidade: 'Assis Chateaubriand-PR' }],
  ['Corolla XEI 2.0 2020/2021 automático 52.000 km R$ 112.000 Londrina-PR', { modelo: 'Corolla', km: 52000, preco: 112000, cambio: 'Automático' }],
  ['Gol 1.0 2014 98 mil km valor 32mil', { modelo: 'Gol', ano: '2014', km: 98000, preco: 32000 }],
  ['POLO TRACK 1.0 MPI 12V \nANO 2026\nKM 42.000\nCOMPLETO\nVALOR 89.900', { modelo: 'Polo', ano: '2026', km: 42000, preco: 89900 }],
  ['C43 2018\n\nÚnico dono\n\n83.000km\n\nFipe 255.303\n\nPor 189.900 !!!', { km: 83000, preco: 189900, fipe: 255303 }]
]
let ok = 0
for (const [txt, esperado] of casos) {
  const d = parseAnuncio(txt)
  for (const [k, v] of Object.entries(esperado)) assert.equal(d[k], v, `${k} em: ${txt.split('\n')[0]}`)
  ok++
}
assert.ok(parseAnuncio(EXEMPLOS[3]).ehProcura, 'procura')
assert.ok(parseAnuncio(EXEMPLOS[4]).pontos < 6, 'mensagem comum')
console.log(`✓ ${ok + 2} verificações do extrator passaram`)
