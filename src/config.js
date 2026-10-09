const path = require('node:path');
const fs = require('node:fs');

const envFile = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envFile) && !process.env.GIROAUTO_SKIP_ENV) {
  try { process.loadEnvFile(envFile); } catch (e) { console.warn('Não foi possível ler .env:', e.message); }
}

const env = process.env;

const config = {
  port: Number(env.PORT || 3333),
  publicUrl: (env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : '') || `http://localhost:${env.PORT || 3333}`).replace(/\/+$/, ''),
  sessionSecret: env.SESSION_SECRET || 'dev-secret-change-me',
  dataDir: path.resolve(env.DATA_DIR || './data'),
  meta: {
    appId: env.META_APP_ID || '',
    appSecret: env.META_APP_SECRET || '',
    loginConfigId: env.META_LOGIN_CONFIG_ID || '',
    apiVersion: env.META_API_VERSION || 'v25.0',
    graphUrl: (env.META_GRAPH_URL || 'https://graph.facebook.com').replace(/\/+$/, ''),
    dialogUrl: (env.META_DIALOG_URL || 'https://www.facebook.com').replace(/\/+$/, ''),
    // Permissões aceitas por um app com o caso de uso "Criar e gerenciar anúncios com a API de Marketing".
    scopes: [
      'ads_management',
      'ads_read',
      'business_management',
      'pages_show_list',
      'pages_read_engagement',
    ],
    // Permissões opcionais: só pedidas se o administrador ligar no painel (exigem outro caso de uso no app).
    optionalScopes: {
      catalogo: { label: 'Catálogo de veículos (caso de uso "Gerenciar catálogos" no app da Meta)', scopes: ['catalog_management'] },
      instagram: { label: 'Publicar no Instagram (caso de uso "Gerenciar mensagens e conteúdo no Instagram" no app da Meta)', scopes: ['instagram_basic', 'instagram_content_publish'] },
    },
    extraScopes: [],
  },
  republishDays: Number(env.REPUBLISH_DAYS || 7),
};

if (config.sessionSecret === 'dev-secret-change-me' && env.NODE_ENV === 'production') {
  throw new Error('Defina SESSION_SECRET no .env antes de rodar em produção.');
}

module.exports = config;
