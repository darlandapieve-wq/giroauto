// Contratos e termos (v2.8): modelos-base + personalização por loja, preenchimento a partir do veículo/contato,
// escolha de cláusulas, texto final editável, histórico e página de impressão (A4).
const { get, all, run } = require('./db');
const config = require('./config');
const { MODELOS } = require('./contratos-modelos');

const httpError = (status, message) => Object.assign(new Error(message), { status });
const str = (x, max = 4000) => String(x ?? '').trim().slice(0, max);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BASE = Object.fromEntries(MODELOS.map((m) => [m.key, m]));
const LOJA_KEYS = ['razao_social', 'nome', 'cnpj', 'endereco', 'cidade', 'uf', 'telefone', 'representante', 'representante_cpf'];

/* ---------------- Valores por extenso (reais) ---------------- */
const UN = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CEM = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
function ate999(n) {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100); const r = n % 100;
  const partes = [];
  if (c) partes.push(CEM[c]);
  if (r) partes.push(r < 20 ? UN[r] : DEZ[Math.floor(r / 10)] + (r % 10 ? ' e ' + UN[r % 10] : ''));
  return partes.join(' e ');
}
function inteiroExtenso(n) {
  if (n === 0) return 'zero';
  const grupos = [];
  let x = n;
  while (x > 0) { grupos.push(x % 1000); x = Math.floor(x / 1000); }
  const nomes = [['', ''], ['mil', 'mil'], ['milhão', 'milhões'], ['bilhão', 'bilhões']];
  const partes = [];
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i]; if (!g) continue;
    let t = i === 1 && g === 1 ? 'mil' : ate999(g) + (i ? ' ' + nomes[i][g === 1 ? 0 : 1] : '');
    partes.push({ t, g });
  }
  // "e" antes do último grupo quando ele é < 100 ou centena redonda (ex.: mil e quinhentos, dois mil e cem).
  return partes.map((p, i) => (i > 0 && i === partes.length - 1 && (p.g < 100 || p.g % 100 === 0) ? 'e ' : '') + p.t).join(' ').replace(/\s+/g, ' ').trim();
}
function extenso(valor) {
  const v = Math.round(Math.abs(Number(valor) || 0) * 100);
  const reais = Math.floor(v / 100); const cent = v % 100;
  const partes = [];
  if (reais) {
    const t = inteiroExtenso(reais);
    const de = reais >= 1e6 && reais % 1e6 === 0 ? ' de' : '';
    partes.push(`${t}${de} ${reais === 1 ? 'real' : 'reais'}`);
  }
  if (cent) partes.push(`${inteiroExtenso(cent)} ${cent === 1 ? 'centavo' : 'centavos'}`);
  return partes.join(' e ') || 'zero real';
}

/* ---------------- Formatação dos dados ---------------- */
// Aceita "45.000", "45000", "45.000,50", "45000.5".
function parseMoney(x) {
  const s = String(x ?? '').replace(/[^\d,.-]/g, '');
  if (!s) return null;
  let n;
  if (s.includes(',')) n = Number(s.replace(/\./g, '').replace(',', '.'));
  else if (/\.\d{3}(\.|$)/.test(s)) n = Number(s.replace(/\./g, ''));
  else n = Number(s);
  return Number.isFinite(n) ? n : null;
}
const fmtMoney = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function fmtData(s, longa = false) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(s || '');
  return longa ? `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}` : `${m[3]}/${m[2]}/${m[1]}`;
}
const getPath = (o, k) => k.split('.').reduce((a, p) => (a && typeof a === 'object' ? a[p] : undefined), o);
function setPath(o, k, v) {
  const ps = k.split('.'); let a = o;
  for (const p of ps.slice(0, -1)) { if (!a[p] || typeof a[p] !== 'object') a[p] = {}; a = a[p]; }
  a[ps[ps.length - 1]] = v;
}

/* ---------------- Modelos (base + personalização da loja) ---------------- */
function overrides(storeId) {
  return Object.fromEntries(all('SELECT * FROM contract_models WHERE store_id = ?', storeId).map((r) => [r.chave, { ...r, dados: safeJson(r.dados, {}) }]));
}
function safeJson(s, d) { try { return JSON.parse(s || ''); } catch { return d; } }

// Junta o modelo-base com o que a loja alterou. Cláusulas novas do modelo-base (versões futuras) entram no fim,
// salvo se a loja as tiver removido.
function merge(base, ov, chave) {
  const d = ov?.dados || {};
  let clausulas = base.clausulas.map((c) => ({ ...c }));
  if (Array.isArray(d.clausulas)) {
    const removidas = new Set(d.removidas || []);
    const usadas = new Set(d.clausulas.map((c) => c.key));
    clausulas = [
      ...d.clausulas.map((c) => ({ key: str(c.key, 60), titulo: str(c.titulo, 160), texto: str(c.texto, 8000), padrao: !!c.padrao, propria: !!c.propria })),
      ...base.clausulas.filter((c) => !usadas.has(c.key) && !removidas.has(c.key)).map((c) => ({ ...c })),
    ];
  }
  return {
    key: chave, base: base.key, icone: d.icone || base.icone,
    nome: d.nome || base.nome, titulo: d.titulo || base.titulo, descricao: d.descricao ?? base.descricao,
    partes: base.partes, pessoas: base.pessoas || null, loja_se: base.loja_se || '', simples: !!base.simples, assinaturas: base.assinaturas || (base.pessoas ? [...base.pessoas.map((x) => x.p), 'loja'] : ['loja', 'cliente']),
    testemunhas: d.testemunhas !== undefined ? !!d.testemunhas : !base.simples,
    campos: base.campos, clausulas,
    personalizado: !!ov && chave === base.key, proprio: chave !== base.key,
  };
}

function models(storeId) {
  const ov = overrides(storeId);
  const lista = MODELOS.map((b) => merge(b, ov[b.key], b.key));
  for (const [chave, r] of Object.entries(ov)) if (chave !== r.base && BASE[r.base]) lista.push(merge(BASE[r.base], r, chave));
  return lista;
}
function model(storeId, chave) {
  const ov = get('SELECT * FROM contract_models WHERE store_id = ? AND chave = ?', storeId, String(chave));
  if (ov && BASE[ov.base]) return merge(BASE[ov.base], { ...ov, dados: safeJson(ov.dados, {}) }, ov.chave);
  if (BASE[chave]) return merge(BASE[chave], null, chave);
  throw httpError(404, 'Modelo de contrato não encontrado.');
}

function cleanClauses(list) {
  if (!Array.isArray(list)) throw httpError(400, 'Envie a lista de cláusulas.');
  const seen = new Set();
  return list.slice(0, 80).map((c, i) => {
    let key = str(c.key, 60).replace(/[^\w-]/g, '') || `propria_${i}`;
    while (seen.has(key)) key += '_';
    seen.add(key);
    const titulo = str(c.titulo, 160); const texto = str(c.texto, 8000);
    if (!titulo || !texto) throw httpError(400, 'Toda cláusula precisa de título e texto.');
    return { key, titulo, texto, padrao: !!c.padrao, propria: !!c.propria };
  });
}

function saveModel(storeId, chave, b) {
  const atual = model(storeId, chave);
  const clausulas = cleanClauses(b.clausulas || atual.clausulas);
  const baseKeys = BASE[atual.base].clausulas.map((c) => c.key);
  const dados = {
    nome: str(b.nome, 120) || atual.nome, titulo: str(b.titulo, 200) || atual.titulo, descricao: str(b.descricao ?? atual.descricao, 600),
    testemunhas: b.testemunhas !== undefined ? !!b.testemunhas : atual.testemunhas,
    clausulas, removidas: baseKeys.filter((k) => !clausulas.some((c) => c.key === k)),
  };
  run(`INSERT INTO contract_models (store_id, chave, base, dados) VALUES (?, ?, ?, ?)
       ON CONFLICT (store_id, chave) DO UPDATE SET dados = excluded.dados, updated_at = datetime('now')`, storeId, atual.key, atual.base, JSON.stringify(dados));
  return model(storeId, atual.key);
}

function duplicateModel(storeId, chave, nome) {
  const atual = model(storeId, chave);
  const nova = `p${Date.now().toString(36)}`;
  const dados = { nome: str(nome, 120) || `${atual.nome} (cópia)`, titulo: atual.titulo, descricao: atual.descricao, testemunhas: atual.testemunhas, clausulas: atual.clausulas, removidas: [] };
  dados.removidas = BASE[atual.base].clausulas.map((c) => c.key).filter((k) => !atual.clausulas.some((c) => c.key === k));
  run('INSERT INTO contract_models (store_id, chave, base, dados) VALUES (?, ?, ?, ?)', storeId, nova, atual.base, JSON.stringify(dados));
  return model(storeId, nova);
}

function resetModel(storeId, chave) {
  run('DELETE FROM contract_models WHERE store_id = ? AND chave = ?', storeId, String(chave));
}

/* ---------------- Pré-preenchimento ---------------- */
function lojaDados(storeId) {
  const s = get('SELECT name, address, city, state, phone, whatsapp, contrato_loja FROM stores WHERE id = ?', storeId) || {};
  const salvo = safeJson(s.contrato_loja, {});
  return {
    razao_social: '', cnpj: '', representante: '', representante_cpf: '',
    nome: s.name || '', endereco: s.address || '', cidade: s.city || '', uf: s.state || '', telefone: s.whatsapp || s.phone || '',
    ...Object.fromEntries(Object.entries(salvo).filter(([k, v]) => LOJA_KEYS.includes(k) && v)),
    foro: salvo.foro || s.city || '',
  };
}

function saveLoja(storeId, loja, foro) {
  const atual = safeJson(get('SELECT contrato_loja FROM stores WHERE id = ?', storeId)?.contrato_loja, {});
  for (const k of LOJA_KEYS) if (loja && loja[k] !== undefined) atual[k] = str(loja[k], 200);
  if (foro) atual.foro = str(foro, 120);
  run('UPDATE stores SET contrato_loja = ? WHERE id = ?', JSON.stringify(atual), storeId);
}

const reais = (n) => (n ? fmtMoney(Number(n)) : '');

function descreverPagamento(v) {
  const p = [];
  if (v.venda_entrada) p.push(`entrada de R$ ${reais(v.venda_entrada)}${v.venda_pagamento && !/financ|boleto|troca/i.test(v.venda_pagamento) ? ` via ${v.venda_pagamento}` : ''}`);
  if (v.venda_troca_valor) p.push(`R$ ${reais(v.venda_troca_valor)} com o veículo recebido na troca${v.venda_troca_desc ? ` (${v.venda_troca_desc})` : ''}`);
  if (v.venda_financiado) p.push(`R$ ${reais(v.venda_financiado)} financiados${v.venda_financeira ? ` junto a ${v.venda_financeira}` : ''}${v.venda_fin_parcelas ? ` em ${v.venda_fin_parcelas} parcelas de R$ ${reais(v.venda_fin_parcela)}` : ''}`);
  if (v.venda_boleto_qtd) p.push(`${v.venda_boleto_qtd} boleto(s) de R$ ${reais(v.venda_boleto_valor)}`);
  if (!p.length) return v.venda_pagamento ? `Pagamento via ${v.venda_pagamento}.` : '';
  return p.join('; ') + '.';
}

// Monta os dados iniciais do formulário a partir do veículo e/ou do contato escolhidos.
function prefill(storeId, b) {
  const chave = String(b.modelo || 'venda');
  const m = model(storeId, chave);
  const dados = { loja: lojaDados(storeId), geral: {}, cliente: {}, veiculo: {} };
  dados.geral = { cidade: dados.loja.cidade, data: new Date().toISOString().slice(0, 10), foro: dados.loja.foro };
  delete dados.loja.foro;
  for (const c of m.campos) if (c.padrao && getPath(dados, c.k) === undefined) setPath(dados, c.k, c.padrao);
  const marcar = new Set();
  const vid = Number(b.vehicle_id) || 0;
  const v = vid ? get('SELECT * FROM vehicles WHERE id = ? AND store_id = ?', vid, storeId) : null;
  if (v) {
    Object.assign(dados.veiculo, {
      marca: v.marca || '', modelo: v.modelo || '', versao: v.versao || '', ano_fab: v.ano_fab || '', ano_modelo: v.ano_modelo || '',
      cor: v.cor || '', combustivel: v.combustivel || '', placa: v.placa || '', km: v.km ? Number(v.km).toLocaleString('pt-BR') : '',
      renavam: v.renavam || '', chassi: v.chassi || '',
    });
    const vendido = v.status === 'vendido';
    const valorVenda = vendido && v.venda_valor ? v.venda_valor : (v.preco || 0);
    const base = m.base;
    if (['venda', 'venda_pf', 'venda_repasse', 'sinal', 'entrega', 'recibo', 'garantia', 'distrato', 'aditivo', 'test_drive'].includes(base)) {
      if (vendido) Object.assign(dados.cliente, { nome: v.venda_comprador || '', cpf: v.comprador_doc || '', telefone: v.comprador_tel || '' });
      setPath(dados, 'negocio.valor', reais(base === 'venda_repasse' && !vendido && v.preco_repasse ? v.preco_repasse : valorVenda));
      if (vendido) {
        const forma = descreverPagamento(v); if (forma) setPath(dados, 'negocio.forma_pagamento', forma);
        const d = String(v.vendido_em || '').slice(0, 10);
        if (d) { setPath(dados, 'negocio.data_entrega', d); setPath(dados, 'entrega.data', d); setPath(dados, 'gar.inicio', d); setPath(dados, 'dis.contrato', d); }
      }
      if (v.venda_troca_valor) {
        marcar.add('troca');
        const tv = v.venda_troca_id ? get('SELECT * FROM vehicles WHERE id = ? AND store_id = ?', v.venda_troca_id, storeId) : null;
        const desc = tv ? [tv.marca, tv.modelo, tv.versao, tv.ano_fab && tv.ano_modelo ? `${tv.ano_fab}/${tv.ano_modelo}` : '', tv.cor, tv.placa && `placa ${tv.placa}`, tv.renavam && `Renavam ${tv.renavam}`, tv.chassi && `chassi ${tv.chassi}`].filter(Boolean).join(', ') : v.venda_troca_desc || '';
        setPath(dados, 'troca.descricao', desc); setPath(dados, 'troca.valor', reais(v.venda_troca_valor));
      }
      if (v.venda_financiado) {
        marcar.add('financiamento');
        setPath(dados, 'fin.banco', v.venda_financeira || ''); setPath(dados, 'fin.valor', reais(v.venda_financiado));
        setPath(dados, 'fin.parcelas', v.venda_fin_parcelas || ''); setPath(dados, 'fin.parcela_valor', reais(v.venda_fin_parcela));
      }
      if (v.proprietario_tipo === 'consignado' && base === 'venda') { marcar.add('consignado'); setPath(dados, 'consig.proprietario', v.proprietario_nome || ''); }
      if (v.km) { setPath(dados, 'td.km_saida', dados.veiculo.km); setPath(dados, 'dis.km', ''); }
      if (base === 'recibo' && vendido && v.venda_entrada) setPath(dados, 'recibo.valor', reais(v.venda_entrada));
      if (base === 'sinal') setPath(dados, 'sinal.prazo', '');
    }
    if (base === 'venda_pf') {
      Object.assign(dados.vendedor = dados.vendedor || {}, { nome: v.proprietario_nome || '', cpf: v.proprietario_doc || '', telefone: v.proprietario_tel || '' });
      if (v.margem_tipo === 'valor' && v.margem_fixa) setPath(dados, 'pf.comissao', `R$ ${reais(v.margem_fixa)}`);
      else if (v.consig_comissao_pct) setPath(dados, 'pf.comissao', `${String(v.consig_comissao_pct).replace('.', ',')}% do valor da venda`);
      else if (v.consig_repasse && valorVenda > v.consig_repasse) setPath(dados, 'pf.comissao', `R$ ${reais(valorVenda - v.consig_repasse)}`);
    }
    if (base === 'consignacao') {
      Object.assign(dados.cliente, { nome: v.proprietario_nome || '', cpf: v.proprietario_doc || '', telefone: v.proprietario_tel || '' });
      setPath(dados, 'consig.preco_venda', reais(v.preco));
      if (v.consig_repasse) setPath(dados, 'consig.repasse', reais(v.consig_repasse));
      if (v.margem_tipo === 'valor' && v.margem_fixa) setPath(dados, 'consig.comissao', `R$ ${reais(v.margem_fixa)}`);
      else if (v.consig_comissao_pct) setPath(dados, 'consig.comissao', `${String(v.consig_comissao_pct).replace('.', ',')}% do valor da venda`);
    }
    if (base === 'compra') {
      Object.assign(dados.cliente, { nome: v.compra_de || '', telefone: v.compra_de_tel || '' });
      setPath(dados, 'negocio.valor', reais(v.compra_valor));
      if (v.compra_data) setPath(dados, 'negocio.data_entrega', String(v.compra_data).slice(0, 10));
      if (v.troca_de_id) {
        marcar.add('troca');
        const ov = get('SELECT marca, modelo, placa FROM vehicles WHERE id = ? AND store_id = ?', v.troca_de_id, storeId);
        if (ov) setPath(dados, 'troca.venda', [ov.marca, ov.modelo, ov.placa && `placa ${ov.placa}`].filter(Boolean).join(' '));
      }
    }
  }
  const cid = Number(b.contact_id) || 0;
  const c = cid ? get('SELECT * FROM contacts WHERE id = ? AND store_id = ?', cid, storeId) : null;
  if (c) {
    dados.cliente.nome = c.nome || dados.cliente.nome || '';
    dados.cliente.telefone = c.telefone || dados.cliente.telefone || '';
    if (c.email) dados.cliente.email = c.email;
    if (c.cidade) dados.cliente.cidade = c.cidade;
  }
  // Reaproveita os dados completos do cliente usados num contrato anterior (CPF, RG, endereço…).
  const tel = String(dados.cliente.telefone || '').replace(/\D/g, '');
  const doc = String(dados.cliente.cpf || '').replace(/\D/g, '');
  if (tel.length >= 10 || doc.length >= 11) {
    const ant = all('SELECT dados FROM contracts WHERE store_id = ? ORDER BY id DESC LIMIT 300', storeId)
      .map((r) => safeJson(r.dados, {}).cliente || {})
      .find((cl) => (doc.length >= 11 && String(cl.cpf || '').replace(/\D/g, '') === doc) || (tel.length >= 10 && String(cl.telefone || '').replace(/\D/g, '').endsWith(tel.slice(-10))));
    if (ant) for (const [k, val] of Object.entries(ant)) if (val && !dados.cliente[k]) dados.cliente[k] = val;
  }
  for (const c2 of m.campos) if (c2.padrao && !getPath(dados, c2.k)) setPath(dados, c2.k, c2.padrao);
  const aviso = v && ['venda', 'venda_repasse'].includes(m.base) && v.proprietario_tipo && v.proprietario_tipo !== 'proprio' && v.proprietario_nome
    ? `Este carro está em nome de ${v.proprietario_nome} (${v.proprietario_tipo}). Se o documento não estiver em nome da loja, use o modelo "Compra e venda entre particulares", com a loja como intermediadora.` : '';
  return { dados, marcar: [...marcar], aviso };
}

/* ---------------- Renderização ---------------- */
const BRANCO = '<span class="blank">____________________</span>';

function contexto(m, dados) {
  const d = JSON.parse(JSON.stringify(dados || {}));
  const tipos = Object.fromEntries(m.campos.map((c) => [c.k, c.tipo || 'text']));
  const out = {};
  const flat = (o, pre = '') => {
    for (const [k, v] of Object.entries(o || {})) {
      const key = pre ? `${pre}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key);
      else out[key] = v;
    }
  };
  flat(d);
  for (const [k, v] of Object.entries(out)) {
    const t = tipos[k];
    if (t === 'money') {
      const n = parseMoney(v);
      if (n !== null && String(v).trim()) { out[k] = fmtMoney(n); out[k + '_extenso'] = extenso(n); }
    } else if (t === 'date') out[k] = fmtData(v);
  }
  // Campos calculados usados nos textos.
  const V = (k) => String(out[`veiculo.${k}`] || '').trim();
  out.veiculo_resumo = ['veículo', [V('marca'), V('modelo'), V('versao')].filter(Boolean).join(' '), V('ano_fab') || V('ano_modelo') ? `ano ${[V('ano_fab'), V('ano_modelo')].filter(Boolean).join('/')}` : '', V('cor') && `cor ${V('cor')}`, V('placa') && `placa ${V('placa')}`, V('renavam') && `Renavam ${V('renavam')}`, V('chassi') && `chassi ${V('chassi')}`].filter(Boolean).join(', ').replace('veículo, ', 'veículo ');
  const com = String(out['consig.comissao'] || '').trim();
  out['consig.comissao_texto'] = com ? `, ajustada em ${com}` : '';
  const taxa = parseMoney(out['consig.taxa_retirada']);
  out['consig.taxa_retirada_texto'] = taxa ? `, acrescido de R$ ${fmtMoney(taxa)} a título de ressarcimento pelos custos de preparação e divulgação` : '';
  out['geral.data_extenso'] = fmtData(dados?.geral?.data, true);
  return out;
}

function preencher(texto, ctx, html = true) {
  const t = html ? esc(texto) : String(texto);
  return t.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
    const v = ctx[k];
    if (v === undefined || v === null || String(v).trim() === '') return html ? BRANCO : '____________________';
    if (/_texto$/.test(k)) return html ? esc(v) : String(v);
    return html ? `<span class="fill">${esc(v)}</span>` : String(v);
  }).replace(/\n/g, html ? '<br>' : '\n');
}

const ordinal = (n) => `${n}ª`;

// clausulas: [{ key, titulo, texto }] já na ordem final (só as marcadas).
function renderBody(m, dados, clausulas, opts = {}) {
  const ctx = contexto(m, dados);
  const P = m.partes;
  const lojaQual = `<b>{{loja.razao_social}}</b> ({{loja.nome}}), pessoa jurídica de direito privado inscrita no CNPJ sob o nº {{loja.cnpj}}, com sede em {{loja.endereco}}, {{loja.cidade}}/{{loja.uf}}, neste ato representada por {{loja.representante}}, CPF nº {{loja.representante_cpf}}, doravante denominada <b>${P.loja}</b>`;
  const pQual = (p, papel) => `<b>{{${p}.nome}}</b>, {{${p}.nacionalidade}}, {{${p}.estado_civil}}, {{${p}.profissao}}, inscrito(a) no CPF/CNPJ sob o nº {{${p}.cpf}}, RG nº {{${p}.rg}}, residente e domiciliado(a) em {{${p}.endereco}}, {{${p}.cidade}}/{{${p}.uf}}, CEP {{${p}.cep}}, telefone {{${p}.telefone}}, e-mail {{${p}.email}}, doravante denominado(a) <b>${papel}</b>`;
  // A qualificação tem negrito próprio: escapa o texto e depois devolve as tags <b>.
  const qual = (t) => preencher(t, ctx).replace(/&lt;(\/?)b&gt;/g, '<$1b>');
  // Partes: loja x cliente (padrão) ou pessoas físicas, com a loja como interveniente quando a cláusula dela estiver marcada.
  const comLoja = !m.pessoas || !m.loja_se || clausulas.some((c) => c.key === m.loja_se);
  const pessoas = m.pessoas || [{ p: 'cliente', papel: P.cliente }];
  const titulo = esc(opts.titulo || m.titulo);
  let h = `<h1>${titulo}</h1>`;
  if (!m.simples) {
    if (m.pessoas) {
      const [a, b] = pessoas;
      h += `<p class="partes">Pelo presente instrumento particular, de um lado, ${qual(pQual(a.p, a.papel))}; e, de outro lado, ${qual(pQual(b.p, b.papel))}${comLoja ? `; e, ainda, como interveniente, ${qual(lojaQual)}` : ''}; têm entre si, justo e acordado, o presente instrumento, que se regerá pelas cláusulas e condições seguintes:</p>`;
    } else {
      h += `<p class="partes">Pelo presente instrumento particular, de um lado, ${qual(lojaQual)}; e, de outro lado, ${qual(pQual('cliente', P.cliente))}; têm entre si, justo e acordado, o presente instrumento, que se regerá pelas cláusulas e condições seguintes:</p>`;
    }
    clausulas.forEach((c, i) => {
      h += `<div class="kcl"><h2>CLÁUSULA ${ordinal(i + 1)} – ${esc(String(c.titulo).toUpperCase())}</h2><p>${preencher(c.texto, ctx)}</p></div>`;
    });
    const vias = m.pessoas && comLoja ? 3 : 2;
    h += `<p class="fecho">E, por estarem assim justas e contratadas, as partes assinam o presente instrumento em ${vias} (${vias === 3 ? 'três' : 'duas'}) vias de igual teor e forma, na presença das testemunhas abaixo.</p>`;
  } else {
    clausulas.forEach((c) => { h += `<p>${preencher(c.texto, ctx)}</p>`; });
  }
  h += `<p class="local">${preencher('{{geral.cidade}}', ctx)}, ${ctx['geral.data_extenso'] ? esc(ctx['geral.data_extenso']) : BRANCO}.</p>`;
  const ass = [];
  const assLoja = `<div class="ass"><div class="linha"></div><b>${preencher('{{loja.razao_social}}', ctx).replace(/<span class="blank">.*?<\/span>/, preencher('{{loja.nome}}', ctx))}</b><span>${P.loja} · CNPJ ${preencher('{{loja.cnpj}}', ctx)}</span><span>Representante: ${preencher('{{loja.representante}}', ctx)}</span></div>`;
  const assPessoa = (p, papel) => `<div class="ass"><div class="linha"></div><b>${preencher(`{{${p}.nome}}`, ctx)}</b><span>${papel} · CPF/CNPJ ${preencher(`{{${p}.cpf}}`, ctx)}</span></div>`;
  for (const a of m.assinaturas) {
    if (a === 'loja') { if (comLoja) ass.push(assLoja); continue; }
    const pp = pessoas.find((x) => x.p === a);
    if (pp) ass.push(assPessoa(pp.p, pp.papel));
  }
  h += `<div class="assinaturas">${ass.join('')}</div>`;
  if (m.testemunhas && opts.testemunhas !== false) {
    h += `<div class="assinaturas test">${[1, 2].map((n) => `<div class="ass"><div class="linha"></div><b>Testemunha ${n}</b><span>Nome:</span><span>CPF:</span></div>`).join('')}</div>`;
  }
  return h;
}

const PRINT_CSS = `
  @page { size: A4; margin: 18mm 18mm 20mm; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #111; font-size: 11.5pt; line-height: 1.5; margin: 0; background: #e9ecef; }
  .folha { background: #fff; max-width: 210mm; margin: 16px auto; padding: 18mm 18mm 20mm; box-shadow: 0 2px 12px rgba(0,0,0,.12); }
  .topo { display: flex; align-items: center; gap: 12px; border-bottom: 1px solid #bbb; padding-bottom: 8px; margin-bottom: 14px; font-family: Arial, sans-serif; font-size: 9pt; color: #555; }
  .topo img { max-height: 42px; max-width: 140px; object-fit: contain; }
  .topo b { color: #111; font-size: 10.5pt; }
  h1 { font-size: 13pt; text-align: center; margin: 6px 0 16px; letter-spacing: .02em; }
  h2 { font-size: 10.5pt; margin: 14px 0 4px; }
  p { margin: 0 0 8px; text-align: justify; }
  .kcl { break-inside: avoid-page; }
  .fill { font-weight: 600; }
  .blank { color: #777; letter-spacing: -1px; }
  .local { margin-top: 18px; text-align: right; }
  .assinaturas { display: grid; grid-template-columns: 1fr 1fr; gap: 30px 40px; margin-top: 44px; break-inside: avoid; }
  .assinaturas.test { margin-top: 34px; }
  .ass { display: flex; flex-direction: column; font-size: 9.5pt; font-family: Arial, sans-serif; }
  .ass .linha { border-top: 1px solid #111; margin-bottom: 4px; }
  .ass span { color: #444; }
  .rodape { margin-top: 26px; font-size: 7.5pt; color: #888; font-family: Arial, sans-serif; text-align: center; }
  .bar { position: sticky; top: 0; background: #1f2937; color: #fff; padding: 10px 16px; display: flex; gap: 10px; align-items: center; font-family: Arial, sans-serif; font-size: 14px; z-index: 2; }
  .bar button { background: #22c55e; color: #fff; border: 0; border-radius: 6px; padding: 8px 14px; font-weight: 700; cursor: pointer; }
  .bar span { opacity: .8; }
  @media print { body { background: #fff; } .bar { display: none; } .folha { box-shadow: none; margin: 0; padding: 0; max-width: none; } .blank { color: #111; } }
`;

function cabecalho(storeId) {
  const s = get('SELECT name, logo_file, city, state, whatsapp, phone FROM stores WHERE id = ?', storeId) || {};
  const logo = s.logo_file ? `<img src="${esc(config.publicUrl)}/media/${esc(s.logo_file)}" alt="">` : '';
  return `<div class="topo">${logo}<div><b>${esc(s.name || '')}</b><br>${esc([s.city, s.state].filter(Boolean).join('/'))}${s.whatsapp || s.phone ? ' · ' + esc(s.whatsapp || s.phone) : ''}</div></div>`;
}

function printPage(storeId, c) {
  const body = c.html;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.titulo)}</title><style>${PRINT_CSS}</style></head>
<body><div class="bar"><button onclick="window.print()">Imprimir / salvar PDF</button><span>${esc(c.titulo)} · confira os dados antes de assinar</span></div>
<div class="folha">${cabecalho(storeId)}${body}<div class="rodape">Documento gerado pelo GiroAuto em ${esc(fmtData(String(c.created_at || '').slice(0, 10)))} · nº ${c.id}</div></div></body></html>`;
}

/* ---------------- Contratos emitidos ---------------- */
function selecionadas(m, b) {
  // b.clausulas: [{ key, titulo, texto }] na ordem; aceita também só as chaves (usa o texto do modelo).
  const lista = Array.isArray(b.clausulas) ? b.clausulas : m.clausulas.filter((c) => c.padrao);
  return lista.map((c) => {
    const k = typeof c === 'string' ? c : c.key;
    const ref = m.clausulas.find((x) => x.key === k);
    const titulo = typeof c === 'object' && c.titulo ? str(c.titulo, 160) : ref?.titulo;
    const texto = typeof c === 'object' && c.texto ? str(c.texto, 8000) : ref?.texto;
    return titulo && texto ? { key: str(k, 60), titulo, texto } : null;
  }).filter(Boolean);
}

function cleanDados(d) {
  const out = {};
  for (const [g, o] of Object.entries(d && typeof d === 'object' ? d : {})) {
    if (!/^[a-z_]{1,20}$/.test(g) || !o || typeof o !== 'object') continue;
    out[g] = {};
    for (const [k, v] of Object.entries(o)) if (/^[a-z_0-9]{1,40}$/.test(k)) out[g][k] = str(v, 4000);
  }
  return out;
}

function preview(storeId, b) {
  const m = model(storeId, b.modelo);
  return { html: renderBody(m, cleanDados(b.dados), selecionadas(m, b), { titulo: str(b.titulo, 200) }) };
}

function save(storeId, id, b, userId) {
  const m = model(storeId, b.modelo);
  const dados = cleanDados(b.dados);
  const cl = selecionadas(m, b);
  if (!cl.length) throw httpError(400, 'Marque ao menos uma cláusula.');
  const titulo = str(b.titulo, 200) || m.titulo;
  const html = renderBody(m, dados, cl, { titulo });
  const vid = Number(b.vehicle_id) || null;
  if (vid && !get('SELECT 1 FROM vehicles WHERE id = ? AND store_id = ?', vid, storeId)) throw httpError(400, 'Veículo não encontrado.');
  const cid = Number(b.contact_id) || null;
  const cliente = str(dados.cliente?.nome, 160);
  const resumo = [dados.veiculo?.marca, dados.veiculo?.modelo, dados.veiculo?.placa].filter(Boolean).join(' ');
  if (b.salvar_loja !== false) saveLoja(storeId, dados.loja, dados.geral?.foro);
  if (id) {
    const c = find(storeId, id);
    run(`UPDATE contracts SET modelo = ?, modelo_nome = ?, titulo = ?, vehicle_id = ?, contact_id = ?, cliente_nome = ?, veiculo_resumo = ?, dados = ?, clausulas = ?, html = ?, updated_at = datetime('now') WHERE id = ?`,
      m.key, m.nome, titulo, vid, cid, cliente, resumo, JSON.stringify(dados), JSON.stringify(cl), html, c.id);
    return c.id;
  }
  return Number(run(`INSERT INTO contracts (store_id, modelo, modelo_nome, titulo, vehicle_id, contact_id, cliente_nome, veiculo_resumo, dados, clausulas, html, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    storeId, m.key, m.nome, titulo, vid, cid, cliente, resumo, JSON.stringify(dados), JSON.stringify(cl), html, userId || null).lastInsertRowid);
}

function find(storeId, id) {
  const c = get('SELECT * FROM contracts WHERE id = ? AND store_id = ?', Number(id), storeId);
  if (!c) throw httpError(404, 'Contrato não encontrado.');
  return c;
}

function serialize(c) {
  return { ...c, dados: safeJson(c.dados, {}), clausulas: safeJson(c.clausulas, []), print_url: `/contratos/${c.id}/imprimir` };
}

function list(storeId, q = {}) {
  const vid = Number(q.vehicle_id) || 0;
  return all(`SELECT c.id, c.modelo, c.modelo_nome, c.titulo, c.vehicle_id, c.contact_id, c.cliente_nome, c.veiculo_resumo, c.created_at, c.updated_at, u.name AS user_name
              FROM contracts c LEFT JOIN users u ON u.id = c.created_by WHERE c.store_id = ? ${vid ? 'AND c.vehicle_id = ?' : ''} ORDER BY c.id DESC LIMIT 300`, ...(vid ? [storeId, vid] : [storeId]))
    .map((c) => ({ ...c, print_url: `/contratos/${c.id}/imprimir` }));
}

function remove(storeId, id) { const c = find(storeId, id); run('DELETE FROM contracts WHERE id = ?', c.id); }

module.exports = { saveLoja, MODELOS, models, model, saveModel, duplicateModel, resetModel, prefill, preview, save, find, serialize, list, remove, printPage, lojaDados, extenso, parseMoney, renderBody };
