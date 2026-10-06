// Feed CSV do catálogo de veículos da Meta (vertical "vehicles").
const { all } = require('./db');
const { photosOf, title } = require('./vehicles');
const config = require('./config');

const BODY = {
  Hatch: 'HATCHBACK', 'Sedã': 'SEDAN', SUV: 'SUV', Picape: 'PICKUP', Minivan: 'MINIVAN',
  Perua: 'WAGON', 'Cupê': 'COUPE', 'Conversível': 'CONVERTIBLE', Van: 'VAN', Outro: 'OTHER',
};
const FUEL = {
  Flex: 'FLEX', Gasolina: 'GASOLINE', Etanol: 'FLEX', Diesel: 'DIESEL',
  'Elétrico': 'ELECTRIC', 'Híbrido': 'HYBRID', GNV: 'OTHER',
};
const TRANS = { 'Automático': 'AUTOMATIC', Manual: 'MANUAL', CVT: 'AUTOMATIC', Automatizado: 'AUTOMATIC' };

const MAX_IMAGES = 20;

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function vehicleUrl(store, v) {
  return `${config.publicUrl}/v/${store.slug}/${v.id}`;
}

function feedRows(store) {
  const vehicles = all(
    `SELECT * FROM vehicles WHERE store_id = ? AND catalogo = 1
     AND status IN ('pronto','publicado') ORDER BY id`,
    store.id,
  );
  return vehicles
    .map((v) => ({ v, photos: photosOf(v.id) }))
    .filter(({ photos }) => photos.length > 0)
    .map(({ v, photos }) => {
      const row = {
        vehicle_id: `giro-${v.id}`,
        title: title(v).slice(0, 150),
        description: (v.descricao || title(v)).slice(0, 5000),
        url: vehicleUrl(store, v),
        make: v.marca,
        model: v.modelo,
        year: v.ano_modelo || v.ano_fab || '',
        trim: v.versao,
        'mileage.value': v.km,
        'mileage.unit': 'KM',
        price: `${v.preco} BRL`,
        state_of_vehicle: 'USED',
        availability: 'AVAILABLE',
        body_style: BODY[v.carroceria] || 'OTHER',
        fuel_type: FUEL[v.combustivel] || 'OTHER',
        transmission: TRANS[v.cambio] || 'OTHER',
        exterior_color: v.cor || '',
        interior_color: v.cor_interna || '',
        dealer_name: store.name,
        dealer_phone: store.whatsapp || store.phone || '',
        'address.addr1': store.address || '',
        'address.city': store.city || '',
        'address.region': store.state || '',
        'address.postal_code': store.postal_code || '',
        'address.country': 'BR',
      };
      photos.slice(0, MAX_IMAGES).forEach((p, i) => { row[`image[${i}].url`] = p.url; });
      return row;
    });
}

function buildCsv(store) {
  const rows = feedRows(store);
  const base = [
    'vehicle_id', 'title', 'description', 'url', 'make', 'model', 'year', 'trim',
    'mileage.value', 'mileage.unit', 'price', 'state_of_vehicle', 'availability', 'body_style',
    'fuel_type', 'transmission', 'exterior_color', 'interior_color', 'dealer_name', 'dealer_phone',
    'address.addr1', 'address.city', 'address.region', 'address.postal_code', 'address.country',
  ];
  const maxImg = rows.reduce((m, r) => Math.max(m, Object.keys(r).filter((k) => k.startsWith('image[')).length), 1);
  const cols = [...base, ...Array.from({ length: maxImg }, (_, i) => `image[${i}].url`)];
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(','));
  return lines.join('\n') + '\n';
}

function feedUrl(store) {
  return `${config.publicUrl}/feed/${store.slug}.csv?k=${store.feed_key}`;
}

module.exports = { buildCsv, feedRows, feedUrl, vehicleUrl };
