// Trava de conexão única do WhatsApp + desligamento sem logout + filtro dos logs da libsignal.
// Só banco local (PGlite) e sockets falsos: nada conecta ao WhatsApp nem a bancos de produção.
// node test/teste-trava.js
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-teste-trava-'))
process.env.DATA_DIR = DIR
process.env.DATABASE_URL = ''
process.env.WA_ESPERA_SEM_TRAVA_MS = '300'
process.env.WA_TRAVA_TENTAR_MS = '100'

const { conectar, q, um } = await import('../src/db.js')
const { Trava, chaveTrava } = await import('../src/wa-trava.js')
await conectar()
const espera = (ms) => new Promise(r => setTimeout(r, ms))
const linha = (c = 1) => um('SELECT valor, atualizado FROM repasse.kv WHERE chave = $1', [chaveTrava(c)])
const rapido = { vidaMs: 100, expiraS: 1, perdaMs: 600, tentarMs: 100, semTravaMs: 300 }

// 1) primeira vez (trava nunca existiu): espera a carência antes de criar
{
  const a = new Trava(1, { instancia: 'A', ...rapido })
  const t0 = Date.now()
  assert.equal(await a.obter(), true)
  assert.ok(Date.now() - t0 >= 280, 'esperou a carência de transição')
  assert.equal((await linha()).valor.instancia, 'A')
  // 2) B não pega enquanto A renova
  const b = new Trava(1, { instancia: 'B', ...rapido })
  assert.equal(await b.tentar(), false, 'B não pega trava viva')
  await espera(1300)
  assert.equal(await b.tentar(), false, 'A renovou: continua dele mesmo depois do prazo de expiração')
  // 3) A libera (SIGTERM): B pega na hora
  assert.equal(await a.liberar(), true)
  assert.equal((await linha()).valor.liberada, true)
  assert.equal(await b.tentar(), true, 'B pega trava liberada')
  assert.equal(a.minha, false)
  await b.liberar()
}

// 4) servidor que morre sem liberar: a trava expira e o outro assume; o antigo descobre e desliga
{
  let perdeu = null
  const a = new Trava(1, { instancia: 'A2', ...rapido, aoPerder: (m) => { perdeu = m } })
  assert.equal(await a.tentar(), true)
  clearInterval(a.timer) // simula servidor travado: para de renovar
  const b = new Trava(1, { instancia: 'B2', ...rapido })
  const t0 = Date.now()
  assert.equal(await b.obter(), true)
  assert.ok(Date.now() - t0 >= 900, 'B só pegou depois de a trava expirar')
  assert.equal(await a.renovar(), false, 'A percebe que perdeu')
  assert.equal(a.minha, false)
  assert.match(perdeu, /outro servidor/)
  await b.liberar()
}

// 5) banco fora: depois de perdaMs sem renovar, desliga antes de a trava expirar para os outros
{
  let perdeu = null
  let quebrado = false
  const qFalha = (sql, p) => quebrado ? Promise.reject(new Error('banco fora')) : q(sql, p)
  const a = new Trava(1, { instancia: 'A3', q: qFalha, ...rapido, vidaMs: 100000, aoPerder: (m) => { perdeu = m } })
  assert.equal(await a.tentar(), true)
  quebrado = true
  await assert.rejects(a.renovar())
  assert.equal(a.minha, true, 'ainda dentro do prazo')
  await espera(700)
  await assert.rejects(a.renovar())
  assert.equal(a.minha, false, 'desligou depois de perdaMs sem banco')
  assert.match(perdeu, /sem falar com o banco/)
  quebrado = false
  await q("UPDATE repasse.kv SET valor = valor || '{\"liberada\": true}'::jsonb WHERE chave = $1", [chaveTrava(1)])
}

// 6) Conexao: espera a trava sem abrir socket; perde a trava -> end(), sem logout; SIGTERM -> end() e libera
{
  const { conexao } = await import('../src/whatsapp.js')
  const { comConta } = await import('../src/contexto.js')
  await comConta(1, async () => {
    const dona = new Trava(1, { instancia: 'OUTRO', ...rapido })
    assert.equal(await dona.tentar(), true)
    const c = conexao(1)
    const ligando = c.iniciar() // como a reconexão/vigia: sem a trava, não pode abrir socket
    await espera(300)
    assert.equal(c.estado.status, 'aguardando-trava')
    assert.equal(c.sock, null, 'não abriu socket sem a trava')
    c.trava.cancelar(); await ligando
    await dona.liberar()

    // assume a trava e simula um socket conectado
    assert.equal(await c.trava.tentar(), true)
    let fim = 0; let saiu = 0
    c.sock = { end: () => { fim++ }, logout: async () => { saiu++ } }
    // outro servidor toma a trava (ex.: a nossa expirou): renovar descobre e solta o socket
    c.parado = true // não tenta religar no teste
    await q(`UPDATE repasse.kv SET valor = '{"instancia":"INVASOR"}'::jsonb, atualizado = now() WHERE chave = $1`, [chaveTrava(1)])
    assert.equal(await c.trava.renovar(), false)
    assert.equal(fim, 1, 'socket fechado com end()')
    assert.equal(saiu, 0, 'nunca logout()')
    assert.equal(c.sock, null)

    // desligamento (SIGTERM)
    await q("UPDATE repasse.kv SET valor = valor || '{\"liberada\": true}'::jsonb WHERE chave = $1", [chaveTrava(1)])
    assert.equal(await c.trava.tentar(), true)
    c.sock = { end: () => { fim++ }, logout: async () => { saiu++ } }
    await c.encerrar()
    assert.equal(fim, 2, 'encerrar() usa end()')
    assert.equal(saiu, 0, 'encerrar() nunca chama logout()')
    assert.equal((await linha()).valor.liberada, true, 'trava liberada no desligamento')
    assert.equal(c.trava.minha, false)
  })
}

// 6b) WHATSAPP_DESLIGADO=1: não espera trava nem abre socket
{
  const { conexao } = await import('../src/whatsapp.js')
  const { comConta } = await import('../src/contexto.js')
  await comConta(1, async () => {
    process.env.WHATSAPP_DESLIGADO = '1'
    const c = conexao(1)
    c.parado = false
    await c.ligar()
    assert.equal(c.estado.status, 'desligado')
    assert.equal(c.sock, null)
    assert.equal(c.trava.minha, false)
    delete process.env.WHATSAPP_DESLIGADO
  })
}

// 7) logs da libsignal com o objeto da sessão não passam; o resto passa
{
  const { ehLogDeSessao } = await import('../src/silenciar-libsignal.js')
  const saidas = []
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s, ...r) => { saidas.push(String(s)); return true }
  console.info('Closing session:', { privKey: Buffer.from('segredo') })
  console.info('Opening session:', { privKey: Buffer.from('segredo') })
  console.log('linha normal')
  process.stdout.write = orig
  assert.ok(!saidas.join('').includes('segredo'), 'objeto da sessão não foi impresso')
  assert.ok(saidas.join('').includes('linha normal'))
  assert.equal(ehLogDeSessao('Removing old closed session:'), true)
  assert.equal(ehLogDeSessao('Failed to decrypt message with any known session...'), false)
}

console.log('✓ trava: uma conexão por vez, espera de transição, expiração, banco fora, end() sem logout no SIGTERM, logs sem chaves')
fs.rmSync(DIR, { recursive: true, force: true })
process.exit(0)
