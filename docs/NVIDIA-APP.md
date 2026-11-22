# nvidia-app no JARVIS — desenho (sem túnel no ar)

Estado: código e testes na branch `nvidia-app`. **Sem deploy, sem túnel, sem porta nova, sem mudança no UFW ou no SSH.** O módulo existe, mas o `server.mjs` e o `docker-compose.yml` de produção **não** foram ligados a ele.

## O problema (medido)

O MCP `nvidia-app` escuta só em `http://127.0.0.1:13508/mcp` no PC DESKTOP-O7T3I00. O JARVIS roda num container endurecido na VPS (`jarvis_default`). O container **não alcança** `127.0.0.1` do host da VPS, e muito menos o `127.0.0.1` do PC.

Caminho A (Grok Bot / pasta `jarvis-vps-github`) não precisa de túnel: o bot chama o MCP no próprio PC via Shell. Caminho B (JARVIS na VPS) precisa de um túnel **e** de um salto até a rede Docker — só depois de o Jean confirmar.

## Ferramentas

12 no total (medidas em 21/11/2026 21:11, America/Rio_Branco): 6 LEITURA, 6 ESCRITA. O proxy e o `src/nvidia.mjs` só conhecem LEITURA (fail-closed: ferramenta nova, mesmo com `readOnlyHint=true`, não passa até entrar na allowlist). Se o servidor marcar uma ferramenta da allowlist com `readOnlyHint=false`, o proxy também recusa.

LEITURA: `nvapp_overlay_get_status`, `nvapp_overlay_get_current_game_info`, `nvapp_client_get_applications`, `nvapp_client_get_driver_status`, `nvapp_client_get_driver_release_notes`, `nvapp_client_get_laptop_features`.

ESCRITA (nunca expostas neste desenho): captura/replay, filtro DVC, overlay de stats, lançar jogo, preset de otimização, Battery Boost / Whisper Mode.

## Opções de túnel (ainda não aplicadas)

### 1. SSH reverso a partir do PC (recomendada, se a chave for consertada)

No PC, um processo faria algo nesta linha (exemplo, **não execute ainda**):

```text
ssh -N -R 127.0.0.1:13508:127.0.0.1:13508 <usuario>@72.62.11.116
```

Isso publicaria o MCP só no loopback da VPS. Nada na internet, nada no UFW.

Bloqueio medido antes: a chave do PC `id_ed25519_vps` (comentário `jean@desktop-mestre-vps`, alias `srv1483039`) ainda era recusada. A chave que funciona hoje é a `grok-bot@vps`, que está no computador compartilhado dos bots, não no PC. O cliente SSH do túnel precisa rodar **no PC**, porque o `nvidia-app` é localhost de lá.

O que faltaria, depois da confirmação do Jean:

- autorizar de forma limpa a chave do PC (sem a linha malformada do painel Hostinger que cola RSA + ed25519) **ou** criar uma chave só para o túnel, com `authorized_keys` restrito (`command` / `restrict`, só `-R`);
- rodar o túnel no PC (tarefa agendada / serviço), bind só em `127.0.0.1` na VPS;
- subir o proxy allowlist **no host da VPS**, também só em endereço não público (ver salto Docker);
- ligar `NVIDIA_APP=1`, `NVIDIA_PROXY_URL` e `NVIDIA_PROXY_TOKEN` no `.env` do JARVIS e então, noutro passo confirmado, plugar no `server.mjs` / compose.

Não alterar `sshd_config` nem UFW sem confirmação explícita.

### 2. Túnel público tipo o do 9Router (`*.abc-tunnel.us`)

Funcionaria, mas exporia (mesmo com chave) um MCP que sabe lançar jogos e mudar ajustes da GPU. **Não recomendado.** Se algum dia for considerado, ainda assim deveria passar pelo proxy de LEITURA + token, nunca o MCP cru.

### 3. Duplo salto box → PC

O Grok Bot já fala com o PC via Shell. Isso resolve o caminho A, não o do container na VPS.

## Como o container alcançaria o proxy

Mesmo com o MCP no `127.0.0.1:13508` da VPS, o container JARVIS não vê o loopback do host. Publicar com `docker -p` atravessa o UFW e está fora de questão. `network_mode: host` no JARVIS também está fora (quebraria a blindagem e a rede `jarvis_default`).

Desenho recomendado, quando o Jean confirmar:

1. Túnel SSH reverso: MCP chega em `127.0.0.1:13508` no host da VPS.
2. Proxy allowlist no host (`scripts/nvidia-allowlist-proxy.mjs`), com token, só LEITURA, bind num IP privado (o gateway medido da rede `jarvis_default` é `172.16.5.1` (subnet `172.16.5.0/24`; o container saudável estava em `172.16.5.2`)) — **não** `0.0.0.0`. O proxy recusa bind público.
3. O container JARVIS chama `http://172.16.5.1:13509` (variável `NVIDIA_PROXY_URL`). Sem porta publicada, sem label Traefik, sem UFW novo.
4. `src/nvidia.mjs` é a única porta de saída do app: se a ferramenta não for de LEITURA, nem chega a abrir rede.

Alternativa equivalente: `socat`/`proxy` no host só no IP da bridge Docker, apontando para o loopback — o mesmo padrão já recomendado para o Ollama local. Não usar `extra_hosts: host.docker.internal` sozinho: isso alcança o IP do host na bridge, não o `127.0.0.1`.

## Arquivos nesta branch

- `src/nvidia.mjs` — cliente (desligado por padrão).
- `scripts/nvidia-allowlist-proxy.mjs` — proxy com token e allowlist.
- `test/nvidia.test.mjs` — testes sem rede real.
- Este documento.

O `.env.example` cita as variáveis, ainda desligadas. Nada foi escrito no `.env` real.

## O que precisa de confirmação do Jean antes de qualquer ativação

1. Consertar/autorizar a chave SSH do PC (ou emitir uma chave só de túnel), sem alterar o `sshd_config` à revelia.
2. Autorizar o túnel reverso PC → `127.0.0.1:13508` na VPS (processo no PC, bind só em loopback).
3. Autorizar o proxy allowlist no host, bind só no gateway da rede Docker, com token no `.env` (chmod 600, fora do git).
4. Autorizar, noutro passo, ligar o cliente no `server.mjs` / compose (`NVIDIA_APP=1`). Até lá o código fica na branch, sem deploy.
5. Confirmar que ferramentas de ESCRITA **permanecem** fora do caminho VPS (recomendação desta branch). Se no futuro quiser alguma escrita, ela exigiria o nível de permissão do JARVIS e o botão de "sim" — não está implementado aqui.
