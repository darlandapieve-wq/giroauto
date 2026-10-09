const { all, get } = require('./db');
const config = require('./config');

const CAMBIOS = ['Automático', 'Manual', 'CVT', 'Automatizado'];
const COMBUSTIVEIS = ['Flex', 'Gasolina', 'Etanol', 'Diesel', 'Elétrico', 'Híbrido', 'GNV'];
const CARROCERIAS = ['Hatch', 'Sedã', 'SUV', 'Picape', 'Minivan', 'Perua', 'Cupê', 'Conversível', 'Van', 'Outro'];
const CORES = ['Branco', 'Prata', 'Cinza', 'Preto', 'Vermelho', 'Azul', 'Verde', 'Marrom', 'Bege', 'Amarelo', 'Laranja', 'Dourado', 'Vinho', 'Outra'];

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
    dias_publicado: v.status === 'publicado' ? daysSince(v.publicado_em) : 0,
    artes: require('./arts').listArts(v.id),
    canais: require('./channels').listingsOf(v.id),
    pode_republicar: v.status === 'publicado' && daysSince(v.publicado_em) >= config.republishDays,
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
  };
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
  CAMBIOS, COMBUSTIVEIS, CARROCERIAS, CORES,
  serialize, findVehicle, listVehicles, cleanInput, missingForPublish, photosOf, title, daysSince, mediaUrl,
};
