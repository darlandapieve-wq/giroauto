// Memória do servidor (plano free do Render: 512 MB).
// A RSS do Repasse sobe em degraus nas rajadas de anúncios com foto e não volta: padrão típico de memória
// nativa (libvips/sharp, que usa várias threads) fragmentada nas arenas da glibc, não de vazamento no JavaScript.
// Mitigações: sem cache do sharp, uma thread do libvips e (no Dockerfile) MALLOC_ARENA_MAX=2.
// O registro periódico separa heap do JS de memória nativa para confirmar a causa em produção.
import sharp from 'sharp'

sharp.cache(false)
sharp.concurrency(1)

const MB = (b) => Math.round(b / 1048576)
export function memoria () {
  const m = process.memoryUsage()
  return { rssMB: MB(m.rss), heapMB: MB(m.heapUsed), externoMB: MB(m.external), buffersMB: MB(m.arrayBuffers) }
}

let timer = null
export function iniciarMonitorMemoria (minutos = Number(process.env.MEMORIA_LOG_MIN || 30)) {
  if (timer || !minutos) return
  const registrar = () => { const m = memoria(); console.log(`Memória: rss ${m.rssMB} MB · heap JS ${m.heapMB} MB · externa ${m.externoMB} MB · buffers ${m.buffersMB} MB`) }
  registrar()
  timer = setInterval(registrar, minutos * 60e3)
  timer.unref()
}
