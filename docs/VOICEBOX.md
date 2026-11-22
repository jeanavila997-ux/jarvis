# Voicebox no JARVIS

Servidor TTS/clonagem de voz ([jamiepine/voicebox](https://github.com/jamiepine/voicebox), tag **v0.6.0**). Documentação oficial: [Docker Deployment](https://docs.voicebox.sh/overview/docker).

A API **não tem autenticação**. Por isso:

- na VPS a porta é só `127.0.0.1:17493` (nunca `0.0.0.0`, sem Traefik, sem regra nova de UFW);
- o container do JARVIS fala com ela por Unix socket (`/opt/apps/jarvis/run/voicebox.sock`, modo 660, user 1000), no mesmo padrão do Hermes e do Ollama.

## VPS

- Código: `/opt/apps/voicebox/upstream` (clone da tag v0.6.0).
- Compose endurecido: `/opt/apps/voicebox/docker-compose.vps.yml` — 2 CPU, 6 GB, `no-new-privileges`, `cap_drop: ALL` com as caps que o entrypoint (`gosu`) precisa, volume `huggingface-cache`, `restart: unless-stopped`.
- Motor padrão do JARVIS: **Kokoro**, voz **Dora** (`pf_dora`, pt-BR). É leve e cabe no limite de memória. A primeira geração baixa o modelo (pode levar alguns minutos); as seguintes reaproveitam o cache.
- Rollback: `/root/backups/voicebox-20261121-2202/ROLLBACK.sh`.

Comandos úteis (só no host):

```bash
docker compose -f /opt/apps/voicebox/docker-compose.vps.yml --project-directory /opt/apps/voicebox ps
curl -sS http://127.0.0.1:17493/health
ss -lntp | grep 17493    # deve aparecer só 127.0.0.1, nunca 0.0.0.0
```

## No JARVIS

- Módulo: `src/voz.mjs`. Fila de **1 geração por vez**, timeout (padrão 180 s), `VOICEBOX=0` desliga.
- Prefere o PC (`VOICEBOX_PC_URL`) quando o health responde; senão usa a VPS (`VOICEBOX_URL`).
- Telegram: `/voz` (status), `/voz <frase>` (sendVoice), `/voz ligar` ou a frase `responder em áudio` (as próximas respostas também saem em voz), `/voz off` ou `só texto`.
- `/api/voz` no site (atrás do basic-auth, como o resto).

## PC como acelerador (GPU)

O PC está no desenho, mas o túnel ainda depende da chave do usuário `jarvis-tunel` (ainda não colada). Enquanto isso, o JARVIS da VPS usa só o Voicebox local (CPU).

Arquivos prontos para copiar ao ligar o PC: pasta `voicebox-pc` (docker-compose com GPU NVIDIA, porta só `127.0.0.1:17493`). Destino: `C:\Users\Jean\Projetos\ECOSSISTEMA JEAN\voicebox-pc`.

O túnel reverso (mesmo usuário `jarvis-tunel` do Mestre/nvidia-app) acrescenta:

```text
permitlisten="127.0.0.1:17494"
-R 127.0.0.1:17494:127.0.0.1:17493
```

`17493` na VPS é o Voicebox local; `17494` é o do PC, visto só no loopback. A unit `jarvis-voicebox-pc-proxy` (socket `voicebox-pc.sock`) fica instalada e **parada** até o túnel existir. Detalhes na seção 7 de `RODAR-NO-PC.md`.

## Desfazer

```bash
/root/backups/voicebox-20261121-2202/ROLLBACK.sh
```

## Notas medidas na instalação

- O `tmpfs` de `/tmp` precisa de `exec`. Sem isso, o Kokoro falha ao carregar `libespeak-ng.so`.
- O Voicebox entra em modo offline quando acha o modelo Kokoro no cache. As vozes (`voices/pf_dora.pt` etc.) precisam estar no cache também, senão a geração falha. Na VPS elas já foram baixadas.
