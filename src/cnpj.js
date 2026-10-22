// Leitura do Cartão CNPJ (v2.14): tira os dados da empresa do PDF ou da foto do comprovante de inscrição da Receita.
// 1) PDF com texto: lê o texto e acha o CNPJ; 2) foto ou PDF escaneado: a IA (Gemini) lê a imagem;
// 3) com o número em mãos, consulta a base pública da Receita (BrasilAPI) para trazer endereço, telefone e sócios.
const str = (x, max = 300) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const so = (x) => String(x || '').replace(/\D/g, '');

function cnpjValido(c) {
  c = so(c);
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const dv = (n) => { let s = 0; let p = n - 7; for (let i = 0; i < n; i++) { s += Number(c[i]) * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
}
const fmtCnpj = (c) => so(c).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const fmtCep = (c) => so(c).replace(/^(\d{5})(\d{3})$/, '$1-$2');
const titulo = (s) => str(s).toLowerCase().replace(/(^|[\s/-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\b(D[aeo]s?|E)\b/g, (m) => m.toLowerCase());
const fone = (s) => { const d = so(s); return d.length >= 10 ? d.slice(0, 11) : ''; };

async function textoDoPdf(buf) {
  try {
    const { getDocumentProxy, extractText } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return String(text || '');
  } catch { return ''; }
}

function acharCnpj(texto) {
  for (const m of String(texto).matchAll(/\d{2}[.\s]?\d{3}[.\s]?\d{3}\s?\/?\s?\d{4}\s?-?\s?\d{2}/g)) if (cnpjValido(m[0])) return so(m[0]);
  return '';
}

// Lê os campos do comprovante da Receita pelo nome de cada campo (rótulo seguido do valor).
const ROTULOS = [
  ['cnpj', 'NÚMERO DE INSCRIÇÃO'], ['abertura', 'DATA DE ABERTURA'], ['razao_social', 'NOME EMPRESARIAL'],
  ['nome', 'TÍTULO DO ESTABELECIMENTO (NOME DE FANTASIA)'], ['porte', 'PORTE'], ['atividade', 'CÓDIGO E DESCRIÇÃO DA ATIVIDADE ECONÔMICA PRINCIPAL'],
  ['secundarias', 'CÓDIGO E DESCRIÇÃO DAS ATIVIDADES ECONÔMICAS SECUNDÁRIAS'], ['natureza', 'CÓDIGO E DESCRIÇÃO DA NATUREZA JURÍDICA'],
  ['logradouro', 'LOGRADOURO'], ['numero', 'NÚMERO'], ['complemento', 'COMPLEMENTO'], ['cep', 'CEP'], ['bairro', 'BAIRRO/DISTRITO'],
  ['cidade', 'MUNICÍPIO'], ['uf', 'UF'], ['email', 'ENDEREÇO ELETRÔNICO'], ['telefone', 'TELEFONE'], ['efr', 'ENTE FEDERATIVO RESPONSÁVEL (EFR)'],
  ['situacao', 'SITUAÇÃO CADASTRAL'], ['data_situacao', 'DATA DA SITUAÇÃO CADASTRAL'],
];
// Rótulo como expressão que aceita com ou sem acento (o texto do PDF pode vir de um jeito ou de outro).
const GRUPOS = { A: '[AÁÀÂÃ]', E: '[EÉÊ]', I: '[IÍ]', O: '[OÓÔÕ]', U: '[UÚÜ]', C: '[CÇ]' };
const semAcento = (r) => r.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[()/]/g, (c) => `\\${c}`).replace(/[AEIOUC]/g, (c) => GRUPOS[c]).replace(/ /g, '\\s+');
function lerRotulos(texto) {
  const t = String(texto).replace(/\s+/g, ' ');
  const T = t.toUpperCase();
  const achados = [];
  let de = 0;
  for (const [k, r] of ROTULOS) {
    const re = new RegExp(`(^|[^A-ZÀ-Ü])${semAcento(r)}(?![A-ZÀ-Ü])`, 'g');
    re.lastIndex = de;
    const m = re.exec(T);
    if (!m) continue;
    const ini = m.index + m[1].length;
    achados.push({ k, ini, fim: ini + r.length });
    de = ini + r.length;
  }
  const out = {};
  achados.forEach((a, i) => {
    const v = str(t.slice(a.fim, achados[i + 1]?.ini ?? a.fim + 160), 200).replace(/^[:\s-]+/, '');
    if (v && !/^\*+$/.test(v)) out[a.k] = v;
  });
  return out;
}

async function iaLer(buf, mimetype) {
  const key = require('./settings').chatAi().key;
  if (!key) return null;
  const base = (process.env.GEMINI_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
  const pedido = 'Esta imagem é um Cartão CNPJ (comprovante de inscrição e situação cadastral da Receita Federal do Brasil). Extraia os dados exatamente como escritos. Responda só JSON: {"cnpj":"","razao_social":"","nome":"","logradouro":"","numero":"","complemento":"","bairro":"","cidade":"","uf":"","cep":"","telefone":"","email":"","abertura":"","atividade":"","situacao":""}. Use "" para o que não existir ou estiver como "********".';
  const modelos = [...new Set([require('./settings').chatAi().model, 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite'].filter(Boolean))];
  for (const model of modelos) {
    try {
      const r = await fetch(`${base}/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, signal: AbortSignal.timeout(40000),
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mimetype, data: Buffer.from(buf).toString('base64') } }, { text: pedido }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0, ...(/2\.5/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
        }),
      });
      if (!r.ok) continue;
      const d = await r.json();
      const j = JSON.parse((d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(''));
      if (j && typeof j === 'object') return j;
    } catch { /* tenta o próximo modelo */ }
  }
  return null;
}

// Base pública da Receita (BrasilAPI). Traz também o quadro de sócios, de onde sai o representante.
async function consultar(cnpj) {
  const url = (process.env.CNPJ_API_URL || 'https://brasilapi.com.br/api/cnpj/v1/{cnpj}').replace('{cnpj}', so(cnpj));
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'GiroAuto' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const d = await r.json();
    if (!d?.razao_social) return null;
    const socios = (d.qsa || []).map((s) => ({ nome: titulo(s.nome_socio), qualificacao: str(s.qualificacao_socio, 80) }));
    const adm = socios.find((s) => /administrador|s[óo]cio-administrador|diretor|presidente|titular|empres[áa]rio/i.test(s.qualificacao)) || socios[0];
    return {
      cnpj: so(d.cnpj), razao_social: str(d.razao_social, 200), nome: str(d.nome_fantasia, 120),
      logradouro: str([d.descricao_tipo_de_logradouro, d.logradouro].filter(Boolean).join(' ')), numero: str(d.numero, 20), complemento: str(d.complemento, 80),
      bairro: str(d.bairro, 80), cidade: str(d.municipio, 80), uf: str(d.uf, 2), cep: so(d.cep),
      telefone: fone(d.ddd_telefone_1), email: str(d.email, 120).toLowerCase(), abertura: str(d.data_inicio_atividade, 20),
      atividade: str(d.cnae_fiscal_descricao, 200), situacao: str(d.descricao_situacao_cadastral, 40),
      representante: adm?.nome || '', socios,
    };
  } catch { return null; }
}

/**
 * Lê um Cartão CNPJ (PDF ou foto) e devolve os dados no formato do formulário de implantação.
 * @returns {Promise<{ok: boolean, fonte: string, dados: object, aviso?: string}>}
 */
async function ler(buf, mimetype) {
  let base = {}; let fonte = '';
  if (/pdf/.test(mimetype)) {
    const texto = await textoDoPdf(buf);
    if (texto.replace(/\s/g, '').length > 80) { base = lerRotulos(texto); base.cnpj = acharCnpj(texto) || so(base.cnpj); fonte = 'pdf'; }
  }
  if (!cnpjValido(base.cnpj)) {
    const ia = await iaLer(buf, mimetype);
    if (ia) { base = { ...ia, ...Object.fromEntries(Object.entries(base).filter(([, v]) => v)) }; base.cnpj = so(ia.cnpj) || so(base.cnpj); fonte = fonte ? `${fonte}+ia` : 'ia'; }
  }
  if (!cnpjValido(base.cnpj)) return { ok: false, fonte, dados: {}, aviso: 'Não consegui ler o CNPJ neste arquivo. Envie o PDF do Cartão CNPJ (site da Receita) ou uma foto nítida.' };
  const api = await consultar(base.cnpj);
  const d = { ...Object.fromEntries(Object.entries(base).map(([k, v]) => [k, str(v, 200)])), ...Object.fromEntries(Object.entries(api || {}).filter(([, v]) => v && (!Array.isArray(v) || v.length))) };
  if (api) fonte = `${fonte}+receita`;
  return { ok: true, fonte, dados: normalizar(d) };
}

// Converte para os campos do formulário (endereço completo, cidade com maiúsculas, CEP e CNPJ formatados).
function normalizar(d) {
  const cidade = d.cidade ? titulo(d.cidade) : '';
  const rua = [titulo(d.logradouro), d.numero && !/^s\/?n$/i.test(d.numero) ? d.numero : (d.numero ? 's/n' : '')].filter(Boolean).join(', ');
  const endereco = [rua + (d.complemento ? ` - ${titulo(d.complemento)}` : ''), d.bairro ? titulo(d.bairro) : ''].filter(Boolean).join(' - ');
  return {
    cnpj: fmtCnpj(d.cnpj), razao_social: str(d.razao_social, 200).toUpperCase(), nome: d.nome && !/^\*+$/.test(d.nome) ? titulo(d.nome) : '',
    endereco, cidade, uf: str(d.uf, 2).toUpperCase(), cep: fmtCep(d.cep), telefone: fone(d.telefone), email: str(d.email, 120).toLowerCase(),
    representante: d.representante || '', foro: cidade && d.uf ? `${cidade}/${str(d.uf, 2).toUpperCase()}` : '',
    abertura: str(d.abertura, 20), atividade: str(d.atividade, 200), situacao: str(d.situacao, 40), socios: d.socios || [],
  };
}

module.exports = { ler, consultar, cnpjValido, acharCnpj, lerRotulos, textoDoPdf, fmtCnpj };
