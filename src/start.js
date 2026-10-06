// Ponto de entrada: restaura os dados do Supabase (se configurado), abre o banco e inicia o servidor.
const config = require('./config');
const storage = require('./storage');

(async () => {
  if (storage.enabled()) {
    try {
      const r = await storage.restore();
      console.log(r.restored ? `Dados restaurados do Supabase (${Math.round(r.bytes / 1024)} KB).` : `Supabase: ${r.reason}. Começando com o banco local.`);
    } catch (e) {
      // Sem a cópia, abrir um banco vazio e depois enviá-lo apagaria os dados guardados. Melhor não iniciar.
      console.error('Não foi possível restaurar os dados do Supabase:', e.message);
      console.error('O servidor não vai iniciar para não sobrescrever a cópia guardada. Confira SUPABASE_URL e SUPABASE_SECRET_KEY.');
      process.exit(1);
    }
  } else {
    console.log('Aviso: SUPABASE_URL/SUPABASE_SECRET_KEY não configurados. Os dados ficam só no disco deste servidor.');
  }

  const app = require('./server');
  storage.markDirty(); // envia a primeira cópia (inclui migrações de versão)
  const server = app.listen(config.port, () => console.log(`GiroAuto rodando em ${config.publicUrl} (porta ${config.port})`));

  let closing = false;
  const shutdown = async (sig) => {
    if (closing) return; closing = true;
    console.log(`${sig} recebido: salvando os dados antes de desligar…`);
    server.close();
    try { await storage.flush(); console.log('Dados salvos.'); } catch (e) { console.error('Falha ao salvar:', e.message); }
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
})();
