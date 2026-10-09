// Edição de fotos pela Pollinations (pollinations.ai): plataforma aberta com cota gratuita diária
// para contas cadastradas. Usa um modelo de edição (FLUX Kontext) para trocar o fundo da foto.
const BASE = () => (process.env.POLLINATIONS_URL || 'https://gen.pollinations.ai').replace(/\/+$/, '');
const DEFAULT_MODEL = 'kontext';

class PollinationsError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function readImage(r) {
  const type = r.headers.get('content-type') || '';
  if (type.startsWith('image/')) return Buffer.from(await r.arrayBuffer());
  const data = await r.json().catch(() => ({}));
  const item = data?.data?.[0] || {};
  if (item.b64_json) return Buffer.from(item.b64_json, 'base64');
  if (item.url) {
    const img = await fetch(item.url);
    if (img.ok) return Buffer.from(await img.arrayBuffer());
  }
  throw new PollinationsError(data?.error?.message || data?.error || 'A Pollinations não devolveu imagem.', 502);
}

async function errorFrom(r) {
  const text = await r.text().catch(() => '');
  let msg = text;
  try { const j = JSON.parse(text); msg = j?.error?.message || j?.error || j?.message || text; } catch { /* texto puro */ }
  return new PollinationsError(String(msg || `Erro ${r.status}`).slice(0, 300), r.status);
}

/**
 * @param {{apiKey: string, model?: string, photo: Buffer, mime?: string, prompt: string, photoUrl?: string}} o
 * @returns {Promise<{image: Buffer, model: string}>}
 */
async function edit({ apiKey, model, photo, mime, prompt, photoUrl }) {
  const m = model || DEFAULT_MODEL;
  // 1) Endpoint compatível com a OpenAI: envia a foto.
  const fd = new FormData();
  fd.append('model', m);
  fd.append('prompt', prompt);
  fd.append('image', new Blob([photo], { type: mime || 'image/jpeg' }), 'carro.jpg');
  let r = await fetch(`${BASE()}/v1/images/edits`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: fd });
  if (r.ok) return { image: await readImage(r), model: m };
  const first = await errorFrom(r);
  if ([401, 402, 403, 429].includes(first.status) || !photoUrl) throw first;
  // 2) Alternativa: endpoint simples com a foto por endereço público.
  const u = new URL(`${BASE()}/image/${encodeURIComponent(prompt)}`);
  u.searchParams.set('model', m);
  u.searchParams.set('image', photoUrl);
  u.searchParams.set('width', '1080');
  u.searchParams.set('height', '1350');
  u.searchParams.set('nologo', 'true');
  r = await fetch(u, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (r.ok) return { image: await readImage(r), model: m };
  throw await errorFrom(r);
}

function friendly(e) {
  const msg = String(e?.message || e);
  if (e?.status === 402 || e?.status === 429 || /pollen|balance|quota|limit|insufficient/i.test(msg)) return 'Cota gratuita do dia da Pollinations acabou. O GiroAuto tenta de novo mais tarde, sozinho.';
  if (e?.status === 401 || e?.status === 403) return 'A chave da Pollinations foi recusada. Confira em Configurações > Imagens com IA.';
  return `Pollinations: ${msg.slice(0, 250)}`;
}

module.exports = { edit, friendly, DEFAULT_MODEL, PollinationsError };
