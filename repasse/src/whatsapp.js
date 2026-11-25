// Conexão com o WhatsApp (Baileys — protocolo do WhatsApp Web, não oficial): uma por conta (repassador).
// A sessão fica no banco, então sobrevive a reinícios/deploys na nuvem.
import pino from 'pino'
import QRCode from 'qrcode'
import makeWASocket, {
  DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage, Browsers,
  isJidGroup, isJidStatusBroadcast, jidNormalizedUser, areJidsSameUser, makeCacheableSignalKeyStore, BufferJSON, normalizeMessageContent
} from 'baileys'
import { q, um } from './db.js'
import { usarAuthDoBanco, limparSessao } from './wa-auth.js'
import { Trava } from './wa-trava.js'
import { garantirGrupo, receberMensagem, recarregarGrupos, processarAtrasadas } from './pipeline.js'
import { registrar, avisar } from './eventos.js'
import { comConta, contaId } from './contexto.js'
import { quadrosDoVideo } from './fotos.js'
import { mensagemDoAdmin, mensagemDeCliente, numeroAdmin, respostaManual } from './atendimento.js'

const logger = pino({ level: 'silent' })
export const whatsappDesligado = () => process.env.WHATSAPP_DESLIGADO === '1'
const conexoes = new Map() // contaId -> Conexao

// desembrulha mensagens temporárias, de visualização única, editadas e as fotos de ÁLBUM
// (cada foto de um álbum chega como associatedChildMessage; antes eram ignoradas e o anúncio ficava "sem foto")
const interno = (m) => normalizeMessageContent(m.message) || {}
const textoDe = (m) => { const i = interno(m); return i.conversation || i.extendedTextMessage?.text || i.imageMessage?.caption || i.videoMessage?.caption || i.documentMessage?.caption || '' }
const VIDEO_MAX = 64 * 1024 * 1024 // vídeos maiores que isso são ignorados (memória do servidor)
const temVideo = (m) => { const v = interno(m).videoMessage; return !!v && Number(v.fileLength?.low ?? v.fileLength ?? 0) <= VIDEO_MAX }
// foto ou vídeo (do vídeo saem quadros que viram fotos)
const temImagem = (m) => !!interno(m).imageMessage || temVideo(m)
const numeroTs = (t) => Number(t?.low ?? t ?? 0) * 1000

class Conexao {
  constructor (id) {
    this.contaId = id
    this.sock = null
    this.estado = { status: 'desconectado', qr: null, eu: null }
    this.reconectando = null
    this.tSync = null
    this.ultimoSync = 0
    this.nomes = new Map()
    this.parado = false
    this.ultimoEvento = 0 // última mensagem/evento recebido do WhatsApp (vigia de conexão parada)
    this.vigia = null
    this.idsBot = new Set() // mensagens enviadas pelo sistema (para distinguir das suas respostas à mão)
    this.trava = new Trava(id, {
      aoPerder: () => this.perdeuTrava(),
      log: (tipo, texto) => this.ctx(() => registrar(tipo, texto))
    })
  }

  // Liga o WhatsApp só depois de pegar a trava de conexão única (ver wa-trava.js).
  async ligar () {
    // interruptor de manutenção (ex.: troca de banco): este servidor não conecta o WhatsApp
    if (whatsappDesligado()) { this.mudar('desligado', { qr: null }); this.ctx(() => registrar('aviso', 'WhatsApp desligado por WHATSAPP_DESLIGADO=1')); return }
    if (this.trava.minha) return this.iniciar()
    if (this.trava.esperando) return
    this.parado = false
    this.mudar('aguardando-trava', { qr: null })
    const ok = await this.trava.obter()
    if (!ok || this.parado) return
    return this.iniciar()
  }

  // Outro servidor assumiu (ou ficamos sem banco): solta o socket sem sair da conta e volta a esperar a trava.
  perdeuTrava () {
    this.desligarSocket()
    this.mudar('desconectado', { qr: null })
    if (!this.parado) this.ligar().catch(e => this.ctx(() => registrar('erro', 'WhatsApp: ' + e.message)))
  }

  desligarSocket () {
    clearTimeout(this.reconectando); clearTimeout(this.tSync); clearInterval(this.vigia)
    const s = this.sock
    this.sock = null // o "close" desse socket é ignorado (sock !== this.sock)
    try { s?.end?.(undefined) } catch {}
  }

  ctx (fn) { return comConta(this.contaId, fn) }
  mudar (status, extra = {}) { Object.assign(this.estado, { status, ...extra }); this.ctx(() => avisar('conexao', this.estado)) }
  conectado () { return this.estado.status === 'conectado' }

  souEu (id) {
    const u = this.sock?.user
    if (!u || !id) return false
    return areJidsSameUser(id, u.id) || (u.lid && areJidsSameUser(id, u.lid))
  }

  guardarNomes (lista = []) {
    for (const c of lista) {
      const nome = c.name || c.notify || c.verifiedName
      if (c.id && nome) { this.nomes.set(jidNormalizedUser(c.id), nome); if (c.lid) this.nomes.set(jidNormalizedUser(c.lid), nome) }
    }
  }

  agendarSync () { clearTimeout(this.tSync); this.tSync = setTimeout(() => this.ctx(() => this.sincronizarGrupos(false)).catch(() => {}), 60000) }

  async sincronizarGrupos (forcar = true) {
    if (!forcar && Date.now() - this.ultimoSync < 15 * 60e3) return
    this.ultimoSync = Date.now()
    if (!this.sock || !this.conectado()) throw new Error('WhatsApp não conectado')
    const todos = await this.sock.groupFetchAllParticipating()
    const nomes = Object.fromEntries(Object.values(todos).map(g => [g.id, g.subject]))
    for (const g of Object.values(todos)) {
      await garantirGrupo(g.id, g.subject)
      await q(`UPDATE repasse.grupos SET participantes = $3, sou_admin = $4, comunidade = $5, comunidade_nome = $6, somente_admins = $7 WHERE conta_id = $1 AND jid = $2`, [
        this.contaId, g.id, g.participants?.length || 0,
        !!g.participants?.some(p => (this.souEu(p.id) || this.souEu(p.phoneNumber)) && p.admin),
        g.isCommunity ? 'comunidade' : g.isCommunityAnnounce ? 'avisos' : null,
        g.linkedParent ? (nomes[g.linkedParent] || null) : null,
        !!g.announce
      ])
    }
    await recarregarGrupos()
    avisar('mapa', {})
    registrar('info', `${Object.keys(todos).length} grupos sincronizados`)
  }

  tratarMensagem (m, historico = false) {
    let jid = m.key?.remoteJid
    if (!jid || !m.message) return
    // Lista de transmissão (muitos repassadores enviam assim): chega como "<lista>@broadcast" com o remetente
    // em participant. Conta como conversa individual com quem enviou (o mesmo contato do histórico, de preferência @lid).
    // Nunca passa pelo atendimento (o número é particular).
    const transmissao = jid.endsWith('@broadcast') && !isJidStatusBroadcast(jid)
    if (transmissao) {
      if (m.key.fromMe) return
      const quem = [m.key.participant, m.key.participantAlt, m.key.remoteJidAlt].filter(Boolean).map(jidNormalizedUser)
      jid = quem.find(j => j.endsWith('@lid')) || quem[0]
      if (!jid) return
      if (!historico) registrar('info', `Lista de transmissão de ${m.pushName || jid}`)
    }
    const grupo = isJidGroup(jid)
    const individual = !grupo && (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid'))
    if (!grupo && !individual) return // status, canais
    const texto = textoDe(m)
    const midia = temImagem(m) ? m : null
    if (!texto && !midia) return
    const chat = jidNormalizedUser(jid)
    // atendimento (só mensagens novas de conversas individuais)
    if (individual && !historico && !transmissao) {
      const numero = m.key.remoteJidAlt || m.key.senderPn || jid
      if (m.key.fromMe) {
        if (this.idsBot.has(m.key.id)) return
        if (this.souEu(jid)) this.ctx(() => mensagemDoAdmin(this, { chat: jid, texto, midia })) // conversa "você mesmo"
        else this.ctx(() => respostaManual(this, chat).catch(() => {}))
        return
      }
      const admin = this.ctx(() => numeroAdmin(numero))
      if (admin) { this.ctx(() => mensagemDoAdmin(this, { chat: jid, texto, midia })); return }
      this.ctx(() => mensagemDeCliente(this, { chat: jid, numero, texto, nome: m.pushName || this.nomes.get(chat), temMidia: !!midia }).catch(e => registrar('erro', 'Atendimento: ' + e.message)))
    }
    if (m.key.fromMe) return
    const remetenteId = grupo ? jidNormalizedUser(m.key.participantAlt || m.key.participant || '') : chat
    const nome = m.pushName || this.nomes.get(remetenteId) || null
    if (individual && m.pushName) this.nomes.set(chat, m.pushName)
    this.ctx(() => receberMensagem({
      chatJid: grupo ? jid : chat,
      chatNome: grupo ? undefined : (this.nomes.get(chat) || nome || undefined),
      tipo: grupo ? 'grupo' : 'contato',
      remetente: { id: remetenteId, nome },
      texto,
      midia,
      id: `${jid}|${m.key.id}`,
      ts: numeroTs(m.messageTimestamp) || Date.now(),
      bruto: JSON.stringify(midia ? m : { key: m.key, messageTimestamp: m.messageTimestamp }, BufferJSON.replacer),
      historico
    }).catch(e => registrar('erro', 'Mensagem: ' + e.message)))
  }

  // Pede ao WhatsApp mensagens mais antigas de uma conversa, até chegar em "desde"
  // Pede ao WhatsApp mensagens anteriores, ancorado na mensagem mais antiga que temos a partir de "desde"
  // (assim preenche a lacuna de quando o servidor esteve fora), até chegar em "desde".
  async buscarHistorico (jid, desde) {
    if (!this.sock || !this.conectado()) throw new Error('WhatsApp não conectado')
    const ancoraDe = () => um(`SELECT bruto, ts FROM repasse.mensagens WHERE conta_id = $1 AND chat_jid = $2 AND bruto IS NOT NULL AND ts >= $3 ORDER BY ts ASC LIMIT 1`, [this.contaId, jid, new Date(desde)])
    for (let i = 0; i < 12; i++) {
      const r = await ancoraDe()
      if (!r) throw new Error('nenhuma mensagem do período guardada ainda para servir de ponto de partida (as atrasadas chegam em alguns minutos)')
      const ancora = JSON.parse(r.bruto, BufferJSON.reviver)
      await this.sock.fetchMessageHistory(50, ancora.key, ancora.messageTimestamp)
      await new Promise(res => setTimeout(res, 7000))
      const r2 = await ancoraDe()
      if (!r2 || new Date(r2.ts).getTime() >= new Date(r.ts).getTime()) return // não veio nada mais antigo no período
    }
  }

  agendarReconexao (ms) {
    clearTimeout(this.reconectando)
    if (this.parado) return
    this.reconectando = setTimeout(() => this.iniciar().catch(e => this.ctx(() => registrar('erro', e.message))), ms)
  }

  async iniciar () {
    if (!this.trava.minha) return this.ligar() // reconexões e vigia também respeitam a trava
    this.parado = false
    const { state, saveCreds } = await usarAuthDoBanco(this.contaId)
    if (!this.trava.minha || this.parado) return
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }))
    this.mudar('conectando', { qr: null })
    try { this.sock?.end?.() } catch {}
    const sock = this.sock = makeWASocket({
      version,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      logger,
      browser: Browsers.ubuntu('GiroAuto Repasse'),
      markOnlineOnConnect: false,
      syncFullHistory: false
    })
    sock.ev.on('creds.update', saveCreds)
    sock.ev.on('connection.update', (u) => this.ctx(async () => {
      if (sock !== this.sock) return
      if (u.qr) this.mudar('aguardando-qr', { qr: await QRCode.toDataURL(u.qr) })
      if (u.connection === 'open') {
        this.mudar('conectado', { qr: null, eu: { id: sock.user?.id, nome: sock.user?.name } })
        registrar('info', 'WhatsApp conectado')
        this.ultimoEvento = Date.now()
        this.iniciarVigia()
        // o WhatsApp entrega o que chegou enquanto estava fora aos poucos; processa depois de alguns minutos
        for (const min of [3, 8, 15]) setTimeout(() => this.ctx(() => processarAtrasadas().catch(e => registrar('erro', 'Atrasadas: ' + e.message))), min * 60e3)
        this.sincronizarGrupos(false).catch(e => registrar('aviso', 'Sincronizar grupos: ' + e.message))
      }
      if (u.connection === 'close') {
        const codigo = u.lastDisconnect?.error?.output?.statusCode
        this.mudar('desconectado', { qr: null })
        if (this.parado) return
        if (codigo === DisconnectReason.loggedOut) {
          registrar('aviso', 'Sessão encerrada no celular. Escaneie o QR novamente.')
          await limparSessao(this.contaId)
          this.agendarReconexao(2000)
        } else {
          registrar('aviso', `Conexão caiu (código ${codigo ?? '?'}). Reconectando…`)
          this.agendarReconexao(codigo === DisconnectReason.restartRequired ? 500 : 5000)
        }
      }
    }))
    sock.ev.on('messages.upsert', ({ messages, type }) => { this.ultimoEvento = Date.now(); for (const m of messages) this.tratarMensagem(m, type !== 'notify') })
    sock.ev.on('messaging-history.set', ({ messages, contacts }) => { this.guardarNomes(contacts); for (const m of messages || []) this.tratarMensagem(m, true) })
    sock.ev.on('contacts.upsert', (l) => this.guardarNomes(l))
    sock.ev.on('contacts.update', (l) => this.guardarNomes(l))
    sock.ev.on('groups.update', () => this.agendarSync())
    sock.ev.on('group-participants.update', () => this.agendarSync())
  }

  // Conexão "zumbi": aparece conectada mas não chega nada. Os grupos fonte recebem mensagens o dia todo;
  // se ficar 40 min sem nenhum evento, reconecta.
  iniciarVigia () {
    clearInterval(this.vigia)
    this.vigia = setInterval(() => {
      if (this.parado || !this.conectado()) return
      if (Date.now() - this.ultimoEvento > 40 * 60e3) {
        this.ultimoEvento = Date.now()
        this.ctx(() => registrar('aviso', 'WhatsApp sem receber nada há 40 min. Reconectando…'))
        this.iniciar().catch(e => this.ctx(() => registrar('erro', 'Reconectar: ' + e.message)))
      }
    }, 5 * 60e3)
  }

  baixarMidia (m) { return downloadMediaMessage(m, 'buffer', {}, { logger, reuploadRequest: this.sock.updateMediaMessage }) }
  baixarBruto (bruto) { return this.baixarMidia(JSON.parse(bruto, BufferJSON.reviver)) }
  // fotos de uma mensagem: a própria foto ou, se for vídeo, alguns quadros dele
  async baixarFotos (m) {
    if (typeof m === 'string') m = JSON.parse(m, BufferJSON.reviver)
    const buf = await this.baixarMidia(m)
    if (!interno(m).videoMessage) return [buf]
    const q = await quadrosDoVideo(buf)
    if (!q.length) throw new Error('não extraiu quadros do vídeo')
    return q
  }

  // Uma única mensagem: foto de capa com o texto na legenda (ou só texto)
  async enviar (jid, texto, foto = null) {
    if (!this.sock || !this.conectado()) throw new Error('WhatsApp não conectado')
    const r = await this.sock.sendMessage(jid, foto ? { image: foto, ...(texto ? { caption: texto } : {}) } : { text: texto })
    if (r?.key?.id) { this.idsBot.add(r.key.id); if (this.idsBot.size > 2000) this.idsBot.delete(this.idsBot.values().next().value) }
    return r
  }

  // desliga sem apagar a sessão (ex.: conta bloqueada) e devolve a trava
  parar () {
    this.parado = true
    this.desligarSocket()
    this.trava.liberar().catch(() => {})
    this.mudar('desconectado', { qr: null })
  }

  // desligamento do servidor (SIGTERM): fecha o socket com end(), NUNCA logout(), e libera a trava
  async encerrar () {
    this.parado = true
    this.desligarSocket()
    try { await this.trava.liberar() } catch (e) { console.error('Liberar trava do WhatsApp:', e.message) }
  }

  // desconecta o número (apaga a sessão) — só pelo botão "Sair" do painel
  async sair () {
    this.parado = true
    try { await this.sock?.logout() } catch {}
    this.parar()
    await limparSessao(this.contaId)
  }
}

// ---------------- registro de conexões ----------------
export function conexao (id = contaId()) {
  id = Number(id)
  if (!conexoes.has(id)) conexoes.set(id, new Conexao(id))
  return conexoes.get(id)
}
export const conexaoSeExistir = (id) => conexoes.get(Number(id)) || null
export const todasConexoes = () => [...conexoes.values()]
