// Gera a biblioteca de trilhas originais do "Gerar vídeo" (sem direitos autorais de terceiros).
// Uso: node scripts/musicas.js <pasta-saida>  → <id>.wav (depois: ffmpeg para .m4a em assets/musicas/)
const fs = require('node:fs');
const path = require('node:path');
const SR = 44100;

const freq = (m) => 440 * Math.pow(2, (m - 69) / 12);

function trilha({ bpm, dur, acordes, raizes, estilo }) {
  const N = SR * dur; const L = new Float32Array(N); const R = new Float32Array(N);
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const add = (i, l, r = l) => { if (i >= 0 && i < N) { L[i] += l; R[i] += r; } };
  const beat = 60 / bpm; const bar = beat * 4;
  const kick = (t0, v = 0.9) => { let ph = 0; for (let k = 0; k < SR * 0.35; k++) { const t = k / SR; ph += 2 * Math.PI * (50 + 110 * Math.exp(-t * 30)) / SR; add(Math.floor(t0 * SR) + k, Math.sin(ph) * Math.exp(-t * 7) * v); } };
  const caixa = (t0, v = 0.28, dec = 22) => { for (let k = 0; k < SR * 0.2; k++) { const t = k / SR; const e = Math.exp(-t * dec); add(Math.floor(t0 * SR) + k, (rnd() * 0.8 + Math.sin(2 * Math.PI * 190 * t) * 0.4) * e * v, (rnd() * 0.8 + Math.sin(2 * Math.PI * 190 * t) * 0.4) * e * v); } };
  const hat = (t0, v = 0.12) => { let p = 0; for (let k = 0; k < SR * 0.05; k++) { const t = k / SR; const x = rnd(); const hp = x - p; p = x; add(Math.floor(t0 * SR) + k, hp * Math.exp(-t * 70) * v * 0.8, hp * Math.exp(-t * 70) * v); } };
  const tom = (t0, f0, v = 0.5) => { let ph = 0; for (let k = 0; k < SR * 0.6; k++) { const t = k / SR; ph += 2 * Math.PI * f0 * (1 + Math.exp(-t * 20)) / SR; add(Math.floor(t0 * SR) + k, (Math.sin(ph) + rnd() * 0.15 * Math.exp(-t * 30)) * Math.exp(-t * 5) * v); } };
  const baixo = (t0, m, d, v = 0.35, corte = 0.08) => { const f = freq(m); let lp = 0; for (let k = 0; k < SR * d; k++) { const t = k / SR; const saw = 2 * ((f * t) % 1) - 1; lp += (saw - lp) * corte; add(Math.floor(t0 * SR) + k, lp * Math.min(1, t * 200) * Math.exp(-t * 3) * v); } };
  const pad = (t0, notas, d, v = 0.045, corte = 0.04, oit = 12) => {
    for (const m of notas) for (const det of [-0.12, 0.12]) {
      const f = freq(m + oit) * Math.pow(2, det / 12); let lp = 0;
      for (let k = 0; k < SR * d; k++) { const t = k / SR; const saw = 2 * ((f * t) % 1) - 1; lp += (saw - lp) * corte; const e = Math.min(1, t / 0.15) * Math.min(1, (d - t) / 0.2); const s = lp * e * v; add(Math.floor(t0 * SR) + k, det < 0 ? s : s * 0.6, det < 0 ? s * 0.6 : s); }
    }
  };
  const tecla = (t0, m, v = 0.08, pan = 0.5, dec = 12) => { const f = freq(m); for (let k = 0; k < SR * 0.6; k++) { const t = k / SR; const s = (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(4 * Math.PI * f * t) + 0.12 * Math.sin(6 * Math.PI * f * t)) * Math.exp(-t * dec) * v; add(Math.floor(t0 * SR) + k, s * (1 - pan), s * pan); } };
  const guitarra = (t0, m, d, v = 0.12) => { // power chord distorcido
    for (const iv of [0, 7, 12]) { const f = freq(m + iv); let lp = 0; for (let k = 0; k < SR * d; k++) { const t = k / SR; const saw = 2 * ((f * t) % 1) - 1; lp += (saw - lp) * 0.2; const s = Math.tanh(lp * 6) * Math.min(1, t * 300) * Math.min(1, (d - t) * 40) * v; add(Math.floor(t0 * SR) + k, s * 0.9, s); } }
  };

  for (let b = 0; b * bar < dur; b++) {
    const c = b % acordes.length; const t = b * bar;
    if (estilo === 'energia') {
      pad(t, acordes[c], bar);
      for (let q = 0; q < 4; q++) { const tb = t + q * beat; if (b > 0 || q >= 2) kick(tb); if (q % 2 && b > 0) caixa(tb); hat(tb + beat / 2, 0.14); if (b > 1) hat(tb, 0.06);
        baixo(tb, raizes[c], beat * 0.45); baixo(tb + beat / 2, raizes[c] + (q === 3 ? 12 : 0), beat * 0.4); }
      if (b > 0) for (let s = 0; s < 8; s++) tecla(t + s * beat / 2, acordes[c][s % 3] + 24 + (s >= 4 ? 12 : 0), 0.07, s % 2 ? 0.7 : 0.3);
    } else if (estilo === 'pop') {
      pad(t, acordes[c], bar, 0.03, 0.03);
      for (let q = 0; q < 4; q++) { const tb = t + q * beat; kick(tb, q % 2 ? 0.5 : 0.85); if (q % 2) caixa(tb, 0.24); hat(tb, 0.08); hat(tb + beat / 2, 0.1);
        baixo(tb, raizes[c], beat * 0.8, 0.3, 0.05); }
      for (let s = 0; s < 4; s++) for (const m of acordes[c]) tecla(t + s * beat + (s === 3 ? beat / 2 : 0), m + 12, 0.05, 0.5, 6);
      for (let s = 0; s < 8; s++) if ([0, 3, 5, 6].includes(s)) tecla(t + s * beat / 2, acordes[c][(s + b) % 3] + 24, 0.06, 0.65, 8);
    } else if (estilo === 'rock') {
      for (let q = 0; q < 4; q++) { const tb = t + q * beat; kick(tb, 0.9); if (q === 2) kick(tb + beat / 2, 0.6); if (q % 2) caixa(tb, 0.38, 16); hat(tb, 0.12); hat(tb + beat / 2, 0.12);
        guitarra(tb, raizes[c] + 12, beat * 0.45); guitarra(tb + beat / 2, raizes[c] + 12, beat * 0.4); baixo(tb, raizes[c], beat * 0.9, 0.3, 0.1); }
    } else if (estilo === 'chill') {
      pad(t, acordes[c], bar, 0.035, 0.02);
      for (let q = 0; q < 4; q++) { const tb = t + q * beat; if (q === 0 || q === 2.5) kick(tb, 0.6); if (q === 2) kick(tb + beat / 2, 0.45); if (q % 2) caixa(tb, 0.14, 30); hat(tb + beat / 2 + 0.02, 0.07); hat(tb, 0.04);
        if (q % 2 === 0) baixo(tb, raizes[c], beat * 1.6, 0.28, 0.03); }
      for (let s = 0; s < 8; s++) if ([0, 2, 3, 6].includes(s)) tecla(t + s * beat / 2 + 0.015, acordes[c][s % 3] + 24, 0.06, s % 2 ? 0.65 : 0.35, 5);
    } else if (estilo === 'epico') {
      pad(t, acordes[c], bar, 0.05, 0.05, 0); pad(t, acordes[c], bar, 0.03, 0.03, 24);
      for (let q = 0; q < 4; q++) { const tb = t + q * beat; kick(tb, 0.95); if (q % 2) caixa(tb, 0.3, 14); if (b >= 2) for (let e = 0; e < 4; e++) hat(tb + e * beat / 4, 0.05);
        tom(tb + beat / 2, q % 2 ? 110 : 82, b >= 1 ? 0.45 : 0.25); }
      baixo(t, raizes[c] - 12, bar * 0.95, 0.35, 0.03);
    }
  }
  let pico = 0;
  for (let i = 0; i < N; i++) { const t = i / SR; const g = Math.min(1, t / 0.3) * Math.min(1, (dur - t) / 2); L[i] = Math.tanh(L[i] * 1.2) * g; R[i] = Math.tanh(R[i] * 1.2) * g; pico = Math.max(pico, Math.abs(L[i]), Math.abs(R[i])); }
  const buf = Buffer.alloc(44 + N * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
  for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(L[i] / pico * 0.89 * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(R[i] / pico * 0.89 * 32767), 46 + i * 4); }
  return buf;
}

const MUSICAS = [
  { id: 'energia', bpm: 124, estilo: 'energia', acordes: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], raizes: [45, 41, 48, 43] },
  { id: 'pop', bpm: 108, estilo: 'pop', acordes: [[48, 52, 55], [55, 59, 62], [57, 60, 64], [53, 57, 60]], raizes: [36, 43, 45, 41] },
  { id: 'rock', bpm: 132, estilo: 'rock', acordes: [[52], [48], [55], [50]], raizes: [40, 36, 43, 38] },
  { id: 'chill', bpm: 88, estilo: 'chill', acordes: [[50, 53, 57, 60], [55, 59, 62, 65], [48, 52, 55, 59], [57, 60, 64, 67]], raizes: [38, 43, 36, 45] },
  { id: 'epico', bpm: 96, estilo: 'epico', acordes: [[50, 53, 57], [46, 50, 53], [41, 45, 48], [48, 52, 55]], raizes: [38, 34, 41, 36] },
];

if (require.main === module) {
  const out = process.argv[2] || '.';
  fs.mkdirSync(out, { recursive: true });
  for (const m of MUSICAS) { fs.writeFileSync(path.join(out, `${m.id}.wav`), trilha({ ...m, dur: 30 })); console.log('ok', m.id); }
}
module.exports = { MUSICAS, trilha };
