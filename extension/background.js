// GiroAuto — service worker da extensão (v1.5).
// Recebe as tarefas do painel e conduz cada uma numa aba do Facebook Marketplace:
// exclui o anúncio antigo (republicação), preenche o formulário, publica e registra o link no painel.

const MIN_GAP_MS = 3 * 60e3; // intervalo entre anúncios, para manter ritmo humano
const MAX_GAP_MS = 5 * 60e3;
const PANEL_ORIGINS = [/^https:\/\/giroauto\.onrender\.com$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

const store = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (obj) => chrome.storage.local.set(obj),
};

async function cfg() {
  return store.get(['panelUrl', 'token', 'storeName', 'auto', 'current', 'nextAllowedAt', 'lastError', 'pendentes', 'fbBase']);
}
async function fbBase() { return (await cfg()).fbBase || 'https://www.facebook.com'; }
const createUrl = async () => `${await fbBase()}/marketplace/create/vehicle`;
const sellingUrl = async () => `${await fbBase()}/marketplace/you/selling`;

async function api(method, path, body) {
  const { panelUrl, token } = await cfg();
  if (!panelUrl) throw new Error('Extensão ainda não conectada ao painel.');
  const res = await fetch(panelUrl.replace(/\/+$/, '') + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) await store.set({ token: '', storeName: '' });
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

function badge(text, color = '#efa91c') {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

/* ---------------- Ciclo de tarefas ---------------- */

async function poll({ manual = false, returnTabId = null } = {}) {
  const c = await cfg();
  if (!c.token) return { ok: false, reason: 'não pareada' };
  if (c.current) return { ok: false, reason: 'ocupada' };
  if (!manual && c.auto === false) return { ok: false, reason: 'automático desligado' };
  if (c.nextAllowedAt && Date.now() < c.nextAllowedAt) {
    return { ok: false, reason: 'intervalo', wait_ms: c.nextAllowedAt - Date.now() };
  }
  let data;
  try { data = await api('GET', '/api/ext/next'); }
  catch (e) { await store.set({ lastError: e.message }); badge('!', '#b0352a'); return { ok: false, reason: e.message }; }
  await store.set({ lastError: '', pendentes: data.pendentes || 0 });
  if (!data.job) { badge(''); return { ok: true, job: null }; }
  badge(String(data.pendentes || 1));
  const current = {
    job: data.job, vehicle: data.vehicle, store: data.store, auto: !!data.settings?.auto_publish,
    phase: data.job.type === 'publicar' ? 'preencher' : 'excluir', tabId: null, returnTabId, startedAt: Date.now(),
  };
  const tab = await chrome.tabs.create({ url: current.phase === 'preencher' ? await createUrl() : await sellingUrl(), active: true });
  current.tabId = tab.id;
  await store.set({ current });
  return { ok: true, job: data.job };
}

async function finish(status, extra = {}) {
  const { current } = await cfg();
  if (!current) return;
  await store.set({ current: null });
  try {
    await api('POST', `/api/ext/jobs/${current.job.id}`, { status, ...extra });
  } catch (e) {
    await store.set({ lastError: `Não foi possível avisar o painel: ${e.message}` });
  }
  const gap = MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS);
  await store.set({ nextAllowedAt: status === 'concluido' && current.job.type !== 'excluir' ? Date.now() + gap : Date.now() });
  badge('');
  // No modo automático, fecha a aba do Facebook e volta para o painel.
  if (status === 'concluido' && current.auto) {
    setTimeout(async () => {
      try { await chrome.tabs.remove(current.tabId); } catch { /* já fechada */ }
      if (current.returnTabId) chrome.tabs.update(current.returnTabId, { active: true }).catch(() => {});
    }, 2500);
  }
  // Há mais tarefas na fila? O próximo ciclo respeita o intervalo.
  if (status !== 'concluido') setTimeout(() => poll(), 1000);
}

async function note(text) {
  const { current } = await cfg();
  if (current) api('POST', `/api/ext/jobs/${current.job.id}/note`, { note: text }).catch(() => {});
}

async function inject(tabId) {
  const { current } = await cfg();
  if (!current || current.tabId !== tabId) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tabId, { cmd: 'run', current });
  } catch (e) {
    console.warn('GiroAuto: injeção falhou', e);
  }
}

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  const { current } = await cfg();
  if (!current || current.tabId !== tabId) return;
  const url = tab.url || '';
  // Depois de publicar, o Facebook sai da página de criação.
  if (current.phase === 'aguardando_publicar' && (info.url || info.status === 'complete') && url && !url.includes('/marketplace/create')) {
    if (/\/marketplace\/item\/\d+/.test(url)) {
      await finish('concluido', { listing_url: url.split('?')[0] });
      chrome.tabs.sendMessage(tabId, { cmd: 'toast', text: 'GiroAuto: anúncio publicado e registrado no painel.' }).catch(() => {});
      return;
    }
    // Foi para "Seus anúncios": procura o link do anúncio novo antes de concluir.
    current.phase = 'capturar';
    await store.set({ current });
    if (info.status === 'complete') inject(tabId);
    return;
  }
  if (info.status === 'complete' && url.includes('/marketplace')) inject(tabId);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { current } = await cfg();
  if (current && current.tabId === tabId) await finish('falhou', { error: 'A aba do Facebook foi fechada antes de concluir.' });
});

async function handle(msg, sender, external) {
  const { current } = await cfg();
  switch (msg.cmd) {
    case 'hello': {
      const c = await cfg();
      return { ok: true, installed: true, version: chrome.runtime.getManifest().version, paired: !!c.token, panelUrl: c.panelUrl || '', store: c.storeName || '', busy: !!c.current, nextAllowedAt: c.nextAllowedAt || 0, lastError: c.lastError || '' };
    }
    case 'pair': {
      const panelUrl = external ? sender.origin : msg.panelUrl;
      await store.set({ panelUrl: String(panelUrl).replace(/\/+$/, '') });
      const r = await api('POST', '/api/ext/pair', { code: msg.code, label: 'Chrome' });
      await store.set({ token: r.token, storeName: r.store, auto: true, lastError: '' });
      return { ok: true, store: r.store };
    }
    case 'unpair': await store.set({ token: '', storeName: '', current: null }); return { ok: true };
    case 'setAuto': await store.set({ auto: !!msg.value }); return { ok: true };
    case 'pollNow': return poll({ manual: true, returnTabId: sender?.tab?.id || null });
    case 'status': return cfg();
    case 'cancel': await finish('cancelado'); return { ok: true };
    case 'setFbBase': // só para testes locais
      if (external && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(sender.origin)) return { ok: false };
      await store.set({ fbBase: msg.value || '', nextAllowedAt: 0 }); return { ok: true };
  }
  if (external) return { ok: false, error: 'comando não permitido' };
  // Mensagens do assistente na página do Facebook
  switch (msg.cmd) {
    case 'deleted': {
      if (!current) return { ok: false };
      if (current.job.type === 'excluir') { await finish('concluido'); return { ok: true, done: true }; }
      current.phase = 'preencher';
      await store.set({ current });
      await chrome.tabs.update(current.tabId, { url: await createUrl() });
      return { ok: true };
    }
    case 'filled': {
      if (!current) return { ok: false };
      current.phase = 'aguardando_publicar';
      await store.set({ current });
      return { ok: true };
    }
    case 'note': await note(msg.text || ''); return { ok: true };
    case 'published': await finish('concluido', { listing_url: msg.listing_url || '' }); return { ok: true };
    case 'failed': await finish('falhou', { error: msg.error || 'Falha no assistente.' }); return { ok: true };
    default: return { ok: false };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender, false).then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
  return true;
});

// Mensagens vindas do painel GiroAuto (página web), sem precisar abrir a extensão.
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (!PANEL_ORIGINS.some((re) => re.test(sender.origin || ''))) { sendResponse({ ok: false, error: 'origem não autorizada' }); return false; }
  handle(msg, sender, true).then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
  return true;
});

chrome.alarms.create('giro-poll', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'giro-poll') poll(); });
chrome.runtime.onStartup.addListener(() => poll());
