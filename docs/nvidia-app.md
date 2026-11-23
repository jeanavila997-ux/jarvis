# nvidia-app — MCP no PC do Jean

Endpoint local (só no DESKTOP-O7T3I00): `http://127.0.0.1:13508/mcp`

- Tipo: Streamable HTTP (JSON-RPC).
- Cabeçalho de sessão: `Mcp-Session-Id`.
- Handshake medido: `initialize` (HTTP 200, protocolo `2025-11-25`) → `notifications/initialized` (HTTP 202) → `tools/list` (HTTP 200).
- `serverInfo` medido: nome `nvidia-app`, título `NVIDIA App`, versão `1.0.0`.
- Já está em `C:\Users\Jean\.cursor\mcp.json` para o Cursor.
- Este servidor **não** é alcançável pela VPS nem pelo Grok Bot, porque escuta só em `127.0.0.1` do PC.

Script desta pasta: `scripts\nvidia-mcp.ps1`.

```powershell
cd "C:\Users\Jean\Projetos\ECOSSISTEMA JEAN\jarvis-vps-github\scripts"
.\nvidia-mcp.ps1 -Listar
.\nvidia-mcp.ps1 -Ferramenta nvapp_client_get_driver_status
.\nvidia-mcp.ps1 -Ferramenta nvapp_client_get_driver_release_notes -Argumentos '{"driver":"INSTALLED"}'
# Ferramentas de ESCRITA são recusadas, a menos que você passe -Confirmado:
.\nvidia-mcp.ps1 -Ferramenta nvapp_overlay_configure_stats -Argumentos '{"enable":false}'
```

O script recusa escrita **antes** de enviar `tools/call`. A classificação ao vivo usa `annotations.readOnlyHint`. Se a anotação não vier, vale a lista abaixo. Ferramenta desconhecida é tratada como ESCRITA.

Não coloque tokens, senhas nem chaves nesta pasta.

## Ferramentas medidas em 21/11/2026 21:11 (America/Rio_Branco)

`tools/list` devolveu **12** ferramentas: **6 de LEITURA** e **6 de ESCRITA**. A classificação segue `readOnlyHint` do próprio servidor (todas as 12 trouxeram a anotação). ESCRITA aqui significa: muda captura, filtro, overlay, inicia um programa, aplica preset de jogo ou altera Battery Boost / Whisper Mode.

### LEITURA (podem ser chamadas sem `-Confirmado`)

#### `nvapp_overlay_get_status`

Retorna o estado da overlay (gravação, replay, stats, áudio, filtros, notificações). Sem parâmetros.

Saída (campos): `overlayView` (`open`/`closed`), `recordingActive`, `instantReplayEnabled`, `desktopCapture`, `highlightsEnabled`, `statsOverlayEnabled`, `statsLogging`, `micMode` (`on`/`off`/`always_on`/`push_to_talk`), `notificationsEnabled`, `rtxDvc`, `rtxHdr`, `sharpening`, `freestyle`.

Anotações: `readOnlyHint=true`, `destructiveHint=false`, `idempotentHint=true`.

#### `nvapp_overlay_get_current_game_info`

Diz se um jogo está em execução, com nome, PID e tela cheia quando houver. Sem parâmetros.

Saída: `running` (obrigatório), `gameName`, `processId`, `fullscreen`.

Anotações: `readOnlyHint=true`, `destructiveHint=false`, `idempotentHint=true`.

#### `nvapp_client_get_applications`

Lista jogos e aplicativos descobertos pelo NVIDIA App, com detalhes de otimização (OPS). Parâmetros opcionais: `game` (nome exato já devolvido por esta ferramenta), `preset` (`Balanced`/`Performance`/`Recommended`/`Quality`; exige `game`).

Os nomes devolvidos em `game` identificam o app nas outras ferramentas com escopo de jogo.

Anotações: `readOnlyHint=true`, `destructiveHint=false`, `idempotentHint=true`.

#### `nvapp_client_get_driver_status`

Driver instalado, canal preferido, recomendações compatíveis e o driver anterior (rollback), se houver. Sem parâmetros.

Saída: `systemType` (`GEFORCE`/`WORKSTATION`), `installedDriver` (versão, canal, `availableActions` como `reinstall`), `preferredChannel`, `recommendedDrivers`, `previouslyInstalledDriver`.

Canais possíveis: `GAME_READY`, `STUDIO`, `NVIDIA_RECOMMENDED`, `LEADING_EDGE`, `CONSERVATIVE`.

Anotações: `readOnlyHint=true`, `destructiveHint=false`, `idempotentHint=true`.

**Teste medido (21:11):** `systemType=GEFORCE`; instalado `STUDIO` `621.24` (ação `reinstall`); `preferredChannel=STUDIO`; `recommendedDrivers=[]`; driver anterior `Driver GeForce Game Ready` `621.24` de `2026-11-12` (ação `rollback`). Confere com o relatório do sistema (Studio 621.24, 12/11/2026). Ver `notas\2026-11-21-sistema-nvidia.md`.

#### `nvapp_client_get_driver_release_notes`

Notas de versão do driver. Parâmetro obrigatório `driver`: `INSTALLED`, `GAME_READY` ou `STUDIO`.

Saída: `driver`, `version`, `highlights` (lista de `{title, items}`).

Anotações: `readOnlyHint=true`, `destructiveHint=false`, `idempotentHint=true`.

#### `nvapp_client_get_laptop_features`

Battery Boost e Whisper Mode, no global ou por jogo. Só faz sentido em notebook. Parâmetro opcional `game` (nome vindo de `nvapp_client_get_applications`; `global` ou `base` para o global; o padrão é global).

Saída: `scope` (`global`/`application`), `game` (se for app), `batteryBoost`, `whisperMode` (cada um com `supported`, e se suportado `enabled`; no escopo de app também `useGlobal`; Battery Boost pode ter `frameRate`; Whisper Mode pode ter `fanVolume` `Balanced`/`Quiet`/`Quieter` e `frameRate`).

Anotações: `readOnlyHint=true`, `destructiveHint=false`, `idempotentHint=true`.

**Teste medido (21:11), escopo global:** `batteryBoost.supported=true`, `enabled=true`, `frameRate=60`; `whisperMode.supported=false`. Divergência com o relatório do sistema, que marca WhisperMode como "Sim" — superfícies diferentes (hardware/driver vs. ajuste do App). O MCP não devolveu modelo da GPU, VBIOS nem Dynamic Boost.

### ESCRITA (o script recusa, salvo `-Confirmado`)

Nenhuma destas foi chamada nesta sessão.

#### `nvapp_overlay_capture`

Controla gravação, instant replay, captura de tela e highlights. Obrigatório: `action` (`toggle_recording`, `toggle_instant_replay`, `save_instant_replay`, `capture_screenshot`, `toggle_highlights`). `enable` (boolean) é obrigatório nas ações `toggle_*`; não enviar em `save_instant_replay` nem `capture_screenshot`.

Anotações: `readOnlyHint=false`, `destructiveHint=false`, `idempotentHint=false`.

#### `nvapp_overlay_configure_filters`

Liga ou desliga o filtro RTX Dynamic Vibrance (DVC). Obrigatórios: `filter` (`rtx_dvc`), `enable` (boolean).

Anotações: `readOnlyHint=false`, `destructiveHint=false`, `idempotentHint=true`.

#### `nvapp_overlay_configure_stats`

Mostra ou esconde a overlay de estatísticas. Obrigatório: `enable` (boolean).

Anotações: `readOnlyHint=false`, `destructiveHint=false`, `idempotentHint=true`.

#### `nvapp_client_launch_application`

Inicia um jogo ou aplicativo devolvido por `nvapp_client_get_applications`. Obrigatório: `game` (nome exato).

Anotações: `readOnlyHint=false`, `destructiveHint=false`, `idempotentHint=false`.

#### `nvapp_client_set_game_optimization`

Aplica um preset de otimização ou restaura o padrão de um jogo suportado. Obrigatórios: `game`, `preset` (`Balanced`, `Performance`, `Recommended`, `Quality`, `Revert`). Opcional: `powerSource` (`AC`/`Battery`; o padrão é AC).

Anotações: `readOnlyHint=false`, `destructiveHint=false`, `idempotentHint=true`.

#### `nvapp_client_set_laptop_feature`

Define Battery Boost ou Whisper Mode, no global ou por jogo (só notebook). Informe `batteryBoost` **ou** `whisperMode`. `game` opcional (`global`/`base` ou nome do jogo). No escopo de app, use `useGlobal`; no global, não envie `useGlobal`. Whisper Mode global pode ter `fanVolume` (`Balanced`/`Quiet`/`Quieter`).

Anotações: `readOnlyHint=false`, `destructiveHint=false`, `idempotentHint=true`.

## Caminho até o JARVIS da VPS

Ainda **não** há túnel, porta nova nem proxy no ar. O desenho proposto e o que falta confirmar estão no relatório desta tarefa e, no repositório do JARVIS (branch `nvidia-app`, sem deploy), em `docs/NVIDIA-APP.md`.
