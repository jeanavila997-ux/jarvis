# Desinstala o auto-inicio do JARVIS local criado por instalar-autostart.ps1.
# Remove a tarefa agendada "Jarvis_Local_Startup". Nao apaga arquivos do projeto
# e, por padrao, NAO mata o JARVIS se ele estiver no ar (use -Parar para isso).
#
# Uso (opcional: -Parar):
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\desinstalar-autostart.ps1
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\desinstalar-autostart.ps1 -Parar

param(
    [switch]$Parar
)

$ErrorActionPreference = 'Continue'
$tarefa = 'Jarvis_Local_Startup'

# --- 1. parar instancia da tarefa (se houver)
$instanciada = Get-ScheduledTask -TaskName $tarefa -ErrorAction SilentlyContinue
if ($instanciada) {
    try { Stop-ScheduledTask -TaskName $tarefa -ErrorAction SilentlyContinue } catch {}
}

# --- 2. (opcional) matar o JARVIS de pe
if ($Parar) {
    $ouvindo = Get-NetTCPConnection -LocalPort 3200 -State Listen -ErrorAction SilentlyContinue
    if ($ouvindo) {
        $pidJ = $ouvindo[0].OwningProcess
        Stop-Process -Id $pidJ -Force
        Write-Output ("JARVIS parado (PID {0})" -f $pidJ)
    } else {
        Write-Output 'JARVIS nao estava no ar'
    }
}

# --- 3. remover a tarefa
if ($instanciada) {
    Unregister-ScheduledTask -TaskName $tarefa -Confirm:$false
    Write-Output ("tarefa '{0}' removida" -f $tarefa)
} else {
    Write-Output ("tarefa '{0}' nao estava registrada - nada a remover" -f $tarefa)
}

Write-Output ('desinstalacao concluida. reinstalar com: instalar-autostart.ps1')
