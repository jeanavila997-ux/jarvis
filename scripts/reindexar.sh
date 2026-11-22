#!/bin/sh
# Reindexa o vault sem reiniciar (chama o endpoint dentro do container).
cd "$(dirname "$0")/.." && docker compose exec -T jarvis node -e "fetch('http://127.0.0.1:3200/api/reindexar',{method:'POST',headers:{'x-jarvis':'1'}}).then(r=>r.text()).then(console.log)"
