// Fotos prontas (v2.0): redução de tamanho e marca d'água com o logo da loja. Tudo opcional.
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const DEFAULTS = { reduzir: false, max_lado: 1600, qualidade: 85, marca_dagua: false, posicao: 'inferior_direita', opacidade: 70, tamanho: 18 };

function opts(store) {
  let o = {};
  try { o = JSON.parse(store?.foto_opts || '{}'); } catch { o = {}; }
  return { ...DEFAULTS, ...o };
}

function clean(body) {
  const n = (x, min, max, d) => Math.max(min, Math.min(max, parseInt(x, 10) || d));
  return {
    reduzir: !!body.reduzir,
    max_lado: n(body.max_lado, 800, 4000, 1600),
    qualidade: n(body.qualidade, 50, 95, 85),
    marca_dagua: !!body.marca_dagua,
    posicao: ['inferior_direita', 'inferior_esquerda', 'superior_direita', 'superior_esquerda', 'centro'].includes(body.posicao) ? body.posicao : 'inferior_direita',
    opacidade: n(body.opacidade, 10, 100, 70),
    tamanho: n(body.tamanho, 8, 40, 18),
  };
}

/**
 * Aplica as opções da loja a uma foto recém-enviada. Devolve o novo nome (sempre .jpg) ou o mesmo nome se nada mudou.
 */
async function processFile(dir, filename, o, logoFile) {
  if (!o.reduzir && !(o.marca_dagua && logoFile)) return filename;
  const src = path.join(dir, filename);
  const img = await loadImage(src);
  let w = img.width; let h = img.height;
  if (o.reduzir) {
    const s = Math.min(1, o.max_lado / Math.max(w, h));
    w = Math.round(w * s); h = Math.round(h * s);
  }
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  if (o.marca_dagua && logoFile && fs.existsSync(logoFile)) {
    const logo = await loadImage(logoFile);
    const lw = Math.round(w * (o.tamanho / 100));
    const lh = Math.round(lw * (logo.height / logo.width));
    const m = Math.round(w * 0.03);
    const pos = {
      inferior_direita: [w - lw - m, h - lh - m], inferior_esquerda: [m, h - lh - m],
      superior_direita: [w - lw - m, m], superior_esquerda: [m, m], centro: [(w - lw) / 2, (h - lh) / 2],
    }[o.posicao];
    ctx.globalAlpha = o.opacidade / 100;
    ctx.drawImage(logo, pos[0], pos[1], lw, lh);
    ctx.globalAlpha = 1;
  }
  const out = await canvas.encode('jpeg', o.qualidade || 85);
  const name = filename.replace(/\.(png|webp|jpg)$/i, '.jpg');
  fs.writeFileSync(path.join(dir, name), out);
  if (name !== filename) fs.rmSync(src, { force: true });
  return name;
}

module.exports = { opts, clean, processFile, DEFAULTS };
