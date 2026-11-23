# Instala o auto-inicio do JARVIS local na inicializacao do Windows.
# Cria/substitui a tarefa agendada "Jarvis_Local_Startup" (logon do usuario atual).
# Servico vivo NAO e tocado; se a porta 3200 estiver vazia, sobe o JARVIS pela tarefa.
#
# Uso:  powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\instalar-autostart.ps1

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot  # pasta jarvis-local
$tarefa = 'Jarvis_Local_Startup'
$acaoPs1 = Join-Path $PSScriptRoot 'iniciar-jarvis.ps1'

# --- 1. pre-checas
if (!(Test-Path (Join-Path $raiz 'server.mjs'))) {
    Write-Error ("server.mjs nao encontrado em {0}" -f $raiz)
}
if (!(Test-Path (Join-Path $raiz '.env.local'))) {
    Write-Error (".env.local ausente em {0} - instale/configure o JARVIS antes" -f $raiz)
}
if (!(Test-Path $acaoPs1)) {
    Write-Error ("iniciar-jarvis.ps1 nao encontrado em {0}" -f $PSScriptRoot)
}

# --- 2. tarefa anterior da gente (idempotente) - nunca toca em tarefas de outros
$antiga = Get-ScheduledTask -TaskName $tarefa -ErrorAction SilentlyContinue
if ($antiga) {
    Unregister-ScheduledTask -TaskName $tarefa -Confirm:$false
    Write-Output ("tarefa anterior '{0}' removida" -f $tarefa)
}

# --- 3. definicao da tarefa
$usuario = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $usuario -LogonType Interactive -RunLevel Limited
$acao = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $acaoPs1 + '"')
$gatilho = New-ScheduledTaskTrigger -AtLogOn -User $usuario
$gatilho.Delay = 'PT30S'  # 30 s apos o logon, dando tempo de rede/Ollama
$config = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $tarefa `
    -Action $acao -Trigger $gatilho -Settings $config -Principal $principal `
    -Description 'Auto-inicio do JARVIS local (jarvis-local.server.mjs, porta 3200) - criado por instalar-autostart.ps1' `
    | Out-Null

Write-Output ("tarefa '{0}' registrada (usuario {1}, 30 s apos logon)" -f $tarefa, $usuario)

# --- 4. dispara a tarefa; o iniciar-jarvis.ps1 decide sozinho se ha alvo (sem duplicar)
Start-ScheduledTask -TaskName $tarefa
Write-Output 'tarefa disparada (o iniciar-jarvis pula se o JARVIS ja estiver no ar)'

Write-Output 'instalacao concluida. remover com: desinstalar-autostart.ps1'
