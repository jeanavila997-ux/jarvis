# CLI do JARVIS

Pense neste programa como um telefone do terminal: você fala com o mesmo JARVIS da página web e da VPS, mas pelo comando `jarvis`, sem abrir o navegador.

Ele **só usa rotas que já existem** no `server.mjs`. Não inventa endereço, não pula o basic-auth da VPS e **nunca imprime a senha**.

## O que ele fala com o servidor

| Comando | Rota real | Observação |
|---|---|---|
| `jarvis "pergunta"` ou `jarvis ask` | `POST /api/chat` | Corpo `{ mensagem, conversaId? }`. Cabeçalho obrigatório `X-Jarvis: 1` (proteção CSRF do servidor). A resposta vem em NDJSON (`inicio`, `rota`, `delta`, `fontes`, `erro`, `fim`). |
| `jarvis chat` | `POST /api/chat` | Igual ao ask, mas interativo: guarda o `conversaId` e repete nas próximas falas. |
| `jarvis health` (ou `saude`) | `GET /api/saude` | Não existe `/api/health`. O nome certo no servidor é **saúde**. |
| `jarvis status` | `GET /api/saude` + `GET /api/custo` | Monta um resumo no cliente. Também pode mandar `/status` pelo chat (aí quem responde é a regra fixa, sem IA). |
| `jarvis hermes` | `GET /api/hermes` | |
| `jarvis nvidia` | `GET /api/nvidia` | |
| `jarvis mestre` | `GET /api/mestre` | Presente na VPS / branch Voicebox. Se a instância for mais antiga, o CLI avisa o 404 e não quebra. |
| `jarvis voz` | `GET /api/voz` | Idem. |
| `jarvis skills` | `GET /api/skills` | |
| `jarvis custo` | `GET /api/custo` | |
| `jarvis rotinas` | `GET /api/rotinas` | |
| `jarvis conversas` | `GET /api/conversas` | Só lista. Para abrir uma, use `--conversa <uuid>`. |
| `jarvis reindexar` | `POST /api/reindexar` | Só reconstrói o índice do vault. No terminal, pede um "sim" antes. |

Não há rota HTTP de confirmação. O botão de "sim" de nível 2 vive no **Telegram** (`src/confirmacoes.mjs`). Se o texto da resposta parecer pedir confirmação, o modo `chat` pergunta se você quer enviar "sim" ou "não" como **próxima mensagem** — isso não executa a ação de nível 2 no servidor de hoje.

A autenticidade na VPS é o **basic-auth do Traefik** (usuário `jean`). O processo Node, por dentro, não pede senha; o portão é o proxy. No PC local (`http://127.0.0.1:3200`) não há senha.

## Instalar (Windows e Linux)

Precisa do **Node.js**. O CLI em si funciona no Node 18 ou mais novo (usa o `fetch` nativo). O servidor JARVIS continua pedindo Node 22.

### No Windows (PowerShell), com o repositório na pasta do projeto

```powershell
cd C:\Users\Jean\Projetos\ECOSSISTEMA JEAN\jarvis
git fetch origin
git checkout cli
npm link
jarvis --help
```

`npm link` (ou `npm i -g .`) cria o comando `jarvis` no PATH. O npm já fabrica o atalho `.cmd` do Windows.

Se preferir não instalar no sistema:

```powershell
node .\cli\jarvis.mjs health
.\cli\jarvis.cmd health
```

### No Linux

```sh
git checkout cli
npm link          # ou: npm i -g .
jarvis --help
# sem instalar:
node cli/jarvis.mjs health
```

## Configurar

Padrão: alvo `local`, endereço `http://127.0.0.1:3200`.

```sh
jarvis config
jarvis config show          # a senha aparece como ***
```

O arquivo fica em:

- Linux: `~/.config/jarvis/config.json` (pasta `700`, arquivo `600`)
- Windows: `%APPDATA%\jarvis\config.json` (em geral `C:\Users\Jean\AppData\Roaming\jarvis\config.json`)

Você também pode apontar o arquivo com `JARVIS_CONFIG`.

Variáveis (ganham da config; as flags `--url` / `--user` / `--target` ganham das variáveis):

```sh
# Linux
export JARVIS_TARGET=vps
export JARVIS_USER=jean
export JARVIS_PASS='…'     # não cole a senha em chat, script público ou commit

# PowerShell (só na sessão atual)
$env:JARVIS_TARGET = "vps"
$env:JARVIS_USER = "jean"
$env:JARVIS_PASS = "…"
```

Não commite esse arquivo, não jogue a senha no Git e não use `--pass` no dia a dia: a linha de comando entra no histórico. Se um dia a senha vazar, troque a do Traefik na VPS.

## Exemplos

```sh
# PC local (Docker na porta 3200)
jarvis health
jarvis status
jarvis "oi, você está no ar?"
jarvis chat

# VPS (pede usuário e senha já gravados na config)
jarvis --target vps health
jarvis --target vps status
jarvis --target vps "/hermes"
echo "/nvidia" | jarvis --target vps

# Saída para script
jarvis --json health
jarvis ask --json --target local /custo

# Continuar uma conversa
jarvis --conversa 11111111-1111-1111-1111-111111111111 "e sobre aquilo?"
```

No `jarvis chat`, os comandos com barra (`/status`, `/custo`, `/hermes`, `/nvidia`, `/mestre`, `/voz`, `/skills`, `/github`, `/ajuda`) vão para o JARVIS como mensagem. `/github` só faz sentido quando essa integração estiver ligada no servidor; o CLI já trata como qualquer outro comando com barra. Só estes ficam no terminal: `/nova` (conversa nova), `/id`, `/sair`.

## Segurança, em linguagem simples

- **Senha:** o CLI guarda, se você pedir, no arquivo de config com permissão apertada. Ele não escreve a senha na tela, nem no `--help`, nem no `config show`.
- **Portão da VPS:** basic-auth na frente do HTTPS. Sem usuário e senha certos, a VPS responde 401 e o CLI explica isso, sem repetir a senha.
- **Cabeçalho `X-Jarvis: 1`:** o servidor recusa `POST` sem ele. O CLI sempre envia.
- **Confirmações de nível 2:** ainda não passam por este CLI. Ações que mudam coisa no mundo continuam pedindo "sim" no Telegram.
- **Cores:** se o terminal não for interativo, ou se existir `NO_COLOR`, a saída fica em texto puro (ASCII com acentos do português, sem códigos de cor).

## Testes

Na raiz do repositório:

```sh
node --test test/cli.test.mjs
# a suíte inteira (CLI + testes já existentes do servidor):
npm test
```

Os testes do CLI sobem um servidor HTTP de mentira na sua máquina e não falam com a VPS nem com o PC.

## O que ainda não foi conferido neste ramo

- Instalação com `npm link` no Windows do Jean (o PC estava offline quando o CLI foi escrito).
- Conversa completa (`ask` / `chat`) contra a VPS de verdade — os testes de fumaça na VPS, quando feitos, ficam só em `health`/`status` (leitura).
