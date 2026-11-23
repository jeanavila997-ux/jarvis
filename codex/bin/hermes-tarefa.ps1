# Chama o Hermes na VPS (API só em 127.0.0.1:8642, via SSH).
# Sem SSH, cai no JARVIS (/hermes) — isso é status/chat, NÃO executa a tarefa no agente.
# Uso: .\hermes-tarefa.ps1 "tarefa"
# Env: HERMES_SSH (padrão: root@72.62.11.116), HERMES_SSH_OPTS (ex.: -i $HOME\.ssh\id_ed25519)
param(
  [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
  [string[]]$TaskParts
)

$Task = ($TaskParts -join ' ').Trim()
if (-not $Task) {
  Write-Error 'uso: hermes-tarefa.ps1 "tarefa"'
  exit 2
}

$Destino = if ($env:HERMES_SSH) { $env:HERMES_SSH } else { 'root@72.62.11.116' }
# hermes-tarefa na VPS só aceita argv. Escapa aspas simples para o remoto.
$Escapado = $Task.Replace("'", "'\''")
$SshArgs = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new')
if ($env:HERMES_SSH_OPTS) {
  $SshArgs += ($env:HERMES_SSH_OPTS -split '\s+' | Where-Object { $_ })
}
$SshArgs += @($Destino, "hermes-tarefa '$Escapado'")

$Aqui = Split-Path -Parent $MyInvocation.MyCommand.Path

function Invoke-JarvisFallback {
  Write-Warning 'SSH indisponível. Caindo para o JARVIS (/hermes). Isso só consulta o status/chat do JARVIS; não executa a tarefa no agente Hermes da VPS.'
  $script = Join-Path $Aqui 'jarvis-ask.mjs'
  if (-not (Test-Path $script)) {
    Write-Error 'jarvis-ask.mjs não encontrado e SSH falhou.'
    exit 1
  }
  & node $script "/hermes $Task"
  exit $LASTEXITCODE
}

& ssh @SshArgs
$code = $LASTEXITCODE
if ($code -eq 0) { exit 0 }
if ($code -eq 255 -or $code -eq $null) { Invoke-JarvisFallback }
exit $code
