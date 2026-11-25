// Vitrine pública do repasse: lista os anúncios em circulação e se atualiza sozinha.
// Nunca mostra origem (grupo, anunciante, telefones, placa) — só os dados do veículo e o seu contato.
import { q, um, todos } from './db.js'
import { cfg } from './config.js'
import { CATEGORIAS } from './categorias.js'
import { normTel } from './vendas.js'
import { faixaKm } from './formatter.js'
import { contaId } from './contexto.js'

const ATIVOS = `('circulando','enviado')`
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const brl = (n) => n == null ? '' : 'R$ ' + Math.round(n).toLocaleString('pt-BR')
const km = (n) => n == null ? '' : Math.round(n).toLocaleString('pt-BR') + ' km'

function publico (a, fotos = [], base = '/vitrine') {
  const d = a.dados || {}
  const fipe = a.fipe || d.fipeConsulta?.valor || null
  return {
    codigo: a.codigo,
    titulo: [d.marca, d.modelo, d.versao].filter(Boolean).join(' '),
    marca: d.marca || null,
    modelo: d.modelo || null,
    ano: d.ano || null,
    anoModelo: a.ano_modelo,
    km: d.km ?? null, // só para filtro/ordenação
    kmFaixa: faixaKm(d.km),
    cambio: d.cambio || null,
    combustivel: d.combustivel || null,
    cor: d.cor || null,
    cidade: d.cidade || null,
    categoria: d.categoria || null,
    categoriaNome: CATEGORIAS[d.categoria] || null,
    opcionais: d.opcionais || [],
    situacao: d.situacao || [],
    alertas: d.alertas || [],
    descricao: d.descricaoIA || '',
    preco: a.preco_repasse,
    fipe: cfg().vitrine.mostrarFipe ? fipe : null,
    abaixoFipe: cfg().vitrine.mostrarFipe && fipe && a.preco_repasse && fipe > a.preco_repasse ? fipe - a.preco_repasse : null,
    fotos: fotos.map(f => `${base}/foto/${f.id}`),
    atualizado: a.ultimo_envio || a.criado_em
  }
}

export async function listaVitrine (base = '/vitrine') {
  const rows = await todos(`SELECT id, codigo, dados, preco_repasse, fipe, ano_modelo, criado_em, ultimo_envio FROM repasse.anuncios
    WHERE conta_id = $1 AND status IN ${ATIVOS} AND codigo IS NOT NULL ORDER BY COALESCE(ultimo_envio, criado_em) DESC LIMIT 500`, [contaId()])
  const ids = rows.map(r => r.id)
  const fts = ids.length ? await todos(`SELECT DISTINCT ON (anuncio_id) id, anuncio_id FROM repasse.fotos WHERE anuncio_id = ANY($1) ORDER BY anuncio_id, capa DESC, ordem`, [ids]) : []
  const capa = new Map(fts.map(f => [f.anuncio_id, f]))
  return rows.map(r => publico(r, capa.get(r.id) ? [capa.get(r.id)] : [], base))
}

export async function itemVitrine (codigo, base = '/vitrine') {
  const a = await um(`SELECT id, codigo, dados, preco_repasse, fipe, ano_modelo, criado_em, ultimo_envio FROM repasse.anuncios
    WHERE conta_id = $2 AND codigo = $1 AND status IN ${ATIVOS}`, [codigo, contaId()])
  if (!a) return null
  const fotos = await todos('SELECT id FROM repasse.fotos WHERE anuncio_id = $1 ORDER BY capa DESC, ordem', [a.id])
  return { ...publico(a, fotos, base), _id: a.id }
}

export async function fotoPublica (id) {
  const r = await um(`SELECT COALESCE(f.dados_publico, f.dados) AS dados FROM repasse.fotos f JOIN repasse.anuncios a ON a.id = f.anuncio_id
    WHERE f.id = $1 AND a.conta_id = $2 AND a.status IN ${ATIVOS}`, [id, contaId()])
  return r ? Buffer.from(r.dados) : null
}

export async function registrarLead ({ nome, telefone, mensagem, codigo }) {
  const tel = normTel(telefone)
  if (!String(nome || '').trim() || tel.length < 10) throw new Error('Informe nome e WhatsApp com DDD')
  const C = contaId()
  const a = codigo ? await um('SELECT id FROM repasse.anuncios WHERE conta_id = $2 AND codigo = $1', [String(codigo), C]) : null
  await q(`INSERT INTO repasse.leads (conta_id, nome, telefone, mensagem, anuncio_id, codigo) VALUES ($6,$1,$2,$3,$4,$5)`,
    [String(nome).trim().slice(0, 120), tel, String(mensagem || '').slice(0, 1000) || null, a?.id || null, a ? String(codigo) : null, C])
}

// ---------------- páginas ----------------
function contatoWa (texto) {
  const tel = normTel(cfg().negocio.contato)
  return tel.length >= 10 ? `https://wa.me/55${tel}?text=${encodeURIComponent(texto)}` : null
}

// ícone de atendimento (assistente) — mesmo comportamento na lista e na página do carro
function chat (base, codigo = '') {
  const a = cfg().assistente || {}
  if (a.ativo === false) return ''
  const n = cfg().negocio
  return `<div id="grChat"></div><script>window.GR_CHAT=${JSON.stringify({ api: `${base}/chat`, codigo, nome: a.nome || 'Assistente', negocio: cfg().vitrine.titulo || n.nome || '' }).replace(/</g, '\\u003c')}</script><script src="${base.replace(/\/(vitrine|v\/[^/]+)$/, '')}/vitrine-chat.js" defer></script>`
}

function shell (titulo, corpo, og = {}, base = '/vitrine', codigo = '') {
  const n = cfg().negocio
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)}</title>
<meta property="og:title" content="${esc(og.title || titulo)}">${og.description ? `<meta property="og:description" content="${esc(og.description)}">` : ''}${og.image ? `<meta property="og:image" content="${esc(og.image)}">` : ''}
<meta name="theme-color" content="#0f7a4a">
<style>
:root{--bg:#f3f4f1;--card:#fff;--tx:#1c1f1d;--mut:#6a716c;--borda:#dfe2dd;--pri:#0f7a4a;--sec:#eef1ec}
@media (prefers-color-scheme:dark){:root{--bg:#141715;--card:#1d211f;--tx:#e8ebe8;--mut:#9aa39d;--borda:#2e3430;--sec:#262b28}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:inherit}.wrap{max-width:1320px;margin:0 auto;padding:16px}
header{background:var(--card);border-bottom:1px solid var(--borda);position:sticky;top:0;z-index:5}header .wrap{display:flex;align-items:center;gap:12px;padding:10px 16px}
.marca{font-size:19px;font-weight:700}.mut{color:var(--mut)}
.btn{display:inline-block;background:var(--pri);color:#fff;text-decoration:none;font-weight:600;padding:9px 14px;border-radius:9px;border:0;font:inherit;font-weight:600;cursor:pointer}
.btn.sec{background:var(--sec);color:var(--tx)}
.layout{display:grid;grid-template-columns:240px minmax(0,1fr);gap:16px;align-items:start}
.lateral{background:var(--card);border:1px solid var(--borda);border-radius:12px;padding:12px;position:sticky;top:70px;max-height:calc(100vh - 86px);overflow:auto;display:flex;flex-direction:column;gap:10px}
.lateral h3{margin:0;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--mut)}
.lateral label{font-size:13px;display:flex;align-items:center;gap:6px;cursor:pointer;padding:1px 0}
.lateral label small{margin-left:auto;color:var(--mut)}
.lateral input[type=search],.lateral select,.lateral input[type=number]{font:inherit;font-size:14px;padding:7px 9px;border:1px solid var(--borda);border-radius:8px;background:var(--bg);color:var(--tx);width:100%}
.lateral input[type=checkbox]{accent-color:var(--pri);width:15px;height:15px;margin:0}
.dupla{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.lista-ck{display:flex;flex-direction:column;max-height:190px;overflow:auto}
.limpar{background:none;border:0;color:var(--pri);font:inherit;font-size:13px;cursor:pointer;padding:0;text-align:left}
.topo-lista{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap}
.topo-lista select{font:inherit;font-size:14px;padding:6px 9px;border:1px solid var(--borda);border-radius:8px;background:var(--card);color:var(--tx);margin-left:auto}
#abrirFiltros{display:none}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--borda);border-radius:12px;overflow:hidden;text-decoration:none;display:flex;flex-direction:column}
.card img,.ph{width:100%;aspect-ratio:4/3;object-fit:cover;background:#111;display:block}
.card .c{padding:9px 11px;display:flex;flex-direction:column;gap:2px;font-size:13.5px}
.card .t{font-weight:700;line-height:1.25}.preco{font-size:20px;font-weight:800;color:var(--pri)}
.tag{display:inline-block;font-size:11px;padding:1px 7px;border-radius:99px;background:var(--sec);margin-right:4px}
.tag.v{background:#d5f2e1;color:#0b5c37}
.det{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:18px;margin-top:12px}
.gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:6px}.gal img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px;background:#111;cursor:zoom-in}
.gal a:first-child{grid-column:1/-1}.gal a:first-child img{aspect-ratio:auto;max-height:560px;object-fit:contain}
.box{background:var(--card);border:1px solid var(--borda);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px;align-self:start}
dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0}dt{color:var(--mut)}dd{margin:0;font-weight:600}
form{display:flex;flex-direction:column;gap:8px}form input,form textarea{font:inherit;font-size:16px;padding:9px;border:1px solid var(--borda);border-radius:9px;background:var(--bg);color:var(--tx)}
.vazio{padding:40px;text-align:center;color:var(--mut);grid-column:1/-1}
@media (max-width:800px){
 .layout{grid-template-columns:minmax(0,1fr)}
 .lateral{display:none;position:fixed;inset:0;top:0;z-index:20;border-radius:0;max-height:none;padding:16px 16px 80px}
 .lateral.aberta{display:flex}
 #abrirFiltros{display:inline-block}
 .fechar-filtros{position:sticky;bottom:0}
 .grid{grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}
 .card .c{padding:7px 8px;font-size:12.5px}.preco{font-size:17px}
 .det{grid-template-columns:minmax(0,1fr)}
}
@media (min-width:801px){.fechar-filtros{display:none}}
</style></head><body>
<header><div class="wrap"><a href="${base}" class="marca" style="text-decoration:none">${esc(cfg().vitrine.titulo || n.nome)}</a><span class="mut" style="margin-left:auto">${esc(n.contato || '')}</span></div></header>
<div class="wrap">${corpo}</div>${chat(base, codigo)}</body></html>`
}

export function paginaLista (base = '/vitrine') {
  const v = cfg().vitrine
  const wa = contatoWa('Olá! Vi a vitrine de repasse e quero mais informações.')
  return shell(v.titulo || cfg().negocio.nome, `
${v.subtitulo ? `<p class="mut" style="margin:0 0 12px">${esc(v.subtitulo)}</p>` : ''}
<div class="layout">
<aside class="lateral" id="lateral">
  <input type="search" id="q" placeholder="Buscar modelo, cidade, código…">
  <div><h3>Marca</h3><div class="lista-ck" id="fm"></div></div>
  <div><h3>Tipo</h3><div class="lista-ck" id="fc"></div></div>
  <div><h3>Valor (R$)</h3><div class="dupla"><input type="number" id="pmin" placeholder="mín." step="1000"><input type="number" id="pmax" placeholder="máx." step="1000"></div></div>
  <div><h3>Ano</h3><div class="dupla"><input type="number" id="amin" placeholder="de"><input type="number" id="amax" placeholder="até"></div></div>
  <div><h3>KM máximo</h3><input type="number" id="kmax" placeholder="ex.: 80000" step="5000"></div>
  <div><h3>Câmbio</h3><div class="lista-ck" id="fx"></div></div>
  ${v.mostrarFipe ? '<label><input type="checkbox" id="sofipe"> Só abaixo da FIPE</label>' : ''}
  <button class="limpar" id="limpar" type="button">Limpar filtros</button>
  ${wa ? `<a class="btn" href="${esc(wa)}" target="_blank" rel="noopener" style="text-align:center">WhatsApp</a>` : ''}
  <button class="btn fechar-filtros" type="button" id="fecharFiltros">Ver veículos</button>
</aside>
<main>
  <div class="topo-lista"><button class="btn sec" id="abrirFiltros" type="button">☰ Filtros</button><span class="mut" id="n"></span>
    <select id="fo"><option value="rec">Mais recentes</option><option value="menor">Menor preço</option><option value="maior">Maior preço</option><option value="ano">Mais novos</option><option value="km">Menor km</option>${v.mostrarFipe ? '<option value="fipe">Maior desconto da FIPE</option>' : ''}</select></div>
  <div class="grid" id="g"></div>
</main>
</div>
<script>
let itens=[];const $=s=>document.querySelector(s);const $$=s=>[...document.querySelectorAll(s)];
const brl=n=>n==null?'':'R$ '+Math.round(n).toLocaleString('pt-BR');const km=n=>n==null?'':Math.round(n).toLocaleString('pt-BR')+' km';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function cks(id,pares){const sel=new Set($$('#'+id+' input:checked').map(i=>i.value));$('#'+id).innerHTML=pares.map(([v,n,c])=>'<label><input type="checkbox" value="'+esc(v)+'" '+(sel.has(v)?'checked':'')+'> '+esc(n)+'<small>'+c+'</small></label>').join('')||'<span class="mut" style="font-size:13px">—</span>'}
function cont(f){const m=new Map();itens.forEach(i=>{const k=f(i);if(k)m.set(k[0],[k[0],k[1],(m.get(k[0])?.[2]||0)+1])});return [...m.values()].sort((a,b)=>String(a[1]).localeCompare(String(b[1])))}
function opts(){cks('fm',cont(i=>i.marca&&[i.marca,i.marca]));cks('fc',cont(i=>i.categoria&&[i.categoria,i.categoriaNome||i.categoria]));cks('fx',cont(i=>i.cambio&&[i.cambio,i.cambio]))}
const marc=id=>$$('#'+id+' input:checked').map(i=>i.value);
function pintar(){const q=$('#q').value.toLowerCase(),ms=marc('fm'),cs=marc('fc'),xs=marc('fx'),pmin=+$('#pmin').value||0,pmax=+$('#pmax').value||0,amin=+$('#amin').value||0,amax=+$('#amax').value||0,kmax=+$('#kmax').value||0,sf=$('#sofipe')?.checked,o=$('#fo').value;
 let l=itens.filter(i=>(!ms.length||ms.includes(i.marca))&&(!cs.length||cs.includes(i.categoria))&&(!xs.length||xs.includes(i.cambio))&&(!pmin||(i.preco&&i.preco>=pmin))&&(!pmax||(i.preco&&i.preco<=pmax))&&(!amin||(i.anoModelo&&i.anoModelo>=amin))&&(!amax||(i.anoModelo&&i.anoModelo<=amax))&&(!kmax||(i.km!=null&&i.km<=kmax))&&(!sf||i.abaixoFipe)&&(!q||[i.titulo,i.cidade,i.ano,i.codigo,i.cor].join(' ').toLowerCase().includes(q)));
 const s={menor:(a,b)=>(a.preco||9e9)-(b.preco||9e9),maior:(a,b)=>(b.preco||0)-(a.preco||0),ano:(a,b)=>(b.anoModelo||0)-(a.anoModelo||0),km:(a,b)=>(a.km??9e9)-(b.km??9e9),fipe:(a,b)=>(b.abaixoFipe||0)-(a.abaixoFipe||0)}[o];if(s)l=[...l].sort(s);
 $('#n').textContent=l.length+' veículo(s)';$('#fecharFiltros').textContent='Ver '+l.length+' veículo(s)';
 $('#g').innerHTML=l.map(i=>'<a class="card" href="${base}/'+encodeURIComponent(i.codigo)+'">'+(i.fotos[0]?'<img loading="lazy" src="'+i.fotos[0]+'" alt="">':'<div class="ph"></div>')+'<div class="c"><span class="t">'+esc(i.titulo)+'</span><span class="mut">'+[i.ano,i.kmFaixa,i.cambio,i.cidade].filter(Boolean).map(esc).join(' · ')+'</span><span class="preco">'+brl(i.preco)+'</span>'+(i.fipe?'<span class="mut">FIPE '+brl(i.fipe)+(i.abaixoFipe?' · <span class="tag v">'+brl(i.abaixoFipe)+' abaixo</span>':'')+'</span>':'')+'<span class="mut" style="font-size:12px">Cód. '+esc(i.codigo)+(i.categoriaNome?' · '+esc(i.categoriaNome):'')+'</span></div></a>').join('')||'<div class="vazio">Nenhum veículo com esses filtros agora.</div>'}
async function carregar(){try{itens=await fetch('${base}/dados.json',{cache:'no-store'}).then(r=>r.json());opts();pintar()}catch(e){}}
$('#lateral').addEventListener('input',pintar);$('#fo').addEventListener('input',pintar);
$('#limpar').onclick=()=>{$$('#lateral input').forEach(i=>{if(i.type==='checkbox')i.checked=false;else i.value=''});pintar()};
$('#abrirFiltros').onclick=()=>$('#lateral').classList.add('aberta');$('#fecharFiltros').onclick=()=>$('#lateral').classList.remove('aberta');
carregar();setInterval(carregar,120000);
</script>`, { title: v.titulo || cfg().negocio.nome, description: v.subtitulo }, base)
}

export function paginaItem (i, origem, base = '/vitrine') {
  const wa = contatoWa(`Olá! Tenho interesse no ${i.titulo} ${i.ano || ''} (Cód. ${i.codigo}) por ${brl(i.preco)}.`)
  const dl = [['Ano', i.ano], ['KM', i.kmFaixa], ['Câmbio', i.cambio], ['Combustível', i.combustivel], ['Cor', i.cor], ['Cidade', i.cidade], ['Tipo', i.categoriaNome], ['Código', i.codigo]]
    .filter(([, v]) => v).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')
  return shell(`${i.titulo} ${i.ano || ''} · ${brl(i.preco)}`, `
<a href="${base}" class="mut">← Todos os veículos</a>
<div class="det">
  <div class="gal">${i.fotos.map(f => `<a href="${f}" target="_blank"><img src="${f}" alt=""></a>`).join('') || '<div class="ph"></div>'}</div>
  <div class="box">
    <h1 style="margin:0;font-size:22px">${esc(i.titulo)} ${esc(i.ano || '')}</h1>
    <div class="preco" style="font-size:28px">${brl(i.preco)}</div>
    ${i.fipe ? `<div class="mut">FIPE ${brl(i.fipe)}${i.abaixoFipe ? ` · <span class="tag v">${brl(i.abaixoFipe)} abaixo</span>` : ''}</div>` : ''}
    <dl>${dl}</dl>
    ${i.descricao ? `<p style="margin:0;white-space:pre-line">${esc(i.descricao)}</p>` : ''}
    ${i.opcionais.length ? `<div>${i.opcionais.map(o => `<span class="tag">${esc(o)}</span>`).join('')}</div>` : ''}
    ${i.situacao.length ? `<div class="mut">${i.situacao.map(esc).join(' • ')}</div>` : ''}
    ${i.alertas.length ? `<div style="color:#9a6510">⚠️ ${i.alertas.map(esc).join(', ')}</div>` : ''}
    ${wa ? `<a class="btn" href="${esc(wa)}" target="_blank" rel="noopener" style="text-align:center">Chamar no WhatsApp</a>` : ''}
    <form id="lf"><b>Ou deixe seu contato</b>
      <input name="nome" placeholder="Seu nome" required><input name="telefone" placeholder="WhatsApp com DDD" inputmode="tel" required>
      <textarea name="mensagem" rows="2" placeholder="Mensagem (opcional)"></textarea>
      <button class="btn sec">Quero ser chamado</button><span id="lm" class="mut"></span></form>
  </div>
</div>
<script>
document.getElementById('lf').addEventListener('submit',async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));d.codigo=${JSON.stringify(i.codigo)};
const r=await fetch('${base}/lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});const j=await r.json().catch(()=>({}));
document.getElementById('lm').textContent=r.ok?'Recebido! Vamos chamar você no WhatsApp.':(j.erro||'Não foi possível enviar');if(r.ok)e.target.reset()})
</script>`, { title: `${i.titulo} ${i.ano || ''} · ${brl(i.preco)}`, description: [i.ano, i.kmFaixa, i.cidade].filter(Boolean).join(' · '), image: i.fotos[0] ? origem + i.fotos[0] : '' }, base, i.codigo)
}
