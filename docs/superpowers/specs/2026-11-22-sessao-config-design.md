# Design — Sessão de Config no JARVIS (Etapa 2)

Data: 2026-11-22 · Autor: pi · Aprovação: Jean (pendente)

## Intenção e porquê

Hoje toda config do JARVIS vive no `.env` e só muda com `docker compose up -d`.
O Jean quer uma aba **Config** na web onde vê, testa, liga/desliga e edita TODAS
as integrações — APIs (Ollama Cloud, Ollama nativo `:11434`, Ollama Docker
`:11435`, OpenCode Go, OpenAI Codex, NVIDIA, 9Router), skills, comandos, MCP,
plugins, links e senhas — sem editar `.env`, sem restart e sem custos novos.

## Goals

- Aba Config na UI web (pt-BR, tema atual) com grupos: **APIs, Skills, Comandos, MCP, Plugins, Links, Senhas**.
- Cada API: card com chip ligado/desligado, campos editáveis (URL, modelo, chave), botão **Testar agora** (probe real, resultado com ms).
- Config editável em runtime: trocar modelo da nuvem, ligar/desligar plugins (telegram, hermes, nvidia, github, docker-mcp), reserva 9Router — tudo sem restart.
- Senhas: trocar chaves pela UI (valor nunca volta pela API; só "configurado ✓" + sufixo de 4 caracteres).
- Skills: listar, ver corpo, ativar/desativar na lista da rota nuvem.
- Links: lista editável (nome + URL) em `data/`.
- Persistência em `data/config.json` (gitignored), com camadas: defaults do código → `.env` → `data/config.json` (a última ganha).

## Non-goals (v1)

- Editar textos dos comandos/regras fixas pela UI (fica só visual).
- Telegram em runtime (token segue no `.env`; religar o poller fica para v2).
- Escrever no vault, mexer em `data/conversas` ou no roteador além de ler a config.
- Painel de custo novo (`/api/custo` já existe).

## Anti-goals (o que tornaria isto um fracasso mesmo funcionando)

- Segredo em texto na resposta HTTP, log, `data/auditoria.jsonl` ou `data/uso.jsonl`.
- Config commitada no git (`data/` é gitignored — permanece).
- Qualquer chamada paga automática só por abrir a aba (probes são GET/leitura).

## Constraints

- Node 22, sem dependências de runtime; testes `node --test` sem rede.
- Container `read_only` + `cap_drop: ALL`: `data/` é o único lugar gravável.
- POSTs exigem cabeçalho `X-Jarvis: 1` (já existe) e basic-auth do Traefik.
- Fluxo de deploy atual: implementar no `jarvis-local` (PC), testar, depois tarball p/ VPS quando o Jean pedir.

## Abordagens

1. **A — Painel de leitura + teste** (proposta primeira): só vê e testa; editar segue no `.env`. Descartada pelo Jean.
2. **B — Config editável em runtime** (escolhida): `data/config.json` sobrescreve env em runtime, com proteções (mascaração, auditoria sem valores, write atômico). Aceita o trade-off de segredos residirem em `data/` dentro do container, decisão explícita do Jean.

## Como funciona (decidido)

### Camadas e merge

- `lerConfig()` resolve na hora (cache 1s): defaults do módulo → `process.env` → `data/config.json`. Escritas fazem merge profundo e gravam de forma atômica (`.tmp` + rename).
- Chaves seguem vindo do `.env` se não existirem no config — nada quebra para quem não abre a aba.

### Grupos da aba

| Grupo | Conteúdo | Ações |
|---|---|---|
| APIs | Cards: Ollama Cloud (chave, modelo, timeout), Ollama nativo `:11434`, Ollama Docker `:11435`, OpenCode Go (base `https://opencode.ai/inference/go/openai/v1`, chave `oc_sk_`, modelo padrão do catálogo Go), OpenAI Codex (base `https://api.openai.com/v1`, modelo `gpt-5.3-codex`, fala `/responses`), NVIDIA (ligado, URL do proxy, token), 9Router (reserva on/off, URL, modelo, chave), Hermes (URL, chave) | editar · Testar agora |
| Senhas | Um campo por segredo: `OLLAMA_API_KEY`, `NINEROUTER_API_KEY`, `HERMES_API_KEY`, `NVIDIA_PROXY_TOKEN`, `DOCKER_MCP_TOKEN`, `OPENCODE_API_KEY`, `OPENAI_API_KEY` | trocar (vazio = mantém) |
| Skills | Lista de `data/skills/*/SKILL.md` + corpo completo | ver corpo · ativar/desativar (sai da lista da rota nuvem) |
| Comandos | Tabela dos comandos fixos de `src/regras.mjs` (ajuda, status, custo, hermes, nvidia, github) | visual (v1) |
| MCP | Status dos clientes (nvidia-app via proxy, docker-mcp) + allowlist de ferramentas de leitura | visual + Testar |
| Plugins | Liga/desliga: telegram, hermes, nvidia, github, docker-mcp | toggle em runtime |
| Links | `data/links.json` (nome, URL, nota) | adicionar/editar/remover |

### Rota "Testar agora" (tudo leitura/GET)

- Ollama (as três): `GET {base}/api/tags` — valida URL; com chave, valida `Authorization`.
- OpenCode Go e Codex: `GET {base}/models` com `Authorization: Bearer <chave>` (cheap, valida chave). 401 = chave; 200 = ok com contagem de modelos.
- 9Router: `GET {base}/health` (igual hoje), depois `/v1/models` com Bearer.
- NVIDIA: `tools/list` da ferramenta `nvapp_overlay_get_status` via proxy (só leitura).
- Hermes: `GET {HERMES_URL}/health` (sem chave — a status detalhada que usa chave fica de fora do probe).
- Resposta: `{ ok, ms, detalhe }` — a mensagem de erro NUNCA inclui a chave (ex.: "401 chave recusada").

### API nova no server

- `GET /api/config` — devolve tudo com segredos mascarados (`{ configurado, sufixo: "…5Mjt", fonte: "env|config|default" }`).
- `POST /api/config` — merge profundo; campos de segredo vazios = mantém o anterior; escreve atomicamente; registra em `data/auditoria.jsonl` (o QUE foi editado, nunca o valor).
- `POST /api/config/testar` — body `{ id }`; roda o probe do card.
- `GET /api/skills/:nome` — corpo completo (o `/api/skills` de lista já existe).
- `GET /api/mcp` — status dos clientes MCP + allowlist.
- Nada novo no `/api/chat` — o roteador passa a ler config via `lerConfig()`.

### Chave do OpenCode Go

O Jean forneceu uma chave pessoal `oc_sk_…` do OpenCode Console nesta conversa. Ela entra **só dentro de `data/config.json`** (gitignored, fora do container de commit), na implementação, pelo POST ou já inicializada por mim. Nunca em docs, log ou este arquivo.

### UI

Aba "Config" ao lado do chat (mesma `public/`), sidebar com os 7 grupos, cards com chip verde/vermelho + ms do último teste. Mobile igual ao restante. Sem nova dependência.

## Testes (`node --test`, sem rede)

`test/etapa2-config.test.mjs`: camadas/default→env→config; merge profundo; mascaração no GET (sufixo de exatamente 4, nunca valor pleno); segredo vazio mantém anterior; write atômico; toggle de plugin muda comportamento do módulo de exemplo; skills desativada desaparece de `listarLinha`; probe devolve erro sem ecoar valor (com fetch mockado).

## O que fica de fora para o builder decidir

- Nome exato das chaves internas do config (`apis.ollamaCloud.model` etc.) — manter próximo aos nomes de env.
- Micro-layout dos cards; ordenação dos grupos.
- Cache interno (1s) e invalidação — detalhe de implementação.

## Tamanho

Projeto médio: 1 módulo novo (`src/config.mjs`), ~150 linhas no `server.mjs` (rotas + injeção), ~250 linhas de UI, 1 arquivo de testes. Sem mudança no roteador além de trocar fonte de valores.
