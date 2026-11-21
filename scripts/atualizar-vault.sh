#!/bin/sh
# Uso (no PC/box): rsync do vault para a VPS, depois reindexa.
#   rsync -a --delete --exclude '.obsidian/' --exclude '.git/' --exclude '.trash/' --exclude '*.env' --exclude '.env*' --exclude '*.zip' \
#     ./JARVIS/ vps:/opt/apps/jarvis/vault/
# Na VPS:
cd "$(dirname "$0")/.." && chmod -R a+rX vault && sh scripts/reindexar.sh
