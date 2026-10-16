// Formulário de implantação (v2.13.3): link público para o dono da loja enviar dados da empresa, regras de atendimento,
// vendedores e documentos. As respostas são aplicadas na loja, nos contratos, no CRM e no assistente.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { get, all, run, logEvent } = require('./db');
const { hashPassword } = require('./crypto');

const str = (x, max = 300) => String(x ?? '').trim().slice(0, max);
const json = (s, d) => { try { return JSON.parse(s || ''); } catch { return d; } };
const httpError = (status, message) => Object.assign(new Error(message), { status });

function dados(storeId) { return json(get('SELECT onboarding FROM stores WHERE id = ?', storeId)?.onboarding, {}); }
function salvar(storeId, patch) {
  const d = { ...dados(storeId), ...patch };
  run('UPDATE stores SET onboarding = ? WHERE id = ?', JSON.stringify(d), storeId);
  return d;
}

/* ---------------- Situação do formulário (mostrada no guia Primeiros passos) ---------------- */
function resumo(storeId) {
  const ob = dados(storeId);
  return {
    url: ob.token ? `${config.publicUrl}/implantacao/${ob.token}` : '', enviado_em: ob.enviado_em || null, dados: ob.form || null,
    vendedores: ob.vendedores || [], docs: (ob.docs || []).map(({ tipo, nome, at }, i) => ({ i, tipo, nome, at })),
  };
}

function gerarLink(storeId) {
  const ob = dados(storeId);
  const token = ob.token || crypto.randomBytes(18).toString('hex');
  salvar(storeId, { token });
  return `${config.publicUrl}/implantacao/${token}`;
}

function lojaPorToken(t) {
  if (!/^[a-f0-9]{36}$/.test(String(t))) return null;
  return all(`SELECT * FROM stores WHERE onboarding LIKE ?`, `%${t}%`).find((s) => json(s.onboarding, {}).token === t) || null;
}

/* ---------------- Formulário público ---------------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function pagina(store) {
  const ob = dados(store.id);
  const f = ob.form || {};
  const ct = json(store.contrato_loja, {});
  const crm = json(store.crm_config, {});
  const v = (k, d = '') => esc(f[k] ?? d);
  const campo = (k, label, d = '', extra = '') => `<label>${label}<input name="${k}" value="${v(k, d)}" ${extra}></label>`;
  const area = (k, label, ph = '') => `<label>${label}<textarea name="${k}" rows="2" placeholder="${esc(ph)}">${v(k)}</textarea></label>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Implantação · ${esc(store.name)}</title>
<style>
:root{--bg:#eff1f4;--card:#fff;--ink:#161a21;--mut:#5b6370;--line:#d9dde4;--acc:#efa91c}
@media (prefers-color-scheme:dark){:root{--bg:#111318;--card:#1a1d24;--ink:#e8eaee;--mut:#9aa2ae;--line:#2b3039;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:20px 16px 60px}h1{font-size:26px;margin:0 0 4px}h2{font-size:17px;margin:0 0 10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-top:14px}
.g{display:grid;grid-template-columns:1fr 1fr;gap:10px}.g .w{grid-column:1/-1}
label{display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600;color:var(--mut)}
input,textarea,select{font:inherit;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:9px 10px;font-weight:400}
.muted{color:var(--mut);font-size:13px}button{font:inherit;font-weight:700;background:var(--acc);color:#1b1400;border:0;border-radius:10px;padding:13px 18px;cursor:pointer;width:100%;margin-top:16px}
.ok{background:#ddf2e5;color:#1d7f48;border-radius:10px;padding:12px;margin-top:14px}.er{color:#b0352a;margin-top:8px}
.vend{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:6px;margin-bottom:6px}.vend input{min-width:0;width:100%}.vend span{display:none}
@media(max-width:600px){.g{grid-template-columns:1fr}}
</style></head><body><div class="wrap">
<h1>${esc(store.name)} no GiroAuto</h1><p class="muted">Preencha o que souber: leva uns 5 minutos. Com isso deixamos o sistema da loja pronto (contratos, atendimento no site e no WhatsApp, equipe e integrações). Você pode voltar e completar depois por este mesmo link.</p>
${ob.enviado_em ? `<div class="ok">Recebemos seus dados em ${esc(new Date(ob.enviado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))}. Se quiser, corrija e envie de novo.</div>` : ''}
<form id="f" enctype="multipart/form-data">
<div class="card"><h2>1. Empresa (igual ao Cartão CNPJ)</h2><div class="g">
${campo('razao_social', 'Razão social', ct.razao_social, 'class="w"')}${campo('nome', 'Nome fantasia', store.name)}${campo('cnpj', 'CNPJ', ct.cnpj, 'inputmode="numeric"')}
<label class="w">Endereço completo<input name="endereco" value="${v('endereco', store.address)}"></label>${campo('cidade', 'Cidade', store.city)}${campo('uf', 'UF', store.state, 'maxlength="2"')}${campo('cep', 'CEP', store.postal_code, 'inputmode="numeric"')}
${campo('telefone', 'Telefone', store.phone, 'inputmode="tel"')}${campo('whatsapp', 'WhatsApp da loja', store.whatsapp, 'inputmode="tel"')}${campo('email', 'E-mail da empresa', '', 'type="email"')}${campo('site', 'Site (se tiver)')}
${campo('representante', 'Representante legal (quem assina)', ct.representante)}${campo('representante_cpf', 'CPF do representante', ct.representante_cpf, 'inputmode="numeric"')}${campo('foro', 'Comarca para contratos', ct.foro || store.city)}
</div></div>
<div class="card"><h2>2. Atendimento</h2><div class="g">
<label class="w">Horário de atendimento e visitas<input name="horarios" value="${v('horarios', crm.horarios || '')}" placeholder="Seg a sex 8h–18h; sáb 8h–12h"></label>
${area('troca', 'Aceitam carro na troca? Como avaliam?', 'Ex.: sim, avaliação presencial no mesmo dia')}${area('financiamento', 'Financiamento (bancos, entrada mínima)?', 'Ex.: Santander, BV e Itaú; entrada a partir de 20%')}
${area('garantia', 'Garantia oferecida', 'Ex.: 3 meses motor e câmbio, além dos 90 dias da lei')}${area('laudo', 'Laudo cautelar / vistoria', 'Ex.: todos os carros com laudo aprovado')}
${area('entrega', 'Entrega / atendimento em outras cidades')}${area('outras', 'Outras informações para o atendimento', 'Ex.: aceitamos cartão no sinal; não fazemos consignação de motos')}
</div></div>
<div class="card"><h2>3. Vendedores</h2><p class="muted">Cada um recebe um acesso ao GiroAuto.</p><div id="vs">${(ob.vendedores?.length ? ob.vendedores : [{}, {}]).map((x) => `<div class="vend"><input name="vend_nome" placeholder="Nome" value="${esc(x.nome || '')}"><input name="vend_email" type="email" placeholder="E-mail" value="${esc(x.email || '')}"><span></span></div>`).join('')}</div>
<button type="button" id="add" style="background:transparent;border:1px solid var(--line);color:var(--ink);width:auto;padding:8px 12px;margin-top:4px">+ vendedor</button></div>
<div class="card"><h2>4. Portais e redes</h2><div class="g">
${campo('portais', 'Portais que usam', '', 'class="w" placeholder="Webmotors, OLX, iCarros…"')}${campo('email_leads', 'E-mail que recebe os leads dos portais', '', 'type="email"')}
${campo('instagram', 'Instagram da loja (@)')}${campo('facebook', 'Página do Facebook (link ou nome)', '', 'class="w"')}
</div></div>
<div class="card"><h2>5. Arquivos</h2><div class="g">
<label>Logo (PNG/JPG)<input type="file" name="logo" accept="image/png,image/jpeg,image/webp"></label>
<label>Cartão CNPJ (PDF ou foto)<input type="file" name="cartao_cnpj" accept="application/pdf,image/jpeg,image/png"></label>
<label>Comprovante de endereço da empresa<input type="file" name="comprovante" accept="application/pdf,image/jpeg,image/png"></label>
<label>Contrato social (se tiver)<input type="file" name="contrato_social" accept="application/pdf,image/jpeg,image/png"></label>
</div><p class="muted">Os documentos ficam privados e servem só para a verificação da empresa na Meta (WhatsApp oficial).</p></div>
<button type="submit">Enviar</button><div class="er" id="er"></div>
</form></div>
<script>
document.getElementById('add').onclick=function(){var d=document.createElement('div');d.className='vend';d.innerHTML='<input name="vend_nome" placeholder="Nome"><input name="vend_email" type="email" placeholder="E-mail"><span></span>';document.getElementById('vs').appendChild(d);};
document.getElementById('f').onsubmit=function(e){e.preventDefault();var b=this.querySelector('button[type=submit]');b.disabled=true;b.textContent='Enviando…';
fetch(location.pathname.replace('/implantacao/','/api/public/implantacao/'),{method:'POST',body:new FormData(this)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Erro');return j;});})
.then(function(){document.querySelector('.wrap').innerHTML='<h1>Obrigado!</h1><div class="ok">Recebemos tudo. A equipe do GiroAuto vai concluir a configuração da loja e avisar você. Se precisar corrigir algo, abra este link de novo.</div>';})
.catch(function(err){b.disabled=false;b.textContent='Enviar';document.getElementById('er').textContent=err.message;});};
</script></body></html>`;
}

const IMG = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
const DOC = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };
const TIPOS_DOC = { cartao_cnpj: 'Cartão CNPJ', comprovante: 'Comprovante de endereço', contrato_social: 'Contrato social' };

async function receber(store, body, files = []) {
  const storage = require('./storage');
  const media = path.join(config.dataDir, 'media');
  const b = Object.fromEntries(Object.entries(body || {}).map(([k, v]) => [k, Array.isArray(v) ? v : str(v, 2000)]));
  const ob = dados(store.id);
  // Loja: preenche o que veio (sem apagar o que já existe).
  const up = { name: str(b.nome, 80), phone: str(b.telefone, 30), whatsapp: str(b.whatsapp, 30), address: str(b.endereco, 200), city: str(b.cidade, 80), state: str(b.uf, 2).toUpperCase(), postal_code: str(b.cep, 12) };
  const cols = Object.entries(up).filter(([, v]) => v);
  if (cols.length) run(`UPDATE stores SET ${cols.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`, ...cols.map(([, v]) => v), store.id);
  require('./contratos').saveLoja(store.id, {
    razao_social: b.razao_social || undefined, cnpj: b.cnpj || undefined, representante: b.representante || undefined, representante_cpf: b.representante_cpf || undefined,
    endereco: [b.endereco, b.cidade && `${b.cidade}/${b.uf || ''}`].filter(Boolean).join(', ') || undefined,
  }, b.foro);
  const CRM = require('./crm');
  if (b.horarios) CRM.saveConfig(store.id, { horarios: str(b.horarios, 300) });
  // Regras do assistente montadas com as respostas (só se a loja ainda não escreveu as próprias).
  const regras = [['troca', 'Troca'], ['financiamento', 'Financiamento'], ['garantia', 'Garantia'], ['laudo', 'Laudo/vistoria'], ['entrega', 'Entrega e outras cidades'], ['outras', 'Outras informações']]
    .filter(([k]) => b[k]).map(([k, l]) => `- ${l}: ${b[k]}`).join('\n');
  const BOT = require('./bot');
  if (regras && !BOT.botConfig(store.id).instrucoes) BOT.saveBotConfig(store.id, { instrucoes: regras });
  // Vendedores informados.
  const nomes = [].concat(body.vend_nome || []); const emails = [].concat(body.vend_email || []);
  const vendedores = nomes.map((nome, i) => ({ nome: str(nome, 80), email: str(emails[i], 120).toLowerCase() })).filter((v) => v.nome && /^\S+@\S+\.\S+$/.test(v.email)).slice(0, 30);
  // Arquivos: logo (público) e documentos (privados, doc-…).
  const docs = [...(ob.docs || [])];
  for (const f of files) {
    if (f.fieldname === 'logo' && IMG[f.mimetype]) {
      const name = crypto.randomBytes(16).toString('hex') + IMG[f.mimetype];
      fs.mkdirSync(media, { recursive: true }); fs.writeFileSync(path.join(media, name), f.buffer);
      await storage.saveMedia(name).catch(() => {});
      run('UPDATE stores SET logo_file = ? WHERE id = ?', name, store.id);
    } else if (TIPOS_DOC[f.fieldname] && DOC[f.mimetype]) {
      const name = `doc-${crypto.randomBytes(16).toString('hex')}${DOC[f.mimetype]}`;
      fs.mkdirSync(media, { recursive: true }); fs.writeFileSync(path.join(media, name), f.buffer);
      await storage.saveMedia(name).catch(() => {});
      const i = docs.findIndex((d) => d.tipo === f.fieldname);
      const novo = { tipo: f.fieldname, nome: TIPOS_DOC[f.fieldname], file: name, at: new Date().toISOString() };
      if (i >= 0) docs[i] = novo; else docs.push(novo);
    }
  }
  const form = Object.fromEntries(['razao_social', 'nome', 'cnpj', 'endereco', 'cidade', 'uf', 'cep', 'telefone', 'whatsapp', 'email', 'site', 'representante', 'representante_cpf', 'foro', 'horarios',
    'troca', 'financiamento', 'garantia', 'laudo', 'entrega', 'outras', 'portais', 'email_leads', 'instagram', 'facebook'].map((k) => [k, typeof b[k] === 'string' ? b[k] : '']));
  salvar(store.id, { form, vendedores, docs, enviado_em: new Date().toISOString() });
  logEvent(store.id, 'Formulário de implantação recebido do dono da loja');
}

// Cria os acessos dos vendedores informados no formulário, com senha provisória (mostrada uma vez ao administrador).
function criarVendedores(storeId) {
  const T = require('./team');
  const ob = dados(storeId);
  const criados = [];
  for (const v of ob.vendedores || []) {
    if (get('SELECT 1 FROM users WHERE email = ?', v.email)) continue;
    const senha = `giro-${crypto.randomBytes(4).toString('hex')}`;
    run(`INSERT INTO users (store_id, name, email, pass_hash, role, permissions, is_admin) VALUES (?, ?, ?, ?, 'vendedor', ?, 0)`, storeId, v.nome, v.email, hashPassword(senha), JSON.stringify(T.DEFAULT_SELLER));
    criados.push({ nome: v.nome, email: v.email, senha });
  }
  if (criados.length) logEvent(storeId, `${criados.length} vendedor(es) criados pela implantação`);
  return criados;
}

async function documento(storeId, i) {
  const d = (dados(storeId).docs || [])[Number(i)];
  if (!d) throw httpError(404, 'Documento não encontrado.');
  const file = await require('./storage').ensureLocal(d.file);
  if (!file) throw httpError(404, 'Arquivo não encontrado.');
  return { file, nome: `${d.tipo}${path.extname(file)}` };
}

module.exports = { resumo, gerarLink, lojaPorToken, pagina, receber, criarVendedores, documento, salvar };
