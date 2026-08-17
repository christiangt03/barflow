# Dejar el bar montado

Tres cosas, una vez, y ya no hay que volver a tocar nada.

## 1. Que el ordenador tenga siempre la misma dirección

Es lo único que puede dejar la app inaccesible de un día para otro: si el
router le cambia la dirección al ordenador, la que tienen guardada los
camareros en el móvil deja de funcionar.

**Lo mejor: reservarla en el router** (así el ordenador sigue en automático y
no hay conflictos).

Primero, apunta los datos del ordenador que hace de servidor:

```powershell
Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } |
  Select-Object InterfaceAlias,
                @{n='IP';     e={$_.IPv4Address.IPAddress}},
                @{n='Router'; e={$_.IPv4DefaultGateway.NextHop}}
Get-NetAdapter | Where-Object Status -eq 'Up' | Select-Object Name, MacAddress
```

Y luego:

1. Entrar en el router desde el navegador (la dirección es la que sale como
   **Router** arriba; suele ser `192.168.1.1` o `192.168.0.1`).
2. Buscar el apartado **DHCP → Reservas** (según el router: "Direcciones
   reservadas", "DHCP estático", "Address Reservation").
3. Añadir una reserva emparejando la **MAC** del adaptador que usa el
   ordenador (mejor por cable) con la **IP** que ya tiene.
4. Guardar y reiniciar el router.

**Si el router no deja hacer reservas**, se fija en el propio ordenador:

```powershell
# PowerShell como administrador
cd "C:\ruta\a\app-bar-gestion\instalar"
.\ip-fija.ps1
```

Ojo: en ese caso la IP debe quedar **fuera del rango que reparte el router**
(muchos reparten de .100 a .200; mirar hasta dónde llega el rango en la configuración del router). Para deshacerlo: `.\ip-fija.ps1 -Volver`.

## 2. Que el servidor arranque solo al encender

```powershell
# PowerShell como administrador
cd "C:\ruta\a\app-bar-gestion\instalar"
.\arranque-automatico.ps1 -EvitarSuspension
```

Crea una tarea de Windows que lanza el servidor **al encender el ordenador**,
sin que nadie tenga que iniciar sesión, y lo vuelve a levantar si se cayera.
Con `-EvitarSuspension` además impide que el equipo se duerma (si se duerme,
se cae la app para todos; la pantalla sí se apaga a los 10 minutos).

Antes de lanzarlo, cierra el `npm start` que tengas a mano, o el puerto 3000
estará ocupado.

Comprobaciones:

```powershell
Get-ScheduledTask -TaskName ServidorComandas | Get-ScheduledTaskInfo   # última ejecución
Get-NetTCPConnection -LocalPort 3000 -State Listen                   # está escuchando
Start-ScheduledTask -TaskName ServidorComandas                         # arrancarlo ya
```

Para quitarlo: `.\arranque-automatico.ps1 -Quitar`.

## 3. Dar de alta las tablets

Los camareros entran **por el navegador**, no hay ninguna app que instalar. El
"aparato" no es un programa: es simplemente una **cookie** que se queda
guardada en el navegador de esa tablet.

1. En el ordenador del bar: `http://localhost:3000` → entrar como gerente →
   **Administración → Dispositivos** → dar de alta un aparato por cada tablet
   o pantalla: "Tablet 1", "Tablet 2", "Barra", "Cocina"…
2. En cada tablet: abrir `http://192.168.1.50:3000`, entrar con el código del
   empleado y **elegir de la lista qué aparato es**. Queda *pendiente*.
3. Volver a Administración → Dispositivos y darle al **✔** para autorizarlo.
   La tablet se desbloquea sola en unos segundos.

Desde entonces ese aparato queda reconocido para siempre, y cada comanda,
cobro y aviso de stock queda firmado con su nombre. Un móvil de fuera no puede
usar la app aunque tenga un código válido.

En la tablet conviene **"Añadir a pantalla de inicio"** desde el navegador: se
abre a pantalla completa y con su icono, pero **sigue siendo la misma web** —
no se instala nada, es solo un acceso directo.

### Si una tablet pide identificarse otra vez

Como la identidad del aparato es una cookie del navegador, se pierde si se
**borran los datos de navegación**, si se abre en **modo incógnito** o si se
usa **otro navegador** en esa misma tablet (Chrome y Firefox cuentan como
aparatos distintos).

No es grave: la tablet vuelve a salir en la pantalla de identificarse, se
elige el mismo nombre de la lista y el gerente le da el ✔ otra vez. Para
evitarlo, usar siempre el mismo navegador y no limpiar sus datos.

> El ordenador del bar (el que hace de servidor) no necesita identificarse, y
> el gerente nunca se queda fuera: si no, no habría forma de autorizar el
> primer aparato.
