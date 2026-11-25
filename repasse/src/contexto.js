// Conta (repassador) "atual": cada requisição do painel e cada evento do WhatsApp roda dentro do
// contexto da sua conta. Todas as consultas usam contaId() para não misturar dados entre repassadores.
import { AsyncLocalStorage } from 'node:async_hooks'

const als = new AsyncLocalStorage()

export function comConta (contaId, fn) {
  return als.run({ contaId: Number(contaId) }, fn)
}

export function contaId () {
  const s = als.getStore()
  if (!s?.contaId) throw new Error('Operação sem conta definida')
  return s.contaId
}

// para testes e scripts: o restante do fluxo atual passa a usar esta conta
export function entrarConta (contaId) { als.enterWith({ contaId: Number(contaId) }) }

export const contaOuNada = () => als.getStore()?.contaId || null
