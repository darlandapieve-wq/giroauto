// Ponto de entrada: restaura os dados do Supabase (se configurado), abre o banco e inicia o servidor.
const memoria = require('./memoria'); // primeiro: configura o sharp antes de qualquer uso
const config = require('./config');
const storage = require('./storage');
memoria.iniciarMonitor();

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

  // v2.24: Repasse no mesmo serviço (REPASSE_INTERNO=1), antes do server para o REPASSE_URL já valer
  const repasse = require('./repasse-processo');
  repasse.iniciar();

  const app = require('./server');
  storage.markDirty(); // envia a primeira cópia (inclui migrações de versão)
  const server = app.listen(config.port, () => {
    console.log(`GiroAuto rodando em ${config.publicUrl} (porta ${config.port})`);
    // Gera as imagens que faltam para os veículos em estoque (arte e, com a chave da IA, estacionamento).
    // só mantém acordado se o Repasse estiver aqui; a Loja sozinha pode dormir como sempre
    if (repasse.ativo()) require('./acordado').iniciar(config.publicUrl);
    try { require('./arts').startTimer(); const n = require('./arts').backfill(); if (n) console.log(`Conferindo imagens de ${n} veículo(s).`); } catch (e) { console.error('Imagens:', e.message); }
  });

  let closing = false;
  const shutdown = async (sig) => {
    if (closing) return; closing = true;
    console.log(`${sig} recebido: salvando os dados antes de desligar…`);
    server.close();
    // os dois em paralelo: a Loja salva a cópia, o Repasse fecha o WhatsApp e libera a trava
    await Promise.all([
      storage.flush().then(() => console.log('Dados salvos.'), (e) => console.error('Falha ao salvar:', e.message)),
      repasse.parar(),
    ]);
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
})();
