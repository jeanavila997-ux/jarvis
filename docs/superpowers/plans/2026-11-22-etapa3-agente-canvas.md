# Etapa 3 — Agente OpenCode embutido + Canvas Obsidian — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (não há subagent tool neste harness) para implementar task por task. Steps usam checkbox.

**Goal:** O JARVIS ganha (1) agente de código OpenCode embutido in-process (`@opencode/sdk` 2.3.2) com comando `/agent`, plugin-guarda Effect e custo auditado; (2) Canvas Obsidian com grafo de notas ao vivo no chat.

**Architecture:** `src/grafo.mjs` (nós/arcos de wikilinks + co-citação, persistido na conversa) alimenta blocos de grafo SVG puro (`public/canvas.js`); `src/agent.mjs` mantém um host OpenCode in-process (import LAZY + fallback para plano B por regras se o host não levantar) atrás de um host injetável para testes; plugin Effect `jarvis-guarda` enforca plan-only no host (tool hooks + model transform + shell cap + context com perfil).

**Tech Stack:** Node 22 ESM; `node --test`; `@opencode/sdk@2.3.2` + `@opencode/plugin` + `effect` (primeira dependência de runtime — autorizada no spec); SVG/CSS puro no front.

**Spec:** `docs/superpowers/specs/2026-11-22-etapa3-opencode-canvas-design.md`

## Global Constraints

- v1 **plan-only**: agente nunca edita arquivo; `jarvis-guarda` veto é do HOST (tool hook), não do prompt.
- Sem fallback pago: Console falhou → plano B por regras (nunca outro serviço).
- Segredos: chave do Console só em `data/config.json`; nunca em log/commit/UI (padrão da Etapa 2).
- TDD: cada task começa com teste que falha; suite `node --test test/*.test.mjs`; alpine `--network none` via junction Temp (padrão da Etapa 2).
- `/agent` nível 1: sempre auditado; responde streaming NDJSON igual ao chat.
- pt-BR na UI; identificadores em inglês.

## Review Focus

1. Host OpenCode real não levantar (sem node_modules, memória, Windows) → JARVIS continua funcionando: `/agent` responde plano B com motivo. Teste: fake de import que lança (Task 3).
2. Grafo com trecho malformado / sem wikilinks / nome vazio → nunca quebra o chunk `fontes`; JSON serializável. Teste: Task 1.
3. `/api/nota/:nome` com `..` ou nome com barra → 400/404, nunca lee fora do vault. Teste: Task 2.
4. Plugin-guarda: `execute.before` com tool `write` em plan → rejeita; com `read` passa; model.transform remove não-aprovados. Teste: Task 4 (Effect.runPromise).
5. `/agent` com tarefa vazia ou gigante (8k) → 400 igual ao chat. Teste: Task 3.

---

### Task 1: `src/grafo.mjs` — nós, arcos, co-citação

**Files:** Create `src/grafo.mjs`; Test: `test/etapa3-grafo.test.mjs`

**Interfaces (Produces para Task 2/6):**
- `extrairWikilinks(texto)` → `['nota.md', ...]` — casa `[[nome]]` e `[[nome|alias]]`, normaliza, dedupe, ignora vazio e `../`.
- `criarGrafo()` → `{ tocar(nome, peso=1), registrarTurno(nomes, textoTrechos) , resumo() -> { nos:[{id,peso}], arcos:[{de,para,peso}] } }` — nós incluem fontes + vizinhos via wikilinks dos trechos; arcos = wikilink (peso 2 por ocorrência) + co-citação entre fontes do mesmo turno (peso 1); dedupe acumulando peso.

- [ ] Step 1: testes falhando — wikilinks simples/alias/vazio/dedupe; dois turnos acumulam peso; trecho sem wikilink → só co-citação; serializável JSON.
- [ ] Step 2: `node --test test/etapa3-grafo.test.mjs` → FAIL (módulo não existe)
- [ ] Step 3: implementar `src/grafo.mjs`
- [ ] Step 4: suite passa (16+9=25 etapa2/etapa3 + resto)
- [ ] Step 5: commit `feat(grafo): nós e arcos de wikilinks + co-citação por turno`

### Task 2: server — grafo no chunk `fontes` + `GET /api/nota/:nome`

**Files:** Modify `server.mjs`, `test/etapa3-grafo.test.mjs` (novo caso `acharNota`)

**Interfaces:** Consumes Task 1 (`criarGrafo`); Produces: chunk NDJSON `{tipo:'fontes', fontes, grafo}`; `acharNota(vaultDir, nome)` → path|null (basename puro, sem `..`/`/`); `GET /api/nota/:nome` → `{ nome, conteudo, grafoLocal }` (grafoLocal = wikilinks da própria nota) ou 404.

- [ ] Step 1: teste `acharNota` (tmpdir com vault fake): acha `.md` por nome, ignora `..`, 404 inexistente — FAIL
- [ ] Step 2: implementar `acharNota` em `src/grafo.mjs` + rota no server; `perguntar()` cria/usa `conv.grafo ||= criarGrafo()` e toca fontes antes de salvarConv
- [ ] Step 3: suite passa; smoke: chat local devolve chunk `fontes` com grafo; `/api/nota/<nota real>` devolve conteúdo
- [ ] Step 4: commit `feat(grafo): /api/nota e grafo por conversa no chunk fontes`

### Task 3: dependências + `src/agent.mjs` (host injetável) + rota `/agent`

**Files:** Modify `package.json` (deps), `docker-compose.local.yml` (volumes node_modules + opencode-workspace), Create `src/agent.mjs`, `test/etapa3-agente.test.mjs`, rotas em `server.mjs`

**Interfaces:**
- Consumes: config (`opencodeGo.apiKey`, card novo `apis.agenteOpenCode` da Task 6 — placeholder env até lá); Produces:
  - `criarAgente({ obterConfig, hostFabrica, agora, auditar, log })` → `{ disponivel(), perguntar({tarefa, onEvento, onDelta, signal}) -> {resposta, tokensIn, tokensOut}, fechar() }`
  - `hostFabrica()` default = import LAZY `@opencode/sdk` → `OpenCode.create({ config })`; testes injetam fake `{ sessions: { create, prompt }, close }`
  - Rota: `POST/GET` não — `/agent` entra pelo mesmo `/api/chat` (regra em `perguntar()` ANTES do roteador): casa `/^\/?(agente)\s+(.+)$/i` → audita nível 1, chama `agente.perguntar` com onDelta streaming (`tipo:'delta'`), rota `agente-opencode` em uso.jsonl; falha → plano B regras com motivo.
- compose.local volumes: `./node_modules:/app/node_modules` e `./opencode-workspace:/app/opencode-workspace` (rw).

- [ ] Step 1: `npm i @opencode/sdk` (+ peer `effect` vem junto como dep) no projeto — autorização já dada no spec; registrar versão exata
- [ ] Step 2: testes falhando (fake host): `perguntar` cria sessão, envia prompt, stream events → delta → resposta; host que lança → `disponivel() false` + plano B; tarefa vazia/>8k → rejeita; audit level 1 chamada
- [ ] Step 3: implementar `src/agent.mjs` (host LAZY + try/catch; guarda host num módulo para o processo) + regra `/agent` em `perguntar()` antes do roteador + `agenteOpenCode` placeholder no `statusAtual()`
- [ ] Step 4: suite passa; smoke local real: node -e cria host REAL com `OpenCode.create()` (sem prompt pago), `server.info()`; se levantar → registro no ledger; se não levantar → Ruling (agente fica disponível=false até ambiente resolver)
- [ ] Step 5: compose restart + smoke curl `/agent oi` (com modelo da config) — se Console cobrar, usar modelo `-free` para o smoke (ex. `big-pickle-free`? confirmar catálogo `-free` com a chave), depois ledger do custo
- [ ] Step 6: commit `feat(agente): OpenCode in-process com /agent, plano B e auditoria`

### Task 4: plugin Effect `jarvis-guarda`

**Files:** Create `agente/plugins/jarvis-guarda/index.js` (JS puro, sem build), `test/etapa3-guarda.test.mjs`; Modify `src/agent.mjs` (host carrega os plugins)

**Interfaces:** Consumes: `@opencode/plugin/effect` + `effect` (do node_modules do SDK 4.1.0 — devDep pin `effect@4.1.0` para testes); Produces: `Plugin.define({ id:'jarvis-guarda', effect })` com:
- `tool.hook("execute.before")`: tool em `['write','edit','multiedit','bash','task']` → `Tool.Error "modo plan: escrita bloqueada pela Guarda do JARVIS"`; `read/grep/glob/list` passam
- `session.hook("context")`: push system part com resumo PERMISSOES (string fixa curta)
- `model.transform`: mantém só modelos da lista de aprovados passada em `ctx.options.modelos` (default: modelo da config)
- `shell.hook("create.before")`: `event.timeout = Math.min(event.timeout, 60000)`
- `websearch.transform`: `editor.default.set(false)`

- [ ] Step 1: testes falhando com `Effect.runPromise` por hook (evento fake): veto write, passa read, cap timeout, filtragem de modelos
- [ ] Step 2: implementar plugin JS (hooks puros; sem fiber); registrar no host real na Task 3 fluxo (`OpenCode.create({ plugins: [jarvisGuarda()] })` — opção `mode`/`modelos` da config)
- [ ] Step 3: suite passa (testes do plugin rodam com effect do node_modules)
- [ ] Step 4: commit `feat(agente): plugin guarda (plan-only no host, catálogo aprovado, cap de timeout)`

### Task 6: card "Agente OpenCode" na Config

**Files:** Modify `src/config.mjs` (+`apis.agenteOpenCode: { ligada, model, agente, modelos: string[] }`), `test/etapa2-config.test.mjs` (casos novos), `public/config.js` (card), rotina da Task 3 troca placeholder → cfg

**Interfaces:** `agente`: enum `'plan'|'build'` (v1 UI só oferece `plan`); `modelos`: lista aprovados (default `[model]`).

- [ ] Step 1: testes schema (ligada bool, agente enum, modelos strings) — FAIL; implementar; UI card reusando `cardApi` com select plan/build
- [ ] Step 2: suite + smoke POST seta modelo/agente e `/agent` usa corrente
- [ ] Step 3: commit `feat(config): card Agente OpenCode (ligada, modelo, agente, modelos aprovados)`

### Task 5 (executada junto da 6): Canvas Obsidian com grafo ao vivo

**Files:** Create `public/canvas.js`; Modify `public/index.html`, `public/app.css`, `public/app.js` (gancho no chunk fontes)

**Interfaces:** Consumes: chunk `fontes` com `grafo`; `GET /api/nota/:nome`. Produces: bloco SVG de grafo sob cada resposta (colapsável) + botão "Modo canvas" (dialog fullscreen com grafo acumulado da conversa, arrastável) + painel de nota (markdown simples reusando `md()` do app.js).

- [ ] Step 1: index.html — `<dialog id="janelacanvas">` + `<button id="canvasBtn" class="cfgbtn">▦</button>`
- [ ] Step 2: canvas.js — física de molas/repulsão (30 linhas), nós por conversa a partir de `cfgAtual`→não: acumula dos chunks; double-click → painel nota; mobile ok
- [ ] Step 3: CSS (grafo, arrastar, painel); smoke visual entregue ao Jean (+ curl de endpoints)
- [ ] Step 4: commit `feat(canvas): grafo obsidian ao vivo no chat e modo canvas fullscreen`

### Task 7: README + suite final + review

- [ ] README: seção Etapa 3 (`/agent`, plugin-guarda, canvas, dependência nova, deploy VPS — tarball + node_modules)
- [ ] Suite alpine 36+novos → PASS; ledger final review self-review (sem subagent)
- [ ] Commit `docs: Etapa 3 (agente embutido e canvas) no README`

## Self-review

- Spec coberto: `/agent` (T3–4), plugin-guarda (T4, adiciona enforcement host), card Config (T6), canvas ao vivo + /api/nota + persistência (T1–2, T5), custo uso.jsonl (T3), sem fallback pago (T3 testes), 256MB/host LAZY com fallback (T3 R1 review focus).
- Interfaces consistentes entre tasks ✓ (nomes `criarGrafo/resumo`, `criarAgente/perguntar`, `acharNota`).
- Risco real admitido: lift do host OpenCode real em Node22/alpine/256MB — Task 3 Step 4 é o gate; se falhar, agente fica off (plano B) e o resto da entrega não depende dele.
