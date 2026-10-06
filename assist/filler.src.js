/* GiroAuto — preenchedor do formulário de veículo do Facebook Marketplace (roda como favorito).
 * Gerado para public/bookmarklet.js por `npm run build:bookmarklet`.
 * Regras: sem innerHTML (a página do Facebook pode exigir Trusted Types), sem fetch para outros sites
 * (a política de segurança do Facebook bloqueia). Os dados chegam por postMessage da janela-ponte do GiroAuto.
 * Nunca clica em "Publicar": quem publica é sempre a pessoa. */
(function () {
  var ORIGIN = '__GIRO_ORIGIN__';
  var BM_VERSION = '__GIRO_VERSION__';
  if (window.__giroBm) { window.__giroBm.show(); return; }

  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var human = function () { return sleep(300 + Math.random() * 400); };
  var norm = function (s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); };
  var visible = function (el) { return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'; };

  /* ---------------- Caixa flutuante (DOM puro) ---------------- */
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'style') el.style.cssText = attrs[k];
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  var C = { ink: '#161a21', muted: '#5b6370', line: '#d9dde4', accent: '#efa91c', ok: '#1d7f48', warn: '#9a6200', bad: '#b0352a', soft: '#fdf1d6' };
  var BTN = 'font:inherit;border:1px solid ' + C.line + ';background:#fff;color:' + C.ink + ';border-radius:7px;padding:7px 12px;cursor:pointer';
  var BTNP = 'font:inherit;border:1px solid ' + C.accent + ';background:' + C.accent + ';color:#1b1400;font-weight:600;border-radius:7px;padding:7px 12px;cursor:pointer';
  var root = h('div', { id: 'giroauto-box', style: 'position:fixed;right:16px;bottom:16px;z-index:2147483647;width:340px;max-width:calc(100vw - 32px);background:#fff;color:' + C.ink + ';border-radius:12px;box-shadow:0 10px 32px rgba(0,0,0,.3);font:13.5px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden' });
  var close = h('button', { style: 'all:unset;cursor:pointer;color:#fff;margin-left:auto;padding:0 4px;font-size:18px;line-height:1', title: 'Fechar', onclick: function () { root.remove(); } }, ['×']);
  var head = h('div', { style: 'background:' + C.ink + ';color:#fff;padding:10px 14px;display:flex;align-items:center;gap:8px;font-weight:600' }, [
    h('span', { style: 'width:22px;height:22px;border-radius:5px;background:' + C.accent + ';color:#1b1400;display:grid;place-items:center;font-weight:700' }, ['G']),
    'GiroAuto', close]);
  var body = h('div', { style: 'padding:12px 14px;display:flex;flex-direction:column;gap:8px;max-height:65vh;overflow:auto' });
  root.appendChild(head); root.appendChild(body);
  document.documentElement.appendChild(root);

  function show() { if (!root.isConnected) document.documentElement.appendChild(root); }
  function render(nodes) { while (body.firstChild) body.removeChild(body.firstChild); nodes.filter(Boolean).forEach(function (n) { body.appendChild(n); }); }
  var p = function (txt, color, bold) { return h('div', { style: (color ? 'color:' + color + ';' : '') + (bold ? 'font-weight:600' : '') }, [txt]); };
  var note = function (kids) { return h('div', { style: 'background:' + C.soft + ';color:#7d5200;border-radius:8px;padding:8px 10px' }, kids); };
  var row = function (btns) { return h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end' }, btns); };
  var b = function (txt, fn, primary) { return h('button', { style: primary ? BTNP : BTN, onclick: fn }, [txt]); };
  window.__giroBm = { show: show };

  /* ---------------- Localizar campos pelo rótulo ---------------- */
  function labelOf(el) {
    var parts = [];
    if (el.getAttribute('aria-label')) parts.push(el.getAttribute('aria-label'));
    var lb = el.getAttribute('aria-labelledby');
    if (lb) lb.split(/\s+/).forEach(function (id) { var n = document.getElementById(id); if (n) parts.push(n.textContent); });
    var label = el.closest('label');
    if (label) parts.push(label.innerText.split('\n')[0]);
    if (el.placeholder) parts.push(el.placeholder);
    return norm(parts.join(' | '));
  }
  function controls() {
    return Array.prototype.slice.call(document.querySelectorAll('input:not([type=hidden]):not([type=file]), textarea, [role="combobox"], [role="button"][aria-haspopup="listbox"], label[role="combobox"]')).filter(visible);
  }
  function find(names) {
    var wanted = names.map(norm), list = controls(), i, w, hit;
    for (i = 0; i < wanted.length; i++) {
      w = wanted[i];
      hit = list.find(function (el) { var l = labelOf(el); return l === w || l.indexOf(w + ' ') === 0 || l.split(' | ').indexOf(w) >= 0; });
      if (hit) return hit;
    }
    for (i = 0; i < wanted.length; i++) {
      w = wanted[i];
      hit = list.find(function (el) { return labelOf(el).indexOf(w) >= 0; });
      if (hit) return hit;
    }
    return null;
  }
  function setNativeValue(el, value) {
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.focus();
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  var isText = function (el) { return (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && !el.readOnly && el.getAttribute('role') !== 'combobox'; };
  var options = function () { return Array.prototype.slice.call(document.querySelectorAll('[role="option"], [role="menuitemradio"], [role="menuitem"]')).filter(visible); };

  // Escolhe a melhor opção: igual ao desejado; ou o nome base (ex.: "Onix" para "Onix LT 1.0 Turbo"); ou começa com o desejado.
  function best(opts, wanted) {
    var top = null, topScore = 0;
    opts.forEach(function (o) {
      var t = norm(o.innerText.split('\n')[0]);
      if (!t) return;
      wanted.forEach(function (w, i) {
        var sc = 0;
        if (t === w) sc = 1000 - i;
        else if (w.indexOf(t + ' ') === 0) sc = 500 + t.length - i;
        else if (t.indexOf(w) === 0) sc = 300 - (t.length - w.length) - i;
        if (sc > topScore) { topScore = sc; top = o; }
      });
    });
    return top;
  }
  // Campo de busca que a lista abre (ex.: fabricantes). Só vale um campo que ganhou o foco depois do clique
  // e que não é um dos campos do formulário — nunca escreve em Preço, Quilometragem etc.
  function searchBox(el, before) {
    if (el.tagName === 'INPUT' && !el.readOnly) return el;
    var a = document.activeElement;
    if (a && a !== el && a !== before && a.tagName === 'INPUT' && a.type !== 'file' && !root.contains(a) && !a.closest('label')) return a;
    return Array.prototype.slice.call(document.querySelectorAll('[role="listbox"] input, [role="menu"] input, [role="dialog"] input[type="search"]')).filter(visible)[0] || null;
  }
  async function choose(el, choices) {
    var wanted = choices.filter(Boolean).map(norm);
    el.scrollIntoView({ block: 'center' });
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    var before = document.activeElement;
    el.click();
    await sleep(600);
    // Listas com campo de busca (ex.: fabricantes): digita para filtrar.
    var sb = searchBox(el, before);
    if (sb) { setNativeValue(sb, String(choices[0])); await sleep(900); }
    var lastTop = -1, still = 0;
    for (var tries = 0; tries < 60; tries++) {
      var opts = options();
      var o = best(opts, wanted);
      if (o) { o.scrollIntoView({ block: 'center' }); o.click(); await human(); return true; }
      if (!opts.length) { await sleep(300); if (tries > 6) break; continue; }
      var lb = opts[0].closest('[role="listbox"], [role="menu"]') || opts[0].parentElement;
      lb.scrollTop += 400;
      opts[opts.length - 1].scrollIntoView({ block: 'end' });
      await sleep(250);
      if (lb.scrollTop === lastTop) { if (++still > 2) break; } else { still = 0; lastTop = lb.scrollTop; }
    }
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    return false;
  }
  async function fill(names, value, choices, textValue) {
    if (value === undefined || value === null || value === '') return 'skip';
    var el = find(names);
    if (!el) return 'missing';
    if (isText(el)) {
      setNativeValue(el, String(textValue != null ? textValue : value));
      await human();
      var o = best(options(), (choices || [String(value)]).map(norm));
      if (o) { o.click(); await human(); }
      return 'ok';
    }
    return (await choose(el, choices || [String(value)])) ? 'ok' : 'manual';
  }
  async function attach(files) {
    var input = Array.prototype.slice.call(document.querySelectorAll('input[type=file]')).find(function (i) { return /image/.test(i.accept || 'image'); });
    if (!input) return 'missing';
    var dt = new DataTransfer();
    files.forEach(function (f) { dt.items.add(f); });
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(1500 + files.length * 250);
    return 'ok';
  }

  var BODY = { Hatch: ['Hatchback'], 'Sedã': ['Sedã', 'Sedan'], SUV: ['SUV'], Picape: ['Picape', 'Caminhonete', 'Pickup'], Minivan: ['Minivan'], Perua: ['Perua', 'Wagon'], 'Cupê': ['Cupê', 'Coupe'], 'Conversível': ['Conversível', 'Convertible'], Van: ['Van'], Outro: ['Outro', 'Other'] };
  var FUEL = { Flex: ['Flex', 'Bicombustível'], Gasolina: ['Gasolina'], Etanol: ['Etanol', 'Flex'], Diesel: ['Diesel'], 'Elétrico': ['Elétrico'], 'Híbrido': ['Híbrido'], GNV: ['Outro'] };
  var TRANS = { 'Automático': ['Transmissão automática', 'Automática', 'Automatic'], Manual: ['Transmissão manual', 'Manual'], CVT: ['Transmissão automática', 'Automática'], Automatizado: ['Transmissão automática', 'Automática'] };
  var COLOR = { Branco: ['Branco'], Prata: ['Prata'], Cinza: ['Cinza'], Preto: ['Preto'], Vermelho: ['Vermelho'], Azul: ['Azul'], Verde: ['Verde'],
    Marrom: ['Marrom'], Bege: ['Bege', 'Bronze', 'Marrom'], Amarelo: ['Amarelo'], Laranja: ['Laranja'], Dourado: ['Dourado', 'Ouro'],
    Vinho: ['Vinho', 'Bordô', 'Vermelho'], Outra: ['Outra', 'Outro'] };
  var colorOpts = function (c) { return (COLOR[c] || [c]).concat(['Outro', 'Outra']); };
  var L = {
    tipo: ['Tipo de veículo', 'Vehicle type'], ano: ['Ano', 'Year'], marca: ['Fabricante', 'Marca', 'Make'], modelo: ['Modelo', 'Model'],
    km: ['Quilometragem', 'Mileage'], preco: ['Preço', 'Price'], carroceria: ['Estilo da carroceria', 'Carroceria', 'Body style'],
    cor: ['Cor externa', 'Cor exterior', 'Exterior color'], corInt: ['Cor interna', 'Cor do interior', 'Interior color'], cond: ['Condição do veículo', 'Estado do veículo', 'Vehicle condition'],
    comb: ['Tipo de combustível', 'Combustível', 'Fuel type'], trans: ['Transmissão', 'Transmission'], desc: ['Descrição', 'Description'],
  };

  /* ---------------- Fluxo ---------------- */
  var ponte = null, waitTimer = null;

  var outdated = false;
  async function run(v, files) {
    var titulo = (v.marca + ' ' + v.modelo + ' ' + (v.versao || '')).trim();
    render([p('Preenchendo ' + titulo + '…', null, true), p('Não mexa na página por alguns segundos.', C.muted)]);
    for (var i = 0; i < 30 && !find(L.tipo) && !find(L.ano); i++) await sleep(500);
    if (!find(L.tipo) && !find(L.ano)) {
      render([p('Não encontrei o formulário de veículo.', C.bad, true), p('Abra a página de criar anúncio de veículo e clique no favorito de novo.'),
        row([b('Abrir formulário', function () { location.href = 'https://www.facebook.com/marketplace/create/vehicle'; }, true)])]);
      return;
    }
    var res = [];
    async function step(nome, fn) { var r; try { r = await fn(); } catch (e) { r = 'erro'; } res.push([nome, r]); }
    await step('Tipo de veículo', function () { return fill(L.tipo, 'Carro/picape', ['Carro/picape', 'Carro/caminhonete', 'Carro', 'Car/Truck']); });
    await sleep(800);
    if (files && files.length) await step('Fotos (' + files.length + ')', function () { return attach(files); });
    else res.push(['Fotos', 'manual']);
    await step('Ano', function () { return fill(L.ano, v.ano_modelo || v.ano_fab); });
    var modeloFull = (v.modelo + ' ' + (v.versao || '')).trim();
    await step('Fabricante', function () { return fill(L.marca, v.marca, [v.marca]); });
    await sleep(700); // a lista de modelos depende do fabricante
    await step('Modelo', function () { return fill(L.modelo, v.modelo, [modeloFull, v.modelo], modeloFull); });
    await step('Quilometragem', function () { return fill(L.km, v.km); });
    await step('Preço', function () { return fill(L.preco, v.preco); });
    if (v.carroceria) await step('Carroceria', function () { return fill(L.carroceria, v.carroceria, BODY[v.carroceria]); });
    if (v.cor) await step('Cor externa', function () { return fill(L.cor, v.cor, colorOpts(v.cor)); });
    await step('Cor interna' + (v.cor_interna ? '' : ' (Preto, confira)'), function () { var c = v.cor_interna || 'Preto'; return fill(L.corInt, c, colorOpts(c)); });
    await step('Condição', function () { return fill(L.cond, 'Bom', ['Bom', 'Muito bom', 'Good']); });
    if (v.combustivel) await step('Combustível', function () { return fill(L.comb, v.combustivel, FUEL[v.combustivel]); });
    if (v.cambio) await step('Transmissão', function () { return fill(L.trans, v.cambio, TRANS[v.cambio]); });
    await step('Descrição', function () { return fill(L.desc, v.descricao || titulo); });

    var icon = { ok: ['✓', C.ok], skip: ['–', C.muted], missing: ['!', C.warn], manual: ['!', C.warn], erro: ['✕', C.bad] };
    var pend = res.filter(function (r) { return r[1] !== 'ok' && r[1] !== 'skip'; });
    var list = h('div', { style: 'display:flex;flex-direction:column;gap:2px' }, res.map(function (r) {
      return h('div', { style: 'display:flex;gap:8px' }, [h('span', { style: 'width:16px;text-align:center;color:' + icon[r[1]][1] }, [icon[r[1]][0]]),
        h('span', null, [r[0] + (r[1] === 'missing' || r[1] === 'manual' ? ' — preencha à mão' : '')])]);
    }));
    var diag = pend.length ? b('Copiar diagnóstico', function (ev) {
      var info = controls().map(function (el) { return { tag: el.tagName, role: el.getAttribute('role'), rotulo: labelOf(el), valor: (el.value || el.innerText || '').slice(0, 60) }; });
      var txt = JSON.stringify({ versao: BM_VERSION, pendentes: pend.map(function (r) { return r[0]; }), campos: info });
      navigator.clipboard.writeText(txt).then(function () { ev.target.textContent = 'Copiado'; }, function () { prompt('Copie o diagnóstico:', txt); });
    }) : null;
    render([outdated ? h('div', { style: 'background:#f8e0dd;color:' + C.bad + ';border-radius:8px;padding:8px 10px' }, ['Este favorito é de uma versão antiga do GiroAuto. No assistente de publicação, apague o favorito e arraste o botão de novo.']) : null,
      p(pend.length ? 'Quase pronto' : 'Formulário preenchido', null, true), list,
      note(['Confira os dados e clique em ', h('b', null, ['Avançar']), ' e depois em ', h('b', null, ['Publicar']), '. O GiroAuto registra a publicação sozinho.']),
      pend.length ? p('Se algum campo não foi preenchido, complete à mão. Para eu ajustar o GiroAuto, clique em "Copiar diagnóstico" e envie o conteúdo ao suporte.', C.muted) : null,
      row([diag, b('Preencher de novo', function () { run(v, files); })].filter(Boolean))]);
    watchPublish(v);
  }

  function watchPublish(v) {
    var start = location.href;
    var t = setInterval(function () {
      if (location.href === start || location.pathname.indexOf('/marketplace/create') >= 0) return;
      clearInterval(t);
      var url = /\/marketplace\/item\/\d+/.test(location.pathname) ? location.origin + location.pathname : '';
      if (ponte && !ponte.closed) ponte.postMessage({ type: 'giro-published', vehicle_id: v.id, url: url }, ORIGIN);
      show();
      render([p('Anúncio publicado.', C.ok, true), p(ponte && !ponte.closed ? 'Registrado no GiroAuto.' : 'Volte ao GiroAuto e clique em "Já publiquei".')]);
    }, 800);
  }

  window.addEventListener('message', function (e) {
    if (e.origin !== ORIGIN || !e.data || e.data.type !== 'giro-data') return;
    clearTimeout(waitTimer);
    outdated = !!(e.data.version && e.data.version !== BM_VERSION);
    run(e.data.vehicle, e.data.files || []);
  });

  function pasteMode() {
    var ta = h('textarea', { placeholder: 'Cole aqui (Ctrl+V) os dados copiados no GiroAuto', style: 'font:inherit;min-height:70px;border:1px solid ' + C.line + ';border-radius:7px;padding:7px' });
    render([p('Não consegui receber os dados automaticamente.', C.warn, true),
      p('No GiroAuto, clique em "Copiar dados" na janela que abriu e cole aqui. As fotos você adiciona à mão (arquivo .zip do painel).'), ta,
      row([b('Preencher', function () {
        try { var d = JSON.parse(ta.value); run(d.vehicle || d, []); } catch (e) { alert('Os dados colados não são do GiroAuto.'); }
      }, true)])]);
  }

  function buscar() {
    ponte = window.open(ORIGIN + '/ponte', 'giroponte', 'width=440,height=600');
    render([p('Buscando os dados no GiroAuto…', null, true), p('Uma janela do GiroAuto abriu. Se ela pedir login, entre e aguarde.', C.muted)]);
    clearTimeout(waitTimer);
    waitTimer = setTimeout(pasteMode, 20000);
  }

  if (location.hostname.indexOf('facebook.com') < 0 && ORIGIN.indexOf('localhost') < 0 && ORIGIN.indexOf('127.0.0.1') < 0) {
    render([p('Use este favorito na página do Facebook Marketplace.', C.bad, true)]);
    return;
  }
  if (location.pathname.indexOf('/marketplace/create') < 0) {
    render([p('Abra o formulário de anúncio de veículo e clique no favorito de novo.', null, true),
      row([b('Abrir formulário', function () { location.href = 'https://www.facebook.com/marketplace/create/vehicle'; }, true)])]);
    return;
  }
  render([p('Pronto para preencher', null, true), p('Clique em Buscar para trazer do GiroAuto o veículo que você escolheu publicar.', C.muted),
    row([b('Buscar dados no GiroAuto', buscar, true)])]);
})();
