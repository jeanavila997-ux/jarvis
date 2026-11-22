# JARVIS v0.2 (A.V.I.L.A.)

Assistente pessoal do Jean, inspirado no JARVIS do Homem de Ferro.
Responde em português, consulta o vault JARVIS (Obsidian) e cita as notas que usou.
Tem rotinas de nível 0-1 (briefing, revisão, diário, reindexar). Não executa ações de nível 2+ (precisa do botão de "sim"), não apaga nada e não gasta dinheiro.

- **Endereço:** https://jarvis.72-62-11-116.sslip.io (HTTPS + senha; usuário `jean`)
- **Senha:** só na VPS, em `/root/.jarvis_credentials` (chmod 600)
- **Cérebro:** Ollama Cloud (`https://ollama.com/api/chat`), com a chave `OLLAMA_API_KEY` da assinatura do Jean
- **Modelo padrão (nuvem):** `glm-5.3-flash` (o mesmo do Hermes). **Sem fallback pago**: se a nuvem falhar, o plano B é uma resposta por regras, sem IA.
- **Roteador de custo (Etapa 1):** regras fixas → Guarda de permissões → classificador local → local ou nuvem. Ver seção abaixo.

## Como funciona
| Parte | Arquivo |
|---|---|
| Servidor HTTP + streaming (Node 22, sem dependências) | `server.mjs` |
| Busca BM25 nas notas do vault (ignora arquivos que parecem ter segredo) | `src/retrieval.mjs` |
| Prompt de sistema (**rascunho**) + perfil fixo do Jean | `src/prompt.mjs` |
| Interface de chat (pt-BR, celular, tema escuro neon ciano) | `public/` |
| Conversas salvas em JSON | `data/conversas/*.json` |
| Canal Telegram + botão de "sim" | `src/telegram.mjs`, `src/confirmacoes.mjs` |
| Rotinas: briefing 06:30 e revisão 21:00 (+ diário) | `src/rotinas.mjs` |
| Auditoria (nível 1+, chats negados) | `src/auditoria.mjs` → `data/auditoria.jsonl` |
| Roteador, regras, Guarda, classificador, uso | `src/roteador.mjs`, `src/regras.mjs`, `src/permissoes.mjs`, `src/classificador.mjs`, `src/uso.mjs` → `data/uso.jsonl` |
| Cópia do vault (só leitura no container) | `vault/` |

A cada pergunta, o servidor busca os trechos mais relevantes do vault (pergunta atual + anterior),
coloca no prompt de sistema junto com o perfil do Jean e manda as últimas 12 mensagens ao modelo.
As notas usadas aparecem como etiquetas embaixo da resposta.

## Roteador de custo (Etapa 1)
Cada mensagem (web ou Telegram) passa por `perguntar()` em `server.mjs`, nesta ordem:

| # | Etapa | Arquivo | O que faz |
|---|---|---|---|
| 1 | Regras fixas, sem IA | `src/regras.mjs` | `status`, `ajuda`/`comandos`, `custo`, `permissoes` (com ou sem `/`) respondem na hora, custo zero |
| 2 | Guarda (permissão) | `src/permissoes.mjs` | Nível 0-3 **só por regra fixa** do `docs/PERMISSOES.md`. Nível 1+ é auditado e nunca vai para o modelo local |
| 3 | Classificador local | `src/classificador.mjs` | Modelo pequeno do Ollama da VPS, JSON rígido validado: `{nota 1-5, tipo}`. Só escolhe a rota |
| 4 | Rota | `src/roteador.mjs` | Nota 1-2 de conversa trivial (saudação, ou pergunta simples nota 1) → **local**. Nota 3+, código, vault, cálculo, dado atual (preço, hoje, status) → **nuvem** `glm-5.3-flash` |
| 5 | Plano B | `server.mjs` | Classificador ou local travou/falhou → nuvem (a mesma da assinatura). Nuvem falhou → reserva 9Router (se ligada e saudável) → **resposta por regras** com as notas do vault. Nunca um serviço pago novo |
| 6 | Registro de uso | `src/uso.mjs` | Uma linha por resposta em `data/uso.jsonl` |

**Modelo local:** `llama3.2:3b` (já estava no Ollama da VPS). Medido na CPU da VPS: classificação ~1 s com o modelo carregado
(primeira carga 10-75 s), resposta curta 5-12 s. Fica carregado 30 min (`keep_alive`), ~2-3 GB de RAM.

**Estado atual: local DESLIGADO** (`JARVIS_LOCAL_URL` vazio). O Ollama da VPS escuta só em `127.0.0.1:11434` e o container
está numa rede bridge própria, então não alcança o Ollama. Não mudamos o bind do Ollama nem o UFW por segurança.
Com o local desligado: regras → Guarda → nuvem → plano B por regras. Para ligar, ver "Ligar o modelo local".

### Reserva 9Router (PC do Jean) — desligada por padrão
- Só entra quando a **nuvem falhou** e nada foi enviado ainda. Ordem: nuvem → reserva 9Router → plano B por regras.
- Antes de tentar, `GET https://rvejurm.abc-tunnel.us/api/health` (sem custo, cache 60 s). PC desligado = health falha = vai direto para o plano B.
- Timeout 20 s (`NINEROUTER_TIMEOUT_MS`). 401 = chave; 400 = modelo inválido; 503 = contas indisponíveis (respeita `retry-after`).
- Variáveis no `.env`: `NINEROUTER_RESERVA` (0/1), `NINEROUTER_URL` (com `/v1`), `NINEROUTER_MODEL`, `NINEROUTER_API_KEY`. Depois `docker compose up -d`.
- Rota registrada em `data/uso.jsonl` como `reserva-9router` (`cobranca: reserva-9router-pc-do-jean`). Use só modelo gratuito.
- Teste de 21/11: `oc/jev-1.13-free` respondeu 400 "Model does not support this protocol" e `oc/muse-spark-1.3-contributor-free` respondeu "Model is unavailable". Falta escolher um modelo que funcione em `/v1/chat/completions`.
- Futuro (não implementado): `/v1/models/embedding` (embeddings para a memória) e `/v1/models/web` (busca/fetch na web).

### Ver custos e uso
- Telegram: `/custo` (hoje e 7 dias) ou `/status`. Web: digite `custo` ou `status`.
- API (atrás do basic-auth): `GET /api/custo`.
- Arquivo: `data/uso.jsonl` (JSONL, só acrescenta). Campos: `ts` (Acre), `canal`, `rota` (`regras`|`local`|`nuvem`|`plano-b-regras`),
  `modelo`, `motivo` (ex.: `nota-4`, `guarda-nivel-2`, `plano-b-local-falhou`), `nota`, `tipo`, `nivel`, `ms`, `classif_ms`,
  `tokens_in`, `tokens_out`, `classif_tokens`, `custo_usd` (sempre 0: local é grátis e a nuvem está na assinatura), `cobranca`, `erro`.
- Na VPS: `tail -n 20 /opt/apps/jarvis/data/uso.jsonl` ou, por rota:
  `python3 -c "import json,collections;c=collections.Counter(json.loads(l)['rota'] for l in open('/opt/apps/jarvis/data/uso.jsonl'));print(c)"`

### Testes
- Unitários (sem rede): `docker run --rm --network none -u 1000:1000 --read-only --tmpfs /tmp -v /opt/apps/jarvis:/app:ro -w /app node:22.23.5-alpine node --test test/etapa1.test.mjs` (todos devem passar)
- Classificador ao vivo (só o Ollama local, sem nuvem): `docker run --rm --network host --read-only --cap-drop ALL -u 1000:1000 -v /opt/apps/jarvis:/app:ro -w /app node:22.23.5-alpine node scripts/testar-local.mjs`

### Ligar o modelo local (pendente, precisa de decisão do Jean)
O container precisa alcançar o Ollama sem abrir a porta 11434 para fora. Opções, da mais simples à mais isolada:
1. Ollama escutar também no gateway da rede `jarvis_default` + regra no UFW só dessa sub-rede para a 11434 (mexe em serviço e UFW).
2. Sidecar `socat` (rede host) que expõe o Ollama num **socket Unix** num volume só do JARVIS (sem porta, sem UFW). Exige o JARVIS falar HTTP por socket.
Depois: `JARVIS_LOCAL_URL=...` no `.env` e `docker compose up -d`.

## Rodar / atualizar
```sh
cd /opt/apps/jarvis
docker compose up -d          # sobe (ou aplica mudanças do compose/.env)
docker compose restart jarvis # depois de mudar server.mjs, src/ ou public/
docker compose logs -f jarvis # logs
```
Saúde (dentro da VPS): `docker compose exec jarvis wget -qO- http://127.0.0.1:3200/api/saude`

## Atualizar o vault
1. Copie o vault novo para `/opt/apps/jarvis/vault/` (sem `.obsidian/`, `.git/`, `.env`, zips). Exemplo a partir da box:
   `rsync -a --delete --exclude .obsidian/ --exclude .git/ --exclude .trash/ --exclude '.env*' --exclude '*.zip' ./vault/ vps:/opt/apps/jarvis/vault/`
2. Reindexe sem reiniciar: `sh scripts/atualizar-vault.sh` (ou `sh scripts/reindexar.sh`).

## Trocar o modelo
Edite `JARVIS_MODEL` no `.env` (ex.: `kimi-k2.6`, `deepseek-v4.1-flash` — ver `https://ollama.com/api/tags`) e rode `docker compose up -d`.
Só use modelos que estão dentro da assinatura. O JARVIS nunca troca de modelo sozinho.

## Telegram (@Agenteejarvis_bot)
- Long polling (`getUpdates`) dentro do mesmo serviço (`src/telegram.mjs`). Mesmo cérebro do chat web: regras, Guarda, roteador, busca no vault e Ollama Cloud, sem fallback pago.
- **Só responde ao chat do Jean** (`TELEGRAM_ALLOWED_CHAT_ID`). Outros chats recebem uma linha ("Este assistente é privado.", no máximo a cada 6 h) e ficam registrados em `data/auditoria.jsonl`, sem o conteúdo.
- Uma conversa por chat (`data/telegram/chats.json` aponta para `data/conversas/`). As conversas do Telegram aparecem no chat web com o prefixo `[Telegram]`.
- Resposta em texto puro, dividida em partes de até 4000 caracteres, com "digitando…" enquanto espera e as notas `[[...]]` no fim.
- Comandos: `/start`, `/ajuda`, `/nova`, `/status` (JARVIS + rotas + linha `VPS:` de `data/vps-status.json` + uso de hoje), `/custo` (uso por rota), `/permissoes`, `/briefing` (mostra o briefing agora), `/revisao` (revisão do dia + escreve o diário agora), `/reindexar` (nível 1: faz e avisa), `/parar` (cancela confirmações e pausa rotinas), `/retomar`, `/testesim`.
- Confirmação de nível 2 (`src/confirmacoes.mjs`): botões Confirmar/Cancelar, só do chat do Jean, expira em 10 min, uso único. Nível 3 é sempre recusado.
- Rotinas (America/Rio_Branco): briefing **06:30** e revisão **21:00** + diário em `data/diario/AAAA-MM-DD-jarvis.md` (nível 1). Estado em `data/rotinas.json` (pausa sobrevive a restart). Meta: `GET /api/rotinas`.
- Ferramentas reais de nível 1 (faz e avisa): `/reindexar` e a escrita do diário. O botão de "sim" (nível 2) continua **sem ações ligadas** — espera alvo externo aprovado pelo Jean.
- Variáveis no `.env`: `TELEGRAM_BOT_TOKEN` e `TELEGRAM_ALLOWED_CHAT_ID`. Sem elas, o canal (e as rotinas) ficam desligados. O token do Hermes é outro, e os dois não podem usar o mesmo bot (daria erro 409).
- Logs: `docker compose logs -f jarvis | grep telegram`

## Skills (v0.3)
- Formato Agent Skills: `data/skills/<nome>/SKILL.md` (frontmatter `name` + `description`). Instalação pelo hospedeiro (Hermes) — o JARVIS só **lê texto**; skills **nunca executam scripts**.
- Comandos: `/skills` (lista com descrição) · `/skill <nome>` (ativa/desativa NA CONVERSA; `/skill off` tira todas). Ativação persiste no JSON da conversa (`conv.skills`). Sem conversa atual, o JARVIS pede para mandar uma mensagem antes.
- Injeção: na rota nuvem, o SYSTEM recebe a lista dos nomes (via `listarLinha`) + o corpo completo das skills ativas (`corpos`). No modelo local (3B, 4096 ctx) skills não entram.
- `/api/skills` (GET) lista as instaladas. Cache de leitura: 15 s — skill nova aparece sem restart.
- Lote inicial (2026-11-22, 74 skills): obra/superpowers (15), mattpocock/skills (40), anthropics/skills (18), multica-ai/karpathy-skills (1) + `exemplo` (demo). Instalador com triagem anti-injection; excluídos: `claude-api` e `skill-creator` (corpo > 30 KB). A skill `exemplo` pode ser removida: `sudo rm -r /opt/apps/jarvis/data/skills/exemplo` (pedir ao Hermes). Muitas skills de dev presumem ferramentas que o JARVIS não tem — sem tools, são só texto e o prompt o impede de fingir execução.

## Segurança
- Container sem portas publicadas, rede bridge própria, `read_only`, `cap_drop: ALL`, usuário 1000, 256 MB.
- Basic-auth no Traefik; o hash fica no `.env`, a senha em texto só em `/root/.jarvis_credentials`.
- POSTs exigem o cabeçalho `X-Jarvis: 1` (proteção simples contra CSRF).
- `.env`, `data/` e `vault/` estão no `.gitignore`.

## Próximos passos (sugestão)
1. **Jean revisar o prompt** (`src/prompt.mjs`) e escolher o nome definitivo (A.V.I.L.A., JARVIS-BR…).
2. **Matriz de permissões**: 🟢 reversível / 🟡 sensível / 🔴 irreversível ou com custo, e como o "sim" funciona em cada canal (web, Telegram).
3. ~~Telegram~~ (feito). ~~Briefing 06:30 / revisão 21:00 + diário~~ (feito). ~~Etapa 1: roteador de custo~~ (feito; modelo local e reserva 9Router aguardam decisão). Próximo: primeira ferramenta de **nível 2 real** ao botão de "sim" — precisa de alvo externo aprovado pelo Jean.
4. **Status da VPS**: já entra por arquivo (`data/vps-status.json`, escrito por `/root/bin/gerar-vps-status.sh`). Pendente: os timers systemd `jarvis-status` (06:15/20:45) e `jarvis-diario` (22:00, publica o diário no vault `08-Diario`) aguardam o "sim" do Jean — sem eles, o briefing só envelhece a linha da VPS depois de 12 h e o diário não chega ao vault.
5. **Ferramentas de leitura** (agenda, web) conforme a matriz `docs/PERMISSOES.md`; depois escrita com aprovação.
6. **Memória**: embeddings locais e mais notas de diário.
7. **Voz**: Whisper + TTS pt-BR.

## Voicebox (TTS)

Opcional e desligado por padrão (`VOICEBOX=0`). Detalhes em [docs/VOICEBOX.md](docs/VOICEBOX.md). No Telegram: `/voz`, `/voz <frase>` ou "responder em áudio". Prefere o Voicebox do PC quando o túnel estiver no ar; senão usa o da VPS (CPU).
