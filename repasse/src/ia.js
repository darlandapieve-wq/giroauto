// Claude: extrai os dados de anúncios bagunçados, lê a placa na foto e reescreve a descrição.
// Requer a variável de ambiente ANTHROPIC_API_KEY.
import { CATEGORIAS } from './categorias.js'

export const iaDisponivel = () => !!process.env.ANTHROPIC_API_KEY

const FERRAMENTA = {
  name: 'registrar_anuncio',
  description: 'Registra os dados estruturados de um anúncio de veículo usado à venda (repasse).',
  input_schema: {
    type: 'object',
    properties: {
      eh_anuncio: { type: 'boolean', description: 'true se a mensagem oferece um veículo à venda; false se for procura/compra, conversa ou outro assunto' },
      marca: { type: ['string', 'null'] },
      modelo: { type: ['string', 'null'], description: 'nome comercial curto, ex.: Onix, Civic, Hilux SW4' },
      versao: { type: ['string', 'null'], description: 'versão/acabamento e motor, ex.: LTZ 1.4 Turbo' },
      ano_fabricacao: { type: ['integer', 'null'] },
      ano_modelo: { type: ['integer', 'null'] },
      km: { type: ['integer', 'null'] },
      preco: { type: ['integer', 'null'], description: 'valor pedido em reais, inteiro' },
      fipe: { type: ['integer', 'null'], description: 'valor FIPE se o anúncio informar' },
      cambio: { type: ['string', 'null'], enum: ['Manual', 'Automático', 'Automatizado', null] },
      combustivel: { type: ['string', 'null'], enum: ['Flex', 'Gasolina', 'Etanol', 'Diesel', 'Híbrido', 'Elétrico', 'GNV', null] },
      cor: { type: ['string', 'null'] },
      cidade: { type: ['string', 'null'], description: 'Cidade-UF, ex.: Cascavel-PR' },
      categoria: { type: ['string', 'null'], enum: [...Object.keys(CATEGORIAS), null] },
      opcionais: { type: 'array', items: { type: 'string' } },
      situacao: { type: 'array', items: { type: 'string' }, description: 'ex.: aceita troca, financia, único dono, IPVA pago, laudo aprovado' },
      alertas: { type: 'array', items: { type: 'string' }, description: 'SOMENTE problemas do próprio veículo que o comprador precisa saber, em 1 a 4 palavras cada (ex.: "passagem por leilão", "sinistro", "débitos", "retoque no para-choque"). Vazio se não houver. Nunca comente o anúncio, a FIPE, a placa ou dados ilegíveis aqui.' },
      observacoes_internas: { type: 'array', items: { type: 'string' }, description: 'notas curtas para o revendedor conferir (dados duvidosos, FIPE informada estranha, placa parcialmente oculta etc.). Não vão para a divulgação.' },
      placa: { type: ['string', 'null'], description: 'placa no texto ou legível na foto (AAA0A00 ou AAA0000), sem hífen. null se não estiver legível com certeza' },
      descricao: { type: 'string', description: 'descrição reescrita para divulgação' }
    },
    required: ['eh_anuncio', 'descricao', 'opcionais', 'situacao', 'alertas']
  }
}

export async function analisarComIA ({ texto, foto, cfgIa }) {
  if (!iaDisponivel()) throw new Error('ANTHROPIC_API_KEY não configurada')
  const conteudo = []
  if (foto && cfgIa.lerPlacaNaFoto) {
    conteudo.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: foto.toString('base64') } })
  }
  conteudo.push({ type: 'text', text: `Anúncio recebido num grupo de repasse de veículos:\n<anuncio>\n${texto}\n</anuncio>` })

  const sistema = `Você extrai dados de anúncios de veículos usados brasileiros enviados no WhatsApp por lojistas e repassadores.
Regras:
- Use só o que está no texto ou na foto; não invente. Campo desconhecido = null.
- Valores em reais como inteiros (ex.: "62 mil" = 62000; "98.900" = 98900).
- Ano "20/21" = fabricação 2020, modelo 2021.
- A placa só deve ser preenchida se estiver legível com segurança.
- A descrição deve ser em português, ${cfgIa.estilo}. Não inclua telefone, nome do anunciante, nome de outra loja, link, preço, FIPE nem placa na descrição. Não repita ano, km e preço (já aparecem em outras linhas). Destaque estado de conservação, opcionais relevantes e condições (troca, financiamento).`

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: cfgIa.modelo || 'claude-haiku-5-5',
      max_tokens: 1024,
      system: sistema,
      tools: [FERRAMENTA],
      tool_choice: { type: 'tool', name: FERRAMENTA.name },
      messages: [{ role: 'user', content: conteudo }]
    })
  })
  if (!r.ok) throw new Error(`IA respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const j = await r.json()
  const uso = j.content?.find(c => c.type === 'tool_use')
  if (!uso) throw new Error('IA não retornou os dados')
  return { ...uso.input, _uso: j.usage }
}

// Junta o resultado da IA com o do extrator por regras (a IA prevalece onde trouxe valor)
export function mesclarComIA (dados, ia) {
  const v = (a, b) => (a !== null && a !== undefined && a !== '') ? a : b
  const anoTxt = ia.ano_fabricacao && ia.ano_modelo ? (ia.ano_fabricacao === ia.ano_modelo ? String(ia.ano_modelo) : `${ia.ano_fabricacao}/${ia.ano_modelo}`) : (ia.ano_modelo ? String(ia.ano_modelo) : null)
  const out = {
    ...dados,
    marca: v(ia.marca, dados.marca),
    modelo: v(ia.modelo, dados.modelo),
    versao: v(ia.versao, dados.versao),
    ano: v(anoTxt, dados.ano),
    anoModelo: v(ia.ano_modelo, dados.anoModelo),
    km: v(ia.km, dados.km),
    preco: v(ia.preco, dados.preco),
    fipe: v(ia.fipe, dados.fipe),
    cambio: v(ia.cambio, dados.cambio),
    combustivel: v(ia.combustivel, dados.combustivel),
    cor: v(ia.cor, dados.cor),
    cidade: v(ia.cidade, dados.cidade),
    categoria: v(ia.categoria, dados.categoria),
    opcionais: ia.opcionais?.length ? ia.opcionais : dados.opcionais,
    situacao: ia.situacao?.length ? ia.situacao : dados.situacao,
    alertas: [...new Set([...(dados.alertas || []), ...(ia.alertas || []).filter(a => a.length <= 40)])].slice(0, 4),
    observacoes: ia.observacoes_internas || [],
    placa: v(ia.placa, dados.placa),
    descricaoIA: ia.descricao || null,
    ehProcura: dados.ehProcura || ia.eh_anuncio === false,
    usouIA: true
  }
  if (out.preco && out.fipe) out.abaixoFipe = out.fipe > out.preco ? out.fipe - out.preco : null
  // com a IA confirmando que é anúncio e trazendo o essencial, garante pontuação suficiente
  if (ia.eh_anuncio && out.modelo && out.preco) out.pontos = Math.max(dados.pontos, 10)
  if (ia.eh_anuncio === false) out.pontos = Math.min(dados.pontos, 0)
  return out
}

// Vale a pena chamar a IA? (modo "incerto")
export function anuncioIncerto (d, minimo) {
  const faltando = !d.modelo || !d.preco || !d.anoModelo
  return d.pontos >= Math.max(2, minimo - 4) && (faltando || d.pontos < minimo + 2)
}
