/* GiroAuto v2.1 — cadastro pela placa, proprietário, fotos prontas, importação, vender mais, gestão, equipe e app */
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
  // Propriedades em que a loja ganha uma margem: consignado, parceria e outro (v2.2).
  const TERC = ['consignado', 'parceria', 'outro'];
  const decimal = (x) => Number(String(x ?? '').replace(/\./g, '').replace(',', '.')) || 0;
  // Base do lucro: compra (próprio) ou o que vai para o dono (repasse combinado, venda − margem fixa, venda × (1 − margem %)).
  function baseCalc(o, venda) {
    if (!TERC.includes(o.tipo)) return o.compra || 0;
    if (o.repasse) return o.repasse;
    if (o.margemTipo === 'valor' && o.margemValor) return Math.max(0, venda - o.margemValor);
    if (o.margemTipo !== 'valor' && o.margemValor) return Math.round(venda * (1 - o.margemValor / 100));
    return o.compra || 0;
  }
  const baseOfVehicle = (v, venda) => baseCalc({ tipo: v.proprietario_tipo, repasse: v.consig_repasse, compra: v.compra_valor, margemTipo: v.margem_tipo, margemValor: v.margem_tipo === 'valor' ? v.margem_fixa : v.consig_comissao_pct }, venda);
  const margemTxt = (v) => (v.margem_tipo === 'valor' && v.margem_fixa ? brl(v.margem_fixa) : v.consig_comissao_pct ? `${String(v.consig_comissao_pct).replace('.', ',')}%` : '');
  // Link do WhatsApp para um telefone brasileiro (com ou sem 55).
  const waLink = (tel, msg) => { const d = String(tel || '').replace(/\D/g, ''); if (d.length < 10) return ''; const n = d.length >= 12 && d.startsWith('55') ? d : '55' + d; return `https://wa.me/${n}${msg ? '?text=' + encodeURIComponent(msg) : ''}`; };
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
    if (info) {
      const ops = d.fipe_opcoes || [];
      info.innerHTML = `<div class="okbox">Preenchido: <b>${esc([d.marca, d.modelo, d.versao].filter(Boolean).join(' '))}</b>${d.ano_modelo ? ` · ${esc(d.ano_fab || '')}/${esc(d.ano_modelo)}` : ''}${d.fipe ? ` · FIPE ${brl(d.fipe)}${d.fipe_ref ? ` (${esc(d.fipe_ref)})` : ''}` : ''}. <span class="note">Fonte: ${esc(d.fonte || '')}${d.modelo_documento ? ` · no documento: ${esc(d.modelo_documento)}` : ''}${d.cilindrada ? ` · ${esc(d.cilindrada)}` : ''}. Confira antes de salvar.</span></div>
        ${ops.length > 1 ? `<div class="f" style="margin-top:8px"><label for="pb-ver">Versão FIPE (a mais parecida já foi escolhida)</label><select id="pb-ver">${ops.map((o, i) => `<option value="${i}">${esc(o.modelo)} · ${brl(o.valor)} · ${esc(o.codigo)}</option>`).join('')}</select></div>` : ''}`;
      const sel = $('#pb-ver');
      if (sel) sel.onchange = () => {
        const o = ops[Number(sel.value)];
        const parts = o.modelo.split(/\s+/); parts.shift();
        setField('versao', parts.join(' ')); setField('fipe', o.valor);
        if ($('#v-fipe_codigo')) $('#v-fipe_codigo').value = o.codigo;
      };
    }
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
        if (info) info.innerHTML = '<div class="infobox">Os sites de consulta não responderam ao servidor. Tentando pelo seu navegador (extensão do GiroAuto)…</div>';
        for (const url of d.urls || [d.url]) {
          const r = await X.extSend({ cmd: 'plateLookup', url }, 35000);
          if (!r?.ok || !r.html) continue;
          const t = await api('POST', `/api/plate/${p}/html`, { html: r.html, url }).catch(() => null);
          if (t?.encontrado) { d = t; break; }
        }
      }
      if (d.encontrado) { applyVehicleData(d); return d; }
      // Sem resposta automática: o usuário abre a consulta, copia a página e cola aqui (funciona sem extensão).
      const urls = d.urls || [d.url];
      const ext = X.S.extInfo; const extOld = ext && String(ext.version || '0').split('.').map(Number)[1] < 7 && String(ext.version || '0').startsWith('1.');
      if (info) {
        info.innerHTML = `<div class="warnbox"><b>Os sites de consulta bloquearam a busca automática desta vez.</b> ${!ext ? 'Com a <a class="link" href="#config">extensão do Chrome</a> instalada, a busca acontece pelo seu navegador e costuma funcionar.' : extOld ? `Sua extensão é a v${esc(ext.version)}: <a class="link" href="#config">atualize para a v1.7</a> para buscar pelo seu navegador.` : ''}
          <div style="margin-top:8px"><b>Jeito rápido:</b> 1) abra a consulta: ${urls.map((u) => `<a class="btn sm" href="${esc(u)}" target="_blank" rel="noopener">${esc(new URL(u).hostname.replace('www.', ''))}</a>`).join(' ')} 2) na página, aperte <b>Ctrl+A</b> e <b>Ctrl+C</b> (no celular: Selecionar tudo &gt; Copiar) 3) cole aqui:</div>
          <textarea id="pb-paste" rows="3" placeholder="Cole aqui o conteúdo da página da placa" style="width:100%;margin-top:6px"></textarea>
          <div class="btnrow" style="margin-top:6px"><button class="btn sm primary" type="button" id="pb-read">Preencher com o texto colado</button><button class="btn sm" type="button" id="pb-fipe2">Usar a Tabela FIPE</button></div></div>`;
        $('#pb-fipe2').onclick = () => fipeModal((f) => applyVehicleData({ ...f, placa: p }));
        const readPaste = async () => {
          const txt = $('#pb-paste').value.trim(); if (txt.length < 20) return;
          try { const t = await api('POST', `/api/plate/${p}/html`, { html: txt, url: urls[0] }); applyVehicleData(t); }
          catch (e) { toast(e.message, 6000); }
        };
        $('#pb-read').onclick = readPaste;
        $('#pb-paste').addEventListener('paste', () => setTimeout(readPaste, 50));
      }
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
    const D = S.me.options.documentacao || [];
    const tipo = d.proprietario_tipo || 'proprio';
    const doc = d.doc_tipo || 'loja';
    const radios = (name, list, val) => `<div class="owners">${list.map((p) => `<label class="check"><input type="radio" name="${name}" value="${p.key}" ${p.key === val ? 'checked' : ''}><div><b>${esc(p.label.split(' (')[0])}</b>${p.label.includes('(') ? `<span>${esc(p.label.split('(')[1].replace(')', ''))}</span>` : ''}</div></label>`).join('')}</div>`;
    return `<div class="panel" id="ownerPanel">
      <h2>Proprietário e documentação</h2>
      <h3 class="dest-h">Proprietário</h3>
      ${radios('v-ptipo', P, tipo)}
      <div id="ownerExtra" ${tipo !== 'proprio' ? '' : 'hidden'}>
        <div class="fields" style="margin-top:12px">
          <div class="f w3"><label for="v-proprietario_nome">Nome do proprietário</label><input id="v-proprietario_nome" value="${esc(d.proprietario_nome || '')}"></div>
          <div class="f w3"><label for="v-proprietario_tel">Telefone / WhatsApp</label><input id="v-proprietario_tel" value="${esc(d.proprietario_tel || '')}" inputmode="tel"></div>
          <div class="f"><label for="v-proprietario_doc">CPF / CNPJ</label><input id="v-proprietario_doc" value="${esc(d.proprietario_doc || '')}" inputmode="numeric"></div>
          <div class="f w3" id="consigBox" ${TERC.includes(tipo) ? '' : 'hidden'}><label for="v-margem_valor">Margem da loja na venda</label><div class="inline2"><select id="v-margem_tipo" aria-label="Tipo de margem"><option value="pct" ${d.margem_tipo !== 'valor' ? 'selected' : ''}>%</option><option value="valor" ${d.margem_tipo === 'valor' ? 'selected' : ''}>R$</option></select><input id="v-margem_valor" inputmode="decimal" value="${esc(d.margem_tipo === 'valor' ? (d.margem_fixa || '') : (d.consig_comissao_pct ? String(d.consig_comissao_pct).replace('.', ',') : ''))}" placeholder="${d.margem_tipo === 'valor' ? 'ex.: 3000' : 'ex.: 8'}"></div><span class="hint">O que a loja ganha com a venda. Entra no lucro da loja.</span></div>
        </div>
      </div>
      <h3 class="dest-h">Documentação</h3>
      ${radios('v-dtipo', D, doc)}
      <div class="fields" style="margin-top:10px">
        <div class="f" id="procBox" ${doc === 'procuracao' ? '' : 'hidden'}><label for="v-procuracao_validade">Procuração válida até</label><input id="v-procuracao_validade" type="date" value="${esc(d.procuracao_validade || '')}"></div>
        <div class="f w6"><label for="v-proprietario_obs">Observações</label><textarea id="v-proprietario_obs" rows="2" placeholder="Valor mínimo combinado, prazo, quem paga a preparação, chave reserva, situação do documento…">${esc(d.proprietario_obs || '')}</textarea></div>
      </div>
      <div id="procUpload" ${doc === 'procuracao' ? '' : 'hidden'} style="margin-top:8px">${procHtml(d)}</div>
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
    const dt = $('input[name="v-dtipo"]:checked'); if (dt) d.doc_tipo = dt.value;
    readGestao(d);
    if ($('#v-margem_tipo')) {
      d.margem_tipo = $('#v-margem_tipo').value;
      if (d.margem_tipo === 'valor') { d.margem_fixa = num($('#v-margem_valor').value); d.consig_comissao_pct = 0; }
      else { d.consig_comissao_pct = String(decimal($('#v-margem_valor').value)); d.margem_fixa = 0; }
    }
    if ($('#salePanel')) d._sale = saleBody();
    ['proprietario_nome', 'proprietario_tel', 'proprietario_doc', 'procuracao_validade', 'proprietario_obs', 'renavam', 'chassi', 'municipio_placa', 'fipe_codigo', 'fipe_ref']
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
      // v2.6: proprietário na coluna esquerda, logo abaixo dos dados (antes dos destaques).
      ($('#vfDados') || dados).insertAdjacentHTML('afterend', ownerPanelHtml(d));
      $$('input[name="v-ptipo"]').forEach((r) => { r.onchange = () => { $('#ownerExtra').hidden = r.value === 'proprio'; $('#consigBox').hidden = !TERC.includes(r.value); gestaoSync(); }; });
      if ($('#v-margem_tipo')) $('#v-margem_tipo').onchange = () => { $('#v-margem_valor').placeholder = $('#v-margem_tipo').value === 'valor' ? 'ex.: 3000' : 'ex.: 8'; gestaoSync(); };
      $$('input[name="v-dtipo"]').forEach((r) => { r.onchange = () => { $('#procBox').hidden = r.value !== 'procuracao'; $('#procUpload').hidden = r.value !== 'procuracao'; }; });
      bindProc(d);
    }
    // Gestão do veículo: compra, origem, manutenções feitas e custos previstos, com o lucro previsto na hora.
    if (can('financeiro') && $('#ownerPanel') && !$('#gestaoPanel')) {
      // Gestão do veículo na coluna direita, logo abaixo das fotos.
      ($('#vfFotos') || $('#ownerPanel')).insertAdjacentHTML('afterend', '<div class="panel" id="gestaoPanel"><div class="loading">Carregando…</div></div>');
      gestaoPanel(d);
    }
    // Câmera no celular e ferramenta de desfoque
    const drop = $('#drop');
    if (drop && !$('#camBtn')) {
      drop.insertAdjacentHTML('afterend', `<div class="btnrow" style="margin-top:8px"><label class="btn" id="camBtn">📷 Tirar fotos<input type="file" id="camInput" accept="image/*" capture="environment" multiple hidden></label>${d.id ? '<span class="note">Dica: toque numa foto salva e use <b>Desfocar placa</b>.</span>' : ''}</div>`);
      $('#camInput').onchange = () => { const inp = $('#v-fotos'); const dt = new DataTransfer(); [...$('#camInput').files].forEach((f) => dt.items.add(f)); inp.files = dt.files; inp.dispatchEvent(new Event('change')); $('#camInput').value = ''; };
    }
    decoratePhotos(d);
    // Venda já feita: atalho para editar os dados da venda.
    if (d.id && d.status === 'vendido' && can('vender') && !$('#salePanel') && dados) {
      // Venda ocupa a largura toda, abaixo das duas colunas.
      const anchor = $('.vform') || $('#gestaoPanel') || dados;
      anchor.insertAdjacentHTML('afterend', '<div class="panel" id="salePanel" style="margin-top:12px"><div class="loading">Carregando…</div></div>');
      salePanel(d);
    }
  }
  /* ---------- Gestão do veículo dentro do cadastro (v2.1) ---------- */
  const pct = (x) => String(x ?? 0).replace('.', ',');
  const tipoAtual = () => $('input[name="v-ptipo"]:checked')?.value || S.draft?.proprietario_tipo || 'proprio';
  const consigOf = () => TERC.includes(tipoAtual());
  async function salePanel(d) {
    const v = S.vehicles.find((x) => x.id === d.id) || d;
    const sellers = await api('GET', '/api/team/sellers').catch(() => []);
    const box = $('#salePanel'); if (!box) return;
    box.innerHTML = `<h2>Venda</h2><p class="lead">Dados da venda deste carro. São salvos junto com o botão Salvar.</p>${saleFieldsHtml(v, sellers, true)}`;
    bindSaleFields(v);
  }
  async function gestaoPanel(d) {
    const g = d._g || (d._g = { costs: [], novos: [] });
    try {
      if (d.id && !g.loaded) { const F = await api('GET', `/api/vehicles/${d.id}/finance`); g.costs = F.costs; g.loaded = true; }
      await loadPartners();
    } catch (e) { $('#gestaoPanel').innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
    const O = S.me.options;
    const dataCompra = d._fin?.compra_data ?? (d.compra_data || (d.created_at ? String(d.created_at).slice(0, 10) : today()));
    const fin = d._fin || {};
    const consig = consigOf();
    const base = fin.base ?? (consig ? (d.consig_repasse || '') : (d.compra_valor || ''));
    $('#gestaoPanel').innerHTML = `<h2>Gestão do veículo</h2>
      <p class="lead">Compra, manutenções e custos previstos. O lucro previsto é calculado na hora. Não aparece nos anúncios.</p>
      <div class="fields">
        <div class="f"><label for="g-cv" id="g-cv-l">${consig ? 'Repasse ao dono (R$)' : 'Valor de compra (R$)'}</label><input id="g-cv" inputmode="numeric" value="${esc(base || '')}" placeholder="${consig ? 'ou a comissão % acima' : 'ex.: 52000'}"></div>
        <div class="f"><label for="g-cd">Data da compra</label><input id="g-cd" type="date" value="${esc(dataCompra || '')}"></div>
        <div class="f"><label for="g-or">Origem da compra</label><select id="g-or"><option value="">Selecione</option>${(O.origem || []).map((o) => `<option value="${o.key}" ${o.key === (fin.compra_origem ?? d.compra_origem) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>
        <div class="f w3"><label for="g-cf">Comprado de</label><input id="g-cf" value="${esc(fin.compra_de ?? (d.compra_de || ''))}" placeholder="Nome do vendedor, loja ou leilão"></div>
        <div class="f"><label for="g-ct">WhatsApp de quem vendeu</label><input id="g-ct" inputmode="tel" value="${esc(fin.compra_de_tel ?? (d.compra_de_tel || ''))}" placeholder="(44) 99999-0000">${(fin.compra_de_tel ?? d.compra_de_tel) ? `<span class="hint"><a class="link" href="${esc(waLink(fin.compra_de_tel ?? d.compra_de_tel))}" target="_blank" rel="noopener">abrir WhatsApp</a></span>` : ''}</div>
        ${d.troca_de_id ? `<div class="f w6"><span class="pill p-info">🔁 Entrou na troca de <button class="vlink" type="button" data-vp="${d.troca_de_id}">outro veículo</button></span></div>` : ''}
      </div>
      <div class="grid2 gcost" style="margin-top:12px">
        <div><h3 class="dest-h">Manutenções e custos já feitos</h3><div id="g-real"></div></div>
        <div><h3 class="dest-h">Custos previstos</h3><div id="g-prev"></div></div>
      </div>
      <div class="fields addcost">
        <div class="f"><label for="gc-s">Tipo</label><select id="gc-s"><option value="realizado">Já feito</option><option value="previsto">Previsto</option></select></div>
        <div class="f"><label for="gc-c">Categoria</label><select id="gc-c">${opt(Object.entries(O.custos || {}), 'mecanica')}</select></div>
        <div class="f w3"><label for="gc-d">Descrição</label><input id="gc-d" placeholder="Ex.: troca de pastilhas, polimento"></div>
        <div class="f"><label for="gc-v">Valor (R$)</label><input id="gc-v" inputmode="numeric"></div>
        <div class="f w3"><label for="gc-p">Parceiro (opcional)</label><select id="gc-p"><option value="">—</option>${PARTNERS.partners.map((p) => `<option value="${p.id}">${esc(p.nome)}</option>`).join('')}</select><span class="hint"><button class="linkbtn" type="button" id="gc-pn">+ Cadastrar parceiro</button></span></div>
        <div class="f" style="align-self:end"><button class="btn" type="button" id="gc-add">Adicionar custo</button></div>
      </div>
      <div id="gc-pbox"></div>
      <div class="calc" id="g-calc"></div>`;
    renderCosts(d);
    ['#g-cv', '#v-preco', '#v-preco_oferta', '#v-margem_valor'].forEach((s) => { const el = $(s); if (el) el.addEventListener('input', gestaoSync); });
    $('#gc-pn').onclick = () => partnerInline($('#gc-p'), $('#gc-pbox'), $('#gc-c').value);
    $('#gc-add').onclick = async () => {
      const c = { status: $('#gc-s').value, categoria: $('#gc-c').value, descricao: $('#gc-d').value.trim(), valor: num($('#gc-v').value), parceiro_id: $('#gc-p').value, data: today() };
      if (!c.valor) { toast('Informe o valor do custo.'); $('#gc-v').focus(); return; }
      if (d.id) {
        try { await api('POST', `/api/vehicles/${d.id}/costs`, c); g.costs = (await api('GET', `/api/vehicles/${d.id}/finance`)).costs; }
        catch (e) { return toast(e.message, 6000); }
      } else g.novos.push({ ...c, tmp: Date.now() });
      $('#gc-d').value = ''; $('#gc-v').value = '';
      renderCosts(d);
    };
  }
  function costRow(c, d) {
    const cat = S.me.options.custos?.[c.categoria] || c.categoria;
    const parc = c.parceiro_nome || PARTNERS?.partners.find((p) => String(p.id) === String(c.parceiro_id))?.nome || '';
    const key = c.id ? `id:${c.id}` : `tmp:${c.tmp}`;
    return `<div class="cf"><span class="k">${esc(cat)}${c.id ? '' : ' <span class="pill p-muted">a salvar</span>'}<br><span class="sub">${esc(c.descricao || '')}${parc ? ' · ' + esc(parc) : ''}</span></span><span class="v">${brl(c.valor)}</span>
      <span class="btnrow" style="gap:4px">${c.status === 'previsto' ? `<button class="btn sm" type="button" data-cdone="${key}" title="Marcar como feito">Feito</button>` : ''}<button class="btn sm ghost" type="button" data-cedit="${key}" title="Editar descrição e valor">Editar</button><button class="btn sm ghost danger" type="button" data-cdel="${key}" aria-label="Excluir custo">×</button></span></div>`;
  }
  function renderCosts(d) {
    const g = d._g; const all_ = [...g.costs, ...g.novos];
    const real = all_.filter((c) => c.status !== 'previsto'); const prev = all_.filter((c) => c.status === 'previsto');
    const empty = (t) => `<div class="cfields"><div class="cf"><span class="v sub">${t}</span></div></div>`;
    $('#g-real').innerHTML = real.length ? `<div class="cfields">${real.map((c) => costRow(c, d)).join('')}</div>` : empty('Nenhuma manutenção lançada.');
    $('#g-prev').innerHTML = prev.length ? `<div class="cfields">${prev.map((c) => costRow(c, d)).join('')}</div>` : empty('Nada previsto. Lance o que ainda vai gastar (pneus, polimento…) para a previsão ficar certa.');
    const find = (key) => { const [t, v] = key.split(':'); return t === 'id' ? { c: g.costs.find((x) => String(x.id) === v), saved: true } : { c: g.novos.find((x) => String(x.tmp) === v), saved: false }; };
    $$('[data-cdel]').forEach((b) => { b.onclick = async () => {
      const { c, saved } = find(b.dataset.cdel); if (!c) return;
      if (saved) { try { await api('DELETE', `/api/vehicles/${d.id}/costs/${c.id}`); g.costs = g.costs.filter((x) => x !== c); } catch (e) { return toast(e.message); } }
      else g.novos = g.novos.filter((x) => x !== c);
      renderCosts(d);
    }; });
    $$('[data-cedit]').forEach((b) => { b.onclick = () => {
      const { c, saved } = find(b.dataset.cedit); if (!c) return;
      const row = b.closest('.cf');
      row.outerHTML = costEditHtml(c, 'ce');
      $('#ce-x').onclick = () => renderCosts(d);
      $('#ce-ok').onclick = async () => {
        const upd = { descricao: $('#ce-d').value.trim(), valor: num($('#ce-v').value), categoria: $('#ce-c').value, status: $('#ce-s').value };
        if (!upd.valor) return toast('Informe o valor.');
        if (saved) { try { await api('PUT', `/api/vehicles/${d.id}/costs/${c.id}`, upd); g.costs = (await api('GET', `/api/vehicles/${d.id}/finance`)).costs; } catch (e) { return toast(e.message); } }
        else Object.assign(c, upd);
        renderCosts(d);
      };
      $('#ce-v').focus();
    }; });
    $$('[data-cdone]').forEach((b) => { b.onclick = async () => {
      const { c, saved } = find(b.dataset.cdone); if (!c) return;
      if (saved) { try { await api('PUT', `/api/vehicles/${d.id}/costs/${c.id}`, { status: 'realizado' }); } catch (e) { return toast(e.message); } }
      c.status = 'realizado'; c.previsto = false;
      renderCosts(d);
    }; });
    gestaoSync();
  }
  // Linha de custo em modo de edição (cadastro e modal de custos).
  function costEditHtml(c, px) {
    return `<div class="cf cedit"><div class="fields" style="grid-column:1/-1">
      <div class="f"><label for="${px}-s">Tipo</label><select id="${px}-s"><option value="realizado" ${c.status !== 'previsto' ? 'selected' : ''}>Já feito</option><option value="previsto" ${c.status === 'previsto' ? 'selected' : ''}>Previsto</option></select></div>
      <div class="f"><label for="${px}-c">Categoria</label><select id="${px}-c">${opt(Object.entries(S.me.options.custos || {}), c.categoria)}</select></div>
      <div class="f w3"><label for="${px}-d">Descrição</label><input id="${px}-d" value="${esc(c.descricao || '')}"></div>
      <div class="f"><label for="${px}-v">Valor (R$)</label><input id="${px}-v" inputmode="numeric" value="${esc(c.valor || '')}"></div>
      <div class="f" style="align-self:end;flex-direction:row;gap:6px"><button class="btn sm" type="button" id="${px}-x">Cancelar</button><button class="btn sm primary" type="button" id="${px}-ok">Salvar</button></div>
    </div></div>`;
  }
  // Recalcula a previsão de lucro com o que está na tela.
  function gestaoSync() {
    const box = $('#g-calc'); const d = S.draft; if (!box || !d?._g) return;
    const consig = consigOf();
    if ($('#g-cv-l')) { $('#g-cv-l').textContent = consig ? 'Repasse fixo ao dono (R$, opcional)' : 'Valor de compra (R$)'; $('#g-cv').placeholder = consig ? 'se não usar a margem' : 'ex.: 52000'; }
    const preco = num($('#v-preco_oferta')?.value) || num($('#v-preco')?.value);
    const all_ = [...d._g.costs, ...d._g.novos];
    const feitos = all_.filter((c) => c.status !== 'previsto').reduce((s, c) => s + num(c.valor), 0);
    const prev = all_.filter((c) => c.status === 'previsto').reduce((s, c) => s + num(c.valor), 0);
    const mt = $('#v-margem_tipo')?.value || d.margem_tipo || 'pct';
    const mv = $('#v-margem_valor') ? (mt === 'valor' ? num($('#v-margem_valor').value) : decimal($('#v-margem_valor').value)) : (mt === 'valor' ? d.margem_fixa : d.consig_comissao_pct);
    const base = preco || num($('#g-cv').value) ? baseCalc({ tipo: tipoAtual(), repasse: consig ? num($('#g-cv').value) : 0, compra: consig ? 0 : num($('#g-cv').value), margemTipo: mt, margemValor: mv }, preco) : 0;
    const impPct = Number(S.me.store.impostos_pct || 0);
    const imp = Math.round(preco * impPct / 100);
    const lucro = preco - base - feitos - prev - imp;
    const margem = preco ? Math.round((lucro / preco) * 1000) / 10 : 0;
    const line = (l, v, cls = '') => `<div class="cl ${cls}"><span>${l}</span><b>${v}</b></div>`;
    box.innerHTML = `<h3 class="dest-h">Previsão de lucro</h3>
      ${line(`Preço do anúncio${num($('#v-preco_oferta')?.value) ? ' (oferta)' : ''}`, preco ? brl(preco) : '—')}
      ${consig && preco && base ? line('Margem da loja', brl(preco - base)) : ''}
      ${line(consig ? '− Repasse ao dono' : '− Valor de compra', base ? brl(base) : '—')}
      ${line('− Manutenções feitas', brl(feitos))}
      ${line('− Custos previstos', brl(prev))}
      ${impPct ? line(`− Impostos (${pct(impPct)}%)`, brl(imp)) : ''}
      ${preco && base ? line('= Lucro previsto', `${brl(lucro)} <small>${pct(margem)}% de margem</small>`, `tot ${lucro < 0 ? 'neg' : 'pos'}`) : `<p class="note">Informe o preço e ${consig ? 'a margem da loja (em Proprietário) ou o repasse ao dono' : 'o valor de compra'} para ver o lucro previsto.</p>`}
      ${consig ? '' : `<p class="note">Investimento total: <b>${brl(base + feitos + prev)}</b> (compra + manutenções + previstos).</p>`}`;
  }
  function readGestao(d) {
    if (!$('#gestaoPanel') || !$('#g-cv')) return;
    const consig = consigOf();
    d._fin = { base: $('#g-cv').value, compra_data: $('#g-cd').value, compra_origem: $('#g-or').value, compra_de: $('#g-cf').value, compra_de_tel: $('#g-ct').value };
    d._fin[consig ? 'consig_repasse' : 'compra_valor'] = num($('#g-cv').value);
  }
  X.afterSave = async (v, d) => {
    if (d._sale && v.status === 'vendido' && can('vender')) await api('PUT', `/api/vehicles/${v.id}/sale`, d._sale);
    if (!can('financeiro') || !d._fin) return;
    const { base, ...body } = d._fin;
    await api('PUT', `/api/vehicles/${v.id}/finance`, body);
    for (const c of d._g?.novos || []) await api('POST', `/api/vehicles/${v.id}/costs`, c);
    if (d._g) d._g.novos = [];
  };

  // Cadastro rápido de parceiro dentro do próprio pop-up (sem sair para a aba Parceiros).
  function partnerInline(select, host, tipoSug) {
    if (!can('parceiros') && !can('financeiro')) return toast('Seu usuário não pode cadastrar parceiros.');
    const tipos = Object.entries(PARTNERS?.tipos || {});
    const guess = { mecanica: 'oficina', eletrica: 'eletrica', funilaria: 'funilaria', estetica: 'estetica', lavagem: 'lavador', pneus: 'pneus', despachante: 'despachante', documentacao: 'despachante', vistoria: 'vistoria', manutencao: 'oficina', loja_parceira: 'loja_parceira' }[tipoSug] || 'oficina';
    host.innerHTML = `<div class="inline-form"><b>Novo parceiro</b>
      <div class="fields">
        <div class="f w3"><label for="ip-n">Nome</label><input id="ip-n" placeholder="Oficina do Zé"></div>
        <div class="f"><label for="ip-t">Tipo</label><select id="ip-t">${opt(tipos, guess)}</select></div>
        <div class="f"><label for="ip-w">WhatsApp</label><input id="ip-w" inputmode="tel" placeholder="(44) 99999-0000"></div>
        <div class="f w3"><label for="ip-c">Contato</label><input id="ip-c" placeholder="José"></div>
      </div>
      <div class="err" id="ip-err" hidden></div>
      <div class="btnrow" style="justify-content:flex-end"><button class="btn sm" type="button" id="ip-x">Cancelar</button><button class="btn sm primary" type="button" id="ip-ok">Salvar parceiro</button></div></div>`;
    $('#ip-n').focus();
    $('#ip-x').onclick = () => { host.innerHTML = ''; };
    $('#ip-ok').onclick = async () => {
      try {
        const r = await api('POST', '/api/partners', { nome: $('#ip-n').value, tipo: $('#ip-t').value, whatsapp: $('#ip-w').value, contato: $('#ip-c').value });
        PARTNERS = { ...PARTNERS, partners: r.partners };
        const p = r.partners.find((x) => x.id === r.id);
        select.insertAdjacentHTML('beforeend', `<option value="${r.id}">${esc(p?.nome || $('#ip-n').value)}${p && select.id === 'lc-p' ? ` (${esc(p.tipo_label)})` : ''}</option>`);
        select.value = String(r.id); select.dispatchEvent(new Event('change'));
        host.innerHTML = ''; toast('Parceiro cadastrado');
      } catch (e) { $('#ip-err').textContent = e.message; $('#ip-err').hidden = false; }
    };
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
    // Filtro por propriedade (loja, consignado…) e origem da compra.
    if ($('.list') && !$('#stFiltro')) {
      const O = S.me.options;
      $('.list').insertAdjacentHTML('beforebegin', `<div class="btnrow" style="margin:0 0 8px;align-items:center"><label for="stFiltro" class="sub">Mostrar:</label><select id="stFiltro" style="width:auto"><option value="">Todas as propriedades e origens</option><optgroup label="Propriedade">${(O.propriedade || []).map((p) => `<option value="p:${p.key}" ${STF === 'p:' + p.key ? 'selected' : ''}>${esc(p.label.split(' (')[0])}</option>`).join('')}</optgroup><optgroup label="Origem da compra">${(O.origem || []).map((p) => `<option value="o:${p.key}" ${STF === 'o:' + p.key ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}<option value="o:" ${STF === 'o:' ? 'selected' : ''}>Origem não informada</option></optgroup></select><span class="sub" id="stFiltroN"></span></div>`);
      $('#stFiltro').onchange = () => { STF = $('#stFiltro').value; aplicarFiltroEstoque(); };
    }
    aplicarFiltroEstoque();
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
        if (v.local_status && v.local_status !== 'patio') {
          const txt = `${esc(v.local_label)}${v.local_parceiro ? ': ' + esc(v.local_parceiro.nome) : ''}`;
          const dias = `<span class="pill ${v.local_previsao && v.local_previsao < today() ? 'p-bad' : 'p-muted'}" title="${v.local_previsao ? 'Previsão: ' + fmtDate(v.local_previsao) : ''}">${v.local_dias ? `há ${v.local_dias} ${v.local_dias === 1 ? 'dia' : 'dias'}` : 'desde hoje'}</span>`;
          st.insertAdjacentHTML('beforeend', v.followup_url
            ? `<a class="pill p-info pill-link" href="${esc(v.followup_url)}" target="_blank" rel="noopener" title="Pedir o andamento do serviço pelo WhatsApp">💬 ${txt}</a>${dias}`
            : `<span class="pill p-info" title="Cadastre o WhatsApp do parceiro para pedir o andamento com um clique">${txt}</span>${dias}`);
        }
        if (v.status === 'vendido' && !v.doc_concluido) st.insertAdjacentHTML('beforeend', `<button class="pill p-warn badge-btn" type="button" data-docgo="${v.id}" title="Acompanhar em Gestão > Documentação">Doc: ${esc(v.doc_status_label)}</button>`);
        if (v.proprietario_tipo && v.proprietario_tipo !== 'proprio') {
          const lab = esc((S.me.options.propriedade.find((p) => p.key === v.proprietario_tipo)?.label || '').split(' (')[0]);
          const wa = waLink(v.proprietario_tel, `Olá${v.proprietario_nome ? ' ' + v.proprietario_nome.split(' ')[0] : ''}, aqui é da ${S.me.store.name}. Passando para falar sobre o seu ${v.marca} ${v.modelo}${v.placa ? ` (placa ${v.placa})` : ''}.`);
          st.insertAdjacentHTML('beforeend', wa ? `<a class="pill p-muted pill-link" href="${esc(wa)}" target="_blank" rel="noopener" title="WhatsApp de ${esc(v.proprietario_nome || 'proprietário')}">💬 ${lab}${v.proprietario_nome ? ': ' + esc(v.proprietario_nome.split(' ')[0]) : ''}</a>` : `<span class="pill p-muted" title="Cadastre o telefone do proprietário para chamar com um clique">${lab}</span>`);
        }
      }
      const acts = row.querySelector('.actions');
      if (acts) acts.insertAdjacentHTML('beforeend', `<button class="btn sm ghost" type="button" data-more="${v.id}" aria-label="Mais opções">Mais ▾</button>`);
    });
    // Esconde ações sem permissão (o servidor também bloqueia)
    const need = { publicar: 'publicar', republicar: 'publicar', divulgar: 'publicar', vendido: 'vender', excluir: 'excluir', duplicar: 'cadastrar', editar: 'cadastrar' };
    $$('.list [data-act]').forEach((b) => { if (need[b.dataset.act] && !can(need[b.dataset.act])) b.hidden = true; });
    $$('[data-docgo]').forEach((b) => { b.onclick = () => { gTab = 'docs'; X.go('gestao'); }; });
    $$('[data-parado]').forEach((b) => { b.onclick = () => offerModal(V.find((x) => x.id === Number(b.dataset.parado))); });
    $$('[data-more]').forEach((b) => { b.onclick = (e) => moreMenu(V.find((x) => x.id === Number(b.dataset.more)), e.currentTarget); });
  }

  let STF = '';
  function aplicarFiltroEstoque() {
    let n = 0; let t = 0;
    $$('.list .row').forEach((row) => {
      const id = Number(row.querySelector('[data-id]')?.dataset.id);
      const v = S.vehicles.find((x) => x.id === id); if (!v) return;
      const [k, val] = STF ? STF.split(':') : ['', ''];
      const ok = !STF || (k === 'p' ? (v.proprietario_tipo || 'proprio') === val : (v.compra_origem || '') === val);
      row.hidden = !ok; t++; if (ok) n++;
    });
    if ($('#stFiltroN')) $('#stFiltroN').textContent = STF ? `${n} de ${t}` : '';
  }
  function moreMenu(v, anchor) {
    $('#moreMenu')?.remove();
    const items = [
      ['print-cor', 'Imprimir folha A4 (colorida)'], ['print-pb', 'Imprimir folha A4 (preto e branco)'], ['qr', 'QR code do carro'],
      can('precos') && v.status !== 'vendido' && ['offer', 'Criar oferta (preço de ocasião)'],
      can('parceiros') && v.status !== 'vendido' && ['loc', 'Localização (oficina, funilaria…)'],
      can('financeiro') && ['fin', 'Custos e margem'],
      can('vender') && v.status === 'vendido' && ['sale', 'Dados da venda'],
      can('publicar') && v.status !== 'vendido' && ['repasse', 'Enviar para grupo de repasse'],
      ['ficha', 'Ficha rápida do veículo'],
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
        if (k === 'sale') saleEditModal(v.id);
        if (k === 'repasse') X.repasseModal(v, (t) => { S.chanTab = t; $$(`[data-act="divulgar"][data-id="${v.id}"]`)[0]?.click(); });
        if (k === 'ficha') vehiclePop(v.id);
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
        <div class="f w3" id="lc-pbox"><label for="lc-p">Parceiro</label><select id="lc-p"><option value="">Selecione</option>${P.partners.map((p) => `<option value="${p.id}" ${p.id === v.local_parceiro?.id ? 'selected' : ''}>${esc(p.nome)} (${esc(p.tipo_label)})</option>`).join('')}</select><span class="hint"><button class="linkbtn" type="button" id="lc-pn">+ Cadastrar parceiro</button></span></div>
        <div class="f w3" id="lc-prev"><label for="lc-d">Previsão de retorno</label><input id="lc-d" type="date" value="${esc(v.local_previsao || '')}"></div>
        <div class="f w6"><label for="lc-o">Serviço / observação</label><input id="lc-o" value="${esc(v.local_obs || '')}" placeholder="Ex.: troca de embreagem, polimento"></div>
      </div>
      <div id="lc-new"></div>
      <div class="err" id="lc-err" hidden></div>
      <div class="modal-foot"><button class="btn" data-close type="button">Cancelar</button><button class="btn primary" id="lc-ok" type="button">Salvar</button></div>`);
    const sync = () => { const p = $('#lc-st').value === 'patio'; $('#lc-pbox').hidden = p; $('#lc-prev').hidden = p; if (p) $('#lc-new').innerHTML = ''; };
    $('#lc-st').onchange = sync; sync();
    $('#lc-pn').onclick = () => partnerInline($('#lc-p'), $('#lc-new'), $('#lc-st').value);
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
      try { const r = await api(p.id ? 'PUT' : 'POST', p.id ? `/api/partners/${p.id}` : '/api/partners', body()); PARTNERS = { ...PARTNERS, partners: r.partners }; closeModal(); X.render(); }
      catch (e) { $('#pt-err').textContent = e.message; $('#pt-err').hidden = false; }
    };
    if ($('#pt-off')) $('#pt-off').onclick = async () => { await api('PUT', `/api/partners/${p.id}`, { ...body(), active: false }); await loadPartners(true); closeModal(); X.render(); };
  }

  /* ======================= Venda (v2.1) ======================= */
  const DOC_INICIAL = [['pendente', 'Ainda não preenchido'], ['preenchido', 'Sim, ATPV-e / recibo preenchido'], ['assinado', 'Preenchido e assinado (firma reconhecida)'], ['nao_aplica', 'Não se aplica']];
  function saleFieldsHtml(v, sellers, edit) {
    const val = (k, def = '') => esc(v[k] ?? def);
    const vend = v.venda_vendedor_id || S.me.user.id;
    const data = edit ? String(v.vendido_em || '').slice(0, 10) : today();
    const fin = can('financeiro');
    // Carros que podem ser a troca: os do estoque (não vendidos), exceto o próprio.
    const recente = (x) => x.vendido_em && Date.now() - Date.parse(String(x.vendido_em).replace(' ', 'T') + 'Z') <= 30 * 864e5;
    const trocas = S.vehicles.filter((x) => x.id !== v.id && (x.status !== 'vendido' || recente(x) || x.id === v.venda_troca_id));
    const on = (k) => (edit ? !!v[k] : false);
    const avistaOn = edit ? !!v.venda_entrada : true;
    const formaAv = /Dinheiro|Cart|PIX/.test(v.venda_pagamento || '') ? (v.venda_pagamento.match(/Dinheiro|Cartão|PIX/) || ['PIX'])[0] : 'PIX';
    return `<div class="fields">
        <div class="f"><label for="s-vv">Valor total da venda (R$)</label><input id="s-vv" inputmode="numeric" value="${edit ? val('venda_valor') : esc(v.preco_anuncio || '')}" style="font-size:18px"><span class="hint" id="s-soma"></span></div>
        <div class="f"><label for="s-dt">Data da venda</label><input id="s-dt" type="date" value="${esc(data)}" max="${today()}"></div>
        <div class="f"><label for="s-vs">Vendedor</label><select id="s-vs">${sellers.map((s) => `<option value="${s.id}" ${s.id === vend ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
        ${fin ? `<div class="f"><label for="s-cm">Comissão do vendedor (R$)</label><input id="s-cm" inputmode="numeric" value="${edit ? val('venda_comissao') : ''}"></div>` : ''}
      </div>
      <h4>Como foi pago <span class="sub">(marque uma ou mais partes)</span></h4>
      <div class="pay">
        <div class="payrow"><label class="check"><input type="checkbox" id="s-p-av" ${avistaOn ? 'checked' : ''}><div><b>À vista</b><span>PIX, dinheiro, cartão</span></div></label>
          <div class="fields pay-f" data-pf="av"><div class="f"><label for="s-en">Valor (R$)</label><input id="s-en" inputmode="numeric" value="${edit ? val('venda_entrada') : ''}"></div><div class="f"><label for="s-pg">Forma</label><select id="s-pg">${['PIX', 'Dinheiro', 'Cartão'].map((x) => `<option ${x === formaAv ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div></div>
        <div class="payrow"><label class="check"><input type="checkbox" id="s-p-tr" ${on('venda_troca_valor') || on('venda_troca_id') ? 'checked' : ''}><div><b>Carro na troca</b><span>entra no estoque como compra</span></div></label>
          <div class="fields pay-f" data-pf="tr"><div class="f w3"><label for="s-tid">Qual carro</label><select id="s-tid"><option value="">Cadastrar agora…</option>${trocas.map((x) => `<option value="${x.id}" ${x.id === v.venda_troca_id ? 'selected' : ''}>${esc(x.marca)} ${esc(x.modelo)} ${esc(x.ano_modelo || '')} ${esc(x.placa || '')}${x.status === 'vendido' ? ' (vendido)' : ''}</option>`).join('')}</select></div>
            <div class="f"><label for="s-tv">Valor dado na troca (R$)</label><input id="s-tv" inputmode="numeric" value="${edit ? val('venda_troca_valor') : ''}"></div>
            <div class="f w6 s-tnew"><div class="fields"><div class="f"><label for="s-tm">Marca</label><input id="s-tm" placeholder="Ford"></div><div class="f"><label for="s-to">Modelo</label><input id="s-to" placeholder="Ecosport"></div><div class="f"><label for="s-ta">Ano</label><input id="s-ta" inputmode="numeric" maxlength="4"></div><div class="f"><label for="s-tp">Placa</label><input id="s-tp" maxlength="8" style="text-transform:uppercase"></div></div></div></div></div>
        <div class="payrow"><label class="check"><input type="checkbox" id="s-p-fi" ${on('venda_financiado') || /Financ/.test(v.venda_pagamento || '') ? 'checked' : ''}><div><b>Financiamento</b><span>banco, parcelas e retorno</span></div></label>
          <div class="fields pay-f" data-pf="fi"><div class="f"><label for="s-fi">Banco / financeira</label><input id="s-fi" value="${edit ? val('venda_financeira') : ''}" placeholder="BV, Santander…"></div>
            <div class="f"><label for="s-ff">Valor financiado (R$)</label><input id="s-ff" inputmode="numeric" value="${edit ? val('venda_financiado') || '' : ''}"></div>
            <div class="f"><label for="s-fp">Parcelas</label><input id="s-fp" inputmode="numeric" value="${edit && v.venda_fin_parcelas ? val('venda_fin_parcelas') : ''}" placeholder="48"></div>
            <div class="f"><label for="s-fv">Valor da parcela (R$)</label><input id="s-fv" inputmode="numeric" value="${edit && v.venda_fin_parcela ? val('venda_fin_parcela') : ''}"></div>
            ${fin ? `<div class="f"><label for="s-fr">Retorno da financeira (R$)</label><input id="s-fr" inputmode="numeric" value="${edit && v.venda_retorno ? val('venda_retorno') : ''}"><span class="hint">Entra na receita deste carro.</span></div>` : ''}</div></div>
        <div class="payrow"><label class="check"><input type="checkbox" id="s-p-bo" ${on('venda_boleto_qtd') ? 'checked' : ''}><div><b>Boleto / promissória</b><span>parcelado pela loja</span></div></label>
          <div class="fields pay-f" data-pf="bo"><div class="f"><label for="s-bq">Quantidade</label><input id="s-bq" inputmode="numeric" value="${edit && v.venda_boleto_qtd ? val('venda_boleto_qtd') : ''}"></div><div class="f"><label for="s-bv">Valor de cada (R$)</label><input id="s-bv" inputmode="numeric" value="${edit && v.venda_boleto_valor ? val('venda_boleto_valor') : ''}"></div></div></div>
      </div>
      <h4>Comprador</h4>
      <div class="fields">
        <div class="f w3"><label for="s-cn">Nome</label><input id="s-cn" value="${edit ? val('venda_comprador') : ''}"></div>
        <div class="f"><label for="s-cd">CPF / CNPJ</label><input id="s-cd" inputmode="numeric" value="${edit ? val('comprador_doc') : ''}"></div>
        <div class="f"><label for="s-ct">Telefone / WhatsApp</label><input id="s-ct" inputmode="tel" value="${edit ? val('comprador_tel') : ''}"></div>
      </div>
      ${edit ? '' : `<h4>Documento de transferência</h4>
      <div class="fields"><div class="f w6"><label for="s-ds">O documento de transferência (ATPV-e / recibo) já foi preenchido? Em que etapa está?</label><select id="s-ds">${opt(Object.entries(S.me.options.doc_status || {}).length ? Object.entries(S.me.options.doc_status) : DOC_INICIAL, 'pendente')}</select><span class="hint">Escolha a etapa em que o documento está. Depois, acompanhe em Gestão &gt; Documentação.</span></div></div>`}
      <div class="fields"><div class="f w6"><label for="s-ob">Observações da venda</label><textarea id="s-ob" rows="2" placeholder="Garantia combinada, itens entregues, pendências…">${edit ? val('venda_obs') : ''}</textarea></div></div>
      <div class="calc" id="s-calc"></div>`;
  }
  const payOn = (k) => !!$(`#s-p-${k}`)?.checked;
  function salePartes() {
    const av = payOn('av') ? num($('#s-en').value) : 0;
    const tr = payOn('tr') ? num($('#s-tv').value) : 0;
    const fi = payOn('fi') ? num($('#s-ff').value) : 0;
    const bo = payOn('bo') ? num($('#s-bq').value) * num($('#s-bv').value) : 0;
    return { av, tr, fi, bo, total: av + tr + fi + bo };
  }
  function bindSaleFields(v) {
    // Na venda nova, o preço do anúncio é só sugestão: a soma das partes substitui. Em venda antiga sem partes, vale o total digitado.
    let manual = v.status === 'vendido' && !!num($('#s-vv').value) && !(v.venda_entrada || v.venda_troca_valor || v.venda_financiado || v.venda_boleto_qtd);
    $('#s-vv').addEventListener('input', () => { manual = true; });
    const sync = () => {
      ['av', 'tr', 'fi', 'bo'].forEach((k) => { const box = $(`[data-pf="${k}"]`); if (box) box.hidden = !payOn(k); });
      if ($('.s-tnew')) $('.s-tnew').hidden = !payOn('tr') || !!$('#s-tid').value;
      const p = salePartes();
      if (p.total && (!manual || !num($('#s-vv').value))) { $('#s-vv').value = p.total; manual = false; }
      const total = num($('#s-vv').value);
      $('#s-soma').innerHTML = p.total ? `Soma das partes: <b>${brl(p.total)}</b>${p.total !== total ? ' <span class="neg">(diferente do total)</span>' : ''}` : '';
      const f = v.financeiro; const box = $('#s-calc');
      if (!box) return;
      if (!can('financeiro') || !f) { box.innerHTML = ''; return; }
      const venda = total;
      const consig = TERC.includes(v.proprietario_tipo);
      const base = baseOfVehicle(v, venda);
      if (!venda || !base) { box.innerHTML = `<p class="note">${base ? '' : `Sem ${consig ? 'margem/repasse' : 'valor de compra'} no cadastro: o lucro desta venda não será calculado até você informar.`}</p>`; return; }
      const imp = Math.round(venda * Number(S.me.store.impostos_pct || 0) / 100);
      const com = num($('#s-cm')?.value);
      const ret = payOn('fi') ? num($('#s-fr')?.value) : 0;
      const lucro = venda + ret - base - (f.custos_total || 0) - com - imp;
      const trocaNome = payOn('tr') ? ($('#s-tid').value ? $('#s-tid').selectedOptions[0].textContent.trim() : [$('#s-tm').value, $('#s-to').value].filter(Boolean).join(' ') || 'o carro da troca') : '';
      box.innerHTML = `<div class="cl tot ${lucro < 0 ? 'neg' : 'pos'}"><span>Lucro desta venda</span><b>${brl(lucro)} <small>${pct(Math.round((lucro / venda) * 1000) / 10)}% · ${consig ? 'repasse' : 'compra'} ${brl(base)} · custos ${brl(f.custos_total || 0)}${ret ? ` · retorno +${brl(ret)}` : ''}${com ? ` · comissão ${brl(com)}` : ''}${imp ? ` · impostos ${brl(imp)}` : ''}</small></b></div>
        ${p.tr ? `<p class="note">🔁 Venda com troca: entra ${brl(venda - p.tr)} agora${p.tr ? ` e ${esc(trocaNome)} entra no estoque como compra de ${brl(p.tr)}` : ''}. O lucro desta venda entra nos resultados agora; quando ${esc(trocaNome)} for vendido, só a diferença sobre ${brl(p.tr)} vira lucro (sem contar duas vezes).</p>` : ''}
        ${venda < (v.preco_anuncio || 0) ? `<p class="note">Desconto de ${brl(v.preco_anuncio - venda)} sobre o anúncio (${pct(Math.round((1 - venda / v.preco_anuncio) * 1000) / 10)}%).</p>` : ''}`;
    };
    $$('.pay input, .pay select, #s-vv, #s-cm').forEach((el) => el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', sync));
    sync();
  }
  const saleBody = () => {
    const p = salePartes();
    const formas = [payOn('av') && $('#s-pg').value, payOn('tr') && 'Troca', payOn('fi') && 'Financiamento', payOn('bo') && 'Boleto'].filter(Boolean);
    const b = {
      venda_valor: num($('#s-vv').value), venda_data: $('#s-dt').value, venda_vendedor_id: $('#s-vs').value, venda_pagamento: formas.join(' + '),
      venda_entrada: p.av, venda_troca_valor: p.tr, venda_financiado: p.fi, venda_financeira: payOn('fi') ? $('#s-fi').value : '',
      venda_fin_parcelas: payOn('fi') ? num($('#s-fp').value) : 0, venda_fin_parcela: payOn('fi') ? num($('#s-fv').value) : 0,
      venda_boleto_qtd: payOn('bo') ? num($('#s-bq').value) : 0, venda_boleto_valor: payOn('bo') ? num($('#s-bv').value) : 0,
      venda_troca_id: payOn('tr') ? $('#s-tid').value || null : null,
      venda_comprador: $('#s-cn').value, comprador_doc: $('#s-cd').value, comprador_tel: $('#s-ct').value, venda_obs: $('#s-ob').value,
      ...($('#s-cm') ? { venda_comissao: num($('#s-cm').value) } : {}),
      ...($('#s-fr') ? { venda_retorno: payOn('fi') ? num($('#s-fr').value) : 0 } : {}),
    };
    if (payOn('tr') && !$('#s-tid').value && $('#s-tm').value.trim() && $('#s-to').value.trim()) b.troca_novo = { marca: $('#s-tm').value, modelo: $('#s-to').value, ano: $('#s-ta').value, placa: $('#s-tp').value };
    if (payOn('tr') && $('#s-tid').value) b.venda_troca_desc = $('#s-tid').selectedOptions[0].textContent.trim();
    return b;
  };
  X.sellModal = async (v, sold) => {
    const sellers = await api('GET', '/api/team/sellers').catch(() => [{ id: S.me.user.id, name: S.me.user.name }]);
    modal(`<h3>Vender ${esc(v.marca)} ${esc(v.modelo)} ${esc(v.versao || '')}</h3>
      <p>${v.status === 'publicado' ? 'A extensão vai excluir o anúncio do Marketplace. ' : ''}O veículo sai do catálogo na próxima sincronização. Só o valor é necessário; o resto pode ser completado depois.</p>
      ${saleFieldsHtml(v, sellers, false)}
      <div class="err" id="s-err" hidden></div>
      <div class="modal-foot"><button class="btn" data-close type="button">Cancelar</button><button class="btn primary" id="s-ok" type="button">Confirmar venda</button></div>`, true);
    bindSaleFields(v);
    $('#s-vv').focus();
    $('#s-ok').onclick = async () => {
      const b = { ...saleBody(), doc_status: $('#s-ds').value };
      if (!b.venda_valor) { $('#s-err').textContent = 'Informe o valor da venda.'; $('#s-err').hidden = false; return; }
      $('#s-ok').disabled = true; $('#s-ok').textContent = 'Salvando…';
      try { closeModal(); await sold(b); }
      catch (e) { toast(e.message, 7000); }
    };
  };
  async function saleEditModal(id) {
    await X.loadVehicles();
    const v = S.vehicles.find((x) => x.id === id); if (!v) return;
    const sellers = await api('GET', '/api/team/sellers').catch(() => []);
    modal(`<h3>Dados da venda: ${esc(v.marca)} ${esc(v.modelo)}</h3>
      ${saleFieldsHtml(v, sellers, true)}
      <div class="err" id="s-err" hidden></div>
      <div class="modal-foot"><button class="btn" data-close type="button">Cancelar</button><button class="btn primary" id="s-ok" type="button">Salvar</button></div>`, true);
    bindSaleFields(v);
    $('#s-ok').onclick = async () => {
      try { await api('PUT', `/api/vehicles/${id}/sale`, saleBody()); closeModal(); await X.loadVehicles(); X.render(); toast('Dados da venda salvos'); }
      catch (e) { $('#s-err').textContent = e.message; $('#s-err').hidden = false; }
    };
  }

  /* ======================= Custos e margem (modal, usado em Gestão e Resultados) ======================= */
  async function financeModal(id) {
    let F;
    try { [F] = await Promise.all([api('GET', `/api/vehicles/${id}/finance`), loadPartners()]); } catch (e) { return toast(e.message); }
    const v = F.vehicle; const f = F.finance;
    const consig = TERC.includes(v.proprietario_tipo);
    const lucro = (x, label) => (x ? `<div class="kpi"><span>${label}</span><b class="${x.liquido < 0 ? 'neg' : ''}">${brl(x.liquido)}</b><em>bruto ${brl(x.bruto)} · ${pct(x.margem_pct)}% de margem</em></div>` : '');
    const row = (c) => `<div class="cf"><span class="k">${esc(c.categoria_label)}${c.previsto ? ' <span class="pill p-warn">previsto</span>' : ''}<br><span class="sub">${fmtDate(c.data)}${c.parceiro_nome ? ' · ' + esc(c.parceiro_nome) : ''}</span></span><span class="v">${esc(c.descricao || '')}<br><b>${brl(c.valor)}</b></span><span class="btnrow" style="gap:4px">${c.previsto ? `<button class="btn sm" type="button" data-cf="${c.id}">Feito</button>` : ''}<button class="btn sm ghost" type="button" data-ce="${c.id}">Editar</button><button class="btn sm ghost danger" type="button" data-dc="${c.id}">Excluir</button></span></div>`;
    modal(`<h3>Custos e margem: ${esc(v.marca)} ${esc(v.modelo)}</h3>
      <div class="kpis">${f.falta_base ? `<div class="kpi"><span>Lucro previsto</span><b class="warn">—</b><em>Informe ${consig ? 'a margem da loja (no cadastro) ou o repasse ao dono' : 'o valor de compra'} para calcular.</em></div>` : ''}${v.status !== 'vendido' ? lucro(f.previsto, `Lucro previsto (anúncio ${brl(v.preco_anuncio)})`) : ''}${lucro(f.real, `Lucro real (venda ${brl(f.real?.venda)})`)}<div class="kpi"><span>Custos</span><b>${brl(f.custos_total)}</b><em>${brl(f.custos_realizados)} feitos · ${brl(f.custos_previstos)} previstos</em></div></div>
      <h4>${consig ? 'Consignação' : 'Compra'}</h4>
      <div class="fields">
        ${consig ? `<div class="f"><label for="fn-rep">Repasse ao dono (R$)</label><input id="fn-rep" inputmode="numeric" value="${v.consig_repasse || ''}" placeholder="${margemTxt(v) ? `ou margem de ${margemTxt(v)}` : 'opcional'}"></div>` : `<div class="f"><label for="fn-cv">Valor de compra (R$)</label><input id="fn-cv" inputmode="numeric" value="${v.compra_valor || ''}"></div>`}
        <div class="f"><label for="fn-cd">Data da compra</label><input id="fn-cd" type="date" value="${esc(v.compra_data || String(v.created_at || '').slice(0, 10))}"></div>
        <div class="f"><label for="fn-or">Origem</label><select id="fn-or"><option value="">—</option>${(F.origens || []).map((o) => `<option value="${o.key}" ${o.key === v.compra_origem ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>
        <div class="f"><label for="fn-cf">Comprado de</label><input id="fn-cf" value="${esc(v.compra_de || v.proprietario_nome || '')}"></div>
        <div class="f"><label for="fn-ct">WhatsApp de quem vendeu</label><input id="fn-ct" inputmode="tel" value="${esc(v.compra_de_tel || '')}"></div>
        <div class="f" style="align-self:end"><button class="btn" type="button" id="fn-save">Salvar</button></div>
      </div>
      ${v.status === 'vendido' && can('vender') ? `<div class="btnrow" style="margin-top:8px"><button class="btn" type="button" id="fn-sale">Editar dados da venda</button></div>` : ''}
      <h4>Custos (manutenção, preparação, documentação…)</h4>
      <div class="cfields">${F.costs.length ? F.costs.map(row).join('') : '<div class="cf"><span class="v sub">Nenhum custo lançado.</span></div>'}</div>
      <div class="fields" style="margin-top:8px">
        <div class="f"><label for="ct-s">Tipo</label><select id="ct-s"><option value="realizado">Já feito</option><option value="previsto">Previsto</option></select></div>
        <div class="f"><label for="ct-c">Categoria</label><select id="ct-c">${opt(Object.entries(F.categorias), 'mecanica')}</select></div>
        <div class="f w3"><label for="ct-d">Descrição</label><input id="ct-d" placeholder="Ex.: troca de pastilhas"></div>
        <div class="f"><label for="ct-v">Valor (R$)</label><input id="ct-v" inputmode="numeric"></div>
        <div class="f w3"><label for="ct-p">Parceiro (opcional)</label><select id="ct-p"><option value="">—</option>${PARTNERS.partners.map((p) => `<option value="${p.id}" ${p.id === v.local_parceiro?.id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select><span class="hint"><button class="linkbtn" type="button" id="ct-pn">+ Cadastrar parceiro</button></span></div>
        <div class="f"><label for="ct-dt">Data</label><input id="ct-dt" type="date" value="${today()}"></div>
        <div class="f" style="align-self:end"><button class="btn primary" type="button" id="ct-add">Lançar custo</button></div>
      </div>
      <div id="ct-new"></div>
      ${F.impostos_pct ? `<p class="note">O lucro líquido desconta ${pct(F.impostos_pct)}% de impostos sobre a venda e a comissão do vendedor (ajuste em Configurações &gt; Gestão).</p>` : '<p class="note">Para descontar impostos sobre a venda no lucro líquido, informe o percentual em Configurações &gt; Gestão.</p>'}
      <div class="err" id="fn-err" hidden></div>
      <div class="modal-foot"><button class="btn primary" type="button" id="fn-close">Fechar</button></div>`, true);
    const err = (m) => { $('#fn-err').textContent = m; $('#fn-err').hidden = false; };
    $('#fn-close').onclick = () => { closeModal(); if (['gestao', 'resultados'].includes(S.view)) X.render(); };
    $('#fn-save').onclick = async () => {
      const b = { compra_data: $('#fn-cd').value, compra_de: $('#fn-cf').value, compra_de_tel: $('#fn-ct').value, compra_origem: $('#fn-or').value };
      if ($('#fn-cv')) b.compra_valor = $('#fn-cv').value; else b.consig_repasse = $('#fn-rep').value;
      try { await api('PUT', `/api/vehicles/${id}/finance`, b); await X.loadVehicles(); toast('Valores salvos'); financeModal(id); } catch (e) { err(e.message); }
    };
    if ($('#fn-sale')) $('#fn-sale').onclick = () => saleEditModal(id);
    $('#ct-pn').onclick = () => partnerInline($('#ct-p'), $('#ct-new'), $('#ct-c').value);
    $('#ct-add').onclick = async () => {
      try { await api('POST', `/api/vehicles/${id}/costs`, { status: $('#ct-s').value, categoria: $('#ct-c').value, descricao: $('#ct-d').value, valor: $('#ct-v').value, parceiro_id: $('#ct-p').value, data: $('#ct-dt').value }); await X.loadVehicles(); financeModal(id); }
      catch (e) { err(e.message); }
    };
    $$('[data-dc]').forEach((b) => { b.onclick = async () => { await api('DELETE', `/api/vehicles/${id}/costs/${b.dataset.dc}`); await X.loadVehicles(); financeModal(id); }; });
    $$('[data-cf]').forEach((b) => { b.onclick = async () => { await api('PUT', `/api/vehicles/${id}/costs/${b.dataset.cf}`, { status: 'realizado' }); await X.loadVehicles(); financeModal(id); }; });
    $$('[data-ce]').forEach((b) => { b.onclick = () => {
      const c = F.costs.find((x) => x.id === Number(b.dataset.ce)); if (!c) return;
      b.closest('.cf').outerHTML = costEditHtml(c, 'fe');
      $('#fe-x').onclick = () => financeModal(id);
      $('#fe-ok').onclick = async () => {
        try { await api('PUT', `/api/vehicles/${id}/costs/${c.id}`, { descricao: $('#fe-d').value, valor: num($('#fe-v').value), categoria: $('#fe-c').value, status: $('#fe-s').value }); await X.loadVehicles(); financeModal(id); }
        catch (e) { err(e.message); }
      };
    }; });
  }

  /* ======================= Documentação de transferência ======================= */
  async function docModal(item, refresh) {
    const hist = await api('GET', `/api/vehicles/${item.id}/doc`).catch(() => []);
    const st = Object.entries(S.me.options.doc_status || {});
    modal(`<h3>Documento: ${esc(item.titulo)}</h3>
      <p>${item.placa ? `Placa ${esc(item.placa)} · ` : ''}vendido em ${fmtDate(item.vendido_em)} (${item.dias} dias)${item.comprador ? ` · comprador ${esc(item.comprador)}` : ''}</p>
      <div class="fields">
        <div class="f w3"><label for="dc-s">Etapa</label><select id="dc-s">${opt(st, item.status)}</select></div>
        <div class="f" id="dc-eb"><label for="dc-e">Entregue em</label><input id="dc-e" type="date" value="${esc(item.entrega || today())}"></div>
        <div class="f w6"><label for="dc-o">Observação</label><input id="dc-o" placeholder="Ex.: vistoria marcada dia 20, aguardando assinatura do comprador"></div>
      </div>
      <h4>Histórico</h4>
      <div class="timeline">${hist.length ? hist.map((h) => `<div><b>${esc(h.status_label)}</b> <span class="sub">${fmtDate(h.created_at)}${h.user_name ? ' · ' + esc(h.user_name) : ''}</span>${h.obs ? `<br>${esc(h.obs)}` : ''}</div>`).join('') : '<p class="sub">Sem registros.</p>'}</div>
      <div class="err" id="dc-err" hidden></div>
      <div class="modal-foot">${item.wa_url ? `<a class="btn" href="${esc(item.wa_url)}" target="_blank" rel="noopener">Avisar comprador (WhatsApp)</a>` : ''}<button class="btn" data-close type="button">Cancelar</button><button class="btn primary" id="dc-ok" type="button">Atualizar</button></div>`, true);
    const sync = () => { $('#dc-eb').hidden = $('#dc-s').value !== 'entregue'; };
    $('#dc-s').onchange = sync; sync();
    $('#dc-ok').onclick = async () => {
      try { await api('PUT', `/api/vehicles/${item.id}/doc`, { status: $('#dc-s').value, obs: $('#dc-o').value, entrega: $('#dc-e').value }); closeModal(); toast('Documento atualizado'); refresh(); }
      catch (e) { $('#dc-err').textContent = e.message; $('#dc-err').hidden = false; }
    };
  }
  function docSteps(i) {
    const keys = Object.keys(S.me.options.doc_status || {}).filter((k) => k !== 'nao_aplica');
    if (i.status === 'nao_aplica') return '<span class="pill p-muted">Não se aplica</span>';
    const at = keys.indexOf(i.status);
    return `<div class="dsteps" title="${esc(i.status_label)}">${keys.map((k, n) => `<i class="${n <= at ? 'on' : ''}"></i>`).join('')}</div><span class="sub">${esc(i.status_label)}</span>`;
  }

  /* ======================= Gráficos simples ======================= */
  function hbars(list, val, fmt = (x) => x, label = (x) => x.label) {
    const max = Math.max(1, ...list.map((x) => Math.abs(val(x))));
    return `<div class="hbars">${list.map((x) => `<div class="hb"><span class="hl">${esc(label(x))}</span><span class="ht"><i style="width:${Math.max(2, Math.round((Math.abs(val(x)) / max) * 100))}%" class="${val(x) < 0 ? 'neg-bg' : ''}"></i></span><b>${fmt(val(x))}</b></div>`).join('')}</div>`;
  }
  function bars(meses, fin) {
    const max = Math.max(1, ...meses.map((m) => m.vendidos));
    const w = 600 / meses.length;
    const nome = (k) => new Date(k + '-15').toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
    const mil = (x) => (Math.abs(x) >= 1000 ? `${Math.round(x / 1000)} mil` : x ? String(x) : '');
    return `<svg viewBox="0 0 600 ${fin ? 200 : 180}" class="chart" role="img" aria-label="Carros vendidos por mês">${meses.map((m, i) => {
      const h = Math.round((m.vendidos / max) * 120); const x = i * w + w * 0.18; const bw = w * 0.64;
      return `<g><rect x="${x}" y="${150 - h}" width="${bw}" height="${h}" rx="4" class="bar"></rect><text x="${x + bw / 2}" y="${144 - h}" text-anchor="middle" class="bv">${m.vendidos || ''}</text><text x="${x + bw / 2}" y="168" text-anchor="middle" class="bl">${nome(m.mes)}</text>${fin ? `<text x="${x + bw / 2}" y="186" text-anchor="middle" class="bs ${m.lucro < 0 ? 'neg' : ''}">${mil(m.lucro)}</text>` : ''}</g>`;
    }).join('')}</svg>`;
  }

  /* ======================= Tela: Gestão ======================= */
  let gTab = '';
  let docFiltro = 'andamento';
  let despMes = today().slice(0, 7);
  X.views.gestao = {
    async html() {
      const fin = can('financeiro');
      const tabs = [fin && ['estoque', 'Estoque e margem'], ['local', 'Acompanhamento'], (can('vender') || can('gestao')) && ['docs', 'Documentação'], (can('vender') || can('gestao')) && ['contatos', 'Contatos'], fin && ['desp', 'Despesas da loja'], ['parc', 'Parceiros']].filter(Boolean);
      if (!tabs.some((t) => t[0] === gTab)) gTab = tabs[0][0];
      const P = await loadPartners(true);
      const V = S.vehicles.filter((v) => v.status !== 'vendido');
      const label = (key, list) => ((list || []).find((p) => p.key === key)?.label || '').split(' (')[0];
      let body = '';
      if (gTab === 'estoque') {
        const linhas = V.map((v) => ({ v, f: v.financeiro || {} })).sort((a, b) => b.v.dias_estoque - a.v.dias_estoque);
        const tot = linhas.reduce((a, { f }) => ({ inv: a.inv + (f.investido || 0), prev: a.prev + (f.custos_previstos || 0), lp: a.lp + (f.previsto?.liquido || 0), sb: a.sb + (f.falta_base ? 1 : 0) }), { inv: 0, prev: 0, lp: 0, sb: 0 });
        const venda = V.reduce((s, v) => s + (v.preco_anuncio || 0), 0);
        body = `<div class="kpis">
            <div class="kpi"><span>Carros no estoque</span><b>${V.length}</b><em>${V.filter((v) => v.parado).length} parado(s) · idade média ${V.length ? Math.round(V.reduce((s, v) => s + v.dias_estoque, 0) / V.length) : 0} dias</em></div>
            <div class="kpi"><span>Capital investido</span><b>${brl(tot.inv)}</b><em>compra + manutenções feitas</em></div>
            <div class="kpi"><span>Custos previstos</span><b>${brl(tot.prev)}</b><em>ainda a gastar</em></div>
            <div class="kpi"><span>Valor em anúncios</span><b>${brl(venda)}</b><em>preço (ou oferta) somado</em></div>
            <div class="kpi"><span>Lucro previsto</span><b class="${tot.lp < 0 ? 'neg' : ''}">${brl(tot.lp)}</b><em>${tot.sb ? `${tot.sb} carro(s) sem valor de compra` : 'pelos preços anunciados'}</em></div>
          </div>
          <div class="table-wrap"><table class="tbl"><thead><tr><th>Veículo</th><th>Propriedade</th><th>Origem</th><th class="r">Dias</th><th class="r">Compra / repasse</th><th class="r">Feitos</th><th class="r">Previstos</th><th class="r">Anúncio</th><th class="r">Lucro previsto</th><th></th></tr></thead><tbody>
          ${linhas.map(({ v, f }) => `<tr><td><div class="vcell"><div><button class="vlink" type="button" data-vp="${v.id}">${esc(v.marca)} ${esc(v.modelo)}</button><br><span class="sub">${esc(v.versao || '')} ${esc(v.placa || '')}</span></div>${v.photos?.[0] ? `<img class="vthumb" src="${esc(v.photos[0].url)}" alt="" loading="lazy" data-vp="${v.id}">` : '<span class="vthumb none"></span>'}</div></td><td>${esc(label(v.proprietario_tipo, S.me.options.propriedade))}${TERC.includes(v.proprietario_tipo) && v.proprietario_nome ? `<br>${v.proprietario_tel ? `<a class="link sub" href="${esc(waLink(v.proprietario_tel, `Olá ${v.proprietario_nome.split(' ')[0]}, aqui é da ${S.me.store.name}. Sobre o seu ${v.marca} ${v.modelo}:`))}" target="_blank" rel="noopener">💬 ${esc(v.proprietario_nome)}</a>` : `<span class="sub">${esc(v.proprietario_nome)}</span>`}` : v.doc_tipo && v.doc_tipo !== 'loja' ? `<br><span class="sub">doc: ${esc(label(v.doc_tipo, S.me.options.documentacao))}</span>` : ''}${v.troca_de_id ? '<br><span class="pill p-info">🔁 troca</span>' : ''}</td><td>${esc(label(v.compra_origem, S.me.options.origem)) || '<span class="sub">—</span>'}</td>
            <td class="r ${v.parado ? 'warn' : ''}">${v.dias_estoque}</td><td class="r">${f.previsto ? brl(f.previsto.base) : (v.compra_valor ? brl(v.compra_valor) : '<span class="pill p-warn">informar</span>')}</td><td class="r">${brl(f.custos_realizados ?? f.custos_total ?? 0)}</td><td class="r">${f.custos_previstos ? brl(f.custos_previstos) : '—'}</td><td class="r">${brl(v.preco_anuncio)}</td>
            <td class="r ${f.previsto?.liquido < 0 ? 'neg' : ''}">${f.previsto ? `${brl(f.previsto.liquido)}<br><span class="sub">${pct(f.previsto.margem_pct)}%</span>` : '—'}</td>
            <td><button class="btn sm" type="button" data-fin="${v.id}">Abrir</button></td></tr>`).join('') || '<tr><td colspan="10" class="sub">Nenhum carro no estoque.</td></tr>'}</tbody></table></div>
          <p class="note">Dica: no cadastro de cada carro, a seção <b>Gestão do veículo</b> já calcula o lucro previsto enquanto você preenche.</p>`;
      }
      if (gTab === 'local') {
        const grupos = Object.entries(P.locais).map(([k, l]) => [k, l, V.filter((v) => (v.local_status || 'patio') === k)]).filter(([k, , list]) => list.length || k === 'patio');
        body = `<div class="board">${grupos.map(([k, l, list]) => `<div class="col"><h3>${esc(l)} <span class="sub">${list.length}</span></h3>${list.map((v) => `
          <div class="card2">
            <div class="t"><button class="vlink" type="button" data-vp="${v.id}">${esc(v.marca)} ${esc(v.modelo)}</button> <span class="sub">${esc(v.placa || '')}</span></div>
            ${v.local_parceiro ? `<div class="sub">${esc(v.local_parceiro.nome)} · ${esc(v.local_parceiro.tipo)}${v.local_obs ? ' · ' + esc(v.local_obs) : ''}</div>
              <div class="sub">Há ${v.local_dias} dia(s)${v.local_previsao ? ` · previsão ${fmtDate(v.local_previsao)}` : ''}${v.local_previsao && v.local_previsao < today() ? ' <span class="pill p-bad">atrasado</span>' : ''}</div>` : `<div class="sub">${v.dias_estoque} dias no estoque${v.parado ? ' · <span class="pill p-warn">parado</span>' : ''}</div>`}
            <div class="btnrow" style="gap:6px;margin-top:6px">${v.followup_url ? `<a class="btn sm" href="${esc(v.followup_url)}" target="_blank" rel="noopener">Pedir andamento (WhatsApp)</a>` : ''}${can('parceiros') ? `<button class="btn sm ${k === 'patio' ? '' : 'ghost'}" type="button" data-loc="${v.id}">${k === 'patio' ? 'Enviar para…' : 'Mudar'}</button>` : ''}</div>
          </div>`).join('') || '<p class="sub">Nenhum carro.</p>'}</div>`).join('')}</div>
          <p class="note">"Pedir andamento" abre o WhatsApp do parceiro com a mensagem pronta (carro, placa e desde quando está lá). Envio 100% automático exige a API paga do WhatsApp Business.</p>`;
      }
      if (gTab === 'docs') {
        const D = await api('GET', '/api/docs');
        const and = D.docs.filter((x) => !x.done);
        const list = docFiltro === 'andamento' ? and : docFiltro === 'concluidos' ? D.docs.filter((x) => x.done) : D.docs;
        body = `<div class="kpis">
            <div class="kpi"><span>Em andamento</span><b>${and.length}</b><em>vendidos com documento a concluir</em></div>
            <div class="kpi"><span>Sem preenchimento</span><b class="${and.filter((x) => x.status === 'pendente').length ? 'warn' : ''}">${and.filter((x) => x.status === 'pendente').length}</b><em>ATPV-e / recibo pendente</em></div>
            <div class="kpi"><span>Mais de 30 dias</span><b class="${and.filter((x) => x.dias > 30).length ? 'neg' : ''}">${and.filter((x) => x.dias > 30).length}</b><em>prazo legal de transferência: 30 dias</em></div>
            <div class="kpi"><span>Entregues (90 dias)</span><b>${D.docs.filter((x) => x.status === 'entregue').length}</b></div>
          </div>
          <div class="chips" style="margin-bottom:10px">${[['andamento', 'Em andamento'], ['concluidos', 'Concluídos'], ['todos', 'Todos']].map(([k, l]) => `<button class="chip" type="button" data-df="${k}" aria-pressed="${k === docFiltro}">${l}</button>`).join('')}</div>
          <div class="table-wrap"><table class="tbl"><thead><tr><th>Veículo</th><th>Venda</th><th>Comprador</th><th>Etapa</th><th>Atualizado</th><th></th></tr></thead><tbody>
          ${list.map((i) => `<tr><td><button class="vlink" type="button" data-vp="${i.id}">${esc(i.titulo)}</button><br><span class="sub">${esc(i.placa || '')}${i.doc_tipo && i.doc_tipo !== 'loja' ? ` · doc: ${esc(label(i.doc_tipo, S.me.options.documentacao))}` : ''}</span></td>
            <td>${fmtDate(i.vendido_em)}<br><span class="sub ${!i.done && i.dias > 30 ? 'neg' : ''}">${i.dias} dias${i.vendedor ? ' · ' + esc(i.vendedor) : ''}</span></td>
            <td>${esc(i.comprador || '—')}${i.comprador_tel ? `<br><span class="sub">${esc(i.comprador_tel)}</span>` : ''}</td>
            <td>${docSteps(i)}${i.obs ? `<br><span class="sub">${esc(i.obs)}</span>` : ''}</td>
            <td>${fmtDate(i.atualizado)}</td>
            <td><div class="btnrow" style="gap:4px;flex-wrap:nowrap">${i.wa_url ? `<a class="btn sm" href="${esc(i.wa_url)}" target="_blank" rel="noopener" title="Avisar o comprador">WhatsApp</a>` : ''}<button class="btn sm primary" type="button" data-doc="${i.id}">Atualizar</button></div></td></tr>`).join('') || '<tr><td colspan="6" class="sub">Nada por aqui. Ao marcar um carro como vendido, a transferência do documento aparece nesta lista.</td></tr>'}</tbody></table></div>
          <p class="note">Etapas: ${Object.values(S.me.options.doc_status || {}).filter((x) => x !== 'Não se aplica').join(' → ')}.</p>`;
        X._docs = D.docs;
      }
      if (gTab === 'desp') {
        const [y, m] = despMes.split('-').map(Number);
        const from = `${despMes}-01`; const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
        const [E, sellersE] = await Promise.all([api('GET', `/api/expenses?from=${from}&to=${to}`), api('GET', '/api/team/sellers').catch(() => [])]);
        const vendidosRec = S.vehicles.filter((v) => v.status === 'vendido').slice(0, 60);
        const total = E.despesas.reduce((s, e) => s + e.valor, 0);
        const cats = {}; E.despesas.forEach((e) => { cats[e.categoria_label] = (cats[e.categoria_label] || 0) + e.valor; });
        body = `<div class="toolbar" style="gap:8px;flex-wrap:wrap;margin-bottom:10px"><button class="btn sm" type="button" data-dm="-1" aria-label="Mês anterior">‹</button><b style="min-width:150px;text-align:center">${new Date(despMes + '-15').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</b><button class="btn sm" type="button" data-dm="1" aria-label="Próximo mês">›</button></div>
          <div class="grid2">
            <div class="panel"><h2>Lançar despesa</h2>
              <div class="fields">
                <div class="f"><label for="ex-d">Data / vencimento</label><input id="ex-d" type="date" value="${despMes === today().slice(0, 7) ? today() : from}"></div>
                <div class="f"><label for="ex-c">Categoria</label><select id="ex-c">${opt(Object.entries(E.categorias), 'aluguel')}</select></div>
                <div class="f w3"><label for="ex-t">Descrição</label><input id="ex-t" placeholder="Ex.: aluguel do pátio"></div>
                <div class="f"><label for="ex-v">Valor (R$)</label><input id="ex-v" inputmode="numeric"></div>
                <div class="f ex-com"><label for="ex-vd">Vendedor</label><select id="ex-vd"><option value="">Selecione</option>${sellersE.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div>
                <div class="f w3 ex-com"><label for="ex-vc">Venda (opcional)</label><select id="ex-vc"><option value="">—</option>${vendidosRec.map((v) => `<option value="${v.id}">${esc(v.marca)} ${esc(v.modelo)} ${esc(v.placa || '')}${v.vendido_em ? ' · ' + fmtDate(v.vendido_em) : ''}</option>`).join('')}</select></div>
                <div class="f"><label for="ex-r">Repetir</label><select id="ex-r"><option value="1">Só este mês</option><option value="3">3 meses</option><option value="6">6 meses</option><option value="12">12 meses</option></select></div>
                <div class="f" style="align-self:end"><label class="check" style="padding:8px 10px"><input type="checkbox" id="ex-p" checked><div><b>Já está pago</b></div></label></div>
              </div>
              <p class="note">Desmarque "Já está pago" para lançar uma <b>conta a pagar</b>: a data vira o vencimento e ela aparece no Painel até ser paga. Ao repetir, os meses seguintes entram como contas a pagar.</p>
              <div class="err" id="ex-err" hidden></div>
              <div class="form-foot"><button class="btn primary" type="button" id="ex-add">Lançar</button></div>
              <p class="note">Despesas fixas da loja (aluguel, salários, energia, sistemas…). Entram no resultado líquido em Resultados.</p></div>
            <div class="panel"><h2>Total do mês: ${brl(total)}</h2>${Object.keys(cats).length ? hbars(Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([label, valor]) => ({ label, valor })), (x) => x.valor, brl) : '<p class="sub">Nenhuma despesa lançada neste mês.</p>'}</div>
          </div>
          <div class="cfields" style="margin-top:12px">${E.despesas.map((e) => `<div class="cf"><span class="k">${esc(e.categoria_label)}<br><span class="sub">${fmtDate(e.data)}</span></span><span class="v">${esc(e.descricao || '')}${e.vendedor_nome ? ` <span class="pill p-info">${esc(e.vendedor_nome)}</span>` : ''}${e.veiculo ? ` <span class="sub">${esc(e.veiculo)}</span>` : ''}<br><b>${brl(e.valor)}</b> ${e.pago ? '' : `<span class="pill ${e.data < today() ? 'p-bad' : 'p-warn'}">${e.data < today() ? 'vencida' : 'a pagar'}</span>`}</span><span class="btnrow" style="gap:4px">${e.pago ? '' : `<button class="btn sm" type="button" data-epay="${e.id}">Marcar pago</button>`}<button class="btn sm ghost danger" type="button" data-ed="${e.id}">Excluir</button></span></div>`).join('')}</div>
          <p class="note">Comissão de vendedor lançada aqui entra no resultado como comissão (e no ranking de vendedores), não como despesa fixa. A comissão também pode ser informada ao concluir a venda.</p>`;
      }
      if (gTab === 'contatos') body = await contatosHtml();
      if (gTab === 'parc') {
        body = `<div class="btnrow" style="margin-bottom:10px">${can('parceiros') ? '<button class="btn primary" type="button" id="ptNew">+ Novo parceiro</button>' : ''}</div>
          <div class="cfields">${P.partners.length ? P.partners.map((p) => `<div class="cf"><span class="k"><b>${esc(p.nome)}</b><br><span class="sub">${esc(p.tipo_label)}</span></span><span class="v">${esc(p.contato || '')} ${esc(p.whatsapp || '')}<br><span class="sub">${p.carros} carro(s) lá agora${p.endereco ? ' · ' + esc(p.endereco) : ''}</span></span><span class="btnrow" style="gap:6px">${p.wa ? `<a class="btn sm" href="https://wa.me/${p.wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}${can('parceiros') ? `<button class="btn sm" type="button" data-pe="${p.id}">Editar</button>` : ''}</span></div>`).join('') : '<div class="cf"><span class="v sub">Cadastre oficinas, funilarias, estética, lavador, lojas parceiras e despachante para saber onde cada carro está.</span></div>'}</div>`;
      }
      return `<div class="head"><div><h1>Gestão</h1><p>Estoque, margem, acompanhamento dos carros, documentos das vendas e despesas da loja. Clique no nome de um carro para ver os dados.</p></div></div>
        <div class="chips tabs" style="margin-bottom:14px">${tabs.map(([k, l]) => `<button class="chip" type="button" data-gt="${k}" aria-pressed="${k === gTab}">${l}</button>`).join('')}</div>${body}`;
    },
    bind() {
      $$('[data-gt]').forEach((b) => { b.onclick = () => { gTab = b.dataset.gt; X.render(); }; });
      $$('[data-loc]').forEach((b) => { b.onclick = () => locationModal(S.vehicles.find((v) => v.id === Number(b.dataset.loc))); });
      $$('[data-fin]').forEach((b) => { b.onclick = () => financeModal(Number(b.dataset.fin)); });
      $$('[data-pe]').forEach((b) => { b.onclick = () => partnerForm(PARTNERS.partners.find((p) => p.id === Number(b.dataset.pe))); });
      if ($('#ptNew')) $('#ptNew').onclick = () => partnerForm();
      if (gTab === 'contatos') contatosBind();
      $$('[data-df]').forEach((b) => { b.onclick = () => { docFiltro = b.dataset.df; X.render(); }; });
      $$('[data-doc]').forEach((b) => { b.onclick = () => docModal(X._docs.find((i) => i.id === Number(b.dataset.doc)), () => X.render()); });
      $$('[data-dm]').forEach((b) => { b.onclick = () => { const [y, m] = despMes.split('-').map(Number); despMes = new Date(Date.UTC(y, m - 1 + Number(b.dataset.dm), 1)).toISOString().slice(0, 7); X.render(); }; });
      if ($('#ex-c')) { const sx = () => { const c = $('#ex-c').value === 'comissao'; $$('.ex-com').forEach((e) => { e.hidden = !c; }); if (c && !$('#ex-t').value) $('#ex-t').placeholder = 'Ex.: comissão da venda do Onix'; }; $('#ex-c').onchange = sx; sx(); }
      if ($('#ex-add')) $('#ex-add').onclick = async () => {
        try { await api('POST', '/api/expenses', { data: $('#ex-d').value, categoria: $('#ex-c').value, descricao: $('#ex-t').value, valor: $('#ex-v').value, repetir: $('#ex-r').value, vendedor_id: $('#ex-vd').value, vehicle_id: $('#ex-vc').value, pago: $('#ex-p').checked }); toast('Despesa lançada'); X.render(); }
        catch (e) { $('#ex-err').textContent = e.message; $('#ex-err').hidden = false; }
      };
      $$('[data-epay]').forEach((b) => { b.onclick = async () => { await api('PUT', `/api/expenses/${b.dataset.epay}/pago`, {}); toast('Conta paga'); X.render(); }; });
      $$('[data-ed]').forEach((b) => { b.onclick = () => confirmBox('Excluir a despesa?', '', 'Excluir', async () => { await api('DELETE', `/api/expenses/${b.dataset.ed}`); X.render(); }, true); });
    },
  };

  /* ======================= Tela: Resultados ======================= */
  const R = { from: '', to: '', tipo: '', vendedor: '', origem: '', periodo: 'mes' };
  function periodRange(p) {
    const d = new Date(); const y = d.getFullYear(); const m = d.getMonth();
    const iso = (x) => x.toISOString().slice(0, 10);
    if (p === 'mes') return [iso(new Date(Date.UTC(y, m, 1))), iso(d)];
    if (p === 'anterior') return [iso(new Date(Date.UTC(y, m - 1, 1))), iso(new Date(Date.UTC(y, m, 0)))];
    if (p === '90') return [iso(new Date(Date.now() - 90 * 864e5)), iso(d)];
    if (p === 'ano') return [iso(new Date(Date.UTC(y, 0, 1))), iso(d)];
    if (p === '12m') return [iso(new Date(Date.UTC(y, m - 11, 1))), iso(d)];
    return [R.from, R.to];
  }
  X.views.resultados = {
    async html() {
      if (!can('gestao')) return '<div class="err">Seu usuário não tem acesso aos resultados.</div>';
      const [from, to] = periodRange(R.periodo);
      const q = new URLSearchParams({ from: from || '', to: to || '', tipo: R.tipo, vendedor: R.vendedor, origem: R.origem });
      const [d, sellers] = await Promise.all([api('GET', '/api/results?' + q), api('GET', '/api/team/sellers').catch(() => [])]);
      const k = d.kpis; const D = d.dre;
      const card = (l, v, e = '', cls = '') => `<div class="kpi"><span>${l}</span><b class="${cls}">${v}</b>${e ? `<em>${e}</em>` : ''}</div>`;
      const fin = can('financeiro');
      const neg = (x) => (x < 0 ? 'neg' : '');
      const grpTable = (rows, first) => (rows.length ? `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>${first}</th><th class="r">Vendas</th><th class="r">Dias médios</th>${fin ? '<th class="r">Ticket</th><th class="r">Lucro</th>' : ''}</tr></thead><tbody>${rows.map((g) => `<tr><td>${esc(g.label)}</td><td class="r">${g.qtd}</td><td class="r">${g.dias_medio}</td>${fin ? `<td class="r">${brl(g.ticket)}</td><td class="r ${neg(g.lucro)}">${brl(g.lucro)}</td>` : ''}</tr>`).join('')}</tbody></table></div>` : '<p class="sub">Sem vendas no período.</p>');
      const dreRow = (l, v, cls = '') => `<tr class="${cls}"><td>${l}</td><td class="r ${neg(v)}">${brl(v)}</td></tr>`;
      return `<div class="head"><div><h1>Resultados</h1><p>${fmtDate(d.periodo.from)} a ${fmtDate(d.periodo.to)}</p></div>${fin ? `<a class="btn" href="/api/results.csv?${q}" download>Exportar vendas (planilha)</a>` : ''}</div>
        <div class="toolbar" style="flex-wrap:wrap;gap:8px">
          <div class="chips">${[['mes', 'Este mês'], ['anterior', 'Mês passado'], ['90', '90 dias'], ['ano', 'Este ano'], ['12m', '12 meses'], ['custom', 'Escolher']].map(([k2, l]) => `<button class="chip" type="button" data-rp="${k2}" aria-pressed="${R.periodo === k2}">${l}</button>`).join('')}</div>
          ${R.periodo === 'custom' ? `<input type="date" id="r-from" value="${esc(R.from)}" aria-label="De"> <input type="date" id="r-to" value="${esc(R.to)}" aria-label="Até">` : ''}
          <select id="r-tipo" aria-label="Propriedade"><option value="">Toda propriedade</option>${(S.me.options.propriedade || []).map((p) => `<option value="${p.key}" ${p.key === R.tipo ? 'selected' : ''}>${esc(p.label.split(' (')[0])}</option>`).join('')}</select>
          <select id="r-orig" aria-label="Origem"><option value="">Toda origem</option>${(S.me.options.origem || []).map((p) => `<option value="${p.key}" ${p.key === R.origem ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select>
          <select id="r-vend" aria-label="Vendedor"><option value="">Todos os vendedores</option>${sellers.map((s) => `<option value="${s.id}" ${String(s.id) === String(R.vendedor) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
        </div>
        <div class="kpis">
          ${card('Vendidos', k.vendidos, `giro de ${k.giro}% do estoque`)}
          ${fin ? card('Faturamento', brl(k.faturamento), `ticket médio ${brl(k.ticket_medio)}`) : ''}
          ${fin ? card('Lucro das vendas', brl(k.lucro_liquido), `${pct(k.margem_media_pct)}% de margem · ${brl(k.lucro_medio)}/carro`, neg(k.lucro_liquido)) : ''}
          ${fin && k.vendas_em_troca ? card('Trocas no estoque', brl(k.trocas_estoque_valor), `${k.vendas_em_troca} carro(s) recebido(s) na troca ainda à venda`) : ''}
          ${fin ? card('Despesas da loja', brl(k.despesas_loja), 'lançadas em Gestão') : ''}
          ${fin ? card('Resultado líquido', brl(k.resultado), 'lucro das vendas − despesas', neg(k.resultado)) : ''}
          ${card('Tempo médio de venda', `${k.dias_medios_venda} dias`, 'da compra até a venda')}
          ${fin ? card('Desconto médio', `${pct(k.desconto_medio_pct)}%`, 'venda × preço anunciado') : ''}
          ${card('Estoque', k.estoque_qtd, fin ? `${brl(k.estoque_valor_venda)} em anúncios` : `${k.parados} parado(s)`)}
          ${fin ? card('Capital investido', brl(k.capital_investido), `${brl(k.custos_previstos)} previstos · lucro previsto ${brl(k.lucro_previsto_estoque)}`) : ''}
          ${card('Idade média do estoque', `${k.idade_media_estoque} dias`, `${k.parados} parado(s) ≥ ${d.parado_dias} dias · ${k.parados_60} ≥ 60`, k.parados ? 'warn' : '')}
          ${card('Documentos pendentes', k.docs_pendentes, `${k.docs_atrasados} com mais de 30 dias`, k.docs_atrasados ? 'neg' : '')}
          ${card('Fora do pátio', k.em_manutencao, `${k.consignados} consignado(s) no estoque`)}
        </div>
        <div class="grid2 eq" style="margin-top:6px">
          <div class="panel"><h2>Vendas nos últimos 12 meses</h2>${bars(d.meses, fin)}${fin ? '<p class="note">Número de carros por mês; abaixo, o lucro das vendas.</p>' : ''}</div>
          ${fin ? `<div class="panel"><h2>DRE do período</h2><table class="tbl dre"><tbody>
            ${dreRow('Receita das vendas', D.receita)}${D.retorno_financiamento ? dreRow('(+) Retorno de financiamento', D.retorno_financiamento) : ''}${dreRow('(−) Custo dos veículos (compra / repasse)', -D.custo_veiculos)}${dreRow('(−) Preparação e manutenção', -D.preparacao)}
            ${dreRow('= Lucro bruto', D.lucro_bruto, 'sub-t')}${dreRow('(−) Comissões de venda', -(D.comissoes + (D.comissoes_extra || 0)))}${dreRow('(−) Impostos sobre a venda', -D.impostos)}
            ${dreRow('= Lucro das vendas', D.lucro_operacoes, 'sub-t')}${D.despesas_categorias.map((c) => dreRow(`(−) ${esc(c.categoria)}`, -c.valor)).join('') || dreRow('(−) Despesas da loja', 0)}
            ${dreRow('= Resultado líquido', D.resultado, 'tot-t')}</tbody></table>
            <p class="note">Vendas com troca entram com o lucro na data da venda. O carro da troca entra no estoque com custo igual ao valor dado na troca, então o lucro não é contado duas vezes. ${D.receita_em_trocas ? `Da receita, ${brl(D.receita_em_trocas)} vieram em carros na troca.` : ''}</p>
            ${d.em_troca?.length ? `<p class="note">Trocas ainda no estoque: ${d.em_troca.slice(0, 5).map((x) => `<button class="vlink" type="button" data-vp="${x.troca_id}">${esc(x.troca_titulo)}</button> (da venda do <button class="vlink" type="button" data-vp="${x.id}">${esc(x.titulo)}</button>)`).join(' · ')}</p>` : ''}
            ${D.fora_do_calculo ? `<p class="note">${D.fora_do_calculo} venda(s) sem valor de compra ou de venda ficaram fora do DRE. Complete em "custos" na lista abaixo.</p>` : ''}</div>` : ''}
        </div>
        <div class="grid2 eq" style="margin-top:16px">
          <div class="panel"><h2>Tempo até vender</h2>${k.vendidos ? hbars(d.faixas_venda, (x) => x.qtd, (x) => `${x}`) : '<p class="sub">Sem vendas no período.</p>'}</div>
          <div class="panel"><h2>Idade do estoque</h2>${hbars(d.faixas_estoque, (x) => x.qtd, (x) => `${x}`)}${fin ? `<p class="note">Acima de 60 dias: ${brl(d.faixas_estoque.slice(4).reduce((s, f) => s + f.investido, 0))} investidos.</p>` : ''}</div>
        </div>
        <div class="grid2 eq" style="margin-top:16px">
          <div class="panel"><h2>Vendas por marca</h2>${grpTable(d.marcas, 'Marca')}</div>
          <div class="panel"><h2>Vendedores</h2>${d.vendedores.length ? `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Vendedor</th><th class="r">Vendas</th><th class="r">Dias médios</th>${fin ? '<th class="r">Faturamento</th><th class="r">Lucro</th><th class="r">Comissão</th>' : ''}</tr></thead><tbody>${d.vendedores.map((g, i) => `<tr><td>${i === 0 ? '🏆 ' : ''}${esc(g.label)}</td><td class="r">${g.qtd}</td><td class="r">${g.dias_medio}</td>${fin ? `<td class="r">${brl(g.faturamento)}</td><td class="r ${neg(g.lucro)}">${brl(g.lucro)}</td><td class="r">${brl(g.comissao)}</td>` : ''}</tr>`).join('')}</tbody></table></div>` : '<p class="sub">Sem vendas no período.</p>'}</div>
        </div>
        <div class="grid2 eq" style="margin-top:16px">
          <div class="panel"><h2>Formas de pagamento</h2>${d.pagamentos.length ? hbars(d.pagamentos, (x) => x.qtd, (x) => `${x} venda${x > 1 ? 's' : ''}`) : '<p class="sub">Sem vendas no período.</p>'}</div>
          <div class="panel"><h2>Origem da compra</h2>${grpTable(d.origens, 'Origem')}</div>
        </div>
        ${fin && d.melhores.length ? `<div class="grid2 eq" style="margin-top:16px">
          <div class="panel"><h2>Maiores lucros</h2>${hbars(d.melhores, (x) => x.liquido, brl, (x) => x.titulo)}</div>
          <div class="panel"><h2>Menores lucros</h2>${d.piores.length ? hbars(d.piores, (x) => x.liquido, brl, (x) => x.titulo) : '<p class="sub">Poucas vendas para comparar.</p>'}</div>
        </div>` : ''}
        <div class="panel" style="margin-top:16px"><h2>Vendidos no período</h2>${d.vendidos.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Veículo</th><th>Venda</th><th>Vendedor / pagamento</th><th class="r">Dias</th>${fin ? '<th class="r">Valor</th><th class="r">Compra</th><th class="r">Custos</th><th class="r">Líquido</th><th></th>' : ''}</tr></thead><tbody>${d.vendidos.map((l) => `<tr><td><button class="vlink" type="button" data-vp="${l.id}">${esc(l.titulo)}</button><br><span class="sub">${esc(l.placa || '')} · ${esc(l.origem_label)}</span></td><td>${fmtDate(l.vendido_em)}<br><span class="sub">${esc(l.comprador || '')}</span></td><td>${esc(l.vendedor || '—')}<br><span class="sub">${esc(l.pagamento)}</span></td><td class="r">${l.dias}</td>${fin ? `<td class="r">${l.venda ? brl(l.venda) : '—'}</td><td class="r">${l.base ? brl(l.base) : '<span class="pill p-warn">informar</span>'}</td><td class="r">${brl(l.custos)}</td><td class="r ${neg(l.liquido)}">${l.liquido !== null ? `${brl(l.liquido)}<br><span class="sub">${pct(l.margem_pct)}%</span>` : '—'}${l.em_troca ? '<br><span class="pill p-info" title="O carro recebido na troca ainda está no estoque">🔁 com troca</span>' : ''}</td><td><button class="btn sm ghost" type="button" data-fin="${l.id}">custos</button></td>` : ''}</tr>`).join('')}</tbody></table></div>` : '<p class="sub">Nenhuma venda no período.</p>'}</div>
        <div class="panel" style="margin-top:16px"><h2>Estoque mais antigo</h2>${d.estoque.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Veículo</th><th class="r">Dias</th>${fin ? '<th class="r">Anúncio</th><th class="r">FIPE</th><th class="r">Investido</th><th class="r">Lucro previsto</th>' : ''}<th>Onde</th></tr></thead><tbody>${d.estoque.slice(0, 10).map((e) => `<tr><td><button class="vlink" type="button" data-vp="${e.id}">${esc(e.titulo)}</button><br><span class="sub">${esc(e.placa || '')} · ${esc(e.tipo_label.split(' (')[0])}</span></td><td class="r ${e.parado ? 'warn' : ''}">${e.dias}</td>${fin ? `<td class="r">${brl(e.preco)}</td><td class="r">${e.fipe ? brl(e.fipe) : '—'}</td><td class="r">${brl(e.investido)}</td><td class="r ${neg(e.lucro_previsto)}">${e.lucro_previsto !== null ? brl(e.lucro_previsto) : '—'}</td>` : ''}<td>${esc(e.local || 'Pátio')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="sub">Estoque vazio.</p>'}</div>`;
    },
    bind() {
      $$('[data-rp]').forEach((b) => { b.onclick = () => { R.periodo = b.dataset.rp; if (R.periodo === 'custom' && !R.from) [R.from, R.to] = periodRange('mes'); X.render(); }; });
      if ($('#r-from')) { $('#r-from').onchange = () => { R.from = $('#r-from').value; X.render(); }; $('#r-to').onchange = () => { R.to = $('#r-to').value; X.render(); }; }
      $('#r-tipo') && ($('#r-tipo').onchange = () => { R.tipo = $('#r-tipo').value; X.render(); });
      $('#r-orig') && ($('#r-orig').onchange = () => { R.origem = $('#r-orig').value; X.render(); });
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
      ${team ? `<div class="panel" id="cfgTeam"><h2>Equipe</h2><p class="lead">${team.users.length - 1} vendedor(es) cadastrado(s). Cadastro, acessos e permissões ficam no menu <b>Equipe</b>.</p><div class="btnrow"><a class="btn" href="#equipe">Abrir Equipe</a></div></div>` : ''}
      <div class="panel"><h2>Minha senha</h2>
        <div class="fields"><div class="f"><label for="pw-a">Senha atual</label><input id="pw-a" type="password" autocomplete="current-password"></div><div class="f"><label for="pw-n">Nova senha</label><input id="pw-n" type="password" autocomplete="new-password" placeholder="mínimo 8 caracteres"></div><div class="f" style="align-self:end"><button class="btn" type="button" id="pw-ok">Trocar senha</button></div></div></div>
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
    $('#pw-ok').onclick = async () => {
      try { await api('PUT', '/api/me/password', { atual: $('#pw-a').value, nova: $('#pw-n').value }); $('#pw-a').value = ''; $('#pw-n').value = ''; toast('Senha trocada'); }
      catch (e) { toast(e.message, 6000); }
    };
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
    waConfigPanel();
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

  /* ======================= Ficha rápida do veículo (v2.2) ======================= */
  async function vehiclePop(id) {
    let v = S.vehicles.find((x) => x.id === id);
    if (!v) { await X.loadVehicles(); v = S.vehicles.find((x) => x.id === id); }
    if (!v) return toast('Veículo não encontrado.');
    const fin = can('financeiro'); const f = v.financeiro || {};
    const lab = (key, list) => ((list || []).find((p) => p.key === key)?.label || '').split(' (')[0];
    const st = { rascunho: ['p-muted', 'Rascunho'], pronto: ['p-info', 'Pronto'], publicado: ['p-ok', 'No Marketplace'], vendido: ['p-muted', 'Vendido'] }[v.status] || ['p-muted', v.status];
    const kv = (k, val) => (val ? `<div class="kv2"><span>${k}</span><b>${val}</b></div>` : '');
    const vend = v.status === 'vendido';
    const sellers = vend ? await api('GET', '/api/team/sellers').catch(() => []) : [];
    modal(`<div class="vpop ${v.photos?.[0] ? '' : 'noimg'}">
        ${v.photos?.[0] ? `<img src="${esc(v.photos[0].url)}" alt="" class="vpop-img">` : ''}
        <div class="vpop-main">
          <h3>${esc(v.marca)} ${esc(v.modelo)} <span class="sub">${esc(v.versao || '')}</span></h3>
          <p><span class="pill ${st[0]}">${st[1]}</span>${v.parado ? ' <span class="pill p-warn">parado</span>' : ''}${v.placa ? ` <b class="mono">${esc(v.placa)}</b>` : ''}</p>
          <div class="kvs">
            ${kv('Ano', [v.ano_fab, v.ano_modelo].filter(Boolean).join('/'))}${kv('KM', v.km ? km(v.km) : '')}${kv('Cor', esc(v.cor || ''))}${kv('Câmbio', esc(v.cambio || ''))}
            ${kv('Preço', v.preco ? brl(v.preco) + (v.oferta_ativa ? ` · oferta ${brl(v.preco_oferta)}` : '') : '')}${kv('FIPE', v.fipe ? brl(v.fipe) : '')}
            ${kv('Repasse', v.preco_repasse ? brl(v.preco_repasse) : '')}${kv(vend ? 'Dias até vender' : 'Dias no estoque', String(v.dias_estoque))}
            ${kv('Propriedade', esc(lab(v.proprietario_tipo, S.me.options.propriedade)) + (TERC.includes(v.proprietario_tipo) && margemTxt(v) ? ` · margem ${margemTxt(v)}` : ''))}${kv('Documentação', esc(lab(v.doc_tipo, S.me.options.documentacao)))}
            ${!vend && v.local_status && v.local_status !== 'patio' ? kv('Onde está', esc(v.local_label) + (v.local_parceiro ? ': ' + esc(v.local_parceiro.nome) : '')) : ''}
            ${fin ? kv(f.base_label || 'Compra', f.previsto ? brl(f.previsto.base) : v.compra_valor ? brl(v.compra_valor) : '<span class="pill p-warn">informar</span>') : ''}
            ${fin ? kv('Custos', `${brl(f.custos_realizados ?? f.custos_total ?? 0)}${f.custos_previstos ? ` + ${brl(f.custos_previstos)} previstos` : ''}`) : ''}
            ${fin && !vend && f.previsto ? kv('Lucro previsto', `<span class="${f.previsto.liquido < 0 ? 'neg' : ''}">${brl(f.previsto.liquido)} · ${pct(f.previsto.margem_pct)}%</span>`) : ''}
            ${vend ? kv('Vendido em', fmtDate(v.vendido_em)) + kv('Valor da venda', v.venda_valor ? brl(v.venda_valor) : '') + kv('Comprador', esc(v.venda_comprador || '')) + kv('Vendedor', esc(sellers.find((x) => x.id === v.venda_vendedor_id)?.name || '')) + kv('Pagamento', esc(v.venda_pagamento || '')) + (v.venda_troca_valor ? kv('Na troca', `${brl(v.venda_troca_valor)}${v.venda_troca_id ? ` · <button class="vlink" type="button" data-vp="${v.venda_troca_id}">${esc(v.venda_troca_desc || 'ver carro')}</button>` : ''}`) : '') + (v.venda_financiado ? kv('Financiado', `${brl(v.venda_financiado)}${v.venda_financeira ? ' · ' + esc(v.venda_financeira) : ''}${v.venda_fin_parcelas ? ` · ${v.venda_fin_parcelas}x ${brl(v.venda_fin_parcela)}` : ''}`) : '') + (v.venda_boleto_qtd ? kv('Boletos', `${v.venda_boleto_qtd}x ${brl(v.venda_boleto_valor)}`) : '') + kv('Documento', esc(v.doc_status_label || '')) : ''}
            ${fin && vend && f.real ? kv('Lucro da venda', `<span class="${f.real.liquido < 0 ? 'neg' : ''}">${brl(f.real.liquido)} · ${pct(f.real.margem_pct)}%</span>`) : ''}
          </div>
        </div>
      </div>
      <div class="modal-foot">${fin ? '<button class="btn" type="button" id="vp-fin">Custos e margem</button>' : ''}<button class="btn" data-close type="button">Fechar</button>${can('cadastrar') || can('vender') ? '<button class="btn primary" type="button" id="vp-ed">Editar</button>' : ''}</div>`, true);
    if ($('#vp-ed')) $('#vp-ed').onclick = () => { if (vend && !can('cadastrar')) return saleEditModal(id); closeModal(); location.hash = 'editar-' + id; };
    if ($('#vp-fin')) $('#vp-fin').onclick = () => financeModal(id);
  }
  // Republicação: tirar da lista "Não concluídas" (deu certo ou dispensar).
  document.addEventListener('click', async (e) => {
    const j = e.target.closest('[data-jres]'); if (!j) return;
    j.disabled = true;
    try { await api('POST', `/api/jobs/${j.dataset.jres}/resolve`, { deu_certo: !!j.dataset.ok }); await X.loadVehicles(); X.S.jobs = await api('GET', '/api/jobs'); X.render(); toast(j.dataset.ok ? 'Marcado como publicado' : 'Aviso dispensado'); }
    catch (err) { toast(err.message); j.disabled = false; }
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-vp]');
    if (b) { e.preventDefault(); vehiclePop(Number(b.dataset.vp)); }
  });

  /* ======================= Grupos de repasse (v2.2) ======================= */
  X.repasseModal = async (v, back) => {
    let R;
    try { R = await api('GET', `/api/vehicles/${v.id}/repasse`); } catch (e) { return toast(e.message, 6000); }
    const ultimo = (nome) => R.posts.find((p) => p.grupo === nome);
    const tabs = [['instagram', 'Instagram'], ['webmotors', 'Webmotors'], ['olx', 'OLX'], ['repasse', 'Grupo de repasse']];
    // wa.me quebra os emojis no WhatsApp Web; por isso abre direto o app (celular) ou o WhatsApp Web (computador).
    const waUrl = (t) => (isMobile() ? `whatsapp://send?text=${encodeURIComponent(t)}` : `https://web.whatsapp.com/send?text=${encodeURIComponent(t)}`);
    modal(`<h3>Divulgar ${esc(v.marca)} ${esc(v.modelo)}</h3>
      <div class="chips" role="tablist">${tabs.map(([k, l]) => `<button class="chip" type="button" role="tab" data-rtab="${k}" aria-pressed="${k === 'repasse'}">${l}</button>`).join('')}</div>
      <p class="note">Para grupos de lojistas no WhatsApp, Facebook ou Telegram. Esses apps não deixam sistemas postarem sozinhos em grupos, então o GiroAuto deixa o texto e as fotos prontos e registra em quais grupos o carro já foi enviado.</p>
      <div class="fields">
        <div class="f"><label for="rp-p">Preço de repasse (R$)</label><input id="rp-p" inputmode="numeric" value="${R.preco_repasse || ''}" placeholder="${R.preco ? brl(R.preco) : ''}" ${can('precos') ? '' : 'disabled'}><span class="hint">Anúncio ${brl(R.preco)}${R.fipe ? ` · FIPE ${brl(R.fipe)}` : ''}. Não aparece nos anúncios.</span></div>
        <div class="f w3"><label for="rp-d">Detalhes (opcional)</label><input id="rp-d" maxlength="300" value="${esc(R.detalhes || '')}" placeholder="Ex.: pequeno amassado na porta traseira, 2 chaves"></div>
        <div class="f" style="align-self:center"><button class="btn" type="button" id="rp-ps">Salvar e atualizar texto</button></div>
      </div>
      <div class="f"><label for="rp-t">Texto para o grupo</label><textarea id="rp-t" rows="9">${esc(R.texto)}</textarea></div>
      <div class="btnrow">
        <button class="btn primary" type="button" id="rp-share">Enviar texto e fotos</button>
        <button class="btn" type="button" id="rp-one">WhatsApp (1 foto)</button>
        <a class="btn" id="rp-wa" href="${esc(waUrl(R.texto))}" target="_blank" rel="noopener">WhatsApp (só texto)</a>
        <button class="btn" type="button" id="rp-cp">Copiar texto</button>
        <a class="btn" href="/api/vehicles/${v.id}/photos.zip">Baixar fotos (.zip)</a>
      </div>
      <p class="note">"Enviar texto e fotos" e "WhatsApp (1 foto)" abrem o compartilhamento do aparelho: escolha o WhatsApp e o grupo (no celular e no Chrome do Windows). Onde o compartilhamento não existir, o texto abre no WhatsApp e a foto da capa fica copiada: cole com Ctrl+V na conversa.</p>
      <h4>Grupos da loja</h4>
      <div class="rglist">${R.grupos.length ? R.grupos.map((g) => { const u = ultimo(g.nome); return `<div class="rgrow"><label class="rgl"><input type="checkbox" data-rg="${esc(g.nome)}"><span><b>${esc(g.nome)}</b> <span class="sub">${esc(R.tipos[g.tipo] || g.tipo)}</span></span></label><span>${u ? `<span class="pill p-ok">enviado ${fmtDate(u.created_at)}</span>` : '<span class="sub">ainda não enviado</span>'}</span>${g.link ? `<a class="btn sm" href="${esc(g.link)}" target="_blank" rel="noopener">Abrir grupo</a>` : '<span></span>'}</div>`; }).join('') : '<div class="rgrow"><span class="sub">Nenhum grupo cadastrado. Cadastre abaixo os grupos de repasse da loja (nome e link de convite).</span></div>'}</div>
      ${R.grupos.length && can('publicar') ? '<div class="btnrow" style="margin-top:8px"><button class="btn" type="button" id="rp-mark">Marcar selecionados como enviados</button></div>' : ''}
      <details ${R.grupos.length ? '' : 'open'} style="margin-top:10px"><summary style="cursor:pointer;font-weight:600">Cadastrar e editar grupos</summary>
        <div id="rp-gl" class="stack" style="gap:6px;margin-top:8px">${[...R.grupos, {}].map((g, i) => groupRow(g, i, R.tipos)).join('')}</div>
        <div class="btnrow" style="margin-top:8px"><button class="btn sm" type="button" id="rp-ga">+ Outro grupo</button><button class="btn sm primary" type="button" id="rp-gs">Salvar grupos</button></div>
      </details>
      ${R.posts.length ? `<h4>Histórico</h4><div class="timeline">${R.posts.slice(0, 20).map((p) => `<div><b>${esc(p.grupo)}</b> <span class="sub">${fmtDate(p.created_at)}${p.user_name ? ' · ' + esc(p.user_name) : ''}</span></div>`).join('')}</div>` : ''}
      <div class="err" id="rp-err" hidden></div>
      <div class="modal-foot"><button class="btn" data-close type="button">Fechar</button></div>`, true);
    const err = (m) => { $('#rp-err').textContent = m; $('#rp-err').hidden = false; };
    $$('[data-rtab]').forEach((b) => { b.onclick = () => { if (b.dataset.rtab !== 'repasse') back(b.dataset.rtab); }; });
    $('#rp-t').oninput = () => { $('#rp-wa').href = waUrl($('#rp-t').value); };
    $('#rp-cp').onclick = (e) => X.copyText($('#rp-t').value, e.target);
    $('#rp-ps').onclick = async () => {
      const body = { detalhes: $('#rp-d').value };
      if (can('precos')) body.preco_repasse = $('#rp-p').value;
      try { await api('PUT', `/api/vehicles/${v.id}/repasse-preco`, body); toast('Salvo. Texto atualizado.'); X.repasseModal(v, back); } catch (e) { err(e.message); }
    };
    const fotoFile = async (u, i) => { const bl = await (await fetch(u)).blob(); return new File([bl], `foto-${i + 1}.jpg`, { type: bl.type || 'image/jpeg' }); };
    // Copia a foto (PNG) para colar com Ctrl+V no WhatsApp Web.
    const copiarFoto = async (u) => {
      try {
        const img = await createImageBitmap(await (await fetch(u)).blob());
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0);
        const png = await new Promise((r) => c.toBlob(r, 'image/png'));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
        return true;
      } catch { return false; }
    };
    const enviar = async (n, btn) => {
      const text = $('#rp-t').value;
      const fotos = R.fotos.slice(0, n);
      try {
        if (navigator.share && fotos.length) {
          btn.disabled = true;
          const files = await Promise.all(fotos.map(fotoFile));
          btn.disabled = false;
          if (navigator.canShare?.({ files, text })) { await navigator.share({ files, text }); return; }
        }
      } catch (e) { btn.disabled = false; if (e.name === 'AbortError') return; }
      const ok = fotos.length ? await copiarFoto(fotos[0]) : false;
      window.open(waUrl(text), '_blank', 'noopener');
      toast(ok ? 'Texto aberto no WhatsApp e foto da capa copiada: escolha o grupo e cole a foto (Ctrl+V).' : 'Texto aberto no WhatsApp: escolha o grupo e anexe as fotos baixadas.', 8000);
    };
    $('#rp-share').onclick = () => enviar(8, $('#rp-share'));
    $('#rp-one').onclick = () => enviar(1, $('#rp-one'));
    if ($('#rp-mark')) $('#rp-mark').onclick = async () => {
      const grupos = $$('[data-rg]').filter((c) => c.checked).map((c) => c.dataset.rg);
      if (!grupos.length) return err('Marque os grupos em que você enviou o carro.');
      try { await api('POST', `/api/vehicles/${v.id}/repasse`, { grupos }); toast('Envio registrado'); X.repasseModal(v, back); } catch (e) { err(e.message); }
    };
    $('#rp-ga').onclick = () => { const n = $$('#rp-gl .grow').length; $('#rp-gl').insertAdjacentHTML('beforeend', groupRow({}, n, R.tipos)); };
    $('#rp-gs').onclick = async () => {
      const grupos = $$('#rp-gl .grow').map((r) => ({ id: r.dataset.id, nome: r.querySelector('[data-gn]').value, tipo: r.querySelector('[data-gt2]').value, link: r.querySelector('[data-gk]').value })).filter((g) => g.nome.trim());
      try { await api('PUT', '/api/store/repasse-grupos', { grupos }); toast('Grupos salvos'); X.repasseModal(v, back); } catch (e) { err(e.message); }
    };
  };
  function groupRow(g, i, tipos) {
    return `<div class="grow fields" data-id="${esc(g.id || '')}">
      <div class="f w3"><label for="gn-${i}">Nome do grupo</label><input id="gn-${i}" data-gn value="${esc(g.nome || '')}" placeholder="Repasse PR Oeste"></div>
      <div class="f"><label for="gt-${i}">App</label><select id="gt-${i}" data-gt2>${opt(Object.entries(tipos), g.tipo || 'whatsapp')}</select></div>
      <div class="f w3"><label for="gk-${i}">Link do grupo (opcional)</label><input id="gk-${i}" data-gk value="${esc(g.link || '')}" placeholder="https://chat.whatsapp.com/…"></div>
    </div>`;
  }

  /* ======================= Tela: Equipe (v2.2) ======================= */
  const PERM_CURTO = { cadastrar: 'Cadastrar', precos: 'Preços', excluir: 'Excluir', publicar: 'Publicar', vender: 'Vender', campanhas: 'Campanhas', financeiro: 'Financeiro', gestao: 'Resultados', parceiros: 'Parceiros', config: 'Config.' };
  X.views.equipe = {
    async html() {
      if (!owner()) return '<div class="err">Só o administrador da loja gerencia a equipe.</div>';
      const team = await api('GET', '/api/team');
      X._team = team;
      const keys = Object.keys(team.perms);
      return `<div class="head"><div><h1>Equipe</h1><p>Cadastre os vendedores e escolha o que cada um pode fazer. Cada um entra com o próprio e-mail e senha.</p></div><button class="btn primary" type="button" id="tuNew">+ Adicionar vendedor</button></div>
        <div class="table-wrap"><table class="tbl team"><thead><tr><th>Pessoa</th><th>Situação</th>${keys.map((k) => `<th class="c" title="${esc(team.perms[k])}">${PERM_CURTO[k] || k}</th>`).join('')}<th></th></tr></thead><tbody>
        ${team.users.map((u) => `<tr><td><b>${esc(u.name)}</b><br><span class="sub">${esc(u.email)}</span></td>
          <td>${u.role === 'admin' ? '<span class="pill p-ok">Administrador</span>' : u.active ? '<span class="pill p-info">Ativo</span>' : '<span class="pill p-bad">Sem acesso</span>'}</td>
          ${keys.map((k) => `<td class="c">${u.permissions.includes(k) ? '<span class="yes" aria-label="sim">✓</span>' : '<span class="no" aria-label="não">·</span>'}</td>`).join('')}
          <td>${u.role === 'admin' ? '' : `<button class="btn sm" type="button" data-tu="${u.id}">Editar</button>`}</td></tr>`).join('')}</tbody></table></div>
        <div class="grid2 eq" style="margin-top:14px">
          <div class="panel"><h2>Como o vendedor entra</h2><ol class="steps-list">
            <li>Clique em <b>+ Adicionar vendedor</b>, informe nome, e-mail e uma senha inicial e marque as permissões.</li>
            <li>Passe para ele o endereço <b>${esc(location.origin)}</b>, o e-mail e a senha.</li>
            <li>Ele entra e troca a senha em <b>Configurações &gt; Minha senha</b>. Só vê e faz o que você liberou.</li>
            <li>Para tirar o acesso, clique em <b>Editar &gt; Desativar acesso</b>: ele sai na hora.</li></ol></div>
          <div class="panel"><h2>O que cada permissão libera</h2><div class="cfields">${keys.map((k) => `<div class="cf"><span class="k"><b>${PERM_CURTO[k] || k}</b></span><span class="v" style="font-weight:400">${esc(team.perms[k])}</span><span></span></div>`).join('')}</div>
            <p class="note">Sem "Financeiro", o vendedor não vê valores de compra, custos e margem.</p></div>
        </div>`;
    },
    bind() {
      if (!X._team) return;
      $('#tuNew') && ($('#tuNew').onclick = () => userModal(null, X._team));
      $$('[data-tu]').forEach((b) => { b.onclick = () => userModal(X._team.users.find((u) => u.id === Number(b.dataset.tu)), X._team); });
    },
  };

  /* ======================= Contatos (v2.4) ======================= */
  const CT = { busca: '', papel: '', filtro: '', sel: new Set(), data: null };
  const MODELOS_MSG = [
    ['feirao', 'Feirão', 'Oi {nome}! Aqui é da {loja}. Neste sábado tem feirão com condições especiais em todo o estoque. Venha conferir ou responda esta mensagem que eu te mando as opções.'],
    ['resgate', 'Resgatar cliente', 'Oi {nome}, tudo bem? Aqui é da {loja}. Faz um tempo que você comprou com a gente. Está pensando em trocar de carro? Temos novidades no estoque e avaliamos o seu na troca.'],
    ['posvenda', 'Pós-venda', 'Oi {nome}! Aqui é da {loja}. Passando para saber como está o carro e se precisa de alguma coisa. Conte com a gente!'],
    ['novidade', 'Novidade no estoque', 'Oi {nome}! Acabou de chegar na {loja} um carro que pode te interessar. Quer que eu te mande as fotos?'],
    ['dica', 'Dica / conteúdo', 'Oi {nome}! Dica da {loja}: antes de pegar a estrada, confira a calibragem dos pneus e o nível do óleo. Precisando, estamos à disposição.'],
    ['consig', 'Atualizar consignatário', 'Oi {nome}, aqui é da {loja}. Passando para te atualizar sobre o seu carro aqui na loja.'],
  ];
  const diasDesde = (d) => (d ? Math.floor((Date.now() - Date.parse(String(d).length <= 10 ? d + 'T12:00:00' : String(d).replace(' ', 'T') + 'Z')) / 864e5) : null);
  function ctFiltrados() {
    const q = CT.busca.toLowerCase().replace(/\D/g, '') ? CT.busca.replace(/\D/g, '') : CT.busca.toLowerCase();
    return (CT.data?.contatos || []).filter((c) => {
      if (CT.papel && !c.papeis.includes(CT.papel)) return false;
      if (q && !(String(c.nome || '').toLowerCase().includes(q) || c.telefone.includes(q))) return false;
      if (CT.filtro === 'compraram6m') return c.ultima_compra && diasDesde(c.ultima_compra) >= 180;
      if (CT.filtro === 'semcontato90') return !c.ultimo_contato || diasDesde(c.ultimo_contato) >= 90;
      if (CT.filtro === 'posvenda') return c.ultima_compra && diasDesde(c.ultima_compra) <= 30;
      if (CT.filtro === 'optout') return c.opt_out;
      return true;
    });
  }
  function ctTabela() {
    const L = ctFiltrados();
    return `<div class="table-wrap"><table class="tbl compact"><thead><tr><th style="width:28px"><input type="checkbox" id="ct-all" aria-label="Selecionar todos" ${L.length && L.every((c) => CT.sel.has(c.id)) ? 'checked' : ''}></th><th>Contato</th><th>Papel</th><th>Carros</th><th>Último contato</th><th></th></tr></thead><tbody>
      ${L.map((c) => `<tr class="${c.opt_out ? 'muted' : ''}"><td><input type="checkbox" data-cs="${c.id}" ${CT.sel.has(c.id) ? 'checked' : ''} ${c.opt_out ? 'disabled title="Pediu para não receber mensagens"' : ''} aria-label="Selecionar ${esc(c.nome || c.telefone)}"></td>
        <td><button class="vlink" type="button" data-ct="${c.id}">${esc(c.nome || 'Sem nome')}</button><br><span class="sub">${esc(c.telefone.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3'))}${c.cidade ? ' · ' + esc(c.cidade) : ''}</span></td>
        <td>${c.papeis_label.map((p) => `<span class="pill p-info">${esc(p)}</span>`).join(' ') || '<span class="sub">—</span>'}${c.opt_out ? ' <span class="pill p-bad">não quer receber</span>' : ''}</td>
        <td>${c.veiculos.map((v) => `<button class="vlink sub" type="button" data-vp="${v.id}">${esc(v.titulo)}</button>`).join('<br>') || '<span class="sub">—</span>'}</td>
        <td>${c.ultimo_contato ? `${fmtDate(c.ultimo_contato)}<br><span class="sub">há ${diasDesde(c.ultimo_contato)} dias</span>` : '<span class="sub">—</span>'}</td>
        <td><a class="btn sm" href="${esc(waLink(c.telefone))}" target="_blank" rel="noopener">WhatsApp</a></td></tr>`).join('') || '<tr><td colspan="6" class="sub">Nenhum contato com esses filtros.</td></tr>'}</tbody></table></div>
      <p class="note">${L.length} contato(s) na lista · ${CT.sel.size} selecionado(s).</p>`;
  }
  async function contatosHtml() {
    const [D, W] = await Promise.all([api('GET', '/api/contacts'), api('GET', '/api/wa/campaigns').catch(() => [])]);
    CT.data = D; CT.campanhas = W;
    const cont = (k) => D.contatos.filter((c) => c.papeis.includes(k)).length;
    return `<div class="toolbar ct-bar">
        <input id="ct-q" type="search" placeholder="Buscar nome ou telefone" value="${esc(CT.busca)}" style="min-width:200px">
        <div class="chips">${[['', `Todos (${D.contatos.length})`], ...Object.entries(D.papeis).filter(([k]) => cont(k)).map(([k, l]) => [k, `${l} (${cont(k)})`])].map(([k, l]) => `<button class="chip" type="button" data-cp="${k}" aria-pressed="${CT.papel === k}">${l}</button>`).join('')}</div>
        <select id="ct-f" aria-label="Filtro"><option value="">Todos</option><option value="posvenda" ${CT.filtro === 'posvenda' ? 'selected' : ''}>Compraram nos últimos 30 dias (pós-venda)</option><option value="compraram6m" ${CT.filtro === 'compraram6m' ? 'selected' : ''}>Compraram há 6+ meses (resgatar)</option><option value="semcontato90" ${CT.filtro === 'semcontato90' ? 'selected' : ''}>Sem contato há 90+ dias</option><option value="optout" ${CT.filtro === 'optout' ? 'selected' : ''}>Não querem receber</option></select>
        <span class="grow1"></span>
        <button class="btn" type="button" id="ct-new">+ Contato</button>
        <button class="btn primary" type="button" id="ct-send">Enviar mensagem (<span id="ct-n">${CT.sel.size}</span>)</button>
      </div>
      <div id="ct-tab">${ctTabela()}</div>
      <div class="panel" style="margin-top:12px"><h2>Mensagens enviadas</h2>
        ${W.length ? `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Mensagem</th><th>Modo</th><th>Data</th><th class="r">Enviadas</th><th></th></tr></thead><tbody>${W.map((w) => `<tr><td><b>${esc(w.nome)}</b><br><span class="sub">${esc(w.mensagem.slice(0, 80))}${w.mensagem.length > 80 ? '…' : ''}</span></td><td>${w.modo === 'api' ? 'Automático (API)' : 'Assistido'}</td><td>${fmtDate(w.created_at)}<br><span class="sub">${esc(w.user_name || '')}</span></td><td class="r">${w.ok}/${w.total}${w.erro ? ` <span class="pill p-bad">${w.erro} falha(s)</span>` : ''}</td><td>${w.modo !== 'api' && w.status !== 'concluida' ? `<button class="btn sm primary" type="button" data-wq="${w.id}">Continuar</button>` : `<button class="btn sm" type="button" data-wq="${w.id}">Ver</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<p class="sub">Selecione contatos acima e clique em Enviar mensagem: feirão, resgate de clientes antigos, pós-venda, novidades e dicas.</p>'}
      </div>`;
  }
  function contatosBind() {
    const refresh = () => { $('#ct-tab').innerHTML = ctTabela(); $('#ct-n').textContent = CT.sel.size; bindTab(); };
    const bindTab = () => {
      $$('[data-cs]').forEach((c) => { c.onchange = () => { if (c.checked) CT.sel.add(Number(c.dataset.cs)); else CT.sel.delete(Number(c.dataset.cs)); $('#ct-n').textContent = CT.sel.size; }; });
      $('#ct-all') && ($('#ct-all').onchange = () => { ctFiltrados().filter((c) => !c.opt_out).forEach((c) => { if ($('#ct-all').checked) CT.sel.add(c.id); else CT.sel.delete(c.id); }); refresh(); });
      $$('[data-ct]').forEach((b) => { b.onclick = () => contactModal(Number(b.dataset.ct)); });
    };
    bindTab();
    $('#ct-q').oninput = () => { CT.busca = $('#ct-q').value; refresh(); };
    $('#ct-f').onchange = () => { CT.filtro = $('#ct-f').value; refresh(); };
    $$('[data-cp]').forEach((b) => { b.onclick = () => { CT.papel = b.dataset.cp; $$('[data-cp]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); refresh(); }; });
    $('#ct-new').onclick = () => contactForm();
    $('#ct-send').onclick = () => (CT.sel.size ? composeModal([...CT.sel]) : toast('Selecione os contatos na lista (caixinha à esquerda).'));
    $$('[data-wq]').forEach((b) => { b.onclick = () => queueModal(Number(b.dataset.wq)); });
  }
  function contactForm(c = {}) {
    const P = CT.data?.papeis || {};
    modal(`<h3>${c.id ? 'Editar contato' : 'Novo contato'}</h3>
      <div class="fields">
        <div class="f w3"><label for="cf-n">Nome</label><input id="cf-n" value="${esc(c.nome || '')}"></div>
        <div class="f"><label for="cf-t">WhatsApp</label><input id="cf-t" inputmode="tel" value="${esc(c.telefone || '')}" placeholder="(44) 99999-0000"></div>
        <div class="f"><label for="cf-c">Cidade</label><input id="cf-c" value="${esc(c.cidade || '')}"></div>
        <div class="f w3"><label for="cf-e">E-mail</label><input id="cf-e" type="email" value="${esc(c.email || '')}"></div>
        <div class="f w3"><label for="cf-o">Observações</label><input id="cf-o" value="${esc(c.obs || '')}" placeholder="Interesse, carro que procura…"></div>
      </div>
      <h4>Papel (pode ter mais de um)</h4>
      <div class="chips">${Object.entries(P).map(([k, l]) => `<label class="chip"><input type="checkbox" data-pp="${k}" ${(c.papeis || []).includes(k) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>
      <label class="check" style="margin-top:10px"><input type="checkbox" id="cf-x" ${c.opt_out ? 'checked' : ''}><div><b>Não quer receber mensagens</b><span>Fica de fora dos envios em massa.</span></div></label>
      <div class="err" id="cf-err" hidden></div>
      <div class="modal-foot"><button class="btn" data-close type="button">Cancelar</button><button class="btn primary" id="cf-ok" type="button">Salvar</button></div>`);
    $('#cf-ok').onclick = async () => {
      const body = { nome: $('#cf-n').value, telefone: $('#cf-t').value, cidade: $('#cf-c').value, email: $('#cf-e').value, obs: $('#cf-o').value, opt_out: $('#cf-x').checked, papeis: $$('[data-pp]').filter((x) => x.checked).map((x) => x.dataset.pp) };
      try { await api(c.id ? 'PUT' : 'POST', c.id ? `/api/contacts/${c.id}` : '/api/contacts', body); closeModal(); toast('Contato salvo'); X.render(); }
      catch (e) { $('#cf-err').textContent = e.message; $('#cf-err').hidden = false; }
    };
  }
  async function contactModal(id) {
    let D; try { D = await api('GET', `/api/contacts/${id}`); } catch (e) { return toast(e.message); }
    const c = D.contato;
    modal(`<h3>${esc(c.nome || 'Sem nome')} <span class="sub">${c.papeis_label.map(esc).join(' · ')}</span></h3>
      <p><b>${esc(c.telefone.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3'))}</b>${c.cidade ? ' · ' + esc(c.cidade) : ''}${c.email ? ' · ' + esc(c.email) : ''}${c.opt_out ? ' <span class="pill p-bad">não quer receber mensagens</span>' : ''}${c.obs ? `<br><span class="sub">${esc(c.obs)}</span>` : ''}</p>
      <div class="btnrow"><a class="btn primary" href="${esc(waLink(c.telefone))}" target="_blank" rel="noopener">Abrir WhatsApp</a><button class="btn" type="button" id="cm-ed">Editar</button><button class="btn" type="button" id="cm-msg">Mensagem pronta</button></div>
      <h4>Registrar contato</h4>
      <div class="fields"><div class="f"><label for="cm-t">Tipo</label><select id="cm-t">${opt(Object.entries(CT.data?.tipos_nota || { nota: 'Anotação' }).filter(([k]) => k !== 'campanha'), 'nota')}</select></div><div class="f w3"><label for="cm-x">O que foi conversado</label><input id="cm-x" placeholder="Ex.: quer um SUV até 90 mil, ligar em março"></div><div class="f" style="align-self:end"><button class="btn" type="button" id="cm-add">Registrar</button></div></div>
      <h4>Histórico</h4>
      <div class="timeline">${D.historico.length ? D.historico.map((e) => `<div>${e.icone} <b>${esc(e.texto)}</b> <span class="sub">${fmtDate(e.data)}${e.user ? ' · ' + esc(e.user) : ''}</span>${e.vehicle_id ? ` <button class="vlink sub" type="button" data-vp="${e.vehicle_id}">ver carro</button>` : ''}</div>`).join('') : '<p class="sub">Sem histórico ainda.</p>'}</div>
      <div class="modal-foot"><button class="btn" data-close type="button">Fechar</button></div>`, true);
    $('#cm-ed').onclick = () => contactForm(c);
    $('#cm-msg').onclick = () => composeModal([c.id]);
    $('#cm-add').onclick = async () => {
      try { await api('POST', `/api/contacts/${c.id}/notes`, { tipo: $('#cm-t').value, texto: $('#cm-x').value }); contactModal(id); } catch (e) { toast(e.message); }
    };
  }
  function composeModal(ids) {
    const cloud = CT.data?.cloud || {};
    const primeiro = (CT.data?.contatos || []).find((c) => c.id === ids[0]);
    modal(`<h3>Mensagem para ${ids.length} contato(s)</h3>
      <div class="chips">${MODELOS_MSG.map(([k, l]) => `<button class="chip" type="button" data-mm="${k}">${l}</button>`).join('')}</div>
      <div class="fields">
        <div class="f w6"><label for="cp-n">Nome do envio</label><input id="cp-n" placeholder="Ex.: Feirão de outubro"></div>
        <div class="f w6"><label for="cp-m">Mensagem</label><textarea id="cp-m" rows="5" placeholder="Use {nome} para o primeiro nome do contato e {loja} para o nome da loja."></textarea><span class="hint">Prévia para ${esc(primeiro?.nome || 'o primeiro contato')}: <i id="cp-pv"></i></span></div>
      </div>
      <h4>Como enviar</h4>
      <label class="check"><input type="radio" name="cp-modo" value="assistido" checked><div><b>Pelo meu WhatsApp (assistido)</b><span>Gratuito. O GiroAuto abre cada conversa com a mensagem pronta e você só aperta Enviar. Seguro para o seu número.</span></div></label>
      <label class="check" style="margin-top:6px"><input type="radio" name="cp-modo" value="api" ${cloud.configurado ? '' : 'disabled'}><div><b>Automático pela API oficial do WhatsApp</b><span>${cloud.configurado ? `Envia sozinho para todos usando o modelo aprovado "${esc(cloud.template)}". A Meta cobra por conversa iniciada.` : 'Não configurado. O administrador ativa em Configurações &gt; WhatsApp automático.'}</span></div></label>
      <p class="note">Mande só para quem é cliente ou já falou com a loja e respeite quem pedir para parar: disparos para desconhecidos podem bloquear o número.</p>
      <div class="err" id="cp-err" hidden></div>
      <div class="modal-foot"><button class="btn" data-close type="button">Cancelar</button><button class="btn primary" id="cp-ok" type="button">Começar envio</button></div>`, true);
    const pv = () => { $('#cp-pv').textContent = $('#cp-m').value.replace(/\{nome\}/gi, (primeiro?.nome || '').split(' ')[0] || 'tudo bem').replace(/\{loja\}/gi, S.me.store.name); };
    $('#cp-m').oninput = pv;
    $$('[data-mm]').forEach((b) => { b.onclick = () => { const m = MODELOS_MSG.find((x) => x[0] === b.dataset.mm); $('#cp-n').value = m[1]; $('#cp-m').value = m[2]; pv(); }; });
    $('#cp-ok').onclick = async () => {
      const modo = $('input[name="cp-modo"]:checked').value;
      try {
        const r = await api('POST', '/api/wa/campaigns', { nome: $('#cp-n').value, mensagem: $('#cp-m').value, modo, contatos: ids });
        CT.sel.clear();
        if (modo === 'api') { closeModal(); toast('Envio automático iniciado. Acompanhe em Mensagens enviadas.', 7000); X.render(); return; }
        queueModal(r.id);
      } catch (e) { $('#cp-err').textContent = e.message; $('#cp-err').hidden = false; }
    };
  }
  // Fila do envio assistido: abre cada conversa com a mensagem pronta.
  async function queueModal(id) {
    let W; try { W = await api('GET', `/api/wa/campaigns/${id}`); } catch (e) { return toast(e.message); }
    const pend = W.envios.filter((e) => e.status === 'pendente');
    const feitos = W.envios.length - pend.length;
    const link = (e) => (isMobile() ? e.link_app : e.link);
    modal(`<h3>${esc(W.nome)}</h3>
      <div class="progress"><i style="width:${Math.round((feitos / Math.max(1, W.envios.length)) * 100)}%"></i></div>
      <p>${feitos} de ${W.envios.length} feitos${W.modo === 'api' ? ` · automático (${W.status === 'concluida' ? 'concluído' : 'enviando…'})` : ''}.</p>
      ${W.modo !== 'api' && pend.length ? `<div class="btnrow"><a class="btn primary big" id="q-next" href="${esc(link(pend[0]))}" target="_blank" rel="noopener">Abrir conversa com ${esc(pend[0].nome || pend[0].telefone)} →</a></div><p class="note">Abre o WhatsApp com a mensagem pronta. Aperte Enviar lá e volte aqui: o próximo já fica pronto.</p>` : ''}
      <div class="rglist" style="max-height:44vh;overflow:auto">${W.envios.map((e) => `<div class="rgrow"><span><b>${esc(e.nome || e.telefone)}</b> <span class="sub">${esc(e.telefone)}</span>${e.erro ? `<br><span class="sub neg">${esc(e.erro)}</span>` : ''}</span><span>${{ enviado: '<span class="pill p-ok">enviado</span>', pulado: '<span class="pill p-muted">pulado</span>', falha: '<span class="pill p-bad">falha</span>', pendente: '<span class="pill p-warn">pendente</span>' }[e.status] || ''}</span><span class="btnrow" style="gap:4px">${W.modo !== 'api' && e.status === 'pendente' ? `<a class="btn sm" href="${esc(link(e))}" target="_blank" rel="noopener" data-qo="${e.id}">Abrir</a><button class="btn sm ghost" type="button" data-qs="${e.id}">Pular</button>` : ''}</span></div>`).join('')}</div>
      <div class="modal-foot"><button class="btn" type="button" id="q-close">Fechar</button></div>`, true);
    const mark = async (sid, status) => { await api('PUT', `/api/wa/campaigns/${id}/sends/${sid}`, { status }); setTimeout(() => queueModal(id), 300); };
    if ($('#q-next')) $('#q-next').addEventListener('click', () => mark(pend[0].id, 'enviado'));
    $$('[data-qo]').forEach((a) => a.addEventListener('click', () => mark(Number(a.dataset.qo), 'enviado')));
    $$('[data-qs]').forEach((b) => { b.onclick = () => mark(Number(b.dataset.qs), 'pulado'); });
    $('#q-close').onclick = () => { closeModal(); if (S.view === 'gestao') X.render(); };
    if (W.modo === 'api' && W.status !== 'concluida') setTimeout(() => { if ($('#q-close')) queueModal(id); }, 2500);
  }

  /* ======================= Painel do administrador (v2.4) ======================= */
  const PN = { periodo: 'mes', timer: null };
  X.views.painel = {
    async html() {
      if (!can('gestao')) return '<div class="err">Seu usuário não tem acesso ao painel.</div>';
      const d = await api('GET', `/api/painel?periodo=${PN.periodo}`);
      X._painel = d;
      const fin = can('financeiro');
      const E = d.estoque; const Vd = d.vendas;
      // Valores grandes abreviados para caber numa linha (R$ 106 mil); o valor exato fica no título (passe o mouse).
      const bk = (x) => (Math.abs(x || 0) >= 100000 ? `<span title="${brl(x)}">R$ ${(Math.round(x / 100) / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil</span>` : brl(x));
      const tile = (k, v, sub = '', go = '', cls = '') => `<button class="pt ${cls}" type="button" ${go ? `data-go2="${go}"` : 'disabled'}><span>${k}</span><b>${v}</b>${sub ? `<em>${sub}</em>` : ''}</button>`;
      const box = (t, go, body, cls = '') => `<section class="pbox ${cls}"><header><h3>${t}</h3>${go ? `<button class="linkbtn" type="button" data-go2="${go}">abrir ›</button>` : ''}</header>${body}</section>`;
      const vrow = (v, right, extra = '') => `<div class="pr"><button class="vlink" type="button" data-vp="${v.id}">${esc(v.titulo)}</button>${extra}<span class="prr">${right}</span></div>`;
      const nome = (k) => new Date(k + '-15').toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
      const maxM = Math.max(1, ...Vd.meses.map((m) => m.qtd));
      const hora = new Date(d.agora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      return `<div class="painel">
        <div class="pn-head">
          <div class="pn-title">${S.me.store.logo_file ? `<img src="/media/${esc(S.me.store.logo_file)}" alt="" class="pn-logo">` : ''}<div><h1>Painel</h1><span class="sub">${esc(d.loja.nome)} · atualizado às ${hora} · atualiza sozinho a cada minuto</span></div></div>
          <div class="chips">${[['hoje', 'Hoje'], ['7', '7 dias'], ['mes', 'Mês'], ['30', '30 dias'], ['anterior', 'Mês passado'], ['ano', 'Ano']].map(([k, l]) => `<button class="chip" type="button" data-pp2="${k}" aria-pressed="${d.periodo.p === k}">${l}</button>`).join('')}<button class="chip" type="button" id="pn-full" title="Tela cheia (para projetar)">⛶ Tela cheia</button></div>
        </div>
        <div class="ptiles">
          ${tile('Vendidos', Vd.qtd, `${fmtDate(d.periodo.from)}–${fmtDate(d.periodo.to)}`, 'resultados')}
          ${fin ? tile('Faturamento', bk(Vd.faturamento), `ticket ${brl(Vd.ticket)}`, 'resultados') : ''}
          ${fin ? tile('Lucro', bk(Vd.lucro), `${pct(Vd.margem)}% de margem`, 'resultados', Vd.lucro < 0 ? 'bad' : 'ok') : ''}
          ${fin ? tile('Resultado', bk(Vd.resultado), 'lucro − despesas', 'resultados', Vd.resultado < 0 ? 'bad' : '') : ''}
          ${tile('Dias p/ vender', Vd.dias, fin ? `desconto médio ${pct(Vd.desconto)}%` : 'média', 'resultados')}
          ${tile('Estoque', E.qtd, fin ? bk(E.valor) : `${E.idade} dias de idade média`, 'estoque')}
          ${fin ? tile('Investido', bk(E.investido), `previsto ${bk(E.lucro_previsto)}`, 'gestao:estoque') : ''}
          ${tile('Parados', E.parados_qtd, `${d.loja.parado_dias}+ dias`, 'parados', E.parados_qtd ? 'warn' : '')}
          ${tile('Docs pendentes', d.docs.pendentes, `${d.docs.atrasados} com 30+ dias`, 'gestao:docs', d.docs.atrasados ? 'bad' : '')}
          ${fin ? tile('Contas 15 dias', bk(d.financeiro.contas_total), `${d.financeiro.contas.length} em aberto`, 'gestao:desp', d.financeiro.contas.some((c) => c.vencida) ? 'bad' : '') : ''}
        </div>
        <div class="pgrid">
          ${box('Onde atuar agora', '', d.alertas.length ? d.alertas.map((a) => `<button class="palert ${a.nivel}" type="button" data-go2="${a.alvo}"><span>${esc(a.texto)}</span><b>${esc(a.acao)} ›</b></button>`).join('') : '<p class="sub">Tudo em dia. 👍</p>', 'span2')}
          ${box('Onde estão os carros', 'gestao:local', `<div class="pchips">${E.locais.map((l) => `<span><b>${l.qtd}</b> ${esc(l.label)}</span>`).join('')}</div>
            <div class="pchips"><span><b>${E.status.publicado || 0}</b> no Marketplace</span><span><b>${E.status.pronto || 0}</b> prontos</span><span><b>${E.status.rascunho || 0}</b> rascunhos</span></div>
            ${E.fora.map((v) => vrow(v, `<span class="${v.atrasado ? 'neg' : ''}">${v.local_dias}d</span>${v.followup_url ? ` <a class="linkbtn" href="${esc(v.followup_url)}" target="_blank" rel="noopener" title="Pedir andamento">💬</a>` : ''}`, ` <span class="sub">${esc(v.parceiro || v.local)}</span>`)).join('') || '<p class="sub">Todos no pátio.</p>'}`)}
          ${box(`Parados (${E.parados_qtd})`, 'parados', E.parados.map((v) => vrow(v, `${v.dias}d · ${brl(v.preco)} <button class="btn sm" type="button" data-of2="${v.id}" title="Oferta sugerida ${brl(v.sugestao)}">Oferta</button>`)).join('') || '<p class="sub">Nenhum carro parado.</p>')}
          ${box('Vendas (6 meses)', 'resultados', `<div class="pbars">${Vd.meses.map((m) => `<div><b>${m.qtd}</b><i style="height:${Math.max(2, Math.round((m.qtd / maxM) * 56))}px"></i><span>${nome(m.mes)}</span></div>`).join('')}</div>
            ${Vd.vendedores.length ? `<div class="pchips">${Vd.vendedores.map((g, i) => `<span>${i === 0 ? '🏆 ' : ''}${esc(g.nome)} <b>${g.qtd}</b></span>`).join('')}</div>` : ''}`)}
          ${box('Últimas vendas', 'resultados', Vd.lista.map((l) => vrow(l, `${fmtDate(l.data)}${fin && l.valor ? ` · ${brl(l.valor)}` : ''}${fin && l.lucro !== null ? ` · <span class="${l.lucro < 0 ? 'neg' : 'pos'}">${brl(l.lucro)}</span>` : ''}`)).join('') || '<p class="sub">Sem vendas no período.</p>')}
          ${box('Documentação', 'gestao:docs', d.docs.lista.map((x) => vrow(x, `<span class="${x.dias > 30 ? 'neg' : ''}">${x.dias}d</span>`, ` <span class="sub">${esc(x.status)}</span>`)).join('') || '<p class="sub">Nenhum documento pendente.</p>')}
          ${box('Republicação e anúncios', 'republicacao', `<div class="pchips"><span><b>${d.publicacao.publicados}</b> publicados</span><span><b>${d.publicacao.prontos_republicar}</b> para republicar</span><span><b>${d.publicacao.fila}</b> na fila</span>${d.publicacao.falhas ? `<span class="neg"><b>${d.publicacao.falhas}</b> com erro</span>` : ''}</div><p class="sub">${d.publicacao.agenda ? `Agenda: ${esc(d.publicacao.agenda)}` : 'Republicação agendada desligada.'}</p>`)}
          ${box('Campanhas pagas', 'campanhas', `<div class="pchips"><span><b>${d.campanhas.ativas}</b> ativas</span>${fin ? `<span><b>${brl(d.campanhas.verba_dia)}</b>/dia</span>` : ''}</div>${d.campanhas.lista.map((c) => `<div class="pr"><span>${esc(c.nome)}</span><span class="prr sub">${esc(c.status)}</span></div>`).join('')}`)}
          ${fin ? box('Contas a pagar (15 dias)', 'gestao:desp', d.financeiro.contas.map((c) => `<div class="pr"><span>${esc(c.descricao)}</span><span class="prr ${c.vencida ? 'neg' : ''}">${fmtDate(c.data)} · ${brl(c.valor)} <button class="btn sm" type="button" data-pay2="${c.id}">Pago</button></span></div>`).join('') + `<p class="sub">Despesas no período: ${brl(d.financeiro.despesas)}${d.financeiro.comissoes ? ` · comissões ${brl(d.financeiro.comissoes)}` : ''}</p>`) : ''}
          ${box(`Pós-venda hoje (${d.posvenda.length})`, 'gestao:contatos', d.posvenda.map((p) => `<div class="pr"><span>${esc(p.comprador || '')} <span class="sub">${esc(p.titulo)} · ${p.dias}d</span></span><span class="prr"><a class="linkbtn" href="${esc(p.wa)}" target="_blank" rel="noopener">💬 enviar</a></span></div>`).join('') || `<p class="sub">Nenhum pós-venda (7, 30 ou 90 dias) para hoje. ${d.contatos} contato(s) na base.</p>`)}
        </div>
      </div>`;
    },
    bind() {
      clearInterval(PN.timer);
      PN.timer = setInterval(() => { if (S.view === 'painel' && !$('#scrim') && !document.hidden) X.render(); else if (S.view !== 'painel') clearInterval(PN.timer); }, 60000);
      $$('[data-pp2]').forEach((b) => { b.onclick = () => { PN.periodo = b.dataset.pp2; X.render(); }; });
      $('#pn-full') && ($('#pn-full').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); });
      $$('[data-go2]').forEach((b) => {
        b.onclick = (e) => {
          if (e.target.closest('a,[data-of2],[data-pay2],[data-vp]') && e.target.closest('a,[data-of2],[data-pay2],[data-vp]') !== b) return;
          const [view, tab] = b.dataset.go2.split(':');
          if (view === 'parados') return stalledModal(S.vehicles.filter((v) => v.parado));
          if (view === 'contas') { gTab = 'desp'; return X.go('gestao'); }
          if (view === 'docs') { gTab = 'docs'; return X.go('gestao'); }
          if (view === 'fora') { gTab = 'local'; return X.go('gestao'); }
          if (view === 'posvenda') { gTab = 'contatos'; CT.filtro = 'posvenda'; return X.go('gestao'); }
          if (tab) gTab = tab;
          X.go(view);
        };
      });
      $$('[data-of2]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); offerModal(S.vehicles.find((v) => v.id === Number(b.dataset.of2))); }; });
      $$('[data-pay2]').forEach((b) => { b.onclick = async (e) => { e.stopPropagation(); await api('PUT', `/api/expenses/${b.dataset.pay2}/pago`, {}); toast('Conta paga'); X.render(); }; });
    },
  };

  /* ---------- Configuração do WhatsApp automático (API oficial) ---------- */
  async function waConfigPanel() {
    if (!can('config') || $('#cfgWa')) return;
    const c = await api('GET', '/api/wa/config').catch(() => null); if (!c || $('#cfgWa')) return;
    $('#cfgV2')?.insertAdjacentHTML('beforeend', `<div class="panel" id="cfgWa"><h2>WhatsApp automático (opcional)</h2>
      <p class="lead">Para mandar mensagens em massa <b>sem clicar uma a uma</b>, use a API oficial do WhatsApp (Meta). Ela é paga por conversa e exige um número só para isso e um modelo de mensagem aprovado. Sem isso, o envio assistido (gratuito) continua funcionando em Gestão &gt; Contatos.</p>
      ${c.configurado ? `<div class="okbox">Ativo: modelo <b>${esc(c.template)}</b> (${esc(c.lang)}), número ${esc(c.phone_id)}.</div>` : ''}
      <ol class="steps-list"><li>No <b>business.facebook.com</b> &gt; WhatsApp Manager, adicione um número e crie um modelo de <b>Marketing</b> com o texto: <code>Olá {{1}}, {{2}}</code> (idioma Português BR). Aguarde a aprovação.</li>
        <li>No app da Meta (developers.facebook.com) &gt; WhatsApp &gt; Configuração da API, copie o <b>ID do número de telefone</b> e gere um <b>token permanente</b> (usuário do sistema).</li><li>Cole abaixo e salve.</li></ol>
      <div class="fields">
        <div class="f w3"><label for="wa-tk">Token de acesso</label><input id="wa-tk" type="password" placeholder="${c.configurado ? '•••••• (deixe em branco para manter)' : 'EAAG…'}" autocomplete="off"></div>
        <div class="f w3"><label for="wa-ph">ID do número de telefone</label><input id="wa-ph" value="${esc(c.phone_id)}" inputmode="numeric"></div>
        <div class="f"><label for="wa-tp">Nome do modelo</label><input id="wa-tp" value="${esc(c.template)}" placeholder="campanha_loja"></div>
        <div class="f"><label for="wa-lg">Idioma</label><input id="wa-lg" value="${esc(c.lang)}"></div>
        <div class="f"><label for="wa-pr">Variáveis no modelo</label><select id="wa-pr">${opt([['2', '2: {{1}} nome, {{2}} mensagem'], ['1', '1: {{1}} mensagem'], ['0', 'Nenhuma (texto fixo)']], String(c.params))}</select></div>
      </div>
      <div class="form-foot">${c.configurado ? '<button class="btn ghost danger" type="button" id="wa-rm">Desativar</button>' : ''}<button class="btn primary" type="button" id="wa-ok">Salvar</button></div></div>`);
    $('#wa-ok').onclick = async () => {
      try { await api('PUT', '/api/wa/config', { token: $('#wa-tk').value, phone_id: $('#wa-ph').value, template: $('#wa-tp').value, lang: $('#wa-lg').value, params: $('#wa-pr').value }); toast('WhatsApp automático salvo'); $('#cfgWa').remove(); waConfigPanel(); }
      catch (e) { toast(e.message, 6000); }
    };
    if ($('#wa-rm')) $('#wa-rm').onclick = async () => { await api('PUT', '/api/wa/config', { remover: true }); $('#cfgWa').remove(); waConfigPanel(); };
  }

  /* ======================= Sugestões e erros (todos) ======================= */
  async function feedbackModal() {
    const F = await api('GET', '/api/feedback').catch(() => ({ itens: [], tipos: {} }));
    const tipos = Object.entries(F.tipos || { erro: 'Erro / problema', melhoria: 'Melhoria', funcionalidade: 'Nova funcionalidade', duvida: 'Dúvida', outro: 'Outro' });
    const telaAtual = ({ painel: 'Painel', estoque: 'Estoque', novo: 'Cadastro do veículo', republicacao: 'Republicação', campanhas: 'Campanhas', gestao: 'Gestão', resultados: 'Resultados', equipe: 'Equipe', config: 'Configurações' })[S.view] || S.view || '';
    modal(`<h3>Sugestões e erros</h3>
      <p class="lead">Conte o que deu errado ou o que poderia ser melhor. Toda mensagem é lida pelo desenvolvedor e a resposta aparece aqui embaixo.</p>
      <div class="chips" role="radiogroup">${tipos.map(([k, l], i) => `<label class="chip"><input type="radio" name="fb-t" value="${k}" ${i === 0 ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>
      <div class="fields">
        <div class="f w6"><label for="fb-ti">Resumo</label><input id="fb-ti" maxlength="140" placeholder="Ex.: a busca pela placa não preencheu o modelo"></div>
        <div class="f w6"><label for="fb-de">Detalhes</label><textarea id="fb-de" rows="4" placeholder="O que você fez, o que esperava e o que aconteceu. Para ideias: como imagina que funcione."></textarea></div>
        <div class="f w3"><label for="fb-te">Onde (tela)</label><input id="fb-te" value="${esc(telaAtual)}"></div>
      </div>
      <div class="err" id="fb-err" hidden></div>
      <div class="modal-foot"><button class="btn" data-close type="button">Fechar</button><button class="btn primary" id="fb-ok" type="button">Enviar</button></div>
      ${F.itens.length ? `<h4>Enviados pela loja</h4><div class="timeline">${F.itens.map((f) => `<div><b>${esc(f.titulo)}</b> <span class="pill ${f.status === 'feito' ? 'p-ok' : f.status === 'descartado' ? 'p-muted' : f.status === 'novo' ? 'p-warn' : 'p-info'}">${esc(f.status_label)}</span> <span class="sub">${esc(f.tipo_label)} · ${fmtDate(f.created_at)}</span>${f.resposta ? `<br><span class="sub">💬 Resposta: ${esc(f.resposta)}</span>` : ''}</div>`).join('')}</div>` : ''}`, true);
    $('#fb-ok').onclick = async () => {
      try {
        await api('POST', '/api/feedback', { tipo: $('input[name="fb-t"]:checked').value, titulo: $('#fb-ti').value, descricao: $('#fb-de').value, tela: $('#fb-te').value, versao: S.me.version, navegador: navigator.userAgent });
        toast('Obrigado! Recebemos seu apontamento.'); feedbackModal();
      } catch (e) { $('#fb-err').textContent = e.message; $('#fb-err').hidden = false; }
    };
  }

  /* ======================= Desenvolvedor (v2.7) ======================= */
  const DV = { tab: 'lojas', st: 'abertos', tp: '' };
  const quando = (d) => { if (!d) return '—'; const dias = Math.floor((Date.now() - Date.parse(String(d).replace(' ', 'T') + (String(d).includes('Z') ? '' : 'Z'))) / 864e5); return dias <= 0 ? 'hoje' : dias === 1 ? 'ontem' : `há ${dias} dias`; };
  X.views.dev = {
    async html() {
      if (!S.me.user.is_admin) return '<div class="err">Acesso só para o desenvolvedor do sistema.</div>';
      const [O, F] = await Promise.all([api('GET', '/api/dev/overview'), api('GET', '/api/dev/feedback')]);
      X._dev = { O, F };
      const k = O.kpis;
      const t = (l, v, sub = '', cls = '') => `<div class="pt ${cls}" style="cursor:default"><span>${l}</span><b>${v}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
      const abertos = ['novo', 'analise', 'planejado', 'andamento'];
      const fb = F.itens.filter((f) => (DV.st === 'abertos' ? abertos.includes(f.status) : DV.st ? f.status === DV.st : true) && (!DV.tp || f.tipo === DV.tp));
      let body = '';
      if (DV.tab === 'lojas') {
        body = `<div class="table-wrap"><table class="tbl compact devt"><thead><tr><th>Loja</th><th>Dono</th><th>Cadastro</th><th>Último acesso</th><th class="r">Usuários</th><th class="r">Estoque</th><th class="r">Publicados</th><th class="r">Vendas 30d</th><th class="r">Fatur. 30d</th><th>Extensão</th><th>Meta</th><th class="r">Contatos</th><th class="r">Apont.</th></tr></thead><tbody>
          ${O.lojas.map((l) => `<tr><td><button class="vlink" type="button" data-dl="${l.id}">${esc(l.name)}</button><br><span class="sub">${esc([l.city, l.state].filter(Boolean).join('/'))}${l.whatsapp ? ` · <a class="link" href="${esc(waLink(l.whatsapp))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</span></td>
            <td>${esc(l.nome_dono || '')}<br><span class="sub">${esc(l.email_dono || '')}</span></td><td>${fmtDate(l.created_at)}</td>
            <td><span class="${l.ultimo_acesso && Date.now() - Date.parse(l.ultimo_acesso.replace(' ', 'T') + 'Z') > 14 * 864e5 ? 'neg' : ''}">${quando(l.ultimo_acesso)}</span></td>
            <td class="r">${l.usuarios}</td><td class="r">${l.estoque}</td><td class="r">${l.publicados}</td><td class="r">${l.vendidos_30}</td><td class="r">${brl(l.faturamento_30)}</td>
            <td>${l.extensao_vista ? quando(l.extensao_vista) : '<span class="sub">não pareada</span>'}</td><td>${l.meta_ok ? '<span class="pill p-ok">ok</span>' : '<span class="sub">—</span>'}</td>
            <td class="r">${l.contatos}</td><td class="r">${l.feedbacks}</td></tr>`).join('') || '<tr><td colspan="13" class="sub">Nenhuma loja.</td></tr>'}</tbody></table></div>`;
      }
      if (DV.tab === 'feedback') {
        body = `<div class="toolbar" style="gap:8px;flex-wrap:wrap;margin-bottom:8px">
            <div class="chips">${[['abertos', 'Abertos'], ['novo', 'Novos'], ['feito', 'Feitos'], ['descartado', 'Descartados'], ['', 'Todos']].map(([s2, l]) => `<button class="chip" type="button" data-dst="${s2}" aria-pressed="${DV.st === s2}">${l}</button>`).join('')}</div>
            <select id="dv-tp" style="width:auto"><option value="">Todos os tipos</option>${Object.entries(F.tipos).map(([k2, l]) => `<option value="${k2}" ${DV.tp === k2 ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
          <div class="fblist">${fb.map((f) => `<div class="fbitem ${f.tipo === 'erro' ? 'erro' : ''}">
              <div class="fbh"><b>${esc(f.titulo)}</b><span class="pill ${f.tipo === 'erro' ? 'p-bad' : f.tipo === 'funcionalidade' ? 'p-info' : 'p-muted'}">${esc(f.tipo_label)}</span><span class="sub">${esc(f.loja || '—')} · ${esc(f.usuario || '')} ${f.email ? `(${esc(f.email)})` : ''} · ${fmtDate(f.created_at)}${f.tela ? ` · tela: ${esc(f.tela)}` : ''}${f.versao ? ` · v${esc(f.versao)}` : ''}</span></div>
              ${f.descricao ? `<p class="fbd">${esc(f.descricao)}</p>` : ''}
              <div class="fields fbf"><div class="f"><label>Situação</label><select data-fs="${f.id}">${opt(Object.entries(F.status), f.status)}</select></div><div class="f"><label>Prioridade</label><select data-fp="${f.id}">${opt(Object.entries(F.prioridades), f.prioridade || '')}</select></div>
                <div class="f w3"><label>Resposta para a loja</label><input data-fr="${f.id}" value="${esc(f.resposta || '')}" placeholder="Aparece para a loja em Sugestões e erros"></div>
                <div class="f" style="align-self:end"><button class="btn sm primary" type="button" data-fsave="${f.id}">Salvar</button></div></div></div>`).join('') || '<p class="sub">Nenhum apontamento com esses filtros.</p>'}</div>`;
      }
      if (DV.tab === 'atividade') {
        const max = Math.max(1, ...O.meses.map((m) => Math.max(m.lojas, m.vendas)));
        const nm = (x) => new Date(x + '-15').toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
        body = `<div class="grid2 eq"><div class="panel"><h2>Últimos 6 meses</h2><div class="table-wrap"><table class="tbl compact"><thead><tr><th>Mês</th><th class="r">Novas lojas</th><th class="r">Veículos cadastrados</th><th class="r">Vendas</th></tr></thead><tbody>${O.meses.map((m) => `<tr><td>${nm(m.mes)}</td><td class="r">${m.lojas}</td><td class="r">${m.veiculos}</td><td class="r">${m.vendas}</td></tr>`).join('')}</tbody></table></div><span class="sub" hidden>${max}</span></div>
          <div class="panel"><h2>Atividade recente (todas as lojas)</h2><div class="timeline" style="max-height:420px">${O.eventos.map((e) => `<div><b>${esc(e.loja)}</b>: ${esc(e.message)} <span class="sub">${fmtDate(e.created_at)} · ${quando(e.created_at)}</span></div>`).join('') || '<p class="sub">Sem eventos.</p>'}</div></div></div>`;
      }
      return `<div class="head"><div><h1>Desenvolvedor</h1><p>Visão geral do GiroAuto v${esc(O.versao)}: lojas, uso e apontamentos dos usuários. Só você vê esta tela.</p></div></div>
        <div class="ptiles">
          ${t('Lojas', k.lojas, `${k.novas_30} novas em 30 dias`)}${t('Ativas 7 dias', k.ativas_7, `${k.ativas_30} em 30 dias`, k.ativas_7 ? 'ok' : '')}${t('Usuários', k.usuarios, `${k.usuarios_7} acessaram em 7 dias`)}
          ${t('Veículos', k.veiculos, `${k.estoque} em estoque · ${k.publicados} publicados`)}${t('Vendas 30 dias', k.vendidos_30, brl(k.faturamento_30))}
          ${t('Publicações 30d', k.publicacoes_30, `${k.falhas_30} falhas`, k.falhas_30 > k.publicacoes_30 ? 'warn' : '')}${t('Extensões ativas', k.extensoes_ativas, `${k.meta_conectadas} com Meta`)}
          ${t('Contatos', k.contatos, `${k.mensagens} mensagens enviadas`)}${t('Apontamentos', k.feedback_abertos, `${k.feedback_novos} novos`, k.feedback_novos ? 'warn' : '')}
        </div>
        <div class="chips tabs" style="margin:10px 0">${[['lojas', `Lojas (${k.lojas})`], ['feedback', `Sugestões e erros (${k.feedback_abertos})`], ['atividade', 'Atividade']].map(([k2, l]) => `<button class="chip" type="button" data-dt="${k2}" aria-pressed="${DV.tab === k2}">${l}</button>`).join('')}</div>
        ${body}`;
    },
    bind() {
      $$('[data-dt]').forEach((b) => { b.onclick = () => { DV.tab = b.dataset.dt; X.render(); }; });
      $$('[data-dst]').forEach((b) => { b.onclick = () => { DV.st = b.dataset.dst; X.render(); }; });
      $('#dv-tp') && ($('#dv-tp').onchange = () => { DV.tp = $('#dv-tp').value; X.render(); });
      $$('[data-fsave]').forEach((b) => {
        b.onclick = async () => {
          const id = b.dataset.fsave;
          try { await api('PUT', `/api/dev/feedback/${id}`, { status: $(`[data-fs="${id}"]`).value, prioridade: $(`[data-fp="${id}"]`).value, resposta: $(`[data-fr="${id}"]`).value }); toast('Apontamento atualizado'); X.render(); }
          catch (e) { toast(e.message); }
        };
      });
      $$('[data-dl]').forEach((b) => { b.onclick = () => devStoreModal(Number(b.dataset.dl)); });
    },
  };
  async function devStoreModal(id) {
    let D; try { D = await api('GET', `/api/dev/stores/${id}`); } catch (e) { return toast(e.message); }
    const st = Object.fromEntries(D.status.map((x) => [x.status, x.n]));
    modal(`<h3>${esc(D.loja.name)} <span class="sub">${esc([D.loja.city, D.loja.state].filter(Boolean).join('/'))}</span></h3>
      <p class="sub">Cadastrada em ${fmtDate(D.loja.created_at)} · publicação: ${esc(D.loja.pub_mode || '—')} · <a class="link" href="/v/${esc(D.loja.slug)}" target="_blank" rel="noopener">vitrine</a></p>
      <div class="pchips"><span><b>${st.rascunho || 0}</b> rascunhos</span><span><b>${st.pronto || 0}</b> prontos</span><span><b>${st.publicado || 0}</b> publicados</span><span><b>${st.vendido || 0}</b> vendidos</span></div>
      <h4>Usuários</h4><div class="rglist">${D.usuarios.map((u) => `<div class="rgrow"><span><b>${esc(u.name)}</b> <span class="sub">${esc(u.email)} · ${u.role === 'admin' ? 'administrador' : 'vendedor'}${u.active ? '' : ' · desativado'}</span></span><span class="sub">último acesso: ${quando(u.last_seen)}</span><span></span></div>`).join('')}</div>
      <h4>Extensão</h4><p class="sub">${D.extensao.length ? D.extensao.map((x) => `${esc(x.label)} · vista ${quando(x.last_seen)}`).join(' · ') : 'Não pareada.'}</p>
      ${D.feedback.length ? `<h4>Apontamentos</h4><div class="timeline">${D.feedback.map((f) => `<div><b>${esc(f.titulo)}</b> <span class="sub">${esc(f.tipo_label)} · ${esc(f.status_label)} · ${fmtDate(f.created_at)}</span></div>`).join('')}</div>` : ''}
      <h4>Atividade recente</h4><div class="timeline">${D.eventos.map((e) => `<div>${esc(e.message)} <span class="sub">${fmtDate(e.created_at)}</span></div>`).join('') || '<p class="sub">Sem eventos.</p>'}</div>
      <div class="modal-foot"><button class="btn primary" data-close type="button">Fechar</button></div>`, true);
  }

  /* ======================= Navegação e app instalável ======================= */
  function navSetup() {
    const nav = $('.nav'); if (!nav || $('[data-view="gestao"]')) return;
    const cfg = nav.querySelector('[data-view="config"]');
    if (S.me.store.logo_file && !$('#storeLogo')) $('.side-foot .store')?.insertAdjacentHTML('beforebegin', `<img id="storeLogo" class="store-logo" src="/media/${esc(S.me.store.logo_file)}" alt="${esc(S.me.store.name)}">`);
    if (can('gestao')) nav.querySelector('[data-view="estoque"]')?.insertAdjacentHTML('beforebegin', '<button data-view="painel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>Painel</button>');
    cfg.insertAdjacentHTML('beforebegin', `
      <button data-view="gestao"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v16"/></svg>Gestão</button>
      ${can('gestao') ? '<button data-view="resultados"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>Resultados</button>' : ''}
      ${owner() ? '<button data-view="equipe"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2A5 5 0 0 1 21 19"/></svg>Equipe</button>' : ''}`);
    if (S.me.user.is_admin) cfg.insertAdjacentHTML('afterend', '<button data-view="dev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/></svg>Desenvolvedor</button>');
    if (!$('#fbLink')) $('.side-foot .store')?.insertAdjacentHTML('beforebegin', '<button class="btn ghost sm" id="fbLink" type="button" title="Informar erros e sugerir melhorias">💬 Sugestões e erros</button>');
    if ($('#fbLink')) $('#fbLink').onclick = () => feedbackModal();
    $$('.nav [data-view="gestao"], .nav [data-view="resultados"], .nav [data-view="equipe"], .nav [data-view="painel"], .nav [data-view="dev"]').forEach((b) => b.addEventListener('click', () => { if (location.hash === '#' + b.dataset.view) X.route(); else location.hash = b.dataset.view; }));
    // Esconde o que o vendedor não pode usar
    if (!can('campanhas')) nav.querySelector('[data-view="campanhas"]')?.setAttribute('hidden', '');
    if (!can('cadastrar')) nav.querySelector('[data-view="novo"]')?.setAttribute('hidden', '');
  }

  X.after = (view) => {
    navSetup();
    const atual = view === 'novo' || view === 'importar' || view === 'rapido' ? 'estoque' : view;
    $$('.nav button').forEach((b) => { if (b.dataset.view === atual) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    if (view === 'novo') enhanceForm();
    if (view === 'estoque') enhanceStock();
    if (view === 'config') enhanceConfig();
  };

  // App instalável (PWA)
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); X.installEvt = e; });
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
})();
