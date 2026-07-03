const fs = require('fs');
const path = require('path');
const { normalizeBR } = require('./phone');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const BOTOX_FILE = path.join(DATA_DIR, 'botox.json');
const PAUSAS_FILE = path.join(DATA_DIR, 'pausas.json');

// Garante que o arquivo exista; se não, cria com array vazio.
function ensureFile(file) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, '[]', 'utf8');
  }
}

function readJson(file) {
  ensureFile(file);
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error(`[db] Erro lendo ${file}:`, err.message);
    return [];
  }
}

function writeJson(file, data) {
  ensureFile(file);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ---------- Clientes ----------

function getClients() {
  return readJson(CLIENTS_FILE);
}

function getClientByNumber(number) {
  const target = normalizeBR(number);
  return getClients().find((c) => normalizeBR(c.number) === target) || null;
}

// Cria ou atualiza um cliente (merge por número, tolerante ao nono dígito).
function saveClient(client) {
  const record = { ...client, number: normalizeBR(client.number) };
  const clients = getClients();
  const idx = clients.findIndex((c) => normalizeBR(c.number) === record.number);
  if (idx >= 0) {
    clients[idx] = { ...clients[idx], ...record };
  } else {
    clients.push(record);
  }
  writeJson(CLIENTS_FILE, clients);
  return record;
}

// ---------- Botox ----------

function getBotoxRecords() {
  return readJson(BOTOX_FILE);
}

function getBotoxByNumber(number) {
  const target = normalizeBR(number);
  return getBotoxRecords().find((b) => normalizeBR(b.number) === target) || null;
}

// Cria ou atualiza um registro de botox (merge por número, tolerante ao nono dígito).
function saveBotox(record) {
  const normalized = { ...record, number: normalizeBR(record.number) };
  const records = getBotoxRecords();
  const idx = records.findIndex((b) => normalizeBR(b.number) === normalized.number);
  if (idx >= 0) {
    records[idx] = { ...records[idx], ...normalized };
  } else {
    records.push(normalized);
  }
  writeJson(BOTOX_FILE, records);
  return normalized;
}

// ---------- Pausas de atendimento humano (JID -> timestamp de expiração) ----------
// Mapa objeto (não array), persistido para sobreviver a reinícios do bot.

function getPausas() {
  try {
    if (!fs.existsSync(PAUSAS_FILE)) return {};
    const raw = fs.readFileSync(PAUSAS_FILE, 'utf8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.error(`[db] Erro lendo ${PAUSAS_FILE}:`, err.message);
    return {};
  }
}

function savePausas(map) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PAUSAS_FILE, JSON.stringify(map), 'utf8');
  } catch (err) {
    console.error(`[db] Erro salvando ${PAUSAS_FILE}:`, err.message);
  }
}

module.exports = {
  getClients,
  getClientByNumber,
  saveClient,
  getBotoxRecords,
  getBotoxByNumber,
  saveBotox,
  getPausas,
  savePausas,
};
