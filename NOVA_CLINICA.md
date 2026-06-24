# Como criar o bot para uma clínica nova (copiar e personalizar)

O projeto foi feito para ser **clonado por clínica**. O "motor" (arquivos `.js`)
nunca muda. **Só 2 lugares são personalizados por cliente:**

| O quê | Onde | Exemplos |
|---|---|---|
| **Conteúdo da clínica** | `data/clinica.json` | nome, médica, endereço, convênios, valor particular, horários, **todas as mensagens** do fluxo e dos disparos |
| **Infra/segredos** | `.env` | porta, instância da Evolution, número da secretária |

## Passo a passo

1. **Copie a pasta** do projeto para uma nova (ex.: `bot-clinicaX`).
2. **Apague os dados da clínica anterior** (começa zerado):
   - `data/clients.json` → `[]`
   - `data/botox.json` → `[]`
3. **Edite `data/clinica.json`**: troque tudo dentro de `"clinica"` (nome, médica,
   endereço, convênios, particular, `atendimento`, e `horarioSecretaria`).
   Ajuste os textos de `"fluxo"` e `"disparos"` se quiser. Para desligar um
   disparo, ponha `"ativo": false`.
4. **Crie o `.env`** a partir do `.env.example` e ajuste:
   - `PORT` — uma porta livre (ex.: 3001 se a outra clínica usa 3000).
   - `EVOLUTION_INSTANCE` — um nome único (ex.: `clinicax`).
   - `SECRETARY_NUMBER` — o WhatsApp da secretária dessa clínica.
   - `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` — apontam para a MESMA Evolution
     (uma Evolution serve várias clínicas; o que separa é a `EVOLUTION_INSTANCE`).
5. **Suba a instância na Evolution** com esse `EVOLUTION_INSTANCE`, **configure o
   webhook** apontando para a porta do bot dessa clínica e **escaneie o QR** do
   WhatsApp dela.
6. **Rode o bot** dessa clínica como um processo próprio no PM2:
   ```bash
   pm2 start index.js --name bot-clinicax
   ```

## Placeholders disponíveis nas mensagens (`clinica.json`)

`{{clinica}}`, `{{medica}}`, `{{especialidade}}`, `{{endereco}}`, `{{atendimento}}`,
`{{particular}}`, `{{convenios}}` — em qualquer texto.
Nos disparos também: `{{ano}}` (Ano Novo), `{{nome}}` (aniversário), `{{meses}}` (botox).

> Editou o `clinica.json` e salvou? **Não precisa reiniciar** — vale na próxima
> conversa (o bot relê o arquivo automaticamente quando ele muda).

## Quantas clínicas cabem na mesma VPS?

O limite prático é a **RAM** (cada número de WhatsApp consome memória):
- **4 GB** → ~2–3 clínicas pequenas.
- **8 GB** → ~5–6+.
