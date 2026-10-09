const { all, get } = require('./db');
const config = require('./config');

const CAMBIOS = ['Automático', 'Manual', 'CVT', 'Automatizado'];
const COMBUSTIVEIS = ['Flex', 'Gasolina', 'Etanol', 'Diesel', 'Elétrico', 'Híbrido', 'GNV'];
const CARROCERIAS = ['Hatch', 'Sedã', 'SUV', 'Picape', 'Minivan', 'Perua', 'Cupê', 'Conversível', 'Van', 'Outro'];
const CORES = ['Branco', 'Prata', 'Cinza', 'Preto', 'Vermelho', 'Azul', 'Verde', 'Marrom', 'Bege', 'Amarelo', 'Laranja', 'Dourado', 'Vinho', 'Outra'];

// Itens que valorizam o veículo ou dão transparência (v1.8). grupo = só um do grupo por vez.
const DESTAQUES = [
  { key: 'pericia_aprovada', label: 'Perícia aprovada', texto: 'Laudo de perícia cautelar aprovado', grupo: 'pericia' },
  { key: 'pericia_premium', label: 'Perícia premium', texto: 'Perícia premium: laudo completo aprovado', grupo: 'pericia' },
  { key: 'sem_retoques', label: 'Sem retoques', texto: 'Pintura original, sem retoques' },
  { key: 'pneus_novos', label: 'Pneus novos', texto: 'Pneus novos', grupo: 'pneus' },
  { key: 'pneus_seminovos', label: 'Pneus seminovos', texto: 'Pneus seminovos', grupo: 'pneus' },
  { key: 'unico_dono', label: 'Único dono', texto: 'Único dono' },
  { key: 'revisoes', label: 'Revisões em dia', texto: 'Revisões em dia' },
  { key: 'manual_chave', label: 'Manual e chave reserva', texto: 'Manual e chave reserva' },
  { key: 'ipva_pago', label: 'IPVA pago', texto: 'IPVA pago' },
  { key: 'garantia', label: 'Garantia da loja', texto: 'Garantia da loja' },
  { key: 'aceita_troca', label: 'Aceita troca', texto: 'Aceitamos seu usado na troca' },
  { key: 'financiamento', label: 'Financiamento facilitado', texto: 'Financiamento facilitado' },
  { key: 'blindado', label: 'Blindado', texto: 'Veículo blindado' },
  { key: 'ex_locadora', label: 'Ex-locadora ou ex-táxi', texto: 'Veículo ex-locadora ou ex-táxi', alerta: true, palavras: /locadora|t[áa]xi|frota/i },
  { key: 'leilao', label: 'Possui leilão', texto: 'Veículo com passagem por leilão', alerta: true, palavras: /leil[ãa]o/i },
  { key: 'sinistro', label: 'Indício de sinistro', texto: 'Veículo com indício de sinistro (laudo disponível na loja)', alerta: true, palavras: /sinistro/i },
  { key: 'remarcado', label: 'Chassi ou motor remarcado', texto: 'Chassi ou motor remarcado', alerta: true, palavras: /remarca/i },
];
const DESTAQUE = Object.fromEntries(DESTAQUES.map((d) => [d.key, d]));

function destaquesOf(v) {
  let list = [];
  try { list = JSON.parse(v.destaques || '[]'); } catch { list = []; }
  return Array.isArray(list) ? list.filter((k) => DESTAQUE[k]) : [];
}

// Preço de oferta vale quando é maior que zero e menor que o preço normal.
function ofertaAtiva(v) {
  return !!(v.preco_oferta && v.preco && v.preco_oferta < v.preco);
}
function precoAnuncio(v) { return ofertaAtiva(v) ? v.preco_oferta : v.preco; }

// Descrição usada nos anúncios: a da loja e, se ela não citar, os avisos de transparência marcados.
function descricaoAnuncio(v) {
  const base = String(v.descricao || '').trim() || title(v);
  const faltam = destaquesOf(v).map((k) => DESTAQUE[k]).filter((d) => d.alerta && !d.palavras.test(base));
  return faltam.length ? `${base}\n\n⚠️ Transparência: ${faltam.map((d) => d.texto).join('; ')}.` : base;
}

const mediaUrl = (filename) => `${config.publicUrl}/media/${filename}`;

function daysSince(iso) {
  if (!iso) return 0;
  const t = Date.parse(iso.replace(' ', 'T') + (iso.endsWith('Z') ? '' : 'Z'));
  return Math.max(0, Math.floor((Date.now() - t) / 864e5));
}

function photosOf(vehicleId) {
  return all('SELECT id, filename, mime, position FROM photos WHERE vehicle_id = ? ORDER BY position, id', vehicleId)
    .map((p) => ({ id: p.id, url: mediaUrl(p.filename), filename: p.filename, mime: p.mime }));
}

function title(v) {
  return [v.ano_modelo, v.marca, v.modelo, v.versao].filter(Boolean).join(' ');
}

function serialize(v) {
  if (!v) return null;
  const photos = photosOf(v.id);
  return {
    ...v,
    organico: !!v.organico,
    catalogo: !!v.catalogo,
    titulo: title(v),
    photos,
    destaques: destaquesOf(v),
    oferta_ativa: ofertaAtiva(v),
    preco_anuncio: precoAnuncio(v),
    descricao_anuncio: descricaoAnuncio(v),
    dias_publicado: v.status === 'publicado' ? daysSince(v.publicado_em) : 0,
    artes: require('./arts').listArts(v.id),
    canais: require('./channels').listingsOf(v.id),
    // Uma oferta lançada depois da publicação libera republicar na hora, com o preço novo.
    oferta_nova: v.status === 'publicado' && ofertaAtiva(v) && !!v.oferta_desde && !!v.publicado_em && v.oferta_desde > v.publicado_em,
    pode_republicar: v.status === 'publicado' && (daysSince(v.publicado_em) >= config.republishDays
      || (ofertaAtiva(v) && !!v.oferta_desde && !!v.publicado_em && v.oferta_desde > v.publicado_em)),
  };
}

function findVehicle(storeId, id) {
  return get('SELECT * FROM vehicles WHERE id = ? AND store_id = ?', Number(id), storeId);
}

function listVehicles(storeId) {
  return all(
    `SELECT * FROM vehicles WHERE store_id = ?
     ORDER BY CASE status WHEN 'vendido' THEN 1 ELSE 0 END, updated_at DESC`,
    storeId,
  ).map(serialize);
}

function cleanDestaques(list) {
  const out = [];
  for (const k of Array.isArray(list) ? list : []) {
    const d = DESTAQUE[k];
    if (!d || out.includes(k)) continue;
    if (d.grupo && out.some((x) => DESTAQUE[x].grupo === d.grupo)) continue; // um por grupo
    out.push(k);
  }
  return out;
}

// Validação e normalização do corpo enviado pelo painel.
function cleanInput(body = {}) {
  const int = (x) => {
    const n = parseInt(String(x ?? '').replace(/\D/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
  };
  const str = (x, max = 120) => String(x ?? '').trim().slice(0, max);
  const pick = (x, list) => (list.includes(x) ? x : '');
  const out = {
    marca: str(body.marca, 40),
    modelo: str(body.modelo, 60),
    versao: str(body.versao, 80),
    ano_fab: int(body.ano_fab) || null,
    ano_modelo: int(body.ano_modelo) || null,
    km: int(body.km),
    preco: int(body.preco),
    preco_oferta: int(body.preco_oferta),
    fipe: int(body.fipe),
    placa: str(body.placa, 8).toUpperCase().replace(/[^A-Z0-9]/g, ''),
    cor: pick(body.cor, CORES),
    cor_interna: pick(body.cor_interna, CORES),
    cambio: pick(body.cambio, CAMBIOS),
    combustivel: pick(body.combustivel, COMBUSTIVEIS),
    carroceria: pick(body.carroceria, CARROCERIAS),
    descricao: str(body.descricao, 5000),
    organico: body.organico === false ? 0 : 1,
    catalogo: body.catalogo ? 1 : 0,
    destaques: JSON.stringify(cleanDestaques(body.destaques)),
  };
  if (out.preco_oferta && out.preco && out.preco_oferta >= out.preco) out.preco_oferta = 0;
  const ano = new Date().getFullYear() + 1;
  for (const k of ['ano_fab', 'ano_modelo']) if (out[k] && (out[k] < 1950 || out[k] > ano)) out[k] = null;
  return out;
}

function missingForPublish(v, photoCount) {
  const faltam = [];
  if (!v.marca) faltam.push('marca');
  if (!v.modelo) faltam.push('modelo');
  if (!v.ano_modelo) faltam.push('ano do modelo');
  if (!v.preco) faltam.push('preço');
  if (!v.km && v.km !== 0) faltam.push('quilometragem');
  if (!photoCount) faltam.push('ao menos 1 foto');
  return faltam;
}

module.exports = {
  CAMBIOS, COMBUSTIVEIS, CARROCERIAS, CORES, DESTAQUES, DESTAQUE, destaquesOf, ofertaAtiva, precoAnuncio, descricaoAnuncio,
  serialize, findVehicle, listVehicles, cleanInput, missingForPublish, photosOf, title, daysSince, mediaUrl,
};
