// Dados de demonstração (só com --demo e banco vazio): grupos, anunciantes e anúncios de exemplo
import sharp from 'sharp'
import { q, um, todos } from './db.js'
import { montarAnuncio, aprovarAnuncio } from './pipeline.js'
import { EXEMPLOS } from './exemplos.js'
import { contaId } from './contexto.js'

const fotoFake = (txt, cor) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">
  <rect width="100%" height="100%" fill="${cor}"/><rect x="250" y="420" width="700" height="220" rx="60" fill="#fff" opacity=".85"/>
  <circle cx="420" cy="660" r="70" fill="#222"/><circle cx="780" cy="660" r="70" fill="#222"/>
  <text x="600" y="250" font-size="70" font-family="sans-serif" text-anchor="middle" fill="#fff">${txt}</text></svg>`)).jpeg().toBuffer()

export async function semearDemo () {
  const CT = contaId()
  if ((await um('SELECT count(*)::int AS n FROM repasse.grupos WHERE conta_id = $1', [CT])).n > 0) return
  const G = [
    ['demo-marcelo@g.us', 'Carros a Venda – Marcelo Silva', true, false, false, 420, 260, {}],
    ['demo-repasse-oeste@g.us', 'Repasse Oeste PR', true, false, false, 380, 150, {}],
    ['demo-familia@g.us', 'Família', false, false, false, 900, 2, {}],
    ['demo-giroauto@g.us', 'GiroAuto Repasse', false, true, true, 0, 0, {}],
    ['demo-picapes@g.us', 'GiroAuto Picapes', false, true, true, 0, 0, { categorias: ['picape'] }],
    ['demo-ate50@g.us', 'GiroAuto Até 50 mil', false, true, true, 0, 0, { precoMax: 50000 }],
    ['demo-premium@g.us', 'GiroAuto Premium', false, true, true, 0, 0, { premium: 'so', acrescimo: 3000 }]
  ]
  for (const [jid, nome, fonte, destino, admin, msgs, anun, regras] of G) {
    await q(`INSERT INTO repasse.grupos (conta_id, jid, nome, fonte, destino, sou_admin, mensagens, anuncios, regras, participantes, ultimo_anuncio, arquivado)
             VALUES ($11,$1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9, CASE WHEN $7 > 0 THEN now() END, $10)`, [jid, nome, fonte, destino, admin, msgs, anun, JSON.stringify(regras), 50 + msgs % 200, !fonte && !destino, CT])
  }
  const C = [['5545999123456@s.whatsapp.net', 'Marcelo Silva', 140], ['5544988887777@s.whatsapp.net', 'Repasse do Zé', 63], ['5545991112222@s.whatsapp.net', 'Auto Center Toledo', 31]]
  for (const [id, nome, n] of C) await q(`INSERT INTO repasse.contatos (conta_id, id, nome, anuncios, grupos, ultimo_anuncio) VALUES ($4,$1,$2,$3,'["demo-marcelo@g.us"]'::jsonb, now())`, [id, nome, n, CT])
  const cores = ['#3b6ea8', '#a83b3b', '#5f6b73', '#2f2f2f', '#7a6a4f', '#456b45']
  for (const i of [0, 1, 2, 5]) {
    const fotos = [await fotoFake(EXEMPLOS[i].split('\n')[0].replace(/[^\w\s./]/g, '').slice(0, 30), cores[i]), await fotoFake('interior', '#555'), await fotoFake('traseira', cores[i])]
    await montarAnuncio({ texto: EXEMPLOS[i], fotos, origem: { grupoJid: 'demo-marcelo@g.us', grupoNome: 'Carros a Venda – Marcelo Silva', remetenteId: C[i % 3][0], remetenteNome: C[i % 3][1] } })
  }
  await montarAnuncio({ texto: EXEMPLOS[3], origem: { grupoJid: 'demo-marcelo@g.us', grupoNome: 'Carros a Venda – Marcelo Silva', remetenteId: C[1][0], remetenteNome: C[1][1] } })
  // dois já em circulação, para a vitrine e a aba Em circulação terem conteúdo
  const pend = await todos(`SELECT id FROM repasse.anuncios WHERE conta_id = $1 AND status = 'pendente' ORDER BY criado_em LIMIT 2`, [CT])
  for (const { id } of pend) {
    await aprovarAnuncio(id)
    await q(`UPDATE repasse.anuncios SET status = 'circulando', repetir = true, vezes_enviado = 1, ultimo_envio = now(), proximo_envio = now() + interval '24 hours' WHERE id = $1`, [id])
  }
  console.log('  Dados de demonstração criados.')
}
