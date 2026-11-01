// Formato único do veículo dentro do GiroAuto Fotos (o mesmo que a arte usa),
// montado a partir do estoque da Loja, de um anúncio do Repasse ou do cadastro avulso.

const CARROCERIAS = ['Hatch', 'Sedã', 'SUV', 'Picape', 'Minivan', 'Perua', 'Cupê', 'Conversível', 'Van', 'Outro'];
const CAMBIOS = ['Manual', 'Automático', 'Automatizado', 'CVT'];
const COMBUSTIVEIS = ['Flex', 'Gasolina', 'Etanol', 'Diesel', 'Híbrido', 'Elétrico', 'GNV'];
const CORES = ['Branco', 'Prata', 'Cinza', 'Preto', 'Vermelho', 'Azul', 'Verde', 'Marrom', 'Bege', 'Amarelo', 'Laranja', 'Dourado', 'Vinho'];
// Selos que a arte sabe mostrar (mesmas chaves do GiroAuto Loja).
const SELOS = [
  { key: 'pericia_premium', label: 'Perícia premium' }, { key: 'pericia_aprovada', label: 'Perícia aprovada' },
  { key: 'sem_retoques', label: 'Sem retoques' }, { key: 'unico_dono', label: 'Único dono' },
  { key: 'revisoes', label: 'Revisões em dia' }, { key: 'pneus_novos', label: 'Pneus novos' },
  { key: 'teto_solar', label: 'Teto solar' }, { key: 'garantia', label: 'Garantia da loja' },
];

const CAT_REPASSE = { hatch: 'Hatch', sedan: 'Sedã', suv: 'SUV', picape: 'Picape', utilitario: 'Van', minivan: 'Minivan', esportivo: 'Cupê' };

const str = (x, max = 80) => String(x ?? '').trim().slice(0, max);
const int = (x) => { const n = Math.round(Number(String(x ?? '').replace(/[^\d.-]/g, ''))); return Number.isFinite(n) && n > 0 ? n : 0; };
const placaOk = (p) => { const s = String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(s) ? s : ''; };
const daLista = (v, lista) => { if (!v) return ''; const n = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); return lista.find((x) => n(x) === n(v) || n(v).startsWith(n(x))) || str(v, 30); };
const corDe = (c) => { if (!c) return ''; const x = daLista(c, CORES); return CORES.includes(x) ? x : str(c, 30).replace(/a$/, 'o').replace(/^./, (m) => m.toUpperCase()); };

// Limpa o que vem do formulário (edição só para a arte).
function limpar(v = {}) {
  return {
    marca: str(v.marca, 40), modelo: str(v.modelo, 50), versao: str(v.versao, 80),
    ano_fab: int(v.ano_fab) || null, ano_modelo: int(v.ano_modelo) || null,
    km: v.km === 0 || v.km === '0' ? 0 : int(v.km) || null,
    preco: int(v.preco) || null, preco_oferta: int(v.preco_oferta) || null,
    cambio: v.cambio ? daLista(v.cambio, CAMBIOS) : '', combustivel: v.combustivel ? daLista(v.combustivel, COMBUSTIVEIS) : '',
    cor: corDe(v.cor), carroceria: v.carroceria ? daLista(v.carroceria, CARROCERIAS) : '',
    destaques: (Array.isArray(v.destaques) ? v.destaques : []).filter((k) => SELOS.some((s) => s.key === k)).slice(0, 4),
    placa: placaOk(v.placa), fipe: int(v.fipe) || null,
    frase: str(v.frase, 70), chamada: str(v.chamada, 40),
  };
}

function daLoja(v) {
  let destaques = v.destaques;
  if (typeof destaques === 'string') { try { destaques = JSON.parse(destaques); } catch { destaques = []; } }
  return limpar({ ...v, preco: v.preco, preco_oferta: v.oferta_ativa === false ? null : v.preco_oferta, destaques });
}

function doRepasse(a) {
  const d = a.dados || {};
  const anoModelo = int(d.anoModelo) || a.ano_modelo || int(d.ano);
  return limpar({
    marca: a.marca || d.marca, modelo: a.modelo || d.modelo, versao: d.versao || d.motor || '',
    ano_fab: int(d.ano) || anoModelo, ano_modelo: anoModelo, km: a.km ?? d.km,
    preco: a.preco_repasse || d.preco, cambio: d.cambio, combustivel: d.combustivel, cor: d.cor,
    carroceria: CAT_REPASSE[a.categoria || d.categoria] || '', placa: d.placa, fipe: a.fipe || d.fipe,
  });
}

const titulo = (v) => [v.marca, v.modelo, v.versao, v.ano_modelo].filter(Boolean).join(' ');

module.exports = { limpar, daLoja, doRepasse, titulo, CARROCERIAS, CAMBIOS, COMBUSTIVEIS, CORES, SELOS, placaOk };
