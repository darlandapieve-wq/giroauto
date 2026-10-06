// Janela-ponte: entrega à aba do Facebook (que abriu esta janela) os dados e as fotos do veículo.
(function () {
  const box = document.getElementById('box');
  const FB = ['https://www.facebook.com', 'https://web.facebook.com', 'https://m.facebook.com'];
  // Em teste local, aceita também a imitação do Facebook servida em outra porta.
  if (['localhost', '127.0.0.1'].includes(location.hostname)) FB.push('http://127.0.0.1:4600', 'http://localhost:4600');
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const set = (html) => { box.innerHTML = html; };
  let data = null;

  async function api(method, url, body) {
    const r = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || 'Erro ' + r.status); e.status = r.status; throw e; }
    return j;
  }

  async function start() {
    let cur;
    try { cur = await api('GET', '/api/assist/current'); }
    catch (e) {
      if (e.status === 401) {
        set(`<b>Entre no GiroAuto</b><span class="muted">Faça login na aba do painel e depois clique em Tentar de novo.</span>
          <a class="btn" href="/" target="_blank" rel="noopener">Abrir o painel</a><button class="p" id="again">Tentar de novo</button>`);
        document.getElementById('again').onclick = start; return;
      }
      set(`<div class="err">${esc(e.message)}</div><span class="muted">No painel, abra o veículo e clique em <b>Preencher automaticamente</b>.</span><button id="again">Tentar de novo</button>`);
      document.getElementById('again').onclick = start; return;
    }
    const v = cur.vehicle;
    set(`<div class="row">${v.photos[0] ? `<img src="${esc(v.photos[0].url)}" alt="">` : ''}<div><b>${esc(v.titulo)}</b><div class="muted">${v.photos.length} foto(s)</div></div></div>
      <span class="muted" id="st">Preparando as fotos…</span>`);
    const files = [];
    for (const [i, p] of v.photos.slice(0, 20).entries()) {
      const b = await (await fetch(new URL(p.url).pathname)).blob();
      files.push(new File([b], `${String(i + 1).padStart(2, '0')}.${(b.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`, { type: b.type || 'image/jpeg' }));
    }
    data = { vehicle: v, files, version: cur.version };
    send();
  }

  function send() {
    const st = document.getElementById('st');
    if (!window.opener) {
      st.outerHTML = `<div class="err">Não consegui falar com a aba do Facebook.</div>
        <span class="muted">Copie os dados e cole na caixa do GiroAuto que aparece no Facebook. Adicione as fotos à mão.</span>
        <button class="p" id="copy">Copiar dados</button>`;
      document.getElementById('copy').onclick = copyData;
      return;
    }
    // Só envia para o Facebook. Se a aba que abriu esta janela for outro site, a mensagem é descartada pelo navegador.
    FB.forEach((o) => { try { window.opener.postMessage({ type: 'giro-data', vehicle: data.vehicle, files: data.files, version: data.version }, o); } catch { /* origem diferente */ } });
    st.outerHTML = `<div class="ok">Dados enviados ao Facebook. Acompanhe o preenchimento na outra aba.</div>
      <span class="muted" id="st2">Depois de clicar em Publicar no Facebook, esta janela registra a publicação e fecha sozinha.</span>
      <div class="row" style="flex-wrap:wrap"><button id="resend">Enviar de novo</button><button id="copy">Copiar dados</button><button class="p" id="done">Já publiquei</button></div>`;
    document.getElementById('resend').onclick = send;
    document.getElementById('copy').onclick = copyData;
    document.getElementById('done').onclick = () => markPublished('');
  }

  async function copyData() {
    const txt = JSON.stringify({ vehicle: data.vehicle });
    try { await navigator.clipboard.writeText(txt); alertOk('Dados copiados. Cole na caixa do GiroAuto no Facebook.'); }
    catch { prompt('Copie os dados abaixo (Ctrl+C):', txt); }
  }
  function alertOk(msg) { const n = document.createElement('div'); n.className = 'ok'; n.textContent = msg; box.appendChild(n); setTimeout(() => n.remove(), 4000); }

  async function markPublished(url) {
    try {
      await api('POST', `/api/vehicles/${data.vehicle.id}/mark-published`, { listing_url: url || '' });
      set(`<div class="ok"><b>Publicação registrada no GiroAuto.</b></div><span class="muted">Esta janela fecha em instantes.</span>`);
      setTimeout(() => window.close(), 2500);
    } catch (e) { set(`<div class="err">${esc(e.message)}</div>`); }
  }

  window.addEventListener('message', (e) => {
    if (!FB.includes(e.origin) || e.source !== window.opener || !e.data || e.data.type !== 'giro-published' || !data) return;
    if (Number(e.data.vehicle_id) !== data.vehicle.id) return;
    const u = String(e.data.url || '');
    markPublished(/^https:\/\/(www\.|web\.|m\.)?facebook\.com\//.test(u) ? u : '');
  });

  start();
})();
