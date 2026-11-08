// v2.21: comando de voz em todo o sistema (validação e execução das ações, sem a IA).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'giro-voz-'));
process.env.GIROAUTO_SKIP_WA_AUTO = '1';
const { get, all, run } = require('../src/db');
const VZ = require('../src/voz');
const T = require('../src/team');

run("INSERT INTO stores (id, name, slug, feed_key) VALUES (1, 'Loja', 'loja', 'k')");
run("INSERT INTO users (id, store_id, name, email, pass_hash, role) VALUES (1, 1, 'Darlan', 'd@x', 'x', 'admin')");
run("INSERT INTO users (id, store_id, name, email, pass_hash, role, permissions) VALUES (2, 1, 'Vendedor', 'v@x', 'x', 'vendedor', '[\"vender\"]')");
const dono = { id: 1, storeId: 1, name: 'Darlan', perms: T.permsOf(get('SELECT * FROM users WHERE id = 1')) };
const vendedor = { id: 2, storeId: 1, name: 'Vendedor', perms: T.permsOf(get('SELECT * FROM users WHERE id = 2')) };
run("INSERT INTO vehicles (id, store_id, marca, modelo, ano_modelo, cor, preco, status) VALUES (10, 1, 'Ford', 'Ecosport', 2009, 'Prata', 32000, 'pronto')");
run("INSERT INTO vehicles (id, store_id, marca, modelo, ano_modelo, preco, status, venda_comprador, doc_status) VALUES (11, 1, 'Honda', 'Biz', 2020, 12000, 'vendido', 'Paulo', 'pendente')");
run("INSERT INTO vehicles (id, store_id, marca, modelo, ano_modelo, preco, status) VALUES (12, 1, 'VW', 'Jetta', 2013, 62900, 'publicado')");
run("INSERT INTO leads (id, store_id, nome, telefone, etapa, origem) VALUES (5, 1, 'Creidi', '44999990000', 'atendimento', 'whatsapp')");
run("INSERT INTO leads (id, store_id, nome, telefone, etapa, origem, vendedor_id) VALUES (6, 1, 'Outro', '44999990001', 'novo', 'whatsapp', 1)");

test('carro para parceiro que ainda não existe: cadastra o parceiro', async () => {
  const [a] = VZ.validar(dono, [{ tipo: 'local', vehicle_id: 10, status: 'manutencao', parceiro_nome: 'lavador do Alemão', parceiro_tipo: 'lavador' }]);
  assert.ok(a.ok, a.erro);
  assert.match(a.texto, /Lavador do Alemão, novo parceiro/);
  const [f] = await VZ.executar(dono, [{ tipo: 'local', vehicle_id: 10, status: 'manutencao', parceiro_nome: 'lavador do Alemão', parceiro_tipo: 'lavador' }]);
  assert.ok(f.feito, f.erro);
  const p = get("SELECT * FROM partners WHERE store_id = 1 AND nome = 'Lavador do Alemão'");
  assert.equal(p.tipo, 'lavador');
  assert.equal(get('SELECT local_parceiro_id FROM vehicles WHERE id = 10').local_parceiro_id, p.id);
  // segunda vez: reaproveita o mesmo parceiro
  await VZ.executar(dono, [{ tipo: 'local', vehicle_id: 10, status: 'manutencao', parceiro_nome: 'Lavador do Alemão' }]);
  assert.equal(get("SELECT COUNT(*) n FROM partners WHERE nome = 'Lavador do Alemão'").n, 1);
});

test('documentação do carro vendido: ATPV entregue ao comprador', async () => {
  const [f] = await VZ.executar(dono, [{ tipo: 'doc', vehicle_id: 11, status: 'entregue' }]);
  assert.ok(f.feito, f.erro);
  assert.match(f.texto, /comprador Paulo.*Entregue ao comprador/);
  assert.equal(get('SELECT doc_status FROM vehicles WHERE id = 11').doc_status, 'entregue');
  const [x] = VZ.validar(dono, [{ tipo: 'doc', vehicle_id: 10, status: 'entregue' }]);
  assert.equal(x.ok, false, 'carro não vendido não tem documentação de transferência');
});

test('lead para arquivados e anotação', async () => {
  const feitas = await VZ.executar(dono, [{ tipo: 'lead_nota', lead_id: 5, nota_tipo: 'nota', texto: 'desistiu por enquanto' }, { tipo: 'lead_etapa', lead_id: 5, etapa: 'arquivado' }]);
  assert.ok(feitas.every((a) => a.feito), JSON.stringify(feitas));
  assert.equal(get('SELECT etapa FROM leads WHERE id = 5').etapa, 'arquivado');
  const [p] = VZ.validar(dono, [{ tipo: 'lead_etapa', lead_id: 6, etapa: 'perdido' }]);
  assert.equal(p.ok, false, 'perdido exige motivo');
});

test('vendedor não mexe em lead de outro vendedor nem em custos', () => {
  const [a, b] = VZ.validar(vendedor, [{ tipo: 'lead_etapa', lead_id: 6, etapa: 'arquivado' }, { tipo: 'custo', vehicle_id: 10, valor: 100 }]);
  assert.equal(a.ok, false);
  assert.equal(b.ok, false);
  assert.match(b.erro, /permissão/);
});

test('visita com cliente novo cria o lead e agenda', async () => {
  const [f] = await VZ.executar(dono, [{ tipo: 'visita', nome: 'João', telefone: '44 98888-7777', vehicle_id: 12, data_hora: '2026-11-10 15:00', visita_tipo: 'test_drive' }]);
  assert.ok(f.feito, f.erro);
  const l = get("SELECT * FROM leads WHERE nome = 'João'");
  assert.equal(l.etapa, 'visita');
  assert.equal(get('SELECT COUNT(*) n FROM lead_visits WHERE lead_id = ?', l.id).n, 1);
});

test('venda, custo, km e oferta', async () => {
  const feitas = await VZ.executar(dono, [
    { tipo: 'custo', vehicle_id: 10, valor: 80, descricao: 'Lavagem completa', categoria: 'lavagem' },
    { tipo: 'carro_dados', vehicle_id: 10, km: 154000 },
    { tipo: 'vendido', vehicle_id: 12, valor: 61000, comprador: 'Maria', pagamento: 'pix' },
  ]);
  assert.ok(feitas.every((a) => a.feito), JSON.stringify(feitas.map((a) => a.erro)));
  assert.equal(get('SELECT valor FROM vehicle_costs WHERE vehicle_id = 10').valor, 80);
  assert.equal(get('SELECT km FROM vehicles WHERE id = 10').km, 154000);
  const v = get('SELECT * FROM vehicles WHERE id = 12');
  assert.deepEqual([v.status, v.venda_valor, v.venda_comprador, v.venda_pagamento, v.doc_status], ['vendido', 61000, 'Maria', 'PIX', 'pendente']);
});

test('Instagram e Marketplace: sem fotos não vai', () => {
  const r = VZ.validar(dono, [{ tipo: 'instagram', vehicle_id: 10 }, { tipo: 'marketplace', vehicle_id: 10 }]);
  assert.ok(r.every((a) => !a.ok && /fotos/.test(a.erro)));
});

test('abrir tela, carro e lead', () => {
  const r = VZ.validar(vendedor, [{ tipo: 'abrir', tela: 'crm' }, { tipo: 'abrir', vehicle_id: 10 }, { tipo: 'abrir', tela: 'xyz' }]);
  assert.deepEqual(r.map((a) => [a.ok, a.ir]), [[true, 'crm'], [true, 'editar-10'], [false, undefined]]);
});

test('regras rápidas deixam CRM, documentação e parceiro novo para a IA', () => {
  const ctx = VZ.contexto(dono);
  assert.ok(ctx.vendidos.some((v) => v.id === 11) && ctx.leads.length && Array.isArray(ctx.visitas));
  for (const t of ['mova o lead da Creidi para arquivados', 'marque que o atpv da biz foi emitido e entregue ao comprador', 'divulgue o Jetta no instagram', 'a ecosport 2009 foi para o lavador do joão']) {
    assert.equal(VZ.regras(t, ctx).acoes.length, 0, t);
  }
  assert.equal(VZ.regras('a ecosport 2009 voltou e está no pátio', ctx).acoes[0].tipo, 'local');
});

test('caminho da tela: a ação conferida volta do navegador e é executada igual', async () => {
  run("INSERT INTO vehicles (id, store_id, marca, modelo, ano_modelo, preco, status) VALUES (13, 1, 'Fiat', 'Uno', 2015, 30000, 'pronto')");
  const brutas = [
    { tipo: 'local', vehicle_id: 13, status: 'manutencao', parceiro_nome: 'Funilaria do Beto', parceiro_tipo: 'funilaria' },
    { tipo: 'carro_dados', vehicle_id: 13, cor: 'branco', km: 99000 },
    { tipo: 'pendencia', vehicle_id: 13, pendencia_tipo: 'multa', descricao: 'velocidade', valor: 130, vencimento: '2026-12-01' },
    { tipo: 'lead_novo', nome: 'Ana', telefone: '44977776666', vehicle_id: 13, interesse: 'troca no Uno' },
    { tipo: 'lead_nota', lead_id: 6, nota_tipo: 'ligacao', texto: 'vem sábado' },
  ];
  const conferidas = JSON.parse(JSON.stringify(VZ.validar(dono, brutas)));
  assert.ok(conferidas.every((a) => a.ok), JSON.stringify(conferidas.map((a) => a.erro)));
  const feitas = await VZ.executar(dono, conferidas);
  assert.ok(feitas.every((a) => a.feito), JSON.stringify(feitas.map((a) => a.erro)));
  assert.ok(get("SELECT 1 FROM partners WHERE nome = 'Funilaria do Beto' AND tipo = 'funilaria'"));
  assert.deepEqual({ ...get('SELECT cor, km FROM vehicles WHERE id = 13') }, { cor: 'Branco', km: 99000 });
  assert.equal(get('SELECT tipo FROM pendencias WHERE vehicle_id = 13').tipo, 'multa');
  assert.equal(get("SELECT vehicle_id FROM leads WHERE nome = 'Ana'").vehicle_id, 13);
  assert.ok(get("SELECT 1 FROM lead_events WHERE lead_id = 6 AND texto = 'vem sábado'"));
});
