// Avisos de stock de cocina y barra hacia el panel del gerente.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { arrancarServidor, crearCliente, PIN_GERENTE, PIN_CAMARERO } = require('./ayuda');

describe('Avisos de stock de cocina y barra', () => {
  let servidor;
  let camarero;
  let gerente;

  before(async () => {
    servidor = await arrancarServidor();
    camarero = crearCliente(servidor.url);
    gerente = crearCliente(servidor.url);
    await camarero.entrar(PIN_CAMARERO);
    await gerente.entrar(PIN_GERENTE);
  });

  after(async () => {
    await servidor.cerrar();
  });

  const avisar = (cliente, datos) => cliente.pedir('POST', '/api/alertas', datos);
  const pendientes = async () => (await gerente.pedir('GET', '/api/alertas')).datos.pendientes;

  test('sin entrar con el código no se puede avisar', async () => {
    const anonimo = crearCliente(servidor.url);
    const r = await avisar(anonimo, { producto: 'Hielo', origen: 'barra', gravedad: 'poco' });
    assert.equal(r.estado, 401);
  });

  test('cocina avisa de que queda poco de algo y le llega al gerente', async () => {
    const r = await avisar(camarero, {
      producto: 'Calamares',
      origen: 'cocina',
      gravedad: 'poco',
      nota: 'para el servicio de mañana no llega',
    });

    assert.equal(r.estado, 200);
    assert.equal(r.datos.estado, 'pendiente');
    assert.equal(r.datos.repetida, false);

    const lista = await pendientes();
    const aviso = lista.find((a) => a.producto === 'Calamares');
    assert.ok(aviso, 'el aviso aparece en el panel');
    assert.equal(aviso.origen, 'cocina');
    assert.equal(aviso.gravedad, 'poco');
    assert.equal(aviso.empleado, 'Camarero', 'queda firmado por quien avisó');
    assert.equal(aviso.nota, 'para el servicio de mañana no llega');
  });

  test('insistir con el mismo producto no llena el panel de avisos repetidos', async () => {
    await avisar(camarero, { producto: 'Calamares', origen: 'cocina', gravedad: 'agotado' });

    const lista = await pendientes();
    const deCalamares = lista.filter((a) => a.producto === 'Calamares' && a.origen === 'cocina');
    assert.equal(deCalamares.length, 1, 'sigue habiendo un solo aviso');
    assert.equal(deCalamares[0].repeticiones, 2, 'pero contabiliza que se ha insistido');
    assert.equal(deCalamares[0].gravedad, 'agotado', 'y sube de "queda poco" a "agotado"');
  });

  test('un aviso de "queda poco" no rebaja uno que ya estaba en "agotado"', async () => {
    await avisar(camarero, { producto: 'Calamares', origen: 'cocina', gravedad: 'poco' });
    const aviso = (await pendientes()).find((a) => a.producto === 'Calamares');
    assert.equal(aviso.gravedad, 'agotado');
  });

  test('barra y cocina son avisos independientes aunque sea el mismo producto', async () => {
    await avisar(camarero, { producto: 'Calamares', origen: 'barra', gravedad: 'poco' });
    const deCalamares = (await pendientes()).filter((a) => a.producto === 'Calamares');
    assert.equal(deCalamares.length, 2, 'uno de cocina y otro de barra');
    assert.deepEqual(deCalamares.map((a) => a.origen).sort(), ['barra', 'cocina']);
  });

  test('la barra puede avisar de sus propios géneros', async () => {
    const r = await avisar(camarero, { producto: 'Tónica', origen: 'barra', gravedad: 'agotado' });
    assert.equal(r.estado, 200);
    assert.equal(r.datos.origen, 'barra');
  });

  test('los avisos mal formados se rechazan', async () => {
    assert.equal((await avisar(camarero, { producto: '  ', origen: 'barra', gravedad: 'poco' })).estado, 400);
    assert.equal((await avisar(camarero, { producto: 'Hielo', origen: 'salon', gravedad: 'poco' })).estado, 400);
    assert.equal((await avisar(camarero, { producto: 'Hielo', origen: 'barra', gravedad: 'meh' })).estado, 400);
  });

  test('el número de avisos pendientes viaja en el estado (para la chapa roja)', async () => {
    const { datos } = await gerente.pedir('GET', '/api/estado');
    assert.equal(datos.alertasPendientes, (await pendientes()).length);
    assert.ok(datos.alertasPendientes > 0);
  });

  test('solo el gerente puede dar un aviso por resuelto', async () => {
    const aviso = (await pendientes()).find((a) => a.producto === 'Tónica');

    const intento = await camarero.pedir('POST', `/api/alertas/${aviso.id}/atendida`);
    assert.equal(intento.estado, 403);

    const resuelto = await gerente.pedir('POST', `/api/alertas/${aviso.id}/atendida`);
    assert.equal(resuelto.estado, 200);
    assert.equal(resuelto.datos.estado, 'atendida');
    assert.equal(resuelto.datos.atendidaPor, 'Gerente');

    const lista = await gerente.pedir('GET', '/api/alertas');
    assert.ok(!lista.datos.pendientes.some((a) => a.id === aviso.id), 'ya no está entre los pendientes');
    assert.ok(lista.datos.atendidas.some((a) => a.id === aviso.id), 'queda en el historial');
  });

  test('el gerente puede borrar un aviso equivocado', async () => {
    const nuevo = await avisar(camarero, { producto: 'Servilletas', origen: 'barra', gravedad: 'poco' });
    const id = nuevo.datos.id;

    assert.equal((await camarero.pedir('DELETE', `/api/alertas/${id}`)).estado, 403);
    assert.equal((await gerente.pedir('DELETE', `/api/alertas/${id}`)).estado, 200);
    assert.ok(!(await pendientes()).some((a) => a.id === id));
  });
});
