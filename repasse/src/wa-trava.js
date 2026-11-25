// Trava de conexão única do WhatsApp: só UM servidor por conta conecta o número de cada vez.
// No deploy, o Render sobe o servidor novo antes de derrubar o antigo; sem trava, os dois conectam o mesmo
// número e se derrubam (código 440, connectionReplaced), com risco de a sessão ser invalidada.
//
// Como funciona (linha repasse.kv, chave "wa_lock:c<conta>"):
// - quem pega a trava grava o id da instância e renova o "sinal de vida" (coluna atualizado) a cada 20 s;
// - outro servidor só pega a trava se ela foi liberada ou se o sinal de vida tem mais de 90 s (relógio do banco);
// - quem não consegue renovar por 60 s (banco fora) desliga o WhatsApp antes de a trava expirar para os outros;
// - quem descobre que perdeu a trava desliga o WhatsApp na hora;
// - no SIGTERM o servidor fecha o socket com end() (nunca logout()) e libera a trava.
// Transição: se a linha nunca existiu, o servidor antigo pode ser uma versão sem trava ainda no ar;
// espera WA_ESPERA_SEM_TRAVA_MS (padrão 3 min) antes de criar a trava.
import os from 'node:os'
import crypto from 'node:crypto'
import { q as qBanco } from './db.js'

const num = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' && Number.isFinite(Number(process.env[k])) ? Number(process.env[k]) : d)
export const INSTANCIA = process.env.RENDER_INSTANCE_ID || `${os.hostname()}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`

export const PADRAO = {
  vidaMs: num('WA_TRAVA_VIDA_MS', 20e3), // renovação do sinal de vida
  expiraS: num('WA_TRAVA_EXPIRA_S', 90), // sem sinal de vida por isso, a trava está livre para outro
  perdaMs: num('WA_TRAVA_PERDA_MS', 60e3), // sem conseguir renovar por isso, desliga o WhatsApp (< expiraS)
  tentarMs: num('WA_TRAVA_TENTAR_MS', 15e3), // intervalo entre tentativas de pegar a trava
  semTravaMs: num('WA_ESPERA_SEM_TRAVA_MS', 180e3) // espera extra quando a trava nunca existiu
}

export const chaveTrava = (contaId) => `wa_lock:c${Number(contaId)}`
const espera = (ms) => new Promise(r => setTimeout(r, ms))

export class Trava {
  constructor (contaId, { instancia = INSTANCIA, q = qBanco, aoPerder = () => {}, log = () => {}, ...opcoes } = {}) {
    this.contaId = Number(contaId)
    this.chave = chaveTrava(contaId)
    this.instancia = instancia
    this.q = q
    this.aoPerder = aoPerder
    this.log = log
    this.o = { ...PADRAO, ...opcoes }
    this.minha = false
    this.timer = null
    this.ultimoOk = 0
    this.esperando = null
    this.cancelado = false
  }

  async existe () {
    return (await this.q('SELECT 1 AS x FROM repasse.kv WHERE chave = $1', [this.chave])).rows.length > 0
  }

  // uma tentativa: true se a trava agora é desta instância
  async tentar () {
    const valor = JSON.stringify({ instancia: this.instancia, desde: new Date().toISOString(), host: os.hostname(), pid: process.pid })
    const r = await this.q(`INSERT INTO repasse.kv (chave, valor, atualizado) VALUES ($1, $2::jsonb, now())
      ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado = now()
      WHERE repasse.kv.valor->>'instancia' = $3
         OR COALESCE(repasse.kv.valor->>'liberada', 'false') = 'true'
         OR repasse.kv.atualizado < now() - ($4 || ' seconds')::interval
      RETURNING chave`, [this.chave, valor, this.instancia, String(this.o.expiraS)])
    if (r.rows.length) this.assumir()
    return this.minha
  }

  // espera até conseguir a trava (ou até cancelar()). Chamadas simultâneas compartilham a mesma espera.
  obter () {
    if (this.minha) return Promise.resolve(true)
    if (!this.esperando) {
      this.cancelado = false
      this.esperando = (async () => {
        try {
          if (!(await this.existe())) {
            this.log('aviso', `Trava do WhatsApp ainda não existe: esperando ${Math.round(this.o.semTravaMs / 1000)} s para o servidor antigo sair`)
            await espera(this.o.semTravaMs)
          }
          let avisou = false
          while (!this.cancelado) {
            try { if (await this.tentar()) return true } catch (e) { this.log('erro', 'Trava do WhatsApp: ' + e.message) }
            if (!avisou) { this.log('info', 'WhatsApp em uso por outro servidor: aguardando ele liberar'); avisou = true }
            await espera(this.o.tentarMs)
          }
          return false
        } finally { this.esperando = null }
      })()
    }
    return this.esperando
  }

  assumir () {
    this.minha = true
    this.ultimoOk = Date.now()
    clearInterval(this.timer)
    this.timer = setInterval(() => this.renovar().catch(() => {}), this.o.vidaMs)
    this.timer.unref?.()
  }

  async renovar () {
    if (!this.minha) return false
    let ok
    try {
      const r = await this.q(`UPDATE repasse.kv SET atualizado = now()
        WHERE chave = $1 AND valor->>'instancia' = $2 AND COALESCE(valor->>'liberada', 'false') <> 'true' RETURNING chave`, [this.chave, this.instancia])
      ok = r.rows.length > 0
      if (ok) { this.ultimoOk = Date.now(); return true }
      this.perder('outro servidor assumiu o WhatsApp')
      return false
    } catch (e) {
      if (Date.now() - this.ultimoOk > this.o.perdaMs) this.perder('sem falar com o banco há mais de ' + Math.round(this.o.perdaMs / 1000) + ' s')
      throw e
    }
  }

  perder (motivo) {
    if (!this.minha) return
    this.minha = false
    clearInterval(this.timer); this.timer = null
    this.log('aviso', 'Trava do WhatsApp perdida: ' + motivo)
    this.aoPerder(motivo)
  }

  cancelar () { this.cancelado = true }

  // devolve a trava (no desligamento): o próximo servidor pode pegá-la na hora
  async liberar () {
    this.cancelar()
    const era = this.minha
    this.minha = false
    clearInterval(this.timer); this.timer = null
    if (!era) return false
    const r = await this.q(`UPDATE repasse.kv SET valor = valor || '{"liberada": true}'::jsonb, atualizado = now()
      WHERE chave = $1 AND valor->>'instancia' = $2 RETURNING chave`, [this.chave, this.instancia])
    return r.rows.length > 0
  }
}
