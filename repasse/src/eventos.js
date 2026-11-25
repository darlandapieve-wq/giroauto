// Atividade e avisos em tempo real (SSE), separados por conta.
import { EventEmitter } from 'node:events'
import { contaOuNada } from './contexto.js'

export const bus = new EventEmitter()
bus.setMaxListeners(200)

const logs = new Map() // conta -> lista
export const logDe = (conta) => logs.get(Number(conta)) || []

export function registrar (tipo, texto, extra = {}) {
  const conta = contaOuNada()
  const item = { ts: Date.now(), tipo, texto, ...extra }
  if (conta) {
    const l = logs.get(conta) || []
    l.unshift(item); l.length = Math.min(l.length, 300)
    logs.set(conta, l)
  }
  bus.emit('evento', { conta, evento: 'log', dados: item })
  console.log(`[${new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}]${conta ? ` c${conta}` : ''} ${tipo.toUpperCase()} ${texto}`)
}

export function avisar (evento, dados) {
  bus.emit('evento', { conta: contaOuNada(), evento, dados })
}
