const fs = require('fs');
const path = require('path');

// Carregador único da configuração da clínica (data/clinica.json).
// Recarrega automaticamente quando o arquivo muda (compara mtime), então editar
// mensagens/horários/disparos NÃO exige reiniciar o bot.
const CONFIG_PATH = path.join(__dirname, '..', 'data', 'clinica.json');
let _cache = null;
let _mtime = 0;

function load() {
  try {
    const st = fs.statSync(CONFIG_PATH);
    if (!_cache || st.mtimeMs !== _mtime) {
      _cache = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      _mtime = st.mtimeMs;
    }
  } catch (err) {
    console.error('[config] Erro lendo clinica.json:', err.message);
    if (!_cache) throw err; // sem config nenhuma não há como atender
  }
  return _cache;
}

// Substitui placeholders {{...}}. Usa os dados de `clinica` e quaisquer extras
// (ex.: { ano: 2026 }, { nome: 'Maria' }, { meses: 4 }).
function render(str, clinica = {}, extra = {}) {
  const map = {
    clinica: clinica.nome || '',
    medica: clinica.medica || '',
    especialidade: clinica.especialidade || '',
    endereco: clinica.endereco || '',
    atendimento: clinica.atendimento || '',
    particular: clinica.particular || '',
    convenios: (clinica.convenios || []).join(', '),
    ...extra,
  };
  return String(str).replace(/\{\{(\w+)\}\}/g, (m, key) => (key in map ? map[key] : m));
}

module.exports = { load, render, CONFIG_PATH };
