// Normalização de números de telefone brasileiros.
//
// O WhatsApp entrega o número ora COM o nono dígito (5562993892424), ora SEM
// (556293892424). Para evitar que a mesma pessoa vire duas "identidades" no
// banco (cadastro x botox) ou que a secretária não seja reconhecida, tudo é
// canonizado para a forma SEM o nono dígito (12 dígitos: 55 + DDD + 8).

function normalizeBR(num) {
  const d = String(num || '').replace(/\D/g, '');
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    let rest = d.slice(4);
    if (rest.length === 9 && rest[0] === '9') rest = rest.slice(1);
    return `55${ddd}${rest}`;
  }
  return d;
}

// Compara dois números ignorando a variação do nono dígito.
function samePhone(a, b) {
  return !!a && !!b && normalizeBR(a) === normalizeBR(b);
}

module.exports = { normalizeBR, samePhone };
