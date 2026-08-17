# Deja al ordenador del bar siempre con la misma direccion (IP fija).
#
# Es lo unico que puede dejar la app inaccesible de un dia para otro: si el
# router le cambia la direccion al ordenador, la que tienen guardada los
# camareros deja de funcionar.
#
# LO RECOMENDABLE es hacerlo en el router (reserva DHCP): ver LEEME.md.
# Este script es la otra via: fijar la IP en el propio ordenador.
#
# Hay que ejecutarlo como ADMINISTRADOR:
#   .\ip-fija.ps1                       (usa la IP que tiene ahora)
#   .\ip-fija.ps1 -Ip 192.168.1.50      (le pone otra)
#   .\ip-fija.ps1 -Volver               (vuelve a IP automatica)

param(
  [string]$Ip,
  [switch]$Volver
)

$ErrorActionPreference = 'Stop'

function EsAdministrador {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (EsAdministrador)) {
  Write-Host "Esto hay que ejecutarlo como administrador." -ForegroundColor Red
  exit 1
}

# Adaptador por el que se sale a la red del bar
$conf = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1
if (-not $conf) {
  Write-Host "Este ordenador no esta conectado a ninguna red." -ForegroundColor Red
  exit 1
}
$indice  = $conf.InterfaceIndex
$alias   = $conf.InterfaceAlias
$actual  = $conf.IPv4Address.IPAddress
$mascara = $conf.IPv4Address.PrefixLength
$router  = $conf.IPv4DefaultGateway.NextHop
$dns     = ($conf.DNSServer | Where-Object { $_.AddressFamily -eq 2 }).ServerAddresses

Write-Host ""
Write-Host "Adaptador : $alias"
Write-Host "IP ahora  : $actual/$mascara"
Write-Host "Router    : $router"
Write-Host ""

if ($Volver) {
  Remove-NetIPAddress -InterfaceIndex $indice -AddressFamily IPv4 -Confirm:$false -ErrorAction SilentlyContinue
  Remove-NetRoute -InterfaceIndex $indice -DestinationPrefix '0.0.0.0/0' -Confirm:$false -ErrorAction SilentlyContinue
  Set-NetIPInterface -InterfaceIndex $indice -Dhcp Enabled
  Set-DnsClientServerAddress -InterfaceIndex $indice -ResetServerAddresses
  Write-Host "Vuelto a direccion automatica (DHCP)." -ForegroundColor Yellow
  exit 0
}

if (-not $Ip) { $Ip = $actual }

Write-Host "Se va a fijar la IP $Ip en '$alias'." -ForegroundColor Cyan
Write-Host "AVISO: esa direccion tiene que estar FUERA del rango que reparte el router," -ForegroundColor Yellow
Write-Host "       o algun dia se la puede dar a otro aparato y habria conflicto." -ForegroundColor Yellow
$respuesta = Read-Host "Escribe SI para continuar"
if ($respuesta -ne 'SI') { Write-Host "Cancelado."; exit 0 }

Remove-NetIPAddress -InterfaceIndex $indice -AddressFamily IPv4 -Confirm:$false -ErrorAction SilentlyContinue
Remove-NetRoute -InterfaceIndex $indice -DestinationPrefix '0.0.0.0/0' -Confirm:$false -ErrorAction SilentlyContinue
New-NetIPAddress -InterfaceIndex $indice -IPAddress $Ip -PrefixLength $mascara -DefaultGateway $router | Out-Null
if ($dns) { Set-DnsClientServerAddress -InterfaceIndex $indice -ServerAddresses $dns }

Write-Host ""
Write-Host "Listo. El ordenador del bar sera siempre http://${Ip}:3000" -ForegroundColor Green
Write-Host "Comprueba que sigue habiendo internet antes de darlo por bueno."
