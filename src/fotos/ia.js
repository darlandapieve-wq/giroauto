// Provedores de IA de imagem: Google Gemini (principal), Pollinations (alternativa com cota grátis),
// "manual" (o usuário gera no ChatGPT/Gemini e envia) e "simulado" (teste sem custo).
// Verificação de fidelidade: Gemini (texto + visão) ou Claude, comparando original × gerada.
const sharp = require('sharp');

class IAErro extends Error { constructor(msg, status) { super(msg); this.status = status; } }

/* ---------------- Gemini ---------------- */
const GEMINI = () => (process.env.GEMINI_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
const MODELO_IMAGEM = 'gemini-nano-banana-2.1'; // o mesmo padrão do src/arts/gemini.js
const FALLBACK_IMAGEM = ['gemini-3.1-flash-lite-image', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image'];
const MODELOS_TEXTO = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite'];

async function geminiCall(modelo, chave, body, versao = 'v1beta') {
  const r = await fetch(`${GEMINI()}/${versao}/models/${encodeURIComponent(modelo)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(150000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new IAErro(data?.error?.message || `Erro ${r.status} na IA do Google`, r.status);
  return data;
}

function imagemDe(data) {
  for (const c of data?.candidates || []) for (const p of c?.content?.parts || []) {
    const d = p.inlineData || p.inline_data;
    if (d?.data && !p.thought) return Buffer.from(d.data, 'base64');
  }
  const motivo = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason;
  throw new IAErro(motivo ? `A IA não devolveu imagem (${motivo}).` : 'A IA não devolveu imagem.', 502);
}

const RATIOS_GEMINI = ['1:1', '4:5', '9:16', '4:3', '16:9'];

async function geminiEditar({ chave, modelo, foto, fotos, referencia, prompt, formato = '4:5', resolucao = '1K' }) {
  const parts = [{ text: prompt }, ...(fotos || [foto]).map((f) => ({ inline_data: { mime_type: 'image/jpeg', data: f.toString('base64') } }))];
  if (referencia) parts.push({ inline_data: { mime_type: 'image/jpeg', data: referencia.toString('base64') } });
  const aspectRatio = RATIOS_GEMINI.includes(formato) ? formato : '4:5';
  const lista = [modelo || MODELO_IMAGEM, ...FALLBACK_IMAGEM.filter((m) => m !== modelo)];
  let ultimo;
  for (const m of lista) {
    const tentativas = [
      ['v1', { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'], responseFormat: { image: { aspectRatio, imageSize: resolucao } } } }],
      ['v1beta', { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio, imageSize: resolucao } } }],
      ['v1beta', { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio } } }],
    ];
    for (const [versao, body] of tentativas) {
      try { return { imagem: imagemDe(await geminiCall(m, chave, body, versao)), modelo: m }; }
      catch (e) {
        ultimo = e;
        if ([401, 403, 429].includes(e.status)) throw e; // chave, permissão ou cota
        if (e.status === 404) break; // modelo inexistente: próximo
      }
    }
  }
  throw ultimo || new IAErro('Não foi possível gerar a imagem.', 502);
}

async function geminiTestar(chave) {
  const r = await fetch(`${GEMINI()}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': chave } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new IAErro(data?.error?.message || `Erro ${r.status}`, r.status);
  return (data.models || []).map((m) => String(m.name || '').replace(/^models\//, ''));
}

/* ---------------- Pollinations ---------------- */
const POLLI = () => (process.env.POLLINATIONS_URL || 'https://gen.pollinations.ai').replace(/\/+$/, '');
async function pollinationsEditar({ chave, modelo, foto, prompt }) {
  const fd = new FormData();
  fd.append('model', modelo || 'kontext');
  fd.append('prompt', prompt);
  fd.append('image', new Blob([foto], { type: 'image/jpeg' }), 'carro.jpg');
  const r = await fetch(`${POLLI()}/v1/images/edits`, { method: 'POST', headers: { Authorization: `Bearer ${chave}` }, body: fd, signal: AbortSignal.timeout(180000) });
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new IAErro(`Pollinations: ${t.slice(0, 200) || r.status}`, r.status); }
  const tipo = r.headers.get('content-type') || '';
  if (tipo.startsWith('image/')) return { imagem: Buffer.from(await r.arrayBuffer()), modelo: modelo || 'kontext' };
  const j = await r.json().catch(() => ({}));
  const it = j?.data?.[0] || {};
  if (it.b64_json) return { imagem: Buffer.from(it.b64_json, 'base64'), modelo: modelo || 'kontext' };
  if (it.url) { const i = await fetch(it.url); if (i.ok) return { imagem: Buffer.from(await i.arrayBuffer()), modelo: modelo || 'kontext' }; }
  throw new IAErro('A Pollinations não devolveu imagem.', 502);
}

/* ---------------- Simulado (teste sem custo) ---------------- */
// Recorta a foto original sobre um fundo com as cores do modelo: serve para testar o fluxo inteiro.
async function simuladoEditar({ foto, cores = ['#8fb3d9', '#e8c48a', '#5a6270'], w = 1080, h = 1350, rotulo = '' }) {
  const fundo = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${cores[0]}"/><stop offset=".62" stop-color="${cores[1]}"/><stop offset="1" stop-color="${cores[2]}"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <text x="40" y="${h - 40}" font-family="sans-serif" font-size="28" fill="rgba(0,0,0,.45)">SIMULADO ${rotulo}</text></svg>`);
  const carro = await sharp(foto).rotate().resize(Math.round(w * 0.9), Math.round(h * 0.7), { fit: 'inside' }).toBuffer();
  const meta = await sharp(carro).metadata();
  await new Promise((r) => setTimeout(r, 300));
  return {
    imagem: await sharp(fundo).composite([{ input: carro, left: Math.round((w - meta.width) / 2), top: Math.round((h - meta.height) / 2) }]).jpeg({ quality: 88 }).toBuffer(),
    modelo: 'simulado',
  };
}

/* ---------------- Verificação de fidelidade ---------------- */
const INSTRUCAO_FIDELIDADE = 'Compare the CAR in image 1 (original) with the CAR in image 2 (edited). Ignore the background, lighting and license plate. Check make/model, color, wheels, lights, grille, badges, body shape, accessories, damages and interior. Answer only JSON: {"nota": 0-10 (10 = identical car), "diferencas": ["short description in Brazilian Portuguese", ...]}.';

function lerJson(texto) {
  const m = String(texto || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const nota = Math.max(0, Math.min(10, Number(j.nota)));
    if (!Number.isFinite(nota)) return null;
    return { nota, diferencas: (Array.isArray(j.diferencas) ? j.diferencas : []).map((d) => String(d).slice(0, 160)).slice(0, 5) };
  } catch { return null; }
}

const pequena = (b) => sharp(b).rotate().resize(768, 768, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();

async function verificar({ original, gerada, geminiKey, anthropicKey }) {
  const [a, b] = await Promise.all([pequena(original), pequena(gerada)]);
  if (anthropicKey) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(60000),
      headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODELO || 'claude-haiku-5-5', max_tokens: 400,
        messages: [{ role: 'user', content: [
          { type: 'text', text: 'Image 1:' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: a.toString('base64') } },
          { type: 'text', text: 'Image 2:' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b.toString('base64') } },
          { type: 'text', text: INSTRUCAO_FIDELIDADE }] }],
      }),
    });
    if (r.ok) { const j = await r.json(); const out = lerJson(j.content?.find((c) => c.type === 'text')?.text); if (out) return { ...out, por: 'Claude' }; }
  }
  if (geminiKey) {
    const parts = [{ text: 'Image 1:' }, { inline_data: { mime_type: 'image/jpeg', data: a.toString('base64') } }, { text: 'Image 2:' }, { inline_data: { mime_type: 'image/jpeg', data: b.toString('base64') } }, { text: INSTRUCAO_FIDELIDADE }];
    for (const m of MODELOS_TEXTO) {
      try {
        const d = await geminiCall(m, geminiKey, { contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } });
        const out = lerJson(d?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join(''));
        if (out) return { ...out, por: 'Gemini' };
      } catch (e) { if ([401, 403, 429].includes(e.status)) break; }
    }
  }
  return null;
}

function amigavel(e, provedor) {
  const msg = String(e?.message || e);
  if (provedor === 'gemini') {
    if (e?.status === 429 || /quota|rate/i.test(msg)) return 'Limite de uso da IA do Google atingido. Confira o faturamento da chave no Google AI Studio.';
    if (e?.status === 401 || e?.status === 403 || /api key/i.test(msg)) return 'A chave da IA do Google foi recusada. Confira em Configurações.';
    if (/billing|free tier/i.test(msg)) return 'A IA de imagens do Google exige faturamento ativo na chave (Google AI Studio > Faturamento).';
  }
  if (provedor === 'pollinations' && (e?.status === 402 || e?.status === 429 || /pollen|balance|insufficient/i.test(msg))) return 'Os créditos (Pollen) da Pollinations acabaram.';
  return msg.slice(0, 300);
}

module.exports = { geminiEditar, geminiTestar, pollinationsEditar, simuladoEditar, verificar, amigavel, IAErro, MODELO_IMAGEM, lerJson };
