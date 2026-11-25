// Mantém o serviço acordado só no horário útil (v2.24).
// No plano grátis do Render o serviço dorme 15 min depois do último acesso e a cota é de 750 h por mês para o
// workspace inteiro. O Repasse precisa ficar acordado para ouvir os grupos do WhatsApp, mas os envios dele só
// acontecem das 07:00 às 22:00 (config.envio), e as mensagens da madrugada não se perdem: o WhatsApp as entrega
// ao reconectar e o Repasse as processa como "atrasadas" (pipeline.processarAtrasadas, últimas 24 h).
// Então: ping no próprio endereço público a cada 10 min só dentro da janela (padrão 06:30–22:30, horário de
// Brasília). Fora dela o serviço dorme sozinho; qualquer acesso o acorda. Às 06:30 quem acorda é o GitHub
// Actions (.github/workflows/acordar.yml).
// 16 h × 31 dias ≈ 500 h/mês, contra ~744 h ligado direto.
// Variáveis: KEEPALIVE=0 desliga; KEEPALIVE_JANELA="06:30-22:30" (ou "00:00-24:00" para 24 h); KEEPALIVE_URL.

const FUSO = 'America/Sao_Paulo';

function minutosDoDia(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const v = (t) => Number(p.find((x) => x.type === t).value);
  return v('hour') * 60 + v('minute');
}

function lerJanela(txt = process.env.KEEPALIVE_JANELA || '06:30-22:30') {
  const m = String(txt).trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) return { inicio: 6 * 60 + 30, fim: 22 * 60 + 30 };
  return { inicio: +m[1] * 60 + +m[2], fim: +m[3] * 60 + +m[4] };
}

function dentroDaJanela(d = new Date(), janela = lerJanela()) {
  const t = minutosDoDia(d);
  const { inicio, fim } = janela;
  return inicio <= fim ? t >= inicio && t < fim : t >= inicio || t < fim; // janela que atravessa a meia-noite
}

let timer = null;
function iniciar(urlPublica) {
  const url = (process.env.KEEPALIVE_URL || urlPublica || '').replace(/\/+$/, '');
  if (timer || process.env.KEEPALIVE === '0' || !/^https:\/\//.test(url)) return false;
  const janela = lerJanela();
  timer = setInterval(() => {
    if (dentroDaJanela(new Date(), janela)) fetch(url + '/health').catch(() => {});
  }, 10 * 60e3);
  timer.unref();
  const hm = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  console.log(`Mantendo o serviço acordado das ${hm(janela.inicio)} às ${hm(janela.fim)} (Brasília), ping a cada 10 min.`);
  return true;
}

module.exports = { iniciar, dentroDaJanela, lerJanela, minutosDoDia };
