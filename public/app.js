/* GiroAuto — painel da loja */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const brl2 = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const km = (n) => Number(n || 0).toLocaleString('pt-BR') + ' km';
  const intl = (n) => Number(n || 0).toLocaleString('pt-BR');
  const when = (iso) => {
    if (!iso) return '';
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const S = {
    me: null, vehicles: [], jobs: [], events: [], meta: null, assets: null, campaigns: [], ext: [],
    view: 'estoque', filtro: 'todos', busca: '', draft: null, pendingFiles: [], camp: null, pairCode: null,
  };

  /* ---------------- API ---------------- */
  async function api(method, url, body) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch { /* sem corpo */ }
    if (res.status === 401 && url !== '/api/auth/login') { showAuth(); }
    if (!res.ok) {
      const e = new Error(data?.error || `Erro ${res.status}`);
      e.status = res.status; e.data = data;
      throw e;
    }
    return data;
  }

  const manualMode = () => (S.me?.store?.pub_mode || 'manual') !== 'extensao';

  /* ---------------- Toast & modal ---------------- */
  let tt;
  function toast(m, ms = 3500) {
    const t = $('#toast'); t.textContent = m; t.hidden = false;
    clearTimeout(tt); tt = setTimeout(() => { t.hidden = true; }, ms);
  }
  function modal(html, wide) {
    $('#modalRoot').innerHTML = `<div class="scrim" id="scrim"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div></div>`;
    $$('[data-close]', $('#modalRoot')).forEach((b) => { b.onclick = closeModal; });
    $('#scrim').addEventListener('click', (e) => { if (e.target.id === 'scrim') closeModal(); });
    const f = $('#modalRoot button:not([disabled])'); f && f.focus();
  }
  function closeModal() { $('#modalRoot').innerHTML = ''; }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#scrim')) closeModal(); });
  function confirmBox(title, text, okLabel, onOk, danger) {
    modal(`<h3>${esc(title)}</h3><p>${text}</p><div class="err" id="mErr" hidden></div>
      <div class="modal-foot"><button class="btn" data-close type="button">Cancelar</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" id="mOk" type="button">${esc(okLabel)}</button></div>`);
    $('#mOk').onclick = async () => {
      const b = $('#mOk'); b.disabled = true;
      try { await onOk(); closeModal(); } catch (e) { $('#mErr').textContent = e.message; $('#mErr').hidden = false; b.disabled = false; }
    };
  }

  /* ---------------- Auth ---------------- */
  let authMode = 'login';
  function showAuth() { $('#app').hidden = true; $('#login').hidden = false; }
  $$('.auth-tabs button').forEach((b) => b.addEventListener('click', () => {
    authMode = b.dataset.mode;
    $$('.auth-tabs button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    $('#regFields').hidden = authMode !== 'register';
    $('#authBtn').textContent = authMode === 'login' ? 'Entrar' : 'Criar conta';
    $('#a-senha').autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
  }));
  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#authErr').hidden = true;
    const body = { email: $('#a-email').value, senha: $('#a-senha').value };
    if (authMode === 'register') Object.assign(body, { loja: $('#a-loja').value, nome: $('#a-nome').value });
    try {
      await api('POST', authMode === 'login' ? '/api/auth/login' : '/api/auth/register', body);
      await boot();
    } catch (err) { $('#authErr').textContent = err.message; $('#authErr').hidden = false; }
  });
  $('#logout').onclick = async () => { await api('POST', '/api/auth/logout').catch(() => {}); location.hash = ''; location.reload(); };

  /* ---------------- Boot & navegação ---------------- */
  async function boot() {
    try { S.me = await api('GET', '/api/me'); } catch { showAuth(); return; }
    $('#login').hidden = true; $('#app').hidden = false;
    $('#storeName').textContent = S.me.store.name;
    $('#userName').textContent = S.me.user.name;
    $('#appVersion').textContent = 'GiroAuto v' + String(S.me.version || '').replace(/\.0$/, '');
    await Promise.all([loadVehicles(), loadJobs(), loadMeta(), loadExt()]);
    if (S.jobs.some((j) => ['pendente', 'em_andamento'].includes(j.status))) watchJobs();
    route();
    setInterval(async () => { await Promise.all([loadVehicles(), loadJobs(), loadExt()]); if (['estoque', 'republicacao'].includes(S.view) && !$('#scrim')) render(); else counts(); }, 20000);
  }
  async function loadVehicles() { S.vehicles = await api('GET', '/api/vehicles'); }
  async function loadJobs() { S.jobs = await api('GET', '/api/jobs'); }
  async function loadEvents() { S.events = await api('GET', '/api/events'); }
  async function loadMeta() { S.meta = await api('GET', '/api/meta/status'); }
  /* ---- Conversa direta com a extensão do Chrome (sem abrir a extensão) ---- */
  function extSend(msg, timeout = 4000) {
    const id = S.me?.extension?.id;
    return new Promise((resolve) => {
      if (!id || !window.chrome || !chrome.runtime || !chrome.runtime.sendMessage) return resolve(null);
      const t = setTimeout(() => resolve(null), timeout);
      try {
        chrome.runtime.sendMessage(id, msg, (r) => { clearTimeout(t); void chrome.runtime.lastError; resolve(r || null); });
      } catch { clearTimeout(t); resolve(null); }
    });
  }
  let pairing = null;
  // Conecta a extensão a este painel sozinho, sem digitar código.
  async function extConnect() {
    const h = await extSend({ cmd: 'hello' });
    S.extInfo = h;
    if (!h) return null;
    if ((!h.paired || h.panelUrl !== location.origin) && !pairing) {
      pairing = (async () => {
        try {
          const { code } = await api('POST', '/api/extension/pair-code');
          const r = await extSend({ cmd: 'pair', code }, 10000);
          if (r?.ok) S.extInfo = await extSend({ cmd: 'hello' });
        } catch { /* tenta de novo na próxima */ }
        pairing = null;
      })();
      await pairing;
    }
    return S.extInfo;
  }
  async function loadExt() {
    S.ext = await api('GET', '/api/extension/status');
    if (!manualMode()) await extConnect(); else S.extInfo = await extSend({ cmd: 'hello' }, 1500);
    const h = S.extInfo;
    const ok = h && h.paired && h.panelUrl === location.origin;
    $('#extTitle').textContent = !h ? 'Extensão não instalada' : ok ? 'Extensão conectada' : 'Conectando a extensão…';
    $('#extSub').textContent = !h ? 'Veja Configurações' : ok ? `v${h.version}${h.busy ? ' · publicando agora' : ''}` : '';
    $('#extDot').style.background = ok ? 'var(--ok)' : 'var(--muted)';
    $('#extDot').style.boxShadow = ok ? '0 0 0 3px var(--ok-soft)' : 'none';
    $('#extBox').hidden = manualMode();
  }
  // Pede para a extensão começar agora. Se não estiver instalada, explica como instalar.
  async function extGo(okMsg) {
    const h = await extConnect();
    if (!h) { installModal(); return; }
    const r = await extSend({ cmd: 'pollNow' }, 8000);
    if (r?.ok && r.job) toast(okMsg, 5000);
    else if (r?.reason === 'ocupada') toast('A extensão está terminando outro anúncio. Este entra na fila.', 5000);
    else if (r?.reason === 'intervalo') toast(`Na fila. Para proteger a conta, o próximo anúncio sai em cerca de ${Math.ceil((r.wait_ms || 0) / 60000)} min.`, 6000);
    else if (r?.ok && !r.job) toast('Na fila. Limite diário atingido ou nada pendente.', 5000);
    else toast('Na fila. A extensão vai começar em até 1 minuto.', 5000);
    watchJobs();
  }
  let jobTimer = null;
  function watchJobs() {
    clearInterval(jobTimer);
    jobTimer = setInterval(async () => {
      const before = JSON.stringify(S.jobs.filter((j) => ['pendente', 'em_andamento'].includes(j.status)).map((j) => [j.id, j.status, j.note]));
      await loadJobs();
      const active = S.jobs.filter((j) => ['pendente', 'em_andamento'].includes(j.status));
      if (JSON.stringify(active.map((j) => [j.id, j.status, j.note])) !== before) {
        await loadVehicles();
        const done = S.jobs.find((j) => j.status === 'concluido' && Date.now() - new Date(j.updated_at.replace(' ', 'T') + 'Z') < 15000);
        if (done) toast(`${done.marca} ${done.modelo}: ${done.type === 'excluir' ? 'anúncio excluído' : 'publicado no Marketplace'}`, 5000);
        const failed = S.jobs.find((j) => j.status === 'falhou' && Date.now() - new Date(j.updated_at.replace(' ', 'T') + 'Z') < 15000);
        if (failed) toast(`${failed.marca} ${failed.modelo}: ${failed.error}`, 9000);
        if (!$('#scrim')) render();
      }
      if (!active.length) { clearInterval(jobTimer); jobTimer = null; }
    }, 3000);
  }
  function installModal() {
    modal(`<h3>Instale a extensão GiroAuto</h3>
      <p>Para publicar com um clique, a extensão precisa estar no Chrome deste computador. É uma vez só, leva 1 minuto.</p>
      <ol class="note" style="padding-left:18px;display:flex;flex-direction:column;gap:8px;margin:0">
        <li><a class="btn sm primary" href="/extensao.zip" download>Baixar extensão</a> e extraia o arquivo (botão direito &gt; <b>Extrair tudo</b>).</li>
        <li>Abra uma aba nova e cole o endereço <code>chrome://extensions</code> <button class="btn sm" type="button" id="cpExt">Copiar</button></li>
        <li>Ligue o <b>Modo do desenvolvedor</b> (canto superior direito).</li>
        <li>Clique em <b>Carregar sem compactação</b> e escolha a pasta <b>giroauto-extensao</b>.</li>
        <li>Volte aqui e recarregue a página (F5). A extensão se conecta sozinha.</li>
      </ol>
      <div class="modal-foot"><button class="btn" data-close type="button">Fechar</button></div>`);
    $('#cpExt').onclick = (e) => copyText('chrome://extensions', e.target);
  }
  async function loadCampaigns(refresh) { S.campaigns = await api('GET', '/api/campaigns' + (refresh ? '?refresh=1' : '')); }

  function route() {
    const h = location.hash.slice(1);
    const [name, query] = h.split('?');
    const params = new URLSearchParams(query || '');
    if (params.get('meta') === 'ok') toast('Conta do Facebook conectada. Escolha a conta de anúncios e a Página.');
    if (params.get('meta') === 'erro') toast('Não foi possível conectar: ' + (params.get('msg') || 'tente de novo'), 7000);
    if (params.get('meta') === 'cancelado') toast('Conexão com o Facebook cancelada.');
    if (name?.startsWith('editar-')) {
      if (!S.vehicles.some((x) => x.id === Number(name.slice(7)))) { loadVehicles().then(() => { if (S.vehicles.some((x) => x.id === Number(name.slice(7)))) route(); }); }
      const v = S.vehicles.find((x) => x.id === Number(name.slice(7)));
      if (v) { S.draft = draftFrom(v); S.pendingFiles = []; S.view = 'novo'; return render(); }
    }
    S.view = ['estoque', 'novo', 'republicacao', 'campanhas', 'config'].includes(name) ? name : 'estoque';
    if (S.view === 'novo' && !S.draft) { S.draft = blankDraft(); S.pendingFiles = []; }
    if (query) history.replaceState(null, '', '#' + name);
    render();
  }
  window.addEventListener('hashchange', route);
  $$('.nav button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.view === 'novo') { S.draft = blankDraft(); S.pendingFiles = []; }
    if (location.hash === '#' + b.dataset.view) route(); else location.hash = b.dataset.view;
  }));
  const go = (v) => { if (location.hash === '#' + v) route(); else location.hash = v; };

  function counts() {
    $('#c-estoque').textContent = S.vehicles.filter((v) => v.status !== 'vendido').length;
    const r = S.vehicles.filter((v) => v.pode_republicar).length;
    $('#c-org').textContent = r || ''; $('#c-org').hidden = !r;
    const a = S.campaigns.filter((c) => c.status === 'ativa').length;
    $('#c-camp').textContent = a || ''; $('#c-camp').hidden = !a;
    $$('.nav button').forEach((b) => { if (b.dataset.view === S.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  }

  async function render() {
    counts();
    const m = $('#main');
    try {
      if (S.view === 'estoque') m.innerHTML = viewEstoque();
      if (S.view === 'novo') m.innerHTML = viewVeiculo();
      if (S.view === 'republicacao') { await loadEvents(); m.innerHTML = viewRepublicacao(); }
      if (S.view === 'campanhas') { m.innerHTML = '<div class="loading">Carregando campanhas…</div>'; await Promise.all([loadMeta(), loadCampaigns()]); m.innerHTML = viewCampanhas(); }
      if (S.view === 'config') {
        m.innerHTML = '<div class="loading">Carregando…</div>';
        await Promise.all([loadMeta(), loadExt()]);
        if (S.meta.connected && !S.meta.expired && S.meta.configured) S.assets = await api('GET', '/api/meta/assets').catch((e) => ({ error: e.message }));
        S.metaApp = S.me.user.is_admin ? await api('GET', '/api/admin/meta-app').catch(() => null) : null;
        S.storage = S.me.user.is_admin ? await api('GET', '/api/admin/storage').catch(() => null) : null;
        m.innerHTML = viewConfig();
      }
    } catch (e) { m.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
    counts();
    bind();
  }

  /* ---------------- Peças visuais ---------------- */
  const CORES = { Prata: '#b9bec6', Branco: '#f2f2ef', Cinza: '#6c737d', Preto: '#2a2d33', Vermelho: '#b8322a', Verde: '#3e6b50', Azul: '#2e5591', Marrom: '#6b4a32', Bege: '#d8c7a5', Amarelo: '#e3c13b', Laranja: '#d9772b', Dourado: '#c8a24a', Vinho: '#6b1f2f' };
  function carSvg(cor) {
    const fill = CORES[cor] || '#9aa1ab';
    return `<svg viewBox="0 0 120 56" aria-hidden="true"><path d="M6 38 L12 27 Q16 21 27 20 L42 19 Q51 10 63 9.5 L79 9.5 Q90 10.5 98 19 L108 22 Q115 24 115 31 L115 38 Z" fill="${fill}" stroke="rgba(0,0,0,.35)" stroke-width="1"/><path d="M46 19 Q53 13 63 12.5 L70 12.5 L70 19 Z M73 12.5 L79 12.5 Q87 13.3 93 19 L73 19 Z" fill="rgba(200,220,240,.75)"/><circle cx="31" cy="39" r="8.5" fill="#22252b"/><circle cx="31" cy="39" r="3.5" fill="#9aa1ab"/><circle cx="92" cy="39" r="8.5" fill="#22252b"/><circle cx="92" cy="39" r="3.5" fill="#9aa1ab"/></svg>`;
  }
  function thumb(v) {
    const n = v.photos.length;
    return `<div class="thumb">${n ? `<img src="${esc(v.photos[0].url)}" alt="" loading="lazy">` : carSvg(v.cor)}${n ? `<span class="n">${n}</span>` : ''}</div>`;
  }
  function plate(p) {
    if (!p) return '';
    return `<span class="plate" title="Placa"><span class="band">BRASIL</span><span class="code">${esc(p)}</span></span>`;
  }
  const jobFor = (id) => S.jobs.find((j) => j.vehicle_id === id && ['pendente', 'em_andamento'].includes(j.status));
  const JOBNAME = { publicar: 'publicação', republicar: 'republicação', excluir: 'exclusão' };
  function statusPill(v) {
    const j = jobFor(v.id);
    if (j) return `<span class="pill ${j.note ? 'p-warn' : 'p-info'}" ${j.note ? `title="${esc(j.note)}"` : ''}>${j.note ? 'Precisa de você' : j.status === 'em_andamento' ? 'Publicando agora' : 'Na fila'}: ${JOBNAME[j.type]}</span>${j.note ? `<span class="sub" style="max-width:220px">${esc(j.note)}</span>` : ''}`;
    if (v.status === 'vendido') return '<span class="pill p-muted">Vendido</span>';
    if (v.status === 'rascunho') return '<span class="pill p-muted">Rascunho</span>';
    if (v.status === 'pronto') return '<span class="pill p-info">Pronto para publicar</span>';
    if (v.pode_republicar) return '<span class="pill p-warn">Republicar</span>';
    return '<span class="pill p-ok">No Marketplace</span>';
  }
  function since(v) {
    if (v.status !== 'publicado') return '';
    const d = v.dias_publicado;
    return `<span class="sub num">${d === 0 ? 'publicado hoje' : `há ${d} ${d === 1 ? 'dia' : 'dias'}`}</span>`;
  }

  /* ---------------- ESTOQUE ---------------- */
  function viewEstoque() {
    const V = S.vehicles;
    const pub = V.filter((v) => v.status === 'publicado').length;
    const rep = V.filter((v) => v.pode_republicar).length;
    const cat = V.filter((v) => v.catalogo && ['pronto', 'publicado'].includes(v.status)).length;
    const mes = new Date().toISOString().slice(0, 7);
    const vend = V.filter((v) => v.status === 'vendido' && (v.vendido_em || '').startsWith(mes)).length;
    const filtros = [['todos', 'Todos'], ['publicado', 'No Marketplace'], ['republicar', 'Para republicar'], ['pronto', 'Prontos'], ['rascunho', 'Rascunhos'], ['vendido', 'Vendidos']];
    let list = V.filter((v) => S.filtro === 'todos' ? true : S.filtro === 'republicar' ? v.pode_republicar : v.status === S.filtro);
    if (S.busca) { const q = S.busca.toLowerCase(); list = list.filter((v) => `${v.marca} ${v.modelo} ${v.versao} ${v.placa}`.toLowerCase().includes(q)); }
    const empty = !V.length
      ? `<div class="empty"><p style="margin:0 0 12px">Nenhum veículo cadastrado ainda.</p><button class="btn primary" data-go="novo" type="button">Cadastrar o primeiro veículo</button></div>`
      : '<div class="empty">Nenhum veículo neste filtro.</div>';
    return `
    <div class="head">
      <div><h1>Estoque</h1><p>Cada veículo é cadastrado uma vez e publicado no Marketplace pela extensão ou enviado ao catálogo de campanhas.</p></div>
      <button class="btn primary" data-go="novo" type="button">+ Novo veículo</button>
    </div>
    ${manualMode() && S.extInfo ? `<div class="infobox conn-row"><span>A extensão GiroAuto está instalada neste Chrome. Quer publicar e republicar com um clique?</span><button class="btn primary" id="enableAuto" type="button">Ativar publicação automática</button></div>` : ''}
    <div class="strip">
      <div><span class="k">No Marketplace</span><span class="v">${pub}</span></div>
      <div><span class="k">Para republicar</span><span class="v ${rep ? 'alert' : ''}">${rep}</span></div>
      <div><span class="k">No catálogo</span><span class="v">${cat}</span></div>
      <div><span class="k">Vendidos no mês</span><span class="v">${vend}</span></div>
    </div>
    <div class="toolbar">
      <div class="chips">${filtros.map(([k, l]) => `<button class="chip" type="button" data-filtro="${k}" aria-pressed="${S.filtro === k}">${l}</button>`).join('')}</div>
      <input class="search" id="busca" type="search" placeholder="Buscar modelo ou placa" value="${esc(S.busca)}" aria-label="Buscar">
    </div>
    <div class="list">${list.length ? list.map(rowHtml).join('') : empty}</div>`;
  }
  function rowHtml(v) {
    const diff = v.fipe ? v.preco - v.fipe : null;
    const busy = !!jobFor(v.id);
    let acts = '';
    if (v.status === 'publicado') acts += `<button class="btn sm ${v.pode_republicar ? 'primary' : ''}" data-act="republicar" data-id="${v.id}" type="button" ${busy ? 'disabled' : ''}>Republicar</button>`;
    if (v.status === 'pronto' && v.organico) acts += `<button class="btn sm primary" data-act="publicar" data-id="${v.id}" type="button" ${busy ? 'disabled' : ''}>Publicar</button>`;
    if (v.status === 'rascunho') acts += `<button class="btn sm" data-act="editar" data-id="${v.id}" type="button">Completar cadastro</button>`;
    if (v.status !== 'vendido' && v.status !== 'rascunho') acts += `<button class="btn sm" data-act="editar" data-id="${v.id}" type="button">Editar</button><button class="btn sm danger" data-act="vendido" data-id="${v.id}" type="button">Vendido</button>`;
    if (v.status === 'rascunho') acts += `<button class="btn sm ghost danger" data-act="excluir" data-id="${v.id}" type="button">Excluir</button>`;
    return `<div class="row ${v.status === 'vendido' ? 'sold' : ''}">
      ${thumb(v)}
      <div style="min-width:0">
        <div class="title">${esc(v.marca)} ${esc(v.modelo)} <span class="sub">${esc(v.versao)}</span></div>
        <div class="meta-line">${plate(v.placa)}<span class="sub num">${esc(v.ano_fab || '?')}/${esc(v.ano_modelo || '?')} · ${km(v.km)}${v.cambio ? ' · ' + esc(v.cambio) : ''}</span></div>
        <div class="meta-line"><span class="chan"><i class="${v.organico ? 'on' : ''}">ORGÂNICO</i><i class="${v.catalogo ? 'on' : ''}">CATÁLOGO</i></span>
        ${v.fb_listing_url && v.status === 'publicado' ? `<a class="link sub" href="${esc(v.fb_listing_url)}" target="_blank" rel="noopener">Ver anúncio</a>` : ''}</div>
      </div>
      <div class="c-price"><div class="price">${brl(v.preco)}</div>${diff !== null ? `<div class="sub num">FIPE ${brl(v.fipe)} · ${diff < 0 ? '' : '+'}${brl(diff)}</div>` : ''}</div>
      <div class="state">${statusPill(v)}${since(v)}</div>
      <div class="actions">${acts}</div>
    </div>`;
  }

  async function act(a, id) {
    const v = S.vehicles.find((x) => x.id === id);
    if (a === 'editar') { location.hash = 'editar-' + id; return; }
    if ((a === 'publicar' || a === 'republicar') && manualMode()) return assistant(v, a);
    if (a === 'publicar') {
      try { await api('POST', `/api/vehicles/${id}/publish`); await loadJobs(); render(); await extGo('Publicando no Marketplace. Acompanhe na aba do Facebook.'); }
      catch (e) { toast(e.message, 6000); }
      await loadJobs(); await loadVehicles(); return render();
    }
    if (a === 'republicar') {
      try { await api('POST', `/api/vehicles/${id}/republish`); await loadJobs(); render(); await extGo('Republicando: a extensão exclui o anúncio antigo e publica de novo.'); }
      catch (e) {
        if (e.status === 409 && /dia/.test(e.message)) {
          return confirmBox('Republicar agora?', `${esc(e.message)}<br><br>O ideal é aguardar.`, 'Republicar mesmo assim', async () => {
            await api('POST', `/api/vehicles/${id}/republish`, { force: true });
            await loadJobs(); render();
            extGo('Republicando: a extensão exclui o anúncio antigo e publica de novo.');
          });
        }
        toast(e.message, 6000);
      }
      await loadJobs(); return render();
    }
    if (a === 'vendido') {
      return confirmBox('Marcar como vendido?', `${esc(v.marca)} ${esc(v.modelo)} ${esc(v.versao)}<br><br>${v.status === 'publicado' ? 'A extensão vai excluir o anúncio do Marketplace. ' : ''}O veículo sai do catálogo na próxima sincronização.`, 'Marcar vendido', async () => {
        const r = await api('POST', `/api/vehicles/${id}/sold`);
        await Promise.all([loadVehicles(), loadJobs()]);
        if (!manualMode() && v.status === 'publicado') extGo('A extensão está excluindo o anúncio do Marketplace.');
        render();
        if (r.excluir_manual) {
          modal(`<h3>Exclua o anúncio no Facebook</h3><p>O veículo foi marcado como vendido no painel. Agora retire o anúncio do Marketplace para não receber mais mensagens sobre ele.</p>
            <div class="btnrow"><a class="btn primary" href="${esc(r.listing_url || FB_SELLING)}" target="_blank" rel="noopener">${r.listing_url ? 'Abrir o anúncio' : 'Abrir Seus anúncios'}</a></div>
            <p class="note">No anúncio, toque em <b>…</b> e depois em <b>Excluir anúncio</b> (ou em <b>Marcar como vendido</b>).</p>
            ${r.campanhas_ativas?.length ? `<div class="warnbox">Ele também aparece na campanha: <b>${r.campanhas_ativas.map((c) => esc(c.name)).join(', ')}</b>. Pause a campanha ou crie outra sem ele.</div>` : ''}
            <div class="modal-foot"><button class="btn" data-close type="button">Pronto</button></div>`);
          return;
        }
        if (r.campanhas_ativas?.length) {
          setTimeout(() => modal(`<h3>Campanha ainda ativa</h3><p>Este veículo aparece em: <b>${r.campanhas_ativas.map((c) => esc(c.name)).join(', ')}</b>. Pause a campanha ou crie outra sem ele.</p><div class="modal-foot"><button class="btn" data-close type="button">Depois</button><button class="btn primary" id="toCamp" type="button">Ir para campanhas</button></div>`), 50);
          setTimeout(() => { const b = $('#toCamp'); if (b) b.onclick = () => { closeModal(); go('campanhas'); }; }, 80);
        } else toast('Veículo marcado como vendido');
      });
    }
    if (a === 'excluir') {
      return confirmBox('Excluir rascunho?', `${esc(v.marca)} ${esc(v.modelo)} será apagado com as fotos.`, 'Excluir', async () => {
        await api('DELETE', `/api/vehicles/${id}`); await loadVehicles(); render(); toast('Rascunho excluído');
      }, true);
    }
  }

  /* ---------------- VEÍCULO (novo/editar) ---------------- */
  function blankDraft() {
    return { id: null, marca: '', modelo: '', versao: '', ano_fab: '', ano_modelo: '', km: '', preco: '', fipe: '', placa: '', cor: '', cor_interna: 'Preto', cambio: '', combustivel: 'Flex', carroceria: '', descricao: '', organico: true, catalogo: false, photos: [], status: 'rascunho' };
  }
  function draftFrom(v) { return { ...blankDraft(), ...v, km: v.km || '', preco: v.preco || '', fipe: v.fipe || '', ano_fab: v.ano_fab || '', ano_modelo: v.ano_modelo || '', photos: [...v.photos] }; }
  function viewVeiculo() {
    const d = S.draft; const o = S.me.options;
    const sel = (id, opts, val, empty = 'Selecione') => `<select id="${id}"><option value="">${empty}</option>${opts.map((x) => `<option ${x === val ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
    const inp = (k, label, ph, extra = '', cls = '') => `<div class="f ${cls}"><label for="v-${k}">${label}</label><input id="v-${k}" value="${esc(d[k])}" placeholder="${ph}" ${extra}></div>`;
    return `
    <div class="head"><div><h1>${d.id ? 'Editar veículo' : 'Novo veículo'}</h1><p>Os campos seguem o formulário de veículos do Marketplace, para a extensão preencher tudo sem ajustes.</p></div></div>
    <div class="grid2">
      <div class="panel">
        <h2>Dados do veículo</h2>
        <div class="fields">
          ${inp('marca', 'Marca', 'Chevrolet')}${inp('modelo', 'Modelo', 'Onix')}${inp('versao', 'Versão', 'LT 1.0 Turbo')}
          ${inp('ano_fab', 'Ano de fabricação', '2021', 'inputmode="numeric" maxlength="4"')}${inp('ano_modelo', 'Ano do modelo', '2022', 'inputmode="numeric" maxlength="4"')}${inp('km', 'Quilometragem', '48200', 'inputmode="numeric"')}
          <div class="f"><label for="v-cambio">Câmbio</label>${sel('v-cambio', o.cambios, d.cambio)}</div>
          <div class="f"><label for="v-combustivel">Combustível</label>${sel('v-combustivel', o.combustiveis, d.combustivel)}</div>
          <div class="f"><label for="v-carroceria">Carroceria</label>${sel('v-carroceria', o.carrocerias, d.carroceria)}</div>
          <div class="f"><label for="v-cor">Cor externa</label>${sel('v-cor', o.cores, d.cor)}</div>
          <div class="f"><label for="v-cor_interna">Cor interna</label>${sel('v-cor_interna', o.cores, d.cor_interna)}</div>
          ${inp('placa', 'Placa', 'ABC1D23', 'maxlength="7" style="text-transform:uppercase"')}
          <div class="f"></div>
          ${inp('preco', 'Preço de venda (R$)', '74900', 'inputmode="numeric"', 'w3')}${inp('fipe', 'Referência FIPE (R$)', '77320', 'inputmode="numeric"', 'w3')}
          <div class="f w6"><label for="v-descricao">Descrição do anúncio</label><textarea id="v-descricao" placeholder="Opcionais, revisões, estado de conservação, condições de pagamento">${esc(d.descricao)}</textarea>
            <div><button class="btn sm" id="gerarDesc" type="button">Gerar descrição a partir dos dados</button></div></div>
        </div>
      </div>
      <div class="stack">
        <div class="panel">
          <h2>Fotos</h2>
          <p class="lead">Até 20 fotos em JPG, PNG ou WEBP. A primeira é a capa do anúncio.</p>
          <label class="drop" id="drop" for="v-fotos"><b>Arraste as fotos aqui</b><br>ou toque para escolher no aparelho<input id="v-fotos" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden></label>
          <div class="photos" id="photos">${photosHtml()}</div>
        </div>
        <div class="panel">
          <h2>Onde anunciar</h2>
          <div class="checks">
            <label class="check"><input type="checkbox" id="v-organico" ${d.organico ? 'checked' : ''}><div><b>Anúncio orgânico no Marketplace</b><span>A extensão publica pela sua conta do Facebook. Sem custo.</span></div></label>
            <label class="check"><input type="checkbox" id="v-catalogo" ${d.catalogo ? 'checked' : ''}><div><b>Catálogo para campanhas</b><span>Entra no feed do catálogo Meta e pode ser usado em anúncios pagos.</span></div></label>
          </div>
        </div>
      </div>
    </div>
    <div class="err" id="vErr" hidden></div>
    <div class="form-foot">
      <button class="btn ghost" data-go="estoque" type="button">Cancelar</button>
      <button class="btn" id="salvar" type="button">Salvar</button>
      ${d.status === 'publicado' || d.status === 'vendido' ? '' : '<button class="btn primary" id="salvarPub" type="button">Salvar e publicar no Marketplace</button>'}
    </div>`;
  }
  function photosHtml() {
    const d = S.draft;
    const saved = d.photos.map((p, i) => `<div class="ph ${i === 0 ? 'cover' : ''}"><img src="${esc(p.url)}" alt="Foto ${i + 1}">${i === 0 ? '<span class="tag">CAPA</span>' : ''}<div class="tools">${i ? `<button type="button" data-cover="${p.id}">Capa</button>` : '<span></span>'}<button type="button" data-rm="${p.id}">Remover</button></div></div>`);
    const pend = S.pendingFiles.map((f, i) => `<div class="ph ${!d.photos.length && i === 0 ? 'cover' : ''}"><img src="${f.preview}" alt="">${!d.photos.length && i === 0 ? '<span class="tag">CAPA</span>' : ''}<div class="tools"><span class="pend" style="color:#fff">não salva</span><button type="button" data-rmp="${i}">Remover</button></div></div>`);
    return saved.concat(pend).join('');
  }
  function readDraft() {
    const d = S.draft;
    ['marca', 'modelo', 'versao', 'ano_fab', 'ano_modelo', 'km', 'preco', 'fipe', 'placa', 'cambio', 'combustivel', 'carroceria', 'cor', 'cor_interna', 'descricao'].forEach((k) => { d[k] = $('#v-' + k).value; });
    d.organico = $('#v-organico').checked; d.catalogo = $('#v-catalogo').checked;
  }
  function addFiles(files) {
    readDraft();
    const room = 20 - S.draft.photos.length - S.pendingFiles.length;
    const ok = [...files].filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type) && f.size <= 12 * 1024 * 1024);
    if (ok.length < files.length) toast('Algumas fotos foram ignoradas: use JPG, PNG ou WEBP de até 12 MB.');
    ok.slice(0, Math.max(0, room)).forEach((f) => S.pendingFiles.push({ file: f, preview: URL.createObjectURL(f) }));
    if (ok.length > room) toast('Limite de 20 fotos por veículo.');
    $('#photos').innerHTML = photosHtml(); bindPhotos();
  }
  function bindPhotos() {
    $$('[data-rmp]').forEach((b) => { b.onclick = () => { S.pendingFiles.splice(Number(b.dataset.rmp), 1); $('#photos').innerHTML = photosHtml(); bindPhotos(); }; });
    $$('[data-cover]').forEach((b) => {
      b.onclick = async () => {
        const id = Number(b.dataset.cover);
        const ids = [id, ...S.draft.photos.map((p) => p.id).filter((x) => x !== id)];
        try { const v = await api('PUT', `/api/vehicles/${S.draft.id}/photos/order`, { ids }); S.draft.photos = v.photos; $('#photos').innerHTML = photosHtml(); bindPhotos(); }
        catch (e) { toast(e.message); }
      };
    });
    $$('[data-rm]').forEach((b) => {
      b.onclick = async () => {
        try { const v = await api('DELETE', `/api/vehicles/${S.draft.id}/photos/${b.dataset.rm}`); S.draft.photos = v.photos; $('#photos').innerHTML = photosHtml(); bindPhotos(); }
        catch (e) { toast(e.message); }
      };
    });
  }
  async function saveVehicle(publish) {
    readDraft();
    const d = S.draft;
    const err = $('#vErr'); err.hidden = true;
    const btns = $$('#salvar, #salvarPub'); btns.forEach((b) => { b.disabled = true; });
    try {
      const body = { ...d }; delete body.photos;
      let v = d.id ? await api('PUT', `/api/vehicles/${d.id}`, body) : await api('POST', '/api/vehicles', body);
      d.id = v.id;
      if (S.pendingFiles.length) {
        const fd = new FormData();
        S.pendingFiles.forEach((p) => fd.append('fotos', p.file, p.file.name));
        v = await api('POST', `/api/vehicles/${v.id}/photos`, fd);
        S.pendingFiles = [];
        d.photos = v.photos;
      }
      if (v.status === 'rascunho') v = await api('POST', `/api/vehicles/${v.id}/ready`).catch(() => v);
      if (publish) {
        if (!d.organico) throw new Error('Marque "Anúncio orgânico no Marketplace" para publicar.');
        if (manualMode()) {
          await Promise.all([loadVehicles(), loadJobs()]);
          S.draft = null; go('estoque');
          const fresh = S.vehicles.find((x) => x.id === v.id);
          if (v.status !== 'pronto' && v.status !== 'publicado') { toast('Complete os dados obrigatórios e adicione fotos para publicar.', 6000); return; }
          setTimeout(() => assistant(fresh, 'publicar'), 120);
          return;
        }
        await api('POST', `/api/vehicles/${v.id}/publish`);
        toast('Salvo e enviado para a extensão publicar.');
      } else toast(v.status === 'rascunho' ? 'Salvo como rascunho. Complete os dados para publicar.' : 'Veículo salvo');
      await Promise.all([loadVehicles(), loadJobs()]);
      S.draft = null;
      go('estoque');
    } catch (e) {
      err.textContent = e.message; err.hidden = false;
      d.photos = S.vehicles.find((x) => x.id === d.id)?.photos || d.photos;
      btns.forEach((b) => { b.disabled = false; });
    }
  }
  function gerarDescricao() {
    readDraft(); const d = S.draft;
    const loja = S.me.store;
    const linhas = [
      `${d.marca} ${d.modelo} ${d.versao} ${d.ano_fab || ''}${d.ano_modelo ? '/' + d.ano_modelo : ''}`.replace(/\s+/g, ' ').trim(),
      '',
      d.km ? `✔ ${intl(String(d.km).replace(/\D/g, ''))} km rodados` : '',
      d.cambio ? `✔ Câmbio ${d.cambio.toLowerCase()}` : '',
      d.combustivel ? `✔ ${d.combustivel}` : '',
      d.cor ? `✔ Cor ${d.cor.toLowerCase()}` : '',
      '',
      'Aceitamos seu usado na troca e facilitamos o financiamento.',
      `${loja.name}${loja.city ? ' · ' + loja.city + (loja.state ? '/' + loja.state : '') : ''}. Chame para agendar uma visita ou test drive.`,
    ];
    const txt = linhas.filter((l, i, a) => l || (a[i - 1] && a[i - 1] !== '')).join('\n').trim();
    $('#v-descricao').value = txt; d.descricao = txt;
  }

  /* ---------------- REPUBLICAÇÃO ---------------- */
  function viewRepublicacao() {
    const days = S.me.republish_days;
    const pub = S.vehicles.filter((v) => v.status === 'publicado').sort((a, b) => b.dias_publicado - a.dias_publicado);
    const rep = pub.filter((v) => v.pode_republicar && !jobFor(v.id));
    const fila = S.jobs.filter((j) => ['pendente', 'em_andamento'].includes(j.status));
    const recentes = S.jobs.filter((j) => ['falhou'].includes(j.status)).slice(0, 5);
    return `
    <div class="head">
      <div><h1>Republicação</h1><p>${manualMode()
    ? 'Anúncios antigos perdem alcance. O assistente guia você para excluir o anúncio antigo e publicar de novo, com os dados prontos para copiar.'
    : 'Anúncios antigos perdem alcance. A extensão exclui o anúncio e publica de novo com os mesmos dados e fotos. Nenhum anúncio sai sem você clicar em Publicar no Facebook.'}</p></div>
      ${manualMode() ? '' : `<button class="btn primary" id="repTodos" type="button" ${rep.length ? '' : 'disabled'}>Republicar ${rep.length} liberado${rep.length === 1 ? '' : 's'}</button>`}
    </div>
    ${!manualMode() && !S.ext.length ? `<div class="infobox">A extensão ainda não foi pareada. Instale a extensão no Chrome e use o código gerado em <a class="link" href="#config">Configurações</a>.</div>` : ''}
    <div class="panel" style="padding:0;gap:0" ${manualMode() ? 'hidden' : ''}>
      <div style="padding:16px 16px 6px"><h2>Fila da extensão</h2><p class="note" style="margin-top:4px">A extensão busca tarefas a cada minuto enquanto o Chrome estiver aberto. Ela espera de 3 a 5 minutos entre um anúncio e outro.</p></div>
      ${fila.length ? fila.map((j) => `<div class="qrow">
        <div style="min-width:0"><div class="title">${esc(j.marca)} ${esc(j.modelo)}</div><div class="sub">${esc(j.versao)}</div></div>
        <div class="q-bar"><span class="pill ${j.status === 'em_andamento' ? 'p-info' : 'p-muted'}">${j.status === 'em_andamento' ? 'Em andamento' : 'Aguardando'}: ${JOBNAME[j.type]}</span></div>
        <div class="q-when sub">${when(j.created_at)}</div>
        <div><button class="btn sm ghost" data-cancel="${j.id}" type="button">Cancelar</button></div></div>`).join('') : '<div class="empty">Nenhuma tarefa na fila.</div>'}
    </div>
    ${recentes.length ? `<div class="panel"><h2>Não concluídas</h2>${recentes.map((j) => `<div class="err"><b>${esc(j.marca)} ${esc(j.modelo)}</b> (${JOBNAME[j.type]}): ${esc(j.error || 'sem detalhes')}</div>`).join('')}</div>` : ''}
    <div class="panel" style="padding:0;gap:0">
      <div style="padding:16px 16px 6px"><h2>Anúncios no Marketplace</h2><p class="note" style="margin-top:4px">Republicação liberada a cada ${days} dias por anúncio, para reduzir o risco de a conta ser marcada como spam.</p></div>
      ${pub.length ? pub.map((v) => {
        const pct = Math.min(100, v.dias_publicado / days * 100); const ok = v.pode_republicar;
        return `<div class="qrow">
          <div style="min-width:0"><div class="title">${esc(v.marca)} ${esc(v.modelo)}</div><div class="sub">${esc(v.versao)} · ${brl(v.preco)}</div></div>
          <div class="q-bar"><div class="bar ${ok ? 'ready' : ''}"><i style="width:${pct}%"></i></div></div>
          <div class="q-when sub num">${ok ? `publicado há ${v.dias_publicado} dias` : `liberado em ${days - v.dias_publicado} ${days - v.dias_publicado === 1 ? 'dia' : 'dias'}`}</div>
          <div><button class="btn sm ${ok ? 'primary' : ''}" data-act="republicar" data-id="${v.id}" type="button" ${jobFor(v.id) ? 'disabled' : ''}>Republicar</button></div>
        </div>`;
      }).join('') : '<div class="empty">Nenhum anúncio publicado.</div>'}
    </div>
    <div class="panel"><h2>Histórico</h2>
      <div class="log">${S.events.length ? S.events.map((l) => `<div><time>${when(l.created_at)}</time><span>${esc(l.message)}</span></div>`).join('') : '<span class="muted">Sem eventos ainda.</span>'}</div>
    </div>`;
  }
  async function republicarTodos() {
    const rep = S.vehicles.filter((v) => v.pode_republicar && !jobFor(v.id));
    let ok = 0;
    for (const v of rep) { try { await api('POST', `/api/vehicles/${v.id}/republish`); ok++; } catch { /* ignora */ } }
    toast(`${ok} republicaç${ok === 1 ? 'ão enviada' : 'ões enviadas'} para a extensão`);
    await loadJobs(); render();
  }

  /* ---------------- Assistente de publicação (sem extensão) ---------------- */
  const FB_CREATE = 'https://www.facebook.com/marketplace/create/vehicle';
  const FB_SELLING = 'https://www.facebook.com/marketplace/you/selling';
  const FB_BODY = { Hatch: 'Hatchback', 'Sedã': 'Sedã', SUV: 'SUV', Picape: 'Picape', Minivan: 'Minivan', Perua: 'Perua', 'Cupê': 'Cupê', 'Conversível': 'Conversível', Van: 'Van', Outro: 'Outro' };
  const FB_FUEL = { Flex: 'Flex', Gasolina: 'Gasolina', Etanol: 'Flex', Diesel: 'Diesel', 'Elétrico': 'Elétrico', 'Híbrido': 'Híbrido', GNV: 'Outro' };
  const FB_TRANS = { 'Automático': 'Transmissão automática', Manual: 'Transmissão manual', CVT: 'Transmissão automática', Automatizado: 'Transmissão automática' };

  async function copyText(text, btn) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch { /* sem cópia */ } ta.remove();
    }
    if (btn) { btn.textContent = 'Copiado'; btn.classList.add('copied'); setTimeout(() => { btn.textContent = 'Copiar'; btn.classList.remove('copied'); }, 1800); }
  }

  async function sharePhotos(v, btn) {
    btn.disabled = true; btn.textContent = 'Preparando…';
    try {
      const files = await Promise.all(v.photos.map(async (p, i) => {
        const b = await (await fetch(p.url)).blob();
        return new File([b], `${String(i + 1).padStart(2, '0')}.${(b.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`, { type: b.type || 'image/jpeg' });
      }));
      await navigator.share({ files, title: `${v.marca} ${v.modelo}` });
    } catch (e) { if (e.name !== 'AbortError') toast('Não foi possível compartilhar. Use "Baixar fotos".'); }
    btn.disabled = false; btn.textContent = 'Salvar fotos no celular';
  }

  function assistant(v, mode) {
    const repub = mode === 'republicar';
    const canShare = !!(navigator.canShare && navigator.share && /Android|iPhone|iPad/i.test(navigator.userAgent));
    const modelo = `${v.modelo} ${v.versao || ''}`.trim();
    const fields = [
      ['Tipo de veículo', 'Carro/picape', 'escolha'],
      ['Ano', String(v.ano_modelo || v.ano_fab || ''), 'escolha'],
      ['Fabricante', v.marca, 'escolha'],
      ['Modelo', modelo, 'copiar'],
      ['Quilometragem', String(v.km || 0), 'copiar'],
      ['Preço', String(v.preco || ''), 'copiar'],
      v.carroceria && ['Estilo da carroceria', FB_BODY[v.carroceria] || v.carroceria, 'escolha'],
      v.cor && ['Cor externa', v.cor, 'escolha'],
      v.cor_interna && ['Cor interna', v.cor_interna, 'escolha'],
      ['Condição do veículo', 'Bom', 'escolha'],
      v.combustivel && ['Tipo de combustível', FB_FUEL[v.combustivel] || v.combustivel, 'escolha'],
      v.cambio && ['Transmissão', FB_TRANS[v.cambio] || v.cambio, 'escolha'],
      ['Descrição', v.descricao || `${v.titulo}`, 'copiar'],
    ].filter(Boolean);
    const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    let n = 0;
    const step = (title, body) => `<div class="astep"><span class="n">${++n}</span><div><h4>${title}</h4>${body}</div></div>`;
    const deleteStep = repub ? step('Exclua o anúncio antigo', `<p>Assim o Facebook não vê o mesmo carro anunciado duas vezes.</p>
          <div class="btnrow"><a class="btn" href="${esc(v.fb_listing_url || FB_SELLING)}" target="_blank" rel="noopener">${v.fb_listing_url ? 'Abrir o anúncio antigo' : 'Abrir Seus anúncios'}</a></div>
          <p class="note" style="margin-top:6px">Toque em <b>…</b> e depois em <b>Excluir anúncio</b>.</p>`) : '';
    let bmReady = false; try { bmReady = localStorage.getItem('giroBm') === '1'; } catch { /* sem armazenamento */ }
    const autoHtml = mobile ? '' : `
      ${step('Instale o botão de preenchimento (uma vez só)', `<p>Arraste o botão abaixo para a <b>barra de favoritos</b> do navegador. Se a barra não aparece, aperte <b>Ctrl+Shift+B</b>.</p>
        <div class="btnrow" style="align-items:center"><a class="btn bm" id="bmLink" href="#" draggable="true">★ GiroAuto Preencher</a>
        <label class="inline-check" style="font-size:13px"><input type="checkbox" id="bmOk" ${bmReady ? 'checked' : ''}> Já está nos meus favoritos</label></div>`)}
      ${step('Abra o Facebook com o veículo escolhido', `<p>O GiroAuto separa este veículo e abre o formulário do Marketplace numa aba nova.</p>
        <div class="btnrow"><button class="btn primary" id="aAuto" type="button">Preencher automaticamente</button></div>`)}
      ${step('Na aba do Facebook, clique no favorito', `<p>Clique em <b>★ GiroAuto Preencher</b> e depois em <b>Buscar dados no GiroAuto</b>. Os campos, as listas e as fotos são preenchidos sozinhos. Confira e clique em <b>Avançar</b> e <b>Publicar</b>. O GiroAuto registra a publicação automaticamente.</p>
        <div class="infobox" id="aWait" hidden>Aguardando a publicação no Facebook… esta janela fecha sozinha quando o anúncio for registrado.</div>`)}`;
    const manualSteps = () => `
        ${step(`Salve as ${v.photos.length} fotos`, `<p>${canShare ? 'No celular, salve as fotos na galeria para escolher no Facebook.' : 'Baixe o arquivo, clique com o botão direito nele e escolha <b>Extrair tudo</b>.'}</p>
          <div class="btnrow">${canShare ? '<button class="btn" id="aShare" type="button">Salvar fotos no celular</button>' : ''}
          <a class="btn" href="/api/vehicles/${v.id}/photos.zip" download>Baixar fotos (.zip)</a></div>`)}
        ${step('Abra o formulário do Marketplace', `<p>Abre numa aba nova, já na opção de veículo. Adicione as fotos na ordem (01 é a capa).</p>
          <div class="btnrow"><a class="btn ${mobile ? 'primary' : ''}" href="${FB_CREATE}" target="_blank" rel="noopener">Abrir Marketplace</a></div>`)}
        ${step('Preencha os campos', `<p>Copie e cole os campos de texto. Nos de lista, escolha a opção indicada.</p>
          <div class="cfields">${fields.map(([k, val, how], i) => `<div class="cf"><span class="k">${esc(k)}</span><span class="v ${k === 'Descrição' ? 'long' : ''}">${esc(val)}</span>
            ${how === 'copiar' ? `<button class="btn sm" type="button" data-copy="${i}">Copiar</button>` : '<span class="how">escolha na lista</span>'}</div>`).join('')}</div>`)}
        ${step('Publique e registre aqui', `<p>Depois de publicar no Facebook, cole o link do anúncio (opcional) e confirme.</p>
          <div class="f w6"><label for="aLink">Link do anúncio</label><input id="aLink" placeholder="https://www.facebook.com/marketplace/item/..." inputmode="url"></div>`)}`;
    let manualHtml;
    if (mobile) manualHtml = manualSteps();
    else { n = repub ? 1 : 0; manualHtml = `<details class="manual"><summary>Prefiro preencher à mão</summary><div class="asst" style="margin-top:12px">${manualSteps()}</div></details>`; }
    modal(`<h3>${repub ? 'Republicar' : 'Publicar'} ${esc(v.marca)} ${esc(v.modelo)}</h3>
      <div class="asst">${deleteStep}${autoHtml}${manualHtml}</div>
      <div class="err" id="aErr" hidden></div>
      <div class="modal-foot"><button class="btn" data-close type="button">Fechar</button><button class="btn ${mobile ? 'primary' : ''}" id="aDone" type="button">Já publiquei</button></div>`, true);
    $$('[data-copy]').forEach((b) => { b.onclick = () => copyText(fields[Number(b.dataset.copy)][1], b); });
    const sh = $('#aShare'); if (sh) sh.onclick = () => sharePhotos(v, sh);
    let poll = null;
    const stopPoll = () => { clearInterval(poll); poll = null; };
    const done = async (fromPoll) => {
      closeModal(); await loadVehicles(); render();
      toast(repub ? 'Republicação registrada' : 'Publicação registrada' + (fromPoll ? ' automaticamente' : ''));
    };
    $('#aDone').onclick = async () => {
      const b = $('#aDone'); b.disabled = true; $('#aErr').hidden = true;
      try { await api('POST', `/api/vehicles/${v.id}/mark-published`, { listing_url: ($('#aLink')?.value || '').trim() }); stopPoll(); done(false); }
      catch (e) { $('#aErr').textContent = e.message; $('#aErr').hidden = false; b.disabled = false; }
    };
    if (mobile) return;
    setupBookmarklet();
    const ok = $('#bmOk'); ok.onchange = () => { try { localStorage.setItem('giroBm', ok.checked ? '1' : '0'); } catch { /* sem armazenamento */ } };
    $('#aAuto').onclick = async () => {
      const b = $('#aAuto'); $('#aErr').hidden = true;
      try {
        await api('POST', '/api/assist/start', { vehicle_id: v.id });
        window.open(FB_CREATE, '_blank', 'noopener');
        b.textContent = 'Abrir o Facebook de novo';
        $('#aWait').hidden = false;
        const before = v.publicado_em || '';
        stopPoll();
        poll = setInterval(async () => {
          if (!$('#aWait')) return stopPoll();
          try {
            const cur = await api('GET', `/api/vehicles/${v.id}`);
            if (cur.status === 'publicado' && (cur.publicado_em || '') !== before) { stopPoll(); done(true); }
          } catch { /* tenta de novo */ }
        }, 4000);
      } catch (e) { $('#aErr').textContent = e.message; $('#aErr').hidden = false; }
    };
  }

  let bmCode = null;
  async function setupBookmarklet() {
    const a = $('#bmLink'); if (!a) return;
    try {
      if (!bmCode) bmCode = (await (await fetch('/bookmarklet.js')).text()).trim().replace('__GIRO_ORIGIN__', location.origin).replace('__GIRO_VERSION__', String(S.me.version || ''));
      a.href = 'javascript:' + encodeURIComponent(bmCode);
    } catch { a.removeAttribute('href'); }
    a.onclick = (e) => { e.preventDefault(); toast('Arraste este botão para a barra de favoritos. Ele funciona na página do Facebook.', 5000); };
  }

  /* ---------------- CAMPANHAS ---------------- */
  const MODES = {
    whatsapp: { t: 'Conversas no WhatsApp', d: 'O cliente toca no anúncio e abre uma conversa com a loja no WhatsApp.' },
    messenger: { t: 'Conversas no Messenger', d: 'Abre uma conversa com a Página no Messenger.' },
    catalogo: { t: 'Catálogo dinâmico', d: 'Usa o catálogo de veículos e leva para a página do carro na sua vitrine.' },
  };
  const CSTATUS = {
    criando: ['p-info', 'Criando'], analise: ['p-info', 'Em análise'], ativa: ['p-ok', 'Ativa'], pausada: ['p-warn', 'Pausada'],
    encerrada: ['p-muted', 'Encerrada'], erro: ['p-bad', 'Erro'], reprovada: ['p-bad', 'Reprovada'],
  };
  function blankCamp() {
    const mes = new Date().toLocaleDateString('pt-BR', { month: 'long' });
    return {
      name: `Estoque · ${mes}`, mode: 'whatsapp', daily_budget: 20, days: 7, radius_km: 40, age_min: 21, age_max: 65,
      city_key: '', city_name: '', message: '', vehicle_ids: [], activate: true,
      audience_mode: 'advantage', genders: '', interests: [], placements: 'auto',
      positions: ['fb_feed', 'fb_marketplace', 'fb_story', 'ig_feed', 'ig_story', 'ig_explore'], start_date: '', reach: null,
    };
  }
  function viewCampanhas() {
    const m = S.meta;
    let setup = '';
    if (!m.configured) setup = S.me.user.is_admin
      ? `<div class="infobox conn-row"><span>Para criar campanhas, configure primeiro o app da Meta da plataforma.</span><a class="btn primary" href="#config">Configurar agora</a></div>`
      : `<div class="infobox">As campanhas ainda não foram liberadas pelo administrador do GiroAuto.</div>`;
    else if (!m.connected) setup = `<div class="infobox conn-row"><span>Conecte a conta do Facebook da loja para criar campanhas no Facebook e no Instagram.</span><a class="btn primary" href="/api/meta/connect">Conectar Facebook</a></div>`;
    else if (m.expired) setup = `<div class="err conn-row"><span>A conexão com o Facebook expirou.</span><a class="btn primary" href="/api/meta/connect">Conectar de novo</a></div>`;
    else if (!m.ready) setup = `<div class="infobox conn-row"><span>Escolha a conta de anúncios e a Página da loja.</span><a class="btn primary" href="#config">Abrir configurações</a></div>`;
    const canCreate = m.configured && m.connected && !m.expired && m.ready;
    const spend = S.campaigns.reduce((s, c) => s + (c.stats?.spend || 0), 0);
    const conv = S.campaigns.reduce((s, c) => s + (c.stats?.conversations || 0), 0);
    return `
    <div class="head">
      <div><h1>Campanhas</h1><p>Anúncios pagos no Facebook (feed, Marketplace e stories) e no Instagram, criados direto na conta de anúncios da loja.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="refreshStats" type="button" ${S.campaigns.some((c) => c.meta_campaign_id) ? '' : 'disabled'}>Atualizar métricas</button>
        <button class="btn primary" id="novaCamp" type="button" ${canCreate ? '' : 'disabled'}>+ Nova campanha</button>
      </div>
    </div>
    ${setup}
    ${canCreate ? `<div class="grid2">
      <div class="panel">
        <h2>Conta de anúncios</h2>
        <div class="kv" style="grid-template-columns:repeat(2,minmax(0,1fr))">
          <div><span class="k">Conta</span><span class="v">${esc(m.ad_account_name || m.ad_account_id)}</span></div>
          <div><span class="k">Página</span><span class="v">${esc(m.page_name)}</span></div>
          <div><span class="k">Instagram</span><span class="v">${m.ig_username ? '@' + esc(m.ig_username) : '<span class="muted">não vinculado</span>'}</span></div>
          <div><span class="k">WhatsApp</span><span class="v">${m.whatsapp_number ? esc(m.whatsapp_number) : '<span class="muted">não informado</span>'}</span></div>
          <div><span class="k">Gasto total</span><span class="v num">${brl2(spend)}</span></div>
          <div><span class="k">Conversas iniciadas</span><span class="v num">${intl(conv)}</span></div>
        </div>
      </div>
      <div class="panel">
        <h2>Catálogo de veículos</h2>
        ${m.catalog_id ? `<p class="lead">A Meta lê o feed a cada hora. Veículos vendidos saem na sincronização seguinte.</p>
          <div class="feed"><code id="feedUrl">${esc(m.feed_url)}</code><button class="btn sm" id="copyFeed" type="button">Copiar</button></div>
          <div class="kv"><div><span class="k">Veículos no feed</span><span class="v">${m.feed_items}</span></div>
          <div><span class="k">Última sincronização</span><span class="v">${m.catalog_synced_at ? when(m.catalog_synced_at) : '—'}</span></div>
          <div><span class="k">&nbsp;</span><button class="btn sm" id="syncCat" type="button">Sincronizar agora</button></div></div>`
        : `<p class="lead">Necessário só para o modo Catálogo dinâmico. Cria um catálogo de veículos no seu portfólio empresarial, alimentado pelo estoque.</p>
          ${m.business_id ? '<div><button class="btn" id="setupCat" type="button">Criar catálogo de veículos</button></div>' : '<p class="note">Escolha o portfólio empresarial em <a class="link" href="#config">Configurações</a> para criar o catálogo.</p>'}`}
      </div>
    </div>` : ''}
    <div id="campForm">${S.camp ? campFormHtml() : ''}</div>
    <div class="panel">
      <h2>Campanhas</h2>
      ${S.campaigns.length ? `<div class="tbl-wrap"><table>
        <thead><tr><th>Campanha</th><th>Status</th><th class="r">Diário</th><th class="r">Período</th><th class="r">Impressões</th><th class="r">Cliques</th><th class="r">Conversas</th><th class="r">Gasto</th><th></th></tr></thead>
        <tbody>${S.campaigns.map(campRow).join('')}</tbody></table></div>` : '<div class="empty">Nenhuma campanha criada ainda.</div>'}
    </div>`;
  }
  function campRow(c) {
    const [cls, label] = CSTATUS[c.status] || ['p-muted', c.status];
    const s = c.stats || {};
    const btns = [];
    if (c.status === 'pausada') btns.push(`<button class="btn sm" data-camp="activate" data-id="${c.id}" type="button">Ativar</button>`);
    if (['ativa', 'analise'].includes(c.status)) btns.push(`<button class="btn sm" data-camp="pause" data-id="${c.id}" type="button">Pausar</button>`);
    if (['ativa', 'pausada', 'analise', 'reprovada'].includes(c.status)) btns.push(`<button class="btn sm ghost" data-camp="end" data-id="${c.id}" type="button">Encerrar</button>`);
    if (c.status === 'erro') btns.push(`<button class="btn sm" data-camp="retry" data-id="${c.id}" type="button">Tentar de novo</button><button class="btn sm ghost danger" data-camp="delete" data-id="${c.id}" type="button">Excluir</button>`);
    if (c.ads_manager_url) btns.push(`<a class="link sub" href="${esc(c.ads_manager_url)}" target="_blank" rel="noopener">Gerenciador</a>`);
    const start = new Date(c.start_time); const end = new Date(c.end_time);
    const fmt = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return `<tr>
      <td><b>${esc(c.name)}</b><div class="sub">${esc(MODES[c.mode]?.t || c.mode)} · ${esc(c.city_name)} + ${c.radius_km} km · ${c.vehicle_ids.length} veículo${c.vehicle_ids.length === 1 ? '' : 's'}</div>
        ${c.error ? `<div class="sub" style="color:var(--bad)">${esc(c.error)}</div>` : ''}</td>
      <td><span class="pill ${cls}">${label}</span></td>
      <td class="r">${brl2(c.daily_budget)}</td><td class="r">${fmt(start)}–${fmt(end)}</td>
      <td class="r">${s.impressions != null ? intl(s.impressions) : '—'}</td><td class="r">${s.clicks != null ? intl(s.clicks) : '—'}</td>
      <td class="r">${s.conversations != null ? intl(s.conversations) : '—'}</td><td class="r">${s.spend != null ? brl2(s.spend) : '—'}</td>
      <td class="r"><div class="actions">${btns.join('')}</div></td></tr>`;
  }
  function campVehicles() {
    const c = S.camp;
    return S.vehicles.filter((v) => ['pronto', 'publicado'].includes(v.status) && (c.mode !== 'catalogo' || v.catalogo));
  }
  const PLC = { fb_feed: 'Feed do Facebook', fb_marketplace: 'Marketplace', fb_story: 'Stories do Facebook', fb_reels: 'Reels do Facebook',
    ig_feed: 'Feed do Instagram', ig_story: 'Stories do Instagram', ig_explore: 'Explorar do Instagram', ig_reels: 'Reels do Instagram' };
  const fmtN = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  function reachHtml(r) {
    if (!r) return '<span class="sub">Escolha a cidade para ver o alcance estimado.</span>';
    if (r.loading) return '<span class="sub">Calculando o alcance estimado…</span>';
    if (r.error) return `<span class="sub">Alcance estimado indisponível: ${esc(r.error)}</span>`;
    if (!r.lower && !r.upper) return '<span class="sub">A Meta não informou o alcance para este público.</span>';
    const small = (r.upper || r.lower) < 5000;
    return `<b>Público estimado: ${fmtN(r.lower)} a ${fmtN(r.upper)} pessoas</b> na região escolhida.${small ? ' <span class="sub">Público pequeno: amplie o raio ou tire interesses para a Meta entregar melhor.</span>' : ''}`;
  }
  function campAudienceBody(c) {
    return { city_key: c.city_key, city_name: c.city_name, radius_km: c.radius_km, age_min: c.age_min, age_max: c.age_max,
      audience_mode: c.audience_mode, genders: c.genders, interests: c.interests, placements: c.placements, positions: c.positions };
  }
  let reachTimer;
  function updateReach() {
    const c = S.camp; if (!c || !c.city_key) return;
    clearTimeout(reachTimer);
    reachTimer = setTimeout(async () => {
      readCamp();
      c.reach = { loading: true }; const box = $('#c-reach'); if (box) box.innerHTML = reachHtml(c.reach);
      try { c.reach = await api('POST', '/api/meta/reach', campAudienceBody(c)); }
      catch (e) { c.reach = { error: e.message.replace(/^A Meta recusou o pedido: /, '') }; }
      const b2 = $('#c-reach'); if (b2) b2.innerHTML = reachHtml(c.reach);
    }, 600);
  }
  function campFormHtml() {
    const c = S.camp;
    const vs = campVehicles();
    const sel = vs.filter((v) => c.vehicle_ids.includes(v.id));
    const first = sel[0];
    const total = (Number(String(c.daily_budget).replace(',', '.')) || 0) * (Number(c.days) || 0);
    return `<div class="panel">
      <h2>Nova campanha</h2>
      <div class="grid2">
        <div class="stack" style="gap:14px">
          <div class="seg" role="radiogroup" aria-label="Tipo de campanha">${Object.entries(MODES).map(([k, m]) => `<label><input type="radio" name="c-mode" value="${k}" ${c.mode === k ? 'checked' : ''} ${k === 'catalogo' && !S.meta.catalog_id ? 'disabled' : ''}><b>${m.t}</b><span>${k === 'catalogo' && !S.meta.catalog_id ? 'Crie o catálogo primeiro.' : m.d}</span></label>`).join('')}</div>
          <div class="fields">
            <div class="f w6"><label for="c-name">Nome</label><input id="c-name" value="${esc(c.name)}"></div>
            <div class="f w6 ta"><label for="c-city">Cidade</label><input id="c-city" value="${esc(c.city_name)}" placeholder="Digite a cidade da loja" autocomplete="off"><ul id="cityList" hidden></ul></div>
            <div class="f"><label for="c-radius">Raio (km)</label><input id="c-radius" inputmode="numeric" value="${c.radius_km}"><span class="hint">De 17 a 80 km</span></div>
            <div class="f"><label for="c-daily">Orçamento diário (R$)</label><input id="c-daily" inputmode="decimal" value="${c.daily_budget}"></div>
            <div class="f"><label for="c-days">Duração (dias)</label><input id="c-days" inputmode="numeric" value="${c.days}"></div>
            <div class="f"><label for="c-start">Início</label><input id="c-start" type="date" value="${esc(c.start_date)}" min="${new Date().toISOString().slice(0, 10)}"><span class="hint">Vazio = começa agora</span></div>
          </div>
          <div><span class="lbl">Público</span>
            <div class="seg" style="margin-top:6px">
              <label><input type="radio" name="c-aud" value="advantage" ${c.audience_mode === 'advantage' ? 'checked' : ''}><b>Automático (Advantage+)</b><span>Recomendado pela Meta. Ela encontra quem tem mais chance de comprar, dentro da sua cidade e raio.</span></label>
              <label><input type="radio" name="c-aud" value="manual" ${c.audience_mode === 'manual' ? 'checked' : ''}><b>Personalizado</b><span>Você escolhe idade, gênero e interesses.</span></label>
            </div>
          </div>
          <div class="fields">
            <div class="f w1"><label for="c-agemin">Idade mín.</label><input id="c-agemin" inputmode="numeric" value="${c.age_min}"></div>
            ${c.audience_mode === 'manual' ? `<div class="f w1"><label for="c-agemax">Idade máx.</label><input id="c-agemax" inputmode="numeric" value="${c.age_max}"></div>
            <div class="f"><label for="c-gender">Gênero</label><select id="c-gender"><option value="" ${!c.genders ? 'selected' : ''}>Todos</option><option value="1" ${c.genders === '1' ? 'selected' : ''}>Homens</option><option value="2" ${c.genders === '2' ? 'selected' : ''}>Mulheres</option></select></div>`
              : '<div class="f w3"><span class="hint" style="margin-top:22px">No automático, a idade mínima vai até 25 anos; a Meta ajusta o resto.</span></div>'}
          </div>
          ${c.audience_mode === 'manual' ? `<div class="ta"><span class="lbl">Interesses</span>
            <div class="chips" style="margin:6px 0">${c.interests.map((i, k) => `<button class="chip" aria-pressed="true" type="button" data-rmint="${k}" title="Remover">${esc(i.name)} ×</button>`).join('') || '<span class="sub">Nenhum interesse: o anúncio aparece para todos na região.</span>'}</div>
            <div class="f w6"><input id="c-int" placeholder="Buscar interesse (ex.: carros usados, automóveis, financiamento)" autocomplete="off"><ul id="intList" hidden></ul></div>
            <div class="chips" style="margin-top:6px"><span class="sub">Sugestões:</span>${['Automóveis', 'Carros usados', 'Concessionária', 'Picapes', 'SUV'].map((q) => `<button class="chip" type="button" data-sugint="${q}">+ ${q}</button>`).join('')}</div>
          </div>` : ''}
          <div><span class="lbl">Onde o anúncio aparece</span>
            <div class="seg" style="margin-top:6px">
              <label><input type="radio" name="c-plc" value="auto" ${c.placements === 'auto' ? 'checked' : ''}><b>Automático</b><span>A Meta distribui entre Facebook, Instagram, Marketplace, Stories e Reels onde o resultado for melhor.</span></label>
              <label><input type="radio" name="c-plc" value="manual" ${c.placements === 'manual' ? 'checked' : ''}><b>Escolher</b><span>Só nos lugares marcados.</span></label>
            </div>
            ${c.placements === 'manual' ? `<div class="chips" style="margin-top:8px">${Object.entries(PLC).map(([k, l]) => `<label class="chip" style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" data-plc="${k}" ${c.positions.includes(k) ? 'checked' : ''}>${l}</label>`).join('')}</div>` : ''}
          </div>
          <div class="infobox" id="c-reach">${reachHtml(c.reach)}</div>
          <div class="fields">
            <div class="f w6"><label for="c-msg">Texto do anúncio</label><textarea id="c-msg" style="min-height:70px" placeholder="Seminovos revisados na ${esc(S.me.store.name)}. Chame e agende seu test drive.">${esc(c.message)}</textarea></div>
          </div>
          <div><span class="lbl">Veículos ${c.mode === 'catalogo' ? '(marcados para o catálogo)' : '(até 10, em carrossel)'}</span>
            <div class="pick" style="margin-top:6px">${vs.length ? vs.map((v) => `<label><input type="checkbox" data-cv="${v.id}" ${c.vehicle_ids.includes(v.id) ? 'checked' : ''} ${!v.photos.length ? 'disabled' : ''}>${esc(v.marca)} ${esc(v.modelo)} ${esc(v.versao)}<span class="sub num">${v.photos.length ? brl(v.preco) : 'sem foto'}</span></label>`).join('') : '<span class="sub">Nenhum veículo disponível para este tipo de campanha.</span>'}</div>
          </div>
          <div class="total"><span>Investimento máximo</span><span class="price num" id="c-total">${brl2(total)}</span></div>
          <label class="inline-check"><input type="checkbox" id="c-activate" ${c.activate ? 'checked' : ''}> Ativar assim que a Meta aprovar</label>
          <p class="note">Desmarcado, a campanha é criada pausada para você revisar no Gerenciador de Anúncios. A cobrança é feita pela Meta na forma de pagamento da conta de anúncios.</p>
          <div class="err" id="cErr" hidden></div>
          <div class="form-foot"><button class="btn ghost" id="cancCamp" type="button">Cancelar</button><button class="btn primary" id="criarCamp" type="button" ${sel.length && c.city_key ? '' : 'disabled'}>Criar campanha</button></div>
        </div>
        <div class="stack" style="gap:8px;max-width:280px;width:100%;justify-self:center">
          <span class="lbl">Prévia</span>
          <div class="mk">
            <div class="img">${first?.photos[0] ? `<img src="${esc(first.photos[0].url)}" alt="">` : carSvg('')}</div>
            <div class="body">
              <span class="spons">Patrocinado · ${esc(S.meta.page_name || '')}</span>
              <span class="t">${first ? esc(`${first.ano_modelo || ''} ${first.marca} ${first.modelo} ${first.versao}`) : 'Selecione um veículo'}</span>
              <span class="p num">${first ? brl(first.preco) : ''}</span>
              <span class="s">${first ? km(first.km) : ''}</span>
            </div>
          </div>
          ${sel.length > 1 ? `<span class="sub">Carrossel com ${sel.length} veículos</span>` : ''}
          <span class="sub">${c.placements === 'auto' ? 'A Meta distribui entre Facebook, Instagram, Marketplace, Stories e Reels' : 'Aparece em: ' + (c.positions.map((k) => PLC[k]).join(', ') || 'nenhum lugar marcado')}.</span>
        </div>
      </div>
    </div>`;
  }
  function readCamp() {
    const c = S.camp; if (!c || !$('#c-name')) return;
    c.name = $('#c-name').value; c.radius_km = $('#c-radius').value; c.age_min = $('#c-agemin').value;
    if ($('#c-agemax')) c.age_max = $('#c-agemax').value;
    if ($('#c-gender')) c.genders = $('#c-gender').value;
    c.start_date = $('#c-start').value;
    const au = $('input[name="c-aud"]:checked'); if (au) c.audience_mode = au.value;
    const pl = $('input[name="c-plc"]:checked'); if (pl) c.placements = pl.value;
    if ($$('[data-plc]').length) c.positions = $$('[data-plc]').filter((x) => x.checked).map((x) => x.dataset.plc);
    c.daily_budget = $('#c-daily').value; c.days = $('#c-days').value; c.message = $('#c-msg').value; c.activate = $('#c-activate').checked;
    const m = $('input[name="c-mode"]:checked'); if (m) c.mode = m.value;
  }
  function refreshCampForm() { readCamp(); $('#campForm').innerHTML = campFormHtml(); bindCamp(); }
  let cityTimer;
  function bindCamp() {
    if (!S.camp) return;
    const upd = () => { readCamp(); const t = (Number(String(S.camp.daily_budget).replace(',', '.')) || 0) * (Number(S.camp.days) || 0); $('#c-total').textContent = brl2(t); };
    ['c-daily', 'c-days'].forEach((id) => $('#' + id).addEventListener('input', upd));
    $$('input[name="c-mode"]').forEach((r) => r.addEventListener('change', () => {
      readCamp();
      const ok = new Set(campVehicles().map((v) => v.id));
      S.camp.vehicle_ids = S.camp.vehicle_ids.filter((id) => ok.has(id));
      refreshCampForm();
    }));
    $$('[data-cv]').forEach((cb) => cb.addEventListener('change', () => {
      const id = Number(cb.dataset.cv); const a = S.camp.vehicle_ids;
      if (cb.checked) a.push(id); else a.splice(a.indexOf(id), 1);
      refreshCampForm();
    }));
    $$('input[name="c-aud"], input[name="c-plc"]').forEach((r) => r.addEventListener('change', () => { refreshCampForm(); updateReach(); }));
    $$('[data-plc], #c-gender').forEach((x) => x.addEventListener('change', () => { readCamp(); updateReach(); }));
    ['c-radius', 'c-agemin', 'c-agemax'].forEach((id) => { const el = $('#' + id); if (el) el.addEventListener('change', updateReach); });
    $$('[data-rmint]').forEach((b) => { b.onclick = () => { readCamp(); S.camp.interests.splice(Number(b.dataset.rmint), 1); refreshCampForm(); updateReach(); }; });
    const addInterest = (i) => { readCamp(); if (!S.camp.interests.some((x) => x.id === i.id)) S.camp.interests.push(i); refreshCampForm(); updateReach(); };
    $$('[data-sugint]').forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        try { const r = await api('GET', '/api/meta/interests?q=' + encodeURIComponent(b.dataset.sugint)); if (r[0]) addInterest({ id: r[0].id, name: r[0].name }); else toast('A Meta não encontrou esse interesse.'); }
        catch (e) { toast(e.message, 6000); b.disabled = false; }
      };
    });
    const ii = $('#c-int'); const il = $('#intList'); let intTimer;
    if (ii) ii.addEventListener('input', () => {
      clearTimeout(intTimer);
      if (ii.value.trim().length < 2) { il.hidden = true; return; }
      intTimer = setTimeout(async () => {
        try {
          const r = await api('GET', '/api/meta/interests?q=' + encodeURIComponent(ii.value.trim()));
          il.innerHTML = r.length ? r.map((x, k) => `<li><button type="button" data-ipick="${k}">${esc(x.name)} <span class="sub">${x.size ? fmtN(x.size) + ' pessoas' : ''} ${esc(x.path)}</span></button></li>`).join('') : '<li class="sub" style="padding:7px 10px">Nada encontrado</li>';
          il.hidden = false;
          $$('[data-ipick]', il).forEach((b) => { b.onclick = () => addInterest({ id: r[Number(b.dataset.ipick)].id, name: r[Number(b.dataset.ipick)].name }); });
        } catch (e) { il.innerHTML = `<li class="sub" style="padding:7px 10px">${esc(e.message)}</li>`; il.hidden = false; }
      }, 300);
    });
    const city = $('#c-city'); const list = $('#cityList');
    city.addEventListener('input', () => {
      S.camp.city_key = ''; S.camp.city_name = city.value;
      $('#criarCamp').disabled = true;
      clearTimeout(cityTimer);
      if (city.value.trim().length < 2) { list.hidden = true; return; }
      cityTimer = setTimeout(async () => {
        try {
          const r = await api('GET', '/api/meta/cities?q=' + encodeURIComponent(city.value.trim()));
          list.innerHTML = r.length ? r.map((x) => `<li><button type="button" data-key="${esc(x.key)}" data-name="${esc(x.name + (x.region ? ', ' + x.region : ''))}">${esc(x.name)} <span class="sub">${esc(x.region)}</span></button></li>`).join('') : '<li class="sub" style="padding:7px 10px">Nenhuma cidade encontrada</li>';
          list.hidden = false;
          $$('button', list).forEach((b) => { b.onclick = () => { S.camp.city_key = b.dataset.key; S.camp.city_name = b.dataset.name; refreshCampForm(); updateReach(); }; });
        } catch (e) { list.innerHTML = `<li class="sub" style="padding:7px 10px">${esc(e.message)}</li>`; list.hidden = false; }
      }, 300);
    });
    $('#cancCamp').onclick = () => { S.camp = null; $('#campForm').innerHTML = ''; };
    $('#criarCamp').onclick = () => {
      readCamp();
      const c = S.camp;
      const total = (Number(String(c.daily_budget).replace(',', '.')) || 0) * (Number(c.days) || 0);
      confirmBox(c.activate ? 'Criar e ativar campanha?' : 'Criar campanha pausada?',
        `<b>${esc(c.name)}</b><br>${esc(MODES[c.mode].t)} · ${c.vehicle_ids.length} veículo(s) · ${esc(c.city_name)} + ${esc(c.radius_km)} km<br><br>Investimento de até <b>${brl2(total)}</b> (${brl2(Number(String(c.daily_budget).replace(',', '.')))} por dia, ${esc(c.days)} dias), cobrado pela Meta na conta ${esc(S.meta.ad_account_name || S.meta.ad_account_id)}.`,
        c.activate ? 'Criar e ativar' : 'Criar pausada',
        async () => {
          try {
            await api('POST', '/api/campaigns', { ...c, vehicle_ids: c.vehicle_ids });
            S.camp = null;
            toast(c.activate ? 'Campanha criada e enviada para análise da Meta' : 'Campanha criada pausada');
          } finally { await loadCampaigns(); render(); }
        });
    };
  }
  async function campAction(action, id) {
    const c = S.campaigns.find((x) => x.id === id);
    const run = async () => {
      if (action === 'delete') await api('DELETE', `/api/campaigns/${id}`);
      else await api('POST', `/api/campaigns/${id}/${action}`, action === 'retry' ? { activate: true } : undefined);
      await loadCampaigns(); render();
    };
    if (action === 'end') return confirmBox('Encerrar campanha?', `${esc(c.name)} para de veicular e é arquivada na Meta. Não dá para reativar depois.`, 'Encerrar', run, true);
    if (action === 'activate') return confirmBox('Ativar campanha?', `${esc(c.name)} volta a veicular com ${brl2(c.daily_budget)} por dia.`, 'Ativar', run);
    try { await run(); toast(action === 'pause' ? 'Campanha pausada' : 'Feito'); } catch (e) { toast(e.message, 7000); await loadCampaigns(); render(); }
  }

  /* ---------------- CONFIGURAÇÕES ---------------- */
  function viewConfig() {
    const s = S.me.store; const m = S.meta; const a = S.assets || {};
    const opt = (list, val, label) => `<option value="">Selecione</option>${(list || []).map((x) => `<option value="${esc(x.id)}" ${x.id === val ? 'selected' : ''}>${esc(label(x))}</option>`).join('')}`;
    let metaHtml;
    if (!m.configured) metaHtml = S.me.user.is_admin
      ? `<p class="lead">Antes de conectar, o GiroAuto precisa de um app da Meta. É uma configuração única para toda a plataforma.</p><div><a class="btn primary" href="#config-meta" id="goMetaApp">Configurar o app da Meta</a></div>`
      : `<div class="infobox">A conexão com o Facebook ainda não foi liberada pelo administrador do GiroAuto.</div>`;
    else if (!m.connected || m.expired) metaHtml = `<p class="lead">Use a conta do Facebook que administra a Página da loja e a conta de anúncios. O GiroAuto não vê nem guarda sua senha.</p>${m.expired ? '<div class="err">A conexão expirou.</div>' : ''}<div><a class="btn primary" href="/api/meta/connect">Conectar Facebook</a></div>`;
    else metaHtml = `
      <div class="okbox">Conectado como <b>${esc(m.user)}</b>${m.expires_at ? ` · válido até ${new Date(m.expires_at).toLocaleDateString('pt-BR')}` : ''}</div>
      ${a.error ? `<div class="err">${esc(a.error)}</div>` : ''}
      <div class="fields">
        <div class="f w3"><label for="m-acc">Conta de anúncios</label><select id="m-acc">${opt(a.ad_accounts, m.ad_account_id, (x) => `${x.name} (${x.currency})${x.active ? '' : ' · inativa'}`)}</select></div>
        <div class="f w3"><label for="m-page">Página do Facebook</label><select id="m-page">${opt(a.pages, m.page_id, (x) => x.name + (x.ig_username ? ` · @${x.ig_username}` : ' · sem Instagram'))}</select></div>
        <div class="f w3"><label for="m-biz">Portfólio empresarial</label><select id="m-biz">${opt(a.businesses, m.business_id, (x) => x.name)}</select><span class="hint">Necessário para o catálogo</span></div>
        <div class="f w3"><label for="m-wa">WhatsApp da loja</label><input id="m-wa" value="${esc(m.whatsapp_number || s.whatsapp)}" placeholder="5544999990000" inputmode="tel"><span class="hint">Com DDI e DDD. Deve estar vinculado à Página.</span></div>
      </div>
      <div class="err" id="mErr2" hidden></div>
      <div class="form-foot"><button class="btn ghost danger" id="mDisc" type="button">Desconectar</button><a class="btn" href="/api/meta/connect">Reconectar</a><button class="btn primary" id="mSave" type="button">Salvar</button></div>`;
    const pair = S.pairCode;
    return `
    <div class="head"><div><h1>Configurações</h1><p>Dados da loja, extensão do Chrome e conexão com o Facebook e o Instagram.</p></div></div>
    <div class="grid2">
      <div class="stack">
        <div class="panel">
          <h2>Facebook e Instagram</h2>
          ${metaHtml}
        </div>
        <div class="panel">
          <h2>Loja</h2>
          <div class="fields">
            <div class="f w6"><label for="s-name">Nome da loja</label><input id="s-name" value="${esc(s.name)}"></div>
            <div class="f w3"><label for="s-phone">Telefone</label><input id="s-phone" value="${esc(s.phone)}" inputmode="tel"></div>
            <div class="f w3"><label for="s-wa">WhatsApp</label><input id="s-wa" value="${esc(s.whatsapp)}" inputmode="tel" placeholder="5544999990000"></div>
            <div class="f w6"><label for="s-addr">Endereço</label><input id="s-addr" value="${esc(s.address)}"></div>
            <div class="f w3"><label for="s-city">Cidade</label><input id="s-city" value="${esc(s.city)}"></div>
            <div class="f w1"><label for="s-uf">UF</label><input id="s-uf" value="${esc(s.state)}" maxlength="2" style="text-transform:uppercase"></div>
            <div class="f"><label for="s-cep">CEP</label><input id="s-cep" value="${esc(s.postal_code)}" inputmode="numeric"></div>
          </div>
          <p class="note">Vitrine pública: <a class="link" href="${esc(S.me.vitrine_url)}" target="_blank" rel="noopener">${esc(S.me.vitrine_url)}</a></p>
          <div class="form-foot"><button class="btn primary" id="sSave" type="button">Salvar loja</button></div>
        </div>
      </div>
      <div class="stack">
        ${S.storage ? storagePanel(S.storage) : ''}
        ${S.metaApp ? metaAppPanel(S.metaApp) : ''}
        <div class="panel">
          <h2>Publicação no Marketplace</h2>
          <div class="modes">
            <label class="check"><input type="radio" name="pubmode" value="manual" ${manualMode() ? 'checked' : ''}><div><b>Assistida, sem instalar nada</b><span>Funciona em qualquer computador ou celular. O painel entrega as fotos e os dados prontos para copiar, abre o Marketplace e você publica.</span></div></label>
            <label class="check"><input type="radio" name="pubmode" value="extensao" ${manualMode() ? '' : 'checked'}><div><b>Automática, um clique (extensão do Chrome)</b><span>Clique em Publicar ou Republicar e a extensão faz tudo: exclui o anúncio antigo, preenche, publica e registra o link. Exige a extensão no Chrome do computador.</span></div></label>
          </div>
        </div>
        <div class="panel" ${manualMode() ? 'hidden' : ''}>
          <h2>Extensão do Chrome</h2>
          ${extStatusHtml()}
          <div class="checks">
            <label class="check"><input type="checkbox" id="autoPub" ${S.me.store.auto_publish ? 'checked' : ''}><div><b>Publicar sem conferir</b><span>A extensão clica em Publicar sozinha. Desmarcado, ela preenche tudo e espera você clicar.</span></div></label>
          </div>
          <div class="fields">
            <div class="f w3"><label for="dailyLimit">Limite de publicações por dia</label><input id="dailyLimit" inputmode="numeric" value="${esc(S.me.store.daily_limit || 15)}"><span class="hint">Protege a conta do Facebook. Intervalo de 3 a 5 min entre anúncios.</span></div>
          </div>
          <div class="form-foot"><button class="btn primary" id="saveAuto" type="button">Salvar</button></div>
          <details><summary class="note" style="cursor:pointer">Conectar manualmente (código)</summary>
            ${pair ? `<div class="code-big" aria-label="Código de pareamento">${esc(pair.code)}</div><p class="note">Válido por 10 minutos. Digite no ícone da extensão.</p>` : ''}
            <div style="margin-top:8px"><button class="btn sm" id="pairBtn" type="button">${pair ? 'Gerar outro código' : 'Gerar código'}</button></div>
          </details>
        </div>
      </div>
    </div>`;
  }

  function extStatusHtml() {
    const h = S.extInfo; const exp = S.me.extension?.version;
    if (!h) return `<div class="warnbox">A extensão não está instalada neste Chrome.</div><div><button class="btn primary" id="installExt" type="button">Instalar a extensão</button></div>`;
    const ok = h.paired && h.panelUrl === location.origin;
    return `<div class="${ok ? 'okbox' : 'infobox'}">${ok ? `<b>Extensão conectada</b> à loja ${esc(h.store)} · versão ${esc(h.version)}` : 'Extensão instalada. Conectando…'}</div>
      ${exp && h.version !== exp ? `<div class="warnbox">Há uma versão nova da extensão (${esc(exp)}). <a class="link" href="/extensao.zip" download>Baixe</a>, extraia por cima da pasta antiga e clique em ↻ (recarregar) no cartão do GiroAuto em chrome://extensions.</div>` : ''}
      ${h.lastError ? `<div class="err">${esc(h.lastError)}</div>` : ''}`;
  }

  /* ---------------- Armazenamento dos dados (administrador) ---------------- */
  function storagePanel(st) {
    if (!st.enabled) {
      return `<div class="panel"><h2>Armazenamento dos dados</h2>
        <div class="warnbox"><b>Dados temporários.</b> Lojas, veículos e fotos ficam só no servidor e são apagados quando uma nova versão é publicada.</div>
        <p class="note">Configure no Render as variáveis <code>SUPABASE_URL</code>, <code>SUPABASE_KEY</code> e <code>GIROAUTO_STORAGE_TOKEN</code> (veja o README).</p></div>`;
    }
    const last = st.last_backup_at ? new Date(st.last_backup_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'ainda não feita';
    return `<div class="panel"><h2>Armazenamento dos dados</h2>
      ${st.last_error ? `<div class="err">A última cópia falhou: ${esc(st.last_error)}. O GiroAuto tenta de novo a cada 30 segundos.</div>` : `<div class="okbox"><b>Dados protegidos no Supabase.</b> Lojas, veículos e fotos continuam após cada nova versão.</div>`}
      <div class="kv" style="grid-template-columns:repeat(2,minmax(0,1fr))">
        <div><span class="k">Última cópia</span><span class="v">${esc(last)}</span></div>
        <div><span class="k">Cópias diárias</span><span class="v">pasta <code>copias</code> no Supabase</span></div>
      </div>
      <div class="form-foot"><button class="btn" id="stBackup" type="button">Fazer cópia agora</button></div></div>`;
  }

  /* ---------------- App da Meta (administrador da plataforma) ---------------- */
  function copyRow(label, value, id) {
    return `<div class="cf"><span class="k">${esc(label)}</span><span class="v" style="font-family:var(--f-mono);font-size:12.5px;font-weight:500">${esc(value)}</span><button class="btn sm" type="button" data-cp="${id}">Copiar</button></div>`;
  }
  function metaAppPanel(a) {
    const ok = a.configured;
    const rows = [
      ['URI de redirecionamento do OAuth', a.redirect_uri],
      ['Domínio do app', a.app_domain],
      ['URL do site', a.site_url],
      ['Política de privacidade', a.privacy_url],
      ['Exclusão de dados', a.deletion_url],
      ['Termos de serviço', a.terms_url],
    ];
    S._cp = rows.map((r) => r[1]);
    return `<div class="panel" id="config-meta">
      <h2>App da Meta (plataforma)</h2>
      ${ok ? `<div class="okbox">Configurado${a.source === 'env' ? ' pelas variáveis do servidor' : ''}. ID do app: <b>${esc(a.app_id)}</b></div>`
        : '<p class="lead">Configuração única, feita pelo administrador. Depois dela, cada loja conecta o próprio Facebook com um clique.</p>'}
      ${!a.https ? '<div class="warnbox">O endereço do painel não usa HTTPS. A Meta só aceita login em endereços HTTPS (exceto localhost).</div>' : ''}
      <details ${ok ? '' : 'open'}><summary style="cursor:pointer;font-weight:600">Passo a passo no site da Meta</summary>
        <ol class="note" style="padding-left:18px;display:flex;flex-direction:column;gap:8px;margin:10px 0 0">
          <li>Abra <a class="link" href="https://developers.facebook.com/apps/creation/" target="_blank" rel="noopener">developers.facebook.com</a> com o Facebook que administra a Página e a conta de anúncios. Se for o primeiro acesso, conclua o cadastro de desenvolvedor.</li>
          <li>Clique em <b>Criar app</b>. Dê o nome <b>GiroAuto</b>. No caso de uso, escolha a opção de <b>anúncios com a API de Marketing</b> (se não aparecer, escolha <b>Outro</b> e o tipo <b>Empresa</b>). Vincule ao portfólio empresarial da loja quando pedir.</li>
          <li>No painel do app, adicione o produto <b>Login do Facebook para Empresas</b>. Em <b>Configurações</b> dele, cole a URI de redirecionamento abaixo em <b>URIs de redirecionamento do OAuth válidos</b> e salve.</li>
          <li>Em <b>Configurações do app &gt; Básico</b>, preencha domínio, política de privacidade, exclusão de dados e termos com os endereços abaixo. Escolha uma categoria (ex.: Negócios e páginas) e salve.</li>
          <li>Ainda em <b>Básico</b>, copie o <b>ID do app</b> e a <b>Chave secreta do app</b> (clique em Mostrar) e cole nos campos abaixo.</li>
        </ol>
      </details>
      <div class="cfields">${rows.map((r, i) => copyRow(r[0], r[1], i)).join('')}</div>
      <div class="fields">
        <div class="f w3"><label for="ma-id">ID do app</label><input id="ma-id" inputmode="numeric" value="${esc(a.source === 'painel' ? a.app_id : '')}" placeholder="1234567890123456" autocomplete="off"></div>
        <div class="f w3"><label for="ma-secret">Chave secreta do app</label><input id="ma-secret" type="password" placeholder="${ok ? '•••••••• (guardada)' : '32 caracteres'}" autocomplete="new-password"></div>
      </div>
      <p class="note">A chave fica guardada criptografada no servidor. Ao salvar, o GiroAuto confere as credenciais na Meta.</p>
      <div class="err" id="maErr" hidden></div>
      <div class="form-foot">${a.source === 'painel' ? '<button class="btn ghost danger" id="maClear" type="button">Remover</button>' : ''}<button class="btn primary" id="maSave" type="button">${ok ? 'Atualizar credenciais' : 'Salvar e testar'}</button></div>
      <p class="note">Enquanto o app estiver em <b>modo de desenvolvimento</b>, só quem tem função no app (você) consegue conectar. Para outras lojas usarem, a Meta exige verificação da empresa e análise do app, com acesso avançado às permissões de anúncios.</p>
    </div>`;
  }

  /* ---------------- Ligações de eventos ---------------- */
  function bind() {
    $$('[data-go]').forEach((b) => { b.onclick = () => { if (b.dataset.go === 'novo') { S.draft = blankDraft(); S.pendingFiles = []; } go(b.dataset.go); }; });
    $$('[data-filtro]').forEach((b) => { b.onclick = () => { S.filtro = b.dataset.filtro; render(); }; });
    const bs = $('#busca');
    if (bs) bs.oninput = () => { S.busca = bs.value; const pos = bs.selectionStart; render().then(() => { const nb = $('#busca'); nb.focus(); nb.setSelectionRange(pos, pos); }); };
    $$('[data-act]').forEach((b) => { b.onclick = () => act(b.dataset.act, Number(b.dataset.id)); });
    const ea = $('#enableAuto');
    if (ea) ea.onclick = async () => { await api('PUT', '/api/store/pub-mode', { mode: 'extensao' }); S.me.store.pub_mode = 'extensao'; await loadExt(); toast('Publicação automática ativada'); render(); };

    if (S.view === 'novo') {
      const drop = $('#drop'); const inp = $('#v-fotos');
      inp.onchange = () => { addFiles(inp.files); inp.value = ''; };
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
      drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
      bindPhotos();
      $('#gerarDesc').onclick = gerarDescricao;
      $('#salvar').onclick = () => saveVehicle(false);
      const sp = $('#salvarPub'); if (sp) sp.onclick = () => saveVehicle(true);
    }
    if (S.view === 'republicacao') {
      const b = $('#repTodos'); if (b) b.onclick = republicarTodos;
      $$('[data-cancel]').forEach((x) => { x.onclick = async () => { await api('POST', `/api/jobs/${x.dataset.cancel}/cancel`); await loadJobs(); render(); }; });
    }
    if (S.view === 'campanhas') {
      const n = $('#novaCamp'); if (n) n.onclick = () => { S.camp = blankCamp(); if (S.me.store.city) S.camp.city_name = ''; $('#campForm').innerHTML = campFormHtml(); bindCamp(); $('#c-name').focus(); };
      const r = $('#refreshStats'); if (r) r.onclick = async () => { r.disabled = true; r.textContent = 'Atualizando…'; try { await loadCampaigns(true); } catch (e) { toast(e.message); } render(); };
      const cp = $('#copyFeed');
      if (cp) cp.onclick = () => navigator.clipboard.writeText($('#feedUrl').textContent).then(() => toast('Endereço do feed copiado')).catch(() => { const rg = document.createRange(); rg.selectNodeContents($('#feedUrl')); const s = getSelection(); s.removeAllRanges(); s.addRange(rg); });
      const sc = $('#setupCat'); if (sc) sc.onclick = async () => { sc.disabled = true; try { await api('POST', '/api/meta/catalog/setup'); toast('Catálogo criado e sincronizado'); } catch (e) { toast(e.message, 7000); } render(); };
      const sy = $('#syncCat'); if (sy) sy.onclick = async () => { sy.disabled = true; try { await api('POST', '/api/meta/catalog/sync'); toast('Sincronização solicitada à Meta'); } catch (e) { toast(e.message, 7000); } render(); };
      $$('[data-camp]').forEach((b) => { b.onclick = () => campAction(b.dataset.camp, Number(b.dataset.id)); });
      bindCamp();
    }
    if (S.view === 'config') {
      $('#sSave').onclick = async () => {
        try {
          await api('PUT', '/api/store', { name: $('#s-name').value, phone: $('#s-phone').value, whatsapp: $('#s-wa').value, address: $('#s-addr').value, city: $('#s-city').value, state: $('#s-uf').value, postal_code: $('#s-cep').value });
          S.me = await api('GET', '/api/me'); $('#storeName').textContent = S.me.store.name; toast('Dados da loja salvos');
        } catch (e) { toast(e.message, 6000); }
      };
      $('#pairBtn').onclick = async () => { S.pairCode = await api('POST', '/api/extension/pair-code'); render(); };
      const ie = $('#installExt'); if (ie) ie.onclick = installModal;
      const sa = $('#saveAuto');
      if (sa) sa.onclick = async () => {
        try {
          const r = await api('PUT', '/api/store/automation', { auto_publish: $('#autoPub').checked, daily_limit: $('#dailyLimit').value });
          S.me.store.auto_publish = r.auto_publish; S.me.store.daily_limit = r.daily_limit; toast('Publicação automática salva');
        } catch (e) { toast(e.message); }
      };
      $$('input[name="pubmode"]').forEach((r) => {
        r.onchange = async () => {
          try {
            await api('PUT', '/api/store/pub-mode', { mode: r.value });
            S.me.store.pub_mode = r.value;
            await Promise.all([loadJobs(), loadExt()]);
            toast(r.value === 'manual' ? 'Publicação assistida ativada' : 'Publicação automática ativada');
            if (r.value === 'extensao' && !(await extConnect())) installModal();
            render();
          } catch (e) { toast(e.message); }
        };
      });
      const ms = $('#mSave');
      if (ms) ms.onclick = async () => {
        ms.disabled = true; $('#mErr2').hidden = true;
        try {
          S.meta = { ...S.meta, ...(await api('PUT', '/api/meta/settings', { ad_account_id: $('#m-acc').value, page_id: $('#m-page').value, business_id: $('#m-biz').value, whatsapp_number: $('#m-wa').value })) };
          toast('Conexão com a Meta salva');
        } catch (e) { $('#mErr2').textContent = e.message; $('#mErr2').hidden = false; }
        ms.disabled = false;
      };
      $$('[data-cp]').forEach((b) => { b.onclick = () => copyText(S._cp[Number(b.dataset.cp)], b); });
      const gm = $('#goMetaApp'); if (gm) gm.onclick = (e) => { e.preventDefault(); const t = $('#config-meta'); t && t.scrollIntoView({ behavior: 'smooth' }); setTimeout(() => $('#ma-id')?.focus(), 400); };
      const stb = $('#stBackup');
      if (stb) stb.onclick = async () => { stb.disabled = true; try { await api('POST', '/api/admin/storage/backup'); toast('Cópia dos dados feita no Supabase'); render(); } catch (e) { toast(e.message, 6000); stb.disabled = false; } };
      const mas = $('#maSave');
      if (mas) mas.onclick = async () => {
        mas.disabled = true; mas.textContent = 'Conferindo na Meta…'; $('#maErr').hidden = true;
        try {
          await api('PUT', '/api/admin/meta-app', { app_id: $('#ma-id').value, app_secret: $('#ma-secret').value });
          toast('App da Meta configurado. Agora clique em Conectar Facebook.', 5000);
          render();
        } catch (e) { $('#maErr').textContent = e.message; $('#maErr').hidden = false; mas.disabled = false; mas.textContent = 'Salvar e testar'; }
      };
      const mac = $('#maClear');
      if (mac) mac.onclick = () => confirmBox('Remover credenciais do app?', 'As lojas não vão conseguir criar campanhas até o app ser configurado de novo.', 'Remover', async () => { await api('DELETE', '/api/admin/meta-app'); render(); }, true);
      const md = $('#mDisc');
      if (md) md.onclick = () => confirmBox('Desconectar o Facebook?', 'As campanhas já criadas continuam na Meta, mas o painel deixa de controlá-las até você conectar de novo.', 'Desconectar', async () => { await api('POST', '/api/meta/disconnect'); render(); }, true);
    }
  }

  boot();
})();
