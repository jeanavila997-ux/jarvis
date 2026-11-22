# JARVIS no PC (DESKTOP-O7T3I00) — passo a passo

Arquivos: `docker-compose.pc.yml` (Ollama com GPU + JARVIS) e `.env.local` (copiado de `.env.local.example`).
`docker-compose.local.yml` (do Hermes) continua valendo para quem prefere o Ollama **nativo** do Windows.

Regras que não mudam: porta só em `127.0.0.1`; Telegram **vazio** no PC (o bot da VPS já faz polling; o mesmo token dá HTTP 409); sem reserva paga; Mestre do PC e nvidia-app **desligados** até você ligar.

## 1. Pré-requisitos (PowerShell como Administrador)

```powershell
wsl --update
wsl --status                      # "Versão padrão: 2"
nvidia-smi                        # driver NVIDIA do Windows (não instale driver dentro do WSL)
```

Instale/abra o **Docker Desktop** e ative *Settings → General → Use the WSL 2 based engine*.
Com Docker Desktop **não** é preciso instalar o NVIDIA Container Toolkit.
(Só se usar Docker Engine dentro de uma distro WSL, sem Docker Desktop: instale `nvidia-container-toolkit` nessa distro e rode `sudo nvidia-ctk runtime configure --runtime=docker`.)

## 2. Testar a GPU no Docker

```powershell
docker run --rm --gpus=all nvcr.io/nvidia/k8s/cuda-sample:nbody nbody -gpu -benchmark
```

Tem que aparecer "GeForce RTX 3050". Se não aparecer, atualize o driver e rode `wsl --shutdown`.

## 3. Pasta e .env.local

```powershell
cd "C:\Users\Jean\Projetos\ECOSSISTEMA JEAN\jarvis-local"   # cópia da branch integracoes/pc-mestre
Copy-Item .env.local.example .env.local
icacls .env.local /inheritance:r /grant:r "$($env:USERNAME):(R,W)"
notepad .env.local      # deixe TELEGRAM_BOT_TOKEN vazio. MESTRE_MCP=0 e NVIDIA_APP=0 por enquanto
```

O código chega ao PC por cópia (não há push para o GitHub): peça ao Grok Bot para copiar a branch para essa pasta.

## 4. Subir Ollama (GPU) e baixar o modelo

```powershell
docker compose -f docker-compose.pc.yml up -d ollama
docker compose -f docker-compose.pc.yml exec ollama ollama pull qwen3:4b
docker compose -f docker-compose.pc.yml exec ollama ollama run qwen3:4b "diga oi em uma frase"
docker compose -f docker-compose.pc.yml exec ollama ollama ps     # PROCESSOR deve dizer 100% GPU
```

Modelos que cabem inteiros em 4 GB: `qwen3:4b` (~2,5 GB), `llama3.2:3b` (~2,0 GB), `qwen2.5-coder:3b-instruct` (~1,9 GB), `qwen3:1.7b`, `gemma3:1b`.
No limite (pode dividir CPU/GPU): `qwen3.5:4b`, `gemma3:4b`. 7B–9B não cabem.
Use **um** modelo para tudo (`JARVIS_MODEL` = `JARVIS_LOCAL_MODEL`): dois modelos juntos não cabem em 4 GB.

## 5. Subir o JARVIS

```powershell
docker compose -f docker-compose.pc.yml up -d jarvis
docker compose -f docker-compose.pc.yml ps                         # jarvis "healthy"
Invoke-RestMethod http://127.0.0.1:3200/api/saude
Start-Process http://127.0.0.1:3200
```

Parar: `docker compose -f docker-compose.pc.yml down` (o volume com os modelos fica).

## 6. Mestre do PC e nvidia-app no JARVIS do PC (opcional)

O launcher do Mestre (`127.0.0.1:7777/mcp`) e o nvidia-app (`127.0.0.1:13508/mcp`) escutam só no loopback do Windows.
O Docker Desktop entrega `host.docker.internal` para o host; **não** troque o bind deles para `0.0.0.0`.
No `.env.local`:

```text
MESTRE_MCP=1
MESTRE_MCP_URL=http://host.docker.internal:7777
MESTRE_MCP_TOKEN=          # o mesmo token local do launcher (MESTRE_LOCAL_MCP_TOKEN); não cole em chat
NVIDIA_APP=1
NVIDIA_MCP_URL=http://host.docker.internal:13508/mcp
```

Hipótese a validar: se o launcher recusar o cabeçalho `Host: host.docker.internal`, a alternativa é um proxy no próprio Windows só em `127.0.0.1`. Nunca abra a porta para a rede.

Depois, `docker compose -f docker-compose.pc.yml up -d --force-recreate jarvis` e teste `Invoke-RestMethod http://127.0.0.1:3200/api/mestre`.

## 7. Túnel reverso PC → VPS (para o JARVIS da VPS ver o Mestre e o nvidia-app)

**Ainda não autorizado.** Precisa do "sim" do Jean para a linha no `authorized_keys` (mexe no SSH; o Grok Bot não edita).

### 7.1 Chave só para o túnel (no PC)

```powershell
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\id_ed25519_jarvis_tunel" -C "jarvis-tunel@DESKTOP-O7T3I00" -N '""'
Get-Content "$env:USERPROFILE\.ssh\id_ed25519_jarvis_tunel.pub"     # a parte pública vai para o Jean aprovar
```

### 7.2 Linha que precisaria entrar no `authorized_keys` da VPS (NÃO aplicada)

```text
restrict,port-forwarding,permitlisten="127.0.0.1:17777",permitlisten="127.0.0.1:13508",command="/bin/false" ssh-ed25519 AAAA...CHAVE_PUBLICA... jarvis-tunel@DESKTOP-O7T3I00
```

- `restrict` desliga tudo (shell, PTY, agent, X11, encaminhamento local); `port-forwarding` religa só o encaminhamento; `permitlisten` limita o `-R` a essas duas portas no loopback da VPS.
- `command="/bin/false"`: se alguém tentar abrir shell com essa chave, nada roda (o túnel usa `-N`, sem shell).
- Melhor ainda (decisão do Jean): um usuário próprio sem shell em vez de `root`.

### 7.3 Comando do túnel (no PC)

```powershell
ssh -N -T -i "$env:USERPROFILE\.ssh\id_ed25519_jarvis_tunel" `
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 `
  -R 127.0.0.1:17777:127.0.0.1:7777 `
  -R 127.0.0.1:13508:127.0.0.1:13508 `
  root@72.62.11.116
```

Para manter de pé: Agendador de Tarefas ("Ao fazer logon", repetir se falhar) rodando esse comando num laço do PowerShell:
`while ($true) { ssh ...; Start-Sleep 15 }`.

### 7.4 Na VPS, depois do túnel (Grok Bot faz, com "sim")

```bash
ss -tlnp | grep -E '127.0.0.1:(17777|13508)'          # túnel chegou só no loopback
cp scripts/systemd/jarvis-mestre-proxy.service scripts/systemd/jarvis-nvidia-proxy.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now jarvis-mestre-proxy jarvis-nvidia-proxy
# .env da VPS (sem mostrar valores): MESTRE_MCP=1, MESTRE_MCP_URL=unix:///app/run/mestre.sock, MESTRE_MCP_TOKEN=...
#                                    NVIDIA_APP=1, NVIDIA_MCP_URL=unix:///app/run/nvidia.sock
cd /opt/apps/jarvis && docker compose up -d --force-recreate
docker exec jarvis-jarvis-1 wget -qO- http://127.0.0.1:3200/api/mestre
```

Nenhuma porta pública, nenhuma regra nova de UFW: o túnel entra pelo SSH (22) e só cria escutas em `127.0.0.1`; o container fala por socket Unix.

## Níveis do Mestre do PC (src/mestre-mcp.mjs, decididos por código)

| Ferramenta | Nível | Como roda |
|---|---|---|
| status, operações (listar), memórias (listar/buscar) | 0 | direto (`/mestre`, `/api/mestre`, `/mestre status`) |
| save_memory, optimize_ram_and_temp, ask_grok | 2 | `/mestre <ferramenta> ...` no Telegram → botão Confirmar (10 min, uso único) |
| run_operation (operação comum ou limpar temp/cache) | 2 | idem, com o nome da operação no cartão |
| run_operation destrutiva (apagar/excluir/formatar, desligar firewall/Defender/UAC, backups, senhas) | 3 | recusada sem botão; só o Jean, no PC |
| qualquer ferramenta fora da lista | 3 | recusada (fail-closed) |

Os nomes exatos das 3 ferramentas de leitura ainda não foram medidos (o MCP só existe no PC). Quando o túnel existir, rode `/mestre` e, se o nome real for outro, acrescente em `MESTRE_MCP_EXTRA_LEITURA`.
