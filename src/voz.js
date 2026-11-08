// Comandos de voz (v2.15): o usuário fala (ou digita) e o GiroAuto entende e faz.
// Ex.: "o Jetta 2013 preto ficou pronto na oficina e está no pátio", "inclua na Ecosport 2009 alinhamento e balanceamento",
// "a conta de energia foi paga". A IA (Gemini) transforma a frase em ações; o servidor confere cada uma contra os dados
// da loja (carro, parceiro, conta) e as permissões do usuário antes de executar.
const crypto = require('node:crypto');
const { get, all, run, logEvent } = require('./db');
const G = require('./gestao');
const PR = require('./preparacao');
const T = require('./team');
const V = require('./vehicles');

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
  // v2.21: o comando de voz alcança o resto do sistema
  carro_dados: 'Dados do carro',
  custo: 'Custo do carro',
  vendido: 'Marcar como vendido',
  doc: 'Documentação (transferência)',
  pendencia: 'Pendência do carro',
  instagram: 'Divulgar no Instagram',
  marketplace: 'Publicar no Marketplace',
  lead_novo: 'Novo lead no CRM',
  lead_etapa: 'Mover lead no CRM',
  lead_nota: 'Anotação no lead',
  visita: 'Agendar visita',
  visita_status: 'Resultado da visita',
  tarefa: 'Nova tarefa',
  tarefa_feita: 'Concluir tarefa',
  campanha: 'Campanha de anúncios',
  abrir: 'Abrir tela',
};
const CRM_PERM = ['vender', 'gestao'];
const PERM = {
  local: 'parceiros', preparacao_add: ['cadastrar', 'gestao', 'vender'], preparacao_feito: ['cadastrar', 'gestao', 'vender'], conta_paga: 'financeiro', despesa_add: 'financeiro', oferta: 'precos', preco: 'precos',
  carro_dados: 'cadastrar', custo: 'financeiro', vendido: 'vender', doc: CRM_PERM, pendencia: CRM_PERM, instagram: 'publicar', marketplace: 'publicar',
  lead_novo: CRM_PERM, lead_etapa: CRM_PERM, lead_nota: CRM_PERM, visita: CRM_PERM, visita_status: CRM_PERM, tarefa: CRM_PERM, tarefa_feita: CRM_PERM, campanha: 'campanhas',
};
const pode = (user, tipo) => tipo === 'abrir' || [].concat(PERM[tipo] || []).some((p) => user.perms?.has(p));
// Telas que o comando "abra…" conhece (as mesmas do menu).
const TELAS = { painel: 'Painel', estoque: 'Estoque', novo: 'Novo veículo', crm: 'CRM', republicacao: 'Republicação', campanhas: 'Campanhas', gestao: 'Gestão', resultados: 'Resultados', contratos: 'Contratos', equipe: 'Equipe', config: 'Configurações' };
const nomeCarro = (v) => [v.marca, v.modelo, v.versao, v.ano_fab && v.ano_modelo ? `${v.ano_fab}/${v.ano_modelo}` : v.ano_modelo].filter(Boolean).join(' ');

function contexto(user) {
  const storeId = user.storeId;
  const CRM = require('./crm');
  const carros = all(`SELECT * FROM vehicles WHERE store_id = ? AND status != 'vendido' ORDER BY updated_at DESC LIMIT 100`, storeId).map((v) => {
    const p = PR.doVeiculo(v.id);
    return {
      id: v.id, carro: nomeCarro(v), cor: v.cor || '', placa: v.placa || '', km: v.km || 0, situacao: v.status,
      preco: v.preco || 0, oferta: v.preco_oferta || 0, ...(v.status === 'avaliacao' ? { avaliacao: true } : {}), ...(v.local_status && v.local_status !== 'patio' ? { fora: G.LOCAL[v.local_status] } : {}),
      preparacao_aberta: p.itens.filter((i) => !i.feito).map((i) => ({ id: i.id, descricao: i.descricao })),
    };
  });
  // Vendidos com a documentação ainda andando (ou vendidos há pouco): para "o ATPV da Biz foi entregue".
  const vendidos = all(`SELECT * FROM vehicles WHERE store_id = ? AND status = 'vendido' AND (COALESCE(doc_status, '') != 'transferido' OR vendido_em >= datetime('now', '-60 days'))
    ORDER BY vendido_em DESC LIMIT 60`, storeId).map((v) => ({ id: v.id, carro: nomeCarro(v), cor: v.cor || '', placa: v.placa || '', comprador: v.venda_comprador || '', documento: G.DOC_STATUS[v.doc_status] || 'Aguardando preenchimento' }));
  const parceiros = all('SELECT id, nome, tipo FROM partners WHERE store_id = ? ORDER BY nome', storeId).map((p) => ({ id: p.id, nome: p.nome, tipo: G.PARTNER_TYPES[p.tipo] || p.tipo }));
  const contas = all(`SELECT id, data, categoria, descricao, valor FROM store_expenses WHERE store_id = ? AND pago = 0 AND data <= date('now', '+45 days') ORDER BY data LIMIT 60`, storeId)
    .map((e) => ({ id: e.id, vencimento: e.data, categoria: G.EXP_CATS[e.categoria] || e.categoria, descricao: e.descricao, valor: e.valor }));
  const ctx = { carros, vendidos, parceiros, contas };
  if (CRM_PERM.some((p) => user.perms?.has(p))) {
    const todos = user.perms.has('gestao');
    ctx.leads = all(`SELECT l.id, l.nome, l.telefone, l.etapa, l.vehicle_id, l.vendedor_id, v.marca, v.modelo, v.ano_modelo FROM leads l LEFT JOIN vehicles v ON v.id = l.vehicle_id
      WHERE l.store_id = ? AND (l.etapa IN (${CRM.ABERTAS.map(() => '?').join(',')}) OR l.updated_at >= datetime('now', '-45 days')) ${todos ? '' : 'AND (l.vendedor_id IS NULL OR l.vendedor_id = ?)'}
      ORDER BY l.updated_at DESC LIMIT 150`, storeId, ...CRM.ABERTAS, ...(todos ? [] : [user.id]))
      .map((l) => ({ id: l.id, nome: l.nome || '', fone_final: String(l.telefone || '').slice(-4), etapa: l.etapa, ...(l.marca ? { carro: `${l.marca} ${l.modelo} ${l.ano_modelo || ''}`.trim() } : {}) }));
    ctx.visitas = CRM.visits(user, {}).filter((x) => ['agendada', 'confirmada'].includes(x.status)).slice(0, 40)
      .map((x) => ({ id: x.id, quando: x.data_hora, cliente: x.lead_nome || '', carro: x.veiculo || '', status: x.status }));
    ctx.tarefas = CRM.tasks(user, {}).filter((t) => !t.feita_em).slice(0, 40).map((t) => ({ id: t.id, titulo: t.titulo, vence: t.vence_em, cliente: t.lead_nome || '' }));
    ctx.pendencias = all(`SELECT id, vehicle_id, tipo, descricao, valor FROM pendencias WHERE store_id = ? AND status NOT IN ('resolvida','cancelada') ORDER BY id DESC LIMIT 60`, storeId);
  }
  if (user.perms?.has('campanhas')) ctx.campanhas = all(`SELECT id, name AS nome, status FROM campaigns WHERE store_id = ? AND meta_campaign_id IS NOT NULL AND meta_campaign_id != '' AND status IN ('ativa','pausada','analise') ORDER BY id DESC LIMIT 20`, storeId);
  return ctx;
}

function prompt(ctx) {
  const CRM = require('./crm');
  const PD = require('./pendencias');
  return `Você é o assistente de voz do GiroAuto, sistema de uma loja de veículos. Hoje é ${hoje()}.
O usuário falou (ou digitou) um comando. Transforme em ações no sistema, usando SOMENTE os ids que existem nos dados abaixo.

Ações possíveis (campo "tipo"):
- "local": onde o carro está. Campos: vehicle_id, status (uma de: ${Object.entries(G.LOCAL).map(([k, l]) => `${k}=${l}`).join('; ')}), parceiro_id (se for parceiro da lista), parceiro_nome e parceiro_tipo (${Object.keys(G.PARTNER_TYPES).join(', ')}) quando o lugar NÃO está na lista de parceiros (ex.: "lavador do Alemão" => parceiro_nome "Lavador do Alemão", parceiro_tipo "lavador"), previsao (AAAA-MM-DD, se disser quando volta), obs.
  "ficou pronto e voltou/está no pátio" => status "patio". "foi para a oficina do Zé" => status "manutencao" com o parceiro.
- "preparacao_add": incluir itens de preparação/serviço no carro. Campos: vehicle_id, itens: [{descricao, status ("pendente" ou "feito"), custo (número em reais, se falar valor)}].
- "preparacao_feito": marcar como feitos itens de preparação já abertos do carro. Campos: vehicle_id, item_ids (ids da lista preparacao_aberta), custo (se falar quanto custou e for um item só).
- "conta_paga": conta da loja foi paga. Campos: expense_id (da lista de contas em aberto).
- "despesa_add": lançar despesa/conta da loja que não está na lista. Campos: descricao, valor, categoria (${Object.keys(G.EXP_CATS).join(', ')}), data (AAAA-MM-DD), pago (true/false).
- "oferta": colocar, mudar ou tirar a oferta (preço promocional). Campos: vehicle_id, valor ou remover: true.
- "preco": mudar o preço de venda (normal) do carro. Campos: vehicle_id, valor.
- "carro_dados": corrigir dados do carro. Campos: vehicle_id e só os que mudaram entre km (número), cor, placa.
- "custo": gasto feito no carro (lavagem, peça, despachante…) que não é item de preparação aberto. Campos: vehicle_id, valor, descricao, categoria (${Object.keys(G.COST_CATS).join(', ')}), parceiro_id (opcional), previsto (true se ainda não foi pago/feito).
- "vendido": o carro foi vendido. Campos: vehicle_id, valor (se falar), comprador (nome, se falar), pagamento (${G.PAGAMENTOS.join(', ')}).
- "doc": andamento da documentação/transferência de um carro VENDIDO (lista "vendidos"). Campos: vehicle_id, status (${Object.entries(G.DOC_STATUS).map(([k, l]) => `${k}=${l}`).join('; ')}), obs (obrigatória se "outro").
  Use a etapa MAIS AVANÇADA citada: "ATPV emitido e entregue ao comprador" => "entregue"; "ATPV emitido/preenchido" => "preenchido"; "comunicação de venda feita" => "comunicacao"; "transferiu" => "transferido".
- "pendencia": registrar ou mudar pendência do carro (multa, IPVA…). Campos: pendencia_id (se for uma da lista e só mudar a situação) ou vehicle_id + pendencia_tipo (${Object.keys(PD.TIPOS).join(', ')}) + descricao + valor + vencimento (AAAA-MM-DD); status (${Object.keys(PD.STATUS).join(', ')}); responsavel (${Object.keys(PD.RESPONSAVEL).join(', ')}).
- "instagram": divulgar/publicar o carro no Instagram. Campos: vehicle_id.
- "marketplace": publicar ou republicar o carro no Facebook Marketplace (pela extensão do Chrome). Campos: vehicle_id.
- "lead_novo": cadastrar cliente interessado no CRM. Campos: nome, telefone (DDD+número), vehicle_id (carro de interesse), interesse, origem (${Object.keys(CRM.ORIGENS).join(', ')}).
- "lead_etapa": mover o lead de etapa. Campos: lead_id, etapa (${CRM.ETAPAS.map(([k, l]) => `${k}=${l}`).join('; ')}), motivo_perda (obrigatório se "perdido": ${CRM.MOTIVOS.join(' | ')}).
- "lead_nota": registrar contato/anotação no lead. Campos: lead_id, nota_tipo (${Object.keys(CRM.NOTA).join(', ')}), texto.
- "visita": agendar visita/test-drive. Campos: lead_id (ou nome e telefone se o cliente não está na lista), vehicle_id, data_hora (AAAA-MM-DD HH:MM), visita_tipo (${Object.keys(CRM.VISITA_TIPOS).join(', ')}), obs.
- "visita_status": resultado de visita da lista. Campos: visita_id, status (${Object.keys(CRM.VISITA_STATUS).join(', ')}).
- "tarefa": lembrete/tarefa. Campos: titulo, vence_em (AAAA-MM-DD), lead_id (opcional).
- "tarefa_feita": concluir tarefa da lista. Campos: tarefa_id.
- "campanha": pausar, ativar ou encerrar campanha de anúncios da lista. Campos: campanha_id, acao ("pausar", "ativar" ou "encerrar").
- "abrir": abrir uma tela ou um cadastro. Campos: tela (${Object.keys(TELAS).join(', ')}), ou vehicle_id (abre o carro), ou lead_id (abre o lead).

Regras:
- Identifique carro por modelo, ano, cor, placa ou apelido; lead pelo nome (aceite grafia aproximada, ex.: "Creidi" = "Kreidi"/"Creide"). Se houver mais de um possível e não der para decidir, NÃO invente: deixe acoes vazio e escreva a pergunta em "duvida".
- "Arquivar o lead"/"mover para arquivados" => lead_etapa com etapa "arquivado".
- Quando um carro volta pronto da oficina, se a fala indicar o serviço feito e ele existir em preparacao_aberta, inclua também "preparacao_feito".
- Para "conta de energia/luz paga", procure a conta em aberto da categoria Energia; se houver mais de uma, a de vencimento mais próximo.
- Datas relativas ("amanhã às 15h", "sábado de manhã" = 09:00) viram datas absolutas a partir de hoje.
- TODA ação precisa do campo "tipo" (um dos acima), além dos seus campos. Ex.: {"tipo":"lead_etapa","lead_id":2,"etapa":"arquivado"}.
- Não crie ações que o usuário não pediu. Valores em reais como número (ex.: 350).
- Se for uma PERGUNTA sobre os dados (ex.: "quantos carros estão na oficina?", "qual o preço do Jetta?"), responda em "resposta" usando os dados e deixe acoes vazio.
- "resposta": frase curta e natural, em português, dizendo o que será feito (ou a resposta da pergunta).

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
const dataHora = (x) => { const m = String(x || '').match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/); return m ? `${m[1]} ${m[2]}:${m[3]}` : null; };
const dBr = (d) => String(d || '').slice(0, 10).split('-').reverse().join('/') + (String(d || '').length > 10 ? ` às ${String(d).slice(11, 16)}` : '');
function tipoPelosCampos(a) {
  if (a.lead_id && a.etapa) return 'lead_etapa';
  if (a.lead_id && (a.nota || a.nota_tipo)) return 'lead_nota';
  if (a.data_hora) return 'visita';
  if (a.visita_id) return 'visita_status';
  if (a.tarefa_id) return 'tarefa_feita';
  if (a.campanha_id) return 'campanha';
  if (a.expense_id) return 'conta_paga';
  if (a.pendencia_id || a.pendencia_tipo) return 'pendencia';
  if (a.item_ids) return 'preparacao_feito';
  if (a.itens) return 'preparacao_add';
  if (a.vehicle_id && G.LOCAL[a.status]) return 'local';
  if (a.vehicle_id && G.DOC_STATUS[a.status]) return 'doc';
  if (a.tela) return 'abrir';
  return null;
}
function validar(user, acoes) {
  const sid = user.storeId;
  const CRM = require('./crm');
  const PD = require('./pendencias');
  const out = [];
  const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
  for (const a0 of (Array.isArray(acoes) ? acoes : obj(acoes).tipo ? [acoes] : []).slice(0, 8)) {
    // A tela devolve a ação já conferida (com "dados" e "lead_novo" montados) para executar: aceita as duas formas.
    const a = { ...obj(a0.lead_novo), ...obj(a0.dados), ...obj(a0) };
    // A IA às vezes esquece o "tipo" ({"lead_id":2,"etapa":"arquivado"}): deduz pelos campos que vieram.
    if (!TIPOS[a.tipo]) a.tipo = tipoPelosCampos(a);
    const tipo = TIPOS[a?.tipo] ? a.tipo : null;
    if (!tipo) continue;
    const item = { tipo, tipo_label: TIPOS[tipo], ok: true, erro: '' };
    const falha = (msg) => { item.ok = false; item.erro = item.erro || msg; };
    const v = a.vehicle_id ? get('SELECT * FROM vehicles WHERE id = ? AND store_id = ?', Number(a.vehicle_id), sid) : null;
    const nomeV = v ? `${[v.marca, v.modelo, v.ano_modelo].filter(Boolean).join(' ')}${v.cor ? ` ${v.cor.toLowerCase()}` : ''}${v.placa ? ` (${v.placa})` : ''}` : '';
    // Lead: só os que o usuário pode ver (vendedor vê os seus e os sem dono).
    let lead = null;
    if (a.lead_id) { try { lead = CRM.findFor(user, a.lead_id); } catch (e) { falha(e.message); } }
    if (['local', 'preparacao_add', 'preparacao_feito', 'carro_dados', 'custo', 'vendido', 'doc', 'instagram', 'marketplace', 'oferta', 'preco'].includes(tipo) && !v) falha('Carro não encontrado.');
    if (['lead_etapa', 'lead_nota'].includes(tipo) && !lead) falha('Lead não encontrado.');
    if (!pode(user, tipo)) falha('Seu usuário não tem permissão para isso.');
    if (tipo === 'local' && v) {
      const status = G.LOCAL[a.status] ? a.status : 'patio';
      let parc = a.parceiro_id ? get('SELECT id, nome FROM partners WHERE id = ? AND store_id = ?', Number(a.parceiro_id), sid) : null;
      const pnome = str(a.parceiro_nome || a.parceiro_novo?.nome, 120);
      // Parceiro falado pelo nome: usa o cadastrado com o mesmo nome; se não houver, cadastra junto.
      if (!parc && pnome) parc = all('SELECT id, nome FROM partners WHERE store_id = ?', sid).find((p) => norm(p.nome) === norm(pnome)) || null;
      const novo = !parc && pnome && status !== 'patio' ? { nome: pnome.replace(/^./, (c) => c.toUpperCase()), tipo: G.PARTNER_TYPES[a.parceiro_tipo || a.parceiro_novo?.tipo] ? (a.parceiro_tipo || a.parceiro_novo.tipo) : 'outro' } : null;
      Object.assign(item, { vehicle_id: v.id, status, parceiro_id: status === 'patio' ? null : parc?.id || null, parceiro_novo: novo, previsao: data(a.previsao), obs: str(a.obs, 200),
        texto: `${nomeV}: ${G.LOCAL[status].toLowerCase()}${parc && status !== 'patio' ? ` (${parc.nome})` : novo ? ` (${novo.nome}, novo parceiro)` : ''}${data(a.previsao) ? `, previsão ${dBr(data(a.previsao))}` : ''}` });
    }
    if (tipo === 'preparacao_add' && v) {
      const itens = (Array.isArray(a.itens) ? a.itens : []).map((x) => ({ descricao: str(typeof x === 'string' ? x : x?.descricao, 200), status: x?.status === 'feito' ? 'feito' : 'pendente', custo: int(x?.custo) })).filter((x) => x.descricao).slice(0, 10);
      if (!itens.length) falha('Não entendi o que incluir.');
      Object.assign(item, { vehicle_id: v.id, itens, texto: `${nomeV}: incluir ${itens.map((x) => `"${x.descricao}"${x.status === 'feito' ? ' (já feito)' : ''}${x.custo ? ` ${brl(x.custo)}` : ''}`).join(', ')}` });
    }
    if (tipo === 'preparacao_feito' && v) {
      const abertos = all("SELECT id, descricao FROM preparacao WHERE vehicle_id = ? AND status != 'feito'", v.id);
      const ids = [].concat(a.item_ids || []).map(Number).filter((id) => abertos.some((x) => x.id === id));
      if (!ids.length) falha('Não achei o item de preparação.');
      Object.assign(item, { vehicle_id: v.id, item_ids: ids, custo: ids.length === 1 ? int(a.custo) : 0,
        texto: `${nomeV}: feito ${abertos.filter((x) => ids.includes(x.id)).map((x) => `"${x.descricao}"`).join(', ')}${ids.length === 1 && int(a.custo) ? ` (${brl(int(a.custo))})` : ''}` });
    }
    if (tipo === 'conta_paga') {
      const e = a.expense_id ? get('SELECT * FROM store_expenses WHERE id = ? AND store_id = ?', Number(a.expense_id), sid) : null;
      if (!e) falha('Conta não encontrada.');
      else if (e.pago) falha('Essa conta já está paga.');
      Object.assign(item, { expense_id: e?.id, texto: e ? `Conta paga: ${e.descricao || G.EXP_CATS[e.categoria]} de ${brl(e.valor)} (vencimento ${dBr(e.data)})` : 'Conta paga' });
    }
    if ((tipo === 'oferta' || tipo === 'preco') && v) {
      const valor = int(a.valor); const remover = tipo === 'oferta' && (a.remover === true || a.remover === 'true') && !valor;
      if (!valor && !remover) falha('Faltou o valor.');
      if (tipo === 'oferta' && valor && v.preco && valor >= v.preco) falha(`A oferta precisa ser menor que o preço (${brl(v.preco)}).`);
      Object.assign(item, { vehicle_id: v.id, valor, remover,
        texto: remover ? `${nomeV}: tirar a oferta (volta a ${brl(v.preco)})` : tipo === 'oferta' ? `${nomeV}: oferta de ${brl(valor)}${v.preco ? ` (de ${brl(v.preco)})` : ''}` : `${nomeV}: preço ${brl(valor)}${v.preco ? ` (era ${brl(v.preco)})` : ''}` });
    }
    if (tipo === 'despesa_add') {
      const valor = int(a.valor);
      if (!valor) falha('Faltou o valor da despesa.');
      const categoria = G.EXP_CATS[a.categoria] ? a.categoria : 'outros';
      Object.assign(item, { descricao: str(a.descricao, 200), valor, categoria, data: data(a.data) || hoje(), pago: a.pago !== false,
        texto: `Despesa: ${str(a.descricao, 200) || G.EXP_CATS[categoria]} ${brl(valor)} (${a.pago === false ? 'a pagar' : 'paga'})` });
    }
    if (tipo === 'carro_dados' && v) {
      const d = {};
      if (a.km !== undefined && a.km !== null && a.km !== '') d.km = int(a.km);
      if (str(a.cor, 40)) d.cor = str(a.cor, 40).replace(/^./, (c) => c.toUpperCase());
      if (str(a.placa, 10)) {
        d.placa = str(a.placa, 10).toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(d.placa)) falha('Placa inválida.');
      }
      if (!Object.keys(d).length) falha('Não entendi o que mudar no carro.');
      Object.assign(item, { vehicle_id: v.id, dados: d, texto: `${nomeV}: ${[d.km !== undefined ? `${d.km.toLocaleString('pt-BR')} km` : '', d.cor ? `cor ${d.cor}` : '', d.placa ? `placa ${d.placa}` : ''].filter(Boolean).join(', ')}` });
    }
    if (tipo === 'custo' && v) {
      const valor = int(a.valor);
      if (!valor) falha('Faltou o valor do custo.');
      const categoria = G.COST_CATS[a.categoria] ? a.categoria : 'outros';
      const parc = a.parceiro_id ? get('SELECT id, nome FROM partners WHERE id = ? AND store_id = ?', Number(a.parceiro_id), sid) : null;
      Object.assign(item, { vehicle_id: v.id, valor, categoria, descricao: str(a.descricao, 200), parceiro_id: parc?.id || null, previsto: a.previsto === true,
        texto: `${nomeV}: ${a.previsto === true ? 'custo previsto' : 'custo'} ${str(a.descricao, 200) || G.COST_CATS[categoria]} ${brl(valor)}${parc ? ` (${parc.nome})` : ''}` });
    }
    if (tipo === 'vendido' && v) {
      if (v.status === 'vendido') falha('Esse carro já está vendido.');
      if (v.status === 'avaliacao') falha('O carro ainda está em avaliação.');
      const valor = int(a.valor) || V.precoAnuncio(v) || 0;
      const pagamento = G.PAGAMENTOS.find((p) => norm(p) === norm(a.pagamento)) || '';
      Object.assign(item, { vehicle_id: v.id, valor, comprador: str(a.comprador, 120), pagamento,
        texto: `${nomeV}: vendido por ${brl(valor)}${str(a.comprador, 120) ? ` para ${str(a.comprador, 120)}` : ''}${pagamento ? ` (${pagamento})` : ''}. Complete os dados da venda depois, se precisar.` });
    }
    if (tipo === 'doc' && v) {
      if (v.status !== 'vendido') falha('A documentação só é acompanhada depois da venda.');
      const status = G.DOC_STATUS[a.status] ? a.status : null;
      if (!status) falha('Não entendi a etapa da documentação.');
      if (status === 'outro' && !str(a.obs)) falha('Em "Outro", diga o que está acontecendo com o documento.');
      Object.assign(item, { vehicle_id: v.id, status, obs: str(a.obs, 500),
        texto: `${nomeV}${v.venda_comprador ? ` (comprador ${v.venda_comprador})` : ''}: documentação "${G.DOC_STATUS[status] || '?'}"${str(a.obs) ? ` (${str(a.obs, 120)})` : ''}` });
    }
    if (tipo === 'pendencia') {
      const p = a.pendencia_id ? get('SELECT * FROM pendencias WHERE id = ? AND store_id = ?', Number(a.pendencia_id), sid) : null;
      const vv = v || (p && get('SELECT * FROM vehicles WHERE id = ?', p.vehicle_id));
      if (!p && !vv) falha('Carro não encontrado.');
      const d = { status: PD.STATUS[a.status] ? a.status : (p ? undefined : 'aberta') };
      if (!p) Object.assign(d, { vehicle_id: vv?.id, pendencia_tipo: PD.TIPOS[a.pendencia_tipo] ? a.pendencia_tipo : 'outro', descricao: str(a.descricao, 300), valor: a.valor, vencimento: data(a.vencimento), responsavel: PD.RESPONSAVEL[a.responsavel] ? a.responsavel : undefined });
      if (!p && d.pendencia_tipo === 'outro' && !d.descricao) falha('Diga qual é a pendência.');
      if (p && !d.status) falha('Diga o que mudou na pendência.');
      Object.assign(item, { pendencia_id: p?.id || null, dados: d,
        texto: p ? `${vv ? V.title(vv) : ''}: pendência "${PD.TIPOS[p.tipo]}${p.descricao ? ` (${p.descricao})` : ''}" ${(PD.STATUS[d.status] || '').toLowerCase()}`
          : `${vv ? V.title(vv) : ''}: nova pendência ${PD.TIPOS[d.pendencia_tipo]}${d.descricao ? ` (${d.descricao})` : ''}${int(a.valor) ? ` ${brl(int(a.valor))}` : ''}${d.vencimento ? `, vence ${dBr(d.vencimento)}` : ''}` });
    }
    if ((tipo === 'instagram' || tipo === 'marketplace') && v) {
      if (['vendido', 'avaliacao'].includes(v.status)) falha(v.status === 'vendido' ? 'Carro vendido não é divulgado.' : 'Carro em avaliação: passe para o estoque antes.');
      else if (!V.photosOf(v.id).length) falha('O carro não tem fotos.');
      if (tipo === 'marketplace' && item.ok) {
        const faltam = V.missingForPublish(v, V.photosOf(v.id).length);
        if (faltam.length) falha(`Para publicar, preencha: ${faltam.join(', ')}.`);
        if (get(`SELECT 1 FROM ext_jobs WHERE vehicle_id = ? AND status IN ('pendente','em_andamento')`, v.id)) falha('Já existe uma publicação deste carro na fila da extensão.');
      }
      Object.assign(item, { vehicle_id: v.id, texto: tipo === 'instagram' ? `${nomeV}: publicar no Instagram` : `${nomeV}: ${v.status === 'publicado' ? 'republicar' : 'publicar'} no Marketplace (pela extensão do Chrome)` });
    }
    if (tipo === 'lead_novo' || (tipo === 'visita' && !lead)) {
      const nome = str(a.nome, 120); const tel = require('./contatos').fone(a.telefone);
      if (!nome && !tel) falha(tipo === 'visita' ? 'Não achei o cliente: diga o nome (e o telefone, se for novo).' : 'Diga o nome do cliente.');
      if (tel && (tel.length < 10 || tel.length > 11)) falha('Telefone inválido: fale o DDD e o número.');
      item.lead_novo = { nome, telefone: tel, vehicle_id: v?.id || null, interesse: str(a.interesse, 300), origem: CRM.ORIGENS[a.origem] ? a.origem : 'loja' };
      if (tipo === 'lead_novo') item.texto = `Novo lead: ${nome || tel}${tel ? ` (${tel})` : ''}${v ? `, interesse no ${nomeV}` : ''}${item.lead_novo.interesse ? ` — ${item.lead_novo.interesse}` : ''}`;
    }
    if (tipo === 'lead_etapa' && lead) {
      const etapa = CRM.ETAPAS.some(([k]) => k === a.etapa) ? a.etapa : null;
      const motivo = str(a.motivo_perda, 200);
      if (!etapa) falha('Não entendi para qual etapa.');
      else if (etapa === lead.etapa) falha(`O lead já está em "${CRM.ETAPAS.find(([k]) => k === etapa)[1]}".`);
      if (etapa === 'perdido' && !motivo) falha('Diga o motivo da perda.');
      Object.assign(item, { lead_id: lead.id, etapa, motivo_perda: motivo,
        texto: `Lead ${lead.nome || lead.telefone}: ${CRM.ETAPAS.find(([k]) => k === lead.etapa)?.[1] || lead.etapa} → ${CRM.ETAPAS.find(([k]) => k === etapa)?.[1] || '?'}${motivo ? ` (${motivo})` : ''}` });
    }
    if (tipo === 'lead_nota' && lead) {
      const texto = str(a.nota ?? a.texto, 2000); const t = CRM.NOTA[a.nota_tipo] ? a.nota_tipo : 'nota';
      if (!texto && t === 'nota') falha('Diga o que anotar.');
      Object.assign(item, { lead_id: lead.id, nota_tipo: t, nota: texto, texto: `Lead ${lead.nome || lead.telefone}: ${CRM.NOTA[t]}${texto ? ` — ${texto}` : ''}` });
    }
    if (tipo === 'visita') {
      const dh = dataHora(a.data_hora);
      if (!dh) falha('Diga o dia e a hora da visita.');
      const vt = CRM.VISITA_TIPOS[a.visita_tipo] ? a.visita_tipo : 'visita';
      Object.assign(item, { lead_id: lead?.id || null, vehicle_id: v?.id || null, data_hora: dh, visita_tipo: vt, obs: str(a.obs, 300),
        texto: `${CRM.VISITA_TIPOS[vt]} ${dh ? dBr(dh) : ''} com ${lead ? lead.nome || lead.telefone : `${item.lead_novo?.nome || item.lead_novo?.telefone || '?'} (novo lead)`}${v ? ` (${nomeV})` : ''}` });
    }
    if (tipo === 'visita_status') {
      const x = a.visita_id ? get('SELECT x.*, l.nome AS lead_nome FROM lead_visits x LEFT JOIN leads l ON l.id = x.lead_id WHERE x.id = ? AND x.store_id = ?', Number(a.visita_id), sid) : null;
      if (!x) falha('Visita não encontrada.');
      const st = CRM.VISITA_STATUS[a.status] ? a.status : null;
      if (!st) falha('Não entendi o resultado da visita.');
      Object.assign(item, { visita_id: x?.id, status: st, texto: x ? `Visita de ${dBr(x.data_hora)}${x.lead_nome ? ` (${x.lead_nome})` : ''}: ${(CRM.VISITA_STATUS[st] || '').toLowerCase()}` : 'Visita' });
    }
    if (tipo === 'tarefa') {
      const titulo = str(a.titulo, 200);
      if (!titulo) falha('Diga o que é a tarefa.');
      Object.assign(item, { lead_id: lead?.id || null, titulo, vence_em: data(a.vence_em) || hoje(), texto: `Tarefa: ${titulo} (até ${dBr(data(a.vence_em) || hoje())})${lead ? ` — ${lead.nome}` : ''}` });
    }
    if (tipo === 'tarefa_feita') {
      const t = a.tarefa_id ? get('SELECT * FROM lead_tasks WHERE id = ? AND store_id = ?', Number(a.tarefa_id), sid) : null;
      if (!t) falha('Tarefa não encontrada.');
      Object.assign(item, { tarefa_id: t?.id, texto: `Tarefa concluída: ${t?.titulo || ''}` });
    }
    if (tipo === 'campanha') {
      const c = a.campanha_id ? get('SELECT * FROM campaigns WHERE id = ? AND store_id = ?', Number(a.campanha_id), sid) : null;
      const acao = { pausar: 'PAUSED', ativar: 'ACTIVE', encerrar: 'ARCHIVED' }[a.acao];
      if (!c?.meta_campaign_id) falha('Campanha não encontrada.');
      if (!acao) falha('Diga se é para pausar, ativar ou encerrar.');
      Object.assign(item, { campanha_id: c?.id, acao: a.acao, meta_status: acao, texto: `Campanha "${c?.name || '?'}": ${a.acao || '?'}` });
    }
    if (tipo === 'abrir') {
      if (lead) Object.assign(item, { lead_id: lead.id, texto: `Abrir o lead ${lead.nome || lead.telefone}` });
      else if (v) Object.assign(item, { vehicle_id: v.id, ir: `editar-${v.id}`, texto: `Abrir o ${nomeV}` });
      else if (TELAS[a.tela || a.ir]) Object.assign(item, { ir: a.tela || a.ir, texto: `Abrir ${TELAS[a.tela || a.ir]}` });
      else falha('Não entendi qual tela abrir.');
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
  const ctx = contexto(user);
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
    j = regras(t, ctx, { forcar: true });
    if (!j.acoes.length && !j.duvida) throw e;
  }
  const acoes = validar(user, j.acoes);
  // Ação que a IA inventou (tipo fora da lista) some na validação: fica no log para ajustar o prompt.
  if (Array.isArray(j.acoes) && j.acoes.length > acoes.length) console.error('voz: ações descartadas', JSON.stringify(j.acoes).slice(0, 600));
  else if (!Array.isArray(j.acoes) && j.acoes) console.error('voz: acoes fora do formato', JSON.stringify(j.acoes).slice(0, 600));
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
function regras(texto, ctx, { forcar = false } = {}) {
  const T = norm(texto);
  const out = { transcricao: texto, acoes: [], resposta: '', duvida: '', fonte: 'regras' };
  // v2.21: CRM, documentação, divulgação, venda, pendências, campanhas, perguntas e telas ficam com a IA.
  if (/\b(lead|cliente|visita|test.?drive|tarefa|lembr|instagram|marketplace|divulg|public|vend[ei]|vendid|document|atpv|transfer|comprador|pendenc(?!ia de prepara)|multa|ipva|campanha|anuncio|abr[ae]|mostr[ae]|quant[oa]s?|qual|quais|custo|gastei|gastamos|placa|km|quilometr)/.test(T) || /\?\s*$/.test(String(texto))) { if (!forcar) return out; }
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
    const STOP = ['do', 'da', 'de', 'dos', 'das', 'oficina', 'auto', 'centro', 'loja', 'mecanica', 'funilaria', 'lavador', 'lava', 'jato', 'estetica', 'automotiva', 'borracharia', 'eletrica', 'pintura', 'pneus', 'vidros', 'despachante', 'vistoria'];
    const parc = ctx.parceiros.find((p) => palavras(p.nome).filter((w) => !STOP.includes(w)).some((w) => palavras(texto).includes(w)));
    const st = /(funilaria|pintura|oficina|mecanic|eletric|retifica|manutencao|borracharia|lavador|estetica)/.test(T) || parc ? 'manutencao' : /(cliente|test.?drive)/.test(T) ? 'cliente' : /(loja parceira|outra loja)/.test(T) ? 'loja_parceira' : null;
    // Lugar com nome ("lavador do Alemão") que não está nos parceiros: a IA cadastra o parceiro junto.
    if (!forcar && st && !parc && /(oficina|funilaria|lavador|estetica|borracharia|mecanic|eletric|retifica)\w*\s+(do|da|de)\s+[a-z]{3,}/.test(T)) return { ...out, acoes: [] };
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

async function executar(user, acoes) {
  const CRM = require('./crm');
  const feitas = [];
  for (const a of validar(user, acoes || [])) {
    if (!a.ok) { feitas.push({ ...a, feito: false }); continue; }
    try {
      if (a.tipo === 'local') {
        let parceiro = a.parceiro_id;
        if (!parceiro && a.parceiro_novo) parceiro = G.savePartner(user.storeId, null, a.parceiro_novo);
        G.setLocation(user.storeId, a.vehicle_id, { status: a.status, parceiro_id: parceiro, previsao: a.previsao, obs: a.obs }, user.id);
      }
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
      if (a.tipo === 'carro_dados') {
        const cols = Object.keys(a.dados).filter((k) => ['km', 'cor', 'placa'].includes(k));
        run(`UPDATE vehicles SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ? AND store_id = ?`, ...cols.map((c) => a.dados[c]), a.vehicle_id, user.storeId);
      }
      if (a.tipo === 'custo') G.addCost(user.storeId, a.vehicle_id, { valor: a.valor, categoria: a.categoria, descricao: a.descricao, parceiro_id: a.parceiro_id, status: a.previsto ? 'previsto' : 'realizado' }, user.id);
      if (a.tipo === 'vendido') G.marcarVendido(user, a.vehicle_id, { venda_valor: a.valor, venda_comprador: a.comprador, venda_pagamento: a.pagamento });
      if (a.tipo === 'doc') G.setDocStatus(user.storeId, a.vehicle_id, { status: a.status, obs: a.obs }, user.id);
      if (a.tipo === 'pendencia') { const { pendencia_tipo: pt, ...d } = a.dados; require('./pendencias').save(user.storeId, a.pendencia_id, { ...d, ...(pt ? { tipo: pt } : {}) }, user.id); }
      if (a.tipo === 'instagram') await require('./channels').publishInstagram(user.storeId, a.vehicle_id);
      if (a.tipo === 'marketplace') {
        const v = V.serialize(V.findVehicle(user.storeId, a.vehicle_id));
        if (v.status === 'publicado' && !v.pode_republicar) throw httpError(409, `Publicado há ${v.dias_publicado} dia(s): republicar tão cedo aumenta o risco de bloqueio. Use o botão Republicar se quiser mesmo.`);
        if (v.status === 'rascunho') run("UPDATE vehicles SET status = 'pronto' WHERE id = ?", v.id);
        run('INSERT INTO ext_jobs (store_id, vehicle_id, type) VALUES (?, ?, ?)', user.storeId, v.id, v.status === 'publicado' ? 'republicar' : 'publicar');
      }
      if (a.tipo === 'lead_novo' || (a.tipo === 'visita' && !a.lead_id)) {
        const r = CRM.createLead(user.storeId, { ...a.lead_novo, vendedor_id: user.id }, { userId: user.id });
        a.lead_id = r.id;
      }
      if (a.tipo === 'lead_etapa') CRM.update(user, a.lead_id, { etapa: a.etapa, motivo_perda: a.motivo_perda });
      if (a.tipo === 'lead_nota') CRM.note(user, a.lead_id, { tipo: a.nota_tipo, texto: a.nota });
      if (a.tipo === 'visita') CRM.addVisit(user, { lead_id: a.lead_id, vehicle_id: a.vehicle_id, data_hora: a.data_hora, tipo: a.visita_tipo, obs: a.obs });
      if (a.tipo === 'visita_status') CRM.updateVisit(user, a.visita_id, { status: a.status });
      if (a.tipo === 'tarefa') CRM.addTask(user, { titulo: a.titulo, vence_em: a.vence_em, lead_id: a.lead_id });
      if (a.tipo === 'tarefa_feita') CRM.doneTask(user, a.tarefa_id, true);
      if (a.tipo === 'campanha') await require('./meta/service').setCampaignStatus(user.storeId, a.campanha_id, a.meta_status);
      feitas.push({ ...a, feito: true });
    } catch (e) { feitas.push({ ...a, feito: false, erro: e.message }); }
  }
  const ok = feitas.filter((a) => a.feito && a.tipo !== 'abrir');
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
