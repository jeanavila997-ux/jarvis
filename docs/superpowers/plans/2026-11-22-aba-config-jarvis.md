# Aba Config no JARVIS (Etapa 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aba Config na web do JARVIS que vê, testa, liga/desliga e edita todas as integrações (APIs, skills, comandos, MCP, plugins, links, senhas) em runtime, sem `.env` e sem restart.

**Architecture:** Módulo `src/config.mjs` resolve config em camadas (defaults → `process.env` → `data/config.json`) com segredos mascarados; `server.mjs` troca constants de nuvem/reserva por leitura runtime e expõe `GET/POST /api/config` + teste por card; UI nova `public/config.js` (overlay com 7 grupos) reutiliza a estética atual.

**Tech Stack:** Node 22 ESM sem dependências; `node --test`; fetch nativo; UI JS/CSS puro (mesmo padrão de `public/`).

**Spec:** `docs/superpowers/specs/2026-11-22-sessao-config-design.md` (aprovado pelo Jean, opção B)

## Global Constraints

- Segredo nunca volta com valor pleno: GET devolve `{ configurado, sufixo, fonte }` (spec: "Senhas").
- Mensagem de erro NUNCA contém a chave (spec: rota "Testar agora").
- POSTs exigem cabeçalho `X-Jarvis: 1` (já no server) e gravação atômica (`.tmp` + rename).
- `data/config.json` nunca vai ao git (`data/` já é gitignored); auditoria registra caminhos editados, nunca valores.
- Node 22 sem dependências de runtime; testes `node --test test/etapa2-config.test.mjs` sem rede (fetchInjetável).
- pt-BR na UI e nos textos; identificadores em inglês.
- Container `read_only`: só `data/` (rw) e `tmpfs /tmp` são graváveis.

## Review Focus

1. Segredo pleno vazar em `GET /api/config` → deve devolver só `{ configurado, sufixo: últimos 4, fonte }`. Teste: Task 1, `mask nunca expõe valor`.
2. POST com segredo vazio/ausente apagando o valor anterior → deve MANTER. Teste: Task 1, `segredo vazio mantém anterior`.
3. Probe falhando com texto do servidor que contém a chave → mensagem sanitizada sem o valor. Teste: Task 2, `erro de probe não ecoa a chave`.
4. `data/config.json` corrompido (JSON inválido) → fallback para env+defaults sem derrubar o server, com `[config]` warn. Teste: Task 1, `arquivo corrompido cai para env`.
5. POST inválido (corpo não-objeto, path com `__proto__`, valor não-string em segredo) → 400, nada gravado. Teste: Task 1, `rejeita corpo inválido` + validação em `definir`.

---

### Task 1: `src/config.mjs` — camadas, merge, máscara, write atômico

**Files:**
- Create: `src/config.mjs`
- Test: `test/etapa2-config.test.mjs`

**Interfaces:**
- Consumes: nada (módulo novo, só `node:fs/promises`, `node:path`).
- Produces (usado por Tasks 3–4):
  - `criarConfig({ dataDir, env = process.env, fetchFn = fetch, probes = {}, agora = () => Date.now() })` → `{ listar(), definir(parcial), resolvido(), testar(id) }`
  - `listar()` → `{ apis, plugins, skills: { desativadas }, links, comandos }` com segredos mascarados: `{ configurado: boolean, sufixo: '…abcd'|null, fonte: 'env'|'config'|'default' }`
  - `resolvido()` → valores reais (uso interno do server): `{ ollamaCloud: { url, apiKey, model, timeoutMs }, ninerouter: { ligada, url, apiKey, model, timeoutMs }, hermes: { ligada, url, apiKey }, nvidia: { ligada, url, token }, dockerMcp: { ligada, url, token }, opencodeGo: { ligada, url, apiKey, model, timeoutMs }, codex: { ligada, url, apiKey, model, timeoutMs }, plugins, skillsDesativadas, links }`
  - `definir(parcial)` → merge profundo sobre `data/config.json`, segredo `''`/ausente mantém anterior, retorno = `listar()` atualizado; rejeita (throw) corpo inválido.
- Chaves padrão (id → seção):
  - `ollamaCloud`: `url: env.OLLAMA_URL || 'https://ollama.com'`, `apiKey: env.OLLAMA_API_KEY || ''`, `model: env.JARVIS_MODEL || 'glm-5.3-flash'`, `timeoutMs: env.JARVIS_TIMEOUT_MS || 180000`
  - `opencodeGo`: `{ ligada: false, url: 'https://opencode.ai/inference/go/openai/v1', apiKey: '', model: 'kimi-k3', timeoutMs: 60000 }`
  - `codex`: `{ ligada: false, url: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-5.3-codex', timeoutMs: 60000 }`
  - `nativourl` informativo sem card editável não existe — cards informativos `ollamaNativo: { url: 'http://host.docker.internal:11434' }` e `ollamaDocker: { url: 'http://host.docker.internal:11435' }` (só `url`)
  - `ninerouter`: `{ ligada: env.NINEROUTER_RESERVA==='1', url: env.NINEROUTER_URL||'', apiKey: env.NINEROUTER_API_KEY||'', model: env.NINEROUTER_MODEL||'', timeoutMs: env.NINEROUTER_TIMEOUT_MS||20000 }`
  - `hermes`: `{ ligada: Boolean(env.HERMES_URL), url: env.HERMES_URL||'', apiKey: env.HERMES_API_KEY||'' }`
  - `nvidia`: `{ ligada: env.NVIDIA_APP==='1', url: env.NVIDIA_MCP_URL || env.NVIDIA_PROXY_URL || '', token: env.NVIDIA_PROXY_TOKEN||'' }`
  - `dockerMcp`: `{ ligada: env.DOCKER_MCP==='1', url: env.DOCKER_MCP_URL||'', token: env.DOCKER_MCP_TOKEN||'' }`
  - Cópia de telegram off do compose: `TELEGRAM_BOT_TOKEN` sempre `''` no local — `plugins.telegram` = `Boolean(env.TELEGRAM_BOT_TOKEN)` (visual)
- CAMINHOS_SEGREDO (nunca retornam valor): `apis.ollamaCloud.apiKey`, `apis.opencodeGo.apiKey`, `apis.codex.apiKey`, `apis.ninerouter.apiKey`, `apis.nvidia.token`, `apis.hermes.apiKey`, `apis.dockerMcp.token`

- [ ] **Step 1: Escrever testes que falham** — em `test/etapa2-config.test.mjs`, `node:test` + `node:assert`, com `dataDir` em `mkdtemp(os.tmpdir())`:

```js
// 1) default→env→arquivo: env define apiKey; depois definir() sobrescreve model
// 2) listar() traz '{configurado:true, sufixo:"…"+ últimos 4, fonte:"env"}' e NUNCA o valor
//    assert(!JSON.stringify(listagem).includes(VALOR_SECRETO))
// 3) definir() com segredo '' mantém o anterior (listar segue configurado:true, mesmo sufixo)
// 4) merge profundo: definir({apis:{ollamaCloud:{model:'x'}}}) não perde apiKey nem url
// 5) gravação atômica: data/config.json existe e nenhum *.tmp sobra
// 6) arquivo corrompido (escreve 'não-json' antes) → resolvido() ainda funciona (env) e não lança
// 7) definir(42) / definir({__proto__:{x:1}}) / definir({apis:{codex:{apiKey:5}}}) → lança, nada gravado
```

- [ ] **Step 2: Rodar e ver falhar** — `node --test test/etapa2-config.test.mjs` → FAIL (módulo não existe)
- [ ] **Step 3: Implementar `src/config.mjs`** — assinaturas acima; merge profundo com `Object.prototype` safe (só chaves próprias, `Object.create(null)` interno, rejeita `__proto__`/`constructor`); escrita atômica igual `salvarConv` (tmp+rename); `definir` valida: root objeto plano, valores de segredo string ou vazio, números/bool permitidos só em campos conhecidos (`ligada`, `timeoutMs`); `resolvido()` faz cache 1000 ms (`agora()` injetável).
- [ ] **Step 4: Rodar e ver passar** — `node --test test/etapa2-config.test.mjs` → PASS (todos)
- [ ] **Step 5: Commit** — `git add src/config.mjs test/etapa2-config.test.mjs && git commit -m "feat(config): módulo de configuração em camadas com máscara de segredos"`

### Task 2: Probes "Testar agora" em `src/config.mjs`

**Files:**
- Modify: `src/config.mjs` (adiciona `testar(id)`)
- Test: `test/etapa2-config.test.mjs` (adiciona casos)

**Interfaces:**
- Consumes: `resolvido()` (Task 1); `probes = { nvidia: async () => {ok, detalhe}, github: async () => {ok, detalhe} }` injetados por `criarConfig` (server passa os clientes reais; testes mockam).
- Produces: `testar(id)` → `Promise<{ ok: boolean, ms: number, detalhe: string }>`; erro sanitizado (regex remove o valor da chave se aparecer no texto).

- [ ] **Step 1: Escrever testes que falham** — id→probe esperado:

```js
// ollamaNativo → GET {url}/api/tags (fetchFn mock: 200 {models:[...]}) → ok, detalhe contém '2'
// opencodeGo   → GET {url}/models com Authorization Bearer (mock confere header) 200 → ok
// codex        → GET {url}/models Bearer
// ninerouter   → GET <raiz sem /v1>/api/health
// hermes       → GET {url}/health
// nvidia/github→ chamam probes injetáveis (resolve mock {ok:true})
// 401 mockado  → ok:false, detalhe 'chave recusada (401)'
// mock devolve corpo com a chave no texto → assert(!detalhe.includes(CHAVE))
// id inválido  → lança erro 'id desconhecido'
```

- [ ] **Step 2: Rodar e ver falhar** — `node --test test/etapa2-config.test.mjs` → FAIL nos novos casos
- [ ] **Step 3: Implementar `testar(id)`** — mapa id→{tipo, url, chave}; timeout 8000 ms via AbortController; `ok = r.ok`; detalhe limitado a 120 chars; sanitização: `msg.split(chave).join('[chave]')` para toda resposta de erro; probes de nvidia/github chamam `probes[id]` e acrescentam ms.
- [ ] **Step 4: Rodar e ver passar** — `node --test test/etapa2-config.test.mjs` → PASS
- [ ] **Step 5: Commit** — `git commit -am "feat(config): testes de saúde por API (probes) com sanitização de segredos"`

### Task 3: `server.mjs` — rotas + override em runtime da nuvem e reserva

**Files:**
- Modify: `server.mjs` (imports no topo, criação `cfg` depois de `skills`, rotas no handler, substituições `MODEL/API_KEY/reserva`)

**Interfaces:**
- Consumes: `criarConfig` (Task 1–2: `listar/definir/resolvido/testar`); `auditar(DATA_DIR, e)` (existe); clientes `nvidia`/`dockerMcp` (já existem).
- Produces (usado pela UI Task 4):
  - `GET /api/config` → `{ ...cfg.listar(), comandos: ['status','ajuda','custo','permissoes','hermes','nvidia','github'], mcp: { nvidia: {ligada, ok, motivo, ferramentas}, github: {...} } }` (mcp = snaps já medidos, sem nova chamada)
  - `POST /api/config` (X-Jarvis) → merge + auditoria `{canal:'web', acao:'config-editada', campos:[caminhos alterados], resultado:'ok'}` (sem valores) → devolve o `listar()`
  - `POST /api/config/testar` (X-Jarvis) body `{id}` → `cfg.testar(id)`
  - `GET /api/skills/<nome>` → `{ nome, corpo }` (via `skills.corpos([nome])`)

- [ ] **Step 1: Alterar server.mjs**:
  - Import: `import { criarConfig } from './src/config.mjs';`
  - Depois de `const skills = ...`: `const cfg = criarConfig({ dataDir: DATA_DIR, probes: { nvidia: async () => { if (!nvidia.ativa) return {ok:false, detalhe:'desligado'}; const s = await nvidia.saudavel(); return {ok:s.ok, detalhe:s.ok?(s.ferramentas||[]).length+' ferramentas':(s.motivo||'indisponível')} }, github: /* idem dockerMcp */ } });`
  - Nuvem em runtime: dentro de `perguntar()` e `chat()`, substitua usos de `MODEL/API_KEY/OLLAMA_URL/TIMEOUT_MS` por `const nuvem = cfg.resolvido().ollamaCloud` (model, apiKey, url, timeoutMs). `statusAtual()`/`/api/saude`/`enviar inicio` passam a `nuvem.model`.
  - Reserva em runtime: trocar `const reserva = criarReserva(...)` por:
    ```js
    let reservaCache = ''; let reservaObj = null;
    const reserva = new Proxy({}, { get: (_, k) => { const n = cfg.resolvido().ninerouter; const sig = JSON.stringify(n); if (sig !== reservaCache) { reservaCache = sig; reservaObj = criarReserva({ ligada: n.ligada, url: n.url, model: n.model, apiKey: n.apiKey, timeoutMs: n.timeoutMs }); } return reservaObj[k]; } });
    ```
    (hermes/nvidia/dockerMcp/roteador local seguem do env — fora do escopo v1 do toggle em runtime, só o chip visual reflete config)
  - Rotas novas no handler (antes do fallback `estatico`): conforme Interfaces acima; `POST /api/config` também atualiza os snaps? Não — probes sob demanda.
- [ ] **Step 2: Smoke do servidor local** (rede apenas para 127.0.0.1 e endpoints já autorizados):
  - `docker compose -f docker-compose.local.yml up -d --build` (sem build — mount, é `restart`: `docker compose -f docker-compose.local.yml restart jarvis`)
  - `curl -s http://127.0.0.1:3200/api/config | head -c 400` → JSON com apis mascaradas
  - `curl -s -X POST -H 'x-jarvis: 1' -H 'content-type: application/json' -d '{"apis":{"ollamaCloud":{"model":"qwen3.5:4b"}}}' http://127.0.0.1:3200/api/config` → listar com model novo e fonte config
  - `data/auditoria.jsonl` última linha tem `campos:["apis.ollamaCloud.model"]` e NÃO contém segredo
  - `curl -s http://127.0.0.1:3200/api/saude` → modelo refletido
- [ ] **Step 3: Rodar suite inteira** — `docker run --rm --network none -u 1000:1000 --read-only --tmpfs /tmp -v <repo>:/app:ro -w /app node:22.23.5-alpine node --test test/` → PASS
- [ ] **Step 4: Commit** — `git commit -am "feat(config): rotas /api/config com override em runtime e auditoria sem valores"`

### Task 4: UI — aba Config (`public/config.js`, `index.html`, `app.css`)

**Files:**
- Create: `public/config.js`
- Modify: `public/index.html` (botão ⚙ no header + `<dialog id="janelaconfig">`), `public/app.css` (estilos dos cards/chips/tabs)

**Interfaces:**
- Consumes: `/api/config`, `POST /api/config` e `/api/config/testar` (Task 3), `GET /api/skills/:nome`
- Produces: UX — botão `#configBtn` (⚙) no header abre overlay com sidebar: APIs · Skills · Comandos · MCP · Plugins · Links · Senhas

- [ ] **Step 1: index.html** — `<button id="configBtn" class="icone" aria-label="Configurações">⚙</button>` no header, `<dialog id="janelaconfig" class="config"><nav>…abas…</nav><section id="configConteudo"></section></dialog>` antes do `<script src="app.js">`; carregar `<script src="config.js" defer></script>`
- [ ] **Step 2: config.js** — sem framework:
  - `carregar()` → `api('/api/config')` (reusar `api()` global do app.js)
  - APIs: card por id com campos url/model/editáveis; segredo `<input type="password">` placeholder `••••sufixo (deixe vazio p/ manter)`; botões **Salvar** (POST merge do card) e **Testar** (POST `/api/config/testar {id}` → chip verde `ok N ms` / vermelho motivo); card `ligada` para OpenCode Go, Codex, 9Router (switch)
  - Senhas: campos por caminho de segredo com nome amigável; salvar = POST só desse caminho
  - Skills: lista com switch (POST `skills.desativadas`) e botão "ver corpo" → `GET /api/skills/<nome>` em `<pre>`
  - Comandos/MCP: somente leitura (tabelas)
  - Plugins: switches (`apis.*.ligada` + `plugins.telegram` visual)
  - Links: lista editável (nome, url, nota) — salvo em POST `links`
- [ ] **Step 3: app.css** — estilos `.config`, `.cardapi`, `.chip.ok/.falha`, `.abacfg` seguindo tema atual (escura, neon ciano); dialog fullscreen no mobile
- [ ] **Step 4: Smoke visual** — abrir `http://127.0.0.1:3200`, clicar ⚙: abas carregam; Testar `ollamaNativo` → verde; Testar `opencodeGo` após Task 5 injetar chave → verde `N modelos`; edição de modelo da nuvem reflete no chip do header após nova conversa
- [ ] **Step 5: Commit** — `git commit -am "feat(ui): aba Config com cards de APIs, senhas mascaradas, skills e plugins"`

### Task 5: Chave do OpenCode Go + README + ajuste final

**Files:**
- Modify: `data/config.json` (LOCAL, via POST — gitignored), `README.md` (seção nova)

**Interfaces:** Consumes: Tasks 3–4. Produces: instância local do PC com `opencodeGo.apiKey` configurada e documentação atualizada.

- [ ] **Step 1: Injetar a chave OpenCode Go (`oc_sk_…` fornecida pelo Jean na conversa)** via `data/config.json` direto no disco do projeto local (arquivo gitignored, nunca em doc/log/commit); confirmar via `GET /api/config` que só aparece `…sufixo`
- [ ] **Step 2: Testar o card OpenCode Go** — `POST /api/config/testar {"id":"opencodeGo"}` → `ok:true` e contagem de modelos do catálogo Go
- [ ] **Step 3: README.md** — nova seção "Aba Config (Etapa 2)" após "Roteador de custo": o que dá pra fazer (ver/testar/editar runtime), onde vive (`data/config.json`), regra de segredos (nunca voltam, troca pela aba Senhas), e nota de deploy VPS (`rsync` do tarball já segue o mesmo fluxo; `data/` não sobe — config do PC não vai pra VPS)
- [ ] **Step 4: Suite final** — `node --test` completo dentro do container com `--network none` → PASS
- [ ] **Step 5: Commit** — `git commit -am "docs: aba Config (Etapa 2) no README"`

---

## Self-review (feito)

- Cobertura do spec: 7 grupos da aba (APIs Task 3+4; Senhas Task 1 mask + Task 4; Skills Task 3 rota + Task 4; Comandos Task 3 lista + Task 4; MCP Task 3 `mcp` + Task 4; Plugins Task 1/3/4; Links Task 1/3/4) ✓; probe por card ✓; runtime override nuvem+reserva ✓; auditoria sem valores ✓; chave oc_sk só em data/config ✓.
- Tipos consistentes: `criarConfig` assinaturas casam Task 1↔2↔3; `testar` retorno `{ok,ms,detalhe}` único ✓.
- Proporção: plano < spec×2 ✓.
- Nota de decisão menor registrada: `hermes/nvidia/dockerMcp/roteador local` continuam lendo env na instância em uso (toggle em runtime vira v2); chips refletem `api.ligada` da config.
