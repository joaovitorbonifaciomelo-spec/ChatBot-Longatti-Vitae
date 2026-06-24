// Dedução de gênero a partir do primeiro nome (heurística para nomes brasileiros).
//
// Estratégia conservadora — na dúvida retorna null (o chamador NÃO envia
// mensagens de gênero nesse caso, evitando erro). O importante é não
// classificar homem como mulher; por isso há lista de exceções masculinas
// para nomes terminados em "a".

function stripAccents(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Nomes masculinos que terminam em "a" (ou que a regra erraria) → forçam M.
const MALE_EXCEPTIONS = new Set([
  'luca', 'noa', 'jeova', 'josua', 'joshua', 'dida', 'agripa', 'aquila',
  'akira', 'yuca', 'auta', 'oziel', 'isac',
]);

// Nomes femininos comuns que NÃO terminam em "a" (terminam em e/i/consoante).
const FEMALE_NAMES = new Set([
  'isabel', 'raquel', 'rachel', 'ester', 'esther', 'rute', 'ruth', 'ingrid',
  'beatriz', 'lais', 'tais', 'thais', 'iris', 'doris', 'carmen', 'miriam',
  'mirian', 'dulce', 'alice', 'eliane', 'adriane', 'rosane', 'rose', 'denise',
  'eloise', 'heloise', 'neide', 'cleide', 'marlene', 'marilene', 'ivone',
  'ivete', 'jaqueline', 'jacqueline', 'evelin', 'evelyn', 'caroline', 'nicole',
  'estefani', 'estefany', 'agnes', 'mercedes', 'gisele', 'giselle', 'michele',
  'michelle', 'daniele', 'danielle', 'isabele', 'ariane', 'viviane', 'juliane',
  'cristiane', 'luciane', 'simone', 'rosangela', 'solange', 'edineide',
  'lucineide', 'maria', 'mari', 'fran', 'bel', 'kel', 'mel', 'sol', 'noemi',
  'noemy', 'emilly', 'emily', 'kimberly', 'jennifer', 'jenifer',
]);

// Nomes masculinos comuns (úteis para classificar M com confiança).
const MALE_NAMES = new Set([
  'jose', 'joao', 'rafael', 'daniel', 'gabriel', 'miguel', 'manuel', 'samuel',
  'emanuel', 'israel', 'ismael', 'felipe', 'henrique', 'andre', 'vicente',
  'jorge', 'isaque', 'jaime', 'kaue', 'kaike', 'kaique', 'davi', 'levi',
  'vinicius', 'mateus', 'matheus', 'lucas', 'marcos', 'carlos', 'luis', 'luiz',
  'thales', 'tales', 'moises', 'elias', 'matias', 'tobias', 'dione', 'cleiton',
  'anderson', 'wesley', 'washington', 'robson', 'edson', 'nelson', 'jackson',
]);

// Retorna 'F', 'M' ou null (desconhecido).
function guessGender(fullName) {
  if (!fullName) return null;
  const n = stripAccents(String(fullName).trim().toLowerCase()).split(/\s+/)[0];
  if (!n) return null;
  if (FEMALE_NAMES.has(n)) return 'F';
  if (MALE_NAMES.has(n)) return 'M';
  if (MALE_EXCEPTIONS.has(n)) return 'M';
  if (n.endsWith('a')) return 'F';
  if (n.endsWith('o')) return 'M';
  return null;
}

module.exports = { guessGender };
