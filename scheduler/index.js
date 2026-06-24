const cron = require('node-cron');
const { sendText } = require('../services/evolutionApi');
const { getClients, getBotoxRecords, saveBotox } = require('../services/db');
const { addMonths, formatDate } = require('../handlers/secretary');
const { guessGender } = require('../services/gender');
const { load: loadConfig, render } = require('../services/config');

const TZ = 'America/Sao_Paulo';

// ---------- Helpers de data ----------

// Calcula a data da Páscoa (domingo) para um ano usando o algoritmo de Butcher (Gauss).
function easterDate(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = março, 4 = abril
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// Retorna a data do 2º domingo de maio (Dia das Mães) para um ano.
function mothersDay(year) {
  const d = new Date(year, 4, 1); // 1º de maio
  const firstSunday = 1 + ((7 - d.getDay()) % 7);
  return new Date(year, 4, firstSunday + 7);
}

// Compara se duas datas têm o mesmo dia e mês.
function sameDayMonth(a, b) {
  return a.getDate() === b.getDate() && a.getMonth() === b.getMonth();
}

// Retorna a data "de hoje" no fuso de São Paulo (como objeto Date local equivalente).
function todayInTz() {
  const str = new Date().toLocaleString('en-US', { timeZone: TZ });
  return new Date(str);
}

// ---------- Envio para todos os clientes ----------

// Envia `message` aos clientes. `filter` (opcional) restringe o público.
async function broadcast(message, filter) {
  const clients = getClients();
  for (const c of clients) {
    if (filter && !filter(c)) continue;
    try {
      await sendText(c.number, message, { delay: 0 });
    } catch (err) {
      console.error(`[scheduler] Falha ao enviar para ${c.number}:`, err.message);
    }
  }
}

// Filtros de público para datas com restrição.
const isWoman = (c) => guessGender(c.name) === 'F';
const isMother = (c) => guessGender(c.name) === 'F' && c.hasChildren === true;

// ---------- Tarefas (mensagens vêm de data/clinica.json -> disparos) ----------

// 08h: datas comemorativas. Cada comemorativa tem { ativo, texto } no config.
async function runHolidays() {
  const cfg = loadConfig();
  const clinica = cfg.clinica || {};
  const com = (cfg.disparos && cfg.disparos.comemorativas) || {};
  const today = todayInTz();
  const year = today.getFullYear();

  const items = [
    { c: com.natal, date: new Date(year, 11, 25) },
    { c: com.anoNovo, date: new Date(year, 0, 1), extra: { ano: year } },
    { c: com.pascoa, date: easterDate(year) },
    { c: com.diaDaMulher, date: new Date(year, 2, 8), filter: isWoman },
    { c: com.diaDasMaes, date: mothersDay(year), filter: isMother },
  ];

  for (const h of items) {
    if (h.c && h.c.ativo && sameDayMonth(today, h.date)) {
      console.log(`[scheduler] Enviando comemorativa: ${formatDate(h.date)}`);
      await broadcast(render(h.c.texto, clinica, h.extra || {}), h.filter);
    }
  }
}

// 09h: aniversários (compara dia+mês do campo birthday DD/MM/AAAA).
async function runBirthdays() {
  const cfg = loadConfig();
  const aniv = cfg.disparos && cfg.disparos.aniversario;
  if (!aniv || !aniv.ativo) return;
  const clinica = cfg.clinica || {};
  const today = todayInTz();

  for (const c of getClients()) {
    if (!c.birthday) continue;
    const [dd, mm] = String(c.birthday).split('/');
    const day = parseInt(dd, 10);
    const month = parseInt(mm, 10);
    if (day === today.getDate() && month === today.getMonth() + 1) {
      const firstName = String(c.name || '').split(' ')[0] || 'cliente';
      const msg = render(aniv.texto, clinica, { nome: firstName });
      try {
        await sendText(c.number, msg, { delay: 0 });
        console.log(`[scheduler] Aniversário enviado para ${c.number}`);
      } catch (err) {
        console.error(`[scheduler] Falha aniversário ${c.number}:`, err.message);
      }
    }
  }
}

// 10h: lembretes de botox (nextReminder == hoje) e reagenda +intervaloMeses.
async function runBotoxReminders() {
  const cfg = loadConfig();
  const botox = cfg.disparos && cfg.disparos.botox;
  if (!botox || !botox.ativo) return;
  const clinica = cfg.clinica || {};
  const months = botox.intervaloMeses || 4;
  const today = todayInTz();
  const todayStr = formatDate(today);

  for (const r of getBotoxRecords()) {
    if (r.nextReminder === todayStr) {
      const msg = render(botox.texto, clinica, { meses: months });
      try {
        await sendText(r.number, msg, { delay: 0 });
        const next = addMonths(today, months);
        saveBotox({ number: r.number, nextReminder: formatDate(next) });
        console.log(`[scheduler] Lembrete botox enviado para ${r.number}, próximo: ${formatDate(next)}`);
      } catch (err) {
        console.error(`[scheduler] Falha lembrete botox ${r.number}:`, err.message);
      }
    }
  }
}

// ---------- Registro dos crons ----------

function start() {
  cron.schedule('0 8 * * *', runHolidays, { timezone: TZ }); // 08:00 comemorativas
  cron.schedule('0 9 * * *', runBirthdays, { timezone: TZ }); // 09:00 aniversários
  cron.schedule('0 10 * * *', runBotoxReminders, { timezone: TZ }); // 10:00 botox

  console.log(`[scheduler] Agendamentos ativos (fuso ${TZ}): 08h comemorativas, 09h aniversários, 10h botox.`);
}

module.exports = { start, easterDate, mothersDay, runHolidays, runBirthdays, runBotoxReminders };
