#!/usr/bin/env bash
# Chama o Hermes na VPS (API só em 127.0.0.1:8642, via SSH).
# Sem SSH, cai no JARVIS (/hermes) — isso é status/chat, NÃO executa a tarefa no agente.
# Uso: hermes-tarefa.sh "tarefa"
# Env: HERMES_SSH (padrão: root@72.62.11.116), HERMES_SSH_OPTS (ex.: -i ~/.ssh/vps_hostinger)
set -euo pipefail

uso() {
  echo "uso: hermes-tarefa.sh \"tarefa\"" >&2
  echo "  HERMES_SSH        destino SSH (padrão: root@72.62.11.116)" >&2
  echo "  HERMES_SSH_OPTS   opções extras do ssh (ex.: -i ~/.ssh/vps_hostinger)" >&2
  exit 2
}

[ $# -ge 1 ] || uso
TAREFA="$*"
DESTINO="${HERMES_SSH:-root@72.62.11.116}"
DIR="$(cd "$(dirname "$0")" && pwd)"

# hermes-tarefa na VPS só aceita argv (não lê stdin). Escapa aspas simples.
escape_sq() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

chamar_ssh() {
  # shellcheck disable=SC2086
  ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new ${HERMES_SSH_OPTS:-} "$DESTINO" "hermes-tarefa $(escape_sq "$TAREFA")"
}

chamar_jarvis() {
  echo "Aviso: SSH indisponível. Caindo para o JARVIS (/hermes). Isso só consulta o status/chat do JARVIS; não executa a tarefa no agente Hermes da VPS." >&2
  if [ -f "$DIR/jarvis-ask.mjs" ]; then
    node "$DIR/jarvis-ask.mjs" "/hermes $TAREFA"
  else
    echo "jarvis-ask.mjs não encontrado e SSH falhou." >&2
    return 1
  fi
}

set +e
chamar_ssh
st=$?
set -e
# ssh devolve 255 quando a conexão/autenticação falha. Outros códigos são do comando remoto.
if [ "$st" -eq 0 ]; then
  exit 0
elif [ "$st" -eq 255 ]; then
  chamar_jarvis
else
  exit "$st"
fi
