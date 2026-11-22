# JARVIS local no PC (DESKTOP-O7T3I00)

Cópia do código da VPS (`main` f7789f5 + módulo nvidia-app), **sem** `.env` da VPS, **sem** `data/` e com Telegram **desligado**.

## Subir

No diretório `C:\Users\Jean\Projetos\ECOSSISTEMA JEAN\jarvis-local`:

```text
copy .env.local.example .env.local
docker compose -f docker-compose.local.yml up -d
```

A porta é só `127.0.0.1:3200`. De outra máquina da rede, não abre.

## O que está ligado

- Ollama local: `qwen3:4b` em `http://host.docker.internal:11434`
- nvidia-app: `http://host.docker.internal:13508/mcp`, **só as 6 ferramentas de LEITURA**
- 9Router apontado, mas `NINEROUTER_RESERVA=0` (nenhum modelo de chat gratuito respondia no teste)
- Vault de notas (sem credenciais vivas; um trecho de documentação cita o nome do campo `apiKey`)

## O que falta (peça as chaves ao Grok Bot, não invente)

- `OLLAMA_API_KEY` — só se quiser a nuvem
- `NINEROUTER_API_KEY` — só se for ligar reserva/STT/TTS
- basic-auth local (`JARVIS_BASIC_USER` / `JARVIS_BASIC_PASS`) — o bind em 127.0.0.1 já limita ao PC

Se `host.docker.internal` não alcançar serviços que escutam só em `127.0.0.1`, **não abra a porta na rede**. Opções: proxy no loopback da interface interna do Docker, ou socat/WSL só nesse IP.

## Telegram

Fica desligado de propósito. O mesmo token na VPS e no PC gera conflito de polling (HTTP 409).
