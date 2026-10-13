/* GiroAuto v2.0 — cadastro pela placa, proprietário, fotos prontas, importação, vender mais, gestão, equipe e app */
(function () {
  'use strict';
  const X = window.GiroExt;
  const { S, api, esc, brl, km, intl, modal, closeModal, toast, confirmBox, $, $$ } = new Proxy({}, { get: (_, k) => X[k] });
  const can = (p) => (S.me?.user?.perms || []).includes(p);
  const owner = () => S.me?.user?.role === 'admin';
  const num = (x) => parseInt(String(x ?? '').replace(/\D/g, ''), 10) || 0;
  const today = () => new Date().toISOString().slice(0, 10);
  const isMobile = () => /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || window.innerWidth < 760;
  const fmtDate = (d) => (d ? new Date(String(d).length <= 10 ? d + 'T12:00:00' : String(d).replace(' ', 'T') + 'Z').toLocaleDateString('pt-BR') : '');
  const opt = (list, val) => list.map(([k, l]) => `<option value="${esc(k)}" ${k === val ? 'selected' : ''}>${esc(l)}</option>`).join('');

  /* ======================= Cadastro pela placa ======================= */
  function setField(id, val) {
    const el = $('#v-' + id);
    if (!el || val === undefined || val === null || val === '') return false;
    if (el.tagName === 'SELECT') {
      const o = [...el.options].find((x) => x.value === String(val) || x.textContent === String(val));
      if (!o) return false;
      el.value = o.value;
    } else el.value = val;
    el.classList.add('filled'); setTimeout(() => el.classList.remove('filled'), 2500);
    return true;
  }
  function applyVehicleData(d) {
    const map = ['marca', 'modelo', 'versao', 'ano_fab', 'ano_modelo', 'cor', 'combustivel', 'fipe', 'placa'];
    let n = 0;
    for (const k of map) if (setField(k, d[k])) n++;
    if (d.fipe_codigo) { $('#v-fipe_codigo') && ($('#v-fipe_codigo').value = d.fipe_codigo); }
    if (d.fipe_ref) { $('#v-fipe_ref') && ($('#v-fipe_ref').value = d.fipe_ref); }
    if (d.municipio_placa) { $('#v-municipio_placa') && ($('#v-municipio_placa').value = d.municipio_placa); }
    const info = $('#plateInfo');
    if (info) info.innerHTML = `<div class="okbox">Preenchido: <b>${esc([d.marca, d.modelo, d.versao].filter(Boolean).join(' '))}</b>${d.ano_modelo ? ` · ${esc(d.ano_fab || '')}/${esc(d.ano_modelo)}` : ''}${d.fipe ? ` · FIPE ${brl(d.fipe)}${d.fipe_ref ? ` (${esc(d.fipe_ref)})` : ''}` : ''}. <span class="note">Fonte: ${esc(d.fonte || '')}. Confira antes de salvar.</span></div>`;
    return n;
  }

  async function plateSearch(placa, btn) {
    const info = $('#plateInfo');
    const p = String(placa || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(p)) { toast('Digite a placa no formato ABC1234 ou ABC1D23.'); return null; }
    if (btn) { btn.disabled = true; btn.textContent = 'Buscando…'; }
    if (info) info.innerHTML = '<div class="infobox">Buscando os dados da placa…</div>';
    try {
      let d = await api('GET', `/api/plate/${p}`);
      if (!d.encontrado && d.precisa_extensao) {
        if (info) info.innerHTML = '<div class="infobox">O site bloqueou a consulta pelo servidor. Tentando pelo seu navegador (extensão do GiroAuto)…</div>';
        const r = await X.extSend({ cmd: 'plateLookup', url: d.url }, 35000);
        if (r?.ok && r.html) d = await api('POST', `/api/plate/${p}/html`, { html: r.html }).catch(() => ({ encontrado: false }));
      }
      if (d.encontrado) { applyVehicleData(d); return d; }
      if (info) info.innerHTML = `<div class="warnbox">Não consegui os dados desta placa automaticamente${X.S.extInfo ? '' : ' (a extensão do Chrome ajuda quando o site bloqueia o servidor)'}. Use a <b>Tabela FIPE</b> ou preencha à mão.</div>`;
      fipeModal((f) => applyVehicleData({ ...f, placa: p }));
    } catch (e) { if (info) info.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
    finally { if (btn) { btn.disabled = false; btn.textContent = 'Buscar dados'; } }
    return null;
  }

  // Tabela FIPE gratuita: Tipo → Marca → Modelo → Ano.
  function fipeModal(onPick) {
    modal(`<h3>Tabela FIPE</h3><p>Escolha marca, modelo e ano. O GiroAuto preenche versão, combustível e o valor FIPE.</p>
      <div class="fields">
        <div class="f w6"><label for="fp-tipo">Tipo</label><select id="fp-tipo"><option value="carros">Carros e utilitários</option><option value="motos">Motos</option><option value="caminhoes">Caminhões</option></select></div>
        <div class="f w6"><label for="fp-marca">Marca</label><select id="fp-marca"><option>Carregando…</option></select></div>
        <div class="f w6"><label for="fp-modelo">Modelo</label><input id="fp-filtro" placeholder="Filtrar modelos (ex.: Onix LT)" style="margin-bottom:6px"><select id="fp-modelo" size="6" disabled></select></div>
        <div class="f w6"><label for="fp-ano">Ano / combustível</label><select id="fp-ano" disabled></select></div>
      </div>
      <div id="fp-res"></div><div class="err" id="fp-err" hidden></div>
      <div class="modal-foot"><button class="btn" data-close type="button">Cancelar</button><button class="btn primary" id="fp-ok" type="button" disabled>Preencher</button></div>`, true);
    let modelos = []; let picked = null;
    const err = (m) => { $('#fp-err').textContent = m; $('#fp-err').hidden = !m; };
    const tipo = () => $('#fp-tipo').value;
    const loadMarcas = async () => {
      try { const ms = await api('GET', `/api/fipe/${tipo()}/marcas`); $('#fp-marca').innerHTML = '<option value="">Selecione</option>' + ms.map((m) => `<option value="${m.codigo}">${esc(m.nome)}</option>`).join(''); err(''); }
      catch (e) { err(e.message); }
    };
    const renderModelos = () => {
      const q = $('#fp-filtro').value.toLowerCase().split(/\s+/).filter(Boolean);
      $('#fp-modelo').innerHTML = modelos.filter((m) => q.every((w) => m.nome.toLowerCase().includes(w))).slice(0, 300).map((m) => `<option value="${m.codigo}">${esc(m.nome)}</option>`).join('');
    };
    $('#fp-tipo').onchange = loadMarcas;
    $('#fp-marca').onchange = async () => {
      $('#fp-modelo').disabled = true; $('#fp-ano').disabled = true; $('#fp-ok').disabled = true;
      try { modelos = await api('GET', `/api/fipe/${tipo()}/marcas/${$('#fp-marca').value}/modelos`); renderModelos(); $('#fp-modelo').disabled = false; err(''); } catch (e) { err(e.message); }
    };
    $('#fp-filtro').oninput = renderModelos;
    $('#fp-modelo').onchange = async () => {
      try {
        const anos = await api('GET', `/api/fipe/${tipo()}/marcas/${$('#fp-marca').value}/modelos/${$('#fp-modelo').value}/anos`);
        $('#fp-ano').innerHTML = '<option value="">Selecione</option>' + anos.map((a) => `<option value="${esc(a.codigo)}">${esc(a.nome.replace(/^32000/, 'Zero km'))}</option>`).join('');
        $('#fp-ano').disabled = false; err('');
      } catch (e) { err(e.message); }
    };
    $('#fp-ano').onchange = async () => {
      try {
        picked = await api('GET', `/api/fipe/${tipo()}/marcas/${$('#fp-marca').value}/modelos/${$('#fp-modelo').value}/anos/${$('#fp-ano').value}`);
        $('#fp-res').innerHTML = `<div class="okbox"><b>${esc(picked.marca)} ${esc(picked.modelo)} ${esc(picked.versao)}</b> · ${esc(picked.ano_modelo)} · FIPE <b>${brl(picked.fipe)}</b> (${esc(picked.fipe_ref)})</div>`;
        $('#fp-ok').disabled = false; err('');
      } catch (e) { err(e.message); }
    };
    $('#fp-ok').onclick = () => { closeModal(); onPick({ ...picked, ano_fab: picked.ano_modelo }); };
    loadMarcas();
  }

  /* ======================= Formulário do veículo ======================= */
  function ownerPanelHtml(d) {
    const P = S.me.options.propriedade || [];
    const tipo = d.proprietario_tipo || 'proprio';
    const terceiro = tipo !== 'proprio';
    return `<div class="panel" id="ownerPanel" style="margin-top:16px">
      <h2>Proprietário e documentação</h2>
      <div class="owners">${P.map((p) => `<label class="check"><input type="radio" name="v-ptipo" value="${p.key}" ${p.key === tipo ? 'checked' : ''}><div><b>${esc(p.label.split(' (')[0])}</b>${p.label.includes('(') ? `<span>${esc(p.label.split('(')[1].replace(')', ''))}</span>` : ''}</div></label>`).join('')}</div>
      <div id="ownerExtra" ${terceiro ? '' : 'hidden'}>
        <div class="fields" style="margin-top:12px">
          <div class="f w3"><label for="v-proprietario_nome">Nome do proprietário</label><input id="v-proprietario_nome" value="${esc(d.proprietario_nome || '')}"></div>
          <div class="f w3"><label for="v-proprietario_tel">Telefone / WhatsApp</label><input id="v-proprietario_tel" value="${esc(d.proprietario_tel || '')}" inputmode="tel"></div>
          <div class="f"><label for="v-proprietario_doc">CPF / CNPJ</label><input id="v-proprietario_doc" value="${esc(d.proprietario_doc || '')}" inputmode="numeric"></div>
          <div class="f"><label for="v-consig_comissao_pct">Comissão da loja (%)</label><input id="v-consig_comissao_pct" value="${esc(d.consig_comissao_pct || '')}" inputmode="decimal" placeholder="ex.: 8"></div>
          <div class="f" id="procBox" ${tipo === 'procuracao' ? '' : 'hidden'}><label for="v-procuracao_validade">Procuração válida até</label><input id="v-procuracao_validade" type="date" value="${esc(d.procuracao_validade || '')}"></div>
          <div class="f w6"><label for="v-proprietario_obs">Combinado com o proprietário</label><textarea id="v-proprietario_obs" rows="2" placeholder="Valor mínimo, prazo, quem paga a preparação, chave reserva…">${esc(d.proprietario_obs || '')}</textarea></div>
        </div>
        <div id="procUpload" ${tipo === 'procuracao' ? '' : 'hidden'} style="margin-top:8px">${procHtml(d)}</div>
      </div>
      <h3 class="dest-h">Identificação</h3>
      <div class="fields">
        <div class="f"><label for="v-renavam">Renavam</label><input id="v-renavam" value="${esc(d.renavam || '')}" inputmode="numeric" maxlength="11"></div>
        <div class="f"><label for="v-chassi">Chassi</label><input id="v-chassi" value="${esc(d.chassi || '')}" maxlength="17" style="text-transform:uppercase"></div>
        <div class="f"><label for="v-municipio_placa">Município da placa</label><input id="v-municipio_placa" value="${esc(d.municipio_placa || '')}"></div>
        <input type="hidden" id="v-fipe_codigo" value="${esc(d.fipe_codigo || '')}"><input type="hidden" id="v-fipe_ref" value="${esc(d.fipe_ref || '')}">
      </div>
      <p class="note">Esses dados ficam só no painel da loja e não aparecem nos anúncios.</p>
    </div>`;
  }
  function procHtml(d) {
    if (!d.id) return '<p class="note">Salve o veículo para anexar a procuração (PDF ou foto).</p>';
    return d.tem_procuracao
      ? `<div class="okbox conn-row"><span>Procuração anexada.</span><span><a class="btn sm" href="/api/vehicles/${d.id}/procuracao" target="_blank" rel="noopener">Ver</a> <label class="btn sm">Trocar<input type="file" id="procFile" accept="application/pdf,image/jpeg,image/png" hidden></label> <button class="btn sm ghost danger" type="button" id="procDel">Remover</button></span></div>`
      : `<label class="drop" style="padding:12px"><b>Anexar procuração</b> (PDF ou foto, até 10 MB)<input type="file" id="procFile" accept="application/pdf,image/jpeg,image/png" hidden></label>`;
  }

  X.readDraft = (d) => {
    const t = $('input[name="v-ptipo"]:checked'); if (t) d.proprietario_tipo = t.value;
    ['proprietario_nome', 'proprietario_tel', 'proprietario_doc', 'consig_comissao_pct', 'procuracao_validade', 'proprietario_obs', 'renavam', 'chassi', 'municipio_placa', 'fipe_codigo', 'fipe_ref']
      .forEach((k) => { const el = $('#v-' + k); if (el) d[k] = el.value; });
  };

  function enhanceForm() {
    const d = S.draft; if (!d) return;
    // Busca pela placa no topo do formulário
    const dados = $('#v-marca')?.closest('.panel');
    if (dados && !$('#plateBar') && can('cadastrar')) {
      dados.querySelector('h2').insertAdjacentHTML('afterend', `<div class="platebar" id="plateBar">
        <div class="f"><label for="pb-placa">Placa</label><input id="pb-placa" value="${esc(d.placa || '')}" maxlength="8" placeholder="ABC1D23" style="text-transform:uppercase;font-family:var(--f-mono);font-size:18px"></div>
        <button class="btn primary" id="pbGo" type="button">Buscar dados</button>
        <button class="btn" id="pbFipe" type="button">Tabela FIPE</button>
      </div><div id="plateInfo"></div>`);
      $('#pbGo').onclick = () => { setField('placa', $('#pb-placa').value.toUpperCase().replace(/[^A-Z0-9]/g, '')); plateSearch($('#pb-placa').value, $('#pbGo')); };
      $('#pb-placa').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#pbGo').click(); } };
      $('#pbFipe').onclick = () => fipeModal((f) => applyVehicleData(f));
      const vp = $('#v-placa'); if (vp) vp.oninput = () => { $('#pb-placa').value = vp.value; };
    }
    // Proprietário e identificação
    if (!$('#ownerPanel') && dados) {
      dados.insertAdjacentHTML('beforeend', ownerPanelHtml(d));
      $$('input[name="v-ptipo"]').forEach((r) => { r.onchange = () => { $('#ownerExtra').hidden = r.value === 'proprio'; $('#procBox').hidden = r.value !== 'procuracao'; $('#procUpload').hidden = r.value !== 'procuracao'; }; });
      bindProc(d);
    }
    // Câmera no celular e ferramenta de desfoque
    const drop = $('#drop');
    if (drop && !$('#camBtn')) {
      drop.insertAdjacentHTML('afterend', `<div class="btnrow" style="margin-top:8px"><label class="btn" id="camBtn">📷 Tirar fotos<input type="file" id="camInput" accept="image/*" capture="environment" multiple hidden></label>${d.id ? '<span class="note">Dica: toque numa foto salva e use <b>Desfocar placa</b>.</span>' : ''}</div>`);
      $('#camInput').onchange = () => { const inp = $('#v-fotos'); const dt = new DataTransfer(); [...$('#camInput').files].forEach((f) => dt.items.add(f)); inp.files = dt.files; inp.dispatchEvent(new Event('change')); $('#camInput').value = ''; };
    }
    decoratePhotos(d);
    // Custos e margem do carro
    if (d.id && can('financeiro') && !$('#finBtn')) {
      const foot = $('#salvar')?.parentElement;
      foot?.insertAdjacentHTML('afterbegin', `<button class="btn ghost" id="finBtn" type="button">Custos e margem</button>`);
      $('#finBtn').onclick = () => financeModal(d.id);
    }
  }
  function bindProc(d) {
    const f = $('#procFile');
    if (f) f.onchange = async () => {
      const fd = new FormData(); fd.append('arquivo', f.files[0]);
      try { const v = await api('POST', `/api/vehicles/${d.id}/procuracao`, fd); d.tem_procuracao = v.tem_procuracao; $('#procUpload').innerHTML = procHtml(d); bindProc(d); toast('Procuração anexada'); }
      catch (e) { toast(e.message, 6000); }
    };
    const del = $('#procDel');
    if (del) del.onclick = () => confirmBox('Remover a procuração?', 'O arquivo anexado será apagado.', 'Remover', async () => {
      await api('DELETE', `/api/vehicles/${d.id}/procuracao`); d.tem_procuracao = false; $('#procUpload').innerHTML = procHtml(d); bindProc(d);
    }, true);
  }
  function decoratePhotos(d) {
    if (!d.id) return;
    $$('#photos .ph').forEach((el, i) => {
      const p = d.photos[i]; if (!p || el.querySelector('[data-blur]')) return;
      el.querySelector('.tools')?.insertAdjacentHTML('beforeend', `<button type="button" data-blur="${p.id}" title="Desfocar placa ou detalhe">Desfocar</button>`);
    });
    $$('[data-blur]').forEach((b) => { b.onclick = () => blurEditor(d, d.photos.find((p) => p.id === Number(b.dataset.blur))); });
  }

  // Desfoque manual: arraste um retângulo sobre a placa e salve.
  function blurEditor(d, photo) {
    modal(`<h3>Desfocar placa</h3><p>Arraste sobre a placa (ou o que quiser esconder). Pode marcar mais de uma área.</p>
      <div style="position:relative;max-height:60vh;overflow:auto"><canvas id="bl-c" style="max-width:100%;cursor:crosshair;touch-action:none;display:block"></canvas></div>
      <div class="modal-foot"><button class="btn" type="button" id="bl-undo">Desfazer</button><button class="btn" data-close type="button">Cancelar</button><button class="btn primary" id="bl-save" type="button" disabled>Salvar foto</button></div>`, true);
    const c = $('#bl-c'); const ctx = c.getContext('2d'); const img = new Image(); img.crossOrigin = 'anonymous';
    const rects = []; let start = null; let cur = null;
    const draw = () => {
      ctx.filter = 'none'; ctx.drawImage(img, 0, 0);
      for (const r of rects) {
        ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
        ctx.filter = `blur(${Math.max(12, Math.round(c.width / 60))}px)`; ctx.drawImage(img, 0, 0); ctx.restore();
      }
      ctx.filter = 'none';
      if (cur) { ctx.strokeStyle = '#efa91c'; ctx.lineWidth = Math.max(3, c.width / 300); ctx.strokeRect(cur.x, cur.y, cur.w, cur.h); }
      $('#bl-save').disabled = !rects.length;
    };
    img.onload = () => { c.width = img.naturalWidth; c.height = img.naturalHeight; draw(); };
    img.src = photo.url + (photo.url.includes('?') ? '&' : '?') + 'cors=1';
    const pos = (e) => { const r = c.getBoundingClientRect(); const t = e.touches?.[0] || e; return { x: (t.clientX - r.left) * (c.width / r.width), y: (t.clientY - r.top) * (c.height / r.height) }; };
    const down = (e) => { e.preventDefault(); start = pos(e); };
    const move = (e) => { if (!start) return; e.preventDefault(); const p = pos(e); cur = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) }; draw(); };
    const up = () => { if (cur && cur.w > 8 && cur.h > 8) rects.push(cur); start = null; cur = null; draw(); };
    c.addEventListener('mousedown', down); c.addEventListener('mousemove', move); window.addEventListener('mouseup', up, { once: false });
    c.addEventListener('touchstart', down, { passive: false }); c.addEventListener('touchmove', move, { passive: false }); c.addEventListener('touchend', up);
    $('#bl-undo').onclick = () => { rects.pop(); draw(); };
    $('#bl-save').onclick = async () => {
      $('#bl-save').disabled = true; $('#bl-save').textContent = 'Salvando…';
      try {
        const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
        const fd = new FormData(); fd.append('foto', blob, 'foto.jpg');
        const v = await api('PUT', `/api/vehicles/${d.id}/photos/${photo.id}/file`, fd);
        d.photos = v.photos; closeModal(); X.render(); toast('Foto salva com a área desfocada');
      } catch (e) { toast(e.message, 6000); $('#bl-save').disabled = false; $('#bl-save').textContent = 'Salvar foto'; }
    };
  }

  /* ======================= Estoque: carro parado, menu e atalhos ======================= */
  function enhanceStock() {
    const V = S.vehicles;
    const parados = V.filter((v) => v.parado);
    const head = $('.head');
    if (head && !$('#stockTools')) {
      head.querySelector('.btn.primary')?.insertAdjacentHTML('beforebegin', `<div class="btnrow" id="stockTools" style="gap:6px;flex-wrap:wrap">
        ${can('cadastrar') ? '<button class="btn" type="button" id="goImport">Importar planilha</button>' : ''}
        ${can('cadastrar') && isMobile() ? '<button class="btn" type="button" id="goQuick">Cadastro rápido</button>' : ''}
        <a class="btn" href="/tv/${esc(S.me.store.slug)}" target="_blank" rel="noopener" title="Abra no computador ligado à TV ou monitor da loja">Painel TV</a></div>`);
      $('#goImport') && ($('#goImport').onclick = () => X.go('importar'));
      $('#goQuick') && ($('#goQuick').onclick = () => X.go('rapido'));
      if (head.querySelector('#stockTools')) head.style.flexWrap = 'wrap';
    }
    if (parados.length && !$('#stalled')) {
      $('.strip')?.insertAdjacentHTML('beforebegin', `<div class="warnbox conn-row" id="stalled"><span><b>${parados.length} ${parados.length === 1 ? 'carro parado' : 'carros parados'}</b> há ${S.vehicles[0]?.parado_dias || 25} dias ou mais. Uma oferta com o preço de ocasião ajuda a girar.</span><button class="btn sm" type="button" id="stalledList">Ver e sugerir ofertas</button></div>`);
      $('#stalledList').onclick = () => stalledModal(parados);
    }
    // Selos e menu "Mais" em cada linha
    $$('.list .row').forEach((row) => {
      const id = Number(row.querySelector('[data-id]')?.dataset.id);
      const v = V.find((x) => x.id === id); if (!v || row.dataset.v2) return;
      row.dataset.v2 = '1';
      const st = row.querySelector('.state');
      if (st) {
        if (v.parado) st.insertAdjacentHTML('beforeend', `<button class="pill p-warn badge-btn" type="button" data-parado="${v.id}" title="Sugerir oferta">Parado ${v.dias_estoque} dias</button>`);
        if (v.local_status && v.local_status !== 'patio') st.insertAdjacentHTML('beforeend', `<span class="pill p-info" title="${esc(v.local_parceiro?.nome || '')}">${esc(v.local_label)}${v.local_parceiro ? ': ' + esc(v.local_parceiro.nome) : ''}</span>`);
        if (v.proprietario_tipo && v.proprietario_tipo !== 'proprio') st.insertAdjacentHTML('beforeend', `<span class="pill p-muted">${esc((S.me.options.propriedade.find((p) => p.key === v.proprietario_tipo)?.label || '').split(' (')[0])}</span>`);
      }
      const acts = row.querySelector('.actions');
      if (acts) acts.insertAdjacentHTML('beforeend', `<button class="btn sm ghost" type="button" data-more="${v.id}" aria-label="Mais opções">Mais ▾</button>`);
    });
    // Esconde ações sem permissão (o servidor também bloqueia)
    const need = { publicar: 'publicar', republicar: 'publicar', divulgar: 'publicar', vendido: 'vender', excluir: 'excluir', duplicar: 'cadastrar', editar: 'cadastrar' };
    $$('.list [data-act]').forEach((b) => { if (need[b.dataset.act] && !can(need[b.dataset.act])) b.hidden = true; });
    $$('[data-parado]').forEach((b) => { b.onclick = () => offerModal(V.find((x) => x.id === Number(b.dataset.parado))); });
    $$('[data-more]').forEach((b) => { b.onclick = (e) => moreMenu(V.find((x) => x.id === Number(b.dataset.more)), e.currentTarget); });
  }

  function moreMenu(v, anchor) {
    $('#moreMenu')?.remove();
    const items = [
      ['print-cor', 'Imprimir folha A4 (colorida)'], ['print-pb', 'Imprimir folha A4 (preto e branco)'], ['qr', 'QR code do carro'],
      can('precos') && v.status !== 'vendido' && ['offer', 'Criar oferta (preço de ocasião)'],
      can('parceiros') && v.status !== 'vendido' && ['loc', 'Localização (oficina, funilaria…)'],
      can('financeiro') && ['fin', 'Custos e margem'],
    ].filter(Boolean);
    const r = anchor.getBoundingClientRect();
    document.body.insertAdjacentHTML('beforeend', `<div class="menu" id="moreMenu" style="top:${r.bottom + window.scrollY + 4}px;left:${Math.max(8, r.right + window.scrollX - 260)}px">${items.map(([k, l]) => `<button type="button" data-mi="${k}">${esc(l)}</button>`).join('')}</div>`);
    const close = () => { $('#moreMenu')?.remove(); document.removeEventListener('click', away, true); };
    const away = (e) => { if (!e.target.closest('#moreMenu')) close(); };
    setTimeout(() => document.addEventListener('click', away, true), 0);
    $$('[data-mi]').forEach((b) => {
      b.onclick = () => {
        close();
        const k = b.dataset.mi;
        if (k === 'print-cor') window.open(`/imprimir/${v.id}?modo=cor`, '_blank');
        if (k === 'print-pb') window.open(`/imprimir/${v.id}?modo=pb`, '_blank');
        if (k === 'qr') qrModal(v);
        if (k === 'offer') offerModal(v);
        if (k === 'loc') locationModal(v);
        if (k === 'fin') financeModal(v.id);
      };
    });
  }

  function qrModal(v) {
    const url = `${location.origin}/v/${S.me.store.slug}/${v.id}`;
    modal(`<h3>QR code: ${esc(v.marca)} ${esc(v.modelo)}</h3><p>Leva à página do carro na vitrine, com fotos, preço e botão de WhatsApp.</p>
      <div style="text-align:center"><img src="/qr/${esc(S.me.store.slug)}/${v.id}.png" alt="QR code" style="width:240px;height:240px;border-radius:8px;background:#fff"></div>
      <div class="cfields"><div class="cf"><span class="k">Endereço</span><span class="v" style="font-size:12.5px;word-break:break-all">${esc(url)}</span><button class="btn sm" type="button" id="qrCp">Copiar</button></div></div>
      <div class="modal-foot"><a class="btn" href="/qr/${esc(S.me.store.slug)}/${v.id}.png" download="qr-${esc(v.modelo)}.png">Baixar imagem</a><button class="btn" type="button" onclick="window.open('/imprimir/${v.id}?modo=cor','_blank')">Folha A4</button><button class="btn primary" data-close type="button">Fechar</button></div>`);
    $('#qrCp').onclick = (e) => X.copyText(url, e.target);
  }

  function stalledModal(list) {
    modal(`<h3>Carros parados</h3><p>Há ${list[0]?.parado_dias || 25} dias ou mais no estoque. Crie uma oferta com um clique e republique com o preço de ocasião.</p>
      <div class="cfields">${list.sort((a, b) => b.dias_estoque - a.dias_estoque).map((v) => `<div class="cf"><span class="k">${esc(v.marca)} ${esc(v.modelo)}<br><span class="sub">${v.dias_estoque} dias</span></span><span class="v">${brl(v.preco_anuncio)}${v.fipe ? `<br><span class="sub">FIPE ${brl(v.fipe)} · ${v.fipe_diff_pct > 0 ? '+' : ''}${String(v.fipe_diff_pct).replace('.', ',')}%</span>` : ''}${v.oferta_ativa ? '<br><span class="pill p-warn">em oferta</span>' : ''}</span><button class="btn sm primary" type="button" data-of="${v.id}">Sugerir oferta</button></div>`).join('')}</div>
      <div class="modal-foot"><button class="btn" data-close type="button">Fechar</button></div>`, true);
    $$('[data-of]').forEach((b) => { b.onclick = () => offerModal(list.find((v) => v.id === Number(b.dataset.of))); });
  }

  async function offerModal(v) {
    if (!can('precos')) return toast('Seu usuário não pode alterar preços. Peça ao administrador da loja.');
    let s;
    try { s = await api('GET', `/api/vehicles/${v.id}/offer-suggestion`); } catch (e) { return toast(e.message); }
    const opts = [s.sugestao, Math.floor((s.preco * 0.95 + 100) / 1000) * 1000 - 100, Math.floor((s.preco * 0.9 + 100) / 1000) * 1000 - 100].filter((x, i, a) => x > 0 && x < s.preco && a.indexOf(x) === i);
    modal(`<h3>Oferta: ${esc(v.marca)} ${esc(v.modelo)}</h3>
      <p>${s.dias} dias no estoque · preço ${brl(s.preco)}${s.fipe ? ` · FIPE ${brl(s.fipe)} (${s.fipe_diff_pct > 0 ? '+' : ''}${String(s.fipe_diff_pct).replace('.', ',')}%)` : ''}.</p>
      <div class="chips">${opts.map((o, i) => `<button class="chip" type="button" data-op="${o}" aria-pressed="${i === 0}">${brl(o)}${i === 0 ? ' · sugerida' : ''}</button>`).join('')}</div>
      <div class="f"><label for="of-v">Preço de oferta (R$)</label><input id="of-v" inputmode="numeric" value="${opts[0] || ''}"></div>
      <p class="note">A arte, a legenda, o catálogo e o próximo preenchimento do Marketplace passam a usar a oferta, com o preço normal riscado.</p>
      <div class="err" id="of-err" hidden></div>
      <div class="modal-foot"><button class="btn" data-close type="button">Cancelar</button><button class="btn primary" id="of-ok" type="button">Criar oferta${s.publicado && can('publicar') ? ' e republicar' : ''}</button></div>`);
    $$('[data-op]').forEach((b) => { b.onclick = () => { $('#of-v').value = b.dataset.op; $$('[data-op]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }; });
    $('#of-ok').onclick = async () => {
      $('#of-ok').disabled = true;
      try {
        await api('POST', `/api/vehicles/${v.id}/offer`, { preco_oferta: num($('#of-v').value) });
        if (s.publicado && can('publicar')) {
          if (X.manualMode()) { closeModal(); await X.loadVehicles(); X.render(); toast('Oferta criada. Agora republique pelo assistente (botão Republicar com oferta).', 7000); return; }
          await api('POST', `/api/vehicles/${v.id}/republish`, { force: true }).catch(() => {});
          toast('Oferta criada e republicação na fila da extensão.', 6000);
        } else toast('Oferta criada');
        closeModal(); await X.loadVehicles(); X.render();
      } catch (e) { $('#of-err').textContent = e.message; $('#of-err').hidden = false; $('#of-ok').disabled = false; }
    };
  }

  /* ======================= Localização e parceiros ======================= */
  let PARTNERS = null;
  async function loadPartners(force) { if (!PARTNERS || force) PARTNERS = await api('GET', '/api/partners'); return PARTNERS; }

  async function locationModal(v) {
    const P = await loadPartners(true);
    const locais = Object.entries(P.locais);
    modal(`<h3>Onde está o ${esc(v.marca)} ${esc(v.modelo)}?</h3>
      <div class="fields">
        <div class="f w3"><label for="lc-st">Situação</label><select id="lc-st">${opt(locais, v.local_status || 'patio')}</select></div>
        <div class="f w3" id="lc-pbox"><label for="lc-p">Parceiro</label><select id="lc-p"><option value="">Selecione</option>${P.partners.map((p) => `<option value="${p.id}" ${p.id === v.local_parceiro?.id ? 'selected' : ''}>${esc(p.nome)} (${esc(p.tipo_label)})</option>`).join('')}</select><span class="hint"><a class="link" href="#gestao" data-close>Cadastrar parceiro</a></span></div>
        <div class="f w3" id="lc-prev"><label for="lc-d">Previsão de retorno</label><input id="lc-d" type="date" value="${esc(v.local_previsao || '')}"></div>
        <div class="f w6"><label for="lc-o">Serviço / observação</label><input id="lc-o" value="${esc(v.local_obs || '')}" placeholder="Ex.: troca de embreagem, polimento"></div>
      </div>
      <div class="err" id="lc-err" hidden></div>
      <div class="modal-foot"><button class="btn" data-close type="button">Cancelar</button><button class="btn primary" id="lc-ok" type="button">Salvar</button></div>`);
    const sync = () => { const p = $('#lc-st').value === 'patio'; $('#lc-pbox').hidden = p; $('#lc-prev').hidden = p; };
    $('#lc-st').onchange = sync; sync();
    $('#lc-ok').onclick = async () => {
      try {
        await api('PUT', `/api/vehicles/${v.id}/location`, { status: $('#lc-st').value, parceiro_id: $('#lc-p').value, previsao: $('#lc-d').value, obs: $('#lc-o').value });
        closeModal(); await X.loadVehicles(); X.render(); toast('Localização atualizada');
      } catch (e) { $('#lc-err').textContent = e.message; $('#lc-err').hidden = false; }
    };
  }

  function partnerForm(p = {}) {
    const P = PARTNERS;
    modal(`<h3>${p.id ? 'Editar parceiro' : 'Novo parceiro'}</h3>
      <div class="fields">
        <div class="f w3"><label for="pt-n">Nome</label><input id="pt-n" value="${esc(p.nome || '')}" placeholder="Oficina do Zé"></div>
        <div class="f w3"><label for="pt-t">Tipo</label><select id="pt-t">${opt(Object.entries(P.tipos), p.tipo || 'oficina')}</select></div>
        <div class="f w3"><label for="pt-c">Contato</label><input id="pt-c" value="${esc(p.contato || '')}" placeholder="José"></div>
        <div class="f w3"><label for="pt-w">WhatsApp</label><input id="pt-w" value="${esc(p.whatsapp || '')}" inputmode="tel" placeholder="(44) 99999-0000"></div>
        <div class="f w6"><label for="pt-e">Endereço</label><input id="pt-e" value="${esc(p.endereco || '')}"></div>
        <div class="f w6"><label for="pt-o">Observações</label><input id="pt-o" value="${esc(p.obs || '')}" placeholder="Horário, forma de pagamento…"></div>
      </div>
      <div class="err" id="pt-err" hidden></div>
      <div class="modal-foot">${p.id ? '<button class="btn ghost danger" type="button" id="pt-off">Desativar</button>' : ''}<button class="btn" data-close type="button">Cancelar</button><button class="btn primary" id="pt-ok" type="button">Salvar</button></div>`);
    const body = () => ({ nome: $('#pt-n').value, tipo: $('#pt-t').value, contato: $('#pt-c').value, whatsapp: $('#pt-w').value, endereco: $('#pt-e').value, obs: $('#pt-o').value });
    $('#pt-ok').onclick = async () => {
      try { PARTNERS = { ...PARTNERS, ...(await api(p.id ? 'PUT' : 'POST', p.id ? `/api/partners/${p.id}` : '/api/partners', body())) }; closeModal(); X.render(); }
      catch (e) { $('#pt-err').textContent = e.message; $('#pt-err').hidden = false; }
    };
    if ($('#pt-off')) $('#pt-off').onclick = async () => { await api('PUT', `/api/partners/${p.id}`, { ...body(), active: false }); await loadPartners(true); closeModal(); X.render(); };
  }

  /* ======================= Custos e margem ======================= */
  async function financeModal(id) {
    let F;
    try { F = await api('GET', `/api/vehicles/${id}/finance`); } catch (e) { return toast(e.message); }
    const v = F.vehicle; const f = F.finance;
    const consig = ['consignado', 'procuracao'].includes(v.proprietario_tipo);
    const sellers = await api('GET', '/api/team/sellers').catch(() => []);
    const lucro = (x, label) => (x ? `<div class="kpi"><span>${label}</span><b class="${x.liquido < 0 ? 'neg' : ''}">${brl(x.liquido)}</b><em>bruto ${brl(x.bruto)} · ${String(x.margem_pct).replace('.', ',')}% de margem</em></div>` : '');
    modal(`<h3>Custos e margem: ${esc(v.marca)} ${esc(v.modelo)}</h3>
      <div class="kpis">${f.falta_base ? `<div class="kpi"><span>Lucro previsto</span><b class="warn">—</b><em>Informe ${consig ? 'o repasse ao dono ou a comissão (no cadastro)' : 'o valor de compra'} abaixo para calcular.</em></div>` : ''}${lucro(f.previsto, `Lucro previsto (anúncio ${brl(v.preco_anuncio)})`)}${lucro(f.real, `Lucro real (venda ${brl(f.real?.venda)})`)}<div class="kpi"><span>Custos lançados</span><b>${brl(f.custos_total)}</b><em>${v.dias_estoque} dias no estoque</em></div></div>
      <h4>${consig ? 'Consignação' : 'Compra'}</h4>
      <div class="fields">
        ${consig ? `<div class="f"><label for="fn-rep">Repasse ao dono (R$)</label><input id="fn-rep" inputmode="numeric" value="${v.consig_repasse || ''}" placeholder="${v.consig_comissao_pct ? `ou ${String(v.consig_comissao_pct).replace('.', ',')}% de comissão` : ''}"></div>` : `<div class="f"><label for="fn-cv">Valor de compra (R$)</label><input id="fn-cv" inputmode="numeric" value="${v.compra_valor || ''}"></div>`}
        <div class="f"><label for="fn-cd">Data de entrada</label><input id="fn-cd" type="date" value="${esc(v.compra_data || '')}"></div>
        <div class="f"><label for="fn-cf">Comprado de</label><input id="fn-cf" value="${esc(v.compra_de || v.proprietario_nome || '')}"></div>
      </div>
      ${v.status === 'vendido' ? `<h4>Venda</h4><div class="fields">
        <div class="f"><label for="fn-vv">Valor de venda (R$)</label><input id="fn-vv" inputmode="numeric" value="${v.venda_valor || ''}"></div>
        <div class="f"><label for="fn-vc">Comissão do vendedor (R$)</label><input id="fn-vc" inputmode="numeric" value="${v.venda_comissao || ''}"></div>
        <div class="f"><label for="fn-vs">Vendedor</label><select id="fn-vs"><option value="">—</option>${sellers.map((s) => `<option value="${s.id}" ${s.id === v.venda_vendedor_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
        <div class="f w3"><label for="fn-vb">Comprador</label><input id="fn-vb" value="${esc(v.venda_comprador || '')}"></div>
        <div class="f w3"><label for="fn-vp">Pagamento</label><input id="fn-vp" value="${esc(v.venda_pagamento || '')}" placeholder="À vista, financiado, troca…"></div>
      </div>` : ''}
      <div class="form-foot" style="justify-content:flex-start"><button class="btn" type="button" id="fn-save">Salvar valores</button></div>
      <h4>Custos (preparação, documentação…)</h4>
      <div class="cfields">${F.costs.length ? F.costs.map((c) => `<div class="cf"><span class="k">${esc(c.categoria_label)}<br><span class="sub">${fmtDate(c.data)}${c.parceiro_nome ? ' · ' + esc(c.parceiro_nome) : ''}</span></span><span class="v">${esc(c.descricao || '')}<br><b>${brl(c.valor)}</b></span><button class="btn sm ghost danger" type="button" data-dc="${c.id}">Excluir</button></div>`).join('') : '<div class="cf"><span class="v sub">Nenhum custo lançado.</span></div>'}</div>
      <div class="fields" style="margin-top:8px">
        <div class="f"><label for="ct-c">Categoria</label><select id="ct-c">${opt(Object.entries(F.categorias), 'mecanica')}</select></div>
        <div class="f w3"><label for="ct-d">Descrição</label><input id="ct-d" placeholder="Ex.: troca de pastilhas"></div>
        <div class="f"><label for="ct-v">Valor (R$)</label><input id="ct-v" inputmode="numeric"></div>
        <div class="f w3"><label for="ct-p">Parceiro (opcional)</label><select id="ct-p"><option value="">—</option>${(await loadPartners()).partners.map((p) => `<option value="${p.id}" ${p.id === v.local_parceiro?.id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select></div>
        <div class="f"><label for="ct-dt">Data</label><input id="ct-dt" type="date" value="${today()}"></div>
        <div class="f" style="align-self:end"><button class="btn primary" type="button" id="ct-add">Lançar custo</button></div>
      </div>
      ${F.impostos_pct ? `<p class="note">O lucro líquido desconta ${String(F.impostos_pct).replace('.', ',')}% de impostos sobre a venda e a comissão do vendedor (ajuste em Configurações &gt; Gestão).</p>` : '<p class="note">Para descontar impostos sobre a venda no lucro líquido, informe o percentual em Configurações &gt; Gestão.</p>'}
      <div class="err" id="fn-err" hidden></div>
      <div class="modal-foot"><button class="btn primary" data-close type="button">Fechar</button></div>`, true);
    const err = (m) => { $('#fn-err').textContent = m; $('#fn-err').hidden = false; };
    $('#fn-save').onclick = async () => {
      const b = { compra_valor: $('#fn-cv')?.value ?? v.compra_valor, consig_repasse: $('#fn-rep')?.value ?? v.consig_repasse, compra_data: $('#fn-cd').value, compra_de: $('#fn-cf').value };
      if (v.status === 'vendido') Object.assign(b, { venda_valor: $('#fn-vv').value, venda_comissao: $('#fn-vc').value, venda_vendedor_id: $('#fn-vs').value, venda_comprador: $('#fn-vb').value, venda_pagamento: $('#fn-vp').value });
      try { await api('PUT', `/api/vehicles/${id}/finance`, b); toast('Valores salvos'); financeModal(id); } catch (e) { err(e.message); }
    };
    $('#ct-add').onclick = async () => {
      try { await api('POST', `/api/vehicles/${id}/costs`, { categoria: $('#ct-c').value, descricao: $('#ct-d').value, valor: $('#ct-v').value, parceiro_id: $('#ct-p').value, data: $('#ct-dt').value }); financeModal(id); }
      catch (e) { err(e.message); }
    };
    $$('[data-dc]').forEach((b) => { b.onclick = async () => { await api('DELETE', `/api/vehicles/${id}/costs/${b.dataset.dc}`); financeModal(id); }; });
  }

  /* ======================= Tela: Gestão ======================= */
  let gTab = 'local';
  X.views.gestao = {
    async html() {
      const P = await loadPartners(true);
      const V = S.vehicles.filter((v) => v.status !== 'vendido');
      const tabs = [['local', 'Localização dos carros'], can('financeiro') && ['fin', 'Custos e margem'], ['parc', 'Parceiros']].filter(Boolean);
      if (!tabs.some((t) => t[0] === gTab)) gTab = 'local';
      let body = '';
      if (gTab === 'local') {
        const grupos = Object.entries(P.locais).map(([k, l]) => [k, l, V.filter((v) => (v.local_status || 'patio') === k)]).filter(([k, , list]) => list.length || k === 'patio');
        body = `<div class="board">${grupos.map(([k, l, list]) => `<div class="col"><h3>${esc(l)} <span class="sub">${list.length}</span></h3>${list.map((v) => `
          <div class="card2">
            <div class="t">${esc(v.marca)} ${esc(v.modelo)} <span class="sub">${esc(v.placa || '')}</span></div>
            ${v.local_parceiro ? `<div class="sub">${esc(v.local_parceiro.nome)} · ${esc(v.local_parceiro.tipo)}${v.local_obs ? ' · ' + esc(v.local_obs) : ''}</div>
              <div class="sub">Há ${v.local_dias} dia(s)${v.local_previsao ? ` · previsão ${fmtDate(v.local_previsao)}` : ''}${v.local_previsao && v.local_previsao < today() ? ' <span class="pill p-bad">atrasado</span>' : ''}</div>` : `<div class="sub">${v.dias_estoque} dias no estoque${v.parado ? ' · <span class="pill p-warn">parado</span>' : ''}</div>`}
            <div class="btnrow" style="gap:6px;margin-top:6px">${v.followup_url ? `<a class="btn sm" href="${esc(v.followup_url)}" target="_blank" rel="noopener">Pedir andamento (WhatsApp)</a>` : ''}${can('parceiros') ? `<button class="btn sm ${k === 'patio' ? '' : 'ghost'}" type="button" data-loc="${v.id}">${k === 'patio' ? 'Enviar para…' : 'Mudar'}</button>` : ''}</div>
          </div>`).join('') || '<p class="sub">Nenhum carro.</p>'}</div>`).join('')}</div>
          <p class="note">"Pedir andamento" abre o WhatsApp do parceiro com a mensagem pronta (carro, placa e desde quando está lá). Envio 100% automático exige a API paga do WhatsApp Business.</p>`;
      }
      if (gTab === 'fin') {
        const linhas = V.map((v) => ({ v, f: v.financeiro || {} }));
        const tot = linhas.reduce((a, { f }) => ({ inv: a.inv + (f.investido || 0), lp: a.lp + (f.previsto?.liquido || 0) }), { inv: 0, lp: 0 });
        body = `<div class="kpis"><div class="kpi"><span>Capital no estoque</span><b>${brl(tot.inv)}</b><em>compra + custos dos carros próprios</em></div><div class="kpi"><span>Lucro previsto do estoque</span><b>${brl(tot.lp)}</b><em>pelos preços anunciados</em></div><div class="kpi"><span>Carros</span><b>${V.length}</b></div></div>
          <div class="table-wrap"><table class="tbl"><thead><tr><th>Veículo</th><th>Situação</th><th>Dias</th><th class="r">Compra / repasse</th><th class="r">Custos</th><th class="r">Anúncio</th><th class="r">Lucro previsto</th><th></th></tr></thead><tbody>
          ${linhas.map(({ v, f }) => `<tr><td><b>${esc(v.marca)} ${esc(v.modelo)}</b><br><span class="sub">${esc(v.placa || '')}</span></td><td>${esc((S.me.options.propriedade.find((p) => p.key === v.proprietario_tipo)?.label || '').split(' (')[0])}</td><td>${v.dias_estoque}</td>
            <td class="r">${f.previsto ? brl(f.previsto.base) : '—'}</td><td class="r">${brl(f.custos_total)}</td><td class="r">${brl(v.preco_anuncio)}</td>
            <td class="r ${f.previsto?.liquido < 0 ? 'neg' : ''}">${f.previsto ? `${brl(f.previsto.liquido)}<br><span class="sub">${String(f.previsto.margem_pct).replace('.', ',')}%</span>` : '—'}</td>
            <td><button class="btn sm" type="button" data-fin="${v.id}">Abrir</button></td></tr>`).join('')}</tbody></table></div>`;
      }
      if (gTab === 'parc') {
        body = `<div class="btnrow" style="margin-bottom:10px">${can('parceiros') ? '<button class="btn primary" type="button" id="ptNew">+ Novo parceiro</button>' : ''}</div>
          <div class="cfields">${P.partners.length ? P.partners.map((p) => `<div class="cf"><span class="k"><b>${esc(p.nome)}</b><br><span class="sub">${esc(p.tipo_label)}</span></span><span class="v">${esc(p.contato || '')} ${esc(p.whatsapp || '')}<br><span class="sub">${p.carros} carro(s) lá agora${p.endereco ? ' · ' + esc(p.endereco) : ''}</span></span><span class="btnrow" style="gap:6px">${p.wa ? `<a class="btn sm" href="https://wa.me/${p.wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}${can('parceiros') ? `<button class="btn sm" type="button" data-pe="${p.id}">Editar</button>` : ''}</span></div>`).join('') : '<div class="cf"><span class="v sub">Cadastre oficinas, funilarias, estética, lavador, lojas parceiras e despachante para saber onde cada carro está.</span></div>'}</div>`;
      }
      return `<div class="head"><div><h1>Gestão</h1><p>Onde cada carro está, quanto custou e quanto vai dar de lucro.</p></div></div>
        <div class="chips" style="margin-bottom:14px">${tabs.map(([k, l]) => `<button class="chip" type="button" data-gt="${k}" aria-pressed="${k === gTab}">${l}</button>`).join('')}</div>${body}`;
    },
    bind() {
      $$('[data-gt]').forEach((b) => { b.onclick = () => { gTab = b.dataset.gt; X.render(); }; });
      $$('[data-loc]').forEach((b) => { b.onclick = () => locationModal(S.vehicles.find((v) => v.id === Number(b.dataset.loc))); });
      $$('[data-fin]').forEach((b) => { b.onclick = () => financeModal(Number(b.dataset.fin)); });
      $$('[data-pe]').forEach((b) => { b.onclick = () => partnerForm(PARTNERS.partners.find((p) => p.id === Number(b.dataset.pe))); });
      if ($('#ptNew')) $('#ptNew').onclick = () => partnerForm();
    },
  };

  /* ======================= Tela: Resultados ======================= */
  const R = { from: '', to: '', tipo: '', vendedor: '', periodo: 'mes' };
  function periodRange(p) {
    const d = new Date(); const y = d.getFullYear(); const m = d.getMonth();
    const iso = (x) => x.toISOString().slice(0, 10);
    if (p === 'mes') return [iso(new Date(Date.UTC(y, m, 1))), iso(d)];
    if (p === 'anterior') return [iso(new Date(Date.UTC(y, m - 1, 1))), iso(new Date(Date.UTC(y, m, 0)))];
    if (p === '90') return [iso(new Date(Date.now() - 90 * 864e5)), iso(d)];
    if (p === 'ano') return [iso(new Date(Date.UTC(y, 0, 1))), iso(d)];
    return [R.from, R.to];
  }
  function bars(meses) {
    const max = Math.max(1, ...meses.map((m) => m.vendidos));
    const nome = (k) => new Date(k + '-15').toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
    return `<svg viewBox="0 0 600 190" class="chart" role="img" aria-label="Carros vendidos por mês">${meses.map((m, i) => {
      const h = Math.round((m.vendidos / max) * 120); const x = 30 + i * 95;
      return `<g><rect x="${x}" y="${150 - h}" width="56" height="${h}" rx="5" class="bar"></rect><text x="${x + 28}" y="${142 - h}" text-anchor="middle" class="bv">${m.vendidos}</text><text x="${x + 28}" y="170" text-anchor="middle" class="bl">${nome(m.mes)}</text><text x="${x + 28}" y="186" text-anchor="middle" class="bs">${m.lucro ? (m.lucro / 1000).toFixed(0) + ' mil' : ''}</text></g>`;
    }).join('')}</svg>`;
  }
  X.views.resultados = {
    async html() {
      if (!can('gestao')) return '<div class="err">Seu usuário não tem acesso aos resultados.</div>';
      const [from, to] = periodRange(R.periodo);
      const q = new URLSearchParams({ from: from || '', to: to || '', tipo: R.tipo, vendedor: R.vendedor });
      const [d, sellers] = await Promise.all([api('GET', '/api/results?' + q), api('GET', '/api/team/sellers').catch(() => [])]);
      const k = d.kpis;
      const card = (l, v, e = '', cls = '') => `<div class="kpi"><span>${l}</span><b class="${cls}">${v}</b>${e ? `<em>${e}</em>` : ''}</div>`;
      const fin = can('financeiro');
      return `<div class="head"><div><h1>Resultados</h1><p>${fmtDate(d.periodo.from)} a ${fmtDate(d.periodo.to)}</p></div></div>
        <div class="toolbar" style="flex-wrap:wrap;gap:8px">
          <div class="chips">${[['mes', 'Este mês'], ['anterior', 'Mês passado'], ['90', '90 dias'], ['ano', 'Este ano'], ['custom', 'Escolher']].map(([k2, l]) => `<button class="chip" type="button" data-rp="${k2}" aria-pressed="${R.periodo === k2}">${l}</button>`).join('')}</div>
          ${R.periodo === 'custom' ? `<input type="date" id="r-from" value="${esc(R.from)}"> <input type="date" id="r-to" value="${esc(R.to)}">` : ''}
          <select id="r-tipo"><option value="">Todos os tipos</option>${(S.me.options.propriedade || []).map((p) => `<option value="${p.key}" ${p.key === R.tipo ? 'selected' : ''}>${esc(p.label.split(' (')[0])}</option>`).join('')}</select>
          <select id="r-vend"><option value="">Todos os vendedores</option>${sellers.map((s) => `<option value="${s.id}" ${String(s.id) === String(R.vendedor) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
        </div>
        <div class="kpis">
          ${card('Vendidos', k.vendidos, `giro de ${k.giro}% do estoque`)}
          ${fin ? card('Faturamento', brl(k.faturamento), `ticket médio ${brl(k.ticket_medio)}`) : ''}
          ${fin ? card('Lucro bruto', brl(k.lucro_bruto), 'venda − compra/repasse − custos', k.lucro_bruto < 0 ? 'neg' : '') : ''}
          ${fin ? card('Lucro líquido', brl(k.lucro_liquido), `${String(k.margem_media_pct).replace('.', ',')}% de margem · média ${brl(k.lucro_medio)}/carro`, k.lucro_liquido < 0 ? 'neg' : '') : ''}
          ${card('Dias para vender', k.dias_medios_venda, 'média dos vendidos')}
          ${card('Estoque', k.estoque_qtd, `${brl(k.estoque_valor_venda)} em anúncios`)}
          ${fin ? card('Capital investido', brl(k.capital_investido), `lucro previsto ${brl(k.lucro_previsto_estoque)}`) : ''}
          ${card('Idade média do estoque', `${k.idade_media_estoque} dias`, `${k.parados} parado(s) ≥ ${d.parado_dias} dias · ${k.parados_60} ≥ 60 dias`, k.parados ? 'warn' : '')}
          ${card('Em manutenção / fora', k.em_manutencao, `${k.consignados} consignado(s) no estoque`)}
          ${fin ? card('Custo médio de preparação', brl(k.custo_medio_preparacao), 'por carro') : ''}
        </div>
        <div class="grid2" style="margin-top:16px">
          <div class="panel"><h2>Vendas por mês</h2>${bars(d.meses)}${fin ? '<p class="note">Abaixo de cada mês: lucro líquido.</p>' : ''}</div>
          <div class="panel"><h2>Vendidos no período</h2>${d.vendidos.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Veículo</th><th>Dias</th>${fin ? '<th class="r">Venda</th><th class="r">Líquido</th>' : ''}</tr></thead><tbody>${d.vendidos.map((l) => `<tr><td>${esc(l.titulo)}<br><span class="sub">${fmtDate(l.vendido_em)}</span></td><td>${l.dias}</td>${fin ? `<td class="r">${l.venda ? brl(l.venda) : '—'}</td><td class="r ${l.liquido < 0 ? 'neg' : ''}">${l.liquido !== null && l.venda ? `${brl(l.liquido)}<br><span class="sub">${String(l.margem_pct).replace('.', ',')}%</span>` : '—'}${fin ? `<br><button class="btn sm ghost" type="button" data-fin="${l.id}">custos</button>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table></div>` : '<p class="sub">Nenhuma venda no período.</p>'}
          ${k.sem_valor_venda ? `<p class="note">${k.sem_valor_venda} venda(s) sem valor informado: abra "custos" para completar.</p>` : ''}</div>
        </div>`;
    },
    bind() {
      $$('[data-rp]').forEach((b) => { b.onclick = () => { R.periodo = b.dataset.rp; if (R.periodo === 'custom' && !R.from) [R.from, R.to] = periodRange('mes'); X.render(); }; });
      if ($('#r-from')) { $('#r-from').onchange = () => { R.from = $('#r-from').value; X.render(); }; $('#r-to').onchange = () => { R.to = $('#r-to').value; X.render(); }; }
      $('#r-tipo') && ($('#r-tipo').onchange = () => { R.tipo = $('#r-tipo').value; X.render(); });
      $('#r-vend') && ($('#r-vend').onchange = () => { R.vendedor = $('#r-vend').value; X.render(); });
      $$('[data-fin]').forEach((b) => { b.onclick = () => financeModal(Number(b.dataset.fin)); });
    },
  };

  /* ======================= Tela: Importar planilha ======================= */
  let IMP = null;
  X.views.importar = {
    async html() {
      return `<div class="head"><div><h1>Importar estoque</h1><p>Cadastre muitos carros de uma vez a partir de uma planilha do Excel (.xlsx) ou CSV.</p></div></div>
        <div class="panel">
          <ol class="steps-list">
            <li>Baixe o modelo: <a class="btn sm" href="/api/import/modelo.xlsx">Excel (.xlsx)</a> <a class="btn sm" href="/api/import/modelo.csv">CSV</a> <span class="note">ou use a sua planilha: o GiroAuto reconhece colunas como Marca, Modelo, Ano, KM, Preço/Valor, Placa, Cor, Câmbio.</span></li>
            <li><label class="drop" style="padding:14px;display:block"><b>Escolher a planilha</b><input type="file" id="impFile" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></label></li>
            <li>Confira a prévia e clique em Importar. Os carros entram como rascunho: depois é só adicionar as fotos (pelo celular, em Cadastro rápido, é bem ágil).</li>
          </ol>
          <div class="err" id="impErr" hidden></div>
          <div id="impPrev">${IMP ? previewHtml(IMP) : ''}</div>
        </div>`;
    },
    bind() {
      $('#impFile').onchange = async () => {
        const fd = new FormData(); fd.append('planilha', $('#impFile').files[0]);
        $('#impErr').hidden = true; $('#impPrev').innerHTML = '<div class="loading">Lendo a planilha…</div>';
        try { IMP = await api('POST', '/api/import/preview', fd); $('#impPrev').innerHTML = previewHtml(IMP); bindImport(); }
        catch (e) { $('#impPrev').innerHTML = ''; $('#impErr').textContent = e.message; $('#impErr').hidden = false; }
      };
      bindImport();
    },
  };
  function previewHtml(p) {
    const ok = p.linhas.filter((l) => l.ok).length;
    return `<h3 class="dest-h">Colunas reconhecidas</h3><p class="note">${p.colunas.map((c) => c.campo ? `<b>${esc(c.planilha)}</b> → ${esc(c.campo)}` : `<s>${esc(c.planilha)}</s> (ignorada)`).join(' · ')}</p>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Placa</th><th>Veículo</th><th>Ano</th><th class="r">KM</th><th class="r">Preço</th><th>Situação</th><th>Avisos</th></tr></thead><tbody>
      ${p.linhas.slice(0, 300).map((l) => `<tr class="${l.ok ? '' : 'bad'}"><td>${esc(l.placa)}</td><td>${esc(l.marca)} ${esc(l.modelo)} <span class="sub">${esc(l.versao)}</span></td><td>${esc(l.ano_fab || '')}/${esc(l.ano_modelo || '')}</td><td class="r">${intl(l.km)}</td><td class="r">${l.preco ? brl(l.preco) : '—'}</td><td>${esc(l.proprietario_tipo)}</td><td>${l.problemas.map((x) => `<span class="pill ${l.ok ? 'p-warn' : 'p-bad'}">${esc(x)}</span>`).join(' ')}</td></tr>`).join('')}</tbody></table></div>
      <div class="form-foot"><span class="note">${ok} de ${p.linhas.length} linha(s) prontas para importar. Placas já cadastradas são puladas.</span><button class="btn primary" id="impGo" type="button" ${ok ? '' : 'disabled'}>Importar ${ok} veículo(s)</button></div>`;
  }
  function bindImport() {
    const b = $('#impGo'); if (!b) return;
    b.onclick = async () => {
      b.disabled = true; b.textContent = 'Importando…';
      try { const r = await api('POST', '/api/import/commit', { linhas: IMP.linhas.filter((l) => l.ok) }); IMP = null; await X.loadVehicles(); toast(`${r.importados} veículo(s) importado(s)${r.pulados ? `, ${r.pulados} pulado(s)` : ''}.`, 7000); X.go('estoque'); }
      catch (e) { toast(e.message, 7000); b.disabled = false; b.textContent = 'Importar'; }
    };
  }

  /* ======================= Tela: Cadastro rápido (celular) ======================= */
  let Q = null;
  X.views.rapido = {
    async html() {
      Q = Q || { files: [] };
      return `<div class="quick">
        <h1>Cadastro rápido</h1>
        <div class="f"><label for="q-placa">1. Placa</label><div class="platebar" style="margin:0"><input id="q-placa" maxlength="8" placeholder="ABC1D23" style="text-transform:uppercase;font-size:22px;font-family:var(--f-mono)" value="${esc(Q.placa || '')}"><button class="btn primary" id="q-go" type="button">Buscar</button></div></div>
        <div id="plateInfo"></div>
        <div class="fields" id="q-fields">
          <div class="f"><label for="v-marca">Marca</label><input id="v-marca" value="${esc(Q.marca || '')}"></div>
          <div class="f"><label for="v-modelo">Modelo</label><input id="v-modelo" value="${esc(Q.modelo || '')}"></div>
          <div class="f w6"><label for="v-versao">Versão</label><input id="v-versao" value="${esc(Q.versao || '')}"></div>
          <div class="f"><label for="v-ano_fab">Ano fab.</label><input id="v-ano_fab" inputmode="numeric" maxlength="4" value="${esc(Q.ano_fab || '')}"></div>
          <div class="f"><label for="v-ano_modelo">Ano modelo</label><input id="v-ano_modelo" inputmode="numeric" maxlength="4" value="${esc(Q.ano_modelo || '')}"></div>
          <div class="f"><label for="v-cor">Cor</label><select id="v-cor"><option value="">—</option>${S.me.options.cores.map((c) => `<option ${c === Q.cor ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
          <div class="f"><label for="v-combustivel">Combustível</label><select id="v-combustivel">${S.me.options.combustiveis.map((c) => `<option ${c === (Q.combustivel || 'Flex') ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
          <div class="f"><label for="v-cambio">Câmbio</label><select id="v-cambio"><option value="">—</option>${S.me.options.cambios.map((c) => `<option ${c === Q.cambio ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
          <div class="f"><label for="v-fipe">FIPE</label><input id="v-fipe" inputmode="numeric" value="${esc(Q.fipe || '')}"></div>
          <input type="hidden" id="v-placa" value="${esc(Q.placa || '')}"><input type="hidden" id="v-fipe_codigo"><input type="hidden" id="v-fipe_ref"><input type="hidden" id="v-municipio_placa">
          <div class="f"><label for="q-km">2. Quilometragem</label><input id="q-km" inputmode="numeric" style="font-size:20px" value="${esc(Q.km || '')}"></div>
          <div class="f"><label for="q-preco">3. Preço (R$)</label><input id="q-preco" inputmode="numeric" style="font-size:20px" value="${esc(Q.preco || '')}"></div>
        </div>
        <label class="btn primary big" style="margin-top:12px">📷 4. Tirar fotos (${Q.files.length})<input type="file" id="q-cam" accept="image/*" capture="environment" multiple hidden></label>
        <label class="btn" style="margin-top:6px">Escolher da galeria<input type="file" id="q-gal" accept="image/*" multiple hidden></label>
        <div class="photos" id="q-ph">${Q.files.map((f, i) => `<div class="ph ${i === 0 ? 'cover' : ''}"><img src="${f.preview}" alt="">${i === 0 ? '<span class="tag">CAPA</span>' : ''}<div class="tools"><span></span><button type="button" data-qr="${i}">Remover</button></div></div>`).join('')}</div>
        <div class="err" id="q-err" hidden></div>
        <button class="btn primary big" id="q-save" type="button" style="margin-top:12px">5. Salvar veículo</button>
        <p class="note">Depois dá para completar destaques, descrição e proprietário em Editar.</p>
      </div>`;
    },
    bind() {
      const keep = () => { ['marca', 'modelo', 'versao', 'ano_fab', 'ano_modelo', 'cor', 'combustivel', 'cambio', 'fipe'].forEach((k) => { Q[k] = $('#v-' + k).value; }); Q.placa = $('#q-placa').value.toUpperCase().replace(/[^A-Z0-9]/g, ''); Q.km = $('#q-km').value; Q.preco = $('#q-preco').value; };
      $('#q-go').onclick = async () => { keep(); $('#v-placa').value = Q.placa; const d = await plateSearch(Q.placa, $('#q-go')); if (d) keep(); };
      const add = (files) => { keep(); [...files].forEach((f) => Q.files.push({ file: f, preview: URL.createObjectURL(f) })); X.render(); };
      $('#q-cam').onchange = () => add($('#q-cam').files);
      $('#q-gal').onchange = () => add($('#q-gal').files);
      $$('[data-qr]').forEach((b) => { b.onclick = () => { keep(); Q.files.splice(Number(b.dataset.qr), 1); X.render(); }; });
      $('#q-save').onclick = async () => {
        keep();
        const btn = $('#q-save'); btn.disabled = true; btn.textContent = 'Salvando…';
        try {
          const body = { marca: Q.marca, modelo: Q.modelo, versao: Q.versao, ano_fab: Q.ano_fab, ano_modelo: Q.ano_modelo, cor: Q.cor, combustivel: Q.combustivel, cambio: Q.cambio, fipe: Q.fipe, placa: Q.placa, km: Q.km, preco: Q.preco,
            fipe_codigo: $('#v-fipe_codigo').value, fipe_ref: $('#v-fipe_ref').value, municipio_placa: $('#v-municipio_placa').value, cor_interna: 'Preto' };
          let v = await api('POST', '/api/vehicles', body);
          for (let i = 0; i < Q.files.length; i += 5) {
            const fd = new FormData(); Q.files.slice(i, i + 5).forEach((f) => fd.append('fotos', f.file, f.file.name || 'foto.jpg'));
            v = await api('POST', `/api/vehicles/${v.id}/photos`, fd);
          }
          await api('POST', `/api/vehicles/${v.id}/ready`).catch(() => null);
          Q = null; await X.loadVehicles(); toast('Veículo cadastrado!', 5000); location.hash = 'editar-' + v.id;
        } catch (e) { $('#q-err').textContent = e.message; $('#q-err').hidden = false; btn.disabled = false; btn.textContent = '5. Salvar veículo'; }
      };
    },
  };

  /* ======================= Configurações: equipe, fotos, agenda, gestão, app ======================= */
  async function enhanceConfig() {
    const col = $('#main .grid2 > .stack');
    if (!col || $('#cfgV2')) return;
    col.insertAdjacentHTML('beforeend', '<div id="cfgV2" class="stack"><div class="loading">Carregando…</div></div>');
    const [sch, fot, team] = await Promise.all([
      api('GET', '/api/store/schedule').catch(() => null), api('GET', '/api/store/photos').catch(() => null), owner() ? api('GET', '/api/team').catch(() => null) : null,
    ]);
    const st = S.me.store;
    const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const cfgOk = can('config');
    $('#cfgV2').innerHTML = `
      ${team ? `<div class="panel" id="cfgTeam"><h2>Equipe</h2><p class="lead">Cada vendedor entra com o próprio e-mail. Você escolhe o que cada um pode fazer.</p>
        <div class="cfields">${team.users.map((u) => `<div class="cf"><span class="k"><b>${esc(u.name)}</b><br><span class="sub">${esc(u.email)}</span></span><span class="v">${u.role === 'admin' ? '<span class="pill p-ok">Administrador da loja</span>' : `${u.active ? '' : '<span class="pill p-bad">desativado</span> '}<span class="sub">${u.permissions.length} permissão(ões)</span>`}</span>${u.role === 'admin' ? '<span></span>' : `<button class="btn sm" type="button" data-tu="${u.id}">Editar</button>`}</div>`).join('')}</div>
        <div class="form-foot"><button class="btn primary" type="button" id="tuNew">+ Adicionar vendedor</button></div></div>` : ''}
      <div class="panel"><h2>Republicação agendada</h2>
        ${sch?.pub_mode !== 'extensao' ? '<div class="infobox">Funciona com a publicação automática (extensão do Chrome). Ative em <b>Publicação no Marketplace</b>, nesta página.</div>' : ''}
        <p class="lead">Nos dias e horários escolhidos, a extensão republica sozinha os carros com ${S.me.republish_days}+ dias de anúncio (ou com oferta nova), respeitando o limite diário. <b>Sem nenhum clique</b>, desde que o computador fique ligado, com o Chrome aberto e logado no Facebook.</p>
        <label class="check"><input type="checkbox" id="sc-on" ${sch?.ativo ? 'checked' : ''} ${cfgOk ? '' : 'disabled'}><div><b>Ativar republicação agendada</b><span>${sch?.prontos || 0} carro(s) prontos para republicar agora.</span></div></label>
        <div class="chips" style="margin:10px 0">${dias.map((d, i) => `<label class="chip"><input type="checkbox" data-sd="${i}" ${sch?.dias.includes(i) ? 'checked' : ''} ${cfgOk ? '' : 'disabled'}> ${d}</label>`).join('')}</div>
        <div class="fields">
          <div class="f w3"><label for="sc-h">Horários (separe por vírgula)</label><input id="sc-h" value="${esc((sch?.horarios || []).join(', '))}" placeholder="09:00, 15:00" ${cfgOk ? '' : 'disabled'}></div>
          <div class="f w3"><label for="sc-n">Carros por horário</label><input id="sc-n" inputmode="numeric" value="${esc(sch?.por_vez || 3)}" ${cfgOk ? '' : 'disabled'}><span class="hint">Limite diário atual: ${sch?.daily_limit || st.daily_limit} publicações.</span></div>
        </div>
        ${cfgOk ? '<div class="form-foot"><button class="btn primary" type="button" id="sc-save">Salvar agenda</button></div>' : ''}</div>
      <div class="panel"><h2>Fotos prontas</h2><p class="lead">Opções aplicadas às fotos novas, no envio. Nada disso vem ligado.</p>
        <label class="check"><input type="checkbox" id="fo-r" ${fot?.reduzir ? 'checked' : ''} ${cfgOk ? '' : 'disabled'}><div><b>Reduzir o tamanho das fotos</b><span>Até ${fot?.max_lado || 1600} px no lado maior, em JPEG. Fotos mais leves sobem mais rápido.</span></div></label>
        <label class="check" style="margin-top:8px"><input type="checkbox" id="fo-w" ${fot?.marca_dagua ? 'checked' : ''} ${cfgOk ? '' : 'disabled'}><div><b>Marca d'água com o logo da loja</b><span>O logo vai no canto escolhido de cada foto nova.</span></div></label>
        <div class="fields" style="margin-top:8px">
          <div class="f w3"><label>Logo da loja</label>${fot?.logo_url ? `<img src="${esc(fot.logo_url)}" alt="Logo" style="max-height:60px;max-width:180px;background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/12px 12px;border-radius:6px">` : '<span class="sub">Nenhum logo enviado.</span>'}${cfgOk ? '<label class="btn sm" style="margin-top:6px">Enviar logo (PNG transparente)<input type="file" id="fo-logo" accept="image/png,image/jpeg,image/webp" hidden></label>' : ''}</div>
          <div class="f"><label for="fo-pos">Posição</label><select id="fo-pos" ${cfgOk ? '' : 'disabled'}>${opt([['inferior_direita', 'Inferior direita'], ['inferior_esquerda', 'Inferior esquerda'], ['superior_direita', 'Superior direita'], ['superior_esquerda', 'Superior esquerda'], ['centro', 'Centro']], fot?.posicao)}</select></div>
          <div class="f"><label for="fo-op">Opacidade (%)</label><input id="fo-op" inputmode="numeric" value="${esc(fot?.opacidade || 70)}" ${cfgOk ? '' : 'disabled'}></div>
        </div>
        <p class="note">Desfocar a placa: no cadastro do veículo, toque em <b>Desfocar</b> na foto e arraste sobre a placa.</p>
        ${cfgOk ? '<div class="form-foot"><button class="btn primary" type="button" id="fo-save">Salvar opções de fotos</button></div>' : ''}</div>
      <div class="panel"><h2>Gestão</h2>
        <div class="fields">
          <div class="f w3"><label for="g-dias">Avisar carro parado após (dias)</label><input id="g-dias" inputmode="numeric" value="${esc(st.parado_dias || 25)}" ${cfgOk ? '' : 'disabled'}></div>
          <div class="f w3"><label for="g-imp">Impostos sobre a venda (%)</label><input id="g-imp" inputmode="decimal" value="${esc(String(st.impostos_pct || 0).replace('.', ','))}" ${cfgOk ? '' : 'disabled'}><span class="hint">Descontado no lucro líquido.</span></div>
        </div>
        ${cfgOk ? '<div class="form-foot"><button class="btn primary" type="button" id="g-save">Salvar</button></div>' : ''}</div>
      <div class="panel"><h2>Painel na TV da loja</h2><p class="lead">Mostra os carros disponíveis em tela cheia, trocando a cada 10 segundos, com preço e QR code. Atualiza sozinho.</p>
        <div class="cfields"><div class="cf"><span class="k">Endereço</span><span class="v" style="font-size:12.5px;word-break:break-all">${esc(location.origin)}/tv/${esc(st.slug)}</span><a class="btn sm" href="/tv/${esc(st.slug)}" target="_blank" rel="noopener">Abrir</a></div></div>
        <p class="note">Abra no computador ou TV box ligado ao monitor e clique uma vez na tela para tela cheia.</p></div>
      <div class="panel"><h2>App no celular</h2><p class="lead">Instale o GiroAuto na tela inicial do celular para cadastrar no pátio com a câmera.</p>
        <div class="btnrow">${X.installEvt ? '<button class="btn primary" id="appInstall" type="button">Instalar app</button>' : '<span class="note">No celular: abra este painel no Chrome (Android) e toque em <b>⋮ &gt; Instalar app</b>, ou no Safari (iPhone) em <b>Compartilhar &gt; Adicionar à Tela de Início</b>.</span>'}</div></div>`;
    // Equipe
    if (team) {
      $('#tuNew').onclick = () => userModal(null, team);
      $$('[data-tu]').forEach((b) => { b.onclick = () => userModal(team.users.find((u) => u.id === Number(b.dataset.tu)), team); });
    }
    if ($('#sc-save')) $('#sc-save').onclick = async () => {
      try {
        await api('PUT', '/api/store/schedule', { ativo: $('#sc-on').checked, dias: $$('[data-sd]').filter((c) => c.checked).map((c) => Number(c.dataset.sd)), horarios: $('#sc-h').value.split(/[,;\s]+/).filter(Boolean).map((h) => (h.length === 4 ? '0' + h : h)), por_vez: $('#sc-n').value });
        toast('Agenda salva');
      } catch (e) { toast(e.message, 6000); }
    };
    if ($('#fo-save')) $('#fo-save').onclick = async () => {
      try { await api('PUT', '/api/store/photos', { reduzir: $('#fo-r').checked, marca_dagua: $('#fo-w').checked, posicao: $('#fo-pos').value, opacidade: $('#fo-op').value }); toast('Opções de fotos salvas'); }
      catch (e) { toast(e.message, 6000); }
    };
    if ($('#fo-logo')) $('#fo-logo').onchange = async () => {
      const fd = new FormData(); fd.append('logo', $('#fo-logo').files[0]);
      try { await api('POST', '/api/store/logo', fd); toast('Logo enviado'); X.render(); } catch (e) { toast(e.message, 6000); }
    };
    if ($('#g-save')) $('#g-save').onclick = async () => {
      try { const r = await api('PUT', '/api/store/gestao', { parado_dias: $('#g-dias').value, impostos_pct: $('#g-imp').value }); Object.assign(S.me.store, r); toast('Ajustes de gestão salvos'); }
      catch (e) { toast(e.message, 6000); }
    };
    if ($('#appInstall')) $('#appInstall').onclick = async () => { X.installEvt.prompt(); await X.installEvt.userChoice; X.installEvt = null; };
  }

  function userModal(u, team) {
    const perms = Object.entries(team.perms);
    const has = (p) => (u ? u.permissions.includes(p) : team.default_seller.includes(p));
    modal(`<h3>${u ? 'Editar ' + esc(u.name) : 'Novo vendedor'}</h3>
      <div class="fields">
        <div class="f w3"><label for="tu-n">Nome</label><input id="tu-n" value="${esc(u?.name || '')}"></div>
        <div class="f w3"><label for="tu-e">E-mail (login)</label><input id="tu-e" type="email" value="${esc(u?.email || '')}" ${u ? 'disabled' : ''}></div>
        <div class="f w3"><label for="tu-s">${u ? 'Nova senha (opcional)' : 'Senha inicial'}</label><input id="tu-s" type="text" autocomplete="off" placeholder="mínimo 8 caracteres"></div>
      </div>
      <h4>O que pode fazer</h4>
      <div class="checks">${perms.map(([k, l]) => `<label class="check" style="padding:8px 10px"><input type="checkbox" data-tp="${k}" ${has(k) ? 'checked' : ''}><div><b style="font-weight:500">${esc(l)}</b></div></label>`).join('')}</div>
      <div class="err" id="tu-err" hidden></div>
      <div class="modal-foot">${u ? `<button class="btn ghost ${u.active ? 'danger' : ''}" type="button" id="tu-act">${u.active ? 'Desativar acesso' : 'Reativar acesso'}</button>` : ''}<button class="btn" data-close type="button">Cancelar</button><button class="btn primary" id="tu-ok" type="button">Salvar</button></div>`, true);
    const perms_ = () => $$('[data-tp]').filter((c) => c.checked).map((c) => c.dataset.tp);
    $('#tu-ok').onclick = async () => {
      try {
        if (u) await api('PUT', `/api/team/${u.id}`, { name: $('#tu-n').value, permissions: perms_(), ...($('#tu-s').value ? { senha: $('#tu-s').value } : {}) });
        else await api('POST', '/api/team', { name: $('#tu-n').value, email: $('#tu-e').value, senha: $('#tu-s').value, permissions: perms_() });
        closeModal(); toast(u ? 'Vendedor atualizado' : 'Vendedor adicionado. Passe o e-mail e a senha para ele entrar.', 6000); X.render();
      } catch (e) { $('#tu-err').textContent = e.message; $('#tu-err').hidden = false; }
    };
    if ($('#tu-act')) $('#tu-act').onclick = async () => { await api('PUT', `/api/team/${u.id}`, { active: !u.active }); closeModal(); X.render(); };
  }

  /* ======================= Navegação e app instalável ======================= */
  function navSetup() {
    const nav = $('.nav'); if (!nav || $('[data-view="gestao"]')) return;
    const cfg = nav.querySelector('[data-view="config"]');
    cfg.insertAdjacentHTML('beforebegin', `
      <button data-view="gestao"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v16"/></svg>Gestão</button>
      ${can('gestao') ? '<button data-view="resultados"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>Resultados</button>' : ''}`);
    $$('.nav [data-view="gestao"], .nav [data-view="resultados"]').forEach((b) => b.addEventListener('click', () => { if (location.hash === '#' + b.dataset.view) X.route(); else location.hash = b.dataset.view; }));
    // Esconde o que o vendedor não pode usar
    if (!can('campanhas')) nav.querySelector('[data-view="campanhas"]')?.setAttribute('hidden', '');
    if (!can('cadastrar')) nav.querySelector('[data-view="novo"]')?.setAttribute('hidden', '');
  }

  X.after = (view) => {
    navSetup();
    $$('.nav button').forEach((b) => { if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    if (view === 'novo') enhanceForm();
    if (view === 'estoque') enhanceStock();
    if (view === 'config') enhanceConfig();
  };

  // App instalável (PWA)
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); X.installEvt = e; });
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
})();
