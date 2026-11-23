# Como estender o JARVIS (skills, MCP, bibliotecas)

## Skills
Formato Agent Skills: `data/skills/<nome>/SKILL.md` com frontmatter `name` (igual à pasta) e `description`.
Exemplos prontos em `skills-exemplo/`. Para instalar:

    mkdir -p data/skills && cp -r skills-exemplo/* data/skills/

Ative na conversa com `/skill <nome>`; `/skills` lista. Skills só injetam texto; nunca executam comandos.

## MCP
Copie `.mcp.json.example` para `.mcp.json` (fora do Git) e adicione o servidor com `"type": "http"` e `"url"`.
Servidores MCP novos só devem entrar com allowlist de ferramentas (veja `scripts/nvidia-allowlist-proxy.mjs`)
e ações que mudam estado seguem o nível 2 (confirmação no Telegram).

## Bibliotecas
O projeto não tem dependências de propósito (só `node:*`). Antes de adicionar uma, justifique o ganho,
fixe a versão, gere o lockfile e rode `npm audit` e `npm test`.

## Plugins
Não há sistema de plugins. O ponto de extensão é um módulo novo em `src/` ligado em `server.mjs`, com teste em `test/`.
