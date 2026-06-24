const { sendText, sendButtons } = require('../services/evolutionApi');
const { getClientByNumber, saveClient } = require('../services/db');
const { notifyNewAppointment } = require('./secretary');
const { load: loadConfig, render } = require('../services/config');

// ---------- Helpers ----------

function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

// Mapeia a resposta do paciente (ID do botão, texto exibido, número da opção ou
// palavra digitada) para uma das opções. Retorna a opção ou null.
function matchOption(text, buttons) {
  const t = normalize(text);
  if (!t) return null;

  // 1) ID exato do botão (caminho normal quando o botão é tocado).
  let opt = buttons.find((b) => normalize(b.id) === t);
  if (opt) return opt;

  // 2) Número da opção (1-based), caso tenha caído no fallback de texto.
  if (/^\d+$/.test(t)) {
    const n = parseInt(t, 10);
    if (n >= 1 && n <= buttons.length) return buttons[n - 1];
  }

  // 3) Texto do botão (igual ou contido — tolera "primeira" p/ "Primeira consulta").
  opt = buttons.find((b) => normalize(b.label) === t);
  if (opt) return opt;
  opt = buttons.find((b) => {
    const lbl = normalize(b.label);
    return lbl.includes(t) || t.includes(lbl);
  });
  return opt || null;
}

// Horário comercial da secretária (fuso America/Sao_Paulo).
function nowInSaoPaulo() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
}

function withinBusinessHours(h) {
  if (!h) return true;
  const now = nowInSaoPaulo();
  if (Array.isArray(h.dias) && !h.dias.includes(now.getDay())) return false;
  const [hi, mi] = String(h.inicio || '00:00').split(':').map(Number);
  const [hf, mf] = String(h.fim || '23:59').split(':').map(Number);
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins >= hi * 60 + mi && mins < hf * 60 + mf;
}

// Salva o contato (número + nome do WhatsApp) para os disparos comemorativos.
// Não sobrescreve um cadastro já existente.
function saveContact(session) {
  if (!session || !session.number) return;
  try {
    if (getClientByNumber(session.number)) return;
    saveClient({
      number: session.number,
      name: session.pushName || null,
      createdAt: new Date().toISOString(),
      source: 'fluxo',
    });
  } catch (err) {
    console.error('[flow] Falha ao salvar contato:', err.message);
  }
}

// Reenvia o mesmo passo quando não entendemos a resposta.
async function reaskStep(jid, node, c, f) {
  const prompt = `${render(f.naoEntendi.texto, c)}\n\n${render(node.texto, c)}`;
  await sendButtons(jid, prompt, node.botoes);
}

// Encerra o fluxo encaminhando à secretária. Dentro do horário, envia a mensagem
// de despedida (`preMessage`, ex.: "vou te conectar agora"). Fora do horário,
// envia SOMENTE a mensagem de fora-de-horário (evita o "agora" contraditório).
// Em ambos os casos notifica a secretária e registra o contato.
async function finishTransfer(jid, session, motivo, preMessage) {
  const cfg = loadConfig();
  const c = cfg.clinica;
  const f = cfg.fluxo;

  if (withinBusinessHours(c.horarioSecretaria)) {
    if (preMessage) await sendText(jid, preMessage);
  } else {
    await sendText(jid, render(f.foraDeHorario.texto, c));
  }

  try {
    await notifyNewAppointment({
      name: session.pushName,
      number: session.number,
      reason: motivo,
    });
  } catch (err) {
    console.error('[flow] Falha ao notificar a secretária:', err.message);
  }

  saveContact(session);
  session.state = 'done';
}

// ---------- Sessão ----------

// `number` são os dígitos (chave do "banco"); `pushName` é o nome do perfil.
function createSession(number, pushName) {
  return { state: 'start', number, pushName: pushName || null };
}

// ---------- Máquina de estados ----------
// start -> tipo_consulta -> [confirma_primeira -> oferece_agendar -> pergunta_convenio] -> done
//                        \-> (retorno) -------------------------------------------------> done

async function handle(jid, text, session) {
  const cfg = loadConfig();
  const c = cfg.clinica;
  const f = cfg.fluxo;

  switch (session.state) {
    // Primeira mensagem do paciente (qualquer texto): saudação + botões.
    case 'start': {
      await sendButtons(jid, render(f.saudacao.texto, c), f.saudacao.botoes);
      session.state = 'tipo_consulta';
      return;
    }

    case 'tipo_consulta': {
      const opt = matchOption(text, f.saudacao.botoes);
      if (!opt) return reaskStep(jid, f.saudacao, c, f);

      if (opt.id === 'retorno') {
        return finishTransfer(jid, session, 'Retorno', render(f.retorno.texto, c));
      }
      // Primeira consulta: confirma que nunca consultou.
      await sendButtons(jid, render(f.confirmaPrimeira.texto, c), f.confirmaPrimeira.botoes);
      session.state = 'confirma_primeira';
      return;
    }

    case 'confirma_primeira': {
      const opt = matchOption(text, f.confirmaPrimeira.botoes);
      if (!opt) return reaskStep(jid, f.confirmaPrimeira, c, f);

      if (opt.id === 'na_verdade_retorno') {
        return finishTransfer(jid, session, 'Retorno', render(f.retorno.texto, c));
      }
      // Confirmou primeira vez: dispara as informações + oferta de agendamento.
      for (const m of f.infoPrimeiraConsulta) {
        await sendText(jid, render(m, c), { delay: 1200 });
      }
      await sendButtons(jid, render(f.ofereceAgendar.texto, c), f.ofereceAgendar.botoes);
      session.state = 'oferece_agendar';
      return;
    }

    case 'oferece_agendar': {
      const opt = matchOption(text, f.ofereceAgendar.botoes);
      if (!opt) return reaskStep(jid, f.ofereceAgendar, c, f);

      if (opt.id === 'nao_obrigado') {
        await sendText(jid, render(f.recusaAgendar.texto, c));
        session.state = 'done';
        return;
      }
      await sendButtons(jid, render(f.perguntaConvenio.texto, c), f.perguntaConvenio.botoes);
      session.state = 'pergunta_convenio';
      return;
    }

    case 'pergunta_convenio': {
      const opt = matchOption(text, f.perguntaConvenio.botoes);
      if (!opt) return reaskStep(jid, f.perguntaConvenio, c, f);

      let pre;
      let motivo;
      if (opt.id === 'outro_convenio') {
        pre = f.outroConvenio.texto;
        motivo = 'Primeira consulta — outro convênio';
      } else if (opt.id === 'particular') {
        pre = f.transfereAgendamento.texto;
        motivo = 'Primeira consulta — particular';
      } else {
        pre = f.transfereAgendamento.texto;
        motivo = 'Primeira consulta — convênio aceito';
      }
      return finishTransfer(jid, session, motivo, render(pre, c));
    }

    // Conversa já encaminhada: silêncio para a secretária assumir.
    case 'done':
    default:
      return;
  }
}

module.exports = { handle, createSession };
