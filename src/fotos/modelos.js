// Modelos de ensaio fotográfico e montagem do comando enviado à IA de imagem.
// Cada modelo tem um cenário e variações (luz, posição da câmera no mesmo local) para que 7–10 fotos não fiquem repetidas.

const MODELOS = [
  {
    id: '01', nome: 'Estacionamento aberto com cidade ao fundo', conceito: 'Urbano, moderno e profissional',
    descricao: 'Estacionamento amplo, limpo e vazio, com prédios e a paisagem da cidade ao fundo. Luz natural de manhã ou fim de tarde.',
    cena: 'a wide, clean and completely empty open-air parking lot with smooth asphalt and fresh white lines, a modern city skyline and buildings in the far background',
    variacoes: ['soft early-morning daylight, clear sky', 'warm late-afternoon golden light, long soft shadows', 'bright midday light with a few white clouds', 'soft overcast daylight, even reflections'],
    cores: ['#8fb3d9', '#e8c48a', '#5a6270'],
  },
  {
    id: '02', nome: 'Natureza: gramado e árvores', conceito: 'Fotografia automotiva em ambiente natural',
    descricao: 'Área pavimentada junto a um gramado bem cuidado, árvores e vegetação ao fundo, luz natural equilibrada e profundidade de campo.',
    cena: 'a clean paved area next to a well-kept green lawn, mature trees and soft vegetation in the background with natural depth of field, nothing competing with the car',
    variacoes: ['balanced natural daylight', 'soft morning light filtering through the trees', 'warm afternoon light', 'soft overcast light, rich green tones'],
    cores: ['#9cc98a', '#3f7a3a', '#c9d9a8'],
  },
  {
    id: '03', nome: 'Estacionamento coberto premium', conceito: 'Concessionária moderna',
    descricao: 'Estacionamento coberto, amplo e organizado, piso de concreto polido, estrutura moderna e iluminação uniforme sem reflexos exagerados.',
    cena: 'a spacious, organized and empty modern covered parking garage with polished concrete floor, clean painted lines and contemporary architecture',
    variacoes: ['even soft overhead LED lighting', 'mixed soft daylight entering from the open side', 'cool neutral lighting with subtle floor reflections', 'warm architectural lighting'],
    cores: ['#9aa0a8', '#d7dade', '#4b5058'],
  },
  {
    id: '04', nome: 'Showroom de luxo', conceito: 'Apresentação sofisticada',
    descricao: 'Showroom moderno e elegante, porcelanato polido, iluminação arquitetônica, paredes neutras e vidro, sem outros carros em destaque.',
    cena: 'an elegant modern luxury car showroom with polished large-format porcelain floor, neutral walls, glass panels and professional architectural lighting, no other cars in focus',
    variacoes: ['bright professional showroom lighting', 'warm accent lighting with soft floor reflections', 'daylight through large glass windows', 'dramatic but soft spotlights on the car'],
    cores: ['#f0ece4', '#c8b896', '#2b2b2e'],
  },
  {
    id: '05', nome: 'Arquitetura moderna', conceito: 'Campanha publicitária urbana',
    descricao: 'Edifícios modernos ao fundo, fachadas de vidro e concreto, estacionamento amplo e conservado, linhas arquitetônicas valorizando o carro.',
    cena: 'a well-kept open parking area in front of contemporary architecture with glass and exposed concrete facades, strong architectural lines that frame the car like an automotive ad campaign',
    variacoes: ['clean natural daylight', 'blue-hour light with the building lights on', 'warm low sun reflecting on the glass facade', 'soft overcast light, minimalist look'],
    cores: ['#b8c4cc', '#6d7a84', '#e9edf0'],
  },
  {
    id: '06', nome: 'Estrada cênica', conceito: 'Lifestyle e liberdade',
    descricao: 'Carro parado em acostamento seguro ou mirante, estrada vazia e paisagem aberta (serra ou campo), céu limpo.',
    cena: 'a safe wide road shoulder at a scenic viewpoint, an empty road and open landscape with hills and fields, clear sky',
    variacoes: ['golden-hour sunlight', 'bright clear morning', 'soft sunset with warm sky', 'late-afternoon light with dramatic clouds'],
    cores: ['#f2b56b', '#7aa0c4', '#5b7d4a'],
  },
  {
    id: '07', nome: 'Estúdio fundo infinito', conceito: 'Catálogo profissional',
    descricao: 'Estúdio fotográfico com fundo infinito cinza-claro, luz de softbox e sombra suave sob o carro.',
    cena: 'a professional photo studio with a seamless light-grey infinity cyclorama background and floor',
    variacoes: ['large softbox lighting, soft contact shadow', 'gradient lighting from light to slightly darker grey', 'clean high-key lighting', 'side softbox with gentle highlights along the body'],
    cores: ['#e6e6e6', '#bdbdbd', '#ffffff'],
  },
  {
    id: '08', nome: 'Noturno urbano', conceito: 'Impacto e sofisticação',
    descricao: 'Rua ou praça urbana à noite, piso levemente molhado, luzes da cidade desfocadas e o carro bem iluminado.',
    cena: 'a clean urban plaza at night with a slightly wet pavement, blurred city lights (bokeh) in the background, the car well and evenly lit',
    variacoes: ['blue-hour twilight sky', 'night with warm street lights', 'night with cool neon accents far in the background', 'night with soft reflections on the wet ground'],
    cores: ['#1b2440', '#e0a84a', '#3b4f80'],
  },
];

const PERSONALIZADO = {
  id: 'P', nome: 'Personalizado', conceito: 'O cenário da sua loja',
  descricao: 'Descreva o cenário e, se quiser, envie uma foto de referência (por exemplo, o pátio ou a fachada da loja).',
  variacoes: ['natural daylight', 'warm late-afternoon light', 'soft even light', 'bright morning light'], cores: ['#efa91c', '#2b2f36', '#fdf1d6'],
};

const doId = (id) => MODELOS.find((m) => m.id === id) || (id === 'P' ? PERSONALIZADO : null);

const FORMATOS = {
  '4:5': { nome: 'Vertical 4:5 (feed, Marketplace)', w: 1080, h: 1350 },
  '1:1': { nome: 'Quadrado 1:1', w: 1080, h: 1080 },
  '9:16': { nome: 'Stories 9:16', w: 1080, h: 1920 },
  '4:3': { nome: 'Horizontal 4:3 (portais)', w: 1440, h: 1080 },
  '16:9': { nome: 'Horizontal 16:9', w: 1920, h: 1080 },
};
const PLACA = {
  manter: { nome: 'Manter a placa como está', en: 'Keep the license plate exactly as it is (same characters, do not invent or change them).', pt: 'Mantenha a placa exatamente como está.' },
  borrar: { nome: 'Borrar a placa', en: 'Blur the license plate strongly so the characters cannot be read, keeping the plate shape.', pt: 'Borre a placa para que não seja possível ler os caracteres.' },
  loja: { nome: 'Placa com o nome da loja', en: 'Replace only the characters of the license plate with the text "{LOJA}" in a clean style on the same plate, keeping its size and position.', pt: 'Troque só os caracteres da placa pelo texto "{LOJA}", mantendo o tamanho e a posição da placa.' },
};
const TIPOS = { auto: 'Detectar sozinho', exterior: 'Exterior', interior: 'Interior', detalhe: 'Detalhe' };

function cenaDe(ensaio) {
  const m = doId(ensaio.modelo) || MODELOS[0];
  if (m.id !== 'P') return m.cena;
  const t = String(ensaio.personalizado?.texto || '').trim();
  const ref = ensaio.personalizado?.referencia ? 'the location shown in the second (reference) image, reproduced faithfully' : '';
  return [ref, t ? `this setting (described by the dealer in Portuguese): "${t}"` : ''].filter(Boolean).join(', ') || 'a clean, empty, professional car dealership lot';
}

/**
 * Comando em inglês para a IA de imagem (uma foto).
 * @param {object} o { ensaio, variacao, tipo, instrucao, formato }
 */
function prompt({ ensaio, variacao = 0, tipo = 'auto', instrucao = '' }) {
  const m = doId(ensaio.modelo) || MODELOS[0];
  const luz = m.variacoes[variacao % m.variacoes.length];
  const loja = String(ensaio.loja?.nome || 'LOJA').toUpperCase().slice(0, 12);
  const placa = (PLACA[ensaio.placa_modo] || PLACA.manter).en.replace('{LOJA}', loja);
  const f = FORMATOS[ensaio.formato] || FORMATOS['4:5'];
  const partes = [
    'You are a professional automotive photo retoucher preparing a used-car listing photo for a dealership.',
    'FIDELITY IS MANDATORY: keep the exact same vehicle from the first image — same make, model, generation and trim, same paint color and finish, same wheels and tires, headlights, taillights, grille, badges, stickers, body lines, ride height, accessories, interior and any scratches, dents or wear. Do not repair, restyle, clean up, add or remove anything on the car. Keep the same camera angle, lens perspective and framing of the car.',
    tipo === 'interior' || tipo === 'detalhe'
      ? 'This is an interior or close-up detail photo: keep every element identical; only improve lighting and exposure naturally and make whatever is visible through the windows match the new setting.'
      : tipo === 'exterior'
        ? `Replace only the surroundings with ${cenaDe(ensaio)}, ${luz}.`
        : `If this is an exterior photo, replace only the surroundings with ${cenaDe(ensaio)}, ${luz}. If it is an interior or close-up detail photo, keep everything identical and only improve the lighting and what is visible through the windows.`,
    placa,
    'Remove any people, other vehicles, text, watermarks and logos that are not part of the car itself.',
    'Add realistic contact shadows under the tires and reflections on the paint and glass that match the new environment.',
    'The result must look like a real, unedited high-end photograph, not a 3D render or illustration.',
    `Output a ${ensaio.formato || '4:5'} image (${f.w}x${f.h}) with the whole car visible and not cropped.`,
  ];
  if (instrucao) partes.push(`Additional request from the dealer (in Portuguese), apply it without changing the car: "${String(instrucao).slice(0, 300)}".`);
  return partes.join(' ');
}

// Ângulos novos que a IA pode criar quando há poucas fotos (v2: pedido da loja).
// Interior só é criado se houver ao menos uma foto real do interior (não se inventa um interior que ninguém viu).
const ANGULOS_NOVOS = [
  { id: 'f34e', nome: 'Frente 3/4 (diagonal dianteira)', en: 'a front three-quarter view from the front-left diagonal, the classic dealership hero shot', grupo: 'exterior' },
  { id: 't34d', nome: 'Traseira 3/4 (diagonal traseira)', en: 'a rear three-quarter view from the rear-right diagonal', grupo: 'exterior' },
  { id: 'lat', nome: 'Lateral inteira', en: 'a full side profile view, camera at wheel height, the whole car visible', grupo: 'exterior' },
  { id: 'painel', nome: 'Painel e volante', en: 'an interior view of the dashboard and steering wheel from the driver door', grupo: 'interior' },
  { id: 'f34d', nome: 'Frente 3/4 do outro lado', en: 'a front three-quarter view from the front-right diagonal', grupo: 'exterior' },
  { id: 'fr', nome: 'Frente reta', en: 'a straight frontal view, centered, at headlight height', grupo: 'exterior' },
  { id: 'tr', nome: 'Traseira reta', en: 'a straight rear view, centered, at taillight height', grupo: 'exterior' },
  { id: 'bancos', nome: 'Bancos dianteiros', en: 'an interior view of the front seats from the open rear door', grupo: 'interior' },
  { id: 't34e', nome: 'Traseira 3/4 do outro lado', en: 'a rear three-quarter view from the rear-left diagonal', grupo: 'exterior' },
  { id: 'roda', nome: 'Detalhe da roda', en: 'a close-up detail of the front wheel and tire', grupo: 'exterior' },
  { id: 'farol', nome: 'Detalhe do farol', en: 'a close-up detail of the headlight and front grille', grupo: 'exterior' },
];

function promptNovoAngulo({ ensaio, angulo, variacao = 0, instrucao = '', nRef = 1 }) {
  const m = doId(ensaio.modelo) || MODELOS[0];
  const luz = m.variacoes[variacao % m.variacoes.length];
  const a = ANGULOS_NOVOS.find((x) => x.id === angulo) || ANGULOS_NOVOS[0];
  const loja = String(ensaio.loja?.nome || 'LOJA').toUpperCase().slice(0, 12);
  const f = FORMATOS[ensaio.formato] || FORMATOS['4:5'];
  const partes = [
    `You are a professional automotive photographer. The ${nRef > 1 ? `first ${nRef} images are reference photos` : 'first image is a reference photo'} of ONE specific used car.`,
    `Create a NEW, realistic photograph of THIS EXACT SAME CAR seen from ${a.en}.`,
    'The car must be identical to the reference: same make, model, generation and trim, same paint color and finish, same wheel design and tires, lights, grille, badges, stickers, accessories, ride height and any visible scratches or dents.',
    'For parts of the car that are not visible in the references, follow the factory design of this exact model and trim; do not invent accessories, stickers, body kits, damages or colors.',
    a.grupo === 'interior'
      ? 'Interior: reproduce the same interior colors, materials and equipment shown in the references, with natural light; through the windows show the setting below.'
      : `Setting: ${cenaDe(ensaio)}, ${luz}.`,
    (PLACA[ensaio.placa_modo] || PLACA.manter).en.replace('{LOJA}', loja).replace('exactly as it is', 'with the same characters as in the reference').replace('Keep the license plate', 'Show the license plate'),
    'No people, no other vehicles in focus, no text, watermarks or logos outside the car. Realistic contact shadows and reflections.',
    'It must look like a real, unedited high-end photograph, not a 3D render or illustration.',
    `Output a ${ensaio.formato || '4:5'} image (${f.w}x${f.h}) with the whole subject in frame.`,
  ];
  if (instrucao) partes.push(`Additional request from the dealer (in Portuguese), apply it without changing the car: "${String(instrucao).slice(0, 300)}".`);
  return partes.join(' ');
}

// Versão em português, para gerar à mão no ChatGPT ou no Gemini (aplicativos gratuitos).
function promptPt({ ensaio, variacao = 0, instrucao = '', angulo = '' }) {
  if (angulo) {
    const a = ANGULOS_NOVOS.find((x) => x.id === angulo) || ANGULOS_NOVOS[0];
    const m = doId(ensaio.modelo) || MODELOS[0];
    const cen = m.id === 'P' ? (ensaio.personalizado?.texto || 'o cenário da foto de referência') : m.descricao.toLowerCase();
    return `Anexe as fotos do carro. Crie uma NOVA fotografia realista DESTE MESMO carro vista de: ${a.nome.toLowerCase()}. O carro deve ser idêntico ao das fotos (marca, modelo, versão, cor, rodas, faróis, grade, emblemas, acessórios e avarias). O que não aparece nas fotos deve seguir o projeto de fábrica deste modelo, sem inventar acessórios, adesivos ou cores. Cenário: ${cen.replace(/\.$/, '')}. Sem pessoas, outros carros ou textos. Deve parecer uma foto real, formato ${ensaio.formato || '4:5'}.${instrucao ? ` Pedido extra: ${instrucao}` : ''}`;
  }
  const m = doId(ensaio.modelo) || MODELOS[0];
  const cenario = m.id === 'P' ? (ensaio.personalizado?.texto || 'o cenário da foto de referência') : m.descricao.toLowerCase();
  const luzPt = ['luz natural suave', 'luz dourada do fim da tarde', 'luz clara do dia', 'luz suave e uniforme'][variacao % 4];
  const loja = String(ensaio.loja?.nome || 'LOJA').toUpperCase().slice(0, 12);
  return [
    'Edite esta foto de um carro usado para o anúncio de uma loja.',
    'Mantenha EXATAMENTE o mesmo carro: marca, modelo, versão, cor, rodas, faróis, grade, emblemas, acessórios, interior e até riscos e amassados. Não conserte nem mude nada no carro e mantenha o mesmo ângulo da câmera.',
    `Troque somente o ambiente por: ${cenario.replace(/\.$/, '')}, com ${luzPt}. Se for uma foto do interior ou de um detalhe, mantenha tudo igual e só melhore a luz.`,
    (PLACA[ensaio.placa_modo] || PLACA.manter).pt.replace('{LOJA}', loja),
    'Tire pessoas, outros carros, textos e marcas-d\'água. Coloque sombra realista sob os pneus e reflexos coerentes com o novo lugar.',
    `O resultado deve parecer uma fotografia real, no formato ${ensaio.formato || '4:5'}, com o carro inteiro aparecendo.`,
    instrucao ? `Pedido extra: ${instrucao}` : '',
  ].filter(Boolean).join(' ');
}

// Distribui N fotos: primeiro uma por foto original (mesmo ângulo, troca o ambiente).
// Se faltar foto e "novos ângulos" estiver ligado, a IA cria os ângulos que faltam a partir de todas as originais;
// desligado, as que faltam são variações (luz e enquadramento) dos mesmos ângulos.
function plano(originais, quantidade, novosAngulos = true) {
  const n = originais.length;
  if (!n) return [];
  const temInterior = originais.some((o) => o.tipo === 'interior');
  const angulos = ANGULOS_NOVOS.filter((a) => a.grupo === 'exterior' || temInterior);
  const out = [];
  for (let i = 0; i < quantidade; i++) {
    if (i < n || !novosAngulos) out.push({ ordem: i + 1, original_id: originais[i % n].id, variacao: i, angulo: '' });
    else out.push({ ordem: i + 1, original_id: originais[0].id, variacao: i, angulo: angulos[(i - n) % angulos.length].id });
  }
  return out;
}

// Lista do que fotografar quando há poucas fotos (o app não inventa ângulos).
const ANGULOS_SUGERIDOS = ['Frente 3/4 (diagonal dianteira)', 'Traseira 3/4 (diagonal traseira)', 'Lateral inteira', 'Frente reta', 'Traseira reta', 'Painel e volante', 'Bancos dianteiros', 'Bancos traseiros', 'Roda e pneu', 'Porta-malas'];

const publico = () => ({
  modelos: [...MODELOS, PERSONALIZADO].map(({ id, nome, conceito, descricao, cores }) => ({ id, nome, conceito, descricao, cores })),
  formatos: Object.fromEntries(Object.entries(FORMATOS).map(([k, v]) => [k, v.nome])),
  placa: Object.fromEntries(Object.entries(PLACA).map(([k, v]) => [k, v.nome])),
  tipos: TIPOS, angulos: ANGULOS_SUGERIDOS, angulos_novos: Object.fromEntries(ANGULOS_NOVOS.map((a) => [a.id, a.nome])), quantidades: [7, 8, 9, 10],
});

module.exports = { MODELOS, PERSONALIZADO, FORMATOS, PLACA, TIPOS, ANGULOS_NOVOS, doId, prompt, promptNovoAngulo, promptPt, plano, publico };
