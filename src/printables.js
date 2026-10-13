// Materiais da loja (v2.0): folha A4 para o para-brisa (colorida ou preto e branco) e painel para TV/monitor.
const QRCode = require('qrcode');
const config = require('./config');
const V = require('./vehicles');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (n) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR');
const km = (n) => Number(n || 0).toLocaleString('pt-BR') + ' km';
const vehicleUrl = (store, v) => `${config.publicUrl}/v/${store.slug}/${v.id}`;
const logoUrl = (store) => (store.logo_file ? `${config.publicUrl}/media/${store.logo_file}` : '');

async function qrDataUrl(text, opts = {}) {
  return QRCode.toDataURL(text, { margin: 1, width: 420, errorCorrectionLevel: 'M', color: { dark: opts.dark || '#000000', light: opts.light || '#ffffff' } });
}
async function qrPng(text) {
  return QRCode.toBuffer(text, { margin: 2, width: 800, errorCorrectionLevel: 'M' });
}

const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=IBM+Plex+Sans:wght@400;600&display=swap">';

/* ---------------- Folha A4 para o para-brisa ---------------- */
async function a4(store, vRaw, mode) {
  const v = V.serialize(vRaw);
  const pb = mode === 'pb';
  const qr = await qrDataUrl(vehicleUrl(store, v));
  const dest = v.destaques.map((k) => V.DESTAQUE[k]).filter((d) => d && !d.alerta && !d.rodape);
  const alertas = v.destaques.map((k) => V.DESTAQUE[k]).filter((d) => d && d.alerta);
  const itens = [
    ['Ano', `${v.ano_fab || '?'}/${v.ano_modelo || '?'}`], ['Quilometragem', km(v.km)], v.cambio && ['Câmbio', v.cambio],
    v.combustivel && ['Combustível', v.combustivel], v.cor && ['Cor', v.cor], v.carroceria && ['Carroceria', v.carroceria],
  ].filter(Boolean);
  const foto = v.photos[0]?.url;
  const contato = store.whatsapp || store.phone || '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(v.titulo)} · folha para o carro</title>${FONTS}
<style>
@page{size:A4 portrait;margin:0}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
html,body{margin:0;background:#888}
body{font-family:"IBM Plex Sans",Arial,sans-serif;color:#111}
.sheet{width:210mm;height:297mm;margin:10mm auto;background:#fff;position:relative;overflow:hidden;display:flex;flex-direction:column}
.top{background:${pb ? '#fff' : '#0b0c0f'};color:${pb ? '#000' : '#fff'};padding:12mm 14mm 8mm;${pb ? 'border-bottom:2.5mm solid #000;' : ''}}
.loja{display:flex;align-items:center;gap:4mm;font-weight:600;font-size:13pt;letter-spacing:.04em;text-transform:uppercase;${pb ? '' : 'color:#e3b341;'}}
.loja img{height:12mm;${pb ? 'filter:grayscale(1)' : ''}}
h1{font-family:"Barlow Condensed",Arial Narrow,sans-serif;font-weight:800;font-size:52pt;line-height:.95;margin:4mm 0 0;text-transform:uppercase}
h2{font-family:"Barlow Condensed",sans-serif;font-weight:600;font-size:20pt;margin:1mm 0 0;${pb ? '' : 'color:#e3b341;'}}
.foto{height:88mm;background:#ddd center/cover no-repeat url('${esc(foto || '')}');${pb ? 'display:none;' : ''}}
.mid{flex:1;display:grid;grid-template-columns:1.25fr 1fr;gap:8mm;padding:9mm 14mm 0}
.itens{display:grid;grid-template-columns:1fr 1fr;gap:3mm 6mm;align-content:start}
.it span{display:block;font-size:9.5pt;color:#555;text-transform:uppercase;letter-spacing:.05em}
.it b{font-size:15pt}
.dest{margin:6mm 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2mm;font-size:13pt;font-weight:600}
.dest li::before{content:"✔ ";color:${pb ? '#000' : '#1d7f48'}}
.preco{border:${pb ? '1.6mm solid #000' : '1.6mm solid #e3b341'};${pb ? '' : 'background:#0b0c0f;color:#fff;'}border-radius:3mm;padding:5mm 6mm;text-align:center;align-self:start}
.preco .de{font-size:14pt;text-decoration:line-through;color:${pb ? '#000' : '#bbb'}}
.preco .tag{display:inline-block;font-weight:800;font-family:"Barlow Condensed",sans-serif;font-size:16pt;letter-spacing:.06em;${pb ? 'border:.6mm solid #000;' : 'background:#e3b341;color:#0b0c0f;'}padding:0 3mm;margin-bottom:2mm}
.preco .v{font-family:"Barlow Condensed",sans-serif;font-weight:800;font-size:${pb ? '58pt' : '54pt'};line-height:1;white-space:nowrap}
.qr{margin-top:6mm;text-align:center;font-size:10.5pt;font-weight:600}
.qr img{width:42mm;height:42mm;display:block;margin:0 auto 2mm}
.alerta{margin:4mm 14mm 0;font-size:10pt;border:.4mm solid #000;padding:2mm 3mm}
.foot{padding:6mm 14mm 10mm;display:flex;justify-content:space-between;align-items:flex-end;font-size:13pt;font-weight:600;border-top:.3mm solid #ccc;margin-top:6mm}
.foot .wa{font-family:"Barlow Condensed",sans-serif;font-size:24pt;font-weight:800}
.bar{position:fixed;top:10px;left:50%;transform:translateX(-50%);display:flex;gap:8px;z-index:5}
.bar a,.bar button{font:600 14px "IBM Plex Sans",sans-serif;padding:10px 16px;border-radius:8px;border:0;background:#efa91c;color:#1b1400;cursor:pointer;text-decoration:none}
.bar a.off{background:#fff;color:#111}
@media print{html,body{background:#fff}.sheet{margin:0}.bar{display:none}}
</style></head><body>
<div class="bar"><button onclick="print()">Imprimir</button><a class="${pb ? 'off' : ''}" href="?modo=cor">Colorida</a><a class="${pb ? '' : 'off'}" href="?modo=pb">Preto e branco</a></div>
<div class="sheet">
  <div class="top">
    <div class="loja">${logoUrl(store) ? `<img src="${esc(logoUrl(store))}" alt="">` : ''}${esc(store.name)}</div>
    <h1>${esc(v.marca)} ${esc(v.modelo)}</h1>
    <h2>${esc([v.versao, v.ano_modelo].filter(Boolean).join(' · '))}</h2>
  </div>
  ${foto && !pb ? '<div class="foto"></div>' : ''}
  <div class="mid">
    <div>
      <div class="itens">${itens.map(([k, val]) => `<div class="it"><span>${esc(k)}</span><b>${esc(val)}</b></div>`).join('')}</div>
      ${dest.length ? `<ul class="dest">${dest.slice(0, pb ? 8 : 5).map((d) => `<li>${esc(d.texto)}</li>`).join('')}</ul>` : ''}
    </div>
    <div>
      <div class="preco">${v.oferta_ativa ? `<div class="tag">OFERTA</div><div class="de">de ${brl(v.preco)}</div>` : ''}<div class="v">${v.preco_anuncio ? brl(v.preco_anuncio) : 'Consulte'}</div></div>
      <div class="qr"><img src="${qr}" alt="QR code">Aponte a câmera: fotos, detalhes e WhatsApp</div>
    </div>
  </div>
  ${alertas.length ? `<div class="alerta"><b>Informação importante:</b> ${esc(alertas.map((d) => d.texto).join('; '))}.</div>` : ''}
  <div class="foot"><div>${esc([store.address, store.city && `${store.city}${store.state ? '/' + store.state : ''}`].filter(Boolean).join(' · '))}</div>${contato ? `<div class="wa">WhatsApp ${esc(contato)}</div>` : ''}</div>
</div>
<script>
// Diminui a fonte do preço e do modelo até caberem (caso a fonte condensada não carregue).
function fit(el, box){let s=parseFloat(getComputedStyle(el).fontSize);while(el.scrollWidth>box.clientWidth-8&&s>10){s-=2;el.style.fontSize=s+'px';}}
addEventListener('load',()=>{document.querySelectorAll('.preco .v').forEach((e)=>fit(e,e.parentElement));document.querySelectorAll('h1').forEach((e)=>fit(e,e.parentElement));});
document.fonts&&document.fonts.ready.then(()=>{document.querySelectorAll('.preco .v').forEach((e)=>fit(e,e.parentElement));});
</script></body></html>`;
}

/* ---------------- Painel para TV / monitor ---------------- */
function tv(store) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(store.name)} · painel</title>${FONTS}
<style>
*{box-sizing:border-box}html,body{margin:0;height:100%;background:#0b0c0f;color:#fff;font-family:"IBM Plex Sans",sans-serif;overflow:hidden;cursor:none}
.slide{position:absolute;inset:0;display:grid;grid-template-columns:62% 38%;opacity:0;transition:opacity 1s}
.slide.on{opacity:1}
.ph{background:#222 center/cover no-repeat;position:relative}
.ph::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(11,12,15,0) 70%,#0b0c0f)}
.info{padding:5vh 4vw 5vh 2vw;display:flex;flex-direction:column;gap:2.2vh;justify-content:center}
.marca{color:#e3b341;font-weight:600;letter-spacing:.12em;text-transform:uppercase;font-size:2.2vh}
.mod{font-family:"Barlow Condensed",sans-serif;font-weight:800;font-size:9vh;line-height:.92;text-transform:uppercase}
.ver{font-family:"Barlow Condensed",sans-serif;font-size:3.6vh;color:#ddd}
.its{display:flex;flex-wrap:wrap;gap:1vh 1.4vw;font-size:2.6vh;color:#e8e8e8}
.its span{border:1px solid #3a3d44;border-radius:99px;padding:.6vh 1.2vw}
.preco{border:.5vh solid #e3b341;border-radius:1vh;padding:1.6vh 1.6vw;align-self:flex-start}
.preco .de{text-decoration:line-through;color:#aaa;font-size:2.6vh}
.preco .tag{background:#e3b341;color:#0b0c0f;font-weight:800;font-family:"Barlow Condensed",sans-serif;font-size:2.8vh;padding:0 1vw;display:inline-block}
.preco .v{font-family:"Barlow Condensed",sans-serif;font-weight:800;font-size:10vh;line-height:1;white-space:nowrap}
.preco{max-width:100%}
.qr{display:flex;align-items:center;gap:1.4vw;font-size:2.2vh;color:#ccc}
.qr img{width:16vh;height:16vh;border-radius:1vh;background:#fff;padding:.6vh}
.top{position:fixed;top:2.2vh;right:2.4vw;display:flex;gap:1.6vw;align-items:center;font-weight:600;font-size:2.4vh;z-index:3;text-shadow:0 1px 6px #000}
.top img{height:5vh}
.bar{position:fixed;left:0;bottom:0;height:.6vh;background:#e3b341;z-index:3;width:0}
.empty{display:grid;place-items:center;height:100%;font-size:4vh;color:#aaa}
</style></head><body>
<div class="top">${logoUrl(store) ? `<img src="${esc(logoUrl(store))}" alt="">` : ''}<span>${esc(store.name)}</span><span id="clock"></span></div>
<div id="stage"><div class="empty">Carregando estoque…</div></div><div class="bar" id="bar"></div>
<script>
const SLUG=${JSON.stringify(store.slug)};const SEC=10;let list=[],i=0,timer;
const esc=(s)=>String(s??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const brl=(n)=>'R$ '+Number(n||0).toLocaleString('pt-BR');
async function load(){try{const r=await fetch('/tv/'+SLUG+'/dados');if(r.ok){list=(await r.json()).veiculos;}}catch(e){}}
function slide(v){return '<div class="slide"><div class="ph" style="background-image:url(\\''+esc(v.foto)+'\\')"></div><div class="info"><div class="marca">'+esc(v.marca)+'</div><div class="mod">'+esc(v.modelo)+'</div><div class="ver">'+esc([v.versao,v.ano].filter(Boolean).join(' · '))+'</div><div class="its">'+v.itens.map((x)=>'<span>'+esc(x)+'</span>').join('')+'</div><div class="preco">'+(v.oferta?'<div class="tag">OFERTA</div> <span class="de">'+brl(v.de)+'</span>':'')+'<div class="v">'+brl(v.preco)+'</div></div><div class="qr"><img src="'+v.qr+'" alt=""><span>Aponte a câmera<br>para ver fotos e chamar no WhatsApp</span></div></div></div>';}
function show(){const st=document.getElementById('stage');if(!list.length){st.innerHTML='<div class="empty">Nenhum veículo disponível no momento.</div>';return;}
 i=i%list.length;st.insertAdjacentHTML('beforeend',slide(list[i]));const els=st.querySelectorAll('.slide');const cur=els[els.length-1];
 requestAnimationFrame(()=>requestAnimationFrame(()=>{cur.classList.add('on');const pv=cur.querySelector('.preco .v'),bx=cur.querySelector('.info');let s=parseFloat(getComputedStyle(pv).fontSize);while(pv.scrollWidth>bx.clientWidth-40&&s>20){s-=4;pv.style.fontSize=s+'px';}}));setTimeout(()=>{st.querySelectorAll('.slide').forEach((e)=>{if(e!==cur)e.remove();});st.querySelector('.empty')?.remove();},1200);
 const b=document.getElementById('bar');b.style.transition='none';b.style.width='0';requestAnimationFrame(()=>{b.style.transition='width '+SEC+'s linear';b.style.width='100%';});i++;}
function clock(){document.getElementById('clock').textContent=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});}
(async()=>{await load();show();setInterval(show,SEC*1000);setInterval(load,5*60*1000);clock();setInterval(clock,20000);
document.addEventListener('click',()=>{document.documentElement.requestFullscreen?.().catch(()=>{});});})();
</script></body></html>`;
}

async function tvData(store, vehicles) {
  const out = [];
  for (const v of vehicles) {
    if (!v.photos.length) continue;
    out.push({
      id: v.id, marca: v.marca, modelo: v.modelo, versao: v.versao, ano: v.ano_modelo || v.ano_fab || '',
      foto: v.photos[0].url, preco: v.preco_anuncio, de: v.preco, oferta: v.oferta_ativa,
      itens: [v.km ? km(v.km) : '', v.cambio, v.combustivel, v.cor, ...v.destaques.map((k) => V.DESTAQUE[k]).filter((d) => d && !d.alerta && !d.rodape).slice(0, 3).map((d) => d.label)].filter(Boolean),
      qr: await qrDataUrl(vehicleUrl(store, v)),
    });
  }
  return out;
}

module.exports = { a4, tv, tvData, qrPng, qrDataUrl, vehicleUrl };
