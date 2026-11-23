# Ponte do Codex com o JARVIS e o Hermes

Estes arquivos deixam o **OpenAI Codex** (o programa no PC do Jean e o Codex na nuvem) chamar o JARVIS e, quando fizer sentido, o Hermes. Pense neles como um interfone: o Codex fala com o JARVIS pela API HTTP; o Hermes, que mora trancado dentro da VPS, só atende por um recado seguro (o próprio JARVIS ou um SSH que o Jean configurar).

## O que usar, e quando

| Situação | Caminho certo |
|---|---|
| Perguntar, pedir status, `/hermes`, `/status` | `node codex/bin/jarvis-ask.mjs "…"` |
| Só saúde da API ou status do Hermes | `jarvis-ask.mjs saude` ou `hermes` |
| Tarefa de verdade no agente Hermes (disco, logs, listar containers) | `hermes-tarefa.sh` / `.ps1` via SSH, **só no PC do Jean** |

O JARVIS é o caminho preferido. O `/hermes` no chat e o `GET /api/hermes` devolvem status e lista de tarefas — não mandam o agente executar um pedido livre. Ações de nível 2 (pausar, rodar, apagar) pedem o "sim" no Telegram; pela API, hoje, isso só avisa e não executa.

## Variáveis de ambiente

| Variável | Para que serve |
|---|---|
| `JARVIS_URL` | Endereço da API. VPS: `https://jarvis.72-62-11-116.sslip.io`. PC: `http://127.0.0.1:3200` (sem senha). |
| `JARVIS_USER` | Na VPS o usuário é `jean`. No PC local pode ficar vazio. |
| `JARVIS_PASS` | Senha do basic-auth da VPS. **Nunca** no Git, no `config.toml` ou na linha de comando. |
| `JARVIS_TIMEOUT_MS` | Tempo máximo, em milissegundos (padrão: 180000). |
| `HERMES_SSH` | Destino SSH (padrão: `root@72.62.11.116`). Opcional. |
| `HERMES_SSH_OPTS` | Opções extras do `ssh`, por exemplo `-i ~/.ssh/sua_chave`. Opcional. |

Não existe flag `--pass`: ela deixaria a senha no histórico do terminal.

## Codex no PC × Codex na nuvem

**No PC do Jean.** Se o JARVIS local estiver no ar, use `JARVIS_URL=http://127.0.0.1:3200`. Sem ele, aponte para a VPS com `JARVIS_USER` e `JARVIS_PASS`. O SSH do Hermes só funciona aqui, e só depois que o Jean colocar a chave (`HERMES_SSH_OPTS=-i …`). Os MCP `nvidia-app` (`http://127.0.0.1:13508/mcp`) e Mestre do PC (`http://127.0.0.1:7777/mcp`) também só existem no PC; veja o recorte em `config.toml.example`.

**Na nuvem do Codex.** A nuvem **não** alcança o `127.0.0.1` do PC nem o Hermes na VPS. Ela alcança o JARVIS público (`https://jarvis.72-62-11-116.sslip.io`) se você cadastrar `JARVIS_PASS` (e, se precisar, `JARVIS_USER=jean` e `JARVIS_URL`) como *secret* de ambiente do Codex. Sem a senha, a API responde 401 — e isso é o portão funcionando, não um bug.

O recorte de `~/.codex/config.toml` em `config.toml.example` é um exemplo. Não copie por cima do arquivo real do Jean.

## Exemplos

```sh
export JARVIS_URL=https://jarvis.72-62-11-116.sslip.io
export JARVIS_USER=jean
export JARVIS_PASS=    # cole só no ambiente, nunca no arquivo

node codex/bin/jarvis-ask.mjs saude
node codex/bin/jarvis-ask.mjs --json "quais os comandos?"
node codex/bin/jarvis-ask.mjs --conversa <id> "continua"

# Tarefa no agente (PC com chave). Sem SSH, o script avisa e cai no /hermes do JARVIS.
./codex/bin/hermes-tarefa.sh "status curto do disco"
```

Há um CLI mais completo na branch `cli` (`cli/jarvis.mjs`). Estes scripts não dependem dela estar na `main`.
