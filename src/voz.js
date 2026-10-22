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
};
const PERM = { local: 'parceiros', preparacao_add: ['cadastrar', 'gestao', 'vender'], preparacao_feito: ['cadastrar', 'gestao', 'vender'], conta_paga: 'financeiro', despesa_add: 'financeiro' };
const pode = (user, tipo) => [].concat(PERM[tipo] || []).some((p) => user.perms?.has(p));

function contexto(storeId) {
  const carros = all(`SELECT * FROM vehicles WHERE store_id = ? AND status != 'vendido' ORDER BY updated_at DESC LIMIT 150`, storeId).map((v) => {
    const p = PR.doVeiculo(v.id);
    return {
      id: v.id, carro: [v.marca, v.modelo, v.versao, v.ano_fab && v.ano_modelo ? `${v.ano_fab}/${v.ano_modelo}` : v.ano_modelo].filter(Boolean).join(' '), cor: v.cor || '', placa: v.placa || '',
      situacao: v.status === 'avaliacao' ? 'em avaliação' : 'estoque', onde: G.LOCAL[v.local_status || 'patio'],
      parceiro_id: v.local_parceiro_id || null, preparacao_aberta: p.itens.filter((i) => !i.feito).map((i) => ({ id: i.id, descricao: i.descricao })),
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

async function gemini(partes) {
  const key = require('./settings').chatAi().key;
  if (!key) throw httpError(503, 'A inteligência artificial não está configurada (Configurações > Sistema).');
  const base = (process.env.GEMINI_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
  const modelos = [...new Set([require('./settings').chatAi().model, 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite'].filter(Boolean))];
  let ultimo = '';
  for (let rodada = 0; rodada < 2; rodada++) {
    for (const model of modelos) {
      try {
        const r = await fetch(`${base}/v1beta/models/${model}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, signal: AbortSignal.timeout(30000),
          body: JSON.stringify({ contents: [{ role: 'user', parts: partes }], generationConfig: { responseMimeType: 'application/json', temperature: 0, ...(/2\.5/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}) } }),
        });
        if (!r.ok) { ultimo = `${r.status}`; continue; }
        const d = await r.json();
        const j = JSON.parse((d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(''));
        if (j && typeof j === 'object') return j;
      } catch (e) { ultimo = e.message; }
    }
  }
  throw httpError(502, `Não consegui entender agora (IA indisponível${ultimo ? `: ${ultimo}` : ''}). Tente de novo em instantes.`);
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
async function interpretar(user, { texto, audio }) {
  const t = str(texto, 1000);
  if (!t && !audio?.buffer?.length) throw httpError(400, 'Fale ou digite o que quer fazer.');
  const partes = [{ text: prompt(contexto(user.storeId)) }];
  if (audio?.buffer?.length) partes.push({ text: 'O comando está no áudio a seguir (português do Brasil). Coloque em "transcricao" o que foi falado.' }, { inline_data: { mime_type: String(audio.mimetype || 'audio/webm').split(';')[0], data: Buffer.from(audio.buffer).toString('base64') } });
  else partes.push({ text: `Comando: ${t}` });
  const j = await gemini(partes);
  const acoes = validar(user, j.acoes);
  return { transcricao: str(j.transcricao || t, 1000), resposta: str(j.resposta, 400), duvida: str(j.duvida, 400), acoes };
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

/* ---------------- Chave para Siri (Atalhos), Alexa e outras integrações ---------------- */
const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
function gerarChave(userId) {
  const t = `gv_${crypto.randomBytes(20).toString('hex')}`;
  run('UPDATE users SET voz_token = ? WHERE id = ?', hash(t), userId);
  return t;
}
function removerChave(userId) { run("UPDATE users SET voz_token = '' WHERE id = ?", userId); }
function temChave(userId) { return !!get('SELECT voz_token FROM users WHERE id = ?', userId)?.voz_token; }
// Usuário dono da chave, no mesmo formato de req.user.
function usuarioDaChave(t) {
  if (!/^gv_[a-f0-9]{40}$/.test(String(t || ''))) return null;
  const u = get('SELECT * FROM users WHERE voz_token = ? AND active = 1', hash(t));
  if (!u) return null;
  return { id: u.id, storeId: u.store_id, name: u.name, role: u.role, perms: T.permsOf(u) };
}

module.exports = { TIPOS, contexto, interpretar, validar, executar, fala, gerarChave, removerChave, temChave, usuarioDaChave };
