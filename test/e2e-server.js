// Sobe o painel com a Meta simulada, para testes manuais ou de navegador.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMock, addDialog } = require('./mock-graph');

const mock = createMock();
addDialog(mock.app);
const mockServer = mock.app.listen(4555, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'giro-e2e-'));
  Object.assign(process.env, {
    GIROAUTO_SKIP_ENV: '1', DATA_DIR: tmp, GIROAUTO_DB: path.join(tmp, 'e2e.db'),
    META_APP_ID: 'e2e', META_APP_SECRET: 'e2e', META_GRAPH_URL: 'http://127.0.0.1:4555', META_DIALOG_URL: 'http://127.0.0.1:4555',
    PUBLIC_URL: 'http://127.0.0.1:4556', PORT: '4556',
  });
  const app = require('../src/server');
  app.listen(4556, () => console.log('e2e pronto em http://127.0.0.1:4556 (Meta simulada na 4555)'));
});
process.on('SIGTERM', () => { mockServer.close(); process.exit(0); });
