// Contas (repassadores): login do desenvolvedor, criação de conta, login do repassador e isolamento dos dados
// node test/teste-contas.js
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawn } from 'node:child_process'

const DIR = '/tmp/gr-teste-contas'; fs.rmSync(DIR, { recursive: true, force: true })
const PORTA = 3987
const srv = spawn(process.execPath, ['src/server.js', '--demo'], { env: { ...process.env, DATA_DIR: DIR, PORT: String(PORTA), ADMIN_SENHA: 'dev-teste', SESSAO_SEGREDO: 'x'.repeat(32), ANTHROPIC_API_KEY: '', DATABASE_URL: '', HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'inherit'] })
const fim = (c) => { srv.kill(); process.exit(c) }
process.on('uncaughtException', (e) => { console.error(e); fim(1) })
const U = `http://127.0.0.1:${PORTA}`
for (let i = 0; i < 120; i++) { try { if ((await fetch(U + '/saude')).ok) break } catch {} await new Promise(r => setTimeout(r, 500)) }

function cliente () {
  let cookie = ''
  const req = async (met, p, corpo) => {
    const r = await fetch(U + p, { method: met, headers: { 'Content-Type': 'application/json', cookie }, body: corpo ? JSON.stringify(corpo) : undefined, redirect: 'manual' })
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]
    const t = await r.text(); let j = null; try { j = JSON.parse(t) } catch {}
    return { status: r.status, j, t }
  }
  return { get: (p) => req('GET', p), post: (p, b = {}) => req('POST', p, b) }
}

const anon = cliente()
assert.equal((await anon.get('/api/estado')).status, 401, 'sem login não entra')
assert.equal((await anon.post('/api/login', { senha: 'errada' })).status, 401)

const dev = cliente()
assert.equal((await dev.post('/api/login', { senha: 'dev-teste' })).status, 200, 'desenvolvedor entra com ADMIN_SENHA')
const e1 = (await dev.get('/api/estado')).j
assert.equal(e1.sessao.dev, true); assert.equal(e1.conta.id, 1)
await new Promise(r => setTimeout(r, 3000)) // dados de demonstração
const anunciosConta1 = (await dev.get('/api/anuncios?status=todos')).j
assert.ok(anunciosConta1.length > 0, 'conta 1 tem os dados de demonstração')

const nova = (await dev.post('/api/dev/contas', { nome: 'Repasse Teste Ltda', responsavel: 'Fulano', email: 'fulano@teste.com', telefone: '45999990000' })).j
assert.ok(nova.senha && nova.id > 1, 'conta criada com senha temporária')
assert.equal((await dev.post('/api/dev/contas', { nome: 'Outra', email: 'fulano@teste.com' })).status, 400, 'e-mail repetido recusado')
const lista = (await dev.get('/api/dev/contas')).j
assert.equal(lista.contas.length, 2); assert.ok(lista.contas[0].pendentes + lista.contas[0].circulacao > 0, 'métricas da conta 1')

const rep = cliente()
assert.equal((await rep.post('/api/login', { email: 'fulano@teste.com', senha: 'errada' })).status, 401)
const lg = await rep.post('/api/login', { email: 'Fulano@Teste.com', senha: nova.senha })
assert.equal(lg.status, 200); assert.equal(lg.j.trocarSenha, true, 'pede troca da senha temporária')
const e2 = (await rep.get('/api/estado')).j
assert.equal(e2.conta.id, nova.id); assert.equal(e2.sessao.dev, false); assert.equal(e2.contas, undefined, 'repassador não vê outras contas')
assert.equal((await rep.get('/api/anuncios?status=todos')).j.length, 0, 'repassador não vê anúncios da conta 1')
assert.equal((await rep.get('/api/grupos')).j.length, 0, 'nem grupos')
assert.equal((await rep.get('/api/dev/contas')).status, 403, 'repassador não acessa o painel do desenvolvedor')
assert.equal((await rep.post(`/api/anuncios/${anunciosConta1[0].id}`, { nota: 'invasão' })).status, 404, 'não altera anúncio de outra conta')
const foto = anunciosConta1.find(a => a.fotos.length)?.fotos[0]
if (foto) {
  assert.equal((await rep.get('/fotos/' + foto.id)).status, 404, 'não vê foto de outra conta')
  assert.equal((await dev.get('/fotos/' + foto.id)).status, 200)
}
// simulador cria anúncio só na conta do repassador
await rep.post('/api/simular/fila', { texto: 'VENDO GOL 1.0 2015 KM 90.000 R$ 32.000 CASCAVEL' })
assert.equal((await rep.get('/api/anuncios?status=todos')).j.length, 1, 'anúncio criado na conta do repassador')
assert.equal((await dev.get('/api/anuncios?status=todos')).j.length, anunciosConta1.length, 'conta 1 inalterada')

// trocar senha
assert.equal((await rep.post('/api/minha-conta/senha', { atual: nova.senha, nova: 'senhanova1' })).status, 200)
assert.equal((await cliente().post('/api/login', { email: 'fulano@teste.com', senha: 'senhanova1' })).status, 200)

// desenvolvedor opera a outra conta
await dev.post(`/api/dev/entrar/${nova.id}`)
assert.equal((await dev.get('/api/estado')).j.conta.id, nova.id)
await dev.post('/api/dev/entrar/1')

// vitrine por conta
assert.equal((await anon.get('/vitrine/dados.json')).j.length, anunciosConta1.filter(a => ['circulando', 'enviado'].includes(a.status)).length)
assert.equal((await anon.get(`/v/${nova.slug}/dados.json`)).j.length, 0, 'vitrine do repassador só com os dele')
assert.equal((await anon.get('/v/nao-existe/')).status, 404)

// bloquear
await dev.post(`/api/dev/contas/${nova.id}`, { ativo: false })
assert.equal((await rep.get('/api/estado')).status, 401, 'conta bloqueada perde o acesso')
assert.equal((await cliente().post('/api/login', { email: 'fulano@teste.com', senha: 'senhanova1' })).status, 401)
const rs = (await dev.post(`/api/dev/contas/${nova.id}/senha`)).j
assert.ok(rs.senha)

console.log('✓ contas: login do desenvolvedor, repassador criado, dados isolados, vitrine por conta, bloqueio')
fim(0)
