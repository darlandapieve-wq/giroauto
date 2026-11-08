// Login único Loja → GiroAuto Repasse (v2.19.1). Cabeçalho x-giro-sso = "<ms>.<quem>.<hmac>", assinado com
// GIRO_SSO_SEGREDO (o mesmo valor nos serviços giroauto e giroauto-repasse), válido por 2 minutos no Repasse.
// Só é gerado para o administrador do sistema logado na Loja.
const crypto = require('node:crypto');

const segredo = () => process.env.GIRO_SSO_SEGREDO || '';
const ativo = () => segredo().length >= 32;

function token(quem) {
  if (!ativo()) return '';
  const q = String(quem || 'admin').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'admin';
  const ts = Date.now();
  const sig = crypto.createHmac('sha256', segredo()).update(`${ts}.${q}`).digest('base64url');
  return `${ts}.${q}.${sig}`;
}

// administrador do sistema logado na Loja?
const podeRepasse = (user) => !!user?.id && !!require('./db').get('SELECT is_admin FROM users WHERE id = ?', user.id)?.is_admin;

module.exports = { token, ativo, podeRepasse };
