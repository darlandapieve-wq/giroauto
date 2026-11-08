// Memória do servidor (Render free: 512 MB). v2.19
// O pico de 450 MB da Loja (02 e 03/11/2026) coincidiu com o GiroAuto Fotos, que usa sharp e canvas: memória
// nativa (libvips usa várias threads) fragmentada nas arenas da glibc. Mitigações iguais às do Repasse:
// sharp sem cache e com 1 thread, MALLOC_ARENA_MAX=2 (Dockerfile) e canvas carregado só quando usado.
// O registro periódico separa heap do JS de memória nativa para acompanhar em produção.
const sharp = require('sharp');

sharp.cache(false);
sharp.concurrency(1);

const MB = (b) => Math.round(b / 1048576);
function memoria() {
  const m = process.memoryUsage();
  return { rssMB: MB(m.rss), heapMB: MB(m.heapUsed), externoMB: MB(m.external), buffersMB: MB(m.arrayBuffers) };
}

let timer = null;
function iniciarMonitor(minutos = Number(process.env.MEMORIA_LOG_MIN || 30)) {
  if (timer || !minutos) return;
  const log = () => { const m = memoria(); console.log(`Memória: rss ${m.rssMB} MB · heap JS ${m.heapMB} MB · externa ${m.externoMB} MB · buffers ${m.buffersMB} MB`); };
  log();
  timer = setInterval(log, minutos * 60e3);
  timer.unref();
}

module.exports = { memoria, iniciarMonitor };
