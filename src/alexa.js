// Skill da Alexa para o GiroAuto (v2.15.1): gera o modelo de interação (pt-BR) e o código da skill "Alexa-hosted"
// já com a chave do usuário. A loja cola os dois no console da Amazon (developer.amazon.com/alexa) e usa nos seus Echo.
const EXEMPLOS = [
  'o jetta dois mil e treze preto ficou pronto na oficina e está no pátio',
  'inclua uma pendência de preparação da ecosport dois mil e nove de realizar alinhamento e balanceamento',
  'a conta de energia da loja foi paga',
  'o gol branco foi para a funilaria',
  'o onix prata voltou para o pátio',
  'trocar a lâmpada do farol do corolla',
  'a conta de internet foi paga',
  'o hb vinte foi para o lavador',
  'a polimento da hilux ficou pronto',
  'pagamos o aluguel da loja',
];

function modelo(invocacao = 'giro auto') {
  return {
    interactionModel: {
      languageModel: {
        invocationName: String(invocacao || 'giro auto').toLowerCase().replace(/[^a-zà-ú ]/g, '').trim() || 'giro auto',
        intents: [
          { name: 'ComandoIntent', slots: [{ name: 'texto', type: 'FRASE_LIVRE' }], samples: ['{texto}', 'anota que {texto}', 'registra que {texto}', 'avisa que {texto}', 'atualiza que {texto}'] },
          { name: 'AMAZON.CancelIntent', samples: [] },
          { name: 'AMAZON.HelpIntent', samples: [] },
          { name: 'AMAZON.StopIntent', samples: [] },
          { name: 'AMAZON.NavigateHomeIntent', samples: [] },
        ],
        types: [{ name: 'FRASE_LIVRE', values: EXEMPLOS.map((value) => ({ name: { value } })) }],
      },
    },
  };
}

function codigo({ url, chave }) {
  return `// Skill GiroAuto para Alexa: manda o que você falou para o GiroAuto e lê a resposta.
// Gerado pelo GiroAuto. A chave abaixo age com as permissões do seu usuário; não compartilhe.
const https = require('https');
const URL_GIROAUTO = ${JSON.stringify(url)};
const CHAVE = ${JSON.stringify(chave)};

function enviar(texto) {
  return new Promise((ok) => {
    const body = JSON.stringify({ texto, origem: 'alexa' });
    const u = new URL(URL_GIROAUTO);
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST', timeout: 7000,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + CHAVE, 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { ok(JSON.parse(d).fala || 'Pronto.'); } catch (e) { ok('Não consegui falar com o GiroAuto agora.'); } });
    });
    req.on('timeout', () => { req.destroy(); ok('O GiroAuto demorou para responder. Confira no painel em instantes.'); });
    req.on('error', () => ok('Não consegui falar com o GiroAuto agora.'));
    req.end(body);
  });
}

function falar(texto, terminar = true) {
  const r = { outputSpeech: { type: 'PlainText', text: texto }, shouldEndSession: terminar };
  if (!terminar) r.reprompt = { outputSpeech: { type: 'PlainText', text: 'Pode falar.' } };
  return { version: '1.0', response: r };
}

exports.handler = async (event) => {
  const r = (event && event.request) || {};
  if (r.type === 'LaunchRequest') return falar('GiroAuto aqui. O que aconteceu na loja?', false);
  if (r.type === 'IntentRequest') {
    const nome = r.intent && r.intent.name;
    if (nome === 'ComandoIntent') {
      const texto = r.intent.slots && r.intent.slots.texto && r.intent.slots.texto.value;
      if (!texto) return falar('Não entendi. Pode repetir?', false);
      return falar(await enviar(texto));
    }
    if (nome === 'AMAZON.HelpIntent') return falar('Diga, por exemplo: o Jetta preto está no pátio. Ou: a conta de energia foi paga.', false);
    return falar('Até mais!');
  }
  return falar('Até mais!');
};
`;
}

function pacote({ url, chave, invocacao }) {
  const m = modelo(invocacao);
  return { invocacao: m.interactionModel.languageModel.invocationName, modelo: JSON.stringify(m, null, 2), codigo: codigo({ url, chave }) };
}

module.exports = { modelo, codigo, pacote };
