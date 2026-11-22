# Inicia o Docker MCP Gateway so em 127.0.0.1:8811 (streamable HTTP).
# Nao imprime o token. Nao abre porta publica.
$ErrorActionPreference = 'Stop'
$Port = 8811
$HostBind = '127.0.0.1'
$ProfileId = 'jarvis-github'
$EnvFile = Join-Path $PSScriptRoot '..\.env.local'
$LogDir = Join-Path $PSScriptRoot '..\data\docker-mcp-gateway'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Log = Join-Path $LogDir 'gateway.log'
function Log([string]$m) { Add-Content $Log ("{0} (Acre) {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) }

function Get-EnvLocalValue([string]$key) {
  if (-not (Test-Path $EnvFile)) { return $null }
  foreach ($line in Get-Content $EnvFile -ErrorAction SilentlyContinue) {
    if ($line -match '^\s*#' -or $line -match '^\s*$') { continue }
    $k, $v = $line -split '=', 2
    if ($k.Trim() -eq $key) { return ($v + '').Trim().Trim('"').Trim("'") }
  }
  return $null
}

function Port-InUse {
  try {
    $c = Get-NetTCPConnection -LocalAddress $HostBind -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return [bool]$c
  } catch { return $false }
}

if (Port-InUse) { Log "ja escutando em ${HostBind}:${Port}"; exit 0 }

$token = Get-EnvLocalValue 'DOCKER_MCP_TOKEN'
if ([string]::IsNullOrWhiteSpace($token)) { Log 'DOCKER_MCP_TOKEN ausente no .env.local — nao inicio o gateway.'; exit 1 }
$env:MCP_GATEWAY_AUTH_TOKEN = $token

$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  cmd /c "docker info --format {{.ServerVersion}} >NUL 2>NUL"
  if ($LASTEXITCODE -eq 0) { $ok = $true; break }
  Start-Sleep -Seconds 4
}
if (-not $ok) { Log 'Docker nao ficou pronto; desisto desta tentativa.'; exit 1 }

Log "iniciando docker mcp gateway run --profile $ProfileId --host $HostBind --port $Port"
$docker = (Get-Command docker).Source
# -Wait keeps the scheduled task process attached to the long-running gateway.
& $docker mcp gateway run --profile $ProfileId --host $HostBind --port $Port --transport streaming --block-secrets 1>> $Log 2>&1
Log "gateway saiu exit=$LASTEXITCODE"