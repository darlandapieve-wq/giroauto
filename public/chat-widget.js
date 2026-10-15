/* GiroAuto — assistente de vendas no site da loja (v2.10). Configurado por window.GA_CHAT. */
(function () {
  'use strict';
  var C = window.GA_CHAT; if (!C) return;
  var root = document.getElementById('gaChat'); if (!root) return;
  var KEY = 'ga_chat_' + C.api;
  var sid = ''; try { sid = localStorage.getItem(KEY) || ''; } catch (e) { sid = ''; }
  var aberto = false; var iniciado = false; var ocupado = false;
  var brl = function (n) { return 'R$ ' + Number(n || 0).toLocaleString('pt-BR'); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  var css = document.createElement('style');
  css.textContent = [
    '#gaChat{--ga-acc:var(--accent,#efa91c);--ga-bg:var(--surface,#fff);--ga-ink:var(--ink,#161a21);--ga-mut:var(--muted,#5b6370);--ga-line:var(--line,#d9dde4);--ga-soft:var(--bg,#eff1f4);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}',
    '#gaChat .gab{position:fixed;right:16px;bottom:16px;z-index:9998;background:var(--ga-acc);color:#1b1400;border:0;border-radius:999px;padding:12px 18px;font:600 15px system-ui,sans-serif;box-shadow:0 6px 22px rgba(0,0,0,.22);cursor:pointer;display:flex;gap:8px;align-items:center}',
    '#gaChat .gap{position:fixed;right:16px;bottom:16px;z-index:9999;width:min(380px,calc(100vw - 32px));height:min(600px,calc(100vh - 32px));background:var(--ga-bg);color:var(--ga-ink);border:1px solid var(--ga-line);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.25);display:flex;flex-direction:column;overflow:hidden}',
    '#gaChat .gah{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--ga-acc);color:#1b1400}',
    '#gaChat .gah b{font-size:15px}#gaChat .gah span{font-size:12px;opacity:.8;display:block}',
    '#gaChat .gax{background:transparent;border:0;font-size:22px;cursor:pointer;color:#1b1400;line-height:1}',
    '#gaChat .gal{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:var(--ga-soft)}',
    '#gaChat .gm{max-width:86%;padding:8px 11px;border-radius:12px;white-space:pre-wrap;word-wrap:break-word}',
    '#gaChat .gm.u{align-self:flex-end;background:var(--ga-acc);color:#1b1400;border-bottom-right-radius:4px}',
    '#gaChat .gm.b{align-self:flex-start;background:var(--ga-bg);border:1px solid var(--ga-line);border-bottom-left-radius:4px}',
    '#gaChat .gv{align-self:stretch;background:var(--ga-bg);border:1px solid var(--ga-line);border-radius:10px;overflow:hidden}',
    '#gaChat .gv .gf{display:flex;gap:4px;overflow-x:auto;scroll-snap-type:x mandatory}',
    '#gaChat .gv .gf img{height:130px;flex:none;scroll-snap-align:start;object-fit:cover;aspect-ratio:4/3;cursor:zoom-in}',
    '#gaChat .gv .gi{padding:8px 10px;display:flex;justify-content:space-between;gap:8px;align-items:center}',
    '#gaChat .gv a{color:inherit;font-weight:600;text-decoration:none;font-size:13px;border:1px solid var(--ga-line);border-radius:8px;padding:5px 9px;white-space:nowrap}',
    '#gaChat .gw{align-self:flex-start;background:#25d366;color:#fff;text-decoration:none;font-weight:600;border-radius:10px;padding:9px 13px}',
    '#gaChat .gt{align-self:flex-start;color:var(--ga-mut);font-size:13px}',
    '#gaChat form{display:flex;gap:6px;padding:10px;border-top:1px solid var(--ga-line);background:var(--ga-bg)}',
    '#gaChat input{flex:1;min-width:0;border:1px solid var(--ga-line);border-radius:999px;padding:10px 14px;font:inherit;background:var(--ga-soft);color:var(--ga-ink)}',
    '#gaChat form button{background:var(--ga-acc);border:0;border-radius:999px;padding:0 16px;font-weight:700;cursor:pointer;color:#1b1400}',
    '#gaChat .gs{font-size:11px;color:var(--ga-mut);text-align:center;padding:0 10px 8px;background:var(--ga-bg)}',
    '#gaChat .gz{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;cursor:zoom-out}#gaChat .gz img{max-width:96vw;max-height:92vh}',
  ].join('');
  document.head.appendChild(css);

  function botao() {
    root.innerHTML = '<button class="gab" type="button" aria-label="Abrir conversa">💬 ' + (C.v ? 'Dúvidas sobre este carro?' : 'Fale com a gente') + '</button>';
    root.querySelector('.gab').onclick = abrir;
  }
  function painel() {
    root.innerHTML = '<div class="gap" role="dialog" aria-label="Conversa com ' + esc(C.nome) + '"><div class="gah"><div><b>' + esc(C.nome) + '</b><span>' + esc(C.loja) + ' · responde na hora</span></div><button class="gax" type="button" aria-label="Fechar">×</button></div>'
      + '<div class="gal" aria-live="polite"></div><form><input placeholder="Escreva sua mensagem…" maxlength="1000" aria-label="Mensagem"><button type="submit">Enviar</button></form>'
      + '<div class="gs">Assistente virtual · um consultor da loja continua o atendimento</div></div>';
    root.querySelector('.gax').onclick = fechar;
    var f = root.querySelector('form');
    f.onsubmit = function (e) { e.preventDefault(); var i = f.querySelector('input'); var t = i.value.trim(); if (!t || ocupado) return; i.value = ''; add({ papel: 'user', texto: t }); enviar(t); };
  }
  function lista() { return root.querySelector('.gal'); }
  function rolar() { var l = lista(); if (l) l.scrollTop = l.scrollHeight; }
  function add(m) {
    var l = lista(); if (!l) return;
    var d = document.createElement('div'); d.className = 'gm ' + (m.papel === 'user' ? 'u' : 'b'); d.textContent = m.texto; l.appendChild(d);
    (m.veiculos || []).forEach(function (v) {
      var c = document.createElement('div'); c.className = 'gv';
      c.innerHTML = (v.fotos && v.fotos.length ? '<div class="gf">' + v.fotos.map(function (u) { return '<img src="' + esc(u) + '" alt="" loading="lazy">'; }).join('') + '</div>' : '')
        + '<div class="gi"><span><b>' + esc(v.titulo) + '</b><br><small>' + esc(v.ano) + ' · ' + Number(v.km || 0).toLocaleString('pt-BR') + ' km · ' + (v.preco ? brl(v.preco) : '') + (v.oferta ? ' (oferta)' : '') + '</small></span><a href="' + esc(v.url) + '">Ver carro</a></div>';
      c.querySelectorAll('img').forEach(function (im) { im.onclick = function () { zoom(im.src); }; });
      l.appendChild(c);
    });
    rolar();
  }
  function zoom(src) {
    var z = document.createElement('div'); z.className = 'gz'; z.innerHTML = '<img src="' + esc(src) + '" alt="">'; z.onclick = function () { z.remove(); }; root.appendChild(z);
  }
  function digitando(on) {
    var l = lista(); if (!l) return; var t = l.querySelector('.gt');
    if (on && !t) { t = document.createElement('div'); t.className = 'gt'; t.textContent = C.nome + ' está digitando…'; l.appendChild(t); rolar(); }
    if (!on && t) t.remove();
  }
  function post(body) {
    return fetch(C.api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Não foi possível enviar.'); return j; }); });
  }
  function guardar(j) { if (j.sid) { sid = j.sid; try { localStorage.setItem(KEY, sid); } catch (e) { /* sem armazenamento */ } } }
  function enviar(t) {
    ocupado = true; digitando(true);
    post({ sid: sid, texto: t, vehicle_id: C.v }).then(function (j) {
      guardar(j); digitando(false);
      (j.mensagens || []).forEach(add);
      if (j.whatsapp) { var a = document.createElement('a'); a.className = 'gw'; a.href = j.whatsapp; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Falar com um consultor no WhatsApp'; lista().appendChild(a); rolar(); }
    }).catch(function (e) { digitando(false); add({ papel: 'bot', texto: e.message }); })
      .then(function () { ocupado = false; var i = root.querySelector('input'); if (i) i.focus(); });
  }
  function abrir() {
    aberto = true; painel();
    if (!iniciado) {
      iniciado = true; digitando(true);
      post({ sid: sid, vehicle_id: C.v }).then(function (j) { guardar(j); digitando(false); (j.mensagens || []).forEach(add); })
        .catch(function () { digitando(false); add({ papel: 'bot', texto: 'Olá! Como posso ajudar?' }); });
    } else {
      post({ sid: sid, vehicle_id: C.v }).then(function (j) { (j.mensagens || []).forEach(add); }).catch(function () {});
    }
    var i = root.querySelector('input'); if (i) i.focus();
  }
  function fechar() { aberto = false; botao(); }
  botao();
})();
