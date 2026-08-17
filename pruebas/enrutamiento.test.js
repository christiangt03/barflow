// Reparto de comandas: lo de beber va a la barra, lo de comer a cocina,
// y el aviso de "listo" llega a la sala.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { arrancarServidor, crearCliente, articulo, linea, PIN_CAMARERO } = require('./ayuda');

describe('Enrutamiento de comandas entre cocina y barra', () => {
  let servidor;
  let camarero;
  let cana;
  let tortilla;
  let mesa = 20;

  before(async () => {
    servidor = await arrancarServidor();
    camarero = crearCliente(servidor.url);
    await camarero.entrar(PIN_CAMARERO);
    cana = await articulo(camarero, 'Caña');
    tortilla = await articulo(camarero, 'Tortilla de patatas');
  });

  after(async () => {
    await servidor.cerrar();
  });

  const siguienteMesa = () => ++mesa;
  const enviar = (mesaN, items) =>
    camarero.pedir('POST', '/api/pedidos', {
      zona: 'terraza',
      mesa: mesaN,
      items,
      claveIdem: 'ruta-' + mesaN + '-' + items.length + '-' + Math.random().toString(36).slice(2, 10),
    });

  test('las bebidas de la carta arrancan asignadas a la barra', () => {
    assert.equal(cana.destino, 'barra', 'la caña la pone la barra');
    assert.equal(tortilla.destino, 'cocina', 'la tortilla la hace cocina');
  });

  test('una comanda de solo bebidas va exclusivamente a la barra', async () => {
    const m = siguienteMesa();
    const { estado, datos } = await enviar(m, [linea(cana, 2)]);

    assert.equal(estado, 200);
    assert.equal(datos.pedidos.length, 1, 'una sola comanda');
    assert.equal(datos.pedidos[0].destino, 'barra');
    assert.equal(datos.pedidos[0].items.length, 1);
  });

  test('una comanda de solo comida va a cocina', async () => {
    const m = siguienteMesa();
    const { datos } = await enviar(m, [linea(tortilla, 1)]);

    assert.equal(datos.pedidos.length, 1);
    assert.equal(datos.pedidos[0].destino, 'cocina');
  });

  test('una comanda mixta se parte en dos: comida a cocina y bebida a barra', async () => {
    const m = siguienteMesa();
    const { datos } = await enviar(m, [linea(tortilla, 1), linea(cana, 3)]);

    assert.equal(datos.pedidos.length, 2, 'se separan para que cada pantalla vea lo suyo');
    const cocina = datos.pedidos.find((p) => p.destino === 'cocina');
    const barra = datos.pedidos.find((p) => p.destino === 'barra');
    assert.ok(cocina && barra);
    assert.equal(cocina.grupo, barra.grupo, 'las dos partes quedan enlazadas por el grupo');
    assert.deepEqual(cocina.items.map((i) => i.nombre), ['Tortilla de patatas']);
    assert.deepEqual(barra.items.map((i) => i.nombre), ['Caña']);
    assert.equal(barra.items[0].cantidad, 3);
  });

  test('el menú del día siempre lo prepara cocina', async () => {
    const m = siguienteMesa();
    const { datos } = await enviar(m, [
      { nombre: 'Menú del día (2 platos)', precio: 14.5, cantidad: 1, detalle: 'Lentejas · Pollo asado' },
    ]);

    assert.equal(datos.pedidos.length, 1);
    assert.equal(datos.pedidos[0].destino, 'cocina');
  });

  test('el destino lo decide el servidor: no vale falsearlo desde el móvil', async () => {
    const m = siguienteMesa();
    const { datos } = await camarero.pedir('POST', '/api/pedidos', {
      zona: 'terraza',
      mesa: m,
      claveIdem: 'ruta-falsificada',
      // Un cliente manipulado intenta colar la tortilla como bebida
      items: [{ ...linea(tortilla, 1), destino: 'barra' }],
    });

    assert.equal(datos.pedidos.length, 1);
    assert.equal(datos.pedidos[0].destino, 'cocina');
  });

  test('si el gerente pasa un artículo a barra, las comandas siguientes le hacen caso', async () => {
    const gerente = crearCliente(servidor.url);
    await gerente.entrar('1234');
    const cambiado = await gerente.pedir('PUT', `/api/articulos/${tortilla.id}`, { destino: 'barra' });
    assert.equal(cambiado.estado, 200);
    assert.equal(cambiado.datos.destino, 'barra');

    const m = siguienteMesa();
    const { datos } = await enviar(m, [linea(tortilla, 1)]);
    assert.equal(datos.pedidos[0].destino, 'barra');

    await gerente.pedir('PUT', `/api/articulos/${tortilla.id}`, { destino: 'cocina' }); // se deja como estaba
  });

  test('flujo completo de bebidas: pendiente → listo (aviso a sala) → recogido', async () => {
    const m = siguienteMesa();
    const { datos } = await enviar(m, [linea(cana, 2)]);
    const pedido = datos.pedidos[0];
    assert.equal(pedido.estado, 'pendiente');

    // Recoger algo que aún no está listo no debe colar
    const pronto = await camarero.pedir('POST', `/api/pedidos/${pedido.id}/recogido`);
    assert.equal(pronto.estado, 400);

    const listo = await camarero.pedir('POST', `/api/pedidos/${pedido.id}/listo`);
    assert.equal(listo.datos.estado, 'listo');
    assert.ok(listo.datos.listoEn, 'queda la hora en que la barra avisó');

    const recogido = await camarero.pedir('POST', `/api/pedidos/${pedido.id}/recogido`);
    assert.equal(recogido.datos.estado, 'servido');

    // Repetir la confirmación no rompe nada
    const otraVez = await camarero.pedir('POST', `/api/pedidos/${pedido.id}/recogido`);
    assert.equal(otraVez.estado, 200);
    assert.equal(otraVez.datos.estado, 'servido');
  });

  test('la cuenta de la mesa suma las dos partes de una comanda mixta', async () => {
    const m = siguienteMesa();
    await enviar(m, [linea(tortilla, 1), linea(cana, 2)]);

    const cobro = await camarero.pedir('POST', '/api/mesas/cobrar', {
      zona: 'terraza',
      mesa: m,
      metodoPago: 'efectivo',
    });
    assert.equal(cobro.estado, 200);
    assert.equal(cobro.datos.total, Number((tortilla.precio + cana.precio * 2).toFixed(2)));
    assert.equal(cobro.datos.pedidos.length, 2, 'se cierran las dos comandas de la mesa');
  });
});
