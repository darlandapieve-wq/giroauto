// Comandos de voz (v2.15): o usuário fala (ou digita) e o GiroAuto entende e faz.
// Ex.: "o Jetta 2013 preto ficou pronto na oficina e está no pátio", "inclua na Ecosport 2009 alinhamento e balanceamento",
// "a conta de energia foi paga". A IA (Gemini) transforma a frase em ações; o servidor confere cada uma contra os dados
// da loja (carro, parceiro, conta) e as permissões do usuário antes de executar.
const crypto = require('node:crypto');
const { get, all, run, logEvent } = require('./db');
const G = require('./gestao');
const PR = require('./preparacao');
const T = require('./team');

const str = (x, max = 300) => String(x ?? '').trim().slice(0, max);
const int = (x) => Math.max(0, Math.round(Number(String(x ?? '').replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) || 0));
const data = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(String(x || '')) ? String(x) : null);
const hoje = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const httpError = (status, message) => Object.assign(new Error(message), { status });
const brl = (n) => `R$ ${Number(n || 0).toLocaleString('pt-BR')}`;

const TIPOS = {
  local: 'Mudar onde o carro está',
  preparacao_add: 'Incluir na preparação',
  preparacao_feito: 'Marcar preparação como feita',
  conta_paga: 'Marcar conta como paga',
  despesa_add: 'Lançar despesa da loja',
  oferta: 'Oferta do carro',
  preco: 'Preço do carro',
};
const PERM = { local: 'parceiros', preparacao_add: ['cadastrar', 'gestao', 'vender'], preparacao_feito: ['cadastrar', 'gestao', 'vender'], conta_paga: 'financeiro', despesa_add: 'financeiro', oferta: 'precos', preco: 'precos' };
const pode = (user, tipo) => [].concat(PERM[tipo] || []).some((p) => user.perms?.has(p));

function contexto(storeId) {
  const carros = all(`SELECT * FROM vehicles WHERE store_id = ? AND status != 'vendido' ORDER BY updated_at DESC LIMIT 100`, storeId).map((v) => {
    const p = PR.doVeiculo(v.id);
    return {
      id: v.id, carro: [v.marca, v.modelo, v.versao, v.ano_fab && v.ano_modelo ? `${v.ano_fab}/${v.ano_modelo}` : v.ano_modelo].filter(Boolean).join(' '), cor: v.cor || '', placa: v.placa || '',
      preco: v.preco || 0, oferta: v.preco_oferta || 0, ...(v.status === 'avaliacao' ? { avaliacao: true } : {}), ...(v.local_status && v.local_status !== 'patio' ? { fora: G.LOCAL[v.local_status] } : {}),
      preparacao_aberta: p.itens.filter((i) => !i.feito).map((i) => ({ id: i.id, descricao: i.descricao })),
    };
  });
  const parceiros = all('SELECT id, nome, tipo FROM partners WHERE store_id = ? ORDER BY nome', storeId).map((p) => ({ id: p.id, nome: p.nome, tipo: G.PARTNER_TYPES[p.tipo] || p.tipo }));
  const contas = all(`SELECT id, data, categoria, descricao, valor FROM store_expenses WHERE store_id = ? AND pago = 0 AND data <= date('now', '+45 days') ORDER BY data LIMIT 60`, storeId)
    .map((e) => ({ id: e.id, vencimento: e.data, categoria: G.EXP_CATS[e.categoria] || e.categoria, descricao: e.descricao, valor: e.valor }));
  return { carros, parceiros, contas };
}

function prompt(ctx) {
  return `Você é o assistente de voz do GiroAuto, sistema de uma loja de veículos. Hoje é ${hoje()}.
O usuário falou (ou digitou) um comando. Transforme em ações no sistema, usando SOMENTE os ids que existem nos dados abaixo.

Ações possíveis (campo "tipo"):
- "local": onde o carro está. Campos: vehicle_id, status (uma de: ${Object.entries(G.LOCAL).map(([k, l]) => `${k}=${l}`).join('; ')}), parceiro_id (se for oficina/parceiro conhecido), previsao (AAAA-MM-DD, se disser quando volta), obs.
  "ficou pronto e voltou/está no pátio" => status "patio". "foi para a oficina do Zé" => status "manutencao" com o parceiro.
- "preparacao_add": incluir itens de preparação/serviço no carro. Campos: vehicle_id, itens: [{descricao, status ("pendente" ou "feito"), custo (número em reais, se falar valor)}]. Separe cada serviço em um item (ex.: "alinhamento e balanceamento" pode ser um item só).
- "preparacao_feito": marcar como feitos itens de preparação já abertos do carro. Campos: vehicle_id, item_ids (ids da lista preparacao_aberta), custo (se falar quanto custou e for um item só).
- "conta_paga": conta da loja foi paga. Campos: expense_id (da lista de contas em aberto).
- "oferta": colocar, mudar ou tirar a oferta (preço promocional) do carro. Campos: vehicle_id, valor (número em reais) ou remover: true para tirar a oferta.
- "preco": mudar o preço de venda (normal) do carro. Campos: vehicle_id, valor.
- "despesa_add": lançar despesa/conta da loja que não está na lista. Campos: descricao, valor, categoria (${Object.keys(G.EXP_CATS).join(', ')}), data (AAAA-MM-DD), pago (true/false).

Regras:
- Identifique o carro por modelo, ano, cor, placa ou apelido. Se houver mais de um carro possível e não der para decidir, NÃO invente: deixe acoes vazio e escreva a pergunta em "duvida".
- Quando um carro volta pronto da oficina, se a fala indicar o serviço feito e ele existir em preparacao_aberta, inclua também "preparacao_feito".
- Para "conta de energia/luz paga", procure a conta em aberto da categoria Energia; se houver mais de uma, escolha a de vencimento mais próximo de hoje.
- Não crie ações que o usuário não pediu. Valores em reais como número (ex.: 350).
- "resposta": frase curta e natural, em português, dizendo o que será feito (para ser lida ou falada).

Responda só JSON: {"transcricao":"","acoes":[...],"resposta":"","duvida":""}

Dados da loja:
${JSON.stringify(ctx)}`;
}

// Mesmos modelos do assistente (com as versões "latest", que não somem), tentando o próximo quando um falha.
const MODELOS = () => [...new Set(['gemini-2.5-flash-lite', 'gemini-flash-lite-latest', require('./settings').chatAi().model, 'gemini-2.5-flash', 'gemini-flash-latest'].filter((m) => m && !/image|imagen|banana/i.test(m)))];
async function gemini(partes, { prazoMs = 60000 } = {}) {
  const inicio = Date.now();
  const key = require('./settings').chatAi().key;
  if (!key) throw httpError(409, 'A inteligência artificial não está configurada (Configurações > Sistema).');
  const base = (process.env.GEMINI_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
  const erros = [];
  for (let rodada = 0; rodada < 2; rodada++) {
    for (const model of MODELOS()) {
      const resta = prazoMs - (Date.now() - inicio);
      if (resta < 2500) { erros.push('prazo esgotado'); break; }
      try {
        const gc = { responseMimeType: 'application/json', temperature: 0 };
        if (/^gemini-2\.5/.test(model)) gc.thinkingConfig = { thinkingBudget: 0 };
        const r = await fetch(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, signal: AbortSignal.timeout(Math.min(25000, resta)),
          body: JSON.stringify({ contents: [{ role: 'user', parts: partes }], generationConfig: gc }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          erros.push(`${model}: ${r.status} ${String(d?.error?.message || '').slice(0, 120)}`);
          if ([401, 403].includes(r.status)) break;
          continue;
        }
        const txt = (d.candidates?.[0]?.content?.parts || []).filter((x) => !x.thought && x.text).map((x) => x.text).join('').replace(/^```(json)?|```$/g, '').trim();
        const j = JSON.parse(txt);
        if (j && typeof j === 'object') return j;
      } catch (e) { erros.push(`${model}: ${e.message}`); }
    }
    if (rodada === 0 && prazoMs - (Date.now() - inicio) > 8000) await new Promise((ok) => setTimeout(ok, 1200)); else if (rodada === 0) break;
  }
  console.error('voz: IA falhou', erros.join(' | '));
  throw httpError(429, 'A IA não respondeu agora (muito acesso no Google). Tente de novo em alguns segundos.');
}

// Confere cada ação contra os dados da loja e as permissões, e escreve o que será feito em linguagem simples.
function validar(user, acoes) {
  const sid = user.storeId;
  const out = [];
  for (const a of Array.isArray(acoes) ? acoes.slice(0, 8) : []) {
    const tipo = TIPOS[a?.tipo] ? a.tipo : null;
    if (!tipo) continue;
    const item = { tipo, tipo_label: TIPOS[tipo], ok: true, erro: '' };
    const v = a.vehicle_id ? get('SELECT * FROM vehicles WHERE id = ? AND store_id = ?', Number(a.vehicle_id), sid) : null;
    const nomeV = v ? `${[v.marca, v.modelo, v.ano_modelo].filter(Boolean).join(' ')}${v.cor ? ` ${v.cor.toLowerCase()}` : ''}${v.placa ? ` (${v.placa})` : ''}` : '';
    if (['local', 'preparacao_add', 'preparacao_feito'].includes(tipo) && !v) { item.ok = false; item.erro = 'Carro não encontrado.'; }
    if (!pode(user, tipo)) { item.ok = false; item.erro = 'Seu usuário não tem permissão para isso.'; }
    if (tipo === 'local' && v) {
      const status = G.LOCAL[a.status] ? a.status : 'patio';
      const parc = a.parceiro_id ? get('SELECT id, nome FROM partners WHERE id = ? AND store_id = ?', Number(a.parceiro_id), sid) : null;
      Object.assign(item, { vehicle_id: v.id, status, parceiro_id: status === 'patio' ? null : parc?.id || null, previsao: data(a.previsao), obs: str(a.obs, 200),
        texto: `${nomeV}: ${G.LOCAL[status].toLowerCase()}${parc && status !== 'patio' ? ` (${parc.nome})` : ''}${data(a.previsao) ? `, previsão ${data(a.previsao).split('-').reverse().join('/')}` : ''}` });
    }
    if (tipo === 'preparacao_add' && v) {
      const itens = (Array.isArray(a.itens) ? a.itens : []).map((x) => ({ descricao: str(typeof x === 'string' ? x : x?.descricao, 200), status: x?.status === 'feito' ? 'feito' : 'pendente', custo: int(x?.custo) })).filter((x) => x.descricao).slice(0, 10);
      if (!itens.length) { item.ok = false; item.erro = 'Não entendi o que incluir.'; }
      Object.assign(item, { vehicle_id: v.id, itens, texto: `${nomeV}: incluir ${itens.map((x) => `"${x.descricao}"${x.status === 'feito' ? ' (já feito)' : ''}${x.custo ? ` ${brl(x.custo)}` : ''}`).join(', ')}` });
    }
    if (tipo === 'preparacao_feito' && v) {
      const abertos = all("SELECT id, descricao FROM preparacao WHERE vehicle_id = ? AND status != 'feito'", v.id);
      const ids = [].concat(a.item_ids || []).map(Number).filter((id) => abertos.some((x) => x.id === id));
      if (!ids.length) { item.ok = false; item.erro = 'Não achei o item de preparação.'; }
      Object.assign(item, { vehicle_id: v.id, item_ids: ids, custo: ids.length === 1 ? int(a.custo) : 0,
        texto: `${nomeV}: feito ${abertos.filter((x) => ids.includes(x.id)).map((x) => `"${x.descricao}"`).join(', ')}${ids.length === 1 && int(a.custo) ? ` (${brl(int(a.custo))})` : ''}` });
    }
    if (tipo === 'conta_paga') {
      const e = a.expense_id ? get('SELECT * FROM store_expenses WHERE id = ? AND store_id = ?', Number(a.expense_id), sid) : null;
      if (!e) { item.ok = false; item.erro = 'Conta não encontrada.'; }
      else if (e.pago) { item.ok = false; item.erro = 'Essa conta já está paga.'; }
      Object.assign(item, { expense_id: e?.id, texto: e ? `Conta paga: ${e.descricao || G.EXP_CATS[e.categoria]} de ${brl(e.valor)} (vencimento ${e.data.split('-').reverse().join('/')})` : 'Conta paga' });
    }
    if ((tipo === 'oferta' || tipo === 'preco') && !v) { item.ok = false; item.erro = 'Carro não encontrado.'; }
    if ((tipo === 'oferta' || tipo === 'preco') && v) {
      const valor = int(a.valor); const remover = tipo === 'oferta' && (a.remover === true || a.remover === 'true') && !valor;
      if (!valor && !remover) { item.ok = false; item.erro = 'Faltou o valor.'; }
      if (tipo === 'oferta' && valor && v.preco && valor >= v.preco) { item.ok = false; item.erro = `A oferta precisa ser menor que o preço (${brl(v.preco)}).`; }
      Object.assign(item, { vehicle_id: v.id, valor, remover,
        texto: remover ? `${nomeV}: tirar a oferta (volta a ${brl(v.preco)})` : tipo === 'oferta' ? `${nomeV}: oferta de ${brl(valor)}${v.preco ? ` (de ${brl(v.preco)})` : ''}` : `${nomeV}: preço ${brl(valor)}${v.preco ? ` (era ${brl(v.preco)})` : ''}` });
    }
    if (tipo === 'despesa_add') {
      const valor = int(a.valor);
      if (!valor) { item.ok = false; item.erro = 'Faltou o valor da despesa.'; }
      const categoria = G.EXP_CATS[a.categoria] ? a.categoria : 'outros';
      Object.assign(item, { descricao: str(a.descricao, 200), valor, categoria, data: data(a.data) || hoje(), pago: a.pago !== false,
        texto: `Despesa: ${str(a.descricao, 200) || G.EXP_CATS[categoria]} ${brl(valor)} (${a.pago === false ? 'a pagar' : 'paga'})` });
    }
    out.push(item);
  }
  return out;
}

/**
 * Entende um comando falado (áudio) ou digitado.
 * @returns {Promise<{transcricao: string, resposta: string, duvida: string, acoes: object[]}>}
 */
async function interpretar(user, { texto, audio }, { prazoMs } = {}) {
  const t = str(texto, 1000);
  if (!t && !audio?.buffer?.length) throw httpError(400, 'Fale ou digite o que quer fazer.');
  const ctx = contexto(user.storeId);
  // Rápido: os comandos mais comuns são entendidos na hora pelas regras; a IA só entra quando a frase é diferente.
  if (t) {
    const r0 = regras(t, ctx);
    if (r0.acoes.length && !r0.duvida) {
      const acoes0 = validar(user, r0.acoes);
      if (acoes0.every((a) => a.ok)) return { transcricao: t, resposta: '', duvida: '', acoes: acoes0, fonte: 'regras' };
    }
  }
  const partes = [{ text: prompt(ctx) }];
  if (audio?.buffer?.length) partes.push({ text: 'O comando está no áudio a seguir (português do Brasil). Coloque em "transcricao" o que foi falado.' }, { inline_data: { mime_type: String(audio.mimetype || 'audio/webm').split(';')[0], data: Buffer.from(audio.buffer).toString('base64') } });
  else partes.push({ text: `Comando: ${t}` });
  let j;
  try { j = await gemini(partes, { prazoMs }); }
  catch (e) {
    // IA fora do ar ou lenta: entende os comandos mais comuns por regras (carro, pátio/oficina, preparação, conta paga).
    if (!t) throw e;
    j = regras(t, ctx);
    if (!j.acoes.length && !j.duvida) throw e;
  }
  const acoes = validar(user, j.acoes);
  return { transcricao: str(j.transcricao || t, 1000), resposta: str(j.resposta, 400), duvida: str(j.duvida, 400), acoes, fonte: j.fonte || 'ia' };
}

/* ---------------- Plano B sem IA: regras para os comandos mais comuns ---------------- */
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const palavras = (s) => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
const CORES = ['preto', 'preta', 'branco', 'branca', 'prata', 'cinza', 'vermelho', 'vermelha', 'azul', 'verde', 'amarelo', 'bege', 'marrom', 'dourado', 'vinho', 'laranja'];
function acharCarro(texto, carros) {
  const T = norm(texto); const W = new Set(palavras(texto));
  const pont = carros.map((c) => {
    const n = palavras(c.carro); let p = 0;
    const [marca, modelo] = n;
    if (modelo && W.has(modelo)) p += 4; else if (n.slice(1, 3).some((w) => w.length >= 3 && W.has(w))) p += 3;
    if (marca && W.has(marca)) p += 1;
    for (const ano of String(c.carro).match(/\b(19|20)\d{2}\b/g) || []) if (W.has(ano)) { p += 2; break; }
    const cor = norm(c.cor).replace(/a$/, '');
    if (cor && CORES.some((k) => W.has(k) && k.replace(/a$|o$/, '') === cor.replace(/o$/, ''))) p += 1;
    if (c.placa && T.replace(/[^a-z0-9]/g, '').includes(norm(c.placa).replace(/[^a-z0-9]/g, ''))) p += 6;
    return { c, p };
  }).filter((x) => x.p >= 3).sort((a, b) => b.p - a.p);
  if (!pont.length) return { carro: null };
  if (pont[1] && pont[1].p === pont[0].p) return { carro: null, duvida: `Qual carro: ${pont.filter((x) => x.p === pont[0].p).slice(0, 3).map((x) => x.c.carro + (x.c.cor ? ` ${x.c.cor.toLowerCase()}` : '')).join(' ou ')}?` };
  return { carro: pont[0].c };
}
const CAT_CONTA = [['energia', /energia|luz|copel|celesc|cemig|enel|light|eletric/], ['agua_internet', /agua|sanepar|internet|telefone|celular|vivo|claro|tim/], ['aluguel', /aluguel/],
  ['contador', /contador|contabil/], ['sistemas', /sistema|assinatura/], ['impostos', /imposto|das|simples/], ['marketing', /marketing|anuncio/], ['salarios', /salario|pro.?labore|folha/]];
function regras(texto, ctx) {
  const T = norm(texto);
  const out = { transcricao: texto, acoes: [], resposta: '', duvida: '', fonte: 'regras' };
  // Conta paga
  if (/(conta|boleto|fatura)/.test(T) && /(pag[ao]|paguei|quitad|pagamos)/.test(T)) {
    const cat = CAT_CONTA.find(([, re]) => re.test(T))?.[0];
    const cands = ctx.contas.filter((c) => (cat ? norm(c.categoria).includes(norm(require('./gestao').EXP_CATS[cat]).split(/[ ,]/)[0]) : false) || palavras(c.descricao).some((w) => w.length >= 4 && T.includes(w)));
    const hojeS = hoje();
    cands.sort((a, b) => Math.abs(Date.parse(a.vencimento) - Date.parse(hojeS)) - Math.abs(Date.parse(b.vencimento) - Date.parse(hojeS)));
    if (cands[0]) out.acoes.push({ tipo: 'conta_paga', expense_id: cands[0].id });
    else out.duvida = 'Não achei essa conta em aberto. Ela está lançada em Gestão > Despesas da loja?';
    return out;
  }
  const { carro, duvida } = acharCarro(texto, ctx.carros);
  if (!carro) { out.duvida = duvida || 'Não identifiquei o carro. Fale o modelo e o ano (ou a placa).'; return out; }
  // Oferta / preço: "oferta de 34500 na Ecosport", "tira a oferta do Jetta", "preço do Gol para 45 mil"
  const valorFalado = (() => {
    const m = T.match(/(\d{1,3}(?:[.\s]\d{3})+|\d{4,7})(?:,\d{2})?\s*(mil)?/) || T.match(/(\d{1,3})\s*mil(?:\s*e\s*(\d{1,3}))?/);
    if (!m) return 0;
    if (/mil/.test(m[0]) && !/\d{4}/.test(m[1].replace(/\D/g, ''))) return Number(m[1]) * 1000 + (Number(m[2]) || 0);
    return Number(String(m[1]).replace(/\D/g, ''));
  })();
  const anos = (String(carro.carro).match(/\b(19|20)\d{2}\b/g) || []).map(Number);
  const valor = anos.includes(valorFalado) ? 0 : valorFalado;
  if (/(oferta|promocao|promocional)/.test(T)) {
    if (/(tira|tirar|remov|cancel|sem oferta|acabou)/.test(T)) out.acoes.push({ tipo: 'oferta', vehicle_id: carro.id, remover: true });
    else if (valor) out.acoes.push({ tipo: 'oferta', vehicle_id: carro.id, valor });
    else out.duvida = 'Qual o valor da oferta?';
    return out;
  }
  if (/(preco|valor de venda)/.test(T) && /(muda|mudar|altera|alterar|ajusta|ajustar|coloca|colocar|para|pra)/.test(T) && valor) {
    out.acoes.push({ tipo: 'preco', vehicle_id: carro.id, valor });
    return out;
  }
  // Incluir preparação
  if (/(inclu|adicion|anot|precisa|pendencia)/.test(T)) {
    // o serviço é o que vem depois de "realizar/fazer/de" (ou depois do nome do carro)
    const orig = String(texto);
    const m = orig.match(/(?:de realizar|realizar|de fazer|fazer|precisa(?: de)?|pendência de preparação de|pendencia de preparacao de)\s+(.+)$/i)
      || orig.match(/\b(?:19|20)\d{2}\b\s*(?:de\s+)?(.+)$/);
    const desc = (m ? m[1] : '').replace(/^(de|da|do|a|o)\s+/i, '').trim();
    if (desc.length >= 3) { out.acoes.push({ tipo: 'preparacao_add', vehicle_id: carro.id, itens: [{ descricao: desc.charAt(0).toUpperCase() + desc.slice(1), status: 'pendente' }] }); return out; }
  }
  // Onde está o carro
  if (/(patio|voltou|chegou na loja|esta na loja)/.test(T)) out.acoes.push({ tipo: 'local', vehicle_id: carro.id, status: 'patio' });
  else if (/(foi para|levou|levamos|mandei|mandamos|esta na|esta no|deixei)/.test(T)) {
    const STOP = ['do', 'da', 'de', 'dos', 'das', 'oficina', 'auto', 'centro', 'loja', 'mecanica', 'funilaria'];
    const parc = ctx.parceiros.find((p) => palavras(p.nome).filter((w) => !STOP.includes(w)).some((w) => palavras(texto).includes(w)));
    const st = /(funilaria|pintura|oficina|mecanic|eletric|retifica|manutencao|borracharia|lavador|estetica)/.test(T) || parc ? 'manutencao' : /(cliente|test.?drive)/.test(T) ? 'cliente' : /(loja parceira|outra loja)/.test(T) ? 'loja_parceira' : null;
    if (st) out.acoes.push({ tipo: 'local', vehicle_id: carro.id, status: st, parceiro_id: parc?.id || null });
  }
  // Serviço pronto: marca itens abertos citados (ou todos se "ficou pronto" e só houver um)
  if (/(pronto|pronta|terminou|terminaram|concluid|feito|feita|finaliz)/.test(T) && carro.preparacao_aberta.length) {
    const citados = carro.preparacao_aberta.filter((i) => palavras(i.descricao).filter((w) => w.length >= 4).some((w) => T.includes(w)));
    const ids = (citados.length ? citados : carro.preparacao_aberta.length === 1 ? carro.preparacao_aberta : []).map((i) => i.id);
    if (ids.length) out.acoes.push({ tipo: 'preparacao_feito', vehicle_id: carro.id, item_ids: ids });
    if (!out.acoes.some((a) => a.tipo === 'local') && /(oficina|funilaria|parceiro)/.test(T)) out.acoes.push({ tipo: 'local', vehicle_id: carro.id, status: 'patio' });
  }
  if (!out.acoes.length) out.duvida = `Entendi o ${carro.carro}, mas não o que fazer. Diga, por exemplo: "está no pátio", "foi para a oficina" ou "inclua alinhamento".`;
  return out;
}

function executar(user, acoes) {
  const feitas = [];
  for (const a of validar(user, (acoes || []).map((x) => ({ ...x, expense_id: x.expense_id, item_ids: x.item_ids, itens: x.itens })))) {
    if (!a.ok) { feitas.push({ ...a, feito: false }); continue; }
    try {
      if (a.tipo === 'local') G.setLocation(user.storeId, a.vehicle_id, { status: a.status, parceiro_id: a.parceiro_id, previsao: a.previsao, obs: a.obs }, user.id);
      if (a.tipo === 'preparacao_add') PR.add(user.storeId, a.vehicle_id, { itens: a.itens }, user.id);
      if (a.tipo === 'preparacao_feito') a.item_ids.forEach((id) => PR.update(user.storeId, id, { status: 'feito', ...(a.custo ? { custo: a.custo } : {}) }, user.id));
      if (a.tipo === 'conta_paga') G.payExpense(user.storeId, a.expense_id, true);
      if (a.tipo === 'oferta' || a.tipo === 'preco') {
        const v = get('SELECT * FROM vehicles WHERE id = ? AND store_id = ?', a.vehicle_id, user.storeId);
        if (a.tipo === 'preco') run("UPDATE vehicles SET preco = ?, updated_at = datetime('now') WHERE id = ?", a.valor, v.id);
        else if (a.remover) run("UPDATE vehicles SET preco_oferta = 0, oferta_desde = NULL, updated_at = datetime('now') WHERE id = ?", v.id);
        else run("UPDATE vehicles SET preco_oferta = ?, oferta_desde = datetime('now'), updated_at = datetime('now') WHERE id = ?", a.valor, v.id);
        try { require('./arts').schedule(v.id); } catch { /* artes são refeitas depois */ }
      }
      if (a.tipo === 'despesa_add') G.addExpense(user.storeId, { descricao: a.descricao, valor: a.valor, categoria: a.categoria, data: a.data, pago: a.pago });
      feitas.push({ ...a, feito: true });
    } catch (e) { feitas.push({ ...a, feito: false, erro: e.message }); }
  }
  const ok = feitas.filter((a) => a.feito);
  if (ok.length) logEvent(user.storeId, `Comando de voz (${user.name || 'usuário'}): ${ok.map((a) => a.texto).join('; ')}`);
  return feitas;
}

// Frase para a Siri/Alexa falar de volta.
function fala(r, feitas) {
  if (r.duvida && !feitas?.length) return r.duvida;
  const ok = (feitas || []).filter((a) => a.feito); const erro = (feitas || []).filter((a) => !a.feito);
  if (!ok.length && !erro.length) return r.resposta || 'Não entendi o que fazer. Pode repetir com o modelo do carro?';
  return [ok.length ? `Pronto: ${ok.map((a) => a.texto).join('; ')}.` : '', erro.length ? `Não consegui: ${erro.map((a) => `${a.texto || a.tipo_label} (${a.erro})`).join('; ')}.` : ''].filter(Boolean).join(' ');
}

/* ---------------- Chaves para Siri (Atalhos), Alexa e outras integrações (uma por aparelho) ---------------- */
const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
function gerarChave(userId, nome = 'Siri') {
  const t = `gv_${crypto.randomBytes(20).toString('hex')}`;
  const u = get('SELECT store_id FROM users WHERE id = ?', userId);
  run('INSERT INTO voz_chaves (store_id, user_id, nome, hash) VALUES (?, ?, ?, ?)', u.store_id, userId, str(nome, 40) || 'Assistente', hash(t));
  return t;
}
function chaves(userId) { return all('SELECT id, nome, created_at, usado_em FROM voz_chaves WHERE user_id = ? ORDER BY id DESC', userId); }
function removerChave(userId, id) {
  if (id) run('DELETE FROM voz_chaves WHERE id = ? AND user_id = ?', Number(id), userId);
  else { run('DELETE FROM voz_chaves WHERE user_id = ?', userId); run("UPDATE users SET voz_token = '' WHERE id = ?", userId); }
}
function temChave(userId) { return chaves(userId).length > 0 || !!get('SELECT voz_token FROM users WHERE id = ?', userId)?.voz_token; }
// Usuário dono da chave, no mesmo formato de req.user.
function usuarioDaChave(t) {
  if (!/^gv_[a-f0-9]{40}$/.test(String(t || ''))) return null;
  const h = hash(t);
  const k = get('SELECT * FROM voz_chaves WHERE hash = ?', h);
  const u = k ? get('SELECT * FROM users WHERE id = ? AND active = 1', k.user_id) : get('SELECT * FROM users WHERE voz_token = ? AND active = 1', h);
  if (!u) return null;
  if (k) run("UPDATE voz_chaves SET usado_em = datetime('now') WHERE id = ?", k.id);
  return { id: u.id, storeId: u.store_id, name: u.name, role: u.role, perms: T.permsOf(u) };
}

module.exports = { TIPOS, contexto, interpretar, regras, acharCarro, validar, executar, fala, gerarChave, chaves, removerChave, temChave, usuarioDaChave };
