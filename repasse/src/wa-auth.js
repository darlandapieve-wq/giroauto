// Sessão do WhatsApp de cada conta guardada no banco (prefixo "c<conta>:"), para sobreviver a reinícios.
import { initAuthCreds, BufferJSON, proto } from 'baileys'
import { q, um, todos } from './db.js'

export async function usarAuthDoBanco (contaId) {
  const P = `c${Number(contaId)}:`
  const ler = async (id) => {
    const r = await um('SELECT valor FROM repasse.wa_auth WHERE id = $1', [P + id])
    return r ? JSON.parse(r.valor, BufferJSON.reviver) : null
  }
  const gravar = (id, v) => q(`INSERT INTO repasse.wa_auth (id, valor) VALUES ($1, $2)
    ON CONFLICT (id) DO UPDATE SET valor = EXCLUDED.valor`, [P + id, JSON.stringify(v, BufferJSON.replacer)])
  const apagar = (id) => q('DELETE FROM repasse.wa_auth WHERE id = $1', [P + id])

  const creds = (await ler('creds')) || initAuthCreds()
  return {
    state: {
      creds,
      keys: {
        get: async (tipo, ids) => {
          const out = {}
          if (!ids.length) return out
          const rows = await todos('SELECT id, valor FROM repasse.wa_auth WHERE id = ANY($1)', [ids.map(i => `${P}${tipo}-${i}`)])
          const mapa = Object.fromEntries(rows.map(r => [r.id.slice(P.length), JSON.parse(r.valor, BufferJSON.reviver)]))
          for (const i of ids) {
            let v = mapa[`${tipo}-${i}`]
            if (v && tipo === 'app-state-sync-key') v = proto.Message.AppStateSyncKeyData.fromObject(v)
            if (v) out[i] = v
          }
          return out
        },
        set: async (dados) => {
          const tarefas = []
          for (const tipo of Object.keys(dados)) {
            for (const id of Object.keys(dados[tipo])) {
              const v = dados[tipo][id]
              tarefas.push(v ? gravar(`${tipo}-${id}`, v) : apagar(`${tipo}-${id}`))
            }
          }
          await Promise.all(tarefas)
        }
      }
    },
    saveCreds: () => gravar('creds', creds)
  }
}

export const temSessao = async (contaId) => !!(await um('SELECT 1 AS x FROM repasse.wa_auth WHERE id = $1', [`c${Number(contaId)}:creds`]))

export async function limparSessao (contaId) {
  await q('DELETE FROM repasse.wa_auth WHERE id LIKE $1', [`c${Number(contaId)}:%`])
}
