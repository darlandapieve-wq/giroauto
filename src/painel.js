// Painel do administrador (v2.4): extrato da loja em uma tela, com o que pede ação agora.
const config = require('./config');
const { get, all } = require('./db');
const V = require('./vehicles');
const G = require('./gestao');
const schedule = require('./schedule');

const date = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(String(x || '')) ? String(x) : null);

function periodo(q) {
  const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const d = new Date();
  const iso = (x) => x.toISOString().slice(0, 10);
  const p = q.periodo || 'mes';
  if (p === 'hoje') return { p, from: hoje, to: hoje };
  if (p === '7') return { p, from: iso(new Date(Date.now() - 6 * 864e5)), to: hoje };
  if (p === '30') return { p, from: iso(new Date(Date.now() - 29 * 864e5)), to: hoje };
  if (p === 'anterior') return { p, from: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))), to: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0))) };
  if (p === 'ano') return { p, from: iso(new Date(Date.UTC(d.getUTCFullYear(), 0, 1))), to: hoje };
  if (p === 'custom' && date(q.from) && date(q.to)) return { p, from: q.from, to: q.to };
  return { p: 'mes', from: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))), to: hoje };
}

function painel(storeId, q = {}, fin = true) {
  const store = get('SELECT * FROM stores WHERE id = ?', storeId);
  const per = periodo(q);
  const R = G.results(storeId, { from: per.from, to: per.to, tipo: q.tipo || '' });
  const vs = all('SELECT * FROM vehicles WHERE store_id = ?', storeId).map(V.serialize);
  const estoque = vs.filter((v) => v.status !== 'vendido');
  const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const mini = (v) => ({ id: v.id, titulo: `${v.marca} ${v.modelo}`, placa: v.placa, dias: v.dias_estoque, preco: v.preco_anuncio, fipe: v.fipe, status: v.status, oferta: v.oferta_ativa, foto: v.photos?.[0]?.url || '' });

  // Onde estão os carros.
  const locais = Object.entries(G.LOCAL).map(([k, l]) => ({ key: k, label: l, qtd: estoque.filter((v) => (v.local_status || 'patio') === k).length })).filter((x) => x.qtd || x.key === 'patio');
  const fora = estoque.filter((v) => v.local_status && v.local_status !== 'patio').map((v) => ({
    ...mini(v), local: v.local_label, parceiro: v.local_parceiro?.nome || '', local_dias: v.local_dias, previsao: v.local_previsao,
    atrasado: !!(v.local_previsao && v.local_previsao < hoje), followup_url: v.followup_url,
  })).sort((a, b) => b.local_dias - a.local_dias);

  // Estoque por situação no anúncio.
  const status = { rascunho: 0, pronto: 0, publicado: 0 };
  estoque.forEach((v) => { status[v.status] = (status[v.status] || 0) + 1; });
  const parados = estoque.filter((v) => v.parado).sort((a, b) => b.dias_estoque - a.dias_estoque).map((v) => ({ ...mini(v), fipe_diff_pct: v.fipe_diff_pct, sugestao: require('./routes3').sugerirOferta(v) }));

  // Republicação e publicação.
  const sc = schedule.parse(store);
  const fila = get(`SELECT COUNT(*) n FROM ext_jobs WHERE store_id = ? AND status IN ('pendente','em_andamento')`, storeId).n;
  const falhas = get(`SELECT COUNT(*) n FROM ext_jobs WHERE store_id = ? AND status = 'falhou' AND updated_at > datetime('now','-3 days')`, storeId).n;
  const prontosRep = estoque.filter((v) => v.pode_republicar).length;

  // Campanhas pagas.
  const camps = all(`SELECT id, name, status, daily_budget_cents, days, created_at FROM campaigns WHERE store_id = ? ORDER BY id DESC LIMIT 30`, storeId);
  const ativas = camps.filter((c) => ['ativa', 'analise'].includes(c.status));

  // Documentos, contas, contatos.
  const docs = G.docList(storeId).filter((d) => !d.done);
  const contas = fin ? G.contasAbertas(storeId, 15) : [];
  const desp = fin ? G.expenses(storeId, per.from, per.to) : [];
  const posVenda = vs.filter((v) => v.status === 'vendido' && v.vendido_em && [7, 30, 90].some((n) => Math.abs(G.daysBetween(v.vendido_em) - n) <= 1) && v.comprador_tel)
    .map((v) => ({ id: v.id, titulo: `${v.marca} ${v.modelo}`, comprador: v.venda_comprador, dias: G.daysBetween(v.vendido_em), wa: `https://wa.me/${G.waNumber(v.comprador_tel)}?text=${encodeURIComponent(`Olá${v.venda_comprador ? ' ' + v.venda_comprador.split(' ')[0] : ''}, aqui é da ${store.name}! Tudo certo com o ${v.marca} ${v.modelo}? Qualquer coisa que precisar, conte com a gente.`)}` }));

  // Pendências de cadastro.
  const semFoto = estoque.filter((v) => !v.photos?.length).length;
  const semCompra = fin ? estoque.filter((v) => v.financeiro?.falta_base).length : 0;

  // Onde atuar (prioridade).
  const alertas = [];
  const add = (nivel, texto, acao, alvo) => alertas.push({ nivel, texto, acao, alvo });
  if (contas.some((c) => c.vencida)) add('alto', `${contas.filter((c) => c.vencida).length} conta(s) vencida(s): R$ ${contas.filter((c) => c.vencida).reduce((s, c) => s + c.valor, 0).toLocaleString('pt-BR')}`, 'Ver contas', 'contas');
  if (docs.some((d) => d.dias > 30)) add('alto', `${docs.filter((d) => d.dias > 30).length} documento(s) de venda com mais de 30 dias sem concluir`, 'Documentação', 'docs');
  if (fora.some((f) => f.atrasado)) add('alto', `${fora.filter((f) => f.atrasado).length} carro(s) com retorno atrasado da oficina/parceiro`, 'Cobrar andamento', 'fora');
  if (parados.length) add('medio', `${parados.length} carro(s) parado(s) há ${store.parado_dias || 25}+ dias`, 'Sugerir oferta', 'parados');
  if (prontosRep) add('medio', `${prontosRep} anúncio(s) prontos para republicar`, 'Republicação', 'republicacao');
  if (status.pronto) add('medio', `${status.pronto} carro(s) prontos e ainda não publicados`, 'Estoque', 'estoque');
  if (falhas) add('medio', `${falhas} publicação(ões) com erro nos últimos 3 dias`, 'Republicação', 'republicacao');
  if (contas.some((c) => !c.vencida)) add('baixo', `${contas.filter((c) => !c.vencida).length} conta(s) vencendo em até 15 dias`, 'Ver contas', 'contas');
  if (semFoto) add('baixo', `${semFoto} carro(s) sem foto`, 'Completar', 'estoque');
  if (semCompra) add('baixo', `${semCompra} carro(s) sem valor de compra (lucro não calculado)`, 'Gestão', 'gestao');
  if (posVenda.length) add('baixo', `${posVenda.length} pós-venda para fazer hoje (7, 30 ou 90 dias)`, 'Enviar', 'posvenda');

  const k = R.kpis;
  return {
    agora: new Date().toISOString(), periodo: per, loja: { nome: store.name, slug: store.slug, parado_dias: store.parado_dias || 25 },
    alertas,
    vendas: {
      qtd: k.vendidos, faturamento: fin ? k.faturamento : null, lucro: fin ? k.lucro_liquido : null, resultado: fin ? k.resultado : null, margem: fin ? k.margem_media_pct : null,
      ticket: fin ? k.ticket_medio : null, dias: k.dias_medios_venda, desconto: fin ? k.desconto_medio_pct : null,
      lista: R.vendidos.slice(0, 6).map((l) => ({ id: l.id, titulo: l.titulo, data: l.vendido_em, valor: fin ? l.venda : null, lucro: fin ? l.liquido : null, vendedor: l.vendedor })),
      meses: R.meses.slice(-6).map((m) => ({ mes: m.mes, qtd: m.vendidos, lucro: fin ? m.lucro : null })),
      vendedores: R.vendedores.slice(0, 5).map((g) => ({ nome: g.label, qtd: g.qtd, lucro: fin ? g.lucro : null })),
    },
    estoque: {
      qtd: estoque.length, valor: fin ? k.estoque_valor_venda : null, investido: fin ? k.capital_investido : null, lucro_previsto: fin ? k.lucro_previsto_estoque : null,
      idade: k.idade_media_estoque, status, locais, fora: fora.slice(0, 8), parados: parados.slice(0, 8), parados_qtd: parados.length,
      faixas: R.faixas_estoque.map((f) => ({ label: f.label, qtd: f.qtd })), sem_foto: semFoto, sem_compra: semCompra,
    },
    publicacao: { publicados: status.publicado, prontos_republicar: prontosRep, fila, falhas, agenda: sc.ativo ? `${sc.horarios.join(', ')} · ${sc.por_vez}/vez` : '', pub_mode: store.pub_mode },
    campanhas: { ativas: ativas.length, verba_dia: ativas.reduce((s, c) => s + (c.daily_budget_cents || 0), 0) / 100, lista: ativas.slice(0, 4).map((c) => ({ id: c.id, nome: c.name, status: c.status })) },
    docs: { pendentes: docs.length, atrasados: docs.filter((d) => d.dias > 30).length, lista: docs.slice(0, 6).map((d) => ({ id: d.id, titulo: d.titulo, status: d.status_label, dias: d.dias, wa: d.wa_url })) },
    financeiro: fin ? {
      despesas: desp.filter((e) => e.categoria !== 'comissao').reduce((s, e) => s + e.valor, 0),
      comissoes: desp.filter((e) => e.categoria === 'comissao').reduce((s, e) => s + e.valor, 0),
      contas: contas.map((c) => ({ id: c.id, descricao: c.descricao || c.categoria_label, valor: c.valor, data: c.data, vencida: c.vencida })),
      contas_total: contas.reduce((s, c) => s + c.valor, 0),
    } : null,
    posvenda: posVenda,
    contatos: get('SELECT COUNT(*) n FROM contacts WHERE store_id = ?', storeId).n,
  };
}

module.exports = { painel, periodo };
