// GiroAuto Fotos (dentro do GiroAuto, em /fotos) — interface em uma página, sem dependências.
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (n) => (n ? 'R$ ' + Number(n).toLocaleString('pt-BR') : '');
const S = { sessao: null, ensaio: null, timer: null, aba: null, cacheOrigem: {} };

async function api(caminho, { metodo = 'GET', corpo, form } = {}) {
  const op = { method: metodo, headers: {} };
  if (form) op.body = form;
  else if (corpo !== undefined) { op.headers['Content-Type'] = 'application/json'; op.body = JSON.stringify(corpo); }
  const r = await fetch('/api/fotos' + caminho, op);
  const data = await r.json().catch(() => ({}));
  const msg = data.erro || data.error;
  if (r.status === 401 && !caminho.startsWith('/login') && !caminho.startsWith('/repasse/')) { S.sessao = null; telaLogin(caminho === '/sessao' ? '' : msg); throw new Error(msg || 'Entre de novo.'); }
  if (!r.ok) throw new Error(msg || `Erro ${r.status}`);
  return data;
}

let toastT;
function toast(msg, erro = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = erro ? 'erro' : ''; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, erro ? 6000 : 3000);
}
const tenta = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); } };

/* ---------------- Ilustração dos modelos (SVG simples, sem foto) ---------------- */
function ilustracao(m) {
  const [c1, c2, c3] = m.cores || ['#8fb3d9', '#e8c48a', '#5a6270'];
  const id = 'g' + m.id;
  const fundo = {
    '01': `<g fill="${c3}" opacity=".55"><rect x="18" y="42" width="16" height="30"/><rect x="38" y="30" width="14" height="42"/><rect x="56" y="48" width="20" height="24"/><rect x="150" y="36" width="18" height="36"/><rect x="172" y="46" width="14" height="26"/></g>`,
    '02': `<g fill="${c2}"><circle cx="30" cy="54" r="18"/><circle cx="58" cy="48" r="22"/><circle cx="160" cy="52" r="20"/><circle cx="186" cy="58" r="14"/></g>`,
    '03': `<g stroke="${c3}" stroke-width="3" opacity=".6"><line x1="0" y1="20" x2="210" y2="20"/><line x1="40" y1="20" x2="40" y2="78"/><line x1="170" y1="20" x2="170" y2="78"/></g>`,
    '04': `<g fill="${c2}" opacity=".5"><rect x="14" y="16" width="40" height="56"/><rect x="156" y="16" width="40" height="56"/></g><g fill="#fff" opacity=".7"><circle cx="70" cy="14" r="3"/><circle cx="105" cy="14" r="3"/><circle cx="140" cy="14" r="3"/></g>`,
    '05': `<g fill="${c2}" opacity=".7"><polygon points="10,78 10,26 70,12 70,78"/><polygon points="140,78 140,18 200,30 200,78"/></g>`,
    '06': `<polygon points="0,70 50,38 90,60 140,30 210,66 210,78 0,78" fill="${c3}" opacity=".8"/><circle cx="168" cy="26" r="9" fill="#fff4c9"/>`,
    '07': `<rect x="0" y="0" width="210" height="80" fill="${c1}"/><ellipse cx="105" cy="100" rx="140" ry="36" fill="${c3}"/>`,
    '08': `<g fill="${c2}"><circle cx="24" cy="40" r="5" opacity=".7"/><circle cx="52" cy="30" r="4" opacity=".5"/><circle cx="160" cy="34" r="6" opacity=".7"/><circle cx="188" cy="46" r="4" opacity=".5"/><circle cx="120" cy="24" r="3" opacity=".6"/></g>`,
    P: `<text x="105" y="44" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="700" fill="${c2}">SEU CENÁRIO</text>`,
  }[m.id] || '';
  return `<svg viewBox="0 0 210 118" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
    <rect width="210" height="118" fill="url(#${id})"/>${fundo}
    <rect y="78" width="210" height="40" fill="${c3}" opacity="${m.id === '07' ? 0 : 0.9}"/>
    <ellipse cx="105" cy="101" rx="58" ry="5" fill="#000" opacity=".35"/>
    <path d="M52 98 L52 88 L64 85 L78 72 L126 72 L144 85 L158 88 L158 98 Z" fill="#20242c"/>
    <path d="M82 75 L123 75 L136 85 L72 85 Z" fill="#9db4c8" opacity=".85"/>
    <circle cx="76" cy="98" r="8" fill="#111"/><circle cx="136" cy="98" r="8" fill="#111"/>
    <circle cx="76" cy="98" r="3.5" fill="#bbb"/><circle cx="136" cy="98" r="3.5" fill="#bbb"/></svg>`;
}

/* ---------------- Login ---------------- */
function telaLogin(msg = '') {
  pararPoll();
  $('#app').innerHTML = `<div class="login"><div class="card">
    <h1>GiroAuto <b>Fotos</b></h1>
    <p class="muted">Ensaios fotográficos dos seus carros com IA e artes prontas para divulgar.</p>
    <form id="fLogin">
      <label>E-mail<input name="email" type="email" autocomplete="username" placeholder="o mesmo do GiroAuto ou do Repasse"></label>
      <label>Senha<input name="senha" type="password" autocomplete="current-password" required></label>
      <button class="prim grande" type="submit">Entrar</button>
      <p class="aviso bad" id="eLogin" ${msg ? '' : 'hidden'}>${esc(msg)}</p>
    </form>
    <div class="familia"><span class="selo">GiroAuto Loja</span><span class="selo">GiroAuto Repasse</span><span class="selo acc">GiroAuto Fotos</span></div>
    <p class="small muted" style="margin:10px 0 0">Use o mesmo login do painel do GiroAuto ou do GiroAuto Repasse. Quem tem conta nos dois vê os carros dos dois.</p>
  </div></div>`;
  $('#fLogin').onsubmit = async (ev) => {
    ev.preventDefault();
    const b = ev.submitter; b.disabled = true; b.textContent = 'Entrando…';
    try {
      await api('/login', { metodo: 'POST', corpo: Object.fromEntries(new FormData(ev.target)) });
      await iniciar();
    } catch (e) { $('#eLogin').hidden = false; $('#eLogin').textContent = e.message; b.disabled = false; b.textContent = 'Entrar'; }
  };
}

/* ---------------- Estrutura ---------------- */
function moldura(conteudo) {
  const s = S.sessao;
  $('#app').innerHTML = `<header class="topo">
      <a class="marca" data-ir="#/"><img src="/fotos/icone.svg" alt="">GiroAuto&nbsp;<b>Fotos</b></a>
      <span class="esp"></span>
      <span class="quem"><b>${esc(s.nome || s.email)}</b><br>${s.espacos.map((e) => esc(e.nome)).join(' · ')}</span>
      ${s.origens.loja ? '<a class="btn mini" href="/" style="background:transparent;border-color:#3a404b;color:#e8eaee">Painel GiroAuto</a>' : ''}
      ${s.admin ? '<button class="mini" data-ir="#/config">Configurações</button>' : ''}
      <button class="mini" id="bSair">Sair</button>
    </header><main id="main">${conteudo}</main>`;
  $('#bSair').onclick = tenta(async () => { await api('/logout', { metodo: 'POST' }); S.sessao = null; telaLogin(); });
}
document.addEventListener('click', (ev) => { const a = ev.target.closest('[data-ir]'); if (a) { ev.preventDefault(); location.hash = a.dataset.ir; } });

function pararPoll() { clearTimeout(S.timer); S.timer = null; }
window.addEventListener('hashchange', () => rota());

async function rota() {
  pararPoll();
  if (!S.sessao) return;
  const h = location.hash || '#/';
  let m;
  if (h === '#/novo') return telaNovo();
  if (h === '#/config') return telaConfig();
  if ((m = h.match(/^#\/ensaio\/(\d+)/))) return telaEnsaio(Number(m[1]));
  if ((m = h.match(/^#\/carro\/(\d+)/))) { // vindo do menu "Mais" do estoque
    moldura('<p class="carregando">Trazendo os dados e as fotos do carro…</p>');
    try {
      const r = await api('/ensaios', { metodo: 'POST', corpo: { origem: 'loja', origem_id: m[1] } });
      if (r.aviso) toast(r.aviso, true);
      location.replace(`#/ensaio/${r.id}`);
    } catch (e) { $('#main').innerHTML = `<p class="aviso bad">${esc(e.message)}</p>`; }
    return;
  }
  return telaLista();
}

/* ---------------- Lista ---------------- */
const STATUS = { rascunho: ['Rascunho', ''], gerando: ['Gerando', 'info'], pronto: ['Pronto', 'ok'], manual: ['Aguardando imagens', 'warn'], erro: ['Com erro', 'bad'] };
async function telaLista() {
  moldura('<p class="carregando">Carregando ensaios…</p>');
  const lista = await api('/ensaios');
  const s = S.sessao;
  $('#main').innerHTML = `
    <div class="linha entre" style="margin-bottom:14px"><div><h1>Ensaios</h1><p class="muted" style="margin:0">Fotos profissionais com IA e artes com as informações do veículo.</p></div>
      <button class="prim grande" data-ir="#/novo">+ Novo ensaio</button></div>
    ${s.falta_ia ? `<p class="aviso warn">${esc(s.falta_ia)}</p>` : ''}
    ${lista.length ? `<div class="grade">${lista.map((e) => `
      <div class="ensaio" data-ir="#/ensaio/${e.id}">
        <div class="foto" style="background-image:url('${esc(e.capa)}')"></div>
        <div class="info"><div class="t">${esc(e.titulo || 'Veículo sem nome')}</div>
          <div class="linha small"><span class="selo ${STATUS[e.status]?.[1] || ''}">${STATUS[e.status]?.[0] || e.status}</span>
          <span class="muted">${esc(e.modelo_nome)}</span></div>
          <div class="small muted" style="margin-top:4px">${e.aprovadas ? `${e.aprovadas} aprovada(s) · ` : ''}${e.prontas}/${e.quantidade} prontas · ${{ loja: 'Loja', repasse: 'Repasse', avulso: 'Avulso' }[e.origem]}${e.placa ? ` · <span class="placa">${esc(e.placa)}</span>` : ''}</div>
        </div></div>`).join('')}</div>`
    : `<div class="card vazio"><h2>Nenhum ensaio ainda</h2><p>Escolha um carro do estoque da Loja, um anúncio do Repasse ou cadastre um avulso pela placa.</p><button class="prim grande" data-ir="#/novo">Começar o primeiro ensaio</button></div>`}`;
  if (lista.some((e) => e.status === 'gerando')) S.timer = setTimeout(() => location.hash === '#/' || !location.hash ? telaLista().catch(() => {}) : null, 5000);
}

/* ---------------- Novo ensaio: escolha do veículo ---------------- */
async function telaNovo() {
  const s = S.sessao;
  const abas = [s.origens.loja && ['loja', 'Estoque da loja'], s.origens.repasse && ['fila', 'Repasse: fila'], s.origens.repasse && ['circulacao', 'Repasse: em circulação'], !s.origens.repasse && ['conectar', 'Repasse'], ['avulso', 'Avulso (placa)']].filter(Boolean);
  S.aba = abas.some((a) => a[0] === S.aba) ? S.aba : abas[0][0];
  moldura(`<div class="card"><div class="passo"><span class="n">1</span><h2>Qual veículo?</h2></div>
    <div class="abas">${abas.map(([k, t]) => `<button data-aba="${k}" class="${k === S.aba ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div id="origem"></div></div>`);
  $$('[data-aba]').forEach((b) => { b.onclick = () => { S.aba = b.dataset.aba; telaNovo(); }; });
  const box = $('#origem');
  if (S.aba === 'avulso') return formAvulso(box);
  if (S.aba === 'conectar') return formConectar(box);
  box.innerHTML = '<p class="carregando">Buscando veículos…</p>';
  try {
    const chave = S.aba;
    const lista = S.cacheOrigem[chave] && S.cacheOrigem[chave].t > Date.now() - 60e3 ? S.cacheOrigem[chave].v
      : await api(chave === 'loja' ? '/origens/loja' : `/origens/repasse?grupo=${chave}`);
    S.cacheOrigem[chave] = { t: Date.now(), v: lista };
    if (!lista.length) { box.innerHTML = `<p class="vazio">Nenhum veículo aqui.</p>`; return; }
    box.innerHTML = `<input id="busca" placeholder="Buscar por modelo, placa ou código" style="max-width:360px;margin-bottom:12px">
      <div class="veics">${lista.map((v, i) => `<div class="veic" data-i="${i}" data-txt="${esc([v.titulo, v.placa, v.codigo, v.veiculo?.placa].join(' ').toLowerCase())}">
        <div class="foto" style="background-image:url('${esc(v.capa)}')"></div>
        <div class="info"><b>${esc(v.titulo)}</b><br><span class="muted">${[v.codigo, v.situacao || v.status, brl(v.veiculo?.preco)].filter(Boolean).map(esc).join(' · ')}</span>
        ${v.veiculo?.placa ? `<br><span class="placa">${esc(v.veiculo.placa)}</span>` : ''}${v.n_fotos === 0 || (v.fotos && !v.fotos.length) ? '<br><span class="selo warn">sem fotos</span>' : ''}</div></div>`).join('')}</div>`;
    $('#busca').oninput = (ev) => { const q = ev.target.value.toLowerCase().trim(); $$('.veic', box).forEach((c) => { c.hidden = q && !c.dataset.txt.includes(q); }); };
    $$('.veic', box).forEach((c) => {
      c.onclick = tenta(async () => {
        const v = lista[c.dataset.i];
        box.innerHTML = '<p class="carregando">Trazendo os dados e as fotos do veículo…</p>';
        const r = await api('/ensaios', { metodo: 'POST', corpo: { origem: chave === 'loja' ? 'loja' : 'repasse', origem_id: v.id } });
        if (r.aviso) toast(r.aviso, true);
        location.hash = `#/ensaio/${r.id}`;
      });
    });
  } catch (e) { box.innerHTML = `<p class="aviso bad">${esc(e.message)}</p>`; }
}

function formConectar(box) {
  box.innerHTML = `<p class="muted">Para fazer o ensaio de um carro da fila ou em circulação no <b>GiroAuto Repasse</b>, entre com o login do Repasse.</p>
    <form id="fRp" class="campos" style="max-width:560px;align-items:end"><label>E-mail do Repasse<input name="email" type="email" required></label>
    <label>Senha<input name="senha" type="password" required></label><div><button class="prim">Conectar</button></div></form>`;
  $('#fRp').onsubmit = tenta(async (ev) => {
    ev.preventDefault();
    const r = await api('/repasse/conectar', { metodo: 'POST', corpo: Object.fromEntries(new FormData(ev.target)) });
    toast(`Repasse conectado: ${r.nome}`);
    S.sessao = await api('/sessao'); S.aba = 'fila'; telaNovo();
  });
}

function formAvulso(box) {
  const s = S.sessao;
  box.innerHTML = `<form id="fPlaca" class="linha" style="align-items:flex-end;max-width:520px">
      <label style="flex:1">Placa<input name="placa" placeholder="ABC1D23" maxlength="8" style="text-transform:uppercase"></label>
      <button class="prim">Buscar dados</button></form>
    <p class="small muted">Busca nas mesmas fontes públicas e na Tabela FIPE usadas pelo GiroAuto Loja. Se a placa não for encontrada, escolha pela FIPE ou preencha à mão.</p>
    <div id="fipeBox" class="campos" style="margin:10px 0"></div>
    <form id="fAvulso" class="campos" style="margin-top:12px">${camposVeiculo({})}
      ${s.espacos.filter((e) => s.editar.includes(e.id)).length > 1 ? `<label>Ensaio de<select name="espaco">${s.espacos.filter((e) => s.editar.includes(e.id)).map((e) => `<option value="${esc(e.id)}">${esc(e.nome)}</option>`).join('')}</select></label>` : ''}
      <div style="grid-column:1/-1"><button class="prim grande">Continuar</button></div></form>`;
  $('#fPlaca').onsubmit = tenta(async (ev) => {
    ev.preventDefault();
    const b = ev.submitter; b.disabled = true; b.textContent = 'Buscando…';
    try {
      const d = await api(`/placa/${encodeURIComponent(new FormData(ev.target).get('placa'))}`);
      if (d.veiculo) { preencher($('#fAvulso'), d.veiculo); toast(`Encontrado: ${[d.veiculo.marca, d.veiculo.modelo, d.veiculo.ano_modelo].filter(Boolean).join(' ')}`); }
      else { toast('Placa não encontrada nas fontes públicas. Escolha pela FIPE abaixo ou preencha.', true); $('#fAvulso [name=placa]').value = new FormData(ev.target).get('placa').toUpperCase(); fipe(); }
    } finally { b.disabled = false; b.textContent = 'Buscar dados'; }
  });
  $('#fAvulso').onsubmit = tenta(async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const r = await api('/ensaios', { metodo: 'POST', corpo: { origem: 'avulso', espaco: fd.get('espaco'), veiculo: lerVeiculo(ev.target) } });
    location.hash = `#/ensaio/${r.id}`;
  });
  async function fipe() {
    const fb = $('#fipeBox');
    fb.innerHTML = `<label>Marca (FIPE)<select id="fMarca"><option value="">Carregando…</option></select></label><label>Modelo<select id="fModelo" disabled></select></label><label>Ano<select id="fAno" disabled></select></label>`;
    const op = (l, sel = '') => `<option value="">${sel}</option>` + l.map((x) => `<option value="${esc(x.codigo)}">${esc(x.nome)}</option>`).join('');
    try { $('#fMarca').innerHTML = op(await api('/fipe/marcas'), 'Escolha'); } catch (e) { fb.innerHTML = `<p class="aviso warn">${esc(e.message)}</p>`; return; }
    $('#fMarca').onchange = tenta(async (e) => { $('#fModelo').disabled = false; $('#fModelo').innerHTML = op(await api(`/fipe/modelos/${e.target.value}`), 'Escolha'); });
    $('#fModelo').onchange = tenta(async (e) => { $('#fAno').disabled = false; $('#fAno').innerHTML = op(await api(`/fipe/anos/${$('#fMarca').value}/${e.target.value}`), 'Escolha'); });
    $('#fAno').onchange = tenta(async (e) => { const d = await api(`/fipe/preco/${$('#fMarca').value}/${$('#fModelo').value}/${e.target.value}`); preencher($('#fAvulso'), { ...d.veiculo, placa: $('#fAvulso [name=placa]').value }); toast('Dados da FIPE aplicados. Confira a cor, o km e o preço.'); });
  }
}

/* ---------------- Campos do veículo (avulso e dados da arte) ---------------- */
function camposVeiculo(v) {
  const s = S.sessao;
  const sel = (n, l, lista) => `<label>${l}<select name="${n}"><option value=""></option>${lista.map((x) => `<option ${v[n] === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>`;
  const inp = (n, l, t = 'text', extra = '') => `<label>${l}<input name="${n}" type="${t}" value="${esc(v[n] ?? '')}" ${extra}></label>`;
  return `${inp('marca', 'Marca')}${inp('modelo', 'Modelo')}${inp('versao', 'Versão / motor')}
    ${inp('ano_fab', 'Ano fabricação', 'number')}${inp('ano_modelo', 'Ano modelo', 'number')}${inp('km', 'Km', 'number')}
    ${inp('preco', 'Preço (R$)', 'number')}${inp('preco_oferta', 'Preço de oferta (R$)', 'number')}
    ${sel('cambio', 'Câmbio', s.cambios)}${sel('combustivel', 'Combustível', s.combustiveis)}${sel('cor', 'Cor', s.cores)}${sel('carroceria', 'Carroceria', s.carrocerias)}
    ${inp('placa', 'Placa', 'text', 'maxlength="8" style="text-transform:uppercase"')}`;
}
function preencher(form, v) {
  for (const [k, x] of Object.entries(v || {})) {
    const el = form.querySelector(`[name="${k}"]`);
    if (!el || x == null || x === '') continue;
    if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === String(x))) el.add(new Option(x, x));
    el.value = x;
  }
}
function lerVeiculo(form) {
  const fd = new FormData(form);
  const v = {};
  for (const k of ['marca', 'modelo', 'versao', 'ano_fab', 'ano_modelo', 'km', 'preco', 'preco_oferta', 'cambio', 'combustivel', 'cor', 'carroceria', 'placa', 'frase', 'chamada']) if (fd.has(k)) v[k] = fd.get(k);
  if (form.querySelector('[name=selo]')) v.destaques = fd.getAll('selo');
  return v;
}

/* ---------------- Ensaio ---------------- */
async function telaEnsaio(id) {
  if (!S.ensaio || S.ensaio.id !== id) moldura('<p class="carregando">Abrindo o ensaio…</p>');
  try { S.ensaio = await api(`/ensaios/${id}`); } catch (e) { moldura(`<p class="aviso bad">${esc(e.message)}</p>`); return; }
  desenharEnsaio();
}

function desenharEnsaio() {
  const e = S.ensaio; const s = S.sessao;
  if (!$('#main')) moldura('');
  const rolagem = window.scrollY;
  const temGeracao = e.geradas.length > 0;
  const gerando = e.geradas.filter((g) => ['pendente', 'gerando', 'navegador'].includes(g.status)).length;
  const prontas = e.geradas.filter((g) => ['pronta', 'aprovada'].includes(g.status)).length;
  const modelos = s.modelos;
  $('#main').innerHTML = `
  <div class="linha entre" style="margin-bottom:12px">
    <div><a href="#/" class="small">← Ensaios</a><h1 style="margin-top:4px">${esc(e.titulo || 'Veículo')}</h1>
      <div class="linha small"><span class="selo ${STATUS[e.status]?.[1] || ''}">${STATUS[e.status]?.[0] || e.status}</span>
      <span class="muted">${{ loja: 'Estoque da loja', repasse: 'Repasse', avulso: 'Avulso' }[e.origem]} · ensaio nº ${e.id}</span>
      ${e.veiculo.placa ? `<span class="placa">${esc(e.veiculo.placa)}</span>` : ''}</div></div>
    <button class="mini perigo" id="bExcluir">Excluir ensaio</button>
  </div>

  ${temGeracao ? blocoResultado(e, gerando, prontas) : ''}

  <details class="card" ${temGeracao ? '' : 'open'} id="dConfig"><summary><h2 style="display:inline">${temGeracao ? 'Fotos originais e opções do ensaio' : 'Montar o ensaio'}</h2></summary>
  <div style="margin-top:14px">
    <div class="passo"><span class="n">2</span><h3 style="margin:0">Fotos originais (${e.originais.length})</h3></div>
    <p class="small muted">Cada foto do ensaio parte de uma foto real, do mesmo ângulo: a IA troca só o ambiente e não inventa partes do carro. A primeira foto é a capa.</p>
    <div class="originais">${e.originais.map((o, i) => `<div class="orig">
        ${i === 0 ? '<span class="selo acc capa">Capa</span>' : ''}<img src="${o.url}" data-zoom="${o.url}" alt="">
        <div class="barra"><select data-tipo="${o.id}">${Object.entries(s.tipos).map(([k, t]) => `<option value="${k}" ${o.tipo === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
        ${i ? `<button class="mini" title="Usar como capa" data-capa="${o.id}">★</button>` : ''}<button class="mini perigo" title="Remover" data-del="${o.id}">✕</button></div></div>`).join('')}
      <label class="soltar" id="soltar">+ Adicionar fotos<br><span class="small">ou arraste aqui (até 20)</span><input type="file" id="fArq" accept="image/*" multiple hidden></label>
    </div>
    ${e.originais.length && e.originais.length < e.quantidade ? `<div class="aviso info">Você tem ${e.originais.length} foto(s) para um ensaio de ${e.quantidade}.
      <label class="check" style="margin-top:6px"><input type="checkbox" data-op="novos_angulos" ${e.novos_angulos ? 'checked' : ''}> A IA cria os ${e.quantidade - e.originais.length} ângulos que faltam (frente 3/4, traseira 3/4, lateral…) a partir das fotos enviadas</label>
      <span class="small">${e.novos_angulos ? 'Ângulos criados pela IA vêm marcados para você conferir. O interior só é criado se houver ao menos uma foto real do interior (marque o tipo "Interior").' : 'Desligado: as fotos que faltam serão variações de luz e enquadramento dos mesmos ângulos.'}</span></div>` : ''}

    <div class="passo" style="margin-top:22px"><span class="n">3</span><h3 style="margin:0">Modelo de ensaio</h3></div>
    <div class="modelos">${modelos.map((m) => `<div class="modelo ${e.modelo === m.id ? 'on' : ''}" data-modelo="${m.id}">${ilustracao(m)}
      <div class="info"><div class="t">${m.id === 'P' ? '' : m.id + ' · '}${esc(m.nome)}</div><div class="small muted">${esc(m.conceito)}</div></div></div>`).join('')}</div>
    <p class="small muted" style="margin-top:8px">${esc(modelos.find((m) => m.id === e.modelo)?.descricao || '')}</p>
    ${e.modelo === 'P' ? `<div class="campos" style="grid-template-columns:2fr 1fr;margin-top:8px">
      <label>Descreva o cenário<textarea id="tPers" rows="3" placeholder="Ex.: pátio da loja com piso de concreto, fachada azul com o letreiro ao fundo, fim de tarde">${esc(e.personalizado.texto)}</textarea></label>
      <div><label>Foto de referência (opcional)</label>${e.personalizado.referencia ? `<img src="${e.personalizado.referencia}" style="border-radius:8px;margin:4px 0;max-height:110px">` : ''}
        <label class="btn mini" style="margin-top:4px">Enviar foto do cenário<input type="file" id="fRef" accept="image/*" hidden></label></div></div>` : ''}

    <div class="passo" style="margin-top:22px"><span class="n">4</span><h3 style="margin:0">Opções</h3></div>
    <div class="campos" style="grid-template-columns:repeat(auto-fill,minmax(210px,1fr))">
      <div><label>Quantidade de fotos</label><div class="chips" style="margin-top:4px">${s.quantidades.map((q) => `<button class="mini ${e.quantidade === q ? 'on' : ''}" data-qtd="${q}">${q}</button>`).join('')}</div></div>
      <label>Formato<select data-op="formato">${Object.entries(s.formatos).map(([k, t]) => `<option value="${k}" ${e.formato === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <label>Resolução<select data-op="resolucao"><option value="1K" ${e.resolucao === '1K' ? 'selected' : ''}>Padrão (1080 px)</option><option value="2K" ${e.resolucao === '2K' ? 'selected' : ''}>Alta (2160 px)</option></select></label>
      <label>Como gerar<select data-op="provedor">
        ${s.servidor_ia ? `<option value="" ${!e.provedor ? 'selected' : ''}>${esc(s.provedor_nome)}</option>` : ''}
        <option value="navegador" ${e.provedor === 'navegador' || (!e.provedor && !s.servidor_ia) ? 'selected' : ''}>Gemini direto nesta página (conta Puter)</option>
        ${e.provedor === 'manual' ? '<option value="manual" selected>Manual (app do Gemini)</option>' : ''}</select></label>
      <label>Placa<select data-op="placa_modo">${Object.entries(s.placa).map(([k, t]) => `<option value="${k}" ${e.placa_modo === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
    </div>
    <label class="check" style="margin-top:10px"><input type="checkbox" data-op="arte" ${e.arte ? 'checked' : ''}> Gerar a arte com as informações do veículo (4:5 e stories 9:16)</label>

    <details style="margin-top:14px" ${e.origem === 'avulso' && !e.veiculo.modelo ? 'open' : ''}><summary>Dados da arte (preço, itens, selos e contato)</summary>
      <form id="fArte" class="campos" style="margin-top:10px">${camposVeiculo(e.veiculo)}
        <label>Frase (opcional)<input name="frase" value="${esc(e.veiculo.frase || '')}" placeholder="padrão pela carroceria"></label>
        <label>Chamada (opcional)<input name="chamada" value="${esc(e.veiculo.chamada || '')}" placeholder="Ex.: Agende sua visita!"></label>
        <div style="grid-column:1/-1"><label>Selos (até 2 aparecem na arte)</label><div class="linha" style="margin-top:4px">${s.selos.map((x) => `<label class="check"><input type="checkbox" name="selo" value="${x.key}" ${(e.veiculo.destaques || []).includes(x.key) ? 'checked' : ''}>${esc(x.label)}</label>`).join('')}</div></div>
        <label>Nome da loja (rodapé)<input name="l_nome" value="${esc(e.loja.nome || '')}"></label>
        <label>WhatsApp<input name="l_whatsapp" value="${esc(e.loja.whatsapp || '')}"></label>
        <label>Cidade<input name="l_cidade" value="${esc(e.loja.cidade || '')}"></label>
        <div style="grid-column:1/-1" class="linha"><button class="prim">Salvar dados da arte</button><span class="small muted">Altera só a arte deste ensaio, não o cadastro ${e.origem === 'repasse' ? 'no Repasse' : 'do carro'}.</span></div>
      </form></details>

    <div class="fixo linha entre" style="margin-top:18px">
      <span class="small muted">${e.provedor === 'navegador' || (!e.provedor && !s.servidor_ia) ? 'Automático: a própria página gera as fotos com o Gemini (Nano Banana) pela sua conta Puter. Na primeira vez, o Puter pede para entrar (conta grátis). Mantenha a página aberta até terminar.' : `IA: ${esc(s.provedor_nome)}. Se a cota ou o crédito acabar, a página continua sozinha pelo Gemini da conta Puter.`}</span>
      <button class="prim grande" id="bGerar" ${e.originais.length ? '' : 'disabled'}>${temGeracao ? 'Gerar o ensaio de novo' : `Gerar ensaio com ${e.quantidade} fotos`}</button>
    </div>
  </div></details>`;
  window.scrollTo(0, rolagem);
  ligarEnsaio();
  if (e.geradas.some((g) => g.status === 'navegador')) puterRodar();
  if (gerando || e.artes.some((a) => a.status === 'gerando') || (e.status === 'pronto' && e.arte && !e.artes.length)) S.timer = setTimeout(atualizar, 2500);
}

function blocoResultado(e, gerando, prontas) {
  const total = e.geradas.length;
  const aprovadas = e.geradas.filter((g) => g.status === 'aprovada').length;
  const orig = Object.fromEntries(e.originais.map((o) => [o.id, o.url]));
  const s = S.sessao;
  return `<div class="card">
    <div class="linha entre"><div class="passo" style="margin:0"><span class="n">5</span><h2>Ensaio · ${esc(e.modelo_nome)}</h2></div>
      <div class="linha">${prontas ? `<a class="btn prim" href="/api/fotos/ensaios/${e.id}/zip">⬇ Baixar tudo (ZIP)</a>` : ''}
      ${e.origem === 'loja' && s.origens.podeEnviarLoja && aprovadas ? `<button id="bLoja">Pôr ${aprovadas} aprovada(s) nas fotos do carro</button>` : ''}</div></div>
    ${gerando ? `<div class="progresso"><div style="width:${Math.round(((total - gerando) / total) * 100)}%"></div></div><p class="small muted">Gerando ${total - gerando + 1} de ${total}… ${e.geradas.some((g) => g.status === 'navegador') ? 'mantenha esta aba aberta.' : 'pode sair desta tela, o ensaio continua.'}</p>` : ''}
    ${e.geradas.some((g) => g.status === 'navegador') ? `<div class="aviso info" id="puterAviso">${PU.precisaEntrar
      ? `Para gerar aqui mesmo com o Gemini, conecte uma conta <b>Puter</b> (gratuita, só na primeira vez). <button class="mini prim" id="bPuter">Entrar no Puter e gerar</button>`
      : `Gerando com o Gemini nesta página. Mantenha esta aba aberta até terminar.`}${PU.erro ? `<br><span class="selo bad">${esc(PU.erro)}</span>` : ''}</div>` : ''}
    ${e.geradas.some((g) => g.status === 'manual') ? `<div class="aviso info"><b>Grátis pelo app do Gemini</b> (conta Google gratuita), em 3 passos para cada foto:
      <ol style="margin:6px 0 4px 18px;padding:0"><li><b>Copiar texto e baixar foto</b>: o texto vai para a área de transferência e a foto do carro é baixada.</li>
      <li><b>Abrir o Gemini</b>, anexar a foto baixada, colar o texto (Ctrl+V) e enviar.</li>
      <li>Baixe ou copie a imagem que o Gemini criar e clique em <b>Enviar imagem</b> (ou cole aqui com Ctrl+V).</li></ol>
      <span class="small">Também funciona no ChatGPT. O app do Gemini tem um limite diário de imagens para contas gratuitas.</span></div>` : ''}
    ${!gerando && prontas ? `<p class="small muted">Aprove as melhores (vão para o ZIP e para a arte), descarte as que não ficaram boas ou peça para refazer com uma instrução. A miniatura no canto é a foto original.</p>` : ''}
    <div class="resultado">${e.geradas.map((g) => cardGerada(g, orig[g.original_id])).join('')}</div>
    ${e.arte ? `<h3 style="margin-top:20px">Artes com as informações do veículo</h3>
      ${e.artes.length ? `<div class="artes">${e.artes.map((a) => `<figure>${a.status === 'pronta' ? `<img src="${a.url}" data-zoom="${a.url}" alt="">` : `<div class="ger"><div class="img"><div class="estado">${a.status === 'erro' ? `<span class="selo bad">Erro</span><br>${esc(a.erro)}` : '<div class="giro"></div>Montando a arte…'}</div></div></div>`}
        <figcaption><span>${a.formato === '9:16' ? 'Stories 9:16' : 'Feed 4:5'}</span>${a.status === 'pronta' ? `<a class="btn mini" href="${a.url}" download="arte-${a.formato.replace(':', 'x')}.jpg">Baixar</a>` : ''}</figcaption></figure>`).join('')}</div>
      <button class="mini" id="bArtes" style="margin-top:8px">Refazer artes</button> <span class="small muted">A arte usa a primeira foto aprovada como capa e as seguintes nas miniaturas. Ajuste preço e selos em "Dados da arte".</span>`
      : `<p class="small muted">${prontas ? 'A arte é montada quando o ensaio termina.' : 'Aparece quando houver fotos prontas.'}</p>${prontas && !gerando ? '<button class="mini" id="bArtes">Montar artes agora</button>' : ''}`}` : ''}
  </div>`;
}

function cardGerada(g, origUrl) {
  const fid = g.fidelidade;
  const selFid = fid ? `<span class="selo ${fid.nota >= 8 ? 'ok' : fid.nota >= 7 ? 'warn' : 'bad'}" title="${esc((fid.diferencas || []).join('; ') || 'Nenhuma diferença no carro')}">Fidelidade ${fid.nota}/10</span>` : '';
  const ST = { navegador: 'Gerando nesta página', pendente: 'Na fila', gerando: 'Gerando', pronta: 'Pronta', aprovada: 'Aprovada', descartada: 'Descartada', erro: 'Erro', manual: 'Aguardando imagem' };
  let img;
  if (g.url && g.status !== 'gerando') img = `<img src="${g.url}" data-zoom="${g.url}" data-orig="${origUrl || ''}" alt="">${origUrl ? `<img class="orig-mini" src="${origUrl}" alt="original">` : ''}`;
  else if (g.status === 'navegador') img = `<div class="estado"><div class="giro"></div>${PU.ativos.has(g.id) ? 'O Gemini está criando esta foto…' : PU.precisaEntrar ? 'Aguardando entrar no Puter' : 'Na fila desta página'}</div>`;
  else if (g.status === 'pendente' || g.status === 'gerando') img = `<div class="estado"><div class="giro"></div>${g.status === 'gerando' ? 'A IA está trabalhando nesta foto…' : 'Na fila'}</div>`;
  else if (g.status === 'manual') img = `<div class="estado">${origUrl ? `<img src="${origUrl}" style="max-height:130px;margin:0 auto 8px;border-radius:4px">` : ''}${g.erro ? `<span class="small">${esc(g.erro)}</span>` : 'Gere no app do Gemini e envie a imagem.'}</div>`;
  else img = `<div class="estado"><span class="selo bad">Erro</span><br>${esc(g.erro)}</div>`;
  const pronta = g.url && ['pronta', 'aprovada', 'descartada'].includes(g.status);
  return `<div class="ger ${g.status}" data-g="${g.id}">
    <div class="cab"><b>Foto ${g.ordem}${g.angulo ? ` <span class="selo info" title="Ângulo novo criado pela IA a partir das fotos enviadas. Confira os detalhes.">IA: ${esc(g.angulo_nome)}</span>` : ''}</b><span class="linha" style="gap:4px">${selFid}<span class="selo ${g.status === 'aprovada' ? 'ok' : g.status === 'erro' ? 'bad' : ''}">${ST[g.status] || g.status}</span></span></div>
    <div class="img">${img}</div>
    ${fid && fid.nota < 7 && fid.diferencas?.length ? `<p class="aviso warn small" style="margin:6px 8px 0">Conferir: ${esc(fid.diferencas.join('; '))}</p>` : ''}
    ${g.instrucao ? `<p class="small muted" style="margin:6px 10px 0">Pedido: ${esc(g.instrucao)}</p>` : ''}
    <div class="acoes">
      ${pronta && g.status !== 'aprovada' ? `<button class="mini" data-acao="aprovada">✓ Aprovar</button>` : ''}
      ${g.status === 'aprovada' ? `<button class="mini" data-acao="pronta">Desfazer</button>` : ''}
      ${pronta && g.status !== 'descartada' ? `<button class="mini" data-acao="descartada">Descartar</button>` : ''}
      ${!['pendente', 'gerando', 'navegador', 'manual'].includes(g.status) ? `<button class="mini" data-acao="refazer">↻ Refazer</button>` : ''}
      ${g.url && g.status !== 'gerando' ? `<a class="btn mini" href="${g.url}" download="foto-${g.ordem}.jpg">Baixar</a>` : ''}
      ${g.prompt_pt ? `<button class="mini prim" data-acao="copiar">1. Copiar texto e baixar foto</button><a class="btn mini" href="https://gemini.google.com/app" target="_blank" rel="noopener">2. Abrir o Gemini</a><label class="btn mini">3. Enviar imagem<input type="file" accept="image/*" data-manual hidden></label>` : ''}
    </div></div>`;
}

function ligarEnsaio() {
  const e = S.ensaio;
  const put = async (corpo) => { S.ensaio = await api(`/ensaios/${e.id}`, { metodo: 'PUT', corpo }); desenharEnsaio(); };
  $('#bExcluir').onclick = tenta(async () => { if (!confirm('Excluir este ensaio e todas as imagens dele?')) return; await api(`/ensaios/${e.id}`, { metodo: 'DELETE' }); location.hash = '#/'; });
  const enviar = tenta(async (files) => {
    if (!files.length) return;
    const fd = new FormData(); [...files].forEach((f) => fd.append('fotos', f));
    toast(`Enviando ${files.length} foto(s)…`);
    S.ensaio = await api(`/ensaios/${e.id}/originais`, { metodo: 'POST', form: fd }); desenharEnsaio();
  });
  $('#fArq').onchange = (ev) => enviar(ev.target.files);
  const sol = $('#soltar');
  sol.ondragover = (ev) => { ev.preventDefault(); sol.classList.add('sobre'); };
  sol.ondragleave = () => sol.classList.remove('sobre');
  sol.ondrop = (ev) => { ev.preventDefault(); sol.classList.remove('sobre'); enviar(ev.dataTransfer.files); };
  $$('[data-tipo]').forEach((s) => { s.onchange = tenta(async () => { S.ensaio = await api(`/ensaios/${e.id}/originais/${s.dataset.tipo}`, { metodo: 'PUT', corpo: { tipo: s.value } }); }); });
  $$('[data-capa]').forEach((b) => { b.onclick = tenta(async () => { S.ensaio = await api(`/ensaios/${e.id}/originais/${b.dataset.capa}`, { metodo: 'PUT', corpo: { ordem: 0 } }); desenharEnsaio(); }); });
  $$('[data-del]').forEach((b) => { b.onclick = tenta(async () => { S.ensaio = await api(`/ensaios/${e.id}/originais/${b.dataset.del}`, { metodo: 'DELETE' }); desenharEnsaio(); }); });
  $$('[data-modelo]').forEach((c) => { c.onclick = tenta(() => put({ modelo: c.dataset.modelo })); });
  $$('[data-qtd]').forEach((b) => { b.onclick = tenta(() => put({ quantidade: Number(b.dataset.qtd) })); });
  $$('[data-op]').forEach((el) => { el.onchange = tenta(() => put({ [el.dataset.op]: el.type === 'checkbox' ? el.checked : el.value })); });
  if ($('#tPers')) $('#tPers').onchange = tenta((ev) => put({ personalizado_texto: ev.target.value }));
  if ($('#fRef')) $('#fRef').onchange = tenta(async (ev) => { const fd = new FormData(); fd.append('foto', ev.target.files[0]); S.ensaio = await api(`/ensaios/${e.id}/referencia`, { metodo: 'POST', form: fd }); desenharEnsaio(); });
  $('#fArte').onsubmit = tenta(async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    await put({ veiculo: lerVeiculo(ev.target), loja: { nome: fd.get('l_nome'), whatsapp: fd.get('l_whatsapp'), cidade: fd.get('l_cidade') } });
    toast(S.ensaio.artes.length ? 'Dados salvos. As artes estão sendo refeitas.' : 'Dados salvos.');
  });
  $('#bGerar').onclick = tenta(async (ev) => {
    if (e.geradas.length && !confirm('Gerar de novo apaga as fotos geradas deste ensaio (as originais continuam). Continuar?')) return;
    if ($('#tPers') && $('#tPers').value !== e.personalizado.texto) await api(`/ensaios/${e.id}`, { metodo: 'PUT', corpo: { personalizado_texto: $('#tPers').value } });
    ev.target.disabled = true;
    const naPagina = e.provedor === 'navegador' || (!e.provedor && !S.sessao.servidor_ia);
    if (naPagina) { try { await puterEntrar(); } catch (er) { toast(er.message, true); } } // o Puter abre a janela de login no clique
    S.ensaio = await api(`/ensaios/${e.id}/gerar`, { metodo: 'POST' });
    desenharEnsaio(); window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  if ($('#bPuter')) $('#bPuter').onclick = tenta(async () => { PU.erro = ''; await puterEntrar(); puterRodar(); desenharEnsaio(); });
  if ($('#bArtes')) $('#bArtes').onclick = tenta(async () => { S.ensaio = await api(`/ensaios/${e.id}/artes`, { metodo: 'POST' }); desenharEnsaio(); setTimeout(atualizar, 1500); });
  if ($('#bLoja')) $('#bLoja').onclick = tenta(async (ev) => {
    if (!confirm('Colocar as fotos aprovadas no cadastro deste carro no estoque? Elas entram depois das fotos que já estão lá (limite de 20).')) return;
    ev.target.disabled = true;
    const r = await api(`/ensaios/${e.id}/enviar-loja`, { metodo: 'POST' });
    toast(`${r.enviadas} foto(s) incluídas. O carro tem ${r.total_na_loja} fotos no estoque.`);
    ev.target.disabled = false;
  });
  $$('.ger').forEach((c) => {
    const gid = c.dataset.g; const g = e.geradas.find((x) => String(x.id) === gid);
    $$('[data-acao]', c).forEach((b) => {
      b.onclick = tenta(async () => {
        const a = b.dataset.acao;
        if (a === 'copiar') {
          try { await navigator.clipboard.writeText(g.prompt_pt); } catch { prompt('Copie o texto:', g.prompt_pt); }
          // Ângulo novo: todas as fotos reais (até 4) como referência; senão, a foto de origem.
          const refs = g.angulo ? e.originais.slice(0, 4) : e.originais.filter((o) => o.id === g.original_id);
          refs.forEach((o, i) => setTimeout(() => { const a2 = document.createElement('a'); a2.href = o.url; a2.download = `foto-${g.ordem}${refs.length > 1 ? '-ref' + (i + 1) : ''}.jpg`; document.body.append(a2); a2.click(); a2.remove(); }, i * 400));
          S.colarEm = gid;
          toast(`Texto copiado e ${refs.length > 1 ? refs.length + ' fotos baixadas' : 'foto baixada'}. Agora abra o Gemini, anexe e cole o texto.`);
          return;
        }
        if (a === 'refazer') {
          const instrucao = prompt('Refazer esta foto. Quer pedir algo? (opcional)\nEx.: mais luz no carro, menos reflexo, céu mais azul', g.instrucao || '');
          if (instrucao === null) return;
          S.ensaio = await api(`/ensaios/${e.id}/fotos/${gid}/refazer`, { metodo: 'POST', corpo: { instrucao } });
        } else S.ensaio = await api(`/ensaios/${e.id}/fotos/${gid}`, { metodo: 'PUT', corpo: { status: a } });
        desenharEnsaio();
      });
    });
    const m = $('[data-manual]', c);
    if (m) m.onchange = tenta(async (ev) => { const fd = new FormData(); fd.append('foto', ev.target.files[0]); S.ensaio = await api(`/ensaios/${e.id}/fotos/${gid}/manual`, { metodo: 'POST', form: fd }); desenharEnsaio(); });
  });
}

async function atualizar() {
  if (!location.hash.startsWith(`#/ensaio/${S.ensaio?.id}`)) return;
  try {
    const novo = await api(`/ensaios/${S.ensaio.id}`);
    const mudou = JSON.stringify([novo.geradas, novo.artes, novo.status]) !== JSON.stringify([S.ensaio.geradas, S.ensaio.artes, S.ensaio.status]);
    S.ensaio = novo;
    if (mudou && !document.activeElement?.closest('#fArte, #tPers')) desenharEnsaio();
    else S.timer = setTimeout(atualizar, 2500);
  } catch { S.timer = setTimeout(atualizar, 5000); }
}

/* ---------------- Gemini direto nesta página (Puter.js) ----------------
   A página gera as fotos com o Gemini (Nano Banana) pela conta Puter da pessoa (modelo "o usuário paga",
   com uso grátis mensal) e envia o resultado ao GiroAuto. Sem chave de API no servidor. */
const PU = { ativos: new Set(), rodando: false, precisaEntrar: false, erro: '', carregado: null };
const PUTER_MODELOS = ['gemini-3.1-flash-image', 'google/gemini-nano-banana-2.1', 'gemini-2.5-flash-image'];
function puterCarregar() {
  return (PU.carregado ||= new Promise((ok, falha) => {
    if (window.puter) return ok(window.puter);
    const sc = document.createElement('script');
    sc.src = 'https://js.puter.com/v2/';
    sc.onload = () => ok(window.puter);
    sc.onerror = () => { PU.carregado = null; falha(new Error('Não foi possível carregar o Puter. Confira a internet.')); };
    document.head.append(sc);
  }));
}
async function puterEntrar() {
  const puter = await puterCarregar();
  if (!puter.auth.isSignedIn()) await puter.auth.signIn();
  PU.precisaEntrar = !puter.auth.isSignedIn();
  return puter;
}
const puterMsg = (er) => {
  const m = String(er?.error?.message || er?.message || er?.error || er || '');
  if (/insufficient|funds|credit|limit|quota|upgrade|usage/i.test(m)) return 'O uso grátis da conta Puter acabou neste mês. Recarregue em puter.com (configurações > uso) ou use outra conta.';
  return m.slice(0, 200) || 'O Gemini não devolveu a imagem.';
};
async function puterGerarFoto(e, g) {
  const puter = await puterCarregar();
  const imgs = await Promise.all(g.refs.map(async (u) => (await fetch(u)).blob()));
  let ultimo;
  for (const model of PUTER_MODELOS) {
    try {
      const el = await puter.ai.txt2img(g.prompt_ia, { model, input_images: imgs });
      const blob = await (await fetch(el.src)).blob();
      const fd = new FormData(); fd.append('foto', blob, `foto-${g.ordem}.png`);
      return await api(`/ensaios/${e.id}/fotos/${g.id}/manual?origem=puter`, { metodo: 'POST', form: fd });
    } catch (er) {
      ultimo = er;
      if (/model|not found|unsupported|404/i.test(puterMsg(er)) && !/funds|credit|limit/i.test(puterMsg(er))) continue; // tenta o próximo modelo
      throw er;
    }
  }
  throw ultimo;
}
async function puterRodar() {
  if (PU.rodando) return;
  PU.rodando = true;
  try {
    const puter = await puterCarregar();
    if (!puter.auth.isSignedIn()) { const antes = PU.precisaEntrar; PU.precisaEntrar = true; if (!antes) desenharEnsaio(); return; }
    PU.precisaEntrar = false;
    for (;;) {
      const e = S.ensaio;
      if (!e || !location.hash.startsWith(`#/ensaio/${e.id}`)) break;
      const fila = e.geradas.filter((g) => g.status === 'navegador' && !PU.ativos.has(g.id)).slice(0, Math.max(0, 2 - PU.ativos.size));
      if (!fila.length && !PU.ativos.size) break;
      await Promise.race([
        ...fila.map(async (g) => {
          PU.ativos.add(g.id); desenharEnsaio();
          try { S.ensaio = await puterGerarFoto(e, g); }
          catch (er) {
            const msg = puterMsg(er);
            S.ensaio = await api(`/ensaios/${e.id}/fotos/${g.id}/erro`, { metodo: 'POST', corpo: { erro: msg } }).catch(() => S.ensaio);
            if (/acabou/.test(msg)) PU.erro = msg;
          } finally { PU.ativos.delete(g.id); }
          if (S.ensaio?.id === e.id) desenharEnsaio();
        }),
        new Promise((r) => setTimeout(r, fila.length ? 600000 : 1500)),
      ]);
      if (PU.erro) break;
    }
  } catch (er) { PU.erro = puterMsg(er); }
  finally { PU.rodando = false; }
}

// Colar (Ctrl+V) a imagem gerada no app: vai para a foto escolhida em "Copiar texto" ou para a primeira que aguarda imagem.
document.addEventListener('paste', tenta(async (ev) => {
  const e = S.ensaio;
  if (!e || !location.hash.startsWith(`#/ensaio/${e.id}`) || ev.target.closest('input, textarea')) return;
  const file = [...(ev.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
  if (!file) return;
  const alvo = e.geradas.find((g) => String(g.id) === String(S.colarEm) && g.status === 'manual') || e.geradas.find((g) => g.status === 'manual');
  if (!alvo) return toast('Nenhuma foto aguardando imagem neste ensaio.', true);
  ev.preventDefault();
  const fd = new FormData(); fd.append('foto', file, 'colada.png');
  toast(`Enviando a imagem colada para a foto ${alvo.ordem}…`);
  S.ensaio = await api(`/ensaios/${e.id}/fotos/${alvo.id}/manual`, { metodo: 'POST', form: fd });
  S.colarEm = null; desenharEnsaio();
}));

// Ampliar (com a original ao lado, para conferir a fidelidade)
document.addEventListener('click', (ev) => {
  const img = ev.target.closest('[data-zoom]');
  if (!img) return;
  const z = document.createElement('div');
  z.className = 'zoom';
  const orig = img.dataset.orig;
  z.innerHTML = `<div class="par ${orig ? '' : 'so'}">${orig ? `<div><img src="${orig}"><small>Original</small></div>` : ''}<div><img src="${img.dataset.zoom}"><small>${orig ? 'Gerada pela IA' : ''}</small></div></div>`;
  z.onclick = () => z.remove();
  document.body.append(z);
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') $('.zoom')?.remove(); });

/* ---------------- Configurações (administrador) ---------------- */
async function telaConfig() {
  moldura('<p class="carregando">Carregando…</p>');
  const c = await api('/config');
  $('#main').innerHTML = `<h1>Configurações do GiroAuto Fotos</h1>
  <div class="card"><h2>IA de imagem</h2>
    <p>Em uso: <b>${esc(S.sessao.provedor_nome)}</b>. O provedor, a chave do Google e o modelo são os mesmos do painel, em <a href="/#config">Configurações &gt; Imagens com IA</a>.</p>
    <p class="small muted">A nota de fidelidade usa a chave de IA de texto do painel (assistente) ou, sem ela, a mesma chave do Google.</p>
    <button id="bTestar">Testar a chave do Google</button> <span class="small muted" id="tRes"></span></div>
  <form class="card" id="fCfg"><h2>Limites</h2>
    <label class="check"><input type="checkbox" name="verificar" ${c.verificar ? 'checked' : ''}> Conferir cada foto gerada com a original (nota de fidelidade 0–10)</label>
    <div class="campos" style="margin-top:10px"><label>Imagens por loja/conta por dia<input name="limiteDiario" type="number" min="0" value="${c.limiteDiario}"></label>
      <label>Fotos geradas ao mesmo tempo<input name="simultaneas" type="number" min="1" max="4" value="${c.simultaneas}"></label></div>
    <button class="prim" style="margin-top:14px">Salvar</button>
    <p class="small muted">Versão ${esc(S.sessao.versao)}</p></form>`;
  $('#fCfg').onsubmit = tenta(async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    await api('/config', { metodo: 'PUT', corpo: { verificar: !!f.get('verificar'), limiteDiario: f.get('limiteDiario'), simultaneas: f.get('simultaneas') } });
    toast('Configurações salvas.');
  });
  $('#bTestar').onclick = tenta(async () => { $('#tRes').textContent = 'Testando…'; const r = await api('/config/testar', { metodo: 'POST' }); $('#tRes').textContent = `Chave aceita. Modelos de imagem: ${r.imagem.join(', ') || 'nenhum listado'}`; });
}

/* ---------------- Início ---------------- */
async function iniciar() {
  try { S.sessao = await api('/sessao'); } catch { return; }
  rota();
}
iniciar();
