const { sendText } = require('../services/evolutionApi');
const { saveBotox, getBotoxRecords, getClientByNumber } = require('../services/db');
const { normalizeBR } = require('../services/phone');
const { load: loadConfig } = require('../services/config');

const SECRETARY_NUMBER = process.env.SECRETARY_NUMBER;

// Soma `n` meses a uma data, ajustando overflow de fim de mês.
function addMonths(date, n) {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + n);
  // Se o dia "estourou" (ex.: 31 -> mês com 30), volta para o último dia do mês alvo.
  if (d.getDate() < day) {
    d.setDate(0);
  }
  return d;
}

// Formata data como DD/MM/AAAA.
function formatDate(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// Notifica a secretária sobre um novo atendimento (após a recepção completa).
async function notifyNewAppointment({ name, number, reason, birthday }) {
  let msg =
    `📋 *Novo atendimento*\n` +
    `👤 *Paciente:* ${name || 'Não cadastrado'}\n` +
    `📱 *Número:* ${number}\n`;
  if (birthday) msg += `🎂 *Nascimento:* ${birthday}\n`;
  msg += `💬 *Motivo:* ${reason}`;
  try {
    await sendText(SECRETARY_NUMBER, msg, { delay: 0 });
  } catch (err) {
    console.error('[secretary] Falha ao notificar secretária:', err.message);
  }
}

// Processa comandos #botox vindos do número da secretária.
// Suporta:
//   #botox 5511999999999  -> registra paciente
//   #botox lista          -> lista registros
async function handleBotoxCommand(text) {
  const parts = text.trim().split(/\s+/);
  const arg = (parts[1] || '').toLowerCase();

  // Listagem
  if (arg === 'lista') {
    const records = getBotoxRecords();
    if (records.length === 0) {
      await sendText(SECRETARY_NUMBER, '💉 Nenhum registro de botox cadastrado ainda.', { delay: 0 });
      return;
    }
    const lines = records.map((r, i) => {
      const client = getClientByNumber(r.number);
      const who = client && client.name ? client.name : 'não cadastrado';
      return (
        `${i + 1}. 👤 *${who}* — 📱 ${r.number}\n` +
        `   aplicado em ${r.date}, próximo lembrete: ${r.nextReminder}`
      );
    });
    await sendText(SECRETARY_NUMBER, `💉 *Registros de Botox*\n\n${lines.join('\n\n')}`, { delay: 0 });
    return;
  }

  // Cadastro: o argumento deve ser um número (normalizado p/ o nono dígito)
  const number = normalizeBR((parts[1] || '').replace(/\D/g, ''));
  if (!number) {
    await sendText(
      SECRETARY_NUMBER,
      'Uso: `#botox 5511999999999` para registrar ou `#botox lista` para listar.',
      { delay: 0 }
    );
    return;
  }

  const cfg = loadConfig();
  const months = (cfg.disparos && cfg.disparos.botox && cfg.disparos.botox.intervaloMeses) || 4;
  const now = new Date();
  const nextReminder = addMonths(now, months);

  saveBotox({
    number,
    date: formatDate(now),
    nextReminder: formatDate(nextReminder),
  });

  await sendText(
    SECRETARY_NUMBER,
    `✅ Botox registrado para ${number}.\n` +
      `📅 Aplicado em: ${formatDate(now)}\n` +
      `🔔 Próximo lembrete: ${formatDate(nextReminder)}`,
    { delay: 0 }
  );
}

module.exports = { notifyNewAppointment, handleBotoxCommand, addMonths, formatDate };
