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

**Já preparado na VPS (aprovado pelo Jean em 21/11):**
- usuário de sistema `jarvis-tunel`: senha travada, shell `/usr/sbin/nologin`, home `/home/jarvis-tunel`, `.ssh` com permissão 700;
- `/home/jarvis-tunel/.ssh/authorized_keys` vazio (600), à espera da chave pública do PC;
- modelo comentado em `/home/jarvis-tunel/.ssh/authorized_keys.modelo`;
- units `jarvis-mestre-proxy` e `jarvis-nvidia-proxy` instaladas, mas **paradas e desabilitadas** até o túnel existir;
- o `sshd_config` e o `authorized_keys` do root não foram alterados. A config atual do sshd já permite o túnel (`AllowTcpForwarding yes`, `GatewayPorts no`, sem `AllowUsers`).

### 7.1 Gerar a chave só para o túnel (no PC, PowerShell)

```powershell
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\id_ed25519_jarvis_tunel" -C "jarvis-tunel@DESKTOP-O7T3I00"
# Ao pedir a frase-senha, aperte Enter duas vezes (sem frase): o túnel roda sozinho pelo Agendador.
icacls "$env:USERPROFILE\.ssh\id_ed25519_jarvis_tunel" /inheritance:r /grant:r "$($env:USERNAME):(R)"
Get-Content "$env:USERPROFILE\.ssh\id_ed25519_jarvis_tunel.pub"   # só a parte PÚBLICA vai para a VPS
```

A chave privada (`id_ed25519_jarvis_tunel`, sem `.pub`) **nunca** sai do PC.

### 7.2 Linha que entra em `/home/jarvis-tunel/.ssh/authorized_keys` (o Grok Bot aplica quando o Jean mandar o `.pub`)

```text
restrict,port-forwarding,permitlisten="127.0.0.1:17777",permitlisten="127.0.0.1:13508",command="/bin/false" ssh-ed25519 AAAA...CHAVE_PUBLICA... jarvis-tunel@DESKTOP-O7T3I00
```

- `restrict` desliga tudo: shell, PTY, agent, X11 e encaminhamento local. `port-forwarding` religa só o encaminhamento, e `permitlisten` limita o `-R` a essas duas portas no loopback da VPS.
- `command="/bin/false"` e o shell `nologin` garantem que essa chave não abre shell. O túnel usa `-N`, sem shell.
- O usuário `jarvis-tunel` não tem senha nem sudo e não é o root.

### 7.3 Comando do túnel (no PC)

```powershell
ssh -N -T -i "$env:USERPROFILE\.ssh\id_ed25519_jarvis_tunel" `
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 `
  -R 127.0.0.1:17777:127.0.0.1:7777 `
  -R 127.0.0.1:13508:127.0.0.1:13508 `
  jarvis-tunel@72.62.11.116
```

Na primeira conexão o ssh pergunta se confia na chave do servidor 72.62.11.116: responda `yes`. Depois, para manter o túnel de pé, use o Agendador de Tarefas ("Ao fazer logon", repetir se falhar) rodando esse comando num laço do PowerShell:
`while ($true) { ssh -N -T ... jarvis-tunel@72.62.11.116; Start-Sleep 15 }`.

### 7.4 Na VPS, depois do túnel (o Grok Bot faz, com o "sim" do Jean)

```bash
ss -tlnp | grep -E '127.0.0.1:(17777|13508)'          # o túnel chegou só no loopback
systemctl enable --now jarvis-mestre-proxy jarvis-nvidia-proxy   # units já instaladas
# .env da VPS (sem mostrar valores): MESTRE_MCP=1, MESTRE_MCP_URL=unix:///app/run/mestre.sock, MESTRE_MCP_TOKEN=...
#                                    NVIDIA_APP=1, NVIDIA_MCP_URL=unix:///app/run/nvidia.sock
cd /opt/apps/jarvis && docker compose up -d --force-recreate jarvis
docker exec jarvis-jarvis-1 wget -qO- http://127.0.0.1:3200/api/mestre
```

Nenhuma porta pública e nenhuma regra nova de UFW: o túnel entra pelo SSH (22) e só cria escutas em `127.0.0.1`. O container fala por socket Unix.

## Níveis do Mestre do PC (src/mestre-mcp.mjs, decididos por código)

| Ferramenta | Nível | Como roda |
|---|---|---|
| status, operações (listar), memórias (listar/buscar) | 0 | direto (`/mestre`, `/api/mestre`, `/mestre status`) |
| save_memory, optimize_ram_and_temp, ask_grok | 2 | `/mestre <ferramenta> ...` no Telegram → botão Confirmar (10 min, uso único) |
| run_operation (operação comum ou limpar temp/cache) | 2 | idem, com o nome da operação no cartão |
| run_operation destrutiva (apagar/excluir/formatar, desligar firewall/Defender/UAC, backups, senhas) | 3 | recusada sem botão; só o Jean, no PC |
| qualquer ferramenta fora da lista | 3 | recusada (fail-closed) |

Os nomes exatos das 3 ferramentas de leitura ainda não foram medidos (o MCP só existe no PC). Quando o túnel existir, rode `/mestre` e, se o nome real for outro, acrescente em `MESTRE_MCP_EXTRA_LEITURA`.
