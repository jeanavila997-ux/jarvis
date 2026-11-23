# Imagem do JARVIS com ffmpeg (sendVoice precisa de OGG/Opus).
# Base pinada, igual à que já rodava na VPS.
FROM node:22.23.5-alpine
RUN apk add --no-cache ffmpeg
