const axios = require('axios');

const BASE_URL = process.env.EVOLUTION_API_URL;
const API_KEY = process.env.EVOLUTION_API_KEY;
const INSTANCE = process.env.EVOLUTION_INSTANCE || 'longatti';

// Delay padrão (ms) para respostas conversacionais: durante esse tempo a
// Evolution mostra o indicador "digitando…" antes de enviar. Chamadas não
// conversacionais (notificações, scheduler) passam { delay: 0 }.
const REPLY_DELAY_MS = parseInt(process.env.REPLY_DELAY_MS || '4000', 10);

const client = axios.create({
  baseURL: BASE_URL,
  headers: {
    apikey: API_KEY,
    'Content-Type': 'application/json',
  },
  timeout: 60000, // grande o suficiente para acomodar o delay do "digitando"
});

// ---------- Rastreio de mensagens enviadas pelo próprio bot ----------
// A Evolution emite no webhook (messages.upsert) também as mensagens enviadas
// pela instância, com fromMe=true. Para distinguir o eco do próprio bot de uma
// mensagem digitada manualmente pela secretária no celular, guardamos os IDs
// que nós mesmos enviamos e os ignoramos quando voltam pelo webhook.
const sentIds = new Map(); // id -> timestamp
const SENT_TTL_MS = 5 * 60 * 1000;

function rememberSentId(id) {
  if (!id) return;
  sentIds.set(id, Date.now());
  // Limpeza preguiçosa de IDs antigos.
  if (sentIds.size > 500) {
    const cutoff = Date.now() - SENT_TTL_MS;
    for (const [k, t] of sentIds) {
      if (t < cutoff) sentIds.delete(k);
    }
  }
}

// Indica se o ID veio de uma mensagem que o próprio bot enviou.
function wasSentByBot(id) {
  if (!id) return false;
  const t = sentIds.get(id);
  if (t === undefined) return false;
  if (Date.now() - t > SENT_TTL_MS) {
    sentIds.delete(id);
    return false;
  }
  return true;
}

// Normaliza o destino. Se já for um JID completo (contém '@', ex.: '@lid' ou
// '@s.whatsapp.net'), repassa intacto — essencial para responder a chats
// endereçados por LID. Caso contrário, monta o JID a partir dos dígitos.
function toJid(target) {
  const s = String(target);
  if (s.includes('@')) return s;
  const clean = s.replace(/\D/g, '');
  return `${clean}@s.whatsapp.net`;
}

// Envia uma mensagem de texto via Evolution API (formato v2: body "flat").
// `opts.delay` (ms): tempo mostrando "digitando…" antes de enviar.
//   Default REPLY_DELAY_MS para respostas; passe 0 para envio imediato.
async function sendText(target, text, opts = {}) {
  const delay = opts.delay !== undefined ? opts.delay : REPLY_DELAY_MS;
  try {
    const { data } = await client.post(`/message/sendText/${INSTANCE}`, {
      number: toJid(target),
      text,
      delay,
    });
    // Memoriza o ID para reconhecer o eco no webhook.
    const id = data && data.key && data.key.id;
    rememberSentId(id);
    return data;
  } catch (err) {
    const detail = err.response ? JSON.stringify(err.response.data) : err.message;
    console.error(`[evolution] Falha ao enviar para ${target}:`, detail);
    throw err;
  }
}

// Monta a versão "texto numerado" de uma lista de botões. Usada como fallback
// quando os botões interativos não puderem ser enviados/renderizados.
function buttonsAsText(text, buttons) {
  const lines = buttons.map((b, i) => `${i + 1}. ${b.label}`);
  return `${text}\n\n${lines.join('\n')}`;
}

// Envia uma mensagem com botões de resposta rápida (máx. 3 no WhatsApp).
// `buttons`: [{ id, label }]. Se a Evolution recusar o formato de botões
// (comum no Baileys), cai para texto numerado — o fluxo aceita ambos.
async function sendButtons(target, text, buttons, opts = {}) {
  const delay = opts.delay !== undefined ? opts.delay : REPLY_DELAY_MS;
  const number = toJid(target);
  try {
    const { data } = await client.post(`/message/sendButtons/${INSTANCE}`, {
      number,
      title: '',
      description: text,
      footer: '',
      buttons: buttons.slice(0, 3).map((b) => ({
        type: 'reply',
        displayText: b.label,
        id: b.id,
      })),
      delay,
    });
    const id = data && data.key && data.key.id;
    rememberSentId(id);
    return data;
  } catch (err) {
    const detail = err.response ? JSON.stringify(err.response.data) : err.message;
    console.warn(`[evolution] Botões falharam para ${target}, usando texto. Detalhe:`, detail);
    // Fallback: texto numerado (o handler aceita resposta por número ou palavra).
    return sendText(target, buttonsAsText(text, buttons), opts);
  }
}

module.exports = { sendText, sendButtons, toJid, wasSentByBot };
