// Páginas públicas renderizadas no servidor: vitrine da loja e página do veículo.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (n) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR');
const km = (n) => Number(n || 0).toLocaleString('pt-BR') + ' km';

function shell(title, body, og = {}) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${og.image ? `<meta property="og:image" content="${esc(og.image)}">` : ''}
<meta property="og:title" content="${esc(og.title || title)}">
${og.description ? `<meta property="og:description" content="${esc(og.description)}">` : ''}
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700&family=IBM+Plex+Sans:wght@400;600&display=swap">
<style>
:root{--bg:#eff1f4;--surface:#fff;--ink:#161a21;--muted:#5b6370;--line:#d9dde4;--accent:#efa91c}
@media (prefers-color-scheme:dark){:root{--bg:#111318;--surface:#1a1d24;--ink:#e8eaee;--muted:#9aa2ae;--line:#2b3039;--accent:#f2b42f;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 "IBM Plex Sans",system-ui,sans-serif}
.wrap{max-width:1080px;margin:0 auto;padding:24px 16px 60px}
h1,h2{font-family:"Barlow Condensed","Arial Narrow",sans-serif;margin:0;line-height:1.1}
h1{font-size:34px}a{color:inherit}
.muted{color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px;margin-top:20px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:10px;overflow:hidden;text-decoration:none;display:flex;flex-direction:column}
.card img,.gal img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block;background:var(--line)}
.card div{padding:12px 14px}
.price{font-family:"Barlow Condensed",sans-serif;font-size:26px;font-weight:700}
.vp{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:24px;margin-top:20px}
.gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}
.gal img:first-child{grid-column:1/-1}
.box{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:18px;display:flex;flex-direction:column;gap:12px;align-self:start}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0}dt{color:var(--muted)}dd{margin:0;font-weight:600}
.btn{display:block;text-align:center;background:var(--accent);color:#1b1400;font-weight:600;padding:12px;border-radius:8px;text-decoration:none}
p.desc{white-space:pre-line;margin:0}
.lf{display:flex;flex-direction:column;gap:8px}.lf input,.lf textarea{font:inherit;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink)}
.lf label.ck{display:flex;gap:8px;align-items:center;font-size:14px}.lf button{font:inherit;cursor:pointer;border:0}.lf .ok{color:#1d7f48;font-weight:600}.lf .er{color:#b0352a}
.btn.alt{background:transparent;border:1px solid var(--line);color:var(--ink)}
@media (max-width:760px){.vp{grid-template-columns:minmax(0,1fr)}}
${og.extraCss || ''}
</style></head><body><div class="wrap">${body}</div></body></html>`;
}

// Logo discreto da loja no topo das páginas públicas (v2.5).
const logoTag = (store, h = 44) => (store.logo_file ? `<img src="/media/${esc(store.logo_file)}" alt="${esc(store.name)}" style="height:${h}px;max-width:180px;object-fit:contain;display:block">` : '');
function waLink(store, text) {
  const n = String(store.whatsapp || '').replace(/\D/g, '');
  if (!n) return '';
  const full = n.startsWith('55') ? n : '55' + n;
  return `https://wa.me/${full}?text=${encodeURIComponent(text)}`;
}


// Formulário "Tenho interesse" (v2.9): vira lead no CRM da loja, com a origem (site ou QR code do carro).
function leadForm(store, v, origem) {
  return `<form class="lf" id="lf" autocomplete="on">
    <b>${v ? 'Tenho interesse neste carro' : 'Não achou o que procura? Fale com a gente'}</b>
    <input name="nome" placeholder="Seu nome" required maxlength="120" autocomplete="name">
    <input name="telefone" placeholder="Seu WhatsApp com DDD" required inputmode="tel" maxlength="20" autocomplete="tel">
    <textarea name="mensagem" rows="2" maxlength="1000" placeholder="${v ? 'Mensagem (opcional): tem troca? quer financiar?' : 'Qual carro você procura? Faixa de preço?'}"></textarea>
    <label class="ck"><input type="checkbox" name="visita" value="1"> Quero agendar uma visita${v ? ' / test-drive' : ''}</label>
    <input name="site" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
    <button class="btn" type="submit">Enviar</button><span class="msg" role="status"></span>
    <span class="muted" style="font-size:12px">Seus dados são usados só para a ${esc(store.name)} entrar em contato.</span>
  </form>
  <script>(function(){var f=document.getElementById('lf');f.addEventListener('submit',function(e){e.preventDefault();var d=Object.fromEntries(new FormData(f));d.visita=!!d.visita;d.origem=${JSON.stringify(origem || 'vitrine')};${v ? `d.vehicle_id=${Number(v.id)};` : ''}
  var m=f.querySelector('.msg');var b=f.querySelector('button');b.disabled=true;
  fetch(${JSON.stringify(`/api/public/${store.slug}/lead`)},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Erro');return j;});})
  .then(function(){f.querySelectorAll('input,textarea,label.ck').forEach(function(x){x.style.display='none'});b.style.display='none';m.className='msg ok';m.textContent=${JSON.stringify(`Recebemos! Em breve a ${store.name} fala com você no WhatsApp.`).replace(/</g, '\\u003c')};})
  .catch(function(err){b.disabled=false;m.className='msg er';m.textContent=err.message;});});})();</script>`;
}

// Diferenciais que viram filtro na vitrine (v2.13): só os positivos, e só aparecem os que algum carro tem.
const FILTRO_DESTAQUES = ['pericia_aprovada', 'pericia_premium', 'unico_dono', 'sem_retoques', 'revisoes', 'ipva_pago', 'garantia', 'aceita_troca', 'financiamento', 'blindado', 'teto_solar', 'pneus_novos', 'manual_chave'];
const FAIXAS_PRECO = [[0, 40000, 'Até R$ 40 mil'], [40000, 70000, 'R$ 40 a 70 mil'], [70000, 100000, 'R$ 70 a 100 mil'], [100000, 150000, 'R$ 100 a 150 mil'], [150000, 0, 'Acima de R$ 150 mil']];
const slugKey = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function storefront(store, vehicles) {
  const DEST = require('./vehicles').DESTAQUE || {};
  const preco = (v) => Number(v.preco_anuncio || v.preco || 0);
  const conta = (fn) => { const m = new Map(); for (const v of vehicles) for (const k of [].concat(fn(v)).filter(Boolean)) m.set(k, (m.get(k) || 0) + 1); return m; };
  const marcas = [...conta((v) => v.marca)].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
  const cats = [...conta((v) => v.carroceria || 'Outro')].sort((a, b) => b[1] - a[1]);
  const cambios = [...conta((v) => v.cambio)].sort((a, b) => b[1] - a[1]);
  const combs = [...conta((v) => v.combustivel)].sort((a, b) => b[1] - a[1]);
  const dests = [...conta((v) => (v.destaques || []).filter((k) => FILTRO_DESTAQUES.includes(k)))].sort((a, b) => FILTRO_DESTAQUES.indexOf(a[0]) - FILTRO_DESTAQUES.indexOf(b[0]));
  const faixas = FAIXAS_PRECO.map(([a, b, l]) => [`${a}-${b}`, l, vehicles.filter((v) => preco(v) >= a && (!b || preco(v) < b)).length]).filter((f) => f[2]);
  const anos = [...new Set(vehicles.map((v) => Number(v.ano_modelo) || 0).filter(Boolean))].sort((a, b) => b - a);
  const box = (grupo, valor, rotulo, n) => `<label class="fo"><input type="checkbox" name="${grupo}" value="${esc(valor)}"><span>${esc(rotulo)}</span><em>${n}</em></label>`;
  const sec = (titulo, html, aberto = true) => html ? `<details class="fs" ${aberto ? 'open' : ''}><summary>${titulo}</summary><div class="fl">${html}</div></details>` : '';

  const cards = vehicles.map((v) => {
    const sel = (v.destaques || []).filter((k) => ['pericia_premium', 'pericia_aprovada', 'unico_dono', 'ipva_pago', 'garantia'].includes(k)).slice(0, 2);
    return `<a class="card" href="/v/${esc(store.slug)}/${v.id}" data-marca="${esc(slugKey(v.marca))}" data-cat="${esc(slugKey(v.carroceria || 'Outro'))}" data-cambio="${esc(slugKey(v.cambio))}" data-comb="${esc(slugKey(v.combustivel))}"
      data-preco="${preco(v)}" data-ano="${Number(v.ano_modelo) || 0}" data-km="${Number(v.km) || 0}" data-dest="${esc((v.destaques || []).join(' '))}" data-ord="${esc(v.updated_at || '')}" data-txt="${esc(slugKey(`${v.marca} ${v.modelo} ${v.versao || ''} ${v.cor || ''}`))}">
    ${v.photos[0] ? `<img src="${esc(v.photos[0].url)}" alt="${esc(v.titulo)}" loading="lazy">` : '<span class="noph"></span>'}
    <div><b>${esc(v.marca)} ${esc(v.modelo)}</b> <span class="muted">${esc(v.versao)}</span>
    <div class="muted">${esc(v.ano_fab || '')}/${esc(v.ano_modelo || '')} · ${km(v.km)}${v.cambio ? ` · ${esc(v.cambio)}` : ''}</div>
    ${sel.length ? `<div class="tags">${sel.map((k) => `<span>${esc(DEST[k]?.label || k)}</span>`).join('')}</div>` : ''}
    <div class="price">${v.oferta_ativa ? `<s class="muted" style="font-size:.8em">${brl(v.preco)}</s> ` : ''}${brl(preco(v))}</div></div></a>`;
  }).join('');

  const filtros = vehicles.length ? `<aside class="side" id="fside" aria-label="Filtros">
      <div class="sh"><b>Filtrar</b><button type="button" class="lnk" id="flimpa">Limpar</button><button type="button" class="x" id="ffecha" aria-label="Fechar filtros">✕</button></div>
      <input type="search" id="fq" placeholder="Buscar modelo, versão, cor…" aria-label="Buscar">
      ${sec('Marca', marcas.map(([m, n]) => box('marca', slugKey(m), m, n)).join(''))}
      ${sec('Categoria', cats.map(([c, n]) => box('cat', slugKey(c), c, n)).join(''))}
      ${sec('Faixa de preço', `${faixas.map(([k, l, n]) => box('faixa', k, l, n)).join('')}
        <div class="rg"><input type="number" id="fpmin" inputmode="numeric" min="0" step="1000" placeholder="Mín. R$" aria-label="Preço mínimo"><span>a</span><input type="number" id="fpmax" inputmode="numeric" min="0" step="1000" placeholder="Máx. R$" aria-label="Preço máximo"></div>`)}
      ${sec('Diferenciais', dests.map(([k, n]) => box('dest', k, DEST[k]?.label || k, n)).join(''))}
      ${sec('Ano e quilometragem', `<label class="sl">Ano a partir de<select id="fano"><option value="">Qualquer</option>${anos.map((a) => `<option value="${a}">${a}</option>`).join('')}</select></label>
        <label class="sl">Quilometragem até<select id="fkm"><option value="">Qualquer</option>${[30000, 60000, 100000, 150000].map((k) => `<option value="${k}">${k.toLocaleString('pt-BR')} km</option>`).join('')}</select></label>`, false)}
      ${sec('Câmbio', cambios.map(([c, n]) => box('cambio', slugKey(c), c, n)).join(''), false)}
      ${sec('Combustível', combs.map(([c, n]) => box('comb', slugKey(c), c, n)).join(''), false)}
    </aside>` : '';

  return shell(`${store.name} · Seminovos`, `<div style="display:flex;gap:12px;align-items:center">${logoTag(store, 52)}<h1>${esc(store.name)}</h1></div>
    <p class="muted">${esc([store.city, store.state].filter(Boolean).join(' - '))}</p>
    <div class="vt">${filtros}
      <main>
        ${vehicles.length ? `<div class="bar"><button type="button" class="fbtn" id="fabre">Filtros <span id="fnb"></span></button><span class="muted" id="fcount" role="status">${vehicles.length} ${vehicles.length === 1 ? 'carro' : 'carros'}</span>
          <label class="ord">Ordenar <select id="ford"><option value="rec">Mais recentes</option><option value="pmen">Menor preço</option><option value="pmai">Maior preço</option><option value="km">Menor km</option><option value="ano">Mais novos</option></select></label></div>
          <div class="chipsel" id="fchips"></div>` : ''}
        <div class="grid" id="fgrid">${cards || '<p class="muted">Nenhum veículo disponível no momento.</p>'}</div>
        <p class="muted vazio" id="fvazio" hidden>Nenhum carro com esses filtros. <button type="button" class="lnk" id="flimpa2">Limpar filtros</button></p>
        <div class="box" style="max-width:520px;margin-top:24px">${leadForm(store, null, 'vitrine')}</div>
      </main>
    </div>
    ${vehicles.length ? `<script>${FILTRO_JS}</script>` : ''}`, { extraCss: FILTRO_CSS });
}

const FILTRO_CSS = `
.vt{display:grid;grid-template-columns:250px minmax(0,1fr);gap:24px;margin-top:20px;align-items:start}
.vt .grid{margin-top:12px}
.side{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px;position:sticky;top:12px;max-height:calc(100vh - 24px);overflow:auto;display:flex;flex-direction:column;gap:10px}
.sh{display:flex;align-items:center;gap:8px}.sh b{flex:1;font-size:16px}
.lnk{all:unset;cursor:pointer;color:var(--muted);text-decoration:underline;font-size:13px}
.x{display:none;all:unset;cursor:pointer;font-size:18px;padding:0 4px}
.side input[type=search],.side select,.rg input{font:inherit;width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink)}
.fs{border-top:1px solid var(--line);padding-top:8px}.fs summary{cursor:pointer;font-weight:600;padding:2px 0;list-style:none;display:flex;justify-content:space-between}
.fs summary::after{content:"+";color:var(--muted)}.fs[open] summary::after{content:"–"}.fs summary::-webkit-details-marker{display:none}
.fl{display:flex;flex-direction:column;gap:2px;margin-top:6px}
.fo{display:flex;align-items:center;gap:8px;padding:4px 2px;cursor:pointer;font-size:14px;border-radius:6px}.fo:hover{background:var(--bg)}
.fo span{flex:1}.fo em{font-style:normal;color:var(--muted);font-size:12px}.fo input{accent-color:var(--accent);width:16px;height:16px}
.rg{display:flex;align-items:center;gap:6px;margin-top:6px}.rg span{color:var(--muted)}
.sl{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--muted);margin-top:4px}
.bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.bar #fcount{flex:1}
.ord{display:flex;align-items:center;gap:6px;font-size:14px;color:var(--muted)}.ord select{font:inherit;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink)}
.fbtn{display:none;font:inherit;font-weight:600;padding:8px 14px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);cursor:pointer}
.chipsel{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.chipsel:empty{display:none}
.chipsel button{font:inherit;font-size:13px;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:20px;padding:3px 10px;cursor:pointer}
.chipsel button::after{content:" ✕";color:var(--muted)}
.tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}.tags span{font-size:11.5px;font-weight:600;background:var(--bg);border:1px solid var(--line);border-radius:20px;padding:1px 8px}
.noph{display:block;aspect-ratio:4/3;background:var(--line)}
.vazio{margin-top:16px}
@media (max-width:820px){
  .vt{grid-template-columns:minmax(0,1fr)}
  .fbtn{display:inline-block}
  .side{display:none;position:fixed;inset:0;z-index:50;max-height:none;border-radius:0;top:0}
  .side.on{display:flex}.x{display:inline-block}
}`;

// Filtros no navegador: rápido, sem recarregar, e o endereço guarda a escolha para compartilhar o link já filtrado.
const FILTRO_JS = `(function(){
var $=function(s){return document.querySelector(s)},$$=function(s){return Array.prototype.slice.call(document.querySelectorAll(s))};
var grid=$('#fgrid'),cards=$$('#fgrid .card'),side=$('#fside');
var norm=function(s){return String(s||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')};
var marcados=function(g){return $$('input[name="'+g+'"]:checked').map(function(i){return i.value})};
function estado(){return{q:norm($('#fq').value),marca:marcados('marca'),cat:marcados('cat'),faixa:marcados('faixa'),dest:marcados('dest'),cambio:marcados('cambio'),comb:marcados('comb'),pmin:Number($('#fpmin').value)||0,pmax:Number($('#fpmax').value)||0,ano:Number($('#fano').value)||0,km:Number($('#fkm').value)||0,ord:$('#ford').value}}
function passa(c,e){var d=c.dataset,p=Number(d.preco);
 if(e.q&&d.txt.indexOf(e.q)<0)return false;
 if(e.marca.length&&e.marca.indexOf(d.marca)<0)return false;
 if(e.cat.length&&e.cat.indexOf(d.cat)<0)return false;
 if(e.cambio.length&&e.cambio.indexOf(d.cambio)<0)return false;
 if(e.comb.length&&e.comb.indexOf(d.comb)<0)return false;
 if(e.faixa.length&&!e.faixa.some(function(f){var a=Number(f.split('-')[0]),b=Number(f.split('-')[1]);return p>=a&&(!b||p<b)}))return false;
 if(e.pmin&&p<e.pmin)return false;if(e.pmax&&p>e.pmax)return false;
 if(e.ano&&Number(d.ano)<e.ano)return false;if(e.km&&Number(d.km)>e.km)return false;
 var ds=(d.dest||'').split(' ');if(e.dest.some(function(k){return ds.indexOf(k)<0}))return false;
 return true}
var ords={rec:function(a,b){return b.dataset.ord.localeCompare(a.dataset.ord)},pmen:function(a,b){return a.dataset.preco-b.dataset.preco},pmai:function(a,b){return b.dataset.preco-a.dataset.preco},km:function(a,b){return a.dataset.km-b.dataset.km},ano:function(a,b){return b.dataset.ano-a.dataset.ano}};
function rotulo(i){return i.parentNode.querySelector('span').textContent}
function aplica(salva){var e=estado(),n=0;
 cards.slice().sort(ords[e.ord]||ords.rec).forEach(function(c){grid.appendChild(c);var ok=passa(c,e);c.hidden=!ok;if(ok)n++});
 $('#fcount').textContent=n+(n===1?' carro':' carros');$('#fvazio').hidden=n>0;
 var ch=[];$$('.side input[type=checkbox]:checked').forEach(function(i){ch.push(['c',i.name,i.value,rotulo(i)])});
 if(e.q)ch.push(['q','','','“'+$('#fq').value+'”']);if(e.pmin)ch.push(['v','fpmin','','Mín. R$ '+e.pmin.toLocaleString('pt-BR')]);if(e.pmax)ch.push(['v','fpmax','','Máx. R$ '+e.pmax.toLocaleString('pt-BR')]);
 if(e.ano)ch.push(['v','fano','','A partir de '+e.ano]);if(e.km)ch.push(['v','fkm','','Até '+e.km.toLocaleString('pt-BR')+' km']);
 $('#fchips').innerHTML='';ch.forEach(function(x){var b=document.createElement('button');b.type='button';b.textContent=x[3];b.onclick=function(){if(x[0]==='c'){var i=$('input[name="'+x[1]+'"][value="'+x[2]+'"]');if(i)i.checked=false}else if(x[0]==='q'){$('#fq').value=''}else{$('#'+x[1]).value=''}aplica(true)};$('#fchips').appendChild(b)});
 $('#fnb').textContent=ch.length?'('+ch.length+')':'';
 if(salva){var u=new URLSearchParams();['marca','cat','faixa','dest','cambio','comb'].forEach(function(g){if(e[g].length)u.set(g,e[g].join(','))});
  if($('#fq').value)u.set('q',$('#fq').value);['pmin','pmax','ano','km'].forEach(function(k){if(e[k])u.set(k,e[k])});if(e.ord!=='rec')u.set('ord',e.ord);
  try{history.replaceState(null,'',location.pathname+(u.toString()?'?'+u:''))}catch(_){}}}
function carrega(){var u=new URLSearchParams(location.search);['marca','cat','faixa','dest','cambio','comb'].forEach(function(g){(u.get(g)||'').split(',').filter(Boolean).forEach(function(v){var i=$('input[name="'+g+'"][value="'+v+'"]');if(i){i.checked=true;var d=i.closest('details');if(d)d.open=true}})});
 if(u.get('q'))$('#fq').value=u.get('q');[['pmin','fpmin'],['pmax','fpmax'],['ano','fano'],['km','fkm'],['ord','ford']].forEach(function(p){if(u.get(p[0]))$('#'+p[1]).value=u.get(p[0])})}
function limpa(){$$('.side input[type=checkbox]').forEach(function(i){i.checked=false});['fq','fpmin','fpmax','fano','fkm'].forEach(function(id){$('#'+id).value=''});aplica(true)}
side.addEventListener('change',function(){aplica(true)});var t;$('#fq').addEventListener('input',function(){clearTimeout(t);t=setTimeout(function(){aplica(true)},150)});
['fpmin','fpmax'].forEach(function(id){$('#'+id).addEventListener('input',function(){clearTimeout(t);t=setTimeout(function(){aplica(true)},300)})});
$('#ford').addEventListener('change',function(){aplica(true)});$('#flimpa').onclick=limpa;$('#flimpa2').onclick=limpa;
$('#fabre').onclick=function(){side.classList.add('on');document.body.style.overflow='hidden'};$('#ffecha').onclick=function(){side.classList.remove('on');document.body.style.overflow=''};
carrega();aplica(false);
})();`;

function vehiclePage(store, v, opts = {}) {
  const wa = waLink(store, `Olá! Tenho interesse no ${v.titulo} anunciado por ${brl(v.preco_anuncio || v.preco)}.`);
  const sold = v.status === 'vendido';
  return shell(`${v.titulo} · ${store.name}`, `<a href="/v/${esc(store.slug)}" class="muted" style="display:flex;gap:10px;align-items:center;text-decoration:none">${logoTag(store, 32)}← ${esc(store.name)}</a>
    <h1 style="margin-top:8px">${esc(v.marca)} ${esc(v.modelo)} ${esc(v.versao)}</h1>
    <div class="vp"><div class="gal">${v.photos.map((p) => `<img src="${esc(p.url)}" alt="" loading="lazy">`).join('')}</div>
    <div class="box"><div class="price">${sold ? 'Vendido' : `${v.oferta_ativa ? `<s class="muted" style="font-size:.7em">${brl(v.preco)}</s><br>Oferta: ` : ''}${brl(v.preco_anuncio || v.preco)}`}</div>
    <dl><dt>Ano</dt><dd>${esc(v.ano_fab || '')}/${esc(v.ano_modelo || '')}</dd><dt>Quilometragem</dt><dd>${km(v.km)}</dd>
    ${v.cambio ? `<dt>Câmbio</dt><dd>${esc(v.cambio)}</dd>` : ''}${v.combustivel ? `<dt>Combustível</dt><dd>${esc(v.combustivel)}</dd>` : ''}
    ${v.cor ? `<dt>Cor</dt><dd>${esc(v.cor)}</dd>` : ''}</dl>
    ${!sold && wa ? `<a class="btn" href="${esc(wa)}">Chamar no WhatsApp</a>` : ''}
    ${!sold ? leadForm(store, v, opts.origem) : ''}
    ${v.destaques?.length ? `<ul class="desc">${v.destaques.map((k) => `<li>${esc(require('./vehicles').DESTAQUE[k]?.texto || '')}</li>`).join('')}</ul>` : ''}
    ${v.descricao_anuncio ? `<p class="desc">${esc(v.descricao_anuncio)}</p>` : ''}</div></div>`,
  { image: v.photos[0]?.url, title: v.titulo, description: `${brl(v.preco_anuncio || v.preco)} · ${km(v.km)}` });
}

const legal = (title, html) => shell(`${title} · GiroAuto`, `<h1>${title}</h1><div style="max-width:68ch;margin-top:16px;display:flex;flex-direction:column;gap:10px">${html}</div>`);

const privacy = () => legal('Política de privacidade', `
<p>O GiroAuto é um painel usado por lojas de veículos para cadastrar o estoque e anunciar no Facebook e no Instagram.</p>
<p><b>Dados que coletamos.</b> Da loja: nome, e-mail e senha de acesso (guardada com criptografia de mão única), dados de contato, veículos e fotos cadastrados. Quando a loja conecta a conta do Facebook, recebemos um token de acesso, o nome do usuário do Facebook e os identificadores da Página, da conta do Instagram, da conta de anúncios e do portfólio empresarial escolhidos pela loja.</p>
<p><b>Como usamos.</b> Somente para executar o que a loja pede no painel: criar e acompanhar campanhas de anúncios, publicar os veículos no Facebook e no Instagram, manter o catálogo de veículos, gerar imagens de divulgação e exibir a vitrine pública dos veículos. Não vendemos nem compartilhamos dados com terceiros, exceto com a Meta (anúncios, Facebook e Instagram) e, quando a loja usa as imagens com IA, com o serviço escolhido (Google ou Pollinations), que recebe somente as fotos dos veículos para editá-las.</p>
<p><b>Armazenamento.</b> Os dados ficam no servidor do GiroAuto. O token do Facebook é guardado criptografado e pode ser revogado a qualquer momento pela loja no painel (Desconectar) ou nas configurações do Facebook.</p>
<p><b>Exclusão.</b> Veja como pedir a exclusão em <a href="/exclusao-de-dados">exclusão de dados</a>.</p>`);

const deletion = () => legal('Exclusão de dados', `
<p>Para remover os dados que o GiroAuto recebeu do Facebook:</p>
<ol><li>No painel do GiroAuto, abra <b>Configurações &gt; Facebook e Instagram</b> e clique em <b>Desconectar</b>. O token e os identificadores da conta são apagados na hora.</li>
<li>No Facebook, abra <b>Configurações &gt; Segurança e login &gt; Integrações comerciais</b> (ou Apps e sites) e remova o GiroAuto.</li></ol>
<p>Para excluir a conta da loja e todos os veículos e fotos, peça ao administrador do GiroAuto pelo e-mail de contato da loja. A exclusão é concluída em até 30 dias.</p>`);

const terms = () => legal('Termos de uso', `
<p>Ao usar o GiroAuto, a loja é responsável pelo conteúdo dos anúncios e pelo cumprimento das políticas de publicidade e de comércio da Meta.</p>
<p>As campanhas pagas são cobradas diretamente pela Meta, na forma de pagamento da conta de anúncios da loja. O GiroAuto não intermedeia pagamentos de anúncios.</p>
<p>A publicação orgânica no Marketplace é feita pela própria loja, com o auxílio do painel.</p>`);

const notFound = () => shell('Não encontrado', '<h1>Página não encontrada</h1><p class="muted">Este anúncio não está mais disponível.</p>');

module.exports = { storefront, vehiclePage, notFound, privacy, deletion, terms };
