# Integração JARVIS ↔ Hermes (VPS)

A API do Hermes (`hermes-agent` 0.23.1) escuta em `127.0.0.1:8642` no host, como root. O container JARVIS não vê esse loopback, e **não** usamos `network_mode: host` nem publicamos porta.

## Como o container alcança a API

Um serviço systemd `jarvis-hermes-proxy` roda `socat` no host e escuta só num Unix socket:

`/opt/apps/jarvis/run/hermes.sock` → `127.0.0.1:8642`

O diretório `run/` é montado no container (não é `:ro`, porque conectar num socket Unix exige escrita no inode). `JARVIS` usa `HERMES_URL=unix:///app/run/hermes.sock`.

O Ollama local segue o mesmo desenho: `jarvis-ollama-proxy` e `JARVIS_LOCAL_URL=unix:///app/run/ollama.sock`.

Nenhuma porta TCP nova, nenhum ajuste de UFW ou SSH.

## Autenticação e permissões

- `GET /health` — sem chave, só status (`ok`, versão).
- `GET /api/jobs` e mutações — `Authorization: Bearer` com `HERMES_API_KEY` (é a `API_SERVER_KEY` do Hermes). Sem a chave, o JARVIS informa e não inventa.
- Listar/status: nível 0 (leitura).
- Pausar, retomar, rodar agora, criar, atualizar, apagar tarefa: **nível 2**, só depois do botão de "sim" no Telegram (10 min, uso único).
- O módulo **não** chama rotas que revelam ambiente, credenciais ou arquivos (`/api/env`, `/api/credentials`, `/api/fs`, etc.).

## Rollback

Ver o relatório do deploy: parar os dois serviços systemd e restaurar o backup em `/root/backups/`.
