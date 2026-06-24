# Bot WhatsApp — Atendimento de Clínicas (multi-clínica)

Bot de **triagem e agendamento** via WhatsApp. Fluxo **100% por botões**, **sem IA**
(textos fixos), pensado para ser **revendido a várias clínicas**: clona-se a pasta e
edita-se só `data/clinica.json` + `.env`. Stack: Node/Express (`bot`) + Evolution API
(WhatsApp) + PostgreSQL + Redis (estes três pela Evolution).

> Origem: Clínica Longatti Vitae (Nutrologia e Dermatologia). Deploy alvo: **VPS
> (Hostinger) com o bot em PM2** e a **Evolution em Docker**. Veja `NOVA_CLINICA.md`
> para clonar o bot para um novo cliente.

## Personalização (o que muda por clínica)
- **`data/clinica.json`** — TODO o conteúdo: identidade (nome, médica, endereço,
  convênios, particular, `atendimento`), `horarioSecretaria`, **mensagens + botões**
  do `fluxo` e **mensagens dos `disparos`**. Recarrega sozinho ao salvar (mtime), sem
  reiniciar o bot. Placeholders: `{{clinica}}`, `{{medica}}`, `{{especialidade}}`,
  `{{endereco}}`, `{{atendimento}}`, `{{particular}}`, `{{convenios}}`, e nos disparos
  `{{ano}}`, `{{nome}}`, `{{meses}}`.
- **`.env`** — infra/segredos: `PORT`, `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`,
  `EVOLUTION_INSTANCE`, `POSTGRES_PASSWORD`, `SECRETARY_NUMBER`, `REPLY_DELAY_MS`,
  `MESSAGE_GROUP_WINDOW_MS`, `TAKEOVER_PAUSE_MS`, `DEBUG_WEBHOOK`. (Modelo em `.env.example`.)

O "motor" (`.js`) **não muda por clínica**.

## Fluxo de atendimento (handlers/flow.js)
Máquina de estados dirigida por `clinica.json`:
`start → tipo_consulta → [confirma_primeira → oferece_agendar → pergunta_convenio] → done`
- **Retorno** (ou "na verdade é retorno") → transfere direto para a secretária.
- **Primeira consulta** → confirma → dispara as infos (médica, planos+particular,
  horários+endereço) → oferece agendar → pergunta convênio → transfere.
- Toda transferência checa o **horário da secretária** (`horarioSecretaria`): fora dele,
  manda a mensagem de "fora de horário" mas **mesmo assim notifica a secretária** e
  **salva o contato** (alimenta os disparos). Dentro, transfere normalmente.
- Respostas aceitas: **toque no botão**, **número da opção** ("1") ou **palavra**
  ("retorno"). Se os botões não renderizarem, `sendButtons` cai para **texto numerado**.

## Arquitetura
- `index.js` — webhook da Evolution. `parseMessage` preserva o **JID completo** (`@lid`
  ou `@s.whatsapp.net`) e o `pushName`; entende **respostas de botão**; ignora grupos/broadcast.
- `handlers/messageHandler.js` — **debounce** (agrupa mensagens em sequência) + **pausa
  por atendimento manual** (takeover de 1h) + comando `#botox` da secretária.
- `handlers/flow.js` — o fluxo de botões (acima). Salva contato ao transferir.
- `handlers/secretary.js` — `notifyNewAppointment` + comando `#botox` (registra/lista;
  intervalo vem de `disparos.botox.intervaloMeses`).
- `services/config.js` — carregador único do `clinica.json` (reload por mtime) + `render`
  de placeholders. Usado por `flow`, `scheduler`, `secretary` e `index`.
- `services/evolutionApi.js` — `sendText` e `sendButtons` (v2 flat `{number,...,delay}`);
  `delay` mostra "digitando"; guarda IDs enviados p/ não tratar o eco como takeover;
  `sendButtons` tem fallback para texto numerado.
- `services/gender.js` — deduz gênero pelo 1º nome (heurística + exceções; filtros dos disparos).
- `services/phone.js` — normaliza telefone BR (ignora o "nono dígito").
- `services/db.js` — "banco" em JSON (`data/clients.json`, `data/botox.json`).
- `scheduler/index.js` — crons (fuso America/Sao_Paulo): **08h** comemorativas, **09h**
  aniversários, **10h** botox. Textos e `ativo` vêm de `clinica.json → disparos`.
  Dia da Mulher só p/ mulheres; Dia das Mães só p/ mulheres com filhos. **Aniversário**
  depende de `birthday` no contato — o fluxo de botões NÃO coleta isso (fica dormente).

## ⚠️ Pegadinhas (não regredir)
- **Evolution v2.3.x+ (`evoapicloud/evolution-api`)**: versões antigas não suportam o
  endereçamento `@lid` (responder a contatos não salvos). Manter v2.3.x+.
- **Loop "Timed Out" sem QR** = versão do WhatsApp Web desatualizada (a v2.3.7 autogerencia).
- **Webhook some ao recriar/deletar a instância** — reconfigurar apontando para a porta do bot.
- **Botões via Baileys podem não renderizar** em conta não-oficial — por isso o fallback
  para texto numerado e o matcher tolerante (id/número/palavra).
- **Sessões de conversa ficam em memória** — reiniciar o bot recomeça conversas em andamento.
- **node_modules é por-SO** — não copiar do Windows para a VPS; rodar `npm install` na VPS.

## Multi-clínica
Uma mesma Evolution serve várias instâncias (números). Cada clínica = uma cópia do bot
com `clinica.json`/`.env` próprios, em uma `PORT` e `EVOLUTION_INSTANCE` únicas, rodando
como processo PM2 separado. Limite prático = RAM. Passo a passo em `NOVA_CLINICA.md`.

## Testes locais (sem WhatsApp)
Os puros podem ser exercitados dublando `services/evolutionApi` e `services/db` via
`require.cache` e dirigindo `flow.handle(...)` / `scheduler.runBirthdays()` etc.
Para validar sintaxe: `node --check <arquivo>`.
