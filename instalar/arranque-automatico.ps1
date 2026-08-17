# Deja el servidor del Mesón arrancando solo al encender el ordenador.
#
# Crea una tarea programada de Windows que lanza el servidor al iniciar el
# equipo (antes incluso de que nadie entre con su usuario) y lo vuelve a
# levantar si se cayera.
#
# Hay que ejecutarlo como ADMINISTRADOR:
#   Botón derecho en PowerShell -> "Ejecutar como administrador"
#   cd "C:\ruta\a\app-bar-gestion\instalar"
#   .\arranque-automatico.ps1
#
# Para quitarlo:  .\arranque-automatico.ps1 -Quitar

param(
  [switch]$Quitar,
  [switch]$EvitarSuspension,   # además, impide que el ordenador se duerma
  [string]$Tarea = 'ServidorComandas'
)

$ErrorActionPreference = 'Stop'

function EsAdministrador {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (EsAdministrador)) {
  Write-Host "Esto hay que ejecutarlo como administrador." -ForegroundColor Red
  Write-Host "Abre PowerShell con boton derecho -> 'Ejecutar como administrador' y vuelve a lanzarlo."
  exit 1
}

if ($Quitar) {
  if (Get-ScheduledTask -TaskName $Tarea -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $Tarea -Confirm:$false
    Write-Host "Quitado el arranque automatico ($Tarea)." -ForegroundColor Yellow
  } else {
    Write-Host "No habia ninguna tarea llamada $Tarea."
  }
  exit 0
}

# La carpeta del proyecto es la de arriba de esta
$proyecto = Split-Path -Parent $PSScriptRoot
$servidor = Join-Path $proyecto 'server.js'
if (-not (Test-Path $servidor)) {
  Write-Host "No encuentro server.js en $proyecto" -ForegroundColor Red
  exit 1
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
if (-not (Test-Path $node)) {
  Write-Host "No encuentro node.exe. Instala Node.js y vuelve a intentarlo." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Proyecto : $proyecto"
Write-Host "Node     : $node"
Write-Host ""

$accion = New-ScheduledTaskAction -Execute $node -Argument '"server.js"' -WorkingDirectory $proyecto
$disparador = New-ScheduledTaskTrigger -AtStartup
# Cuenta SYSTEM: arranca sin que nadie inicie sesion
$cuenta = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$opciones = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 999 `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

if (Get-ScheduledTask -TaskName $Tarea -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $Tarea -Confirm:$false
}
Register-ScheduledTask -TaskName $Tarea -Action $accion -Trigger $disparador `
  -Principal $cuenta -Settings $opciones `
  -Description 'Servidor de comandas del bar' | Out-Null

Write-Host "Listo: el servidor arrancara solo al encender el ordenador." -ForegroundColor Green

if ($EvitarSuspension) {
  powercfg /change standby-timeout-ac 0
  powercfg /change hibernate-timeout-ac 0
  powercfg /change monitor-timeout-ac 10
  Write-Host "El ordenador ya no se suspendera (la pantalla si se apaga a los 10 min)." -ForegroundColor Green
}

Write-Host ""
Write-Host "Para arrancarlo ahora mismo sin reiniciar:" -ForegroundColor Cyan
Write-Host "  Start-ScheduledTask -TaskName $Tarea"
Write-Host "Para ver si esta funcionando:" -ForegroundColor Cyan
Write-Host "  Get-ScheduledTask -TaskName $Tarea | Get-ScheduledTaskInfo"
Write-Host "  Get-NetTCPConnection -LocalPort 3000 -State Listen"
Write-Host ""
Write-Host "OJO: si tenias el servidor arrancado a mano con 'npm start', cierralo antes"
Write-Host "     o el puerto 3000 estara ocupado."
