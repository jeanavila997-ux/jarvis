# Design — Etapa 3: Agente OpenCode embutido + Canvas Obsidian no JARVIS

Data: 2026-11-22 · Autor: pi · Aprovação: Jean (pendente)

## Intenção e porquê

Duas novidades que o Jean pediu juntas:

1. **Agente OpenCode embutido no JARVIS** (`@opencode/sdk` in-process): o JARVIS ganha um agente de código nativo (sessões + prompts + stream de eventos) usando os modelos do OpenCode Console com a chave `oc_sk…` que já está na config. Escolha do Jean: roti A (dentro do sistema JARVIS), não Cloudflare.
2. **Modo Canvas Obsidian com grafos ao vivo no chat**: enquanto o Jean conversa, um grafo das notas do vault conectadas a cada resposta — nós = notas, arcos = `[[wikilinks]]` entre elas + co-citação no mesmo turno — arrastável, com "modo canvas" em tela cheia, sem dependências novas no front.

## Goals

- Comando **`/agent <tarefa>`** no chat web (e regra fixa): cria sessão OpenCode, envia prompt, transmite os eventos para o chat ao vivo e responde o texto final.
- **V1 sem escrita**: agente em modo `plan` (leitura/análise) — cabe no nível 1 da matriz (audita e não pede "sim"); modo `build` (edita) fica para v2 com confirmação.
- Cartão novo na aba Config: **Agente OpenCode** (ligado, modelo do Console, agente `plan|build`, workspace) reaproveitando `opencodeGo.apiKey` como chave do provider.
- **Grafo ao vivo**: cada resposta do JARVIS que use o vault recebe um bloco de grafo (nós das notas usadas + vizinhas por wikilink), atualizando por turno; botão **modo canvas** abre tela cheia com o grafo acumulado da conversa inteira.
- Clicar num nó abre a nota em painel lateral (leitura markdown).
- Modelo de grafo persistido na conversa (`data/conversas/*.json` ganha `grafo: {nos: [...], arcos: [...]}` — sobrevive a reload).
- Custo/uso: nova rota `agente-opencode` em `data/uso.jsonl` com tokens do Console quando a session reportar.

## Non-goals (v1)

- OpenCode editando arquivos do `Projetos/` reais (workspace isolado do JARVIS; v2 com "sim").
- Cloudflare Durable Object (doc colada registrada, fora do escopo).
- Grafo persistido do vault inteiro (index de milhares de notas) no navegador — v1 é grafo por conversa + vizinhança imediata.
- Novos plugins `@opencode/plugin` (agente padrão transformável depois).

## Constraints

- `@opencode/sdk` é a PRIMEIRA dependência de runtime do JARVIS (2.3.2): exceção registrada; monta-se `node_modules` como volume no compose (container continua `read_only`).
- Container: 256 MB / Node 22 alpine / rede bridge com saída — host OpenCode em-process dentro do mesmo processo do JARVIS; workspace do agente em novo volume `./opencode-workspace:/app/opencode-workspace` (rw, isolado).
- Chave do provider: `OPENCODE_API_KEY` no ambiente do processo + config provider `opencode-console` (`https://opencode.ai/inference/…`) gerada on-boot de `data/config.json` (nunca em disco claro novo).
- Permissões: `/agent` = nível 1 (auditoria), plan-only v1; NUNCA apaga nada; sem fallback pago (se Console falhar, plano B = regras, igual hoje).
- Front continua sem framework: grafo em SVG puro (física de molas + repulsão, 60 fps alvo < 200 nós).

## Partes decididas

### Agente embutido (`src/agent.mjs`)

- `criarAgente({ dataDir, env, config })` → `{ ligado()`, criarSessao(), prompt({sessao, texto, onEvento}), fechar }` — guarda o host (`OpenCode.create()`) para o processo inteiro; `await using` não cabe em servidor longo: fecha no SIGTERM junto com os outros clientes.
- Config no boot: `OPENCODE_API_KEY` do `opencodeGo.apiKey` (config) + `default agent` e modelo escolhidos no card da aba Config (ex.: `claude-fable-5` — o Jean troca quando quiser no catálogo de 105).
- `/agent <tarefa>` vira regra fixa de nível 0 na decisão, mas ação nível 1 (auditado); responde em stream NDJSON igual ao chat (`tipo: 'evento'` para cada tool/step).
- Falha do Console → mensagem clara + plano B por regras (nunca outro serviço pago).

### Canvas/grapho (`public/canvas.js`, CSS, SVG)

- Depois de cada resposta com `fontes`, o server devolve também `grafo: {nos, arcos}` no chunk final (server calcula: nós = fontes; arcos = wikilinks `[ [x] ]` encontrados no texto dos trechos + arco de co-citação no turno).
- Bloco de grafo embutido sob a resposta (SVG ~240 px, colapsável) + botão "Modo canvas" (tela cheia, `dialog` como a Config) com grafo acumulado da conversa.
- Física ao vivo: nós entram com pulse no reator; arrastar nó fixa; duplo clique abre nota em painel (GET `/api/nota/:nome` novo — leitura do vault via índice).
- Nomes: nós usam o nome da nota (igual etiqueta `[[...]]` que já aparece).

## Testes (node --test, sem rede)

- `agent.mjs`: host fake injetável (mesmo padrão da SDK: interfaces `sessions.create/prompt/events`) — testes de comando `/agent`, rota `agente-opencode`, falha Console → plano B, auditoria nível 1.
- Grafo: extração de wikilinks de trechos, nós/arcos no JSON da conversa, dedupe, peso da co-citação.
- `/api/nota/:nome`: devolve markdown do vault, 404 para nome inexistente, rejeita traversal (`..`).

## Tamanho

Médio-grande: 2 módulos novos (`src/agent.mjs`, `src/grafo.mjs`), rotas no server, `public/canvas.js` (~250 linhas), card na Config, ~15 testes. Uma dependência nova de runtime (@opencode/sdk) que o Jean aprovou com o pedido.

## O que fica para decisão do Jean na aprovação

- Confirmar o modelo padrão do agente (sugestão: `claude-fable-5` do catálogo da sua chave; você troca a qualquer momento na aba Config).
- Confirmar: v1 plan-only (não edita nada) — build fica v2 com "sim".

## Adição do Jean (22/11): plugin Effect `jarvis-guarda`

Análise da doc de `@opencode/plugin/effect` (colada pelo Jean): transforms/hooks/storage com Scope. Encaixe aprovado no design:

- `tool.hook("execute.before")`: veta `write`/`edit`/`bash` em modo plan (a Guarda passa a ser do HOST, não do prompt); em modo build v2, destrava por sessão com o "sim".
- `session.hook("context")`: injeta PERSONALIDADE + resumo do PERMISSOES.md no system do agente.
- `model.transform`: catálogo do agente = só modelos aprovados na aba Config (teto de custo aplicado por transform).
- `shell.hook("create.before")`: cap de timeout, env controlado, cwd do workspace.
- `websearch.transform`: default false (nada pago fora de controle).
- Plugin local montado read-only do repo (`.opencode/plugins/jarvis-guarda/`), carregado por `OpenCode.create({ plugins: [...] })`; sem plugins de terceiros v1; `effect@4.0.1` como peer/dev dep, sem bundle.
