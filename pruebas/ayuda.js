// Utilidades para las pruebas: levantan el servidor de verdad sobre una base de
// datos temporal (nunca sobre data/bar.db) y hablan con él por HTTP.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

// Pide al sistema un puerto libre
function puertoLibre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function esperarA(url, milisegundos = 15000) {
  const limite = Date.now() + milisegundos;
  while (Date.now() < limite) {
    try {
      await fetch(url);
      return true;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('El servidor de pruebas no arrancó a tiempo');
}

async function arrancarServidor(variables = {}) {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'bar-pruebas-'));
  const puerto = await puertoLibre();
  const proceso = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      BAR_DATOS: carpeta,
      PUERTO: String(puerto),
      // Los códigos reales se generan al azar; en las pruebas se fijan
      PIN_GERENTE_INICIAL: PIN_GERENTE,
      PIN_CAMARERO_INICIAL: PIN_CAMARERO,
      NOMBRE_LOCAL: 'Bar de pruebas',
      DIRECCION_LOCAL: '',
      ...variables,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const salida = [];
  proceso.stdout.on('data', (d) => salida.push(String(d)));
  proceso.stderr.on('data', (d) => salida.push(String(d)));
  const url = `http://127.0.0.1:${puerto}`;
  try {
    await esperarA(url + '/api/estado');
  } catch (e) {
    proceso.kill();
    throw new Error(e.message + '\n' + salida.join(''));
  }
  return {
    url,
    salida,
    async cerrar() {
      proceso.kill();
      await new Promise((r) => proceso.on('exit', r));
      fs.rmSync(carpeta, { recursive: true, force: true });
    },
  };
}

// Cliente HTTP que guarda las cookies (sesión y aparato), como hace el navegador
function crearCliente(url) {
  const galletas = new Map(); // nombre -> valor
  const cabeceraCookie = () =>
    [...galletas].map(([n, v]) => `${n}=${v}`).join('; ');
  return {
    get cookie() {
      return cabeceraCookie() || null;
    },
    async pedir(metodo, ruta, cuerpo) {
      const res = await fetch(url + ruta, {
        method: metodo,
        headers: {
          'Content-Type': 'application/json',
          ...(galletas.size ? { Cookie: cabeceraCookie() } : {}),
        },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      });
      const nuevas = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of nuevas) {
        const [par] = c.split(';');
        const igual = par.indexOf('=');
        const nombre = par.slice(0, igual).trim();
        const valor = par.slice(igual + 1);
        if (valor === '' || /Max-Age=0/i.test(c)) galletas.delete(nombre);
        else galletas.set(nombre, valor);
      }
      let datos = null;
      try {
        datos = await res.json();
      } catch (e) {
        /* respuesta sin cuerpo */
      }
      return { estado: res.status, datos };
    },
    async entrar(pin) {
      const r = await this.pedir('POST', '/api/login', { pin });
      if (r.estado !== 200) throw new Error('No se pudo entrar con el código ' + pin);
      return r.datos;
    },
  };
}

// Códigos que se le fijan al servidor de pruebas (en la vida real son al azar)
const PIN_GERENTE = '1234';
const PIN_CAMARERO = '1111';

// Busca en la carta un artículo por nombre (para no depender de los ids)
async function articulo(cliente, nombre) {
  const { datos } = await cliente.pedir('GET', '/api/estado');
  const encontrado = datos.articulos.find((a) => a.nombre === nombre);
  if (!encontrado) throw new Error('No está en la carta: ' + nombre);
  return encontrado;
}

function linea(art, cantidad = 1, extra = {}) {
  return { articuloId: art.id, nombre: art.nombre, precio: art.precio, cantidad, ...extra };
}

module.exports = { arrancarServidor, crearCliente, articulo, linea, PIN_GERENTE, PIN_CAMARERO };
