// Comandas duplicadas: que la misma comanda no entre dos veces por un doble clic
// o porque la red va lenta, pero que sí se pueda repetir a propósito.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { arrancarServidor, crearCliente, articulo, linea, PIN_CAMARERO } = require('./ayuda');

describe('Prevención de comandas duplicadas', () => {
  let servidor;
  let camarero;
  let tortilla;
  let mesa = 0;

  before(async () => {
    servidor = await arrancarServidor();
    camarero = crearCliente(servidor.url);
    await camarero.entrar(PIN_CAMARERO);
    tortilla = await articulo(camarero, 'Tortilla de patatas');
  });

  after(async () => {
    await servidor.cerrar();
  });

  // Cada prueba usa su propia mesa para no pisarse con las demás
  const siguienteMesa = () => ++mesa;

  const enviar = (mesaN, items, extra = {}) =>
    camarero.pedir('POST', '/api/pedidos', { zona: 'dentro', mesa: mesaN, items, ...extra });

  const pedidosDe = async (mesaN) => {
    const { datos } = await camarero.pedir('GET', '/api/estado');
    return datos.pedidos.filter((p) => p.zona === 'dentro' && p.mesa === mesaN);
  };

  test('el mismo envío repetido con la misma clave solo crea una comanda', async () => {
    const m = siguienteMesa();
    const items = [linea(tortilla, 2)];
    const clave = 'prueba-clave-repetida-1';

    const primera = await enviar(m, items, { claveIdem: clave });
    const segunda = await enviar(m, items, { claveIdem: clave });

    assert.equal(primera.estado, 200);
    assert.equal(primera.datos.duplicada, false);
    assert.equal(segunda.estado, 200, 'el reintento no debe dar error: es idempotente');
    assert.equal(segunda.datos.duplicada, true, 'el servidor debe avisar de que ya estaba');
    assert.deepEqual(
      segunda.datos.pedidos.map((p) => p.id),
      primera.datos.pedidos.map((p) => p.id),
      'debe devolver la comanda que ya existía, no una nueva'
    );
    assert.equal((await pedidosDe(m)).length, 1, 'solo puede haber una comanda en la mesa');
  });

  test('cinco envíos a la vez con la misma clave (doble clic nervioso) solo crean una', async () => {
    const m = siguienteMesa();
    const items = [linea(tortilla, 1)];
    const clave = 'prueba-clave-rafaga';

    const respuestas = await Promise.all(Array.from({ length: 5 }, () => enviar(m, items, { claveIdem: clave })));

    assert.ok(respuestas.every((r) => r.estado === 200), 'ninguna debe fallar');
    const pedidos = await pedidosDe(m);
    assert.equal(pedidos.length, 1, 'cinco intentos, una sola comanda');
  });

  test('la misma comanda con otra clave dentro de la ventana se rechaza (409)', async () => {
    const m = siguienteMesa();
    const items = [linea(tortilla, 1)];

    await enviar(m, items, { claveIdem: 'prueba-original-a' });
    const repetida = await enviar(m, items, { claveIdem: 'prueba-otra-clave-a' });

    assert.equal(repetida.estado, 409);
    assert.equal(repetida.datos.codigo, 'comanda-repetida');
    assert.ok(repetida.datos.error.includes('segundos'), 'el mensaje dice cuánto hace que se envió');
    assert.equal((await pedidosDe(m)).length, 1);
  });

  test('sin clave de envío también se detecta el duplicado por el contenido', async () => {
    const m = siguienteMesa();
    const items = [linea(tortilla, 3)];

    const primera = await enviar(m, items);
    const segunda = await enviar(m, items);

    assert.equal(primera.estado, 200);
    assert.equal(segunda.estado, 409);
    assert.equal((await pedidosDe(m)).length, 1);
  });

  test('si la mesa repite de verdad, se envía confirmando y entra la segunda', async () => {
    const m = siguienteMesa();
    const items = [linea(tortilla, 1)];

    await enviar(m, items, { claveIdem: 'prueba-original-b' });
    const rechazada = await enviar(m, items, { claveIdem: 'prueba-repite-b' });
    assert.equal(rechazada.estado, 409);

    const confirmada = await enviar(m, items, { claveIdem: 'prueba-repite-b', confirmarRepetida: true });
    assert.equal(confirmada.estado, 200);
    assert.equal(confirmada.datos.duplicada, false);
    assert.equal((await pedidosDe(m)).length, 2, 'la repetición pedida a propósito sí entra');
  });

  test('una comanda distinta en la misma mesa entra sin quejarse', async () => {
    const m = siguienteMesa();

    await enviar(m, [linea(tortilla, 1)], { claveIdem: 'prueba-dist-1' });
    const otra = await enviar(m, [linea(tortilla, 2)], { claveIdem: 'prueba-dist-2' });

    assert.equal(otra.estado, 200, 'cambia la cantidad: es otra comanda');
    assert.equal((await pedidosDe(m)).length, 2);
  });

  test('la misma comanda en otra mesa no se considera duplicada', async () => {
    const m1 = siguienteMesa();
    const m2 = siguienteMesa();
    const items = [linea(tortilla, 1)];

    await enviar(m1, items, { claveIdem: 'prueba-mesa-1' });
    const otraMesa = await enviar(m2, items, { claveIdem: 'prueba-mesa-2' });

    assert.equal(otraMesa.estado, 200);
    assert.equal((await pedidosDe(m2)).length, 1);
  });

  test('tras anular la comanda, el mismo envío se puede volver a mandar', async () => {
    const m = siguienteMesa();
    const items = [linea(tortilla, 1)];
    const clave = 'prueba-anulada';

    const primera = await enviar(m, items, { claveIdem: clave });
    const id = primera.datos.pedidos[0].id;
    const anulada = await camarero.pedir('DELETE', `/api/pedidos/${id}`, { motivo: 'me equivoqué de mesa' });
    assert.equal(anulada.estado, 200);

    const reenviada = await enviar(m, items, { claveIdem: clave });
    assert.equal(reenviada.estado, 200);
    assert.equal(reenviada.datos.duplicada, false, 'ya no queda nada de aquel envío: se crea de nuevo');
    assert.equal((await pedidosDe(m)).length, 1);
  });

  test('se rechazan las comandas con cantidades o precios imposibles', async () => {
    const m = siguienteMesa();

    const sinItems = await enviar(m, []);
    assert.equal(sinItems.estado, 400);

    const cantidadRara = await enviar(m, [linea(tortilla, 0)]);
    assert.equal(cantidadRara.estado, 400);

    const precioNegativo = await enviar(m, [{ ...linea(tortilla, 1), precio: -5 }]);
    assert.equal(precioNegativo.estado, 400);

    assert.equal((await pedidosDe(m)).length, 0);
  });

  test('marcar LISTO dos veces no rompe nada (también es idempotente)', async () => {
    const m = siguienteMesa();
    const { datos } = await enviar(m, [linea(tortilla, 1)], { claveIdem: 'prueba-listo' });
    const id = datos.pedidos[0].id;

    const uno = await camarero.pedir('POST', `/api/pedidos/${id}/listo`);
    const dos = await camarero.pedir('POST', `/api/pedidos/${id}/listo`);

    assert.equal(uno.estado, 200);
    assert.equal(dos.estado, 200);
    assert.equal(uno.datos.listoEn, dos.datos.listoEn, 'la hora de "listo" no se pisa con el segundo toque');
  });

  test('pasada la ventana de tiempo, la misma comanda vuelve a entrar sola', async () => {
    // Un servidor aparte con una ventana de medio segundo para no esperar 30
    const corto = await arrancarServidor({ VENTANA_DUPLICADOS_MS: '400' });
    try {
      const c = crearCliente(corto.url);
      await c.entrar(PIN_CAMARERO);
      const art = await articulo(c, 'Tortilla de patatas');
      const items = [linea(art, 1)];
      const enviarCorto = (clave) =>
        c.pedir('POST', '/api/pedidos', { zona: 'dentro', mesa: 7, items, claveIdem: clave });

      assert.equal((await enviarCorto('corto-1')).estado, 200);
      assert.equal((await enviarCorto('corto-2')).estado, 409, 'justo después, duplicada');
      await new Promise((r) => setTimeout(r, 600));
      assert.equal((await enviarCorto('corto-3')).estado, 200, 'medio minuto después es otra ronda legítima');
    } finally {
      await corto.cerrar();
    }
  });
});
