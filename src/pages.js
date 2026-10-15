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

function storefront(store, vehicles) {
  const cards = vehicles.map((v) => `<a class="card" href="/v/${esc(store.slug)}/${v.id}">
    ${v.photos[0] ? `<img src="${esc(v.photos[0].url)}" alt="${esc(v.titulo)}" loading="lazy">` : ''}
    <div><b>${esc(v.marca)} ${esc(v.modelo)}</b> <span class="muted">${esc(v.versao)}</span>
    <div class="muted">${esc(v.ano_fab || '')}/${esc(v.ano_modelo || '')} · ${km(v.km)}</div>
    <div class="price">${v.oferta_ativa ? `<s class="muted" style="font-size:.8em">${brl(v.preco)}</s> ` : ''}${brl(v.preco_anuncio || v.preco)}</div></div></a>`).join('');
  return shell(`${store.name} · Seminovos`, `<div style="display:flex;gap:12px;align-items:center">${logoTag(store, 52)}<h1>${esc(store.name)}</h1></div>
    <p class="muted">${esc([store.city, store.state].filter(Boolean).join(' - '))}</p>
    <div class="grid">${cards || '<p class="muted">Nenhum veículo disponível no momento.</p>'}</div>
    <div class="box" style="max-width:520px;margin-top:24px">${leadForm(store, null, 'vitrine')}</div>`);
}

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
