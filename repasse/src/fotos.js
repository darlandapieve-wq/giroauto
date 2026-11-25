// Banco de fotos dos anúncios (guardadas redimensionadas no Postgres)
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { q, um, todos } from './db.js'
import { recortarFotos } from './recorte.js'
import { contaId } from './contexto.js'

export async function prepararFoto (buf) {
  const img = sharp(buf).rotate().resize({ width: 1080, height: 1080, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 72, mozjpeg: true })
  const { data, info } = await img.toBuffer({ resolveWithObject: true })
  return { data, largura: info.width, altura: info.height }
}

// Vídeo no lugar de foto: tira alguns quadros (JPEG) espalhados pelo vídeo, que seguem como fotos normais
// (capa, placa borrada, envio e vitrine). O vídeo em si não é guardado nem reenviado (banda e banco).
const exec = promisify(execFile)
export async function quadrosDoVideo (buf, n = 4) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-'))
  try {
    const arq = path.join(dir, 'v.mp4')
    await fs.writeFile(arq, buf)
    let dur = 0
    try {
      const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', arq], { timeout: 20e3 })
      dur = Number(stdout.trim()) || 0
    } catch {}
    const tempos = dur > 1 ? Array.from({ length: n }, (_, i) => dur * (0.1 + 0.8 * i / Math.max(1, n - 1))) : [0]
    const out = []
    for (const [i, t] of tempos.entries()) {
      const jpg = path.join(dir, `q${i}.jpg`)
      try {
        await exec('ffmpeg', ['-v', 'error', '-ss', t.toFixed(2), '-i', arq, '-frames:v', '1', '-q:v', '3', '-y', jpg], { timeout: 30e3 })
        out.push(await fs.readFile(jpg))
      } catch {}
    }
    return out
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

export async function miniaturaParaIA (buf) {
  return sharp(buf).resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer()
}

export async function salvarFotos (anuncioId, buffers) {
  const ids = []
  for (let i = 0; i < buffers.length; i++) {
    const { data, largura, altura } = await prepararFoto(buffers[i])
    const id = crypto.randomUUID()
    await q(`INSERT INTO repasse.fotos (id, anuncio_id, ordem, capa, largura, altura, bytes, dados)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, anuncioId, i, i === 0, largura, altura, data.length, data])
    ids.push(id)
  }
  return ids
}

export const listarFotos = (anuncioId) =>
  todos('SELECT id, ordem, capa, largura, altura, bytes, placa_status FROM repasse.fotos WHERE anuncio_id = $1 ORDER BY ordem', [anuncioId])

export async function lerFoto (id, publico = false) {
  if (!/^[0-9a-f-]{36}$/.test(String(id))) return null
  const r = await um(`SELECT ${publico ? 'COALESCE(f.dados_publico, f.dados)' : 'f.dados'} AS dados FROM repasse.fotos f JOIN repasse.anuncios a ON a.id = f.anuncio_id WHERE f.id = $1 AND a.conta_id = $2`, [id, contaId()])
  return r ? Buffer.from(r.dados) : null
}

export async function fotoCapa (anuncioId) {
  // versão pública (placa borrada) quando houver
  const r = await um('SELECT COALESCE(dados_publico, dados) AS dados FROM repasse.fotos WHERE anuncio_id = $1 ORDER BY capa DESC, ordem LIMIT 1', [anuncioId])
  return r ? Buffer.from(r.dados) : null
}

export async function definirCapa (anuncioId, fotoId) {
  await q('UPDATE repasse.fotos SET capa = (id = $2) WHERE anuncio_id = $1', [anuncioId, fotoId])
}

export const apagarFoto = (id) => /^[0-9a-f-]{36}$/.test(String(id)) ? q('DELETE FROM repasse.fotos WHERE id = $1 AND anuncio_id IN (SELECT id FROM repasse.anuncios WHERE conta_id = $2)', [id, contaId()]) : null

// Recorta prints (várias fotos empilhadas, barras, hora) e devolve a lista final de fotos
export async function recortarTodas (buffers, max = 12) {
  const out = []
  for (const b of buffers) {
    if (out.length >= max) break
    try { out.push(...(await recortarFotos(b))) } catch { out.push(b) }
  }
  return out.slice(0, max)
}

// Aplica o recorte nas fotos de anúncios que já existem (fila e circulação)
export async function recortarExistentes (max = 12) {
  const ads = await todos(`SELECT DISTINCT a.id FROM repasse.anuncios a JOIN repasse.fotos f ON f.anuncio_id = a.id
    WHERE a.conta_id = $1 AND a.status IN ('pendente','aprovado','circulando','enviado')`, [contaId()])
  let mudaram = 0
  for (const { id } of ads) {
    const fs = await todos('SELECT dados FROM repasse.fotos WHERE anuncio_id = $1 ORDER BY capa DESC, ordem', [id])
    const originais = fs.map(f => Buffer.from(f.dados))
    const novas = await recortarTodas(originais, max)
    const igual = novas.length === originais.length && novas.every((b, i) => b === originais[i])
    if (igual) continue
    await q('DELETE FROM repasse.fotos WHERE anuncio_id = $1', [id])
    await salvarFotos(id, novas)
    mudaram++
  }
  return { anuncios: ads.length, recortados: mudaram }
}
