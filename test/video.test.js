// v2.23: "Gerar vídeo" do carro — monta um vídeo de verdade com FFmpeg (pula se o FFmpeg não estiver instalado).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'giro-video-'));
process.env.GIROAUTO_SKIP_WA_AUTO = '1';
const FF = process.env.FFMPEG_PATH || 'ffmpeg';
const temFF = spawnSync(FF, ['-version']).status === 0;
const { run } = require('../src/db');
const VID = require('../src/video');
const T = require('../src/team');
const sharp = require('sharp');

run("INSERT INTO stores (id, name, slug, feed_key, city, state, whatsapp) VALUES (1, 'topcar', 'topcar', 'k', 'Assis Chateaubriand', 'PR', '5544999158307')");
run("INSERT INTO users (id, store_id, name, email, pass_hash, role) VALUES (1, 1, 'Darlan', 'd@x', 'x', 'admin')");
run("INSERT INTO meta_connections (store_id, whatsapp_number) VALUES (1, '5544920058494')");
run("INSERT INTO vehicles (id, store_id, marca, modelo, versao, ano_fab, ano_modelo, cor, cambio, preco, preco_oferta, status) VALUES (6, 1, 'Volkswagen', 'Jetta', 'Highline 2.0 TSI', 2012, 2013, 'Preto', 'Automático', 67900, 64900, 'publicado')");
const user = { id: 1, storeId: 1, name: 'Darlan', perms: T.permsOf({ role: 'admin' }) };

test('padrão: WhatsApp das campanhas, fotos e músicas da biblioteca', async () => {
  const media = path.join(process.env.DATA_DIR, 'media'); fs.mkdirSync(media, { recursive: true });
  const cores = ['#203040', '#604020', '#305030'];
  for (const [i, c] of cores.entries()) {
    const f = `${String(i).repeat(32)}.jpg`;
    await sharp({ create: { width: 1080, height: 1080, channels: 3, background: c } }).jpeg().toFile(path.join(media, f));
    run('INSERT INTO photos (vehicle_id, filename, mime, position) VALUES (6, ?, ?, ?)', f, 'image/jpeg', i);
  }
  const v = require('../src/vehicles').findVehicle(1, 6);
  const p = VID.padrao(1, v);
  assert.equal(p.whatsapp, '5544920058494', 'usa o WhatsApp das campanhas (oficial), não o da loja');
  assert.equal(p.fotos.length, 3);
  assert.equal(p.fotos[0].legenda, 'Preto · Automático');
  assert.equal(p.padrao.length, 5);
  assert.ok(p.padrao.every((m) => fs.existsSync(path.join(__dirname, '..', 'assets', 'musicas', `${m.id}.m4a`))));
});

test('gera o vídeo de 15 s, vertical, com áudio', { skip: !temFF && 'FFmpeg não instalado' }, async () => {
  const fotos = [0, 1, 2].map((i) => ({ file: `${String(i).repeat(32)}.jpg`, legenda: ['Preto · Automático', 'Teto solar', ''][i] }));
  const j = VID.gerar(user, 6, { fotos, whatsapp: '5544920058494', titulo: 'VW JETTA HIGHLINE', sub: '2012/2013', musica: { tipo: 'padrao', id: 'rock', inicio: 5 } });
  let s;
  for (let i = 0; i < 240; i++) { s = VID.situacao(user, j.id); if (['pronto', 'erro'].includes(s.status)) break; await new Promise((r) => setTimeout(r, 500)); }
  assert.equal(s.status, 'pronto', s.erro);
  const a = VID.arquivo(user, j.id);
  const probe = spawnSync(FF.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace('ffmpeg', 'ffprobe')), ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', a.path]);
  const info = JSON.parse(String(probe.stdout));
  assert.ok(Math.abs(Number(info.format.duration) - 15) < 0.3, `duração ${info.format.duration}`);
  const vid = info.streams.find((x) => x.codec_type === 'video');
  assert.deepEqual([vid.width, vid.height], [720, 1280]);
  assert.ok(info.streams.some((x) => x.codec_type === 'audio'));
  assert.throws(() => VID.situacao({ ...user, storeId: 2 }, j.id), /não encontrado/, 'outra loja não vê o vídeo');
});

test('menos de 2 fotos não gera', () => {
  assert.throws(() => VID.gerar(user, 6, { fotos: [{ file: `${'0'.repeat(32)}.jpg` }] }), /2 fotos/);
});
