# JARVIS v0.1 (A.V.I.L.A.)

Primeira versão do assistente pessoal do Jean, inspirada no JARVIS do Homem de Ferro.
Nesta versão ele **só conversa**: responde em português, consulta o vault JARVIS (Obsidian) e cita as notas que usou.
Não tem ferramentas: não executa comandos, não envia mensagens, não apaga nada e não gasta dinheiro.

- **Endereço:** https://jarvis.72-62-11-116.sslip.io (HTTPS + senha; usuário `jean`)
- **Senha:** só na VPS, em `/root/.jarvis_credentials` (chmod 600)
- **Cérebro:** Ollama Cloud (`https://ollama.com/api/chat`), com a chave `OLLAMA_API_KEY` da assinatura do Jean
- **Modelo padrão:** `glm-5.3-flash` (o mesmo do Hermes). **Sem fallback automático**: se o modelo falhar, o erro aparece no chat.

## Como funciona
| Parte | Arquivo |
|---|---|
| Servidor HTTP + streaming (Node 22, sem dependências) | `server.mjs` |
| Busca BM25 nas notas do vault (ignora arquivos que parecem ter segredo) | `src/retrieval.mjs` |
| Prompt de sistema (**rascunho**) + perfil fixo do Jean | `src/prompt.mjs` |
| Interface de chat (pt-BR, celular, tema escuro neon ciano) | `public/` |
| Conversas salvas em JSON | `data/conversas/*.json` |
| Cópia do vault (só leitura no container) | `vault/` |

A cada pergunta, o servidor busca os trechos mais relevantes do vault (pergunta atual + anterior),
coloca no prompt de sistema junto com o perfil do Jean e manda as últimas 12 mensagens ao modelo.
As notas usadas aparecem como etiquetas embaixo da resposta.

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

## Segurança
- Container sem portas publicadas, rede bridge própria, `read_only`, `cap_drop: ALL`, usuário 1000, 256 MB.
- Basic-auth no Traefik; o hash fica no `.env`, a senha em texto só em `/root/.jarvis_credentials`.
- POSTs exigem o cabeçalho `X-Jarvis: 1` (proteção simples contra CSRF).
- `.env`, `data/` e `vault/` estão no `.gitignore`.

## Próximos passos (sugestão)
1. **Jean revisar o prompt** (`src/prompt.mjs`) e escolher o nome definitivo (A.V.I.L.A., JARVIS-BR…).
2. **Matriz de permissões**: 🟢 reversível / 🟡 sensível / 🔴 irreversível ou com custo, e como o "sim" funciona em cada canal (web, Telegram).
3. **Telegram**: canal no celular, aceitando só o chat do Jean.
4. **Briefing 06:30 / revisão 21:00**: definir fontes (agenda, e-mail, status da VPS, clientes REAL H com regras de LGPD).
5. **Ferramentas de leitura** (status da VPS, agenda, web) via MCP; depois escrita com aprovação.
6. **Memória**: embeddings locais e notas de diário (`08-Diario`) escritas pelo próprio JARVIS, com revisão.
7. **Voz**: Whisper + TTS pt-BR.
