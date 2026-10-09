// Edição de fotos com a IA de imagens do Google (Gemini): coloca o carro num estacionamento vazio.
const BASE = () => (process.env.GEMINI_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
const DEFAULT_MODEL = 'gemini-nano-banana-2.1';
// Se o modelo escolhido não existir na conta, tenta estes, nesta ordem.
const FALLBACK_MODELS = ['gemini-3.1-flash-lite-image', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image'];

const SCENES = [
  'an empty, clean open-air parking lot on a sunny day, fresh white parking lines on dark asphalt, a few trees and a modern building far in the background, soft natural daylight',
  'an empty parking lot at golden hour, warm low sunlight, long soft shadows, clear sky, nobody around',
  'an empty modern covered parking garage, polished concrete floor, clean white lines, even soft overhead lighting',
  'an empty rooftop parking lot under a clear blue sky with a distant city skyline, bright daylight',
];

function prompt(scene) {
  return [
    'Edit this photo of a used car for a dealership listing.',
    `Keep the exact same car: same make, model, color, wheels, body shape, license plate area, damages and details. Do not change, restyle, clean up or add anything to the car itself, and keep the same camera angle.`,
    `Replace only the surroundings with ${scene}.`,
    'Remove any other cars, people, text, watermarks and logos that are not on the car.',
    'The result must look like a real, unedited photograph with realistic reflections and shadows under the car.',
  ].join(' ');
}

class GeminiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function call(model, apiKey, body, version) {
  const r = await fetch(`${BASE()}/${version}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new GeminiError(data?.error?.message || `Erro ${r.status} na IA do Google`, r.status);
  return data;
}

function imageFrom(data) {
  for (const c of data?.candidates || []) {
    for (const p of c?.content?.parts || []) {
      const d = p.inlineData || p.inline_data;
      if (d?.data && !p.thought) return Buffer.from(d.data, 'base64');
    }
  }
  const reason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason;
  throw new GeminiError(reason ? `A IA não devolveu imagem (${reason}).` : 'A IA não devolveu imagem.', 502);
}

/**
 * Gera a foto do carro num estacionamento.
 * @returns {Promise<{image: Buffer, model: string}>}
 */
async function parkingShot({ apiKey, model, photo, mime, sceneIndex }) {
  const parts = [{ text: prompt(SCENES[sceneIndex % SCENES.length]) }, { inline_data: { mime_type: mime || 'image/jpeg', data: photo.toString('base64') } }];
  const models = [model || DEFAULT_MODEL, ...FALLBACK_MODELS.filter((m) => m !== model)];
  let lastErr;
  for (const m of models) {
    // Formato atual (v1, responseFormat) e, se a conta ainda usar o anterior, v1beta com imageConfig.
    const attempts = [
      ['v1', { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'], responseFormat: { image: { aspectRatio: '4:5', imageSize: '1K' } } } }],
      ['v1beta', { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '4:5' } } }],
    ];
    for (const [version, body] of attempts) {
      try {
        return { image: imageFrom(await call(m, apiKey, body, version)), model: m };
      } catch (e) {
        lastErr = e;
        if (e.status === 401 || e.status === 403 || e.status === 429) throw e; // chave, permissão ou cota: não adianta insistir
        if (e.status === 404) break; // modelo não existe: próximo modelo
        // 400 (formato) tenta o formato seguinte; outros erros também.
      }
    }
  }
  throw lastErr || new GeminiError('Não foi possível gerar a imagem.', 502);
}

// Confere se a chave funciona (lista os modelos da conta).
async function checkKey(apiKey) {
  const r = await fetch(`${BASE()}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new GeminiError(data?.error?.message || `Erro ${r.status}`, r.status);
  return (data.models || []).map((m) => String(m.name || '').replace(/^models\//, ''));
}

function friendly(e) {
  const msg = String(e?.message || e);
  if (e?.status === 429 || /quota|rate/i.test(msg)) return 'Limite de uso da IA do Google atingido. Confira o faturamento da chave no Google AI Studio.';
  if (e?.status === 401 || e?.status === 403 || /api key/i.test(msg)) return 'A chave da IA do Google foi recusada. Confira em Configurações > Imagens com IA.';
  if (/billing|faturamento|free tier/i.test(msg)) return 'A IA de imagens do Google exige faturamento ativo na chave (Google AI Studio > Faturamento).';
  return msg.slice(0, 300);
}

const promptFor = (i) => prompt(SCENES[i % SCENES.length]);

// Instruções em português para usar no ChatGPT ou no Gemini (aplicativos gratuitos), à mão.
const CENAS_PT = [
  'um estacionamento aberto vazio, limpo, num dia de sol, com faixas brancas novas no asfalto escuro e algumas árvores e um prédio moderno ao fundo',
  'um estacionamento vazio no fim da tarde, com luz dourada do sol, sombras longas e céu limpo',
  'um estacionamento coberto moderno e vazio, com piso de concreto polido, faixas brancas e iluminação suave',
  'um estacionamento vazio no alto de um prédio, com céu azul e a cidade ao fundo, de dia',
];
function promptPt(i) {
  return `Edite esta foto de um carro usado para um anúncio de loja. Mantenha exatamente o mesmo carro: mesma marca, modelo, cor, rodas, formato, placa e detalhes, sem mudar nada no carro, e o mesmo ângulo da câmera. Troque somente o fundo por ${CENAS_PT[i % CENAS_PT.length]}. Tire outros carros, pessoas, textos e marcas d'água. O resultado deve parecer uma fotografia real, com reflexos e sombra realistas embaixo do carro, no formato vertical 4:5.`;
}

module.exports = { promptFor, promptPt, parkingShot, checkKey, friendly, DEFAULT_MODEL, SCENES, GeminiError };
