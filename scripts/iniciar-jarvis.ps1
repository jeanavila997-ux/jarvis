# Inicia o JARVIS local (:3200) se a porta estiver livre.
# Acao usada pela tarefa agendada Jarvis_Local_Startup (Agendador de Tarefas do Windows).
# Roda em powershell.exe 5.1+ sem modulos externos. Nao le o .env.local.

$ErrorActionPreference = 'Stop'

$raiz = Split-Path -Parent $PSScriptRoot  # pasta jarvis-local
$porta = 3200

# 1) probe HTTP real (imediate ao netstat/get-net: nesta maquina o listener da 3200
#    as vezes nao aparece nas consultas de rede)
try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$porta/api/saude" -UseBasicParsing -TimeoutSec 3
    if ($resp.StatusCode -eq 200) {
        Write-Output "JARVIS ja responde em http://127.0.0.1:$porta - nada a fazer"
        exit 0
    }
} catch {}

# 2) escuta na porta?
$ouvindo = Get-NetTCPConnection -LocalPort $porta -State Listen -ErrorAction SilentlyContinue
if ($ouvindo) {
    Write-Output ("porta {0} ja em uso (PID {1}) - nada a fazer" -f $porta, $ouvindo[0].OwningProcess)
    exit 0
}

if (!(Test-Path (Join-Path $raiz 'server.mjs'))) {
    Write-Error ("server.mjs nao encontrado em {0}" -f $raiz)
    exit 1
}
if (!(Test-Path (Join-Path $raiz '.env.local'))) {
    Write-Error (".env.local nao encontrado em {0} - configure antes de subir" -f $raiz)
    exit 1
}

$logOut = Join-Path $raiz 'data\jarvis-stdout.log'
$logErr = Join-Path $raiz 'data\jarvis-stderr.log'
New-Item -ItemType Directory -Force -Path (Join-Path $raiz 'data') | Out-Null

$proc = Start-Process -FilePath 'node' `
    -ArgumentList '--env-file=.env.local', 'server.mjs' `
    -WorkingDirectory $raiz `
    -WindowStyle Hidden `
    -RedirectStandardOutput $logOut `
    -RedirectStandardError $logErr `
    -PassThru

Write-Output ("JARVIS iniciado - PID {0} - porta {1}" -f $proc.Id, $porta)
