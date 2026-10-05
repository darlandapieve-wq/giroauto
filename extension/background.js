// GiroAuto — service worker da extensão.
// Busca tarefas no painel e conduz cada uma numa aba do Facebook Marketplace.

const CREATE_URL = 'https://www.facebook.com/marketplace/create/vehicle';
const SELLING_URL = 'https://www.facebook.com/marketplace/you/selling';
const MIN_GAP_MS = 3 * 60e3; // intervalo mínimo entre anúncios
const MAX_GAP_MS = 5 * 60e3;

const store = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (obj) => chrome.storage.local.set(obj),
};

async function cfg() {
  return store.get(['panelUrl', 'token', 'storeName', 'auto', 'current', 'nextAllowedAt', 'lastError', 'pendentes']);
}

async function api(method, path, body) {
  const { panelUrl, token } = await cfg();
  if (!panelUrl) throw new Error('Informe o endereço do painel.');
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

async function poll({ manual = false } = {}) {
  const c = await cfg();
  if (!c.token) return { ok: false, reason: 'não pareada' };
  if (c.current) return { ok: false, reason: 'ocupada' };
  if (!manual && !c.auto) return { ok: false, reason: 'automático desligado' };
  if (!manual && c.nextAllowedAt && Date.now() < c.nextAllowedAt) return { ok: false, reason: 'intervalo' };
  let data;
  try { data = await api('GET', '/api/ext/next'); }
  catch (e) { await store.set({ lastError: e.message }); badge('!', '#b0352a'); return { ok: false, reason: e.message }; }
  await store.set({ lastError: '', pendentes: data.pendentes || 0 });
  if (!data.job) { badge(''); return { ok: true, job: null }; }
  badge(String(data.pendentes || 1));
  const current = { job: data.job, vehicle: data.vehicle, store: data.store, phase: data.job.type === 'publicar' ? 'preencher' : 'excluir', tabId: null, startedAt: Date.now() };
  const tab = await chrome.tabs.create({ url: current.phase === 'preencher' ? CREATE_URL : SELLING_URL, active: true });
  current.tabId = tab.id;
  await store.set({ current });
  return { ok: true, job: data.job };
}

async function finish(status, extra = {}) {
  const { current } = await cfg();
  if (!current) return;
  try {
    await api('POST', `/api/ext/jobs/${current.job.id}`, { status, ...extra });
  } catch (e) {
    await store.set({ lastError: `Não foi possível avisar o painel: ${e.message}` });
  }
  const gap = MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS);
  await store.set({ current: null, nextAllowedAt: status === 'concluido' ? Date.now() + gap : Date.now() });
  badge('');
}

// Injeta o assistente na aba quando a página carrega.
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
  // Depois de publicar, o Facebook sai da página de criação (navegação interna): consideramos concluído.
  if (current.phase === 'aguardando_publicar' && (info.url || info.status === 'complete') && url && !url.includes('/marketplace/create')) {
    const listing = /\/marketplace\/item\/\d+/.test(url) ? url.split('?')[0] : '';
    await finish('concluido', { listing_url: listing });
    chrome.tabs.sendMessage(tabId, { cmd: 'toast', text: 'GiroAuto: anúncio publicado e registrado no painel.' }).catch(() => {});
    return;
  }
  if (info.status === 'complete' && url.includes('facebook.com/marketplace')) inject(tabId);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { current } = await cfg();
  if (current && current.tabId === tabId) await finish('falhou', { error: 'A aba do Facebook foi fechada antes de concluir.' });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const { current } = await cfg();
    switch (msg.cmd) {
      case 'pair': {
        await store.set({ panelUrl: msg.panelUrl.replace(/\/+$/, '') });
        const r = await api('POST', '/api/ext/pair', { code: msg.code, label: 'Chrome' });
        await store.set({ token: r.token, storeName: r.store, auto: true });
        return { ok: true, store: r.store };
      }
      case 'unpair': await store.set({ token: '', storeName: '', current: null }); return { ok: true };
      case 'setAuto': await store.set({ auto: !!msg.value }); return { ok: true };
      case 'pollNow': return poll({ manual: true });
      case 'status': return cfg();
      case 'cancel': await finish('cancelado'); return { ok: true };
      // Mensagens do assistente na página do Facebook
      case 'deleted': {
        if (!current) return { ok: false };
        if (current.job.type === 'excluir') { await finish('concluido'); return { ok: true, done: true }; }
        current.phase = 'preencher';
        await store.set({ current });
        await chrome.tabs.update(current.tabId, { url: CREATE_URL });
        return { ok: true };
      }
      case 'filled': {
        if (!current) return { ok: false };
        current.phase = 'aguardando_publicar';
        await store.set({ current });
        return { ok: true };
      }
      case 'published': await finish('concluido', { listing_url: msg.listing_url || '' }); return { ok: true };
      case 'failed': await finish('falhou', { error: msg.error || 'Falha no assistente.' }); return { ok: true };
      default: return { ok: false };
    }
  })().then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
  return true;
});

chrome.alarms.create('giro-poll', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'giro-poll') poll(); });
chrome.runtime.onStartup.addListener(() => poll());
