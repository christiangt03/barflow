# BarFlow

TPV y gestión de comandas para bares y restaurantes. Los camareros toman las
comandas desde el móvil, cocina y barra las reciben en su propia pantalla en
tiempo real, y desde administración se lleva la carta, la disponibilidad, el
almacén y la caja.

Está pensada para funcionar dentro del local: un ordenador del bar hace de
servidor y el resto de aparatos se conectan por la WiFi. No depende de la nube
ni de servicios externos, así que el bar sigue funcionando aunque se caiga
internet.

Todo se usa desde el navegador. En los móviles, tablets y pantallas de cocina
no hay que instalar nada; solo hace falta Node.js en el ordenador que hace de
servidor.

## Stack

- Node.js (22.5 o superior) con Express
- Socket.IO para el tiempo real entre sala, cocina y barra
- SQLite integrado en Node (`node:sqlite`), sin base de datos externa
- HTML, CSS y JavaScript sin framework en el frontend
- Pruebas con el runner de Node y CI en GitHub Actions (Node 22 y 24)

## Puesta en marcha

```
npm install
npm start
```

Al arrancar, la consola muestra dos direcciones:

- `http://localhost:3000` para abrirla en el propio ordenador.
- `http://192.168.x.x:3000` para los móviles y pantallas conectados a la misma
  WiFi.

En el móvil se puede usar "Añadir a pantalla de inicio" para que se abra como
una app.

Los datos propios de cada local (nombre, dirección, códigos iniciales) van en
un fichero `.env`; hay una plantilla en `.env.example`. El montaje completo en
un bar (IP fija, arranque automático y alta de tablets) está explicado en
[`instalar/LEEME.md`](instalar/LEEME.md).

## Funcionalidades

**Sala (camareros)**
- Selección de zona y mesa, carta y menú del día.
- Envío de comandas a cocina y barra al momento.
- Cuenta de la mesa: imprimir ticket, cambiar de mesa y cobrar en efectivo o
  tarjeta.
- Aviso en el móvil cuando la barra tiene las bebidas listas para llevar.

**Cocina y barra**
- Cada pantalla recibe solo lo que le toca preparar. Las comandas que son solo
  de bebida no pasan por cocina.
- Cocina marca cada comanda como lista e imprime el ticket en formato de 72 mm
  para impresora térmica, con la zona y la mesa.
- Barra avisa a sala con sonido y vibración cuando las bebidas están listas.
- Aviso de falta de stock al gerente.

**Administración**
- Avisos de stock agrupados por producto, con historial.
- Gestión de carta, precios, disponibilidad y menú del día.
- Caja diaria por método de pago y empleado, con cierre e informe Z.
- Almacén con stock mínimo, entradas, salidas, recuentos e historial de
  movimientos.
- Altas y bajas de empleados.

## Seguridad y control de acceso

- Cada empleado entra con un PIN personal. Los camareros toman comandas y
  cobran; el gerente además accede a administración.
- En el primer arranque los PIN iniciales se generan al azar y se muestran una
  sola vez por consola. En la base de datos solo se guarda el hash.
- Cada tablet o pantalla tiene que ser autorizada por el gerente antes de
  poder usarse. Un móvil ajeno al bar no puede entrar aunque conozca un PIN.
- Cada comanda, cobro y aviso queda registrado con el empleado y el aparato
  que lo hizo.

## Comandas sin duplicados

Si el camarero pulsa dos veces "Enviar" o la red va lenta y se reintenta, la
comanda entra una sola vez. Cada envío lleva una clave única y el servidor
ignora las repeticiones. Además, si llega una comanda idéntica para la misma
mesa en menos de 30 segundos, la app pide confirmación antes de aceptarla
(configurable con `VENTANA_DUPLICADOS_MS`).

## Datos y copias de seguridad

Los datos se guardan en `data/bar.db`, que se crea solo a partir de
`data/semilla.json` la primera vez. El servidor hace una copia diaria en
`data/copias/` y conserva las últimas 14.

Para empezar de cero basta con parar el servidor y borrar `data/bar.db` junto
con `bar.db-wal` y `bar.db-shm` si existen.

## Pruebas

```
npm test
```

Las pruebas levantan el servidor sobre una base de datos temporal (nunca tocan
`data/bar.db`) y lo comprueban por HTTP.

## Licencia

Distribuido bajo la licencia [GNU AGPL v3](LICENSE). Puedes usarlo, modificarlo
y compartirlo libremente; si distribuyes una versión modificada o la ofreces a
terceros a través de una red, tienes que publicar tu código bajo la misma
licencia. Para un uso comercial con otra licencia, abre una issue.

Copyright (C) 2026 christiangt03
