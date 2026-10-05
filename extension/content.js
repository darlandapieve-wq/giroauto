// GiroAuto — assistente na página do Facebook Marketplace.
// Preenche o formulário de veículo e ajuda a excluir anúncios antigos.
// Nunca clica em "Publicar": quem confirma a publicação é sempre a pessoa.
(() => {
  if (window.__giroAutoLoaded) return;
  window.__giroAutoLoaded = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const human = () => sleep(350 + Math.random() * 450);
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

  /* ---------------- Painel flutuante ---------------- */
  let box;
  function ui() {
    if (box) return box;
    box = document.createElement('div');
    box.id = 'giroauto-assist';
    box.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host{all:initial}
        .w{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:330px;max-width:calc(100vw - 32px);background:#fff;color:#161a21;
           border-radius:12px;box-shadow:0 10px 32px rgba(0,0,0,.28);font:13.5px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden}
        .h{background:#161a21;color:#fff;padding:10px 14px;display:flex;align-items:center;gap:8px;font-weight:600}
        .h i{width:22px;height:22px;border-radius:5px;background:#efa91c;color:#1b1400;display:grid;place-items:center;font-style:normal;font-weight:700}
        .b{padding:12px 14px;display:flex;flex-direction:column;gap:8px;max-height:60vh;overflow:auto}
        .t{font-weight:600}
        ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px}
        li{display:flex;gap:8px}
        li span:first-child{width:16px;flex:none;text-align:center}
        .ok{color:#1d7f48}.warn{color:#9a6200}.bad{color:#b0352a}
        .note{background:#fdf1d6;color:#7d5200;border-radius:8px;padding:8px 10px}
        .f{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
        button{font:inherit;border:1px solid #d9dde4;background:#fff;border-radius:7px;padding:6px 11px;cursor:pointer}
        button.p{background:#efa91c;border-color:#efa91c;font-weight:600;color:#1b1400}
      </style>
      <div class="w"><div class="h"><i>G</i><span>GiroAuto</span></div><div class="b" id="b"></div></div>`;
    document.documentElement.appendChild(box);
    return box;
  }
  function show(html, buttons = []) {
    const b = ui().shadowRoot.getElementById('b');
    b.innerHTML = html + (buttons.length ? `<div class="f">${buttons.map((x, i) => `<button data-i="${i}" class="${x.primary ? 'p' : ''}">${x.label}</button>`).join('')}</div>` : '');
    buttons.forEach((x, i) => { b.querySelector(`[data-i="${i}"]`).onclick = x.onClick; });
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const send = (msg) => chrome.runtime.sendMessage(msg);

  /* ---------------- Localizar campos pelo rótulo ---------------- */
  function labelOf(el) {
    const parts = [];
    if (el.getAttribute('aria-label')) parts.push(el.getAttribute('aria-label'));
    const lb = el.getAttribute('aria-labelledby');
    if (lb) lb.split(/\s+/).forEach((id) => { const n = document.getElementById(id); if (n) parts.push(n.textContent); });
    const label = el.closest('label');
    if (label) parts.push(label.innerText.split('\n')[0]);
    if (el.placeholder) parts.push(el.placeholder);
    return norm(parts.join(' | '));
  }
  function controls() {
    return [...document.querySelectorAll('input:not([type=hidden]):not([type=file]), textarea, [role="combobox"], [role="button"][aria-haspopup="listbox"], label[role="combobox"]')]
      .filter(visible);
  }
  function find(names) {
    const wanted = names.map(norm);
    const list = controls();
    for (const w of wanted) {
      const hit = list.find((el) => { const l = labelOf(el); return l === w || l.startsWith(w + ' ') || l.startsWith(w + ' |') || l.split(' | ').includes(w); });
      if (hit) return hit;
    }
    for (const w of wanted) {
      const hit = list.find((el) => labelOf(el).includes(w));
      if (hit) return hit;
    }
    return null;
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function isTextInput(el) {
    return (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && !el.readOnly && el.getAttribute('role') !== 'combobox';
  }

  async function chooseOption(el, choices) {
    el.scrollIntoView({ block: 'center' });
    el.click();
    await sleep(500);
    const wanted = choices.map(norm);
    for (let tries = 0; tries < 6; tries++) {
      const opts = [...document.querySelectorAll('[role="option"], [role="menuitemradio"], [role="menuitem"]')].filter(visible);
      for (const w of wanted) {
        const o = opts.find((x) => norm(x.innerText) === w) || opts.find((x) => norm(x.innerText).startsWith(w));
        if (o) { o.scrollIntoView({ block: 'center' }); o.click(); await human(); return true; }
      }
      if (opts.length) { // lista aberta mas sem a opção: rola a lista
        const lb = opts[0].closest('[role="listbox"], [role="menu"]') || opts[0].parentElement;
        lb.scrollTop += 300;
      }
      await sleep(300);
    }
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return false;
  }

  async function fillField(names, value, { options } = {}) {
    if (value === undefined || value === null || value === '') return 'skip';
    const el = find(names);
    if (!el) return 'missing';
    if (isTextInput(el)) {
      setNativeValue(el, String(value));
      await human();
      // campos com autocompletar abrem uma lista: escolhe a opção igual, se houver
      const opts = [...document.querySelectorAll('[role="option"]')].filter(visible);
      const o = opts.find((x) => norm(x.innerText) === norm(value));
      if (o) { o.click(); await human(); }
      return 'ok';
    }
    return (await chooseOption(el, options || [String(value)])) ? 'ok' : 'manual';
  }

  /* ---------------- Mapeamentos ---------------- */
  const BODY = {
    Hatch: ['Hatchback'], 'Sedã': ['Sedã', 'Sedan'], SUV: ['SUV'], Picape: ['Picape', 'Caminhonete', 'Pickup'], Minivan: ['Minivan'],
    Perua: ['Perua', 'Wagon'], 'Cupê': ['Cupê', 'Coupe'], 'Conversível': ['Conversível', 'Convertible'], Van: ['Van'], Outro: ['Outro', 'Other'],
  };
  const FUEL = { Flex: ['Flex', 'Bicombustível', 'Flex fuel'], Gasolina: ['Gasolina'], Etanol: ['Etanol', 'Flex'], Diesel: ['Diesel'], 'Elétrico': ['Elétrico'], 'Híbrido': ['Híbrido'], GNV: ['Outro'] };
  const TRANS = { 'Automático': ['Transmissão automática', 'Automática', 'Automatic'], Manual: ['Transmissão manual', 'Manual'], CVT: ['Transmissão automática', 'Automática'], Automatizado: ['Transmissão automática', 'Automática'] };

  const L = {
    tipo: ['Tipo de veículo', 'Vehicle type'],
    ano: ['Ano', 'Year'],
    marca: ['Marca', 'Make'],
    modelo: ['Modelo', 'Model'],
    km: ['Quilometragem', 'Mileage'],
    preco: ['Preço', 'Price'],
    carroceria: ['Estilo da carroceria', 'Carroceria', 'Body style'],
    corExt: ['Cor externa', 'Cor exterior', 'Exterior color'],
    condicao: ['Condição do veículo', 'Estado do veículo', 'Vehicle condition'],
    combustivel: ['Tipo de combustível', 'Combustível', 'Fuel type'],
    transmissao: ['Transmissão', 'Transmission'],
    descricao: ['Descrição', 'Description'],
  };

  /* ---------------- Fotos ---------------- */
  async function attachPhotos(photos) {
    const input = [...document.querySelectorAll('input[type=file]')].find((i) => /image/.test(i.accept || 'image'));
    if (!input) return 'missing';
    const dt = new DataTransfer();
    for (const [i, p] of photos.entries()) {
      const r = await fetch(p.url);
      if (!r.ok) throw new Error(`Não foi possível baixar a foto ${i + 1} do painel.`);
      const blob = await r.blob();
      dt.items.add(new File([blob], `foto-${String(i + 1).padStart(2, '0')}.${(blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`, { type: blob.type || 'image/jpeg' }));
    }
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(1500 + photos.length * 250);
    return 'ok';
  }

  /* ---------------- Fluxo: preencher ---------------- */
  async function fill(current) {
    const v = current.vehicle;
    const titulo = `${v.marca} ${v.modelo} ${v.versao || ''}`.trim();
    show(`<div class="t">Preenchendo ${esc(titulo)}…</div><div>Não mexa na página por alguns segundos.</div>`);
    // aguarda o formulário aparecer
    for (let i = 0; i < 30 && !find(L.tipo) && !find(L.ano); i++) await sleep(500);
    if (!find(L.tipo) && !find(L.ano)) {
      show(`<div class="t bad">Não encontrei o formulário de veículo.</div><div>Confira se você está logado no Facebook com a conta da loja.</div>`,
        [{ label: 'Cancelar tarefa', onClick: () => send({ cmd: 'failed', error: 'Formulário de veículo não encontrado (login ou página diferente).' }) },
          { label: 'Tentar de novo', primary: true, onClick: () => fill(current) }]);
      return;
    }
    const res = [];
    const step = async (nome, fn) => { let r; try { r = await fn(); } catch (e) { r = 'erro'; console.warn('GiroAuto', nome, e); } res.push([nome, r]); };

    await step('Tipo de veículo', () => fillField(L.tipo, 'Carro/picape', { options: ['Carro/picape', 'Carro/caminhonete', 'Carro', 'Car/Truck'] }));
    await sleep(800);
    await step(`Fotos (${v.photos.length})`, () => attachPhotos(v.photos.slice(0, 20)));
    await step('Ano', () => fillField(L.ano, v.ano_modelo || v.ano_fab));
    await step('Marca', () => fillField(L.marca, v.marca));
    await step('Modelo', () => fillField(L.modelo, `${v.modelo} ${v.versao || ''}`.trim()));
    await step('Quilometragem', () => fillField(L.km, v.km));
    await step('Preço', () => fillField(L.preco, v.preco));
    if (v.carroceria) await step('Carroceria', () => fillField(L.carroceria, v.carroceria, { options: BODY[v.carroceria] }));
    if (v.cor) await step('Cor externa', () => fillField(L.corExt, v.cor, { options: [v.cor] }));
    await step('Condição', () => fillField(L.condicao, 'Bom', { options: ['Bom', 'Muito bom', 'Good'] }));
    if (v.combustivel) await step('Combustível', () => fillField(L.combustivel, v.combustivel, { options: FUEL[v.combustivel] }));
    if (v.cambio) await step('Transmissão', () => fillField(L.transmissao, v.cambio, { options: TRANS[v.cambio] }));
    await step('Descrição', () => fillField(L.descricao, v.descricao || titulo));

    await send({ cmd: 'filled' });
    const icon = { ok: ['✓', 'ok'], skip: ['–', ''], missing: ['!', 'warn'], manual: ['!', 'warn'], erro: ['✕', 'bad'] };
    const pend = res.filter(([, r]) => r !== 'ok' && r !== 'skip');
    show(`<div class="t">${pend.length ? 'Quase pronto' : 'Formulário preenchido'}</div>
      <ul>${res.map(([n, r]) => `<li><span class="${icon[r][1]}">${icon[r][0]}</span><span>${esc(n)}${r === 'missing' || r === 'manual' ? ' — preencha à mão' : ''}</span></li>`).join('')}</ul>
      <div class="note">Confira os dados e clique em <b>Avançar</b> e depois em <b>Publicar</b> no Facebook. O GiroAuto registra a publicação sozinho.</div>`,
    [{ label: 'Cancelar', onClick: () => { send({ cmd: 'cancel' }); show('<div>Tarefa cancelada.</div>'); } },
      { label: 'Já publiquei', onClick: () => { send({ cmd: 'published', listing_url: '' }); show('<div class="ok">Registrado no painel.</div>'); } }]);
  }

  /* ---------------- Fluxo: excluir anúncio antigo ---------------- */
  async function clickByText(texts, root = document) {
    const want = texts.map(norm);
    const els = [...root.querySelectorAll('[role="menuitem"], [role="button"], button, [role="option"], span')].filter(visible);
    for (const w of want) {
      const el = els.find((e) => norm(e.innerText) === w);
      if (el) { (el.closest('[role="menuitem"], [role="button"], button') || el).click(); await human(); return true; }
    }
    return false;
  }

  async function removeOld(current) {
    const v = current.vehicle;
    const titulo = `${v.marca} ${v.modelo}`;
    show(`<div class="t">Procurando o anúncio de ${esc(titulo)}…</div>`);
    const manual = (motivo) => show(
      `<div class="t warn">Exclua o anúncio antigo manualmente</div><div>${esc(motivo)}</div>
       <div class="note">Em <b>Seus anúncios</b>, abra o anúncio de <b>${esc(titulo)}</b>, clique em <b>…</b> e em <b>Excluir anúncio</b>. Depois clique em “Já excluí”.</div>`,
      [{ label: 'Cancelar', onClick: () => { send({ cmd: 'cancel' }); show('<div>Tarefa cancelada.</div>'); } },
        { label: 'Já excluí', primary: true, onClick: async () => { show('<div>Continuando…</div>'); await send({ cmd: 'deleted' }); } }]);

    let card = null;
    const words = [norm(v.marca), norm(v.modelo)];
    for (let i = 0; i < 20 && !card; i++) {
      await sleep(600);
      const cands = [...document.querySelectorAll('[role="main"] div, [role="main"] a')].filter((d) => {
        const t = norm(d.innerText);
        return t.length < 400 && words.every((w) => t.includes(w)) && d.querySelector('[aria-label]');
      });
      card = cands.sort((a, b) => a.innerText.length - b.innerText.length)[0] || null;
    }
    if (!card) return manual('Não encontrei o anúncio na lista "Seus anúncios".');
    const more = [...card.querySelectorAll('[aria-label]')].find((x) => /mais|more|opç|opc/i.test(x.getAttribute('aria-label')));
    if (!more) return manual('Não encontrei o botão de opções do anúncio.');
    more.click(); await sleep(700);
    if (!(await clickByText(['Excluir anúncio', 'Excluir', 'Delete listing', 'Delete']))) return manual('Não encontrei a opção Excluir.');
    await sleep(700);
    const dialog = [...document.querySelectorAll('[role="dialog"]')].filter(visible).pop();
    if (!dialog || !(await clickByText(['Excluir', 'Delete', 'Excluir anúncio'], dialog))) return manual('Não consegui confirmar a exclusão.');
    await sleep(1200);
    // Pergunta opcional do Facebook sobre a venda
    await clickByText(['Prefiro não responder', 'Prefer not to answer', 'Não', 'No']);
    show('<div class="ok">Anúncio antigo excluído.</div>');
    await send({ cmd: 'deleted' });
  }

  /* ---------------- Mensagens do service worker ---------------- */
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.cmd === 'toast') show(`<div class="ok">${esc(msg.text)}</div>`);
    if (msg.cmd !== 'run') return;
    const c = msg.current;
    const url = location.href;
    if (c.phase === 'excluir' && url.includes('/marketplace/you/selling')) removeOld(c);
    else if (c.phase === 'preencher' && url.includes('/marketplace/create')) fill(c);
    else if (c.phase === 'aguardando_publicar' && url.includes('/marketplace/create')) {
      show('<div class="t">Aguardando você publicar</div><div>Clique em Avançar e Publicar no formulário do Facebook.</div>',
        [{ label: 'Preencher de novo', onClick: () => fill(c) }, { label: 'Já publiquei', onClick: () => send({ cmd: 'published' }) }]);
    }
  });
})();
