// Arte de divulgação do veículo (imagem 1 do pacote): foto principal, marca, modelo, ano,
// preço, itens do veículo e três fotos menores. Feita no servidor, sem custo.
const path = require('node:path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const FONTS = path.join(__dirname, '..', '..', 'assets', 'fonts');
let fontsReady = false;
function loadFonts() {
  if (fontsReady) return;
  GlobalFonts.registerFromPath(path.join(FONTS, 'Oswald_700Bold.ttf'), 'GA Oswald');
  GlobalFonts.registerFromPath(path.join(FONTS, 'Oswald_500Medium.ttf'), 'GA Oswald Medium');
  GlobalFonts.registerFromPath(path.join(FONTS, 'Montserrat_500Medium.ttf'), 'GA Mont Medium');
  GlobalFonts.registerFromPath(path.join(FONTS, 'Montserrat_600SemiBold.ttf'), 'GA Mont Semi');
  GlobalFonts.registerFromPath(path.join(FONTS, 'Montserrat_800ExtraBold.ttf'), 'GA Mont Black');
  GlobalFonts.registerFromPath(path.join(FONTS, 'Montserrat_700Bold_Italic.ttf'), 'GA Mont Italic');
  fontsReady = true;
}

const W = 1080;
const H = 1350;
const GOLD = '#E3B341';
const GOLD_2 = '#F6D77A';
const INK = '#0B0C0F';

const COLOR_SWATCH = {
  Branco: '#F2F2F2', Prata: '#C9CDD2', Cinza: '#7D838A', Preto: '#141414', Vermelho: '#C62828', Azul: '#1E4FA3',
  Verde: '#2E7D32', Marrom: '#6D4C41', Bege: '#D8C3A0', Amarelo: '#F2C230', Laranja: '#EF7D22', Dourado: '#C9A44C', Vinho: '#6E1A2D',
};

const TAGLINE = {
  SUV: 'Conforto, espaço e segurança para a família.',
  Hatch: 'Economia e praticidade para o dia a dia.',
  'Sedã': 'Conforto e elegância em cada viagem.',
  Picape: 'Força e versatilidade para trabalho e lazer.',
  Minivan: 'Espaço de sobra para toda a família.',
  Perua: 'Espaço e conforto para ir mais longe.',
};

const fmtInt = (n) => Number(n || 0).toLocaleString('pt-BR');

// Desenha a imagem cobrindo a área (corta o excesso, centralizado).
function drawCover(ctx, img, x, y, w, h, focusY = 0.5) {
  const s = Math.max(w / img.width, h / img.height);
  const sw = w / s; const sh = h / s;
  const sx = (img.width - sw) / 2;
  const sy = Math.max(0, Math.min(img.height - sh, (img.height - sh) * focusY));
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Reduz a fonte até o texto caber na largura.
function fitFont(ctx, text, family, max, min, width) {
  let size = max;
  for (; size > min; size -= 2) {
    ctx.font = `${size}px "${family}"`;
    if (ctx.measureText(text).width <= width) break;
  }
  ctx.font = `${size}px "${family}"`;
  return size;
}

function wrapLines(ctx, text, width) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width > width && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

/* Ícones simples, desenhados em dourado dentro de um círculo. */
const ICONS = {
  km(ctx) { // velocímetro
    ctx.beginPath(); ctx.arc(0, 4, 13, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(8, -6); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 4, 2.5, 0, Math.PI * 2); ctx.fill();
  },
  cambio(ctx) { // alavanca de câmbio (H)
    ctx.beginPath();
    ctx.moveTo(-9, -10); ctx.lineTo(-9, 10); ctx.moveTo(0, -10); ctx.lineTo(0, 10); ctx.moveTo(9, -10); ctx.lineTo(9, 0);
    ctx.moveTo(-9, 0); ctx.lineTo(9, 0); ctx.stroke();
  },
  combustivel(ctx) { // gota
    ctx.beginPath(); ctx.moveTo(0, -13); ctx.bezierCurveTo(10, -1, 11, 4, 9, 7); ctx.arc(0, 5, 9, 0.2, Math.PI - 0.2); ctx.bezierCurveTo(-11, 4, -10, -1, 0, -13); ctx.stroke();
  },
  ano(ctx) { // calendário
    roundRect(ctx, -12, -10, 24, 22, 3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-12, -3); ctx.lineTo(12, -3); ctx.moveTo(-6, -14); ctx.lineTo(-6, -7); ctx.moveTo(6, -14); ctx.lineTo(6, -7); ctx.stroke();
  },
  carroceria(ctx) { // carro de lado
    ctx.beginPath(); ctx.moveTo(-14, 5); ctx.lineTo(-14, -1); ctx.lineTo(-8, -2); ctx.lineTo(-3, -9); ctx.lineTo(7, -9); ctx.lineTo(11, -2); ctx.lineTo(14, -1); ctx.lineTo(14, 5); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.arc(-7, 6, 3.5, 0, Math.PI * 2); ctx.arc(7, 6, 3.5, 0, Math.PI * 2); ctx.fill();
  },
};

function iconBadge(ctx, x, y, kind, swatch) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(11,12,15,0.72)'; ctx.fill();
  ctx.lineWidth = 2.5; ctx.strokeStyle = GOLD; ctx.stroke();
  ctx.lineWidth = 2.6; ctx.strokeStyle = GOLD; ctx.fillStyle = GOLD; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (kind === 'cor') {
    ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fillStyle = swatch || GOLD; ctx.fill(); ctx.lineWidth = 2; ctx.stroke();
  } else ICONS[kind](ctx);
  ctx.restore();
}

function specsOf(v) {
  const out = [];
  if (v.km || v.km === 0) out.push(['km', v.km ? `${fmtInt(v.km)} km` : '0 km']);
  if (v.cambio) out.push(['cambio', `Câmbio ${v.cambio.toLowerCase()}`]);
  if (v.combustivel) out.push(['combustivel', v.combustivel]);
  if (v.ano_fab || v.ano_modelo) out.push(['ano', `Ano ${v.ano_fab || v.ano_modelo}/${v.ano_modelo || v.ano_fab}`]);
  if (v.cor) out.push(['cor', `Cor ${v.cor.toLowerCase()}`]);
  if (v.carroceria && out.length < 6) out.push(['carroceria', v.carroceria]);
  return out.slice(0, 6);
}

// Extrai a motorização da versão (ex.: "LT 1.0 Turbo" -> "1.0 Turbo"; "Track 1.6" -> "1.6").
function engineOf(versao) {
  const m = String(versao || '').match(/\b\d\.\d\b(\s*(turbo|tsi|tfsi|flex|16v|8v|v6|v8))?/i);
  return m ? m[0].replace(/\s+/g, ' ').toUpperCase().replace('TURBO', 'Turbo') : '';
}

/**
 * @param {object} v veículo (linha do banco)
 * @param {string[]} photoFiles caminhos das fotos no disco, na ordem (a primeira é a capa)
 * @param {object} store loja (nome, whatsapp, phone, city)
 * @returns {Promise<Buffer>} JPEG 1080x1350
 */
async function renderCard(v, photoFiles, store = {}) {
  loadFonts();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);

  const imgs = [];
  for (const f of photoFiles.slice(0, 4)) { try { imgs.push(await loadImage(f)); } catch { /* foto ilegível: pula */ } }
  if (!imgs.length) throw new Error('Nenhuma foto legível para montar a arte.');

  /* Foto principal */
  const HERO_H = 1000;
  drawCover(ctx, imgs[0], 0, 0, W, HERO_H, 0.55);
  let g = ctx.createLinearGradient(0, 0, 0, 380);
  g.addColorStop(0, 'rgba(11,12,15,0.92)'); g.addColorStop(0.55, 'rgba(11,12,15,0.55)'); g.addColorStop(1, 'rgba(11,12,15,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, 380);
  g = ctx.createLinearGradient(0, HERO_H - 420, 0, HERO_H);
  g.addColorStop(0, 'rgba(11,12,15,0)'); g.addColorStop(0.6, 'rgba(11,12,15,0.6)'); g.addColorStop(1, 'rgba(11,12,15,0.97)');
  ctx.fillStyle = g; ctx.fillRect(0, HERO_H - 420, W, 420);
  g = ctx.createLinearGradient(0, 0, 420, 0);
  g.addColorStop(0, 'rgba(11,12,15,0.55)'); g.addColorStop(1, 'rgba(11,12,15,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 380, 420, HERO_H - 380);

  /* Marca (selo com o nome) */
  const marca = String(v.marca || '').toUpperCase();
  ctx.font = '26px "GA Mont Black"';
  const mw = ctx.measureText(marca).width;
  ctx.save();
  roundRect(ctx, 48, 44, mw + 44, 46, 23);
  ctx.fillStyle = 'rgba(227,179,65,0.14)'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = GOLD; ctx.stroke();
  ctx.fillStyle = GOLD_2; ctx.textBaseline = 'middle'; ctx.fillText(marca, 70, 68);
  ctx.restore();

  /* Modelo */
  const modelo = String(v.modelo || '').toUpperCase();
  ctx.save();
  ctx.transform(1, 0, -0.12, 1, 0, 0); // leve inclinação esportiva
  ctx.textBaseline = 'alphabetic';
  ctx.font = '150px "GA Oswald"';
  const lines = wrapLines(ctx, modelo, 600);
  let size = 150;
  if (lines.length > 2) { size = 110; ctx.font = `${size}px "GA Oswald"`; }
  const shown = wrapLines(ctx, modelo, 600).slice(0, 2);
  let y = 100 + size * 0.95;
  let last = y;
  for (const ln of shown) {
    last = y;
    const s = fitFont(ctx, ln, 'GA Oswald', size, 70, 620);
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#FFFFFF'; ctx.fillText(ln, 60 + (y * 0.12), y);
    y += s * 0.98;
  }
  ctx.shadowColor = 'transparent';
  // Motor e ano
  const motor = engineOf(v.versao);
  const ano = v.ano_modelo || v.ano_fab || '';
  ctx.font = '62px "GA Oswald Medium"';
  y = last + 80;
  let x = 62 + (y * 0.12);
  if (motor) { ctx.fillStyle = '#FFFFFF'; ctx.fillText(motor, x, y); x += ctx.measureText(motor).width + 22; }
  if (ano) { ctx.fillStyle = GOLD; ctx.font = '62px "GA Oswald"'; ctx.fillText(String(ano), x, y); }
  ctx.restore();
  const headerBottom = y;

  /* Frase à direita */
  const tag = TAGLINE[v.carroceria] || 'Qualidade e confiança para você rodar tranquilo.';
  ctx.font = '25px "GA Mont Semi"';
  const tagLines = wrapLines(ctx, tag.toUpperCase(), 300);
  const tx = W - 52 - 300;
  ctx.fillStyle = GOLD; ctx.fillRect(tx - 22, 62, 4, tagLines.length * 34 - 4);
  ctx.fillStyle = '#F4F4F4'; ctx.textBaseline = 'top';
  tagLines.forEach((l, i) => ctx.fillText(l, tx, 60 + i * 34));

  /* Itens do veículo (coluna à esquerda) */
  let specs = specsOf(v);
  const SPEC_MAX = 960; // abaixo disso começam as fotos menores
  let step = 74;
  const room = SPEC_MAX - (headerBottom + 60);
  while (specs.length > 3 && specs.length * step > room) specs = specs.slice(0, -1);
  if (specs.length * step > room) step = Math.max(56, Math.floor(room / specs.length));
  const specTop = Math.max(headerBottom + 60 + step / 2, SPEC_MAX - specs.length * step + step / 2 - 20);
  ctx.textBaseline = 'middle';
  specs.forEach(([kind, label], i) => {
    const cy = specTop + i * step;
    iconBadge(ctx, 84, cy, kind, COLOR_SWATCH[v.cor]);
    ctx.font = '29px "GA Mont Semi"'; ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 8;
    ctx.fillText(label.toUpperCase(), 126, cy + 1);
    ctx.shadowColor = 'transparent';
  });

  /* Preço */
  const price = fmtInt(v.preco);
  const PX = 440; const PY = 742; const PW = 590; const PH = 150;
  ctx.save();
  ctx.translate(PX, PY);
  ctx.transform(1, 0, -0.14, 1, 0, 0);
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 30;
  ctx.fillStyle = 'rgba(11,12,15,0.9)'; ctx.fillRect(0, 0, PW, PH);
  ctx.shadowColor = 'transparent';
  const pg = ctx.createLinearGradient(0, 0, PW, PH);
  pg.addColorStop(0, GOLD_2); pg.addColorStop(0.5, GOLD); pg.addColorStop(1, '#A87C1E');
  ctx.lineWidth = 5; ctx.strokeStyle = pg; ctx.strokeRect(0, 0, PW, PH);
  ctx.textBaseline = 'alphabetic';
  if (v.preco) {
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '46px "GA Mont Black"'; ctx.fillText('R$', 40, 106);
    const ps = fitFont(ctx, price, 'GA Mont Black', 112, 60, PW - 150);
    ctx.fillText(price, 118, 70 + ps * 0.36);
  } else {
    ctx.fillStyle = '#FFFFFF'; fitFont(ctx, 'CONSULTE', 'GA Mont Black', 92, 50, PW - 80); ctx.fillText('CONSULTE', 40, 112);
  }
  ctx.restore();
  ctx.font = '40px "GA Mont Italic"'; ctx.fillStyle = GOLD_2; ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 10;
  const cta = 'Agende sua visita!';
  ctx.fillText(cta, W - 52 - ctx.measureText(cta).width, PY + PH + 66);
  ctx.shadowColor = 'transparent';

  /* Três fotos menores */
  const thumbs = [imgs[1], imgs[2], imgs[3]].map((im, i) => im || imgs[(i + 1) % imgs.length] || imgs[0]);
  const TY = 1010; const TH = 268; const GAP = 14; const TW = (W - 2 * 24 - 2 * GAP) / 3;
  thumbs.forEach((im, i) => {
    const tx2 = 24 + i * (TW + GAP);
    ctx.save(); roundRect(ctx, tx2, TY, TW, TH, 14); ctx.clip(); drawCover(ctx, im, tx2, TY, TW, TH); ctx.restore();
    roundRect(ctx, tx2, TY, TW, TH, 14); ctx.lineWidth = 3; ctx.strokeStyle = GOLD; ctx.stroke();
  });

  /* Rodapé com a loja */
  const contato = [store.name, store.whatsapp || store.phone, store.city].filter(Boolean).join('  ·  ');
  if (contato) {
    ctx.font = '26px "GA Mont Semi"'; ctx.fillStyle = '#E8E8E8'; ctx.textBaseline = 'middle';
    fitFont(ctx, contato, 'GA Mont Semi', 26, 18, W - 80);
    const cw = ctx.measureText(contato).width;
    ctx.fillText(contato, (W - cw) / 2, 1316);
  }

  return canvas.encode('jpeg', 90);
}

/**
 * Converte qualquer foto para JPEG 1080x1350 sem cortar o carro: a foto inteira no centro
 * e o fundo preenchido com ela mesma ampliada e escurecida (padrão do Instagram).
 */
async function toPortraitJpeg(file) {
  const img = await loadImage(file);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
  const ratio = img.width / img.height;
  if (Math.abs(ratio - W / H) < 0.02) { ctx.drawImage(img, 0, 0, W, H); return canvas.encode('jpeg', 90); }
  ctx.filter = 'blur(40px) brightness(0.55)';
  drawCover(ctx, img, -60, -60, W + 120, H + 120);
  ctx.filter = 'none';
  const s = Math.min(W / img.width, H / img.height);
  const dw = img.width * s; const dh = img.height * s;
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  return canvas.encode('jpeg', 90);
}

// Redimensiona/corta uma imagem gerada pela IA para 1080x1350 JPEG.
async function normalizeJpeg(buffer) {
  const img = await loadImage(buffer);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  drawCover(ctx, img, 0, 0, W, H);
  return canvas.encode('jpeg', 90);
}

module.exports = { renderCard, toPortraitJpeg, normalizeJpeg, engineOf, W, H };
