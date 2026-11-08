// v2.20: webhook da Meta (Messenger, Direct, comentários) entrando no CRM.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'giro-inbox-'));
process.env.GIROAUTO_SKIP_WA_AUTO = '1';
const { get, all, run } = require('../src/db');
const inbox = require('../src/meta/inbox');

run("INSERT INTO stores (id, name, slug, feed_key) VALUES (1, 'Loja', 'loja', 'k')");
run("INSERT INTO meta_connections (store_id, page_id, page_name, ig_user_id) VALUES (1, 'PAGE1', 'Box 85', 'IG1')");
run("INSERT INTO campaigns (id, store_id, name, mode, meta_ad_id, daily_budget_cents, days, city_key, city_name, radius_km) VALUES (7, 1, 'Carrossel 08.11', 'messenger', 'AD9', 1000, 3, 'x', 'Toledo', 50)");

const leads = () => all('SELECT * FROM leads WHERE store_id = 1 ORDER BY id');

test('mensagem do Messenger vinda de anúncio cria lead com a campanha', async () => {
  await inbox.processar({ object: 'page', entry: [{ id: 'PAGE1', messaging: [
    { sender: { id: 'PSID1' }, recipient: { id: 'PAGE1' }, timestamp: 1, message: { mid: 'm1', text: 'Ainda disponível?' }, referral: { source: 'ADS', ad_id: 'AD9' } },
  ] }] });
  const l = leads();
  assert.equal(l.length, 1);
  assert.equal(l[0].origem, 'messenger');
  assert.match(l[0].origem_detalhe, /Messenger · anúncio "Carrossel 08.11"/);
  assert.equal(l[0].nome, 'Cliente do Messenger');
});

test('mesma pessoa: não duplica, registra o contato e pega o telefone do texto', async () => {
  await inbox.processar({ object: 'page', entry: [{ id: 'PAGE1', messaging: [
    { sender: { id: 'PSID1' }, message: { mid: 'm2', text: 'me chama no (44) 99999-1234' } },
    { sender: { id: 'PSID1' }, message: { mid: 'm2', text: 'me chama no (44) 99999-1234' } }, // reentrega da Meta
    { sender: { id: 'PAGE1' }, message: { mid: 'm3', text: 'resposta da loja', is_echo: true } },
  ] }] });
  const l = leads();
  assert.equal(l.length, 1);
  assert.equal(l[0].telefone, '44999991234');
  assert.equal(get("SELECT COUNT(*) n FROM lead_events WHERE lead_id = ? AND texto LIKE '%99999-1234%'", l[0].id).n, 1);
});

test('comentário no Facebook e Direct/comentário no Instagram', async () => {
  await inbox.processar({ object: 'page', entry: [{ id: 'PAGE1', changes: [
    { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'c1', post_id: 'PAGE1_55', message: 'Quanto?', from: { id: 'U2', name: 'Maria Souza' } } },
    { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'c2', post_id: 'PAGE1_55', message: 'Obrigado', from: { id: 'PAGE1', name: 'Box 85' } } },
  ] }] });
  await inbox.processar({ object: 'instagram', entry: [{ id: 'IG1', messaging: [
    { sender: { id: 'IGSID3' }, message: { mid: 'i1', attachments: [{ type: 'image' }] } },
  ], changes: [{ field: 'comments', value: { id: 'ic1', text: 'Valor?', from: { id: 'IGU4', username: 'joao' } } }] }] });
  const l = leads();
  assert.equal(l.length, 4);
  assert.deepEqual(l.slice(1).map((x) => [x.nome, x.origem]), [['Maria Souza', 'messenger'], ['Cliente do Instagram', 'instagram'], ['@joao', 'instagram']]);
  assert.match(l[1].obs, /facebook\.com\/PAGE1_55/);
});

test('conta desconhecida é ignorada', async () => {
  await inbox.processar({ object: 'page', entry: [{ id: 'OUTRA', messaging: [{ sender: { id: 'X' }, message: { mid: 'z', text: 'oi' } }] }] });
  assert.equal(leads().length, 4);
});

test('telefone no texto', () => {
  assert.equal(inbox.foneNoTexto('meu zap 44 9 9999-0000'), '44999990000');
  assert.equal(inbox.foneNoTexto('ano 2019 com 45000 km'), '');
});
