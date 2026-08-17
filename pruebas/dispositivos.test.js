// Aparatos del bar: el gerente los da de alta y autoriza, y solo los
// autorizados pueden usar la app.
//
// Ojo: el servidor deja pasar siempre las peticiones que vienen del propio
// ordenador del bar (127.0.0.1), para que nadie se quede fuera al configurar.
// Como las pruebas hablan por 127.0.0.1, se usa la IP de la red para simular
// una tablet "de fuera".

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const { arrancarServidor, crearCliente, PIN_GERENTE, PIN_CAMARERO } = require('./ayuda');

function ipDeRed() {
  for (const redes of Object.values(os.networkInterfaces())) {
    for (const r of redes) if (r.family === 'IPv4' && !r.internal) return r.address;
  }
  return null;
}

describe('Dispositivos del bar', () => {
  let servidor;
  let urlTablet; // la app vista desde una tablet de la WiFi
  let gerente;
  let tablet; // hace de tablet del camarero

  before(async () => {
    servidor = await arrancarServidor();
    const ip = ipDeRed();
    urlTablet = ip ? servidor.url.replace('127.0.0.1', ip) : servidor.url;
    gerente = crearCliente(servidor.url); // el gerente, desde el ordenador del bar
    await gerente.entrar(PIN_GERENTE);
    tablet = crearCliente(urlTablet);
    await tablet.entrar(PIN_CAMARERO);
  });

  after(async () => {
    await servidor.cerrar();
  });

  const hayRed = () => !!ipDeRed();

  test('el gerente da de alta los aparatos con su nombre', async () => {
    const r = await gerente.pedir('POST', '/api/dispositivos', { nombre: 'Tablet 1' });
    assert.equal(r.estado, 200);
    assert.equal(r.datos.nombre, 'Tablet 1');
    assert.equal(r.datos.estado, 'libre', 'nace sin aparato asignado');

    await gerente.pedir('POST', '/api/dispositivos', { nombre: 'Tablet 2' });
    const lista = (await gerente.pedir('GET', '/api/dispositivos')).datos;
    assert.deepEqual(lista.map((d) => d.nombre).sort(), ['Tablet 1', 'Tablet 2']);
  });

  test('no se repiten nombres ni se aceptan vacíos', async () => {
    assert.equal((await gerente.pedir('POST', '/api/dispositivos', { nombre: 'tablet 1' })).estado, 400);
    assert.equal((await gerente.pedir('POST', '/api/dispositivos', { nombre: '   ' })).estado, 400);
  });

  test('un camarero no puede dar de alta ni autorizar aparatos', async () => {
    const desdeElBar = crearCliente(servidor.url);
    await desdeElBar.entrar(PIN_CAMARERO);
    assert.equal((await desdeElBar.pedir('POST', '/api/dispositivos', { nombre: 'Mi móvil' })).estado, 403);
    const uno = (await gerente.pedir('GET', '/api/dispositivos')).datos[0];
    assert.equal((await desdeElBar.pedir('PUT', `/api/dispositivos/${uno.id}`, { estado: 'autorizado' })).estado, 403);
  });

  test('una tablet sin identificar no puede tomar comandas', async (t) => {
    if (!hayRed()) return t.skip('sin red local para simular una tablet');
    const r = await tablet.pedir('POST', '/api/pedidos', {
      zona: 'dentro', mesa: 1, items: [{ nombre: 'Caña', precio: 2, cantidad: 1 }],
    });
    assert.equal(r.estado, 403);
    assert.equal(r.datos.codigo, 'dispositivo-no-autorizado');
    assert.equal(r.datos.estadoDispositivo, 'sin-identificar');
  });

  test('la tablet ve los aparatos libres y dice cuál es', async (t) => {
    if (!hayRed()) return t.skip('sin red local');
    const libres = (await tablet.pedir('GET', '/api/dispositivos/disponibles')).datos;
    assert.equal(libres.length, 2);

    const tablet1 = libres.find((d) => d.nombre === 'Tablet 1');
    const r = await tablet.pedir('POST', `/api/dispositivos/${tablet1.id}/vincular`);
    assert.equal(r.estado, 200);
    assert.equal(r.datos.estado, 'pendiente', 'queda esperando el visto bueno del gerente');

    const mio = (await tablet.pedir('GET', '/api/dispositivos/mio')).datos;
    assert.equal(mio.dispositivo.nombre, 'Tablet 1');
    assert.equal(mio.dispositivo.estado, 'pendiente');
  });

  test('mientras está pendiente sigue sin poder tomar comandas', async (t) => {
    if (!hayRed()) return t.skip('sin red local');
    const r = await tablet.pedir('POST', '/api/pedidos', {
      zona: 'dentro', mesa: 1, items: [{ nombre: 'Caña', precio: 2, cantidad: 1 }],
    });
    assert.equal(r.estado, 403);
    assert.equal(r.datos.estadoDispositivo, 'pendiente');
    assert.match(r.datos.error, /Tablet 1/);
  });

  test('ese aparato ya no aparece como libre para otra tablet', async (t) => {
    if (!hayRed()) return t.skip('sin red local');
    const libres = (await tablet.pedir('GET', '/api/dispositivos/disponibles')).datos;
    assert.deepEqual(libres.map((d) => d.nombre), ['Tablet 2']);
    const tablet1 = (await gerente.pedir('GET', '/api/dispositivos')).datos.find((d) => d.nombre === 'Tablet 1');
    assert.equal((await tablet.pedir('POST', `/api/dispositivos/${tablet1.id}/vincular`)).estado, 400);
  });

  test('en cuanto el gerente lo autoriza, la tablet trabaja con normalidad', async (t) => {
    if (!hayRed()) return t.skip('sin red local');
    const tablet1 = (await gerente.pedir('GET', '/api/dispositivos')).datos.find((d) => d.nombre === 'Tablet 1');
    const ok = await gerente.pedir('PUT', `/api/dispositivos/${tablet1.id}`, { estado: 'autorizado' });
    assert.equal(ok.estado, 200);

    const r = await tablet.pedir('POST', '/api/pedidos', {
      zona: 'dentro', mesa: 1, claveIdem: 'disp-prueba-1',
      items: [{ nombre: 'Caña', precio: 2, cantidad: 1 }],
    });
    assert.equal(r.estado, 200);
    assert.equal(r.datos.pedidos[0].dispositivo, 'Tablet 1', 'la comanda queda firmada por el aparato');
  });

  test('el cobro y el aviso de stock también quedan firmados por el aparato', async (t) => {
    if (!hayRed()) return t.skip('sin red local');
    const cobro = await tablet.pedir('POST', '/api/mesas/cobrar', {
      zona: 'dentro', mesa: 1, metodoPago: 'efectivo',
    });
    assert.equal(cobro.estado, 200);
    assert.equal(cobro.datos.dispositivo, 'Tablet 1');

    await tablet.pedir('POST', '/api/alertas', { producto: 'Hielo', origen: 'barra', gravedad: 'poco' });
    const alerta = (await gerente.pedir('GET', '/api/alertas')).datos.pendientes.find((a) => a.producto === 'Hielo');
    assert.equal(alerta.dispositivo, 'Tablet 1');
  });

  test('el informe Z desglosa lo cobrado por aparato', async (t) => {
    if (!hayRed()) return t.skip('sin red local');
    const informe = (await gerente.pedir('POST', '/api/caja/cierre')).datos;
    const linea = informe.porDispositivo.find((d) => d.nombre === 'Tablet 1');
    assert.ok(linea, JSON.stringify(informe.porDispositivo));
    assert.equal(linea.mesas, 1);
    assert.equal(linea.total, 2);
  });

  test('el gerente anota quién y cuándo usó cada aparato', async (t) => {
    if (!hayRed()) return t.skip('sin red local');
    const tablet1 = (await gerente.pedir('GET', '/api/dispositivos')).datos.find((d) => d.nombre === 'Tablet 1');
    assert.equal(tablet1.ultimoEmpleado, 'Camarero');
    assert.ok(tablet1.ultimoUso, 'queda la hora del último uso');
  });

  test('al bloquear el aparato deja de funcionar al instante', async (t) => {
    if (!hayRed()) return t.skip('sin red local');
    const tablet1 = (await gerente.pedir('GET', '/api/dispositivos')).datos.find((d) => d.nombre === 'Tablet 1');
    await gerente.pedir('PUT', `/api/dispositivos/${tablet1.id}`, { estado: 'bloqueado' });

    const r = await tablet.pedir('POST', '/api/pedidos', {
      zona: 'dentro', mesa: 2, items: [{ nombre: 'Caña', precio: 2, cantidad: 1 }],
    });
    assert.equal(r.estado, 403);
    assert.match(r.datos.error, /bloqueado/);

    await gerente.pedir('PUT', `/api/dispositivos/${tablet1.id}`, { estado: 'autorizado' }); // se deja como estaba
  });

  test('al desvincularlo, el aparato tiene que volver a identificarse', async (t) => {
    if (!hayRed()) return t.skip('sin red local');
    const tablet1 = (await gerente.pedir('GET', '/api/dispositivos')).datos.find((d) => d.nombre === 'Tablet 1');
    await gerente.pedir('PUT', `/api/dispositivos/${tablet1.id}`, { estado: 'libre' });

    const mio = (await tablet.pedir('GET', '/api/dispositivos/mio')).datos;
    assert.equal(mio.dispositivo, null, 'la ficha vieja ya no vale');
    const libres = (await tablet.pedir('GET', '/api/dispositivos/disponibles')).datos;
    assert.ok(libres.some((d) => d.nombre === 'Tablet 1'), 'vuelve a estar disponible');
  });

  test('el ordenador del bar funciona sin identificarse (para poder configurar)', async () => {
    const desdeElBar = crearCliente(servidor.url);
    await desdeElBar.entrar(PIN_CAMARERO);
    const r = await desdeElBar.pedir('POST', '/api/pedidos', {
      zona: 'dentro', mesa: 3, claveIdem: 'disp-puesto-bar',
      items: [{ nombre: 'Caña', precio: 2, cantidad: 1 }],
    });
    assert.equal(r.estado, 200);
    assert.equal(r.datos.pedidos[0].dispositivo, 'Puesto del bar');
  });

  test('el gerente nunca se queda fuera aunque su aparato no esté autorizado', async (t) => {
    if (!hayRed()) return t.skip('sin red local');
    const gerenteFuera = crearCliente(urlTablet);
    await gerenteFuera.entrar(PIN_GERENTE);
    assert.equal((await gerenteFuera.pedir('GET', '/api/dispositivos')).estado, 200);
  });
});
