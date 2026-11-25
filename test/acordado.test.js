const test = require('node:test');
const assert = require('node:assert');
const { dentroDaJanela, lerJanela, minutosDoDia } = require('../src/acordado');
const { ambienteDoFilho } = require('../src/repasse-processo');

// horário de Brasília = UTC-3
const brt = (hh, mm) => new Date(Date.UTC(2026, 11, 1, hh + 3, mm));

test('minutos do dia no fuso de Brasília', () => {
  assert.strictEqual(minutosDoDia(brt(6, 30)), 390);
  assert.strictEqual(minutosDoDia(new Date(Date.UTC(2026, 11, 1, 1, 0))), 22 * 60); // 01:00 UTC = 22:00 BRT
});

test('janela padrão 06:30–22:30', () => {
  const j = lerJanela('06:30-22:30');
  assert.strictEqual(dentroDaJanela(brt(6, 29), j), false);
  assert.strictEqual(dentroDaJanela(brt(6, 30), j), true);
  assert.strictEqual(dentroDaJanela(brt(12, 0), j), true);
  assert.strictEqual(dentroDaJanela(brt(22, 29), j), true);
  assert.strictEqual(dentroDaJanela(brt(22, 30), j), false);
  assert.strictEqual(dentroDaJanela(brt(3, 0), j), false);
});

test('janela que atravessa a meia-noite e 24 h', () => {
  const j = lerJanela('20:00-02:00');
  assert.strictEqual(dentroDaJanela(brt(23, 0), j), true);
  assert.strictEqual(dentroDaJanela(brt(1, 0), j), true);
  assert.strictEqual(dentroDaJanela(brt(12, 0), j), false);
  assert.strictEqual(dentroDaJanela(brt(3, 0), lerJanela('00:00-24:00')), true);
  assert.deepStrictEqual(lerJanela('lixo'), { inicio: 390, fim: 1350 });
});

test('Repasse recebe só as próprias variáveis, sem os segredos da Loja', () => {
  const env = ambienteDoFilho({
    PATH: '/bin', NODE_ENV: 'production', GIRO_SSO_SEGREDO: 'sso', SESSION_SECRET: 'loja', SUPABASE_KEY: 'k',
    ANTHROPIC_API_KEY: 'da-loja', REPASSE_ANTHROPIC_API_KEY: 'do-repasse', REPASSE_DATABASE_URL: 'pg://x',
    REPASSE_ADMIN_SENHA: 's', REPASSE_INTERNO: '1', REPASSE_URL: 'http://antigo', PORT: '10000',
  }, '10000');
  assert.strictEqual(env.ANTHROPIC_API_KEY, 'do-repasse');
  assert.strictEqual(env.DATABASE_URL, 'pg://x');
  assert.strictEqual(env.ADMIN_SENHA, 's');
  assert.strictEqual(env.GIRO_SSO_SEGREDO, 'sso');
  assert.strictEqual(env.SESSION_SECRET, undefined);
  assert.strictEqual(env.SUPABASE_KEY, undefined);
  assert.strictEqual(env.SESSAO_SEGREDO, undefined); // não criar (derruba os logins; ver CLAUDE.md)
  assert.strictEqual(env.INTERNO, undefined);
  assert.strictEqual(env.URL, undefined);
  assert.strictEqual(env.PORT, '10001');
  assert.strictEqual(env.HOST, '127.0.0.1');
  assert.strictEqual(env.KEEPALIVE, '0');
  assert.strictEqual(env.LOJA_URL, 'http://127.0.0.1:10000');
});
