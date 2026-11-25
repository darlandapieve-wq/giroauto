/* Painel GiroAuto Repasse — JavaScript puro */
// a roda do mouse sobre um campo numérico não muda o valor (evita salvar número alterado sem querer)
document.addEventListener('wheel', (e) => { if (e.target.matches?.('input[type=number]') && document.activeElement === e.target) e.target.blur() }, { passive: true })
const $ = (s, el = document) => el.querySelector(s)
const $$ = (s, el = document) => [...el.querySelectorAll(s)]
async function api (url, body) {
  const r = await fetch(url.replace(/^\//, ''), body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (r.status === 401) { location.href = 'login'; throw new Error('login') }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || r.statusText)
  return r.json()
}
// aberto pelo menu do GiroAuto (giroauto.onrender.com/repasse/): link de volta para a Loja
if (location.pathname.startsWith('/repasse/')) document.querySelector('header .marca')?.insertAdjacentHTML('beforebegin', '<a href="/" class="pill" style="text-decoration:none" title="Voltar ao GiroAuto">← GiroAuto</a>')
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const moeda = (v) => v == null ? '—' : 'R$ ' + Math.round(v).toLocaleString('pt-BR')
const milhar = (v) => v == null ? '—' : Math.round(v).toLocaleString('pt-BR')
const quando = (ts) => ts ? new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const numero = (id) => (id || '').split('@')[0].replace(/^55(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3')
const sw = (on, attrs) => `<label class="switch"><input type="checkbox" ${on ? 'checked' : ''} ${attrs}><span></span></label>`

let E = null
let grupos = []
let contatos = []
let exemplos = []
let modeloEdit = []
let linhaSel = 0
const listas = { fila: { status: 'pendente' }, circulando: { status: 'circulando,enviado' } }
let abaAtual = 'painel'

// ---------- Abas ----------
function abrirAba (nome) {
  abaAtual = nome
  $$('#abas button').forEach(x => x.classList.toggle('ativa', x.dataset.aba === nome))
  $$('.aba').forEach(a => a.classList.toggle('ativa', a.id === nome))
  if (nome === 'fila' || nome === 'circulando') carregarLista(nome)
  if (nome === 'grupos') carregarGrupos()
  if (nome === 'contatos') carregarContatos()
  if (nome === 'clientes') { carregarClientes(); $('#badgeLeads').textContent = '' }
  if (nome === 'relatorios') carregarRelatorios()
  if (nome === 'modelo') previa()
  if (nome === 'repassadores') carregarRepassadores()
  history.replaceState(null, '', '#' + nome)
}
$$('#abas button').forEach(b => b.onclick = () => abrirAba(b.dataset.aba))

// ---------- Estado ----------
async function carregar () {
  E = await api('/api/estado')
  pintarConexao(); pintarResumo(); pintarLog(); pintarLote(E.lote); pintarSessao()
  if (!document.activeElement?.closest('#formParam')) preencherForm()
  if (!modeloEdit.length) { modeloEdit = structuredClone(E.config.modelo); pintarModelo() }
}

function pintarConexao () {
  const c = E.conexao
  const mapa = { conectado: ['ok', 'Conectado'], 'aguardando-qr': ['wait', 'Escanear QR'], conectando: ['wait', 'Conectando…'], 'aguardando-trava': ['wait', 'Aguardando servidor'], desligado: ['off', 'Desligado (manutenção)'], desconectado: ['off', 'Desconectado'] }
  const [cls, txt] = E.demo ? ['wait', 'Demonstração'] : (mapa[c.status] || ['off', c.status])
  $('#conexao').className = 'pill ' + cls; $('#conexao').textContent = txt
  $('#qrBox').innerHTML = c.qr ? `<img src="${c.qr}" alt="QR Code">`
    : `<p class="dica">${c.status === 'conectado' ? `✅ Conectado${c.eu?.nome ? ' como ' + esc(c.eu.nome) : ''}.${c.ultimoEvento ? ` Última mensagem recebida ${quando(c.ultimoEvento)}.` : ''}` : E.demo ? 'Modo demonstração: WhatsApp desligado.' : c.status === 'aguardando-trava' ? 'Outro servidor ainda está com o WhatsApp (atualização em andamento). Conecta sozinho quando ele liberar, sem QR.' : 'Aguardando QR…'}</p>`
  $('#btnPausar').textContent = E.envio.pausado ? 'Retomar' : 'Pausar'
  $('#btnSairLogin').hidden = !E.recursos.login
  $('#btnConectar').hidden = E.demo || ['conectado', 'conectando', 'aguardando-qr', 'aguardando-trava'].includes(c.status)
  $('#btnSair').hidden = E.demo || c.status !== 'conectado'
}

// ---------- Sessão / contas ----------
let avisouTroca = false
function pintarSessao () {
  const s = E.sessao
  $('#abaRepassadores').hidden = !s.dev
  $('#selConta').hidden = !s.dev
  $('#contaNome').hidden = s.dev
  $('#contaNome').textContent = E.conta?.nome || ''
  if (s.dev && !document.activeElement?.matches('#selConta')) {
    $('#selConta').innerHTML = (E.contas || []).map(c => `<option value="${c.id}" ${c.id === E.conta.id ? 'selected' : ''}>${c.id === E.conta.id ? 'Operando: ' : ''}${esc(c.nome)}${c.ativo ? '' : ' (bloqueada)'}</option>`).join('')
  }
  document.title = (s.dev && E.conta.id !== 1 ? `[${E.conta.nome}] ` : '') + 'GiroAuto Repasse'
  if (s.trocarSenha && !avisouTroca) { avisouTroca = true; abrirMinhaConta() }
}
$('#selConta').onchange = async (e) => { await api(`/api/dev/entrar/${e.target.value}`, {}); location.reload() }

function abrirMinhaConta () {
  const s = E.sessao
  $('#minhaContaInfo').textContent = s.dev ? `Desenvolvedor (administrador) · operando a conta "${E.conta.nome}". Sua senha é a ADMIN_SENHA configurada no Render.` : `${s.usuario} · ${E.conta.nome}`
  $('#trocaSenha').hidden = s.dev; $('#btnSalvarSenha').hidden = s.dev
  $('#avisoTrocar').hidden = !s.trocarSenha
  $('#formSenha').reset(); $('#senhaAviso').textContent = ''
  $('#dlgMinhaConta').showModal()
}
$('#btnMinhaConta').onclick = abrirMinhaConta
$('#formSenha').addEventListener('submit', async (ev) => {
  if (ev.submitter?.value !== 'salvar') return
  ev.preventDefault()
  const d = Object.fromEntries(new FormData(ev.target))
  try { await api('/api/minha-conta/senha', d); $('#dlgMinhaConta').close(); alert('Senha alterada.'); carregar() } catch (e) { $('#senhaAviso').textContent = e.message }
})

let repContas = []
async function carregarRepassadores () {
  const r = await api('/api/dev/contas')
  repContas = r.contas
  const soma = (k) => r.contas.reduce((t, c) => t + Number(c[k] || 0), 0)
  $('#repResumo').innerHTML = [['Repassadores', r.contas.length], ['Ativos', r.contas.filter(c => c.ativo).length], ['WhatsApp conectados', r.contas.filter(c => c.whatsapp === 'conectado').length],
    ['Em circulação', soma('circulacao')], ['Vendidos (30 dias)', soma('vendidos30')], ['Faturamento total', moeda(soma('faturamento'))], ['Servidor', `${r.servidor.memoriaMB} MB`]]
    .map(([n, v]) => `<div class="kpi"><b>${v}</b><span>${n}</span></div>`).join('')
  const wa = { conectado: ['verde', 'Conectado'], 'aguardando-qr': ['amarelo', 'Aguardando QR'], conectando: ['amarelo', 'Conectando'], 'aguardando-trava': ['amarelo', 'Aguardando trava'], desconectado: ['', 'Desconectado'], desligado: ['', 'Não conectado'] }
  $('#repTabela').innerHTML = `<tr><th>Repassador</th><th>WhatsApp</th><th class="num">Fila</th><th class="num">Circulação</th><th class="num">Recebidos 7d</th><th class="num">Envios 7d</th><th class="num">Vendidos</th><th class="num">Faturamento</th><th class="num">Lucro</th><th class="num">Clientes</th><th>Último acesso</th><th></th></tr>` +
    r.contas.map(c => {
      const [cls, txt] = wa[c.whatsapp] || ['', c.whatsapp]
      return `<tr class="${c.ativo ? '' : 'bloqueada'}" data-id="${c.id}">
      <td><b>${esc(c.nome)}</b>${c.id === E.conta.id ? ' <span class="tag verde">operando</span>' : ''}${c.ativo ? '' : ' <span class="tag">bloqueada</span>'}<small>${esc(c.login || '—')}${c.cidade ? ' · ' + esc(c.cidade) : ''}</small><small>Vitrine: <a href="${c.id === 1 ? 'vitrine' : 'v/' + esc(c.slug)}" target="_blank">${c.id === 1 ? '/vitrine' : '/v/' + esc(c.slug)}</a></small></td>
      <td><span class="tag ${cls}">${txt}</span>${c.numero ? `<small>${esc(numero(c.numero))}</small>` : ''}<small>${c.fontes || 0} fontes · ${c.destinos || 0} destinos</small></td>
      <td class="num">${c.pendentes || 0}</td><td class="num">${c.circulacao || 0}</td><td class="num">${c.recebidos7 || 0}</td>
      <td class="num">${c.envios7 || 0}${c.falhas7 ? `<small>${c.falhas7} falhas</small>` : ''}</td>
      <td class="num">${c.vendidos || 0}${c.vendidos30 ? `<small>${c.vendidos30} em 30d</small>` : ''}</td>
      <td class="num">${moeda(Number(c.faturamento || 0))}</td><td class="num">${moeda(Number(c.lucro || 0))}</td>
      <td class="num">${c.compradores || 0}${c.leads_novos ? `<small>${c.leads_novos} leads novos</small>` : ''}</td>
      <td>${quando(c.ultimo_login || c.ultimo_acesso)}<small>desde ${new Date(c.criado_em).toLocaleDateString('pt-BR')}</small></td>
      <td><div class="acoes">
        ${c.id === E.conta.id ? '' : `<button class="mini" data-acao="operar">Operar</button>`}
        <button class="mini sec" data-acao="editar">Editar</button>
        ${c.id === 1 ? '' : `<button class="mini sec" data-acao="senha">Nova senha</button><button class="mini ${c.ativo ? 'perigo' : 'sec'}" data-acao="ativo">${c.ativo ? 'Bloquear' : 'Reativar'}</button>`}
      </div></td></tr>`
    }).join('')
}
$('#repTabela').onclick = async (ev) => {
  const b = ev.target.closest('button[data-acao]'); if (!b) return
  const id = Number(b.closest('tr').dataset.id); const c = repContas.find(x => x.id === id)
  try {
    if (b.dataset.acao === 'operar') { await api(`/api/dev/entrar/${id}`, {}); location.hash = 'painel'; location.reload() }
    if (b.dataset.acao === 'editar') abrirConta(c)
    if (b.dataset.acao === 'senha' && confirm(`Gerar uma nova senha temporária para ${c.nome}? A senha atual deixa de valer.`)) mostrarAcesso(c.nome, await api(`/api/dev/contas/${id}/senha`, {}))
    if (b.dataset.acao === 'ativo' && confirm(c.ativo ? `Bloquear ${c.nome}? O acesso ao painel e o WhatsApp da conta são desligados.` : `Reativar ${c.nome}?`)) { await api(`/api/dev/contas/${id}`, { ativo: !c.ativo }); carregarRepassadores(); carregar() }
  } catch (e) { alert(e.message) }
}
function abrirConta (c = null) {
  const f = $('#formConta'); f.reset(); $('#contaAviso').textContent = ''
  $('#dlgContaTitulo').textContent = c ? 'Editar repassador' : 'Novo repassador'
  for (const k of ['id', 'nome', 'responsavel', 'email', 'telefone', 'cidade', 'obs']) f.elements[k].value = c ? (k === 'email' ? (c.login || c.email || '') : (c[k] ?? '')) : ''
  $('#dlgConta').showModal()
}
$('#btnNovaConta').onclick = () => abrirConta()
$('#formConta').addEventListener('submit', async (ev) => {
  if (ev.submitter?.value !== 'salvar') return
  ev.preventDefault()
  const d = Object.fromEntries(new FormData(ev.target))
  try {
    if (d.id) { await api(`/api/dev/contas/${d.id}`, d); $('#dlgConta').close() }
    else { const r = await api('/api/dev/contas', d); $('#dlgConta').close(); mostrarAcesso(d.nome, r) }
    carregarRepassadores(); carregar()
  } catch (e) { $('#contaAviso').textContent = e.message }
})
function mostrarAcesso (nome, r) {
  $('#acessoTexto').textContent = `GiroAuto Repasse — ${nome}\nEndereço: ${location.origin}/login\nE-mail: ${r.email}\nSenha temporária: ${r.senha}\n\nNo primeiro acesso, crie sua senha e conecte o seu WhatsApp na aba Painel.`
  $('#dlgAcesso').showModal()
}
$('#btnCopiarAcesso').onclick = async () => { try { await navigator.clipboard.writeText($('#acessoTexto').textContent); $('#btnCopiarAcesso').textContent = 'Copiado ✓' } catch { alert('Selecione o texto e copie.') } }

function pintarResumo () {
  const k = E.contagem
  const itens = [['Pendentes', k.pendente], ['Aguardando envio', k.aprovado], ['Em circulação', k.circulando], ['Enviados', k.enviado], ['Vendidos', k.vendido], ['Encerrados', k.encerrado], ['Fontes / Destinos', `${E.grupos.fontes} / ${E.grupos.destinos}`]]
  $('#kpis').innerHTML = itens.map(([n, v]) => `<div class="kpi"><b>${v ?? 0}</b><span>${n}</span></div>`).join('')
  $('#badgeFila').textContent = k.pendente || ''
  const r = E.recursos
  $('#recursos').innerHTML = [
    `<span class="tag ${r.ia ? 'verde' : 'amarelo'}">IA ${r.ia ? 'ativa' : 'sem chave'}</span>`,
    `<span class="tag ${r.placa ? 'verde' : ''}">FIPE por placa ${r.placa ? 'ativa' : 'não configurada'}</span>`,
    `<span class="tag">Banco: ${esc(r.banco)}</span>`
  ].join('')
  const e = E.config.envio
  const prox = E.envio.proximoEm > Date.now() ? ` Próximo envio liberado às ${new Date(E.envio.proximoEm).toLocaleTimeString('pt-BR')}.` : ''
  $('#proximoEnvio').textContent = `Modo ${e.modo === 'automatico' ? 'automático' : 'com aprovação'} · ${e.horarioInicio}–${e.horarioFim} · até ${e.limitePorHora} anúncios/h · repetição a cada ${E.config.repeticao.intervaloHoras} h.${prox}`
  $('#assisIA').textContent = r.ia ? '' : '(Sem a chave da IA ela segue um roteiro simples: pega nome e WhatsApp, manda fotos e chama você.)'
  $('#iaStatus').textContent = r.ia ? 'Chave da IA configurada no servidor.' : 'Sem ANTHROPIC_API_KEY no servidor: a IA fica desligada até a chave ser configurada.'
  $('#fipeStatus').textContent = r.placa ? 'Consulta por placa configurada; por modelo/ano sempre disponível.' : 'Consulta por modelo/ano ativa. Para consultar pela placa, configure um provedor (PLACA_API_URL).'
}

function pintarLog () {
  $('#log').innerHTML = E.log.map(l => `<li class="${l.tipo}"><time>${new Date(l.ts).toLocaleTimeString('pt-BR')}</time>${esc(l.texto)}</li>`).join('') || '<li class="dica">Sem atividade ainda.</li>'
}

// ---------- Fila e Em circulação ----------
const ACOES = {
  pendente: [['aprovado', 'Aprovar'], ['descartado', 'Descartar']],
  aprovado: [['pendente', 'Voltar p/ pendente'], ['descartado', 'Descartar']],
  filtrado: [['aprovado', 'Aprovar mesmo assim'], ['descartado', 'Descartar']],
  descartado: [['pendente', 'Recuperar'], ['excluir', 'Excluir']],
  erro: [['aprovado', 'Tentar de novo'], ['descartado', 'Descartar']],
  circulando: [['enviarAgora', 'Enviar agora'], ['vendido', '✓ Vendido'], ['encerrado', 'Encerrar']],
  enviado: [['enviarAgora', 'Reenviar'], ['vendido', '✓ Vendido'], ['encerrado', 'Encerrar']],
  encerrado: [['pendente', 'Reativar'], ['vendido', '✓ Vendido'], ['excluir', 'Excluir']],
  vendido: [['editarVenda', 'Editar venda'], ['pendente', 'Desfazer venda'], ['excluir', 'Excluir']]
}
const ETIQUETAS = {
  pendente: ['Pendente', 'amarelo'], aprovado: ['Aguardando envio', ''], circulando: ['🔁 Repetindo', 'verde'],
  enviado: ['Enviado', ''], encerrado: ['Encerrado', 'cinza-solido'], vendido: ['✓ Vendido', 'verde'],
  filtrado: ['Filtrado', 'amarelo'], descartado: ['Descartado', 'cinza-solido'], erro: ['Erro', 'amarelo']
}
const codigoDe = (a) => a.codigo || ('F-' + String(a.numeroFila || 0).padStart(4, '0'))
function cartao (a) {
  const d = a.dados
  const fipe = a.fipe || d.fipeConsulta?.valor
  const capa = a.fotos.find(f => f.capa) || a.fotos[0]
  const pct = fipe && a.precoRepasse ? Math.round(100 * a.precoRepasse / fipe) : null
  const margem = fipe && a.precoOriginal ? fipe - a.precoOriginal : null
  const fonteFipe = d.fipe ? 'informada' : d.fipeConsulta ? `consultada · ${d.fipeConsulta.confianca}` : ''
  const contatoOrig = d.telefones?.length ? d.telefones.map(t => numero('55' + t.replace(/^55/, ''))).join(', ') : numero(a.origem.remetenteId)
  const destinos = a.destinos.length
    ? a.destinos.map(x => `<span class="tag ${x.recusa ? 'cinza' : 'verde'}" title="${esc(x.recusa || 'recebe')}">${esc(x.nome)}</span>`).join('')
    : '<span class="sub">nenhum destino</span>'
  const acoes = (ACOES[a.status] || []).map(([s, n]) => `<button data-acao="${s}" class="mini ${s === 'descartado' || s === 'encerrado' || s === 'excluir' ? 'perigo' : s === 'aprovado' || s === 'enviarAgora' || s === 'vendido' ? '' : 'sec'}">${n}</button>`).join('')
  const et = ETIQUETAS[a.status]
  const v = a.venda
  return `<div class="item" data-id="${a.id}">
    <div class="topo"><input type="checkbox" class="sel" data-sel="${a.id}" title="Selecionar"><b class="cod" title="${a.codigo ? 'Código do anúncio aprovado' : 'Número na fila de análise (o código GA é gerado ao aprovar)'}">${esc(codigoDe(a))}</b>${et ? `<span class="tag ${et[1]} etiqueta">${et[0]}</span>` : ''}</div>
    <div class="titulo">${esc([d.marca, d.modelo, d.ano].filter(Boolean).join(' ') || '—')} ${d.categoria ? `<span class="tag">${esc(E.categorias[d.categoria] || d.categoria)}</span>` : ''}${d.premium ? '<span class="tag amarelo">premium</span>' : ''}${d.usouIA ? '<span class="tag">IA</span>' : ''}</div>
    <div class="sub">${esc(a.origem.grupoNome || 'Simulador')} · ${quando(a.criadoEm)}${a.vezesRecebido > 1 ? ` · ${a.vezesRecebido}×` : ''}</div>
    ${capa ? `<img class="capa" src="fotos/${capa.id}${capa.placa_status === 'borrada' ? '?publico=1' : ''}" loading="lazy" alt="">` : '<div class="capa sem-foto">sem foto</div>'}
    ${capa?.placa_status === 'borrada' ? `<div class="sub">🔒 Placa borrada · <a href="fotos/${capa.id}" target="_blank">ver original</a></div>` : capa?.placa_status === 'sem-placa' ? '<div class="sub">🔒 Nenhuma placa visível na capa</div>' : capa && E.recursos.ia && E.config.edicao.borrarPlaca !== false ? '<div class="sub">⏳ Verificando placa…</div>' : ''}
    ${a.fotos.length > 1 ? `<div class="miniaturas" title="Toque para escolher a foto enviada">${a.fotos.map(f => `<img src="fotos/${f.id}" data-capa="${f.id}" class="${f.id === capa?.id ? 'capa-sel' : ''}" loading="lazy">`).join('')}</div>` : ''}
    <div class="precos">
      <label>Repasse R$<input type="number" step="100" data-preco value="${a.precoRepasse ?? ''}"></label>
      <div class="info">Pedido <b>${moeda(a.precoOriginal)}</b><br>FIPE <b title="${esc(d.fipeConsulta?.modeloFipe || fonteFipe)}">${moeda(fipe)}</b>${pct ? ` · ${pct}%` : ''}${margem != null ? `<br>Margem <b class="${margem > 0 ? 'margem-pos' : 'margem-neg'}">${moeda(margem)}${fipe ? ` (${Math.round(100 * margem / fipe)}%)` : ''}</b>` : ''}</div>
    </div>
    ${v ? `<div class="venda">✓ Vendido ${v.valor ? 'por <b>' + moeda(v.valor) + '</b>' : ''}${v.data ? ' em ' + new Date(v.data).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : ''}${v.comprador ? `<br>👤 ${esc(v.comprador.nome)} · ${esc(numero('55' + v.comprador.telefone))}${v.comprador.cidade ? ' · ' + esc(v.comprador.cidade) : ''}` : ''}${v.valor && a.precoOriginal ? `<br>Lucro estimado: <b class="${v.valor - a.precoOriginal >= 0 ? 'margem-pos' : 'margem-neg'}">${moeda(v.valor - a.precoOriginal)}</b>` : ''}</div>` : ''}
    ${a.motivos?.length ? `<p class="motivo">⚠ ${a.motivos.map(esc).join(' · ')}</p>` : ''}
    ${d.alertas?.length ? `<p class="motivo">Atenção: ${d.alertas.map(esc).join(', ')}</p>` : ''}
    ${a.nota ? `<div class="nota">${esc(a.nota)}</div>` : ''}
    ${a.excluiEm ? `<div class="sub" title="Arquivados ficam ${E.config.limpeza.excluirArquivadosHoras} h e depois são excluídos com as fotos. Vendidos não são excluídos.">🗑 Excluído automaticamente em ${quando(a.excluiEm)}</div>` : ''}
    <textarea data-texto>${esc(a.texto)}</textarea>
    ${a.textoEditado ? '<div class="sub">✎ texto editado à mão (o Modelo não altera; use "Refazer")</div>' : ''}
    <div class="repetir">${sw(a.repetir, 'data-repetir')}<span>Repetir a cada</span><input type="number" min="1" step="0.5" data-horas value="${a.repetirHoras ?? E.config.repeticao.intervaloHoras}"><span>h</span></div>
    <div class="repetir">${sw(a.reducaoAtiva, 'data-reducao')}<span>Baixar</span><input type="number" min="0" step="100" data-passo value="${a.reducaoPasso ?? E.config.reducaoPreco.passo}"><span>até</span><input type="number" min="0" step="100" data-piso value="${a.reducaoPiso ?? ''}" placeholder="piso"></div>
    ${a.vezesEnviado ? `<div class="sub">Enviado ${a.vezesEnviado}× · último ${quando(a.ultimoEnvio)}${a.proximoEnvio ? ` · próximo ${quando(a.proximoEnvio)}` : ''}</div>` : ''}
    <div class="sub">Vai para: ${destinos}</div>
    <div class="sub">Origem: ${a.origem.remetenteNome ? `👤 ${esc(a.origem.remetenteNome)} ` : ''}${esc(contatoOrig || '')}${/@lid$/.test(a.origem.remetenteId || '') && !d.telefones?.length ? ' <span title="O WhatsApp oculta o número deste participante">(número oculto)</span>' : ''}${d.placa ? ` · placa ${esc(d.placa)}` : ''}</div>
    ${d.observacoes?.length ? `<details><summary>Notas da IA (${d.observacoes.length})</summary><ul>${d.observacoes.map(o => `<li>${esc(o)}</li>`).join('')}</ul></details>` : ''}
    <details><summary>Texto original</summary><pre>${esc(d.textoOriginal)}</pre></details>
    ${a.codigo ? `<details class="info-extra" ${a.infoExtra ? '' : ''}><summary>Informações para a assistente${a.infoExtra ? ' ✓' : ''}</summary><textarea data-info placeholder="Ex.: pneus novos, revisão feita, aceita proposta à vista, documento em dia… (você também pode mandar ${esc(a.codigo)} + texto/fotos no WhatsApp)">${esc(a.infoExtra || '')}</textarea></details>` : ''}
    ${a.envios.length ? `<details><summary>Envios (${a.envios.length})</summary><pre>${a.envios.map(e => `${quando(e.ts)} · ${e.grupo_nome} · ${e.ok ? '✓' : '✗ ' + e.erro} · ${moeda(e.preco)} · ${e.rodada}ª`).map(esc).join('\n')}</pre></details>` : ''}
    <div class="acoes"><button data-acao="salvar" class="sec mini">Salvar</button><button data-acao="regerar" class="sec mini" title="Gerar de novo pelo modelo atual">Refazer</button>${acoes}</div>
  </div>`
}

// ---- filtros (menu lateral, um para cada lista) ----
const ORDENS = [['', 'Padrão'], ['recebidoDesc', 'Recebidos mais recentes'], ['recebidoAsc', 'Recebidos mais antigos'], ['publicadoDesc', 'Publicados mais recentes', 'circulando'], ['publicadoAsc', 'Publicados mais antigos', 'circulando'], ['margem', 'Maior margem (R$)'], ['margemPct', 'Maior margem (%)'], ['menorPreco', 'Menor preço'], ['maiorPreco', 'Maior preço'], ['anoDesc', 'Ano mais novo'], ['kmAsc', 'Menor km']]
function montarFiltros (qual) {
  const el = $(`[data-filtros="${qual}"]`)
  el.innerHTML = `<details class="filtros-box" ${innerWidth > 900 ? 'open' : ''}><summary>Filtros <span class="sub" data-fcont></span></summary>
    <label class="campo">Buscar<input data-f="busca" placeholder="Código, modelo, anunciante…"></label>
    <label class="campo">Grupo / contato<select data-f="grupo"><option value="">Todos</option></select></label>
    <label class="campo">Marca<select data-f="marca"><option value="">Todas</option></select></label>
    <label class="campo">Modelo<select data-f="modelo"><option value="">Todos</option></select></label>
    <div class="campo">Categoria<div class="chips-cat" data-f-cat></div></div>
    <label class="chk"><input type="checkbox" data-f="premium"> Só premium</label>
    <div class="duplo"><label class="campo">Ano de<input type="number" data-f="anoMin" placeholder="2015"></label><label class="campo">até<input type="number" data-f="anoMax" placeholder="2025"></label></div>
    <label class="campo">Entrou de<input type="date" data-f="desde"></label>
    <label class="campo">até<input type="date" data-f="ate"></label>
    <button class="sec mini" data-hoje>Só de hoje</button>
    <div class="duplo"><label class="campo">Margem mín. R$<input type="number" step="1000" data-f="margemMin" placeholder="10000"></label><label class="campo">ou %<input type="number" data-f="margemPctMin" placeholder="15"></label></div>
    <label class="campo">Repasse até R$<input type="number" step="5000" data-f="precoMax" placeholder="80000"></label>
    <label class="campo">Ordenar<select data-f="ordem">${ORDENS.filter(o => !o[2] || o[2] === qual).map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></label>
    <button class="sec mini" data-margem>↓ Organizar pela margem</button>
    <button class="sec mini" data-limpar>Limpar filtros</button>
  </details>`
  let t
  const recarregar = () => { clearTimeout(t); t = setTimeout(() => carregarLista(qual), 250) }
  el.addEventListener('input', (e) => {
    if (e.target.matches('[data-f="marca"]')) { $('[data-f="modelo"]', el).value = ''; pintarModelos(qual) }
    recarregar()
  })
  el.addEventListener('click', (e) => {
    if (e.target.matches('[data-hoje]')) { const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()); $('[data-f="desde"]', el).value = d; $('[data-f="ate"]', el).value = d; carregarLista(qual) }
    if (e.target.matches('[data-margem]')) { $('[data-f="ordem"]', el).value = 'margem'; carregarLista(qual) }
    if (e.target.matches('[data-limpar]')) { $$('[data-f]', el).forEach(i => { if (i.type === 'checkbox') i.checked = false; else i.value = '' }); $$('[data-f-cat] input', el).forEach(i => { i.checked = false }); carregarLista(qual) }
  })
}
const facetas = {}
function pintarModelos (qual) {
  const el = $(`[data-filtros="${qual}"]`); const f = facetas[qual]; if (!f) return
  const marca = $('[data-f="marca"]', el).value; const sel = $('[data-f="modelo"]', el); const atual = sel.value
  const ms = f.modelos.filter(m => !marca || m.marca === marca)
  sel.innerHTML = '<option value="">Todos</option>' + ms.map(m => `<option value="${esc(m.nome)}">${esc(m.nome)}${marca ? '' : ` (${esc(m.marca)})`} · ${m.n}</option>`).join('')
  sel.value = ms.some(m => m.nome === atual) ? atual : ''
}
async function carregarFacetas (qual) {
  const el = $(`[data-filtros="${qual}"]`)
  const f = facetas[qual] = await api('/api/anuncios/facetas?status=' + listas[qual].status).catch(() => null)
  if (!f) return
  const preencher = (sel, opcoes, rotulo) => { const atual = sel.value; sel.innerHTML = `<option value="">${rotulo}</option>` + opcoes; sel.value = atual; if (sel.value !== atual && atual) sel.insertAdjacentHTML('beforeend', `<option value="${esc(atual)}" selected>${esc(atual)} (0)</option>`) }
  preencher($('[data-f="grupo"]', el), f.grupos.map(o => `<option value="${esc(o.jid)}">${o.tipo === 'contato' ? '👤 ' : ''}${esc(o.nome)} (${o.n})</option>`).join(''), 'Todos')
  preencher($('[data-f="marca"]', el), f.marcas.map(o => `<option value="${esc(o.nome)}">${esc(o.nome)} (${o.n})</option>`).join(''), 'Todas')
  pintarModelos(qual)
  const cat = $('[data-f-cat]', el); const marcadas = new Set($$('input:checked', cat).map(i => i.value))
  cat.innerHTML = Object.entries(E.categorias).map(([k, nome]) => { const n = f.categorias.find(c => c.id === k)?.n || 0; return `<label class="chip ${n ? '' : 'vazio-chip'}"><input type="checkbox" value="${k}" ${marcadas.has(k) ? 'checked' : ''}>${esc(nome)} <small>${n}</small></label>` }).join('')
  if (f.anos?.min) { $('[data-f="anoMin"]', el).placeholder = f.anos.min; $('[data-f="anoMax"]', el).placeholder = f.anos.max }
}
function paramsFiltros (qual) {
  const el = $(`[data-filtros="${qual}"]`); const p = new URLSearchParams()
  let n = 0
  $$('[data-f]', el).forEach(i => { const v = i.type === 'checkbox' ? (i.checked ? '1' : '') : i.value.trim(); if (v) { p.set(i.dataset.f, v); if (i.dataset.f !== 'ordem') n++ } })
  const cats = $$('[data-f-cat] input:checked', el).map(i => i.value)
  if (cats.length) { p.set('categoria', cats.join(',')); n++ }
  $('[data-fcont]', el).textContent = n ? `(${n} ativo${n > 1 ? 's' : ''})` : ''
  return p
}

async function carregarLista (qual) {
  const L = listas[qual]
  const alvo = qual === 'fila' ? '#listaFila' : '#listaCirculando'
  const p = paramsFiltros(qual); p.set('status', L.status)
  const itens = await api('/api/anuncios?' + p.toString())
  $(alvo).innerHTML = itens.map(cartao).join('') || '<div class="vazio">Nada aqui com esses filtros.</div>'
  const sel = $(`[data-selecao="${qual}"]`)
  $('[data-sel-todos]', sel).checked = false
  $('[data-total]', sel).textContent = `${itens.length} anúncio(s)`
  contarSel(qual)
  carregarFacetas(qual)
}

$$('.seg[data-lista]').forEach(seg => seg.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-s]'); if (!b) return
  listas[seg.dataset.lista].status = b.dataset.s
  $$('button', seg).forEach(x => x.classList.toggle('ativa', x === b))
  carregarLista(seg.dataset.lista)
}))

// Foto ampliada: clicar na foto do anúncio abre por cima da página (sem nova aba); clicar ou Esc fecha
function ampliarFoto (src) {
  let d = $('#dlgFoto')
  if (!d) {
    d = document.createElement('dialog'); d.id = 'dlgFoto'; d.className = 'dlg-foto'
    d.innerHTML = '<img alt="Foto ampliada"><button type="button" class="fechar-foto" aria-label="Fechar">✕</button>'
    d.addEventListener('click', () => d.close())
    document.body.appendChild(d)
  }
  $('img', d).src = src
  d.showModal()
}

async function aoClicarCartao (e) {
  const card = e.target.closest('.item'); if (!card) return
  if (e.target.matches('img.capa')) return ampliarFoto(e.target.src)
  const id = card.dataset.id
  const capa = e.target.dataset.capa
  if (capa) { await api('/api/anuncios/' + id, { capa }); return recarregarCartao(card) }
  const acao = e.target.dataset.acao; if (!acao) return
  const corpo = {
    texto: $('[data-texto]', card).value,
    precoRepasse: $('[data-preco]', card).value === '' ? null : Number($('[data-preco]', card).value),
    repetir: $('[data-repetir]', card).checked,
    repetirHoras: Number($('[data-horas]', card).value) || null,
    reducaoAtiva: $('[data-reducao]', card).checked,
    reducaoPasso: $('[data-passo]', card).value,
    reducaoPiso: $('[data-piso]', card).value,
    ...($('[data-info]', card) ? { infoExtra: $('[data-info]', card).value } : {})
  }
  if (acao === 'vendido' || acao === 'editarVenda') return abrirVenda(card)
  if (acao === 'excluir') {
    if (!confirm('Excluir definitivamente este anúncio, com fotos' + (card.querySelector('.etiqueta')?.textContent.includes('Vendido') ? ' e dados da venda (o comprador continua no cadastro)' : '') + '? Não dá para desfazer.')) return
    try { await api(`/api/anuncios/${id}/excluir`, {}); card.remove(); carregar() } catch (err) { alert(err.message) }
    return
  }
  e.target.disabled = true
  try {
    if (acao === 'salvar') await api('/api/anuncios/' + id, corpo)
    else if (acao === 'regerar') await api('/api/anuncios/' + id, { ...corpo, texto: undefined, regerar: true })
    else if (acao === 'enviarAgora') await api('/api/anuncios/' + id, { ...corpo, enviarAgora: true })
    else {
      if (acao === 'encerrado' && !confirm('Encerrar este anúncio? Ele para de ser retransmitido (sem marcar como vendido).')) { e.target.disabled = false; return }
      if (acao === 'pendente' && card.closest('#listaCirculando') && !confirm('Voltar este anúncio para a fila?')) { e.target.disabled = false; return }
      await api('/api/anuncios/' + id, { ...corpo, status: acao })
      card.remove(); carregar(); return
    }
    await recarregarCartao(card)
  } catch (err) { alert(err.message); e.target.disabled = false }
}
async function recarregarCartao (card) {
  const r = await api('/api/anuncios/' + card.dataset.id, {})
  const sel = $('.sel', card)?.checked
  card.outerHTML = cartao(r)
  if (sel) { const n = $(`.item[data-id="${r.id}"] .sel`); if (n) n.checked = true }
}
async function aoMudarCartao (e) {
  const card = e.target.closest('.item'); if (!card) return
  if (e.target.matches('.sel')) return contarSel(card.closest('#listaFila') ? 'fila' : 'circulando')
  if (e.target.matches('[data-repetir],[data-horas],[data-reducao],[data-passo],[data-piso]')) {
    await api('/api/anuncios/' + card.dataset.id, {
      repetir: $('[data-repetir]', card).checked,
      repetirHoras: Number($('[data-horas]', card).value) || null,
      reducaoAtiva: $('[data-reducao]', card).checked,
      reducaoPasso: $('[data-passo]', card).value,
      reducaoPiso: $('[data-piso]', card).value
    })
    return
  }
  if (!e.target.matches('[data-preco]')) return
  const r = await api('/api/anuncios/' + card.dataset.id, { precoRepasse: Number(e.target.value) })
  $('[data-texto]', card).value = r.texto
}
;['#listaFila', '#listaCirculando'].forEach(s => { $(s).addEventListener('click', aoClicarCartao); $(s).addEventListener('change', aoMudarCartao) })

// ---- seleção e ações em massa ----
function contarSel (qual) {
  const lista = qual === 'fila' ? '#listaFila' : '#listaCirculando'
  $(`[data-selecao="${qual}"] [data-nsel]`).textContent = `${$$(lista + ' .sel:checked').length} de ${$$(lista + ' .sel').length} selecionados`
}
$$('[data-selecao]').forEach(box => {
  const qual = box.dataset.selecao; const lista = qual === 'fila' ? '#listaFila' : '#listaCirculando'
  $('[data-sel-todos]', box).onchange = (e) => { $$(lista + ' .sel').forEach(c => { c.checked = e.target.checked }); contarSel(qual) }
  $$('[data-lote]', box).forEach(b => b.onclick = async () => {
    const ids = $$(lista + ' .sel:checked').map(c => c.dataset.sel)
    if (!ids.length) return alert('Selecione ao menos um anúncio.')
    const nome = { aprovado: 'Aprovar', descartado: 'Remover da fila', pendente: 'Voltar para a fila / recuperar', encerrado: 'Encerrar' }[b.dataset.lote]
    if (!confirm(`${nome}: ${ids.length} anúncio(s)?`)) return
    const r = await api('/api/anuncios/lote', { ids, acao: b.dataset.lote })
    alert(`${r.alterados} anúncio(s) alterado(s).`); carregarLista(qual); carregar()
  })
})
$('#btnDedup').onclick = async () => { const r = await api('/api/anuncios/deduplicar', {}); alert(`${r.removidos} repetido(s) removido(s) da fila.`); carregarLista('fila'); carregar() }
$('#btnAprovarTodos').onclick = async () => {
  if (!confirm('Aprovar todos os pendentes?')) return
  const r = await api('/api/anuncios/aprovar-todos', {}); alert(`${r.aprovados} aprovados.`); carregarLista('fila'); carregar()
}
montarFiltros('fila'); montarFiltros('circulando')

// ---- venda: cadastro do comprador ----
let vendaId = null
function abrirVenda (card) {
  vendaId = card.dataset.id
  const f = $('#formVenda'); f.reset()
  const preco = $('[data-preco]', card).value
  const cod = $('.cod', card).textContent; const tit = $('.titulo', card).childNodes[0].textContent.trim()
  $('#vendaTitulo').textContent = `Venda · ${cod} · ${tit}`
  f.valor.value = preco || ''
  f.data.value = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
  $('#vendaAviso').textContent = ''
  // edição: preenche com a venda já registrada
  api('/api/anuncios/' + vendaId, {}).then(a => {
    if (!a.venda) return
    f.valor.value = a.venda.valor || f.valor.value
    if (a.venda.data) f.data.value = String(a.venda.data).slice(0, 10)
    f.pagamento.value = a.venda.pagamento || ''
    f.obs.value = a.venda.obs || ''
    const c = a.venda.comprador; if (c) preencherComprador(c)
  })
  $('#dlgVenda').showModal()
}
function preencherComprador (c) {
  const f = $('#formVenda')
  f.cid.value = c.id || ''; f.nome.value = c.nome || ''; f.telefone.value = c.telefone || ''; f.documento.value = c.documento || ''
  f.cidade.value = c.cidade || ''; f.uf.value = c.uf || ''; f.tipo.value = c.tipo || 'lojista'; f.email.value = c.email || ''; f.cobs.value = c.obs || ''
}
$('#formVenda').telefone.addEventListener('change', async (e) => {
  const r = await api('/api/compradores/buscar?tel=' + encodeURIComponent(e.target.value)).catch(() => [])
  if (r.length && !$('#formVenda').cid.value) { preencherComprador(r[0]); $('#vendaAviso').textContent = `Comprador já cadastrado: ${r[0].nome}. Dados preenchidos.` }
})
$('#formVenda').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'salvar') return
  e.preventDefault()
  const f = e.target
  const corpo = {
    valor: f.valor.value, data: f.data.value, pagamento: f.pagamento.value, obs: f.obs.value,
    comprador: { id: f.cid.value || undefined, nome: f.nome.value, telefone: f.telefone.value, documento: f.documento.value, cidade: f.cidade.value, uf: f.uf.value, tipo: f.tipo.value, email: f.email.value, obs: f.cobs.value }
  }
  try {
    await api(`/api/anuncios/${vendaId}/vender`, corpo)
    $('#dlgVenda').close()
    const card = $(`.item[data-id="${vendaId}"]`)
    if (card && card.closest('#listaCirculando') && !listas.circulando.status.includes('vendido')) card.remove(); else if (card) recarregarCartao(card)
    carregar()
  } catch (err) { $('#vendaAviso').textContent = err.message }
})

// ---------- Clientes: compradores e interessados ----------
let vistaClientes = 'compradores'
const TIPOS = { lojista: 'Lojista', repassador: 'Repassador', particular: 'Particular' }
const LEAD_ST = { novo: 'Novo', contato: 'Em contato', negociando: 'Negociando', ganho: 'Comprou', perdido: 'Perdido' }
const waLink = (tel, txt = '') => tel ? `https://wa.me/55${String(tel).replace(/\D/g, '').replace(/^55/, '')}${txt ? '?text=' + encodeURIComponent(txt) : ''}` : '#'
let compradoresCache = []
async function carregarClientes () {
  const busca = $('#buscaClientes').value.trim()
  $('#btnNovoComprador').hidden = vistaClientes !== 'compradores'
  if (vistaClientes === 'compradores') {
    $('#dicaClientes').textContent = 'Cadastro formado pelas vendas: quem comprou, quanto pagou e quando. O assistente de WhatsApp vai usar esta base quando o número da operação for conectado.'
    const cs = compradoresCache = await api('/api/compradores?busca=' + encodeURIComponent(busca))
    $('#listaClientes').innerHTML = cs.length ? `<table class="tabela"><thead><tr><th>Comprador</th><th>WhatsApp</th><th>Cidade</th><th>Tipo</th><th>Compras</th><th>Total pago</th><th>Lucro</th><th>Última</th><th>Veículos</th><th></th></tr></thead><tbody>
      ${cs.map(c => `<tr><td><b>${esc(c.nome)}</b>${c.documento ? `<div class="sub">${esc(c.documento)}</div>` : ''}</td>
        <td><a href="${waLink(c.telefone)}" target="_blank">${esc(numero('55' + c.telefone))}</a></td>
        <td>${esc([c.cidade, c.uf].filter(Boolean).join('-'))}</td><td>${esc(TIPOS[c.tipo] || c.tipo || '')}</td>
        <td>${c.compras}</td><td>${moeda(Number(c.total))}</td><td class="${Number(c.lucro) >= 0 ? 'margem-pos' : 'margem-neg'}">${c.compras ? moeda(Number(c.lucro)) : '—'}</td>
        <td>${c.ultima_compra ? new Date(c.ultima_compra).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—'}</td>
        <td class="sub">${c.veiculos.map(v => `${esc(v.codigo || '')} ${esc(v.titulo)} · ${moeda(v.valor)}`).join('<br>')}</td>
        <td><button class="sec mini" data-editar-comp="${c.id}">Editar</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="vazio">Nenhum comprador ainda. Eles entram aqui quando você marca um anúncio como ✓ Vendido.</div>'
  } else if (vistaClientes === 'conversas') {
    $('#dicaClientes').textContent = 'Conversas atendidas pela assistente na vitrine e no WhatsApp. 🙋 = o cliente quer falar com você. Pausar deixa a assistente quieta naquela conversa do WhatsApp.'
    let cs = await api('/api/conversas')
    if (busca) cs = cs.filter(c => [c.nome, c.telefone, c.contato, c.codigo, c.ultima].join(' ').toLowerCase().includes(busca.toLowerCase()))
    const pend = cs.filter(c => c.precisa_humano).length
    $('#nConversas').textContent = pend ? `(${pend} 🙋)` : ''
    $('#listaClientes').innerHTML = cs.length ? `<table class="tabela"><thead><tr><th>Quando</th><th>Cliente</th><th>Canal</th><th>Veículo</th><th>Última mensagem</th><th>Msgs</th><th></th></tr></thead><tbody>
      ${cs.map(c => {
        const pausada = c.pausado_ate && new Date(c.pausado_ate) > new Date()
        const tel = c.telefone || (c.contato || '').split('@')[0]
        return `<tr><td>${quando(c.atualizado_em)}</td>
        <td>${c.precisa_humano ? '🙋 ' : ''}<b>${esc(c.nome || '—')}</b>${tel && /^\d{10,13}$/.test(tel) ? `<div class="sub"><a href="${waLink(tel)}" target="_blank">${esc(numero(tel.length > 11 ? tel : '55' + tel))}</a></div>` : ''}</td>
        <td><span class="tag ${c.canal === 'whatsapp' ? 'verde' : ''}">${c.canal === 'whatsapp' ? 'WhatsApp' : 'Vitrine'}</span>${pausada ? '<span class="tag amarelo">pausada</span>' : ''}</td>
        <td>${esc(c.codigo || '')}</td><td class="sub">${esc((c.ultima || '').slice(0, 110))}</td><td>${c.msgs}</td>
        <td><div class="acoes"><button class="sec mini" data-conv="${c.id}">Ver</button>${c.canal === 'whatsapp' ? `<button class="sec mini" data-pausar="${c.id}" data-v="${pausada ? 0 : 1}">${pausada ? 'Retomar' : 'Pausar'}</button>` : ''}</div></td></tr>`
      }).join('')}</tbody></table>`
      : '<div class="vazio">Nenhuma conversa ainda. Elas aparecem quando alguém usa o ícone de atendimento da vitrine ou fala no WhatsApp (se ligado em Parâmetros).</div>'
  } else {
    $('#dicaClientes').textContent = 'Pessoas que pediram contato pela vitrine (formulário ou assistente). Atualize a situação conforme o atendimento.'
    let ls = await api('/api/leads')
    if (busca) ls = ls.filter(l => [l.nome, l.telefone, l.veiculo, l.codigo].join(' ').toLowerCase().includes(busca.toLowerCase()))
    $('#listaClientes').innerHTML = ls.length ? `<table class="tabela"><thead><tr><th>Quando</th><th>Nome</th><th>WhatsApp</th><th>Veículo</th><th>Mensagem</th><th>Situação</th></tr></thead><tbody>
      ${ls.map(l => `<tr><td>${quando(l.criado_em)}</td><td><b>${esc(l.nome)}</b></td>
        <td>${l.telefone && /^\d{10,11}$/.test(l.telefone) ? `<a href="${waLink(l.telefone, `Olá ${l.nome || ''}! Sobre o ${l.veiculo || 'veículo'} (${l.codigo || ''}) da nossa vitrine…`)}" target="_blank">${esc(numero('55' + l.telefone))}</a>` : esc(numero(l.telefone || ''))}${l.origem && l.origem !== 'vitrine' ? `<div class="sub">${l.origem === 'assistente-whatsapp' ? 'assistente · WhatsApp' : 'assistente · vitrine'}</div>` : ''}</td>
        <td>${esc(l.codigo || '')} ${esc(l.veiculo || '')}${l.veiculo_status && !['circulando', 'enviado'].includes(l.veiculo_status) ? ` <span class="tag cinza-solido">${esc(l.veiculo_status)}</span>` : ''}</td>
        <td class="sub">${esc(l.mensagem || '')}</td>
        <td><select data-lead="${l.id}">${Object.entries(LEAD_ST).map(([k, n]) => `<option value="${k}" ${l.status === k ? 'selected' : ''}>${n}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table>`
      : '<div class="vazio">Nenhum interessado ainda. Eles chegam pelo formulário da vitrine pública.</div>'
    const novos = ls.filter(l => l.status === 'novo').length
    $('#nLeads').textContent = novos ? `(${novos} novos)` : ''
  }
}
$('#segClientes').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-v]'); if (!b) return
  vistaClientes = b.dataset.v; $$('#segClientes button').forEach(x => x.classList.toggle('ativa', x === b)); carregarClientes()
})
let tCli; $('#buscaClientes').addEventListener('input', () => { clearTimeout(tCli); tCli = setTimeout(carregarClientes, 300) })
$('#listaClientes').addEventListener('click', async (e) => {
  const v = e.target.closest('[data-conv]')
  if (v) {
    const c = await api('/api/conversas/' + v.dataset.conv)
    $('#convTitulo').textContent = (c.nome || 'Cliente') + (c.canal === 'whatsapp' ? ' · WhatsApp' : ' · Vitrine')
    const d = c.dados || {}
    $('#convInfo').textContent = [d.telefone && 'WhatsApp ' + numero('55' + d.telefone), d.cidade, d.pagamento && 'pagamento: ' + d.pagamento, d.lojista === true ? 'lojista' : '', d.interesse, d.temperatura].filter(Boolean).join(' · ')
    $('#convMsgs').innerHTML = c.mensagens.map(m => `<div class="m ${m.papel === 'user' ? 'user' : 'bot'}">${esc(m.texto)}${m.meta?.fotos_de ? `<small>📷 fotos do ${esc(m.meta.fotos_de)}</small>` : ''}<small>${quando(m.ts)}${m.meta?.via === 'roteiro' ? ' · sem IA' : ''}</small></div>`).join('')
    $('#dlgConversa').showModal(); $('#convMsgs').scrollTop = 1e6
  }
  const p = e.target.closest('[data-pausar]')
  if (p) { await api(`/api/conversas/${p.dataset.pausar}/pausar`, { pausar: p.dataset.v === '1' }); carregarClientes() }
})
$('#listaClientes').addEventListener('change', async (e) => { const s = e.target.closest('[data-lead]'); if (s) await api('/api/leads/' + s.dataset.lead, { status: s.value }) })
function abrirComprador (c = {}) {
  const f = $('#formComprador'); f.reset()
  for (const k of ['id', 'nome', 'telefone', 'documento', 'cidade', 'uf', 'email', 'obs']) f[k].value = c[k] || ''
  f.tipo.value = c.tipo || 'lojista'; $('#compAviso').textContent = ''
  $('#dlgComprador').showModal()
}
$('#btnNovoComprador').onclick = () => abrirComprador()
$('#listaClientes').addEventListener('click', (e) => { const b = e.target.closest('[data-editar-comp]'); if (b) abrirComprador(compradoresCache.find(c => String(c.id) === b.dataset.editarComp)) })
$('#formComprador').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'salvar') return
  e.preventDefault()
  const d = Object.fromEntries(new FormData(e.target)); if (!d.id) delete d.id
  try { await api('/api/compradores', d); $('#dlgComprador').close(); carregarClientes() } catch (err) { $('#compAviso').textContent = err.message }
})

// ---------- Grupos ----------
async function carregarGrupos () { grupos = await api('/api/grupos'); pintarGrupos() }
function resumoRegras (r = {}) {
  const p = []
  if (r.categorias?.length) p.push(r.categorias.map(c => E.categorias[c]).join('/'))
  if (r.premium === 'so') p.push('só premium'); if (r.premium === 'nao') p.push('sem premium')
  if (r.precoMin) p.push('≥ ' + moeda(r.precoMin)); if (r.precoMax) p.push('≤ ' + moeda(r.precoMax))
  if (r.anoMin) p.push('ano ≥ ' + r.anoMin); if (r.anoMax) p.push('ano ≤ ' + r.anoMax)
  if (r.kmMax) p.push('km ≤ ' + milhar(r.kmMax))
  if (r.marcas?.length) p.push(r.marcas.join(', ')); if (r.combustiveis?.length) p.push(r.combustiveis.join(', '))
  if (r.cambio) p.push(r.cambio); if (r.acrescimo) p.push('+' + moeda(r.acrescimo))
  return p.join(' · ') || 'recebe todos'
}
let vistaGrupos = 'ativos'
function pintarGrupos () {
  const busca = $('#buscaGrupo').value.toLowerCase()
  const visiveis = grupos.filter(g => g.comunidade !== 'comunidade')
  $('#nAtivos').textContent = `(${visiveis.filter(g => !g.arquivado).length})`
  $('#nArquivados').textContent = `(${visiveis.filter(g => g.arquivado).length})`
  const arq = vistaGrupos === 'arquivados'
  const lista = visiveis
    .filter(g => !!g.arquivado === arq)
    .filter(g => !busca || (g.nome || '').toLowerCase().includes(busca) || g.jid.includes(busca))
    .filter(g => !$('#soReconhecidos').checked || g.reconhecido)
    .filter(g => !$('#soAdmin').checked || g.sou_admin)
  $('#listaGrupos').innerHTML = lista.map(g => {
    const pct = g.mensagens ? Math.round(100 * g.anuncios / g.mensagens) : 0
    const j = esc(g.jid)
    const tags = `${g.tipo === 'contato' ? '<span class="tag amarelo">contato</span>' : ''}${g.reconhecido ? '<span class="tag verde">anúncios recorrentes</span>' : ''}${g.sou_admin ? '<span class="tag">admin</span>' : ''}${g.somente_admins ? '<span class="tag">só admins enviam</span>' : ''}`
    const ctrl = arq
      ? `<button class="sec mini" data-arquivar="${j}" data-v="0" title="Trazer para a tela Grupos">↩︎ Ativar</button>`
      : `<span class="sw-col">${sw(g.fonte, `data-g="${j}" data-k="fonte"`)}Fonte</span>
         <span class="sw-col" title="Só aceita anúncios de anunciantes marcados como confiáveis">${sw(g.somente_confiaveis, `data-g="${j}" data-k="somenteConfiaveis" ${g.fonte ? '' : 'disabled'}`)}Confiáveis</span>
         <span class="sw-col">${sw(g.destino, `data-g="${j}" data-k="destino"`)}Destino</span>
         <button class="sec mini" data-arquivar="${j}" data-v="1" title="Arquivar (tirar desta lista)">🗄️</button>`
    return `<div>
      <div class="nome"><b>${esc(g.nome || g.jid)}</b> ${tags}${g.comunidade_nome && g.comunidade_nome !== g.nome ? `<span class="sub"> · ${esc(g.comunidade_nome)}</span>` : ''}
        ${g.destino && !arq ? `<div class="sub">Regras: ${esc(resumoRegras(g.regras))} <a href="#" data-regras="${j}">editar</a></div>` : ''}
      </div>
      <div class="nums"><span title="mensagens"><b>${g.mensagens}</b> msg</span><span title="anúncios"><b>${g.anuncios}</b> anún.</span><span title="anúncios / mensagens"><b>${pct}%</b></span><span title="último anúncio">${quando(g.ultimo_anuncio)}</span></div>
      <div class="ctrl">${ctrl}</div></div>`
  }).join('') || `<div class="vazio">${arq ? 'Nenhum arquivado.' : 'Nenhum grupo ativo. Abra 🗄️ Arquivados e toque em ↩︎ Ativar nos que quer usar.'}</div>`
}
$('#segGrupos').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-v]'); if (!b) return
  vistaGrupos = b.dataset.v
  $$('#segGrupos button').forEach(x => x.classList.toggle('ativa', x === b))
  pintarGrupos()
})
$('#listaGrupos').addEventListener('change', async (e) => {
  const i = e.target.closest('input[data-g]'); if (!i) return
  const g = grupos.find(x => x.jid === i.dataset.g)
  if (i.dataset.k === 'destino' && i.checked && !g.sou_admin && !confirm(`Você não aparece como admin de "${g.nome}". Usar como destino mesmo assim?`)) { i.checked = false; return }
  await api('/api/grupos/' + encodeURIComponent(i.dataset.g), { [i.dataset.k]: i.checked })
  carregarGrupos(); carregar()
})
$('#listaGrupos').addEventListener('click', async (e) => {
  const a = e.target.closest('[data-arquivar]'); if (!a) return
  await api('/api/grupos/' + encodeURIComponent(a.dataset.arquivar), { arquivado: a.dataset.v === '1' })
  carregarGrupos(); carregar()
})
function pintarLote (l) {
  if (!l) return
  $('#loteStatus').textContent = l.rodando
    ? `${l.etapa} ${l.total ? `${l.feitos}/${l.total} · ${l.criados} novos · ${l.repetidos} repetidos · ${l.filtrados} filtrados` : ''}`
    : (l.total ? `Última geração: ${l.criados} novos, ${l.repetidos} repetidos, ${l.filtrados} filtrados (de ${l.total} postagens).` : '')
  $('#btnGerarHoje').disabled = !!l.rodando
}
$('#btnGerarHoje').onclick = async () => {
  if (!confirm('Gerar a fila com as postagens de hoje dos grupos marcados como Fonte? Os anúncios entram como pendentes para você aprovar.')) return
  try { const r = await api('/api/fila/gerar-periodo', {}); pintarLote({ rodando: true, etapa: `Buscando histórico de ${r.fontes} fonte(s)…` }) } catch (err) { alert(err.message) }
}
$('#listaGrupos').addEventListener('click', (e) => { const b = e.target.closest('[data-regras]'); if (b) { e.preventDefault(); abrirRegras(b.dataset.regras) } })
;['#buscaGrupo', '#soReconhecidos', '#soAdmin'].forEach(s => $(s).addEventListener('input', pintarGrupos))
$('#btnSincronizar').onclick = async () => { try { await api('/api/grupos/sincronizar', {}); carregarGrupos() } catch (e) { alert(e.message) } }

// editor de regras
let regrasJid = null
function abrirRegras (jid) {
  regrasJid = jid
  const g = grupos.find(x => x.jid === jid); const r = g.regras || {}
  $('#regrasTitulo').textContent = 'Regras · ' + g.nome
  $('#regrasCategorias').innerHTML = Object.entries(E.categorias).map(([k, n]) => `<label><input type="checkbox" value="${k}" ${r.categorias?.includes(k) ? 'checked' : ''}> ${n}</label>`).join('')
  const f = $('#formRegras')
  for (const el of $$('[name]', f)) el.value = el.dataset.lista !== undefined ? (r[el.name] || []).join(', ') : (r[el.name] ?? (el.name === 'premium' ? 'qualquer' : ''))
  $('#dlgRegras').showModal()
}
$('#dlgRegras').addEventListener('close', async () => {
  if ($('#dlgRegras').returnValue !== 'salvar') return
  const f = $('#formRegras'); const r = {}
  for (const el of $$('[name]', f)) {
    if (el.dataset.lista !== undefined) r[el.name] = el.value.split(',').map(s => s.trim()).filter(Boolean)
    else if (el.type === 'number') r[el.name] = el.value === '' ? null : Number(el.value)
    else r[el.name] = el.value
  }
  r.categorias = $$('#regrasCategorias input:checked').map(i => i.value)
  await api('/api/grupos/' + encodeURIComponent(regrasJid), { regras: r })
  carregarGrupos()
})

// ---------- Contatos ----------
async function carregarContatos () { contatos = await api('/api/contatos'); pintarContatos() }
function pintarContatos () {
  const busca = $('#buscaContato').value.toLowerCase()
  const nomeGrupo = (jid) => grupos.find(g => g.jid === jid)?.nome || 'grupo'
  const lista = contatos.filter(c => !busca || (c.nome || '').toLowerCase().includes(busca) || c.id.includes(busca))
  $('#nContatos').textContent = `(${lista.length})`
  $('#listaContatos').innerHTML = lista
    .map(c => `<div class="${c.status}">
      <div class="nome"><b>${esc(c.nome || '—')}</b> <span class="sub">${esc(numero(c.id))}</span><div class="sub" title="${esc(c.grupos.map(nomeGrupo).join(', '))}">${c.grupos.map(nomeGrupo).map(esc).join(', ')}</div></div>
      <div class="nums"><span><b>${c.anuncios}</b> anún.</span><span title="último anúncio">${quando(c.ultimo_anuncio)}</span></div>
      <select data-c="${esc(c.id)}">${[['normal', 'Normal'], ['confiavel', 'Confiável'], ['bloqueado', 'Bloqueado']].map(([s, n]) => `<option value="${s}" ${c.status === s ? 'selected' : ''}>${n}</option>`).join('')}</select>
    </div>`).join('') || '<div class="vazio">Os anunciantes aparecem conforme enviam anúncios nos grupos.</div>'
}
$('#listaContatos').addEventListener('change', async (e) => {
  const s = e.target.closest('select[data-c]'); if (!s) return
  await api('/api/contatos/' + encodeURIComponent(s.dataset.c), { status: s.value })
})
$('#buscaContato').addEventListener('input', pintarContatos)

// ---------- Relatórios ----------
$('#relDias').onchange = carregarRelatorios
function barras (lista, chave = 'n') {
  const max = Math.max(1, ...lista.map(x => x[chave]))
  return `<div class="barras">${lista.map(x => `<div><span>${esc(x.nome)}</span><i style="width:${100 * x[chave] / max}%"></i><span>${x[chave]}</span></div>`).join('') || '<span class="sub">Sem dados</span>'}</div>`
}
function tabela (lista, extraNome = '') {
  return `<div class="rolagem"><table class="tabela"><thead><tr><th>${extraNome}</th><th class="n" title="Recebidos">Receb.</th><th class="n">Válidos</th><th class="n" title="Retransmitidos">Retransm.</th><th class="n" title="Encerrados">Encerr.</th><th class="n">Preço médio</th><th class="n">% FIPE</th></tr></thead><tbody>
    ${lista.map(x => `<tr><td>${esc(x.nome)}</td><td class="n">${x.recebidos}</td><td class="n">${x.validos}</td><td class="n">${x.retransmitidos}</td><td class="n">${x.encerrados}</td><td class="n">${moeda(x.preco_medio)}</td><td class="n">${x.pct_fipe ? x.pct_fipe + '%' : '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="sub">Sem dados</td></tr>'}
  </tbody></table></div>`
}
async function carregarRelatorios () {
  const r = await api('/api/relatorios?dias=' + $('#relDias').value)
  const t = r.totais
  const maxDia = Math.max(1, ...r.porDia.map(d => d.validos))
  $('#relConteudo').innerHTML = `
    <div class="kpis kpis-mini">${[['Recebidos', t.recebidos], ['Válidos', t.validos], ['Retransmitidos', t.retransmitidos], ['Vendidos', t.vendidos], ['Faturamento', moeda(Number(t.faturamento))], ['Lucro estimado', moeda(Number(t.lucro))], ['Encerrados', t.encerrados], ['Preço médio', moeda(t.preco_medio)], ['Média vs FIPE', t.pct_fipe ? t.pct_fipe + '%' : '—']].map(([n, v]) => `<div class="kpi"><b>${v ?? 0}</b><span>${n}</span></div>`).join('')}</div>
    <div class="grade-rel">
      <div class="card"><h2>Válidos por dia</h2><div class="colunas">${r.porDia.map(d => `<div title="${d.dia}: ${d.validos}"><i style="height:${56 * d.validos / maxDia}px"></i>${d.dia.slice(0, 2)}</div>`).join('') || '<span class="sub">Sem dados</span>'}</div></div>
      <div class="card"><h2>Por categoria</h2>${barras(r.porCategoria)}</div>
      <div class="card"><h2>Por marca</h2>${barras(r.porMarca)}</div>
    </div>
    <div class="grade-rel g2">
      <div class="card"><h2>Por grupo de origem</h2>${tabela(r.porGrupo, 'Grupo')}</div>
      <div class="card"><h2>Por grupo destino</h2><div class="rolagem"><table class="tabela"><thead><tr><th>Destino</th><th class="n">Envios</th><th class="n">Anúncios</th><th class="n">Falhas</th></tr></thead><tbody>
        ${r.porDestino.map(x => `<tr><td>${esc(x.nome)}</td><td class="n">${x.envios}</td><td class="n">${x.anuncios}</td><td class="n">${x.falhas}</td></tr>`).join('') || '<tr><td colspan="4" class="sub">Sem envios no período</td></tr>'}
      </tbody></table></div></div>
    </div>
    <div class="card"><h2>Por anunciante</h2>${tabela(r.porAnunciante, 'Anunciante')}</div>`
}

// ---------- Parâmetros ----------
const pegar = (obj, caminho) => caminho.split('.').reduce((o, k) => o?.[k], obj)
function preencherForm () {
  const urlV = E.conta?.id === 1 ? '/vitrine' : '/v/' + (E.conta?.slug || '')
  $('#linkVitrine').href = urlV; $('#linkVitrine').textContent = location.host + urlV
  for (const el of $$('#formParam [name]')) {
    const v = pegar(E.config, el.name)
    if (el.type === 'checkbox') el.checked = !!v
    else if (el.dataset.lista !== undefined) el.value = (v || []).join(', ')
    else el.value = v ?? ''
  }
}
$('#formParam').onsubmit = async (e) => {
  e.preventDefault()
  const out = {}
  for (const el of $$('#formParam [name]')) {
    let v
    if (el.type === 'checkbox') v = el.checked
    else if (el.dataset.lista !== undefined) v = el.value.split(',').map(s => s.trim()).filter(Boolean)
    else if (el.type === 'number') v = el.value === '' ? null : Number(el.value)
    else v = el.value
    const ks = el.name.split('.'); let o = out
    ks.slice(0, -1).forEach(k => { o = o[k] ||= {} }); o[ks.at(-1)] = v
  }
  await api('/api/config', out)
  $('#salvoParam').textContent = 'Salvo ✓ ' + new Date().toLocaleTimeString('pt-BR')
  document.activeElement.blur(); await carregar()
}

// ---------- Modelo ----------
function pintarModelo () {
  $('#camposLista').innerHTML = E.campos.map(c => `<button type="button" data-campo="${c}">{${c}}</button>`).join('')
  $('#linhasModelo').innerHTML = modeloEdit.map((l, i) => `<li class="${i === linhaSel ? 'sel' : ''} ${l.ativo ? '' : 'off'}" data-i="${i}">
    <input type="checkbox" ${l.ativo ? 'checked' : ''} data-acao="ativo" title="Mostrar">
    <input type="text" value="${esc(l.texto)}" data-acao="texto">
    <button type="button" class="sec mini" data-acao="sobe">↑</button><button type="button" class="sec mini" data-acao="desce">↓</button><button type="button" class="sec mini" data-acao="remove">✕</button></li>`).join('')
}
$('#linhasModelo').addEventListener('input', (e) => {
  const li = e.target.closest('li'); const i = +li.dataset.i
  if (e.target.dataset.acao === 'texto') modeloEdit[i].texto = e.target.value
  if (e.target.dataset.acao === 'ativo') { modeloEdit[i].ativo = e.target.checked; li.classList.toggle('off', !e.target.checked) }
  previa()
})
$('#linhasModelo').addEventListener('focusin', (e) => {
  const li = e.target.closest('li'); if (!li) return
  linhaSel = +li.dataset.i; $$('#linhasModelo li').forEach(x => x.classList.toggle('sel', x === li))
})
$('#linhasModelo').addEventListener('click', (e) => {
  const a = e.target.dataset.acao; if (!['sobe', 'desce', 'remove'].includes(a)) return
  const i = +e.target.closest('li').dataset.i
  if (a === 'remove') modeloEdit.splice(i, 1)
  if (a === 'sobe' && i > 0) [modeloEdit[i - 1], modeloEdit[i]] = [modeloEdit[i], modeloEdit[i - 1]]
  if (a === 'desce' && i < modeloEdit.length - 1) [modeloEdit[i + 1], modeloEdit[i]] = [modeloEdit[i], modeloEdit[i + 1]]
  linhaSel = Math.max(0, Math.min(modeloEdit.length - 1, a === 'sobe' ? i - 1 : a === 'desce' ? i + 1 : i))
  pintarModelo(); previa()
})
$('#camposLista').addEventListener('click', (e) => {
  const c = e.target.dataset.campo; if (!c || !modeloEdit[linhaSel]) return
  const inp = $(`#linhasModelo li[data-i="${linhaSel}"] input[type=text]`)
  const pos = inp.selectionStart ?? inp.value.length
  modeloEdit[linhaSel].texto = inp.value.slice(0, pos) + `{${c}}` + inp.value.slice(pos)
  pintarModelo(); previa()
})
$('#btnAddLinha').onclick = () => { modeloEdit.splice(linhaSel + 1, 0, { id: 'l' + Date.now(), ativo: true, texto: '' }); linhaSel++; pintarModelo() }
$('#btnRestaurar').onclick = async () => { if (!confirm('Voltar ao modelo padrão?')) return; const c = await api('/api/config/restaurar-modelo', {}); modeloEdit = structuredClone(c.modelo); pintarModelo(); previa(); $('#salvoModelo').textContent = `Padrão restaurado · ${c._atualizados} anúncio(s) atualizados` }
$('#btnSalvarModelo').onclick = async () => { const r = await api('/api/config', { modelo: modeloEdit }); $('#salvoModelo').textContent = `Salvo ✓ · texto de ${r._atualizados} anúncio(s) na fila/circulação atualizado`; carregar() }
$('#exemploPrevia').onchange = previa
let tPrev
function previa () {
  clearTimeout(tPrev)
  tPrev = setTimeout(async () => {
    if (!exemplos.length) return
    const r = await api('/api/simular', { texto: exemplos[$('#exemploPrevia').value || 0], temFoto: true, config: { modelo: modeloEdit } })
    $('#previa').textContent = r.mensagem
  }, 200)
}

// ---------- Simulador ----------
const ROTULOS = { marca: 'Marca', modelo: 'Modelo', versao: 'Versão', motor: 'Motor', ano: 'Ano', km: 'KM', preco: 'Preço pedido', fipe: 'FIPE informada', fipeConsulta: 'FIPE consultada', categoria: 'Categoria', premium: 'Premium', cambio: 'Câmbio', combustivel: 'Combustível', cor: 'Cor', cidade: 'Cidade', opcionais: 'Opcionais', situacao: 'Situação', alertas: 'Alertas', placa: 'Placa', telefones: 'Telefones', descricaoIA: 'Descrição (IA)', pontos: 'Pontuação', motivos: 'Por quê' }
$('#exemploSim').onchange = () => { const v = $('#exemploSim').value; if (v === '') return; $('#simTexto').value = exemplos[v]; simular() }
$('#btnSimular').onclick = simular
let tSim
$('#simTexto').addEventListener('input', () => { if ($('#simIA').checked) return; clearTimeout(tSim); tSim = setTimeout(simular, 300) })
async function simular () {
  const texto = $('#simTexto').value
  if (!texto.trim()) return
  $('#btnSimular').disabled = true
  try {
    const r = await api('/api/simular', { texto, temFoto: $('#simFoto').checked, usarIA: $('#simIA').checked })
    const fmt = (k, v) => k === 'fipeConsulta' ? (v ? `${moeda(v.valor)} · ${v.modeloFipe || ''} (${v.confianca})` : '') : k === 'premium' ? (v ? 'sim' : 'não') : k === 'categoria' ? (E.categorias[v] || v) : Array.isArray(v) ? v.join(', ') : (k === 'preco' || k === 'fipe') ? (v ? moeda(v) : '') : k === 'km' && v != null ? milhar(v) : v
    $('#simCampos').innerHTML = Object.entries(ROTULOS).map(([k, n]) => `<tr><td>${n}</td><td>${esc(fmt(k, r.dados[k]) ?? '') || '<span class="sub">—</span>'}</td></tr>`).join('') +
      (r.dados.erroIA ? `<tr><td>Erro IA</td><td class="motivo">${esc(r.dados.erroIA)}</td></tr>` : '')
    $('#simMotivos').innerHTML = r.motivos.length
      ? `<p class="motivo">Seria <b>barrado</b>: ${r.motivos.map(esc).join(' · ')}</p>`
      : `<p style="color:var(--pri)"><b>Passa nos filtros.</b> Valor de repasse sugerido: ${moeda(r.precoRepasse)}</p>`
    $('#simDestinos').innerHTML = r.destinos.map(x => `<span class="tag ${x.recusa ? 'cinza' : 'verde'}" title="${esc(x.recusa || 'recebe')}">${esc(x.nome)}${x.recusa ? ' — ' + esc(x.recusa) : ''}</span>`).join('')
    $('#simMsg').textContent = r.mensagem
  } finally { $('#btnSimular').disabled = false }
}
$('#btnSimFila').onclick = async () => {
  const forcar = confirm('Ignorar filtros e checagem de repetidos?\nOK = entra na fila de qualquer jeito · Cancelar = aplica os filtros')
  const it = await api('/api/simular/fila', { texto: $('#simTexto').value, forcar })
  alert(it.repetidoDe ? 'Já existe um anúncio igual na fila/circulação.' : it.status === 'filtrado' ? 'Barrado: ' + it.motivos.join('; ') : `Adicionado como ${it.codigo} (${it.status}).`)
  carregar()
}

// ---------- Topo ----------
$('#btnPausar').onclick = async () => { await api('/api/envio/pausar', { pausado: !E.envio.pausado }); carregar() }
$('#btnConectar').onclick = async () => { try { await api('/api/whatsapp/conectar', {}); setTimeout(carregar, 1500) } catch (e) { alert(e.message) } }
$('#btnSair').onclick = async () => { if (confirm('Desconectar este número? Será preciso escanear o QR de novo.')) { await api('/api/whatsapp/sair', {}); carregar() } }
$('#btnSairLogin').onclick = async () => { await api('/api/logout', {}); location.href = 'login' }

// ---------- Tempo real ----------
function sse () {
  const es = new EventSource('api/events')
  let t
  const atualizar = (ev) => {
    clearTimeout(t)
    t = setTimeout(() => {
      carregar()
      if (ev.type === 'fila' && (abaAtual === 'fila' || abaAtual === 'circulando') && !document.activeElement?.closest('.item')) carregarLista(abaAtual)
      if (ev.type === 'mapa' && abaAtual === 'grupos') carregarGrupos()
    }, 500)
  }
  ;['conexao', 'mapa', 'fila', 'log'].forEach(n => es.addEventListener(n, atualizar))
  es.addEventListener('conversas', () => { if (abaAtual === 'clientes' && vistaClientes === 'conversas') carregarClientes() })
  es.addEventListener('leads', () => { if (abaAtual === 'clientes') carregarClientes(); $('#badgeLeads').textContent = '•' })
  es.addEventListener('lote', (ev) => { try { pintarLote(JSON.parse(ev.data)) } catch {} })
  es.onerror = () => { es.close(); setTimeout(sse, 4000) }
}

;(async () => {
  exemplos = await api('/api/exemplos')
  const ops = exemplos.map((e, i) => `<option value="${i}">Exemplo ${i + 1}: ${esc(e.split('\n')[0].slice(0, 38))}</option>`).join('')
  $('#exemploPrevia').innerHTML = ops
  $('#exemploSim').innerHTML = '<option value="">Carregar um exemplo…</option>' + ops
  await carregar()
  grupos = await api('/api/grupos').catch(() => [])
  sse()
  const h = location.hash.slice(1)
  if (h === 'minhaconta') { history.replaceState(null, '', '#painel'); if (!E.sessao.trocarSenha) abrirMinhaConta() }
  else if (h && $('#' + h)?.classList.contains('aba') && (h !== 'repassadores' || E.sessao.dev)) abrirAba(h)
})()
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h && h !== abaAtual && $('#' + h)?.classList.contains('aba')) abrirAba(h) })
