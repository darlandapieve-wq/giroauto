// Grupos de repasse (v2.2): texto pronto para lojistas, preço de repasse, grupos da loja e histórico de envios.
// WhatsApp e Facebook não permitem postar em grupos de forma automática e gratuita para lojas;
// o painel prepara tudo (texto, fotos, link do grupo) e registra onde o carro foi enviado.
const { get, all, run } = require('./db');
const V = require('./vehicles');

const TIPOS = { whatsapp: 'WhatsApp', facebook: 'Facebook', telegram: 'Telegram', outro: 'Outro' };
const str = (x, max) => String(x ?? '').trim().slice(0, max);
const brl = (n) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR');

function groups(store) {
  try { return (JSON.parse(store?.repasse_grupos || '[]') || []).filter((g) => g && g.nome); } catch { return []; }
}

function cleanGroups(list) {
  const out = [];
  for (const g of Array.isArray(list) ? list.slice(0, 50) : []) {
    const nome = str(g.nome, 80);
    if (!nome) continue;
    const link = str(g.link, 300);
    out.push({ id: str(g.id, 20) || Math.random().toString(36).slice(2, 10), nome, tipo: TIPOS[g.tipo] ? g.tipo : (/whatsapp/.test(link) ? 'whatsapp' : /facebook/.test(link) ? 'facebook' : 'outro'), link: /^https?:\/\//.test(link) ? link : '' });
  }
  return out;
}

function saveGroups(storeId, list) {
  const g = cleanGroups(list);
  run('UPDATE stores SET repasse_grupos = ? WHERE id = ?', JSON.stringify(g), storeId);
  return g;
}

// Placa parcial para grupos: "ABC1D23" -> "AB***23".
const placaParcial = (p) => (p && p.length >= 5 ? `${p.slice(0, 2)}***${p.slice(-2)}` : '');
// "44999158307" -> "(44)999158307" (formato usado nos grupos).
const fone = (x) => { const d = String(x || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''); return d.length >= 10 ? `(${d.slice(0, 2)})${d.slice(2)}` : String(x || ''); };
// Itens de varejo que não fazem sentido para lojistas.
const FORA_REPASSE = ['aceita_troca', 'financiamento', 'convite_visita'];

// Texto no formato dos grupos de lojistas: direto, com preço de repasse, FIPE e transparência.
function texto(store, v) {
  const s = V.serialize(v);
  const preco = v.preco_repasse || V.precoAnuncio(v) || 0;
  const tem = (d) => (s.destaques || []).includes(d.key);
  const bons = (V.DESTAQUES || []).filter((d) => !d.alerta && !d.rodape && !FORA_REPASSE.includes(d.key) && tem(d)).map((d) => d.label);
  const alertas = (V.DESTAQUES || []).filter((d) => d.alerta && tem(d)).map((d) => d.label);
  const site = `${require('./config').publicUrl}/v/${store.slug}`;
  const linhas = [
    `🔁 *REPASSE* · ${[v.marca, v.modelo, v.versao, v.ano_modelo].filter(Boolean).join(' ')}`,
    `🚗 ${[v.cor, v.cambio, v.combustivel, v.km ? `${Number(v.km).toLocaleString('pt-BR')} km` : ''].filter(Boolean).map((x) => `· ${x}`).join(' ')}`,
    `💰 *${brl(preco)}*${v.fipe ? ` · FIPE ${brl(v.fipe)}` : ''}`,
    v.placa ? `🔢 Placa ${placaParcial(v.placa)}` : '',
    bons.length ? `✅ ${bons.join(' · ')}` : '',
    alertas.length ? `⚠️ ${alertas.join(' · ')}` : '',
    v.repasse_detalhes ? `ℹ️ Detalhes: ${v.repasse_detalhes}` : '',
    [store.city, store.state].filter(Boolean).length ? `📍 ${[store.city, store.state].filter(Boolean).join('/')}` : '',
    `📞 ${store.name}${store.whatsapp ? ` · ${fone(store.whatsapp)}` : ''}`,
    `🔗 ${site}`,
  ];
  return linhas.filter((l) => l && l !== '🚗 ').join('\n');
}

function posts(vehicleId) {
  return all(`SELECT p.*, u.name AS user_name FROM repasse_posts p LEFT JOIN users u ON u.id = p.user_id WHERE p.vehicle_id = ? ORDER BY p.id DESC LIMIT 100`, vehicleId);
}

function record(vehicleId, nomes, userId) {
  const list = (Array.isArray(nomes) ? nomes : [nomes]).map((n) => str(n, 80)).filter(Boolean).slice(0, 50);
  list.forEach((n) => run('INSERT INTO repasse_posts (vehicle_id, grupo, user_id) VALUES (?, ?, ?)', vehicleId, n, userId));
  return list.length;
}

function data(store, v) {
  const s = V.serialize(v);
  return {
    texto: texto(store, v), grupos: groups(store), tipos: TIPOS, posts: posts(v.id),
    preco: V.precoAnuncio(v), preco_repasse: v.preco_repasse || 0, fipe: v.fipe || 0, detalhes: v.repasse_detalhes || '',
    fotos: (s.photos || []).slice(0, 10).map((p) => p.url),
  };
}

module.exports = { placaParcial, TIPOS, groups, cleanGroups, saveGroups, texto, posts, record, data };
