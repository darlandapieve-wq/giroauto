/* GiroAuto Repasse — ícone de atendimento da vitrine (assistente). Configurado por window.GR_CHAT. */
(function () {
  'use strict'
  var C = window.GR_CHAT; if (!C) return
  var root = document.getElementById('grChat'); if (!root) return
  var KEY = 'gr_chat_' + C.api
  var sid = ''; try { sid = localStorage.getItem(KEY) || '' } catch (e) { sid = '' }
  var iniciado = false; var ocupado = false
  var brl = function (n) { return n == null ? '' : 'R$ ' + Math.round(n).toLocaleString('pt-BR') }
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] }) }

  var css = document.createElement('style')
  css.textContent = [
    '#grChat{--a:#0f7a4a;--fundo:var(--card,#fff);--tx:var(--tx,#1c1f1d);--mut:var(--mut,#6a716c);--borda:var(--borda,#dfe2dd);--suave:var(--bg,#f3f4f1);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}',
    '#grChat .bt{position:fixed;right:16px;bottom:16px;z-index:30;background:var(--a);color:#fff;border:0;border-radius:999px;padding:12px 18px 12px 14px;font:600 15px system-ui,sans-serif;box-shadow:0 6px 22px rgba(0,0,0,.25);cursor:pointer;display:flex;gap:8px;align-items:center}',
    '#grChat .bt svg{width:22px;height:22px;flex:none}',
    '#grChat .pn{position:fixed;right:16px;bottom:16px;z-index:31;width:min(380px,calc(100vw - 24px));height:min(600px,calc(100vh - 24px));background:var(--fundo);color:var(--tx);border:1px solid var(--borda);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.28);display:flex;flex-direction:column;overflow:hidden}',
    '@media (max-width:520px){#grChat .pn{right:0;bottom:0;width:100vw;height:100dvh;border-radius:0}#grChat .bt span{display:none}#grChat .bt{padding:14px}}',
    '#grChat .cab{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--a);color:#fff}',
    '#grChat .cab b{font-size:15px}#grChat .cab span{font-size:12px;opacity:.85;display:block}',
    '#grChat .x{background:transparent;border:0;font-size:24px;cursor:pointer;color:#fff;line-height:1}',
    '#grChat .ls{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:var(--suave)}',
    '#grChat .m{max-width:86%;padding:8px 11px;border-radius:12px;white-space:pre-wrap;word-wrap:break-word}',
    '#grChat .m.u{align-self:flex-end;background:var(--a);color:#fff;border-bottom-right-radius:4px}',
    '#grChat .m.b{align-self:flex-start;background:var(--fundo);border:1px solid var(--borda);border-bottom-left-radius:4px}',
    '#grChat .v{align-self:stretch;background:var(--fundo);border:1px solid var(--borda);border-radius:10px;overflow:hidden}',
    '#grChat .v .f{display:flex;gap:4px;overflow-x:auto;scroll-snap-type:x mandatory}',
    '#grChat .v .f img{height:130px;flex:none;scroll-snap-align:start;object-fit:cover;aspect-ratio:4/3;cursor:zoom-in;background:#111}',
    '#grChat .v .i{padding:8px 10px;display:flex;justify-content:space-between;gap:8px;align-items:center}',
    '#grChat .v a{color:inherit;font-weight:600;text-decoration:none;font-size:13px;border:1px solid var(--borda);border-radius:8px;padding:5px 9px;white-space:nowrap}',
    '#grChat .w{align-self:flex-start;background:#25d366;color:#fff;text-decoration:none;font-weight:600;border-radius:10px;padding:9px 13px}',
    '#grChat .dg{align-self:flex-start;color:var(--mut);font-size:13px}',
    '#grChat .rap{display:flex;gap:6px;flex-wrap:wrap;padding:0 12px 8px;background:var(--suave)}',
    '#grChat .rap button{background:var(--fundo);border:1px solid var(--borda);color:var(--tx);border-radius:999px;padding:5px 10px;font:inherit;font-size:13px;cursor:pointer}',
    '#grChat form{display:flex;flex-direction:row;gap:6px;padding:10px;border-top:1px solid var(--borda);background:var(--fundo)}',
    '#grChat input{flex:1;min-width:0;border:1px solid var(--borda);border-radius:999px;padding:10px 14px;font:inherit;font-size:16px;background:var(--suave);color:var(--tx)}',
    '#grChat form button{background:var(--a);border:0;border-radius:999px;padding:0 16px;font-weight:700;cursor:pointer;color:#fff}',
    '#grChat .rod{font-size:11px;color:var(--mut);text-align:center;padding:0 10px 8px;background:var(--fundo)}',
    '#grChat .z{position:fixed;inset:0;z-index:40;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;cursor:zoom-out}#grChat .z img{max-width:96vw;max-height:92vh}'
  ].join('')
  document.head.appendChild(css)

  var ICONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/></svg>'
  function botao () {
    root.innerHTML = '<button class="bt" type="button" aria-label="Abrir atendimento">' + ICONE + '<span>' + (C.codigo ? 'Dúvidas sobre este veículo?' : 'Atendimento') + '</span></button>'
    root.querySelector('.bt').onclick = abrir
  }
  function painel () {
    root.innerHTML = '<div class="pn" role="dialog" aria-label="Atendimento"><div class="cab"><div><b>' + esc(C.nome) + '</b><span>' + esc(C.negocio) + ' · responde na hora</span></div><button class="x" type="button" aria-label="Fechar">×</button></div>' +
      '<div class="ls" aria-live="polite"></div><div class="rap"></div><form><input placeholder="Escreva sua mensagem…" maxlength="1000" aria-label="Mensagem"><button type="submit">Enviar</button></form>' +
      '<div class="rod">Assistente virtual · o responsável continua o atendimento no WhatsApp</div></div>'
    root.querySelector('.x').onclick = fechar
    var f = root.querySelector('form')
    f.onsubmit = function (e) { e.preventDefault(); var i = f.querySelector('input'); var t = i.value.trim(); if (!t || ocupado) return; i.value = ''; mandar(t) }
    var rap = C.codigo ? ['Mais fotos', 'Mais informações', 'Quero fechar'] : ['Ver opções até R$ 50 mil', 'Tem picape?', 'Falar com o responsável']
    root.querySelector('.rap').innerHTML = rap.map(function (t) { return '<button type="button">' + esc(t) + '</button>' }).join('')
    root.querySelectorAll('.rap button').forEach(function (b) { b.onclick = function () { if (!ocupado) mandar(b.textContent) } })
  }
  function lista () { return root.querySelector('.ls') }
  function rolar () { var l = lista(); if (l) l.scrollTop = l.scrollHeight }
  function add (m) {
    var l = lista(); if (!l) return
    var d = document.createElement('div'); d.className = 'm ' + (m.papel === 'user' ? 'u' : 'b'); d.textContent = m.texto; l.appendChild(d)
    ;(m.veiculos || []).forEach(function (v) {
      var c = document.createElement('div'); c.className = 'v'
      c.innerHTML = (v.fotos && v.fotos.length ? '<div class="f">' + v.fotos.map(function (u) { return '<img src="' + esc(u) + '" alt="" loading="lazy">' }).join('') + '</div>' : '') +
        '<div class="i"><span><b>' + esc(v.titulo) + '</b><br><small>' + esc(v.codigo) + ' · ' + esc(v.ano) + (v.km ? ' · ' + esc(v.km) : '') + ' · ' + brl(v.preco) + '</small></span><a href="' + esc(v.url) + '">Ver</a></div>'
      c.querySelectorAll('img').forEach(function (im) { im.onclick = function () { zoom(im.src) } })
      l.appendChild(c)
    })
    rolar()
  }
  function zoom (src) { var z = document.createElement('div'); z.className = 'z'; z.innerHTML = '<img src="' + esc(src) + '" alt="">'; z.onclick = function () { z.remove() }; root.appendChild(z) }
  function digitando (on) {
    var l = lista(); if (!l) return; var t = l.querySelector('.dg')
    if (on && !t) { t = document.createElement('div'); t.className = 'dg'; t.textContent = C.nome + ' está digitando…'; l.appendChild(t); rolar() }
    if (!on && t) t.remove()
  }
  function post (body) {
    return fetch(C.api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.erro || 'Não foi possível enviar.'); return j }) })
  }
  function guardar (j) { if (j.sid) { sid = j.sid; try { localStorage.setItem(KEY, sid) } catch (e) { /* sem armazenamento */ } } }
  function mandar (t) {
    add({ papel: 'user', texto: t })
    var r = root.querySelector('.rap'); if (r) r.remove()
    ocupado = true; digitando(true)
    post({ sid: sid, texto: t, codigo: C.codigo }).then(function (j) {
      guardar(j); digitando(false)
      ;(j.mensagens || []).forEach(add)
      if (j.whatsapp) { var a = document.createElement('a'); a.className = 'w'; a.href = j.whatsapp; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Falar com o responsável no WhatsApp'; lista().appendChild(a); rolar() }
    }).catch(function (e) { digitando(false); add({ papel: 'bot', texto: e.message }) })
      .then(function () { ocupado = false; var i = root.querySelector('input'); if (i) i.focus() })
  }
  function abrir () {
    painel()
    digitando(true)
    post({ sid: sid, codigo: C.codigo }).then(function (j) {
      guardar(j); digitando(false); (j.mensagens || []).forEach(add)
      if ((j.mensagens || []).some(function (m) { return m.papel === 'user' })) { var r = root.querySelector('.rap'); if (r) r.remove() }
    }).catch(function () { digitando(false); add({ papel: 'bot', texto: 'Olá! Como posso ajudar?' }) })
    iniciado = true
    var i = root.querySelector('input'); if (i && window.innerWidth > 520) i.focus()
  }
  function fechar () { botao() }
  botao()
})()
