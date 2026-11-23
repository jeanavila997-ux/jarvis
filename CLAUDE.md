# Claude Code neste repositório

As regras do projeto, os scripts da ponte e a segurança estão em **AGENTS.md**. Leia aquele arquivo primeiro. Este texto só acrescenta o que é específico do Claude Code.

## Ponte com o JARVIS e o Hermes

Use os mesmos scripts do Codex (detalhes em `codex/README.md`):

- `node codex/bin/jarvis-ask.mjs "…"` — caminho preferido (saude, hermes, ou uma pergunta)
- `./codex/bin/hermes-tarefa.sh "…"` ou `.\codex\bin\hermes-tarefa.ps1 "…"` — tarefa no agente Hermes, **só no PC do Jean** com a chave SSH

Variáveis: `JARVIS_URL`, `JARVIS_USER`, `JARVIS_PASS`, `HERMES_SSH`, `HERMES_SSH_OPTS`. A senha nunca entra no Git, neste arquivo ou no histórico de comandos.

As permissões sugeridas estão em `.claude/settings.json`. Para os MCP do nvidia-app e do Mestre do PC, copie `.mcp.json.example` para `.mcp.json` no PC (a nuvem do Claude não alcança `127.0.0.1`). Não faça commit do `.mcp.json` se colocar cabeçalhos ou tokens.

## Segurança (iguais às de AGENTS.md)

- Nunca imprima, grave ou faça commit de segredos. Não leia `.env`, `vault/` nem `data/`.
- Nunca toque, leia, copie ou liste `OneDrive\COFRE REMOTO`.
- Nível 3 é proibido (apagar dados/backups, force-push, expor segredo, abrir porta, fallback pago). Só o Jean faz.
- Operações destrutivas na VPS, mudanças em SSH/UFW, abrir portas ou gastar dinheiro **só com confirmação explícita do Jean**.

A sintaxe de `.claude/settings.json` e de `.mcp.json.example` veio da documentação oficial do Claude Code (`permissions.allow`/`deny` no formato `Bash(comando *)` e `Read(./arquivo)`; MCP com `"type": "http"` e `"url"`). Os MCP acima são só no PC. Se o Claude Code recusar `http://127.0.0.1`, trate como a confirmar — em configuração gerenciada a documentação exige `https://`.
