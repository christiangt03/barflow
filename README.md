# BarFlow — TPV y gestión de comandas en tiempo real

App para llevar los pedidos de un bar-restaurante: los camareros toman las
comandas desde el móvil, la cocina y la barra las ven en una pantalla en
tiempo real y desde administración se controla la carta, la disponibilidad, el
almacén y la caja.

Pensada para **un local con su propio servidor en la WiFi del bar**: sin nube,
sin cuentas externas y sin más dependencias que Express y Socket.IO (la base de
datos es el SQLite que ya trae Node).

El nombre del local y todo lo propio de cada bar se configura en un fichero
`.env` (ver [`.env.example`](.env.example)) y desde la propia app; en el código
no hay ningún dato del negocio.

> **Todo funciona por el navegador. No hay ninguna app que instalar** — ni en
> los móviles de los camareros, ni en las tablets, ni en las pantallas de
> cocina y barra. Se abre una dirección web de la WiFi del bar y ya está.
> Lo único que se instala es Node.js, y solo en el ordenador que hace de
> servidor.

## Cómo arrancarla

1. Instalar [Node.js](https://nodejs.org) en el ordenador que hará de servidor
   (por ejemplo, el de la barra o el de cocina).
2. La primera vez, abrir una terminal en esta carpeta y ejecutar:

   ```
   npm install
   ```

3. Arrancar el servidor:

   ```
   npm start
   ```

4. La terminal muestra dos direcciones:
   - `http://localhost:3000` → para abrir en el propio ordenador.
   - `http://192.168.x.x:3000` → para abrir desde los **móviles de los
     camareros y la pantalla de cocina**, siempre que estén conectados a la
     **misma WiFi** del bar.

En los móviles conviene "Añadir a pantalla de inicio" desde el navegador para
que se abra como una app.

## Montaje en el bar (una sola vez)

Ver **[`instalar/LEEME.md`](instalar/LEEME.md)**: dirección fija del ordenador,
arranque automático al encender y alta de las tablets. Los camareros entran
**por el navegador del móvil**, no hay ninguna app que instalar.

## Aparatos del bar

Cada tablet o pantalla se da de alta en *Administración → Dispositivos* con su
nombre ("Tablet 1", "Barra", "Cocina"). La primera vez que se abre la app en un
aparato, se elige de esa lista y queda **pendiente** hasta que el gerente le da
el visto bueno; desde entonces ese aparato queda reconocido para siempre.

- Un móvil de fuera **no puede usar la app** aunque tenga un código válido.
- Cada comanda, cobro y aviso de stock queda firmado con el aparato del que
  salió: se ve en cocina, en barra, en la caja y en el informe Z (con desglose
  de lo cobrado por cada tablet).
- El gerente puede **bloquear** un aparato (por ejemplo si se pierde una
  tablet) o **desvincularlo** para pasarlo a otro equipo.
- El ordenador del bar y el gerente nunca se quedan fuera, para que siempre se
  pueda autorizar el primer aparato.

## Entrada con código personal

Al abrir la app, cada empleado escribe su **código personal** (PIN de 4 a 6
números) en el teclado de la pantalla de entrada:

- **Camareros**: pueden tomar comandas, anularlas y cobrar mesas.
- **Gerente**: además entra en Administración (carta, caja, empleados…).

**La primera vez que arranca el servidor** se crean dos empleados (un gerente y
un camarero) con códigos **generados al azar**, que se muestran una única vez
en la consola:

```
─── PRIMERA PUESTA EN MARCHA ───────────────────────────
 Gerente "Gerente" → código 5059
 Camarero "Camarero" → código 5515
```

Apúntalos: no se pueden volver a consultar (en la base de datos solo queda el
hash). Nada más entrar, ve a *Administración → Empleados*, da de alta a la
plantilla real con sus códigos y cambia o borra los de ejemplo.

Si prefieres elegirlos tú, ponlos en el `.env` **antes** del primer arranque
(`PIN_GERENTE_INICIAL`, `PIN_CAMARERO_INICIAL`).

Cada comanda queda firmada con el camarero que la envió (se ve en cocina) y
cada cobro con quién lo hizo (se ve en la caja). La sesión dura 20 horas: cada
día hay que volver a entrar con el código.

## Pantallas

- **Camareros** (`/camarero.html`): eliges zona (Terraza / Dentro / Barra) →
  mesa → añades platos de la carta o montas un menú del día (1 plato o
  2 platos + postre o café). Al enviar, la comanda llega a cocina al momento.
  Para quitar algo de la comanda, la **✕** pregunta cuántas unidades quitar
  (o **quitar todas** de un toque), en vez de ir restando de una en una.
  En la pestaña *Cuenta* se ve el total de la mesa y se puede:
  - **Imprimir la cuenta** para el cliente (ticket de 72 mm).
  - **Cambiar de mesa**: si los clientes se mueven, la cuenta entera se lleva
    a otra mesa (cocina recibe el aviso). Si la mesa de destino ya tiene
    cuenta, se juntan.
  - **Cobrar** en efectivo o tarjeta, lo que cierra la mesa.
- **Cocina** (`/cocina.html`): las comandas aparecen en tiempo real con un
  pitido. Al marcar **LISTO** se imprime un ticket que indica TERRAZA /
  DENTRO / BARRA, el número de mesa y el detalle (incluido si es menú del
  día de 1 o 2 platos y el postre). Se puede reimprimir. Cocina **solo ve lo
  que cocina prepara**: si la mesa pidió además bebidas, sale un apunte de que
  las saca la barra. Arriba a la derecha, el botón **⚠️ Falta stock** manda un
  aviso al gerente.
- **Barra** (`/barra.html`): la pantalla del camarero de barra. Recibe las
  comandas de bebida (las que son solo bebida no pasan por cocina) con su
  pitido. Al pulsar **🔔 LISTO — avisar a sala**, salta el aviso en los móviles
  de los camareros ("BEBIDAS LISTAS, mesa X") con sonido y vibración; si nadie
  baja, **🔔 Volver a avisar** repite el toque. Cuando el camarero confirma
  *Recogido*, la tarjeta se cierra. También tiene el botón **⚠️ Falta stock**.
- **Administración** (`/admin.html`):
  - *Avisos*: lo que cocina y barra avisan que se está acabando o ya se ha
    agotado, con quién lo avisó y a qué hora. Si insisten con el mismo
    producto no se apilan avisos: sube el contador (×2, ×3) y, si hace falta,
    pasa de "queda poco" a "agotado". El gerente marca **✔ resuelto** (queda
    en el historial) o lo borra. La pestaña lleva una chapa roja con los
    pendientes y salta un aviso en pantalla en cuanto entra uno nuevo.
  - *Disponibilidad*: marcar un artículo como agotado con motivo
    ("falta calamar"); a los camareros les sale bloqueado al instante.
  - *Editar carta*: añadir, borrar y cambiar precios. El icono 👩‍🍳/🍺 de cada
    artículo dice quién lo prepara; al tocarlo cambia. Todo lo marcado 🍺 sale
    por la pantalla de barra.
  - *Menú del día*: precios de 1/2 platos y los platos de hoy.
  - *Caja*: total del día separado por efectivo y tarjeta, con quién cobró.
    Al terminar el día, el botón **Cierre de caja (informe Z)** imprime el
    resumen del día (totales, desglose por empleado y anulaciones) y lo deja
    registrado; los cierres del día se pueden reimprimir.
  - *Almacén*: stock de alimentos y material. Cada producto tiene cantidad,
    unidad y un mínimo: si baja de ahí, sale arriba un aviso de "hay que
    reponer". Botones por producto: **＋** entrada (compra), **－** salida
    (gasto o merma, con motivo), **⟳** recuento (corregir la cantidad tras
    contar), **✎** editar y **🗑** borrar. Abajo queda el historial de
    movimientos con quién hizo cada uno.
  - *Empleados*: altas, bajas y códigos personales de la plantilla.

## Comandas que no se duplican

Si el camarero toca dos veces "Enviar", o la red va lenta y lo intenta otra
vez, la comanda **entra una sola vez**:

- El botón se bloquea mientras se está enviando.
- Cada envío lleva una clave propia; si esa misma clave llega dos veces, el
  servidor devuelve la comanda que ya creó en vez de crear otra.
- Si llega una comanda **idéntica** a la misma mesa en menos de 30 segundos
  (aunque sea con otra clave), se corta y se pregunta: *"¿Seguro que la mesa
  quiere otra vez lo mismo?"*. Si el camarero confirma, entra; si no, no pasa
  nada. Así una ronda repetida de verdad nunca se pierde.

El margen se puede cambiar con la variable `VENTANA_DUPLICADOS_MS` (por
defecto 30000, es decir 30 segundos).

## Pruebas automáticas

```
npm test
```

Levanta el servidor sobre una base de datos temporal (nunca toca `data/bar.db`)
y comprueba por HTTP los tres bloques: comandas duplicadas, reparto entre
cocina y barra, y avisos de stock.

## Impresión de tickets

El ticket se imprime desde el navegador de la pantalla de cocina (diálogo de
impresión, formato 72 mm para impresoras térmicas). Para que salga solo, en
Chrome se puede arrancar con `--kiosk-printing`, que imprime sin preguntar en
la impresora predeterminada.

## Datos

Todo se guarda en una base de datos SQLite: `data/bar.db` (la primera vez se
crea sola a partir de `data/semilla.json`). Si existía un `data/db.json` de
la versión anterior, al arrancar se migra automáticamente y queda de copia
como `data/db.json.migrado`.

- **Copia de seguridad**: el servidor guarda solo una copia al día en
  `data/copias/bar-AAAA-MM-DD.db` (conserva las últimas 14). Para llevársela a
  otro sitio (un pendrive, otro ordenador), basta con copiar ese fichero.
- **Empezar de cero**: parar el servidor y borrar `data/bar.db` (y sus
  compañeros `bar.db-wal` y `bar.db-shm` si existen).

Requiere Node.js 22.5 o más nuevo (usa el SQLite que trae Node de serie).

## Licencia

Copyright (C) 2026 christiangt03

Este programa es software libre: puedes redistribuirlo y/o modificarlo bajo los
términos de la **Licencia Pública General Affero de GNU (AGPL)**, en su versión
3, tal como la publica la Free Software Foundation.

Se distribuye con la esperanza de que sea útil, pero **SIN NINGUNA GARANTÍA**;
ni siquiera la garantía implícita de comerciabilidad o adecuación a un fin
concreto. Consulta la [Licencia Pública General Affero de GNU](LICENSE) para
más detalles.

En corto, y sin que esto sustituya al texto legal:

- Puedes **usarla en tu bar, mirarla, modificarla y compartirla**, gratis.
- Si repartes una versión modificada, o **la ofreces a otros a través de una
  red**, tienes que poner tu código a disposición de esos usuarios, también
  bajo AGPL (es la cláusula 13, lo que distingue a la AGPL de la GPL normal).
- No hay garantía de ningún tipo: si la usas en tu negocio, es bajo tu
  responsabilidad.

¿Quieres usarla en un producto cerrado, sin las obligaciones de la AGPL? El
titular de los derechos puede darte otra licencia distinta: abre una *issue*
para hablarlo.
