#Requires -Version 5.1
<#
.SYNOPSIS
  Cliente do MCP Streamable HTTP nvidia-app no PC (127.0.0.1:13508).

.DESCRIPTION
  Faz initialize, guarda o Mcp-Session-Id, envia notifications/initialized
  e chama uma ferramenta. Recusa ferramentas de ESCRITA a menos que
  -Confirmado seja passado. A classificação ao vivo usa annotations.readOnlyHint;
  se o servidor não enviar a anotação, vale a lista embutida. Ferramenta
  desconhecida é tratada como ESCRITA (não executa sem -Confirmado).

.EXAMPLE
  .\nvidia-mcp.ps1 -Listar

.EXAMPLE
  .\nvidia-mcp.ps1 -Ferramenta nvapp_client_get_driver_status

.EXAMPLE
  .\nvidia-mcp.ps1 -Ferramenta nvapp_client_get_driver_release_notes -Argumentos '{"driver":"INSTALLED"}'

.EXAMPLE
  .\nvidia-mcp.ps1 -Ferramenta nvapp_overlay_configure_stats -Argumentos '{"enable":false}' -Confirmado
#>
[CmdletBinding(DefaultParameterSetName='Chamar')]
param(
  [Parameter(ParameterSetName='Chamar', Position=0)]
  [string]$Ferramenta,

  [Parameter(ParameterSetName='Chamar')]
  [string]$Argumentos = '{}',

  [Parameter(ParameterSetName='Chamar')]
  [switch]$Confirmado,

  [Parameter(ParameterSetName='Listar')]
  [switch]$Listar,

  [string]$Endpoint = 'http://127.0.0.1:13508/mcp'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Lista de segurança (espelho medido em 21/11/2026). A anotação ao vivo prevalece.
$LeituraConhecida = @(
  'nvapp_overlay_get_status',
  'nvapp_overlay_get_current_game_info',
  'nvapp_client_get_applications',
  'nvapp_client_get_driver_status',
  'nvapp_client_get_driver_release_notes',
  'nvapp_client_get_laptop_features'
)
$EscritaConhecida = @(
  'nvapp_overlay_capture',
  'nvapp_overlay_configure_filters',
  'nvapp_overlay_configure_stats',
  'nvapp_client_launch_application',
  'nvapp_client_set_game_optimization',
  'nvapp_client_set_laptop_feature'
)

function ConvertFrom-JsonSafe {
  param([string]$Text)
  if ([string]::IsNullOrWhiteSpace($Text)) { return $null }
  return $Text | ConvertFrom-Json
}

function Invoke-McpRpc {
  param(
    [string]$EndpointUrl,
    [string]$Body,
    [string]$SessionId,
    [string]$Method = 'POST'
  )
  $request = [System.Net.HttpWebRequest]::Create($EndpointUrl)
  $request.Method = $Method
  $request.Timeout = 20000
  $request.ReadWriteTimeout = 20000
  $request.Accept = 'application/json, text/event-stream'
  if ($Method -ne 'GET' -and $Method -ne 'DELETE') {
    $request.ContentType = 'application/json'
  }
  if ($SessionId) { $request.Headers.Add('Mcp-Session-Id', $SessionId) }

  if ($Method -eq 'POST' -or $Method -eq 'PUT') {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Body)
    $request.ContentLength = $bytes.Length
    $stream = $request.GetRequestStream()
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Close()
  } else {
    $request.ContentLength = 0
  }

  try {
    $response = $request.GetResponse()
  } catch [System.Net.WebException] {
    if ($_.Exception.Response) { $response = $_.Exception.Response } else { throw }
  }

  $status = [int]$response.StatusCode
  $newSession = $response.Headers['Mcp-Session-Id']
  $reader = New-Object System.IO.StreamReader($response.GetResponseStream(), [System.Text.Encoding]::UTF8)
  $text = $reader.ReadToEnd()
  $reader.Close()
  $response.Close()

  return [pscustomobject]@{
    Status = $status
    Session = $newSession
    Body = $text
  }
}

function Get-ToolClass {
  param($ToolMeta, [string]$Name)
  if ($null -ne $ToolMeta -and $null -ne $ToolMeta.annotations) {
    $hint = $ToolMeta.annotations.readOnlyHint
    if ($hint -eq $true) { return 'LEITURA' }
    if ($hint -eq $false) { return 'ESCRITA' }
  }
  if ($LeituraConhecida -contains $Name) { return 'LEITURA' }
  return 'ESCRITA'
}

function Get-ToolsFromListBody {
  param([string]$Body)
  $rpc = ConvertFrom-JsonSafe $Body
  if (-not $rpc -or -not $rpc.result -or -not $rpc.result.tools) { return @() }
  return @($rpc.result.tools)
}

if (-not $Listar -and [string]::IsNullOrWhiteSpace($Ferramenta)) {
  Write-Error "Informe -Ferramenta <nome> ou -Listar."
  exit 1
}

if (-not $Listar) {
  $trimmed = $Argumentos.Trim()
  if ([string]::IsNullOrWhiteSpace($trimmed)) { $trimmed = '{}' }
  try {
    $null = ConvertFrom-JsonSafe $trimmed
  } catch {
    Write-Error "Argumentos precisa ser JSON válido. Ex.: -Argumentos '{`"driver`":`"INSTALLED`"}'"
    exit 1
  }
  $Argumentos = $trimmed
}

$session = $null
try {
  $initBody = @{
    jsonrpc = '2.0'
    id = 1
    method = 'initialize'
    params = @{
      protocolVersion = '2025-03-26'
      capabilities = @{}
      clientInfo = @{ name = 'jarvis-vps-github-nvidia-mcp'; version = '1.0.0' }
    }
  } | ConvertTo-Json -Depth 8 -Compress

  $init = Invoke-McpRpc -EndpointUrl $Endpoint -Body $initBody
  if ($init.Status -lt 200 -or $init.Status -ge 300) {
    Write-Error "initialize falhou (HTTP $($init.Status)): $($init.Body)"
    exit 1
  }
  $session = $init.Session
  if (-not $session) {
    Write-Error 'O servidor não devolveu Mcp-Session-Id no initialize.'
    exit 1
  }

  $notify = Invoke-McpRpc -EndpointUrl $Endpoint -Body '{"jsonrpc":"2.0","method":"notifications/initialized"}' -SessionId $session
  if ($notify.Status -lt 200 -or $notify.Status -ge 300) {
    Write-Error "notifications/initialized falhou (HTTP $($notify.Status))"
    exit 1
  }

  $list = Invoke-McpRpc -EndpointUrl $Endpoint -Body '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' -SessionId $session
  if ($list.Status -lt 200 -or $list.Status -ge 300) {
    Write-Error "tools/list falhou (HTTP $($list.Status)): $($list.Body)"
    exit 1
  }
  $tools = Get-ToolsFromListBody -Body $list.Body

  if ($Listar) {
    Write-Output "Endpoint: $Endpoint"
    Write-Output ("Ferramentas: {0}" -f $tools.Count)
    Write-Output ''
    foreach ($t in $tools) {
      $classe = Get-ToolClass -ToolMeta $t -Name $t.name
      Write-Output ("[{0}] {1}" -f $classe, $t.name)
      Write-Output ("    {0}" -f $t.description)
    }
    exit 0
  }

  $meta = $null
  foreach ($t in $tools) {
    if ($t.name -eq $Ferramenta) { $meta = $t; break }
  }
  $classe = Get-ToolClass -ToolMeta $meta -Name $Ferramenta

  if ($classe -eq 'ESCRITA' -and -not $Confirmado) {
    $msg = @"
Recusado: '$Ferramenta' é ESCRITA (muda captura, filtro, overlay, jogo, otimização ou ajuste de notebook).
Não foi enviada nenhuma chamada tools/call.
Para executar de propósito, passe -Confirmado.
"@
    [Console]::Error.WriteLine($msg)
    exit 2
  }

  if (-not $meta) {
    Write-Output "Aviso: '$Ferramenta' não apareceu no tools/list; seguindo como $classe porque -Confirmado foi informado."
  }

  $callObj = @{
    jsonrpc = '2.0'
    id = 3
    method = 'tools/call'
    params = @{
      name = $Ferramenta
      arguments = (ConvertFrom-JsonSafe $Argumentos)
    }
  }
  $callBody = $callObj | ConvertTo-Json -Depth 20 -Compress
  $call = Invoke-McpRpc -EndpointUrl $Endpoint -Body $callBody -SessionId $session
  Write-Output ("HTTP {0}" -f $call.Status)
  Write-Output ("classe={0}" -f $classe)
  if ($call.Body) { Write-Output $call.Body }
  if ($call.Status -lt 200 -or $call.Status -ge 300) { exit 1 }
  $rpc = ConvertFrom-JsonSafe $call.Body
  if ($null -ne $rpc) {
    $errProp = $rpc.PSObject.Properties['error']
    if ($errProp -and $null -ne $errProp.Value) {
      Write-Error ("JSON-RPC error: " + ($errProp.Value | ConvertTo-Json -Depth 8 -Compress))
      exit 1
    }
  }
  exit 0
}
finally {
  if ($session) {
    try { [void](Invoke-McpRpc -EndpointUrl $Endpoint -Body '' -SessionId $session -Method 'DELETE') } catch { }
  }
}
