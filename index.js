require('dotenv').config();

const express = require('express');
const { handleMessage } = require('./handlers/messageHandler');
const scheduler = require('./scheduler');
const { load: loadConfig } = require('./services/config');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Extrai número, texto e metadados de um payload de mensagem da Evolution API.
// Mantém mensagens fromMe (enviadas pelo número da clínica): elas são usadas
// para detectar quando a secretária assume a conversa manualmente.
function parseMessage(data) {
  if (!data) return null;

  const key = data.key || {};
  const fromMe = !!key.fromMe;

  const remoteJid = key.remoteJid || '';
  // Ignora grupos e status broadcast.
  if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid.includes('broadcast')) {
    return null;
  }

  // `number` são só os dígitos (para casar com SECRETARY_NUMBER e usar no
  // "banco"). `jid` é o endereço COMPLETO de resposta — pode ser
  // `...@s.whatsapp.net` (contato salvo) ou `...@lid` (contato não salvo).
  // Responder sempre ao `jid` é o que faz o LID funcionar.
  const number = remoteJid.split('@')[0];
  if (!number) return null;

  const message = data.message || {};

  // Resposta de botão/lista: o WhatsApp entrega num formato próprio. Preferimos
  // o ID do botão (token estável definido por nós); o handler também aceita o
  // texto exibido ou o número da opção, caso os botões tenham caído em fallback.
  const buttonReply =
    (message.buttonsResponseMessage &&
      (message.buttonsResponseMessage.selectedButtonId ||
        message.buttonsResponseMessage.selectedDisplayText)) ||
    (message.templateButtonReplyMessage &&
      (message.templateButtonReplyMessage.selectedId ||
        message.templateButtonReplyMessage.selectedDisplayText)) ||
    (message.listResponseMessage &&
      message.listResponseMessage.singleSelectReply &&
      message.listResponseMessage.singleSelectReply.selectedRowId) ||
    (message.interactiveResponseMessage &&
      message.interactiveResponseMessage.nativeFlowResponseMessage &&
      message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson) ||
    '';

  const text =
    buttonReply ||
    message.conversation ||
    (message.extendedTextMessage && message.extendedTextMessage.text) ||
    (message.imageMessage && message.imageMessage.caption) ||
    (message.videoMessage && message.videoMessage.caption) ||
    '';

  // Mensagens recebidas (não fromMe) sem texto são ignoradas.
  // fromMe sem texto ainda interessa (takeover manual em mídia/áudio).
  if (!fromMe && !text) return null;

  return {
    jid: remoteJid,
    number,
    text,
    fromMe,
    messageId: key.id || null,
    pushName: data.pushName || null,
  };
}

// Webhook da Evolution API.
app.post('/webhook', (req, res) => {
  // Responde 200 imediatamente; processa de forma assíncrona.
  res.sendStatus(200);

  try {
    const body = req.body || {};
    const event = body.event || '';

    // [DEBUG TEMP] dump do payload para inspecionar formato do JID (lid vs telefone).
    if (process.env.DEBUG_WEBHOOK === '1') {
      console.log('[webhook][debug] event=%s data=%s', event, JSON.stringify(body.data));
    }

    // Filtra apenas eventos de mensagem recebida.
    if (event !== 'messages.upsert' && event !== 'message') {
      return;
    }

    // O payload pode vir como objeto único ou array.
    const raw = body.data;
    const items = Array.isArray(raw) ? raw : [raw];

    for (const item of items) {
      const parsed = parseMessage(item);
      if (parsed) {
        // Não aguardamos: o webhook já respondeu 200.
        handleMessage(parsed).catch((err) =>
          console.error('[webhook] Erro no handleMessage:', err.message)
        );
      }
    }
  } catch (err) {
    console.error('[webhook] Erro processando payload:', err.message);
  }
});

// Healthcheck.
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  let clinicName = process.env.CLINIC_NAME || 'Bot';
  try {
    clinicName = loadConfig().clinica.nome || clinicName;
  } catch (_) {
    /* sem config: usa o fallback */
  }
  console.log(`🤖 ${clinicName} rodando na porta ${PORT}`);
  scheduler.start();
});
