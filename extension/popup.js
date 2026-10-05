const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
const TYPES = { publicar: 'Publicar', republicar: 'Republicar', excluir: 'Excluir anúncio de' };

async function refresh() {
  const s = await send({ cmd: 'status' });
  const paired = !!s.token;
  $('pairView').hidden = paired;
  $('mainView').hidden = !paired;
  if (!paired) { $('url').value = s.panelUrl || ''; return; }
  $('storeName').textContent = s.storeName || 'Loja';
  $('panel').textContent = s.panelUrl;
  $('auto').checked = !!s.auto;
  $('err').textContent = s.lastError || '';
  $('cancel').hidden = !s.current;
  if (s.current) {
    const v = s.current.vehicle;
    $('state').innerHTML = `<b>${TYPES[s.current.job.type]} ${v.marca} ${v.modelo}</b><div class="muted">Acompanhe na aba do Facebook.</div>`;
  } else {
    const wait = s.nextAllowedAt && s.nextAllowedAt > Date.now() ? Math.ceil((s.nextAllowedAt - Date.now()) / 60e3) : 0;
    $('state').innerHTML = `${s.pendentes ? `<b>${s.pendentes} tarefa(s) na fila</b>` : '<span class="ok">Nenhuma tarefa no momento</span>'}${wait ? `<div class="muted">Próxima em cerca de ${wait} min (intervalo entre anúncios).</div>` : ''}`;
  }
}

$('pairBtn').onclick = async () => {
  $('pairErr').textContent = '';
  const panelUrl = $('url').value.trim();
  const code = $('code').value.trim();
  if (!/^https?:\/\//.test(panelUrl)) { $('pairErr').textContent = 'Informe o endereço completo, começando com https://'; return; }
  const r = await send({ cmd: 'pair', panelUrl, code });
  if (!r?.ok) { $('pairErr').textContent = r?.error || 'Não foi possível parear.'; return; }
  refresh();
};
$('auto').onchange = () => send({ cmd: 'setAuto', value: $('auto').checked });
$('poll').onclick = async () => {
  $('err').textContent = '';
  const r = await send({ cmd: 'pollNow' });
  if (r && !r.ok && r.reason) $('err').textContent = r.reason === 'ocupada' ? 'Já existe uma tarefa em andamento.' : r.reason;
  else if (r && r.ok && !r.job) $('err').textContent = '';
  refresh();
};
$('cancel').onclick = async () => { await send({ cmd: 'cancel' }); refresh(); };
$('unpair').onclick = async () => { await send({ cmd: 'unpair' }); refresh(); };

refresh();
