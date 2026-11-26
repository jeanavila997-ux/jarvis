# Regras para o Codex neste repositório

Se estiver no Claude Code, veja também `CLAUDE.md`.

Fale e escreva em **pt-BR**, no modo professor: explique o porquê, sem jargão solto. Este é o código do JARVIS, o assistente pessoal do Jean.

## O que é este projeto

Servidor Node (sem dependências externas) que responde em português, consulta o vault Obsidian e fala com o Hermes, o nvidia-app e o Mestre do PC.

**A `main` é a fonte oficial.** Deploy na VPS e instalação no PC só a partir da `main`, depois de conferir o commit (`git log -1`). A antiga `vps-main` já está inteira dentro da `main` e não deve ser usada para deploy. Não faça deploy de worktrees, pastas temporárias ou branches já mescladas. Há um CLI mais completo na branch `cli` (ainda não mesclado); os scripts em `codex/bin/` são independentes dele.

Como rodar os testes: `npm test` (precisa de Node 22 ou mais novo; são testes unitários, sem rede).

## Como chamar o JARVIS e o Hermes

Prefira o JARVIS. Os scripts estão em `codex/bin/`. Detalhes em `codex/README.md`.

```sh
# Saúde ou status do Hermes (leitura)
node codex/bin/jarvis-ask.mjs saude
node codex/bin/jarvis-ask.mjs hermes

# Pergunta (POST /api/chat). Para o Hermes via JARVIS: comece com /hermes
node codex/bin/jarvis-ask.mjs "oi"
node codex/bin/jarvis-ask.mjs "/hermes"
```

Variáveis: `JARVIS_URL` (VPS: `https://jarvis.72-62-11-116.sslip.io`; PC: `http://127.0.0.1:3200`), `JARVIS_USER` (na VPS: `jean`), `JARVIS_PASS`. A senha nunca entra no Git, no chat ou no histórico de comandos.

O comando `/hermes` no chat (e o `GET /api/hermes`) devolve **status e tarefas** do gateway. Não envia uma tarefa livre para o agente executar na VPS. Ações que mudam estado (pausar, rodar, apagar tarefa) são nível 2 e só avançam com o "sim" no Telegram.

Para uma tarefa de verdade no agente Hermes, use o script SSH, só no PC do Jean com a chave dele configurada:

```sh
# Linux/macOS
HERMES_SSH_OPTS="-i ~/.ssh/SUA_CHAVE" ./codex/bin/hermes-tarefa.sh "status curto do disco"
# Windows
# $env:HERMES_SSH_OPTS = '-i $HOME\.ssh\SUA_CHAVE'; .\codex\bin\hermes-tarefa.ps1 "status curto do disco"
```

A API do Hermes (`http://127.0.0.1:8642`, modelo `hermes-agent`) fica **só no loopback da VPS**. Não abra essa porta.

## Segurança

- Nunca imprima, grave ou faça commit de segredos (senhas, tokens, chaves, `.env`). `.env`, `vault/` e `data/` já estão no `.gitignore`.
- Nunca toque, leia, copie ou liste `OneDrive\COFRE REMOTO`.
- Nível 3 é proibido (apagar dados/backups, force-push, expor segredo, abrir porta, fallback pago). Só o Jean faz.
- Operações destrutivas na VPS, mudanças em SSH/UFW, abrir portas ou gastar dinheiro **só com confirmação explícita do Jean**.
- Não commite `.env`, chaves, backups com segredo nem `node_modules`.
