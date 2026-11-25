// A libsignal (usada pelo Baileys) escreve no console o objeto inteiro da sessão do WhatsApp
// ("Closing session: SessionEntry { ... privKey ... }"), e isso ia parar nos logs do Render.
// Este módulo descarta essas mensagens. Precisa ser o primeiro import do servidor.
const PREFIXOS = [
  'Closing session',
  'Opening session',
  'Removing old closed session',
  'Session already closed',
  'Session already open',
  'Closing open session in favor of incoming prekey bundle',
  'Closing stale open session',
  'Migrating session to'
]

export const ehLogDeSessao = (primeiro) => typeof primeiro === 'string' && PREFIXOS.some(p => primeiro.startsWith(p))

for (const nivel of ['log', 'info', 'warn', 'error', 'debug']) {
  const original = console[nivel].bind(console)
  console[nivel] = (...args) => { if (!ehLogDeSessao(args[0])) original(...args) }
}
