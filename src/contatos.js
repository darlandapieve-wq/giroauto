// Contatos da loja (v2.4): consolida parceiros/fornecedores, consignatários, proprietários e compradores,
// com histórico por contato e envio de mensagens em massa pelo WhatsApp (assistido ou pela API oficial).
const config = require('./config');
const { get, all, run, tx, logEvent } = require('./db');
const { encrypt, decrypt } = require('./crypto');
const V = require('./vehicles');

const PAPEIS = {
  cliente: 'Cliente', comprador: 'Comprador', consignatario: 'Consignatário', proprietario: 'Proprietário',
  parceiro: 'Parceiro', fornecedor: 'Fornecedor', vendeu: 'Vendeu carro à loja', lead: 'Interessado', outro: 'Outro',
};
const NOTA_TIPOS = { nota: 'Anotação', ligacao: 'Ligação', mensagem: 'Mensagem', visita: 'Visita', campanha: 'Campanha', proposta: 'Proposta' };

const str = (x, max = 200) => String(x ?? '').trim().slice(0, max);
const httpError = (status, message) => Object.assign(new Error(message), { status });
// Telefone só com dígitos, sem o 55: "(44) 99999-1111" -> "44999991111".
const fone = (x) => { const d = String(x || '').replace(/\D/g, ''); return d.length >= 12 && d.startsWith('55') ? d.slice(2) : d; };
const valido = (d) => d.length >= 10 && d.length <= 11;
const papeisDe = (c) => { try { return JSON.parse(c.papeis || '[]'); } catch { return []; } };

function upsert(storeId, { nome, telefone, papel, origem, sync: daSync }) {
  const tel = fone(telefone);
  if (!valido(tel)) return null;
  const c = get('SELECT * FROM contacts WHERE store_id = ? AND telefone = ?', storeId, tel);
  // Excluído pela loja: a sincronização (parceiros, donos, compradores) não traz de volta;
  // um contato novo de verdade (lead, assistente) volta a aparecer.
  if (c?.excluido) {
    if (daSync) return null;
    run(`UPDATE contacts SET excluido = 0, nome = ?, papeis = ?, origem = ?, email = '', obs = '', cidade = '', opt_out = 0, updated_at = datetime('now') WHERE id = ?`, str(nome, 120), JSON.stringify(papel ? [papel] : []), origem || '', c.id);
    return c.id;
  }
  if (c) {
    const p = papeisDe(c);
    const novoNome = !c.nome && nome ? str(nome, 120) : c.nome;
    if ((papel && !p.includes(papel)) || novoNome !== c.nome) {
      if (papel && !p.includes(papel)) p.push(papel);
      run(`UPDATE contacts SET papeis = ?, nome = ?, updated_at = datetime('now') WHERE id = ?`, JSON.stringify(p), novoNome, c.id);
    }
    return c.id;
  }
  return run('INSERT INTO contacts (store_id, nome, telefone, papeis, origem) VALUES (?, ?, ?, ?, ?)', storeId, str(nome, 120), tel, JSON.stringify(papel ? [papel] : []), origem || '').lastInsertRowid;
}

// Traz para os contatos quem já está no sistema: parceiros, donos de carros e compradores.
function sync(storeId) {
  tx(() => {
    for (const p of all('SELECT nome, contato, whatsapp, tipo FROM partners WHERE store_id = ? AND whatsapp != \'\'', storeId)) {
      upsert(storeId, { nome: p.contato ? `${p.contato} (${p.nome})` : p.nome, telefone: p.whatsapp, papel: p.tipo === 'loja_parceira' ? 'parceiro' : 'fornecedor', origem: 'parceiros', sync: true });
    }
    for (const v of all(`SELECT compra_de, compra_de_tel FROM vehicles WHERE store_id = ? AND compra_de_tel != ''`, storeId)) {
      upsert(storeId, { nome: v.compra_de, telefone: v.compra_de_tel, papel: 'vendeu', origem: 'compras', sync: true });
    }
    for (const v of all(`SELECT proprietario_tipo, proprietario_nome, proprietario_tel, comprador_tel, venda_comprador FROM vehicles WHERE store_id = ? AND (proprietario_tel != '' OR comprador_tel != '')`, storeId)) {
      if (v.proprietario_tel && v.proprietario_tipo !== 'proprio') {
        upsert(storeId, { nome: v.proprietario_nome, telefone: v.proprietario_tel, papel: v.proprietario_tipo === 'consignado' ? 'consignatario' : v.proprietario_tipo === 'parceria' ? 'parceiro' : 'proprietario', origem: 'veículos', sync: true });
      }
      if (v.comprador_tel) upsert(storeId, { nome: v.venda_comprador, telefone: v.comprador_tel, papel: 'comprador', origem: 'vendas', sync: true });
    }
  });
}

// Veículos ligados ao contato (como dono ou comprador) e serviços (como parceiro).
function vinculos(storeId, c) {
  const tel = c.telefone;
  const vs = all(`SELECT * FROM vehicles WHERE store_id = ? AND (proprietario_tel != '' OR comprador_tel != '')`, storeId);
  const comoDono = vs.filter((v) => fone(v.proprietario_tel) === tel && v.proprietario_tipo !== 'proprio');
  const comoComprador = vs.filter((v) => fone(v.comprador_tel) === tel);
  const parceiros = all(`SELECT * FROM partners WHERE store_id = ? AND whatsapp != ''`, storeId).filter((p) => fone(p.whatsapp) === tel);
  return { comoDono, comoComprador, parceiros };
}

function historico(storeId, c) {
  const { comoDono, comoComprador, parceiros } = vinculos(storeId, c);
  const ev = [];
  const tipoDono = { consignado: 'consignação', parceria: 'parceria', outro: 'venda pela loja', repasse: 'repasse' };
  for (const v of comoDono) {
    ev.push({ data: v.created_at, tipo: 'veiculo', icone: '🚗', texto: `Deixou o ${V.title(v)}${v.placa ? ` (${v.placa})` : ''} em ${tipoDono[v.proprietario_tipo] || 'venda'}`, vehicle_id: v.id });
    if (v.status === 'vendido') ev.push({ data: v.vendido_em, tipo: 'venda', icone: '🤝', texto: `${V.title(v)} dele(a) foi vendido`, vehicle_id: v.id });
  }
  for (const v of comoComprador) {
    ev.push({ data: v.vendido_em, tipo: 'compra', icone: '🔑', texto: `Comprou o ${V.title(v)}${v.venda_valor ? ` por R$ ${v.venda_valor.toLocaleString('pt-BR')}` : ''}${v.venda_pagamento ? ` (${v.venda_pagamento})` : ''}`, vehicle_id: v.id });
  }
  for (const p of parceiros) {
    for (const m of all(`SELECT m.*, v.marca, v.modelo, v.placa FROM vehicle_moves m JOIN vehicles v ON v.id = m.vehicle_id WHERE m.parceiro_id = ? ORDER BY m.id DESC LIMIT 30`, p.id)) {
      ev.push({ data: m.created_at, tipo: 'servico', icone: '🔧', texto: `Recebeu o ${m.marca} ${m.modelo}${m.placa ? ` (${m.placa})` : ''}${m.obs ? `: ${m.obs}` : ''}`, vehicle_id: m.vehicle_id });
    }
    for (const k of all(`SELECT k.*, v.marca, v.modelo FROM vehicle_costs k JOIN vehicles v ON v.id = k.vehicle_id WHERE k.parceiro_id = ? ORDER BY k.id DESC LIMIT 30`, p.id)) {
      ev.push({ data: k.data || k.created_at, tipo: 'custo', icone: '🧾', texto: `Serviço no ${k.marca} ${k.modelo}: ${k.descricao || ''} · R$ ${k.valor.toLocaleString('pt-BR')}${k.status === 'previsto' ? ' (previsto)' : ''}`, vehicle_id: k.vehicle_id });
    }
  }
  for (const l of all(`SELECT l.*, v.marca, v.modelo FROM leads l LEFT JOIN vehicles v ON v.id = l.vehicle_id WHERE l.store_id = ? AND (l.contact_id = ? OR l.telefone = ?)`, storeId, c.id, c.telefone)) {
    ev.push({ data: l.created_at, tipo: 'lead', icone: '🎯', texto: `Lead pelo ${require('./crm').ORIGENS[l.origem] || l.origem}${l.marca ? ` — ${l.marca} ${l.modelo}` : ''} (${(require('./crm').ETAPAS.find((e) => e[0] === l.etapa) || [])[1] || l.etapa})`, lead_id: l.id });
  }
  for (const n of all(`SELECT n.*, u.name AS user_name FROM contact_notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.contact_id = ? ORDER BY n.id DESC LIMIT 200`, c.id)) {
    ev.push({ data: n.created_at, tipo: n.tipo, icone: { ligacao: '📞', mensagem: '💬', campanha: '📣', visita: '🏪', proposta: '💰' }[n.tipo] || '📝', texto: `${NOTA_TIPOS[n.tipo] || 'Anotação'}: ${n.texto}`, user: n.user_name || '', id: n.id });
  }
  return ev.filter((e) => e.data).sort((a, b) => String(b.data).localeCompare(String(a.data)) || (b.id ? 1 : 0) - (a.id ? 1 : 0));
}

function serialize(storeId, c, vin) {
  const p = papeisDe(c);
  const v = vin || vinculos(storeId, c);
  const ultCompra = v.comoComprador.map((x) => x.vendido_em).filter(Boolean).sort().pop() || null;
  const ultNota = get('SELECT MAX(created_at) m FROM contact_notes WHERE contact_id = ?', c.id).m;
  const datas = [ultCompra, ultNota, ...v.comoDono.map((x) => x.vendido_em || x.created_at)].filter(Boolean).sort();
  return {
    ...c, papeis: p, papeis_label: p.map((x) => PAPEIS[x] || x), opt_out: !!c.opt_out,
    wa: `55${c.telefone}`, compras: v.comoComprador.length, carros_dono: v.comoDono.length, ultima_compra: ultCompra, ultimo_contato: datas.pop() || null,
    veiculos: [...v.comoDono, ...v.comoComprador].map((x) => ({ id: x.id, titulo: V.title(x), status: x.status })).slice(0, 6),
  };
}

function list(storeId) {
  sync(storeId);
  const vs = all(`SELECT * FROM vehicles WHERE store_id = ? AND (proprietario_tel != '' OR comprador_tel != '')`, storeId);
  const ps = all(`SELECT * FROM partners WHERE store_id = ? AND whatsapp != ''`, storeId);
  return all('SELECT * FROM contacts WHERE store_id = ? AND excluido = 0 ORDER BY nome COLLATE NOCASE', storeId).map((c) => serialize(storeId, c, {
    comoDono: vs.filter((v) => fone(v.proprietario_tel) === c.telefone && v.proprietario_tipo !== 'proprio'),
    comoComprador: vs.filter((v) => fone(v.comprador_tel) === c.telefone),
    parceiros: ps.filter((p) => fone(p.whatsapp) === c.telefone),
  }));
}

function find(storeId, id) {
  const c = get('SELECT * FROM contacts WHERE id = ? AND store_id = ? AND excluido = 0', Number(id), storeId);
  if (!c) throw httpError(404, 'Contato não encontrado.');
  return c;
}

function save(storeId, id, b) {
  const tel = fone(b.telefone);
  if (!valido(tel)) throw httpError(400, 'Informe o WhatsApp com DDD (ex.: 44 99999-1111).');
  const papeis = [...new Set((Array.isArray(b.papeis) ? b.papeis : []).filter((p) => PAPEIS[p]))];
  const d = { nome: str(b.nome, 120), telefone: tel, email: str(b.email, 120), papeis: JSON.stringify(papeis), obs: str(b.obs, 1000), cidade: str(b.cidade, 80), opt_out: b.opt_out ? 1 : 0 };
  const dup = get('SELECT id, excluido FROM contacts WHERE store_id = ? AND telefone = ? AND id != ?', storeId, tel, Number(id) || 0);
  if (dup && !dup.excluido) throw httpError(409, 'Já existe um contato com este WhatsApp.');
  // Cadastrar de novo um telefone que tinha sido excluído: reaproveita o registro.
  if (dup) {
    if (id) run('DELETE FROM contacts WHERE id = ?', dup.id);
    else {
      run(`UPDATE contacts SET excluido=0, nome=?, email=?, papeis=?, obs=?, cidade=?, opt_out=?, origem='manual', updated_at=datetime('now') WHERE id=?`, d.nome, d.email, d.papeis, d.obs, d.cidade, d.opt_out, dup.id);
      return dup.id;
    }
  }
  if (id) {
    const c = find(storeId, id);
    run(`UPDATE contacts SET nome=?, telefone=?, email=?, papeis=?, obs=?, cidade=?, opt_out=?, updated_at=datetime('now') WHERE id=?`, d.nome, d.telefone, d.email, d.papeis, d.obs, d.cidade, d.opt_out, c.id);
    return c.id;
  }
  return run('INSERT INTO contacts (store_id, nome, telefone, email, papeis, obs, cidade, opt_out, origem) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', storeId, d.nome, d.telefone, d.email, d.papeis, d.obs, d.cidade, d.opt_out, 'manual').lastInsertRowid;
}

// Exclui contatos: some da lista, das buscas e dos envios; anotações e mensagens pendentes são apagadas.
// O telefone fica marcado para a sincronização automática não recriar o contato.
function remove(storeId, ids) {
  const lista = [...new Set((Array.isArray(ids) ? ids : [ids]).map(Number).filter(Boolean))];
  if (!lista.length) throw httpError(400, 'Escolha ao menos um contato.');
  let n = 0;
  tx(() => {
    for (const id of lista) {
      const c = get('SELECT * FROM contacts WHERE id = ? AND store_id = ? AND excluido = 0', id, storeId);
      if (!c) continue;
      run('DELETE FROM contact_notes WHERE contact_id = ?', c.id);
      run("DELETE FROM wa_sends WHERE contact_id = ? AND status = 'pendente'", c.id);
      run('UPDATE leads SET contact_id = NULL WHERE store_id = ? AND contact_id = ?', storeId, c.id);
      run(`UPDATE contacts SET excluido = 1, nome = '', email = '', obs = '', cidade = '', papeis = '[]', updated_at = datetime('now') WHERE id = ?`, c.id);
      n++;
    }
  });
  if (!n) throw httpError(404, 'Contato não encontrado.');
  logEvent(storeId, n === 1 ? 'Contato excluído' : `${n} contatos excluídos`);
  return n;
}

function addNote(storeId, id, b, userId) {
  const c = find(storeId, id);
  const texto = str(b.texto, 1000);
  if (!texto) throw httpError(400, 'Escreva a anotação.');
  run('INSERT INTO contact_notes (contact_id, tipo, texto, user_id) VALUES (?, ?, ?, ?)', c.id, NOTA_TIPOS[b.tipo] ? b.tipo : 'nota', texto, userId);
}

/* ---------------- Mensagens em massa ---------------- */

function cloudCfg(store) {
  try { const c = JSON.parse(store?.wa_cloud || '{}'); return c.token_enc ? { ...c, token: decrypt(c.token_enc) } : c; } catch { return {}; }
}
function cloudPublic(store) {
  const c = cloudCfg(store);
  return { configurado: !!(c.token && c.phone_id && c.template), phone_id: c.phone_id || '', template: c.template || '', lang: c.lang || 'pt_BR', params: c.params || 2 };
}
function saveCloud(storeId, b) {
  const store = get('SELECT wa_cloud FROM stores WHERE id = ?', storeId);
  const old = cloudCfg(store);
  // Mantém o que o assistente do WhatsApp guarda no mesmo campo (conta WABA, inscrição, webhook, chave do app, PIN do número).
  let raw = {}; try { raw = JSON.parse(store?.wa_cloud || '{}'); } catch { raw = {}; }
  const c = {
    ...raw,
    phone_id: str(b.phone_id, 40).replace(/\D/g, ''), template: str(b.template, 80).replace(/[^a-z0-9_]/gi, '').toLowerCase(),
    lang: str(b.lang, 10) || 'pt_BR', params: [0, 1, 2].includes(Number(b.params)) ? Number(b.params) : 2,
    token_enc: b.token ? encrypt(str(b.token, 1000)) : old.token_enc || '',
  };
  // Número trocado: o PIN e o registro eram do número anterior.
  if (raw.phone_id && c.phone_id !== raw.phone_id) { delete c.pin_enc; delete c.registrado; }
  if (b.remover) {
    Object.assign(c, { token_enc: '', phone_id: '', template: '' });
    for (const k of ['waba_id', 'inscrito', 'webhook', 'pin_enc', 'registrado']) delete c[k];
  }
  run('UPDATE stores SET wa_cloud = ? WHERE id = ?', JSON.stringify(c), storeId);
}

const render = (txt, c, store) => String(txt || '')
  .replace(/\{nome\}/gi, (c.nome || '').split(' ')[0] || 'tudo bem')
  .replace(/\{nome_completo\}/gi, c.nome || '')
  .replace(/\{loja\}/gi, store.name || '');

function createCampaign(storeId, b, userId) {
  const store = get('SELECT * FROM stores WHERE id = ?', storeId);
  const ids = [...new Set((Array.isArray(b.contatos) ? b.contatos : []).map(Number))].slice(0, 1000);
  const msg = str(b.mensagem, 1000);
  if (!msg) throw httpError(400, 'Escreva a mensagem.');
  const cs = ids.map((id) => get('SELECT * FROM contacts WHERE id = ? AND store_id = ?', id, storeId)).filter((c) => c && !c.opt_out && !c.excluido);
  if (!cs.length) throw httpError(400, 'Selecione ao menos um contato (quem pediu para não receber mensagens fica de fora).');
  const modo = b.modo === 'api' ? 'api' : 'assistido';
  if (modo === 'api' && !cloudPublic(store).configurado) throw httpError(400, 'Configure a API oficial do WhatsApp antes de enviar automaticamente.');
  const id = run('INSERT INTO wa_campaigns (store_id, nome, mensagem, modo, status, total, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    storeId, str(b.nome, 100) || 'Mensagem', msg, modo, modo === 'api' ? 'enviando' : 'aberta', cs.length, userId).lastInsertRowid;
  cs.forEach((c) => run('INSERT INTO wa_sends (campaign_id, contact_id, texto) VALUES (?, ?, ?)', id, c.id, render(msg, c, store)));
  logEvent(storeId, `Mensagem "${str(b.nome, 100) || 'Mensagem'}" para ${cs.length} contato(s) (${modo === 'api' ? 'automática' : 'assistida'})`);
  if (modo === 'api') setImmediate(() => runCampaign(id).catch((e) => console.error('Campanha WhatsApp:', e.message)));
  return id;
}

async function sendCloud(cfg, to, c, texto) {
  const comps = [];
  // Parâmetros não podem ter quebras de linha: viram " · ".
  const limpa = (s) => String(s).replace(/\s*\n+\s*/g, ' · ').replace(/\s{4,}/g, '   ').slice(0, 900);
  if (cfg.params >= 1) {
    const params = cfg.params === 1 ? [limpa(texto)] : [limpa((c.nome || '').split(' ')[0] || 'cliente'), limpa(texto)];
    comps.push({ type: 'body', parameters: params.map((t) => ({ type: 'text', text: t })) });
  }
  const r = await fetch(`${config.meta.graphUrl}/${config.meta.apiVersion}/${cfg.phone_id}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'template', template: { name: cfg.template, language: { code: cfg.lang || 'pt_BR' }, ...(comps.length ? { components: comps } : {}) } }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(data.error?.error_data?.details || data.error?.message || `HTTP ${r.status}`);
  return data.messages?.[0]?.id || '';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function runCampaign(campaignId) {
  const camp = get('SELECT * FROM wa_campaigns WHERE id = ?', campaignId);
  const store = get('SELECT * FROM stores WHERE id = ?', camp.store_id);
  const cfg = cloudCfg(store);
  for (const s of all(`SELECT s.*, c.nome, c.telefone FROM wa_sends s JOIN contacts c ON c.id = s.contact_id WHERE s.campaign_id = ? AND s.status = 'pendente'`, campaignId)) {
    try {
      await sendCloud(cfg, `55${s.telefone}`, s, s.texto);
      run(`UPDATE wa_sends SET status = 'enviado', sent_at = datetime('now') WHERE id = ?`, s.id);
      run('INSERT INTO contact_notes (contact_id, tipo, texto, user_id) VALUES (?, ?, ?, ?)', s.contact_id, 'campanha', `${camp.nome} (automática)`, camp.created_by);
    } catch (e) {
      run(`UPDATE wa_sends SET status = 'falha', erro = ? WHERE id = ?`, String(e.message).slice(0, 300), s.id);
    }
    await sleep(Number(process.env.WA_DELAY_MS ?? 1500));
  }
  const n = get(`SELECT SUM(status='enviado') e, SUM(status='falha') f FROM wa_sends WHERE campaign_id = ?`, campaignId);
  run(`UPDATE wa_campaigns SET status = 'concluida', enviados = ?, falhas = ? WHERE id = ?`, n.e || 0, n.f || 0, campaignId);
}

function campaigns(storeId) {
  return all(`SELECT w.*, u.name AS user_name, (SELECT COUNT(*) FROM wa_sends s WHERE s.campaign_id = w.id AND s.status = 'enviado') AS ok,
              (SELECT COUNT(*) FROM wa_sends s WHERE s.campaign_id = w.id AND s.status = 'falha') AS erro
              FROM wa_campaigns w LEFT JOIN users u ON u.id = w.created_by WHERE w.store_id = ? ORDER BY w.id DESC LIMIT 50`, storeId);
}
function campaign(storeId, id) {
  const w = get('SELECT * FROM wa_campaigns WHERE id = ? AND store_id = ?', Number(id), storeId);
  if (!w) throw httpError(404, 'Envio não encontrado.');
  const envios = all(`SELECT s.*, c.nome, c.telefone FROM wa_sends s JOIN contacts c ON c.id = s.contact_id WHERE s.campaign_id = ? ORDER BY s.id`, w.id)
    .map((s) => ({ ...s, link: `https://web.whatsapp.com/send?phone=55${s.telefone}&text=${encodeURIComponent(s.texto)}`, link_app: `whatsapp://send?phone=55${s.telefone}&text=${encodeURIComponent(s.texto)}` }));
  return { ...w, envios };
}
// Modo assistido: marca cada envio feito pelo WhatsApp do usuário.
function markSend(storeId, campaignId, sendId, status, userId) {
  const w = get('SELECT * FROM wa_campaigns WHERE id = ? AND store_id = ?', Number(campaignId), storeId);
  if (!w) throw httpError(404, 'Envio não encontrado.');
  const s = get('SELECT * FROM wa_sends WHERE id = ? AND campaign_id = ?', Number(sendId), w.id);
  if (!s) throw httpError(404, 'Contato não encontrado neste envio.');
  const st = ['enviado', 'pulado', 'pendente'].includes(status) ? status : 'enviado';
  run(`UPDATE wa_sends SET status = ?, sent_at = CASE WHEN ? = 'enviado' THEN datetime('now') ELSE sent_at END WHERE id = ?`, st, st, s.id);
  if (st === 'enviado' && s.status !== 'enviado') run('INSERT INTO contact_notes (contact_id, tipo, texto, user_id) VALUES (?, ?, ?, ?)', s.contact_id, 'campanha', w.nome, userId);
  const n = get(`SELECT SUM(status='enviado') e, SUM(status='pendente') p FROM wa_sends WHERE campaign_id = ?`, w.id);
  run('UPDATE wa_campaigns SET enviados = ?, status = ? WHERE id = ?', n.e || 0, n.p ? 'aberta' : 'concluida', w.id);
}

module.exports = { cloudCfg, upsert, PAPEIS, NOTA_TIPOS, fone, sync, list, find, save, remove, addNote, historico, serialize, vinculos, cloudPublic, saveCloud, createCampaign, runCampaign, campaigns, campaign, markSend, render };
