const flow = require('./flow');
const secretary = require('./secretary');
const { wasSentByBot } = require('../services/evolutionApi');
const { samePhone } = require('../services/phone');
const { getPausas, savePausas } = require('../services/db');

const SECRETARY_NUMBER = (process.env.SECRETARY_NUMBER || '').replace(/\D/g, '');

// Janela de agrupamento: ms de silêncio após a última mensagem antes de
// processar o "bloco" de mensagens como um só contexto.
const GROUP_WINDOW_MS = parseInt(process.env.MESSAGE_GROUP_WINDOW_MS || '5000', 10);
// Pausa do bot quando a conversa está em "atendimento humano": a secretária
// respondeu manualmente OU o paciente foi transferido a ela. Renovada a cada
// resposta manual da secretária. Default 3 dias (259200000).
const TAKEOVER_PAUSE_MS = parseInt(process.env.TAKEOVER_PAUSE_MS || '259200000', 10);
// Após este tempo de inatividade, a conversa "expira" e o fluxo recomeça do
// zero na próxima mensagem (default 6h). 0 desliga o reinício automático.
const SESSION_RESET_MS = parseInt(process.env.SESSION_RESET_MS || '21600000', 10);

// Sessões em memória, indexadas pelo JID do paciente.
// Reiniciam quando o processo/container é reiniciado.
const sessions = {};

// Buffers de agrupamento por JID: { texts: [], timer }.
const buffers = {};

// Conversas em atendimento humano: JID -> timestamp (ms) de expiração.
// Persistido em data/pausas.json para sobreviver a reinícios do bot.
const pausedUntil = loadPausas();

// Carrega as pausas salvas, descartando as que já expiraram.
function loadPausas() {
  const saved = getPausas();
  const now = Date.now();
  const clean = {};
  for (const [jid, until] of Object.entries(saved)) {
    if (until > now) clean[jid] = until;
  }
  return clean;
}

// (Re)inicia a pausa de atendimento humano para a conversa e persiste em disco.
function pausar(jid) {
  pausedUntil[jid] = Date.now() + TAKEOVER_PAUSE_MS;
  savePausas(pausedUntil);
}

function isPaused(jid) {
  const until = pausedUntil[jid];
  if (!until) return false;
  if (Date.now() >= until) {
    delete pausedUntil[jid];
    savePausas(pausedUntil);
    return false;
  }
  return true;
}

// Cancela qualquer bloco de mensagens em espera para o JID.
function clearBuffer(jid) {
  const buf = buffers[jid];
  if (buf && buf.timer) clearTimeout(buf.timer);
  delete buffers[jid];
}

// Processa o bloco acumulado de mensagens como uma única entrada.
async function flushBuffer(jid) {
  const buf = buffers[jid];
  if (!buf) return;
  delete buffers[jid];

  // Se a secretária assumiu enquanto o bloco aguardava, não responde.
  if (isPaused(jid)) return;

  const text = buf.texts.join('\n').trim();
  if (!text) return;

  // Conversa parada por muito tempo: descarta a sessão p/ recomeçar do início.
  const existing = sessions[jid];
  if (
    existing &&
    SESSION_RESET_MS > 0 &&
    Date.now() - (existing.lastActivity || 0) > SESSION_RESET_MS
  ) {
    delete sessions[jid];
  }

  if (!sessions[jid]) {
    sessions[jid] = flow.createSession(buf.number, buf.pushName);
  }
  sessions[jid].lastActivity = Date.now();

  try {
    await flow.handle(jid, text, sessions[jid]);
    // Paciente transferido à secretária: silencia o bot nessa conversa
    // (atendimento em andamento), para não repetir o fluxo nos próximos dias.
    if (sessions[jid] && sessions[jid].transferred) {
      pausar(jid);
    }
  } catch (err) {
    console.error('[messageHandler] Erro processando mensagem:', err.message);
  }
}

// Acumula a mensagem e (re)agenda o processamento do bloco.
function bufferMessage(jid, number, pushName, text) {
  if (!buffers[jid]) buffers[jid] = { texts: [], timer: null, number, pushName };
  const buf = buffers[jid];
  buf.number = number;
  if (pushName) buf.pushName = pushName;
  buf.texts.push(text);
  if (buf.timer) clearTimeout(buf.timer);
  buf.timer = setTimeout(() => {
    flushBuffer(jid).catch((err) =>
      console.error('[messageHandler] Erro no flushBuffer:', err.message)
    );
  }, GROUP_WINDOW_MS);
}

// Ponto de entrada para uma mensagem do webhook.
// payload: { jid, number, text, fromMe, messageId, pushName }
async function handleMessage({ jid, number, text, fromMe, messageId, pushName }) {
  if (!jid) return;
  const cleanNumber = (number || '').replace(/\D/g, '');

  // ---- Mensagens fromMe (enviadas pelo número da clínica) ----
  if (fromMe) {
    // Eco das mensagens que o próprio bot enviou: ignora.
    if (wasSentByBot(messageId)) return;
    // Caso contrário, a secretária digitou manualmente para este cliente:
    // pausa o bot nessa conversa e cancela qualquer resposta pendente.
    pausar(jid);
    clearBuffer(jid);
    console.log(
      `[messageHandler] Atendimento manual detectado para ${jid}; ` +
        `bot em silêncio por ${Math.round(TAKEOVER_PAUSE_MS / 86400000)} dia(s).`
    );
    return;
  }

  if (!text) return;

  // Comandos da secretária (#botox ...) têm prioridade e não entram no buffer.
  if (samePhone(cleanNumber, SECRETARY_NUMBER) && text.trim().toLowerCase().startsWith('#botox')) {
    await secretary.handleBotoxCommand(text);
    return;
  }

  // Conversa pausada (secretária assumiu): bot permanece em silêncio.
  if (isPaused(jid)) {
    return;
  }

  // Agrupa mensagens em sequência e responde uma única vez.
  bufferMessage(jid, cleanNumber, pushName, text);
}

module.exports = { handleMessage, sessions };
