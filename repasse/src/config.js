// Configurações (guardadas no banco, tabela kv, chave "config") com valores padrão.
import { kvGet, kvSet } from './db.js'
import { contaId } from './contexto.js'

export const CONFIG_PADRAO = {
  // ---- Reconhecimento ----
  pontuacaoMinima: 6,
  agruparSegundos: 25,
  reconhecerGrupo: { minAnuncios: 5, minPercentual: 30 },

  // ---- Filtros gerais (valem antes das regras de cada destino) ----
  filtros: {
    exigirPreco: true,
    exigirFoto: false,
    exigirAno: false,
    ignorarProcura: true,
    ignorarComAlertas: false,
    anoMin: null,
    anoMax: null,
    precoMin: null,
    precoMax: null,
    kmMax: null,
    marcasPermitidas: [],
    palavrasObrigatorias: [],
    palavrasBloqueadas: ['consignado', 'troco por'],
    somenteAbaixoFipe: false
  },

  // ---- Edição ----
  edicao: {
    borrarPlaca: true, // borra a placa (localizada pela IA) nas fotos enviadas ao grupo, vitrine e assistente
    removerTelefones: true,
    removerLinks: true,
    removerMencoes: true,
    removerPlaca: true,
    removerEmojis: false,
    removerTermos: [],
    ajustePreco: { ativo: true, tipo: 'valor', valor: 1500, arredondar: 500 },
    enviarFoto: true, // envia 1 foto (a capa) com o texto na legenda
    maxFotosBanco: 12 // quantas fotos guardar por anúncio para pedidos de clientes
  },

  // ---- Inteligência artificial (Claude) ----
  ia: {
    modo: 'incerto', // 'desligado' | 'incerto' (só anúncios bagunçados) | 'sempre'
    modelo: 'claude-haiku-5-5',
    reescreverDescricao: true,
    lerPlacaNaFoto: true,
    estilo: 'objetivo e vendedor, sem exageros, até 3 linhas',
    modeloPlaca: 'claude-haiku-5-5' // localizar a placa nas fotos (Haiku: mais barato; Sonnet: mais preciso)
  },

  // ---- FIPE ----
  fipe: {
    consultar: true, // consulta quando o anúncio não traz FIPE
    sempreConsultar: false, // consulta mesmo se o anúncio informar
    usarPlaca: true // usa a placa (texto ou foto) quando houver provedor configurado
  },

  // ---- Categorias ----
  premium: { marcas: ['BMW', 'Mercedes-Benz', 'Audi', 'Volvo', 'Land Rover', 'Porsche', 'Lexus', 'Mini'], precoAcima: 150000 },

  // ---- Assistente de atendimento (vitrine e WhatsApp) ----
  assistente: {
    ativo: true, // ícone de atendimento na vitrine
    whatsapp: false, // responder conversas individuais no WhatsApp conectado
    numeroAtendimento: '', // só responde se o número conectado for este (número próprio de atendimento)
    nome: 'Assistente',
    boasVindas: '',
    pagamento: 'somente à vista, via PIX', // a assistente não sugere outras formas
    instrucoes: '', // regras do seu atendimento (entrega, documentação, retirada…)
    mostrarFipe: true,
    fotosPorPedido: 6, // quantas fotos manda quando o cliente pede
    numerosAdmin: [], // seus números: mensagens com o código (ex.: GA-0003) + fotos/informações alimentam o anúncio
    ignorarNumeros: [], // números que a assistente nunca responde (família, sócios…)
    avisarAdmin: true // avisa seus números quando um cliente quer fechar ou pede uma pessoa
  },

  // ---- Seu negócio ----
  negocio: {
    nome: 'GiroAuto Repasse',
    contato: '(44) 9 0000-0000',
    prefixoCodigo: 'GA'
  },

  // ---- Modelo (linha some se algum {campo} estiver vazio) ----
  modelo: [
    { id: 'cab', ativo: true, texto: '🚗 *{marca} {modelo} {versao}*' },
    { id: 'ano', ativo: true, texto: '📅 Ano: {ano}' },
    { id: 'km', ativo: true, texto: '🛣️ KM: {km}' },
    { id: 'cambio', ativo: true, texto: '⚙️ Câmbio: {cambio}' },
    { id: 'comb', ativo: true, texto: '⛽ Combustível: {combustivel}' },
    { id: 'cor', ativo: true, texto: '🎨 Cor: {cor}' },
    { id: 'opc', ativo: false, texto: '✅ {opcionais}' },
    { id: 'sit', ativo: true, texto: '📋 {situacao}' },
    { id: 'alerta', ativo: true, texto: '⚠️ Atenção: {alertas}' },
    { id: 'desc', ativo: true, texto: '\n{descricao_ia}\n' },
    { id: 'preco', ativo: true, texto: '💰 *Repasse: {preco}*' },
    { id: 'fipe', ativo: true, texto: '📊 FIPE: {fipe}' },
    { id: 'cidade', ativo: true, texto: '📍 {cidade}' },
    { id: 'sep', ativo: true, texto: '━━━━━━━━━━━━' },
    { id: 'cod', ativo: true, texto: '🔖 Cód.: {codigo}' },
    { id: 'contato', ativo: true, texto: '📲 {negocio} — {contato}' }
  ],

  // ---- Envio ----
  envio: {
    modo: 'aprovacao',
    intervaloMinSeg: 40,
    intervaloMaxSeg: 90,
    limitePorHora: 30,
    horarioInicio: '07:00',
    horarioFim: '22:00',
    dedupHoras: 72
  },

  // ---- Repetição periódica ----
  repeticao: {
    padraoAtivo: false, // novos anúncios já entram repetindo?
    intervaloHoras: 24,
    maxVezes: 0, // 0 = até você encerrar
    encerrarAposDias: 30 // segurança: encerra sozinho depois de X dias (0 = nunca)
  },

  // ---- Redução automática do valor a cada reenvio ----
  reducaoPreco: {
    padraoAtivo: false, // novos anúncios já entram com redução ligada?
    passo: 500, // R$ a menos a cada reenvio
    piso: 'pedido', // 'pedido' = nunca abaixo do valor pedido pelo anunciante; 'nenhum' = sem piso
    pisoMargem: 0 // piso = valor pedido + esta margem (R$)
  },

  // ---- Fila ----
  fila: { expirarPendentesHoras: 48 }, // pendentes não aprovados saem da fila depois disso (0 = nunca)

  // ---- Vitrine pública ----
  vitrine: { ativa: true, titulo: '', subtitulo: 'Veículos de repasse com preço abaixo da FIPE', mostrarFipe: true },

  // ---- Limpeza ----
  // descartados, encerrados e filtrados são excluídos (com fotos e histórico) após este prazo; vendidos ficam
  limpeza: { excluirArquivadosHoras: 48 }
}

function mesclar (base, extra) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return extra ?? base
  const out = { ...base }
  for (const k of Object.keys(extra || {})) {
    out[k] = (k in base && typeof base[k] === 'object' && !Array.isArray(base[k]) && base[k] !== null)
      ? mesclar(base[k], extra[k])
      : extra[k]
  }
  return out
}

// Configuração por conta (repassador), em memória; cfg() devolve a da conta atual.
const porConta = new Map()
export async function carregarConfig (id = contaId()) {
  const c = mesclar(CONFIG_PADRAO, (await kvGet('config:' + id)) || {})
  porConta.set(Number(id), c)
  return c
}
export function cfg () {
  const c = porConta.get(contaId())
  if (!c) throw new Error('Configuração da conta não carregada')
  return c
}
export async function atualizarConfig (parcial) {
  const id = contaId()
  for (const k of ['anoMin', 'anoMax', 'kmMax', 'precoMin', 'precoMax']) {
    if (parcial?.filtros && k in parcial.filtros) { const n = Number(parcial.filtros[k]); if (!(Number.isFinite(n) && n > 0)) parcial.filtros[k] = null }
  }
  const c = mesclar(porConta.get(id) || CONFIG_PADRAO, parcial)
  porConta.set(id, c)
  await kvSet('config:' + id, c)
  return c
}
