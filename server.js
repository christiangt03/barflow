const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { Server } = require('socket.io');

// ---------- Ajustes del local (fichero .env, opcional) ----------
// Ahí van el nombre del bar y demás datos propios, para que no vivan en el
// código. Si no existe el .env, se usan valores genéricos y todo funciona igual.

function cargarAjustes() {
  const ruta = path.join(__dirname, '.env');
  if (!fs.existsSync(ruta)) return;
  for (const linea of fs.readFileSync(ruta, 'utf8').split(/\r?\n/)) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith('#')) continue;
    const corte = limpia.indexOf('=');
    if (corte < 1) continue;
    const clave = limpia.slice(0, corte).trim();
    let valor = limpia.slice(corte + 1).trim();
    if (/^".*"$/.test(valor) || /^'.*'$/.test(valor)) valor = valor.slice(1, -1);
    if (process.env[clave] === undefined) process.env[clave] = valor; // manda el entorno
  }
}

cargarAjustes();

const PUERTO = process.env.PUERTO || 3000;
// Carpeta de datos: se puede cambiar con BAR_DATOS para las pruebas automáticas
const DIR_DATOS = process.env.BAR_DATOS || path.join(__dirname, 'data');
const RUTA_BD = path.join(DIR_DATOS, 'bar.db');
const RUTA_JSON_ANTIGUO = path.join(DIR_DATOS, 'db.json');
const RUTA_SEMILLA = path.join(__dirname, 'data', 'semilla.json');

// ---------- Base de datos (SQLite, incluida en Node) ----------

fs.mkdirSync(DIR_DATOS, { recursive: true });
const bd = new DatabaseSync(RUTA_BD);
bd.exec('PRAGMA journal_mode = WAL'); // resiste cortes de luz sin corromperse
bd.exec(`
  CREATE TABLE IF NOT EXISTS meta (clave TEXT PRIMARY KEY, valor TEXT);
  CREATE TABLE IF NOT EXISTS articulos (
    id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, categoria TEXT, precio REAL,
    tipo TEXT NOT NULL, subtipo TEXT, disponible INTEGER NOT NULL DEFAULT 1, motivo TEXT
  );
  CREATE TABLE IF NOT EXISTS empleados (
    id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, rol TEXT NOT NULL, sal TEXT NOT NULL, hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sesiones (token TEXT PRIMARY KEY, empleadoId INTEGER NOT NULL, creado TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS pedidos (
    id INTEGER PRIMARY KEY, zona TEXT NOT NULL, mesa INTEGER NOT NULL, items TEXT NOT NULL,
    camarero TEXT, estado TEXT NOT NULL, creado TEXT NOT NULL, listoEn TEXT
  );
  CREATE TABLE IF NOT EXISTS historial (
    id INTEGER PRIMARY KEY, zona TEXT NOT NULL, mesa INTEGER NOT NULL, metodoPago TEXT NOT NULL,
    total REAL NOT NULL, pedidos TEXT NOT NULL, cobradoPor TEXT, cobrado TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_historial_cobrado ON historial (cobrado);
  CREATE TABLE IF NOT EXISTS anulaciones (
    id INTEGER PRIMARY KEY, pedido TEXT NOT NULL, motivo TEXT NOT NULL, anuladoPor TEXT NOT NULL, fecha TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cierresCaja (
    id INTEGER PRIMARY KEY, numero INTEGER NOT NULL, dia TEXT NOT NULL,
    datos TEXT NOT NULL, cerradoPor TEXT NOT NULL, fecha TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS almacenProductos (
    id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, categoria TEXT, unidad TEXT, cantidad REAL NOT NULL, minimo REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS almacenMovimientos (
    id INTEGER PRIMARY KEY, productoId INTEGER, producto TEXT, tipo TEXT NOT NULL, cantidad REAL NOT NULL,
    antes REAL NOT NULL, despues REAL NOT NULL, motivo TEXT, empleado TEXT NOT NULL, fecha TEXT NOT NULL
  );
  -- Un apunte por cada envío de comanda aceptado. Es lo que impide que el mismo
  -- envío entre dos veces (clave de idempotencia) y lo que detecta los dobles clics
  -- (huella del contenido). Una comanda mixta genera varios pedidos con un solo apunte.
  CREATE TABLE IF NOT EXISTS comandasEnviadas (
    claveIdem TEXT PRIMARY KEY, grupo INTEGER NOT NULL, huella TEXT NOT NULL,
    zona TEXT NOT NULL, mesa INTEGER NOT NULL, empleado TEXT, creado TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_envios_huella ON comandasEnviadas (huella, creado);
  -- Avisos de "queda poco / se acabó" que mandan cocina y barra al gerente
  CREATE TABLE IF NOT EXISTS alertasStock (
    id INTEGER PRIMARY KEY, producto TEXT NOT NULL, productoId INTEGER, origen TEXT NOT NULL,
    gravedad TEXT NOT NULL, nota TEXT, empleado TEXT NOT NULL, creado TEXT NOT NULL,
    repeticiones INTEGER NOT NULL DEFAULT 1, estado TEXT NOT NULL DEFAULT 'pendiente',
    atendidaPor TEXT, atendida TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_alertas_estado ON alertasStock (estado, id);
  -- Aparatos del bar (Tablet 1, Barra, Cocina...). El gerente los da de alta y
  -- autoriza; cada aparato guarda su ficha en una cookie de larga duración.
  CREATE TABLE IF NOT EXISTS dispositivos (
    id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'libre',
    ficha TEXT, creado TEXT NOT NULL, vinculado TEXT, ultimoUso TEXT, ultimoEmpleado TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_dispositivos_ficha ON dispositivos (ficha) WHERE ficha IS NOT NULL;
`);

// Añade una columna a una tabla ya creada si todavía no existe (bases de datos antiguas)
function asegurarColumna(tabla, columna, definicion) {
  const columnas = bd.prepare(`PRAGMA table_info(${tabla})`).all();
  if (columnas.some((c) => c.name === columna)) return false;
  bd.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
  return true;
}

// 'cocina' o 'barra': quién prepara cada artículo y adónde va la comanda
asegurarColumna('articulos', 'destino', "TEXT NOT NULL DEFAULT 'cocina'");
asegurarColumna('pedidos', 'destino', "TEXT NOT NULL DEFAULT 'cocina'");
// Comandas hermanas nacidas del mismo envío (parte de comida + parte de bebida)
asegurarColumna('pedidos', 'grupo', 'INTEGER');
bd.exec('CREATE INDEX IF NOT EXISTS idx_pedidos_grupo ON pedidos (grupo)');

// Desde qué aparato del bar se hizo cada cosa (Tablet 1, Barra...)
asegurarColumna('pedidos', 'dispositivo', 'TEXT');
asegurarColumna('historial', 'dispositivo', 'TEXT');
asegurarColumna('alertasStock', 'dispositivo', 'TEXT');

function enTransaccion(fn) {
  bd.exec('BEGIN');
  try {
    const r = fn();
    bd.exec('COMMIT');
    return r;
  } catch (e) {
    bd.exec('ROLLBACK');
    throw e;
  }
}

function metaGet(clave, defecto) {
  const fila = bd.prepare('SELECT valor FROM meta WHERE clave = ?').get(clave);
  return fila ? JSON.parse(fila.valor) : defecto;
}

function metaSet(clave, valor) {
  bd.prepare(
    'INSERT INTO meta (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor'
  ).run(clave, JSON.stringify(valor));
}

function nuevoId() {
  const id = metaGet('siguienteId', 100) + 1;
  metaSet('siguienteId', id);
  return id;
}

function redondear(n) {
  return Math.round(n * 100) / 100;
}

function hashPin(pin, sal) {
  return crypto.createHash('sha256').update(sal + ':' + pin).digest('hex');
}

// ----- Primera vez: importa el db.json antiguo o siembra desde la semilla -----

// Códigos creados en la primera puesta en marcha, para enseñarlos por pantalla
let pinesRecienCreados = [];

function importarDatos() {
  if (bd.prepare('SELECT COUNT(*) AS n FROM empleados').get().n > 0) return;
  const hayJsonAntiguo = fs.existsSync(RUTA_JSON_ANTIGUO);
  const datos = JSON.parse(fs.readFileSync(hayJsonAntiguo ? RUTA_JSON_ANTIGUO : RUTA_SEMILLA, 'utf8'));
  const semilla = JSON.parse(fs.readFileSync(RUTA_SEMILLA, 'utf8'));

  // Nombre y dirección del local: del .env si está, si no lo que traiga la semilla
  datos.config.nombre = process.env.NOMBRE_LOCAL || datos.config.nombre;
  if (process.env.DIRECCION_LOCAL !== undefined) datos.config.direccion = process.env.DIRECCION_LOCAL;

  // Códigos de la primera vez: se sacan del .env o se inventan al azar, para que
  // no haya ninguna contraseña escrita en el código.
  const pinGerente = process.env.PIN_GERENTE_INICIAL || String(crypto.randomInt(1000, 10000));
  const pinCamarero = process.env.PIN_CAMARERO_INICIAL || String(crypto.randomInt(1000, 10000));
  datos.empleados ||= [
    { id: 90, nombre: 'Gerente', rol: 'gerente', pin: pinGerente },
    { id: 91, nombre: 'Camarero', rol: 'camarero', pin: pinCamarero },
  ];
  pinesRecienCreados = datos.empleados
    .filter((e) => e.pin)
    .map((e) => ({ nombre: e.nombre, rol: e.rol, pin: e.pin }));
  datos.almacen ||= semilla.almacen || { productos: [], movimientos: [] };
  datos.anulaciones ||= [];
  datos.sesiones ||= {};
  for (const e of datos.empleados) {
    if (e.pin) {
      e.sal = crypto.randomBytes(8).toString('hex');
      e.hash = hashPin(e.pin, e.sal);
      delete e.pin;
    }
  }

  enTransaccion(() => {
    metaSet('config', datos.config);
    metaSet('siguienteId', datos.siguienteId || 100);
    for (const a of datos.articulos || []) {
      bd.prepare(
        'INSERT INTO articulos (id, nombre, categoria, precio, tipo, subtipo, disponible, motivo) VALUES (?,?,?,?,?,?,?,?)'
      ).run(a.id, a.nombre, a.categoria ?? '', a.precio ?? 0, a.tipo, a.subtipo ?? null, a.disponible ? 1 : 0, a.motivo ?? '');
    }
    for (const e of datos.empleados) {
      bd.prepare('INSERT INTO empleados (id, nombre, rol, sal, hash) VALUES (?,?,?,?,?)').run(e.id, e.nombre, e.rol, e.sal, e.hash);
    }
    for (const [token, s] of Object.entries(datos.sesiones)) {
      bd.prepare('INSERT INTO sesiones (token, empleadoId, creado) VALUES (?,?,?)').run(token, s.empleadoId, s.creado);
    }
    for (const p of datos.pedidos || []) {
      bd.prepare(
        'INSERT INTO pedidos (id, zona, mesa, items, camarero, estado, creado, listoEn) VALUES (?,?,?,?,?,?,?,?)'
      ).run(p.id, p.zona, p.mesa, JSON.stringify(p.items), p.camarero ?? null, p.estado, p.creado, p.listoEn ?? null);
    }
    for (const c of datos.historial || []) {
      bd.prepare(
        'INSERT INTO historial (id, zona, mesa, metodoPago, total, pedidos, cobradoPor, cobrado) VALUES (?,?,?,?,?,?,?,?)'
      ).run(c.id, c.zona, c.mesa, c.metodoPago, c.total, JSON.stringify(c.pedidos), c.cobradoPor ?? null, c.cobrado);
    }
    for (const a of datos.anulaciones) {
      bd.prepare('INSERT INTO anulaciones (id, pedido, motivo, anuladoPor, fecha) VALUES (?,?,?,?,?)').run(
        a.id, JSON.stringify(a.pedido), a.motivo, a.anuladoPor, a.fecha
      );
    }
    for (const p of datos.almacen.productos || []) {
      bd.prepare(
        'INSERT INTO almacenProductos (id, nombre, categoria, unidad, cantidad, minimo) VALUES (?,?,?,?,?,?)'
      ).run(p.id, p.nombre, p.categoria ?? 'General', p.unidad ?? 'uds', p.cantidad ?? 0, p.minimo ?? 0);
    }
    for (const m of datos.almacen.movimientos || []) {
      bd.prepare(
        'INSERT INTO almacenMovimientos (id, productoId, producto, tipo, cantidad, antes, despues, motivo, empleado, fecha) VALUES (?,?,?,?,?,?,?,?,?,?)'
      ).run(m.id, m.productoId ?? null, m.producto ?? '', m.tipo, m.cantidad, m.antes, m.despues, m.motivo ?? '', m.empleado, m.fecha);
    }
  });

  if (hayJsonAntiguo) {
    fs.renameSync(RUTA_JSON_ANTIGUO, RUTA_JSON_ANTIGUO + '.migrado');
    console.log('  Datos migrados de db.json a SQLite (data/bar.db).');
    console.log('  El fichero antiguo queda de copia como data/db.json.migrado');
  }
}

importarDatos();

// ----- Reparto inicial cocina / barra -----
// La primera vez que arranca esta versión, todo lo que suene a bebida pasa a
// prepararlo la barra. A partir de ahí lo cambia el gerente artículo por artículo.

const CATEGORIAS_DE_BARRA = /bebida|caf[eé]|refresco|copa|vino|cerveza|licor|coctel|c[oó]ctel|infusi[oó]n/i;

function repartirDestinosLaPrimeraVez() {
  if (metaGet('destinosRepartidos', false)) return;
  // SQLite de Node no trae REGEXP, así que el reparto se decide en JavaScript
  let n = 0;
  for (const a of bd.prepare("SELECT id, categoria, nombre FROM articulos WHERE tipo = 'carta'").all()) {
    if (CATEGORIAS_DE_BARRA.test(a.categoria || '') || CATEGORIAS_DE_BARRA.test(a.nombre || '')) {
      bd.prepare("UPDATE articulos SET destino = 'barra' WHERE id = ?").run(a.id);
      n++;
    }
  }
  metaSet('destinosRepartidos', true);
  if (n) console.log(`  ${n} artículos de la carta pasan a prepararse en la barra (se puede cambiar en Administración).`);
}

repartirDestinosLaPrimeraVez();

// ----- Copias de seguridad automáticas -----
// Cada día se guarda una copia de la base de datos en data/copias
// (bar-AAAA-MM-DD.db) y se conservan las últimas 14.

const RUTA_COPIAS = path.join(__dirname, 'data', 'copias');
const COPIAS_A_CONSERVAR = 14;

function copiaSeguridad() {
  try {
    const hoy = new Date().toISOString().slice(0, 10);
    const destino = path.join(RUTA_COPIAS, `bar-${hoy}.db`);
    if (fs.existsSync(destino)) return; // la de hoy ya está hecha
    fs.mkdirSync(RUTA_COPIAS, { recursive: true });
    // VACUUM INTO crea una copia íntegra y compacta sin parar el servidor
    bd.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
    const copias = fs
      .readdirSync(RUTA_COPIAS)
      .filter((f) => /^bar-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .sort();
    for (const f of copias.slice(0, -COPIAS_A_CONSERVAR)) {
      fs.unlinkSync(path.join(RUTA_COPIAS, f));
    }
    console.log(`  Copia de seguridad del día guardada en data/copias/bar-${hoy}.db`);
  } catch (e) {
    console.error('  ⚠️ No se pudo hacer la copia de seguridad:', e.message);
  }
}

copiaSeguridad();
setInterval(copiaSeguridad, 60 * 60 * 1000); // cada hora mira si toca la del día

// ----- Lecturas habituales -----

function todosArticulos() {
  return bd.prepare('SELECT * FROM articulos ORDER BY id').all().map((a) => ({ ...a, disponible: !!a.disponible }));
}

function todosPedidos() {
  return bd.prepare('SELECT * FROM pedidos ORDER BY id').all().map((p) => ({ ...p, items: JSON.parse(p.items) }));
}

function pedidoPorId(id) {
  const fila = bd.prepare('SELECT * FROM pedidos WHERE id = ?').get(Number(id));
  return fila ? { ...fila, items: JSON.parse(fila.items) } : null;
}

// ---------- Servidor ----------

const app = express();
const servidor = http.createServer(app);
const io = new Server(servidor);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Estado que ven todos los clientes (camareros, cocina, admin)
function estado() {
  return {
    config: metaGet('config'),
    articulos: todosArticulos(),
    pedidos: todosPedidos(),
    // Para la chapa de avisos pendientes en Administración
    alertasPendientes: bd.prepare("SELECT COUNT(*) AS n FROM alertasStock WHERE estado = 'pendiente'").get().n,
  };
}

function difundir() {
  io.emit('estado', estado());
}

// ---------- Sesiones (código personal de cada empleado) ----------

const DURACION_SESION = 20 * 60 * 60 * 1000; // 20 horas: cada día hay que volver a entrar

function limpiarSesionesCaducadas() {
  const limite = new Date(Date.now() - DURACION_SESION).toISOString();
  bd.prepare('DELETE FROM sesiones WHERE creado < ?').run(limite);
}

function empleadoDeSesion(cookieHeader) {
  const m = /(?:^|;\s*)sesion=([a-f0-9]{32,})/.exec(cookieHeader || '');
  if (!m) return null;
  const s = bd.prepare('SELECT * FROM sesiones WHERE token = ?').get(m[1]);
  if (!s || Date.now() - new Date(s.creado).getTime() > DURACION_SESION) return null;
  return bd.prepare('SELECT * FROM empleados WHERE id = ?').get(s.empleadoId) || null;
}

// Nombre del local para la pantalla de entrada (todavía no hay sesión)
app.get('/api/local', (req, res) => {
  const config = metaGet('config') || {};
  res.json({ nombre: config.nombre || 'Bar', direccion: config.direccion || '' });
});

// Bloqueo tras varios PIN fallidos (por dirección IP)
const intentosFallidos = new Map(); // ip -> { fallos, bloqueadoHasta }

app.post('/api/login', (req, res) => {
  const ip = req.socket.remoteAddress;
  const intento = intentosFallidos.get(ip) || { fallos: 0, bloqueadoHasta: 0 };
  if (Date.now() < intento.bloqueadoHasta) {
    const seg = Math.ceil((intento.bloqueadoHasta - Date.now()) / 1000);
    return res.status(429).json({ error: `Demasiados intentos. Espera ${seg} segundos.` });
  }
  const pin = String(req.body.pin || '');
  const empleado = bd.prepare('SELECT * FROM empleados').all().find((e) => e.hash === hashPin(pin, e.sal));
  if (!/^\d{4,6}$/.test(pin) || !empleado) {
    intento.fallos++;
    if (intento.fallos >= 5) {
      intento.bloqueadoHasta = Date.now() + 60 * 1000;
      intento.fallos = 0;
    }
    intentosFallidos.set(ip, intento);
    return res.status(401).json({ error: 'Código incorrecto' });
  }
  intentosFallidos.delete(ip);
  limpiarSesionesCaducadas();
  const token = crypto.randomBytes(24).toString('hex');
  bd.prepare('INSERT INTO sesiones (token, empleadoId, creado) VALUES (?,?,?)').run(
    token, empleado.id, new Date().toISOString()
  );
  res.setHeader(
    'Set-Cookie',
    `sesion=${token}; HttpOnly; Path=/; Max-Age=${DURACION_SESION / 1000}; SameSite=Lax`
  );
  res.json({ nombre: empleado.nombre, rol: empleado.rol });
});

// Todo lo demás de /api requiere haber entrado con el código
app.use('/api', (req, res, next) => {
  const empleado = empleadoDeSesion(req.headers.cookie);
  if (!empleado) return res.status(401).json({ error: 'Tienes que entrar con tu código' });
  req.empleado = empleado;
  next();
});

function soloGerente(req, res, next) {
  if (req.empleado.rol !== 'gerente') {
    return res.status(403).json({ error: 'Solo el gerente puede hacer esto' });
  }
  next();
}

// ---------- Dispositivos del bar (Tablet 1, Tablet 2, Barra...) ----------
// Cada aparato se identifica con una ficha guardada en una cookie larga. El
// gerente da de alta los aparatos y autoriza los nuevos, para que nadie use la
// app desde su móvil personal.

const DURACION_FICHA = 10 * 365 * 24 * 60 * 60; // segundos (prácticamente para siempre)

// El propio ordenador del bar (donde corre el servidor) no necesita ficha
function esElPuestoDelBar(req) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function dispositivoDeCookie(cookieHeader) {
  const m = /(?:^|;\s*)dispositivo=([a-f0-9]{32,})/.exec(cookieHeader || '');
  if (!m) return null;
  return bd.prepare('SELECT * FROM dispositivos WHERE ficha = ?').get(m[1]) || null;
}

function anotarUso(dispositivo, empleado) {
  if (!dispositivo || !dispositivo.id) return;
  bd.prepare('UPDATE dispositivos SET ultimoUso = ?, ultimoEmpleado = ? WHERE id = ?').run(
    new Date().toISOString(), empleado ? empleado.nombre : null, dispositivo.id
  );
}

// Rutas que tienen que funcionar aunque el aparato todavía no esté autorizado
const RUTAS_SIN_DISPOSITIVO = new Set([
  '/yo', '/logout', '/dispositivos/disponibles', '/dispositivos/mio',
]);

app.use('/api', (req, res, next) => {
  const dispositivo = dispositivoDeCookie(req.headers.cookie);
  req.dispositivo = dispositivo;
  req.nombreDispositivo = dispositivo
    ? dispositivo.nombre
    : esElPuestoDelBar(req)
      ? 'Puesto del bar'
      : null;

  if (RUTAS_SIN_DISPOSITIVO.has(req.path) || /^\/dispositivos\/\d+\/vincular$/.test(req.path)) {
    return next();
  }
  // El ordenador del bar y el gerente nunca se quedan fuera: si no, no habría
  // forma de autorizar el primer aparato.
  if (esElPuestoDelBar(req) || req.empleado.rol === 'gerente') {
    anotarUso(dispositivo, req.empleado);
    return next();
  }
  if (!dispositivo) {
    return res.status(403).json({
      codigo: 'dispositivo-no-autorizado',
      estadoDispositivo: 'sin-identificar',
      error: 'Este aparato todavía no está dado de alta en el bar',
    });
  }
  if (dispositivo.estado !== 'autorizado') {
    return res.status(403).json({
      codigo: 'dispositivo-no-autorizado',
      estadoDispositivo: dispositivo.estado,
      error:
        dispositivo.estado === 'bloqueado'
          ? `${dispositivo.nombre} está bloqueado; habla con el gerente`
          : `${dispositivo.nombre} está pendiente de que el gerente lo autorice`,
    });
  }
  anotarUso(dispositivo, req.empleado);
  next();
});

// Qué aparato es este (lo consulta la pantalla de identificación)
app.get('/api/dispositivos/mio', (req, res) => {
  res.json({
    dispositivo: req.dispositivo
      ? { id: req.dispositivo.id, nombre: req.dispositivo.nombre, estado: req.dispositivo.estado }
      : null,
    puestoDelBar: esElPuestoDelBar(req),
  });
});

// Aparatos dados de alta y todavía sin asignar (para elegir en el aparato nuevo)
app.get('/api/dispositivos/disponibles', (req, res) => {
  res.json(bd.prepare("SELECT id, nombre FROM dispositivos WHERE estado = 'libre' ORDER BY nombre").all());
});

// Este aparato dice "yo soy la Tablet 2": queda pendiente del visto bueno
app.post('/api/dispositivos/:id/vincular', (req, res) => {
  const dispositivo = bd.prepare('SELECT * FROM dispositivos WHERE id = ?').get(Number(req.params.id));
  if (!dispositivo) return res.status(404).json({ error: 'Ese aparato no está dado de alta' });
  if (dispositivo.estado !== 'libre') {
    return res.status(400).json({ error: `${dispositivo.nombre} ya está en uso en otro aparato` });
  }
  const ficha = crypto.randomBytes(24).toString('hex');
  // Si lo vincula el gerente desde el propio aparato, ya queda autorizado
  const estado = req.empleado.rol === 'gerente' ? 'autorizado' : 'pendiente';
  bd.prepare('UPDATE dispositivos SET ficha = ?, estado = ?, vinculado = ?, ultimoEmpleado = ? WHERE id = ?').run(
    ficha, estado, new Date().toISOString(), req.empleado.nombre, dispositivo.id
  );
  res.setHeader(
    'Set-Cookie',
    `dispositivo=${ficha}; HttpOnly; Path=/; Max-Age=${DURACION_FICHA}; SameSite=Lax`
  );
  io.emit('dispositivos-cambiados');
  res.json({ id: dispositivo.id, nombre: dispositivo.nombre, estado });
});

app.get('/api/dispositivos', soloGerente, (req, res) => {
  res.json(
    bd
      .prepare('SELECT id, nombre, estado, creado, vinculado, ultimoUso, ultimoEmpleado FROM dispositivos ORDER BY nombre')
      .all()
  );
});

app.post('/api/dispositivos', soloGerente, (req, res) => {
  const nombre = String(req.body.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'Ponle un nombre (Tablet 1, Barra…)' });
  if (bd.prepare('SELECT id FROM dispositivos WHERE lower(nombre) = lower(?)').get(nombre)) {
    return res.status(400).json({ error: 'Ya hay un aparato con ese nombre' });
  }
  const dispositivo = { id: nuevoId(), nombre: nombre.slice(0, 40), estado: 'libre', creado: new Date().toISOString() };
  bd.prepare('INSERT INTO dispositivos (id, nombre, estado, creado) VALUES (?,?,?,?)').run(
    dispositivo.id, dispositivo.nombre, 'libre', dispositivo.creado
  );
  io.emit('dispositivos-cambiados');
  res.json(dispositivo);
});

app.put('/api/dispositivos/:id', soloGerente, (req, res) => {
  const dispositivo = bd.prepare('SELECT * FROM dispositivos WHERE id = ?').get(Number(req.params.id));
  if (!dispositivo) return res.status(404).json({ error: 'Aparato no encontrado' });
  const { nombre, estado } = req.body;
  if (nombre !== undefined) {
    const limpio = String(nombre).trim();
    if (!limpio) return res.status(400).json({ error: 'El nombre no puede quedar vacío' });
    const otro = bd.prepare('SELECT id FROM dispositivos WHERE lower(nombre) = lower(?) AND id != ?').get(limpio, dispositivo.id);
    if (otro) return res.status(400).json({ error: 'Ya hay un aparato con ese nombre' });
    dispositivo.nombre = limpio.slice(0, 40);
  }
  if (estado !== undefined) {
    if (!['autorizado', 'bloqueado', 'libre'].includes(estado)) {
      return res.status(400).json({ error: 'Estado no válido' });
    }
    if (estado === 'autorizado' && !dispositivo.ficha) {
      return res.status(400).json({ error: 'Ese aparato todavía no se ha identificado desde ningún sitio' });
    }
    dispositivo.estado = estado;
    // "libre" es desvincular: el aparato deja de estar reconocido
    if (estado === 'libre') dispositivo.ficha = null;
  }
  bd.prepare('UPDATE dispositivos SET nombre = ?, estado = ?, ficha = ? WHERE id = ?').run(
    dispositivo.nombre, dispositivo.estado, dispositivo.ficha, dispositivo.id
  );
  io.emit('dispositivos-cambiados');
  res.json({ id: dispositivo.id, nombre: dispositivo.nombre, estado: dispositivo.estado });
});

app.delete('/api/dispositivos/:id', soloGerente, (req, res) => {
  const dispositivo = bd.prepare('SELECT * FROM dispositivos WHERE id = ?').get(Number(req.params.id));
  if (!dispositivo) return res.status(404).json({ error: 'Aparato no encontrado' });
  bd.prepare('DELETE FROM dispositivos WHERE id = ?').run(dispositivo.id);
  io.emit('dispositivos-cambiados');
  res.json({ id: dispositivo.id, nombre: dispositivo.nombre });
});

app.post('/api/logout', (req, res) => {
  const m = /(?:^|;\s*)sesion=([a-f0-9]{32,})/.exec(req.headers.cookie || '');
  if (m) bd.prepare('DELETE FROM sesiones WHERE token = ?').run(m[1]);
  res.setHeader('Set-Cookie', 'sesion=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
  res.json({ ok: true });
});

app.get('/api/yo', (req, res) => {
  res.json({ nombre: req.empleado.nombre, rol: req.empleado.rol });
});

app.get('/api/estado', (req, res) => res.json(estado()));

// ----- Comandas -----

// Margen en el que dos comandas idénticas de la misma mesa se consideran un
// doble envío (doble clic, la red que va lenta y el camarero insiste...).
const VENTANA_DUPLICADOS_MS = Number(process.env.VENTANA_DUPLICADOS_MS || 30_000);
const ENVIOS_A_CONSERVAR_MS = 24 * 60 * 60 * 1000;

// Quién prepara cada línea de la comanda. Lo decide el servidor mirando la
// carta, no el móvil del camarero: así no se puede colar por la API.
function destinoDeItem(item, articulosPorId) {
  if (!item.articuloId) return 'cocina'; // menú del día y platos escritos a mano
  const articulo = articulosPorId.get(Number(item.articuloId));
  return articulo && articulo.destino === 'barra' ? 'barra' : 'cocina';
}

// Resumen del contenido de la comanda: misma mesa + mismas líneas = misma huella
function huellaComanda(zona, mesa, items) {
  const lineas = items
    .map((i) => [i.articuloId ?? i.nombre, i.cantidad, i.notas || '', i.detalle || ''].join('~'))
    .sort()
    .join('|');
  return crypto.createHash('sha256').update(`${zona}|${mesa}|${lineas}`).digest('hex').slice(0, 32);
}

// Deja las líneas en un formato conocido y descarta lo que venga mal
function normalizarItems(items) {
  const limpios = [];
  for (const it of items) {
    const cantidad = Number(it.cantidad);
    const precio = Number(it.precio);
    if (!it || !it.nombre || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 99) return null;
    if (!Number.isFinite(precio) || precio < 0) return null;
    const linea = {
      articuloId: it.articuloId ?? null,
      nombre: String(it.nombre).slice(0, 120),
      precio: redondear(precio),
      cantidad,
    };
    if (it.notas) linea.notas = String(it.notas).slice(0, 200);
    if (it.detalle) linea.detalle = String(it.detalle).slice(0, 200);
    if (it.menu) linea.menu = it.menu;
    limpios.push(linea);
  }
  return limpios;
}

function pedidosDeGrupo(grupo) {
  return bd
    .prepare('SELECT * FROM pedidos WHERE grupo = ? ORDER BY id')
    .all(grupo)
    .map((p) => ({ ...p, items: JSON.parse(p.items) }));
}

// Crear comanda: el camarero la envía y el servidor la reparte entre cocina y barra
app.post('/api/pedidos', (req, res) => {
  const { zona, mesa, items, claveIdem, confirmarRepetida } = req.body;
  if (!zona || !mesa || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Faltan zona, mesa o artículos' });
  }
  const lineas = normalizarItems(items);
  if (!lineas) return res.status(400).json({ error: 'Hay artículos con cantidad o precio no válidos' });

  const mesaNum = Number(mesa);
  const clave = typeof claveIdem === 'string' && /^[\w-]{8,64}$/.test(claveIdem) ? claveIdem : null;
  const huella = huellaComanda(zona, mesaNum, lineas);
  const ahora = new Date();

  // 1) Idempotencia: si este envío ya se procesó, devolvemos lo mismo y no se duplica
  if (clave) {
    const envio = bd.prepare('SELECT * FROM comandasEnviadas WHERE claveIdem = ?').get(clave);
    if (envio) {
      const vivas = pedidosDeGrupo(envio.grupo);
      if (vivas.length > 0) {
        return res.json({ duplicada: true, grupo: envio.grupo, pedidos: vivas });
      }
      // Se anularon todas: el camarero puede volver a mandar la misma comanda
      bd.prepare('DELETE FROM comandasEnviadas WHERE claveIdem = ?').run(clave);
    }
  }

  // 2) Comanda idéntica recién enviada con otra clave: casi seguro es un doble envío.
  //    No se bloquea para siempre: el camarero puede confirmar que la mesa repite.
  if (!confirmarRepetida) {
    const desde = new Date(Date.now() - VENTANA_DUPLICADOS_MS).toISOString();
    const repetida = bd
      .prepare('SELECT * FROM comandasEnviadas WHERE huella = ? AND creado > ? ORDER BY creado DESC')
      .get(huella, desde);
    if (repetida) {
      const segundos = Math.max(1, Math.round((ahora - new Date(repetida.creado)) / 1000));
      return res.status(409).json({
        codigo: 'comanda-repetida',
        error: `Esta misma comanda se envió hace ${segundos} segundos (${repetida.empleado || 'otro camarero'}).`,
        segundos,
        grupo: repetida.grupo,
      });
    }
  }

  // 3) Se reparte: lo de barra por un lado y lo de cocina por otro
  const articulosPorId = new Map(todosArticulos().map((a) => [a.id, a]));
  const porDestino = { cocina: [], barra: [] };
  for (const linea of lineas) porDestino[destinoDeItem(linea, articulosPorId)].push(linea);

  const grupo = nuevoId();
  const creado = ahora.toISOString();
  const creadas = [];
  enTransaccion(() => {
    for (const destino of ['cocina', 'barra']) {
      if (porDestino[destino].length === 0) continue;
      const pedido = {
        id: nuevoId(),
        zona,
        mesa: mesaNum,
        items: porDestino[destino],
        camarero: req.empleado.nombre,
        estado: 'pendiente', // pendiente -> listo -> servido (recogido por sala)
        creado,
        listoEn: null,
        destino,
        grupo,
        dispositivo: req.nombreDispositivo,
      };
      bd.prepare(
        'INSERT INTO pedidos (id, zona, mesa, items, camarero, estado, creado, listoEn, destino, grupo, dispositivo) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
      ).run(
        pedido.id, zona, mesaNum, JSON.stringify(pedido.items), pedido.camarero,
        pedido.estado, creado, null, destino, grupo, pedido.dispositivo
      );
      creadas.push(pedido);
    }
    // El apunte del envío es lo que hace la comanda idempotente
    bd.prepare(
      'INSERT INTO comandasEnviadas (claveIdem, grupo, huella, zona, mesa, empleado, creado) VALUES (?,?,?,?,?,?,?)'
    ).run(clave || crypto.randomUUID(), grupo, huella, zona, mesaNum, req.empleado.nombre, creado);
    bd.prepare('DELETE FROM comandasEnviadas WHERE creado < ?').run(
      new Date(Date.now() - ENVIOS_A_CONSERVAR_MS).toISOString()
    );
  });

  difundir();
  for (const pedido of creadas) io.emit('nueva-comanda', pedido); // aviso sonoro en cocina y barra
  res.json({ duplicada: false, grupo, pedidos: creadas });
});

// Cocina o barra marcan una comanda como lista (repetir la llamada no cambia nada)
app.post('/api/pedidos/:id/listo', (req, res) => {
  const pedido = pedidoPorId(req.params.id);
  if (!pedido) return res.status(404).json({ error: 'Comanda no encontrada' });
  if (pedido.estado !== 'pendiente') return res.json(pedido); // ya estaba lista o servida
  pedido.estado = 'listo';
  pedido.listoEn = new Date().toISOString();
  bd.prepare('UPDATE pedidos SET estado = ?, listoEn = ? WHERE id = ?').run('listo', pedido.listoEn, pedido.id);
  difundir();
  // Avisa a los camareros de sala; si viene de la barra, es "bebidas listas para llevar"
  io.emit('comanda-lista', { ...pedido, avisadoPor: req.empleado.nombre });
  res.json(pedido);
});

// El camarero de sala confirma que ya ha recogido lo que estaba listo en la barra
app.post('/api/pedidos/:id/recogido', (req, res) => {
  const pedido = pedidoPorId(req.params.id);
  if (!pedido) return res.status(404).json({ error: 'Comanda no encontrada' });
  if (pedido.estado === 'servido') return res.json(pedido);
  if (pedido.estado !== 'listo') {
    return res.status(400).json({ error: 'Esa comanda todavía no está lista' });
  }
  pedido.estado = 'servido';
  bd.prepare('UPDATE pedidos SET estado = ? WHERE id = ?').run('servido', pedido.id);
  difundir();
  io.emit('comanda-recogida', { ...pedido, recogidoPor: req.empleado.nombre });
  res.json(pedido);
});

// Anular una comanda: exige el motivo y queda registrado quién la anuló
app.delete('/api/pedidos/:id', (req, res) => {
  const pedido = pedidoPorId(req.params.id);
  if (!pedido) return res.status(404).json({ error: 'Comanda no encontrada' });
  const motivo = (req.body && req.body.motivo ? String(req.body.motivo) : '').trim();
  if (!motivo) return res.status(400).json({ error: 'Hay que indicar el motivo de la anulación' });
  const anuladoPor = req.empleado.nombre;
  enTransaccion(() => {
    bd.prepare('DELETE FROM pedidos WHERE id = ?').run(pedido.id);
    bd.prepare('INSERT INTO anulaciones (id, pedido, motivo, anuladoPor, fecha) VALUES (?,?,?,?,?)').run(
      nuevoId(), JSON.stringify(pedido), motivo, anuladoPor, new Date().toISOString()
    );
    bd.prepare('DELETE FROM anulaciones WHERE id NOT IN (SELECT id FROM anulaciones ORDER BY id DESC LIMIT 500)').run();
  });
  difundir();
  io.emit('comanda-anulada', { ...pedido, motivo, anuladoPor }); // para avisar en cocina
  res.json(pedido);
});

// Cobrar una mesa: cierra todas sus comandas y las pasa al historial
app.post('/api/mesas/cobrar', (req, res) => {
  const { zona, mesa, metodoPago } = req.body;
  if (!zona || !mesa || !['efectivo', 'tarjeta'].includes(metodoPago)) {
    return res.status(400).json({ error: 'Faltan zona, mesa o método de pago' });
  }
  const deLaMesa = bd
    .prepare('SELECT * FROM pedidos WHERE zona = ? AND mesa = ?')
    .all(zona, mesa)
    .map((p) => ({ ...p, items: JSON.parse(p.items) }));
  if (deLaMesa.length === 0) {
    return res.status(400).json({ error: 'La mesa no tiene comandas abiertas' });
  }
  let total = 0;
  for (const p of deLaMesa) {
    for (const item of p.items) total += item.precio * item.cantidad;
  }
  total = redondear(total);
  const cierre = {
    id: nuevoId(),
    zona,
    mesa,
    metodoPago,
    total,
    pedidos: deLaMesa,
    cobradoPor: req.empleado.nombre,
    cobrado: new Date().toISOString(),
    dispositivo: req.nombreDispositivo,
  };
  enTransaccion(() => {
    bd.prepare(
      'INSERT INTO historial (id, zona, mesa, metodoPago, total, pedidos, cobradoPor, cobrado, dispositivo) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(
      cierre.id, zona, mesa, metodoPago, total, JSON.stringify(deLaMesa),
      cierre.cobradoPor, cierre.cobrado, cierre.dispositivo
    );
    bd.prepare('DELETE FROM pedidos WHERE zona = ? AND mesa = ?').run(zona, mesa);
  });
  difundir();
  res.json(cierre);
});

// Mover todas las comandas de una mesa a otra (cambio de mesa de los clientes)
app.post('/api/mesas/mover', (req, res) => {
  const { deZona, deMesa, aZona, aMesa } = req.body;
  const config = metaGet('config');
  const zonaDestino = config.zonas.find((z) => z.id === aZona);
  if (!deZona || !deMesa || !zonaDestino || !aMesa) {
    return res.status(400).json({ error: 'Faltan la mesa de origen o la de destino' });
  }
  const mesaDestino = Number(aMesa);
  if (!Number.isInteger(mesaDestino) || mesaDestino < 1 || mesaDestino > zonaDestino.mesas) {
    return res.status(400).json({ error: `${zonaDestino.nombre} no tiene mesa ${aMesa}` });
  }
  if (deZona === aZona && Number(deMesa) === mesaDestino) {
    return res.status(400).json({ error: 'Es la misma mesa' });
  }
  const abiertas = bd
    .prepare('SELECT COUNT(*) AS n FROM pedidos WHERE zona = ? AND mesa = ?')
    .get(deZona, Number(deMesa)).n;
  if (abiertas === 0) {
    return res.status(400).json({ error: 'La mesa no tiene comandas abiertas' });
  }
  bd.prepare('UPDATE pedidos SET zona = ?, mesa = ? WHERE zona = ? AND mesa = ?').run(
    aZona, mesaDestino, deZona, Number(deMesa)
  );
  difundir();
  // Para que cocina se entere de que los tickets pendientes cambian de mesa
  io.emit('mesa-movida', {
    deZona, deMesa: Number(deMesa), aZona, aMesa: mesaDestino, por: req.empleado.nombre,
  });
  res.json({ ok: true, comandasMovidas: abiertas });
});

// Resumen de un día: cobros, anulaciones y totales (lo usan la caja y el informe Z)
function resumenDia(dia) {
  const cierres = bd
    .prepare('SELECT * FROM historial WHERE substr(cobrado, 1, 10) = ? ORDER BY id')
    .all(dia)
    .map((c) => ({ ...c, pedidos: JSON.parse(c.pedidos) }));
  const anulaciones = bd
    .prepare('SELECT * FROM anulaciones WHERE substr(fecha, 1, 10) = ? ORDER BY id')
    .all(dia)
    .map((a) => ({ ...a, pedido: JSON.parse(a.pedido) }));
  const totalEfectivo = cierres
    .filter((c) => c.metodoPago === 'efectivo')
    .reduce((s, c) => s + c.total, 0);
  const totalTarjeta = cierres
    .filter((c) => c.metodoPago === 'tarjeta')
    .reduce((s, c) => s + c.total, 0);
  return {
    dia,
    cierres,
    anulaciones,
    totalEfectivo: redondear(totalEfectivo),
    totalTarjeta: redondear(totalTarjeta),
    total: redondear(totalEfectivo + totalTarjeta),
  };
}

// Historial de cobros del día (para caja)
app.get('/api/historial', soloGerente, (req, res) => {
  const hoy = new Date().toISOString().slice(0, 10);
  const dia = req.query.dia || hoy;
  const zetas = bd
    .prepare('SELECT * FROM cierresCaja WHERE dia = ? ORDER BY id')
    .all(dia)
    .map((z) => JSON.parse(z.datos));
  res.json({ ...resumenDia(dia), zetas });
});

// Cierre de caja del día: genera el informe Z y lo deja registrado
app.post('/api/caja/cierre', soloGerente, (req, res) => {
  const hoy = new Date().toISOString().slice(0, 10);
  const r = resumenDia(hoy);
  // Cuánto cobró cada empleado (para el arqueo)
  const porEmpleado = {};
  for (const c of r.cierres) {
    const quien = c.cobradoPor || 'Sin firmar';
    porEmpleado[quien] ||= { nombre: quien, mesas: 0, efectivo: 0, tarjeta: 0, total: 0 };
    porEmpleado[quien].mesas++;
    porEmpleado[quien][c.metodoPago] += c.total;
    porEmpleado[quien].total += c.total;
  }
  for (const e of Object.values(porEmpleado)) {
    e.efectivo = redondear(e.efectivo);
    e.tarjeta = redondear(e.tarjeta);
    e.total = redondear(e.total);
  }
  // Y desde qué aparato se cobró (para cuadrar la caja de cada tablet)
  const porDispositivo = {};
  for (const c of r.cierres) {
    const donde = c.dispositivo || 'Sin identificar';
    porDispositivo[donde] ||= { nombre: donde, mesas: 0, total: 0 };
    porDispositivo[donde].mesas++;
    porDispositivo[donde].total += c.total;
  }
  for (const d of Object.values(porDispositivo)) d.total = redondear(d.total);
  const importeAnulado = redondear(
    r.anulaciones.reduce(
      (s, a) => s + a.pedido.items.reduce((t, it) => t + it.precio * it.cantidad, 0), 0
    )
  );
  const numero = (bd.prepare('SELECT MAX(numero) AS n FROM cierresCaja').get().n || 0) + 1;
  const informe = {
    numero,
    dia: hoy,
    fecha: new Date().toISOString(),
    cerradoPor: req.empleado.nombre,
    mesasCobradas: r.cierres.length,
    totalEfectivo: r.totalEfectivo,
    totalTarjeta: r.totalTarjeta,
    total: r.total,
    porEmpleado: Object.values(porEmpleado),
    porDispositivo: Object.values(porDispositivo),
    numAnulaciones: r.anulaciones.length,
    importeAnulado,
  };
  bd.prepare('INSERT INTO cierresCaja (id, numero, dia, datos, cerradoPor, fecha) VALUES (?,?,?,?,?,?)').run(
    nuevoId(), numero, hoy, JSON.stringify(informe), informe.cerradoPor, informe.fecha
  );
  res.json(informe);
});

// ----- Carta y disponibilidad -----

app.post('/api/articulos', soloGerente, (req, res) => {
  const { nombre, categoria, precio, tipo, subtipo, destino } = req.body;
  if (!nombre || !tipo) return res.status(400).json({ error: 'Faltan datos' });
  const articulo = {
    id: nuevoId(),
    nombre,
    categoria: categoria || '',
    precio: Number(precio) || 0,
    tipo, // 'carta' o 'menu'
    subtipo: subtipo || null, // para menú: 'primero' | 'segundo' | 'postre'
    disponible: true,
    motivo: '',
    // Quién lo prepara: si no se dice nada, las bebidas van a la barra
    destino:
      destino === 'barra' || destino === 'cocina'
        ? destino
        : tipo === 'carta' && CATEGORIAS_DE_BARRA.test(categoria || '')
          ? 'barra'
          : 'cocina',
  };
  bd.prepare(
    'INSERT INTO articulos (id, nombre, categoria, precio, tipo, subtipo, disponible, motivo, destino) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(articulo.id, articulo.nombre, articulo.categoria, articulo.precio, tipo, articulo.subtipo, 1, '', articulo.destino);
  difundir();
  res.json(articulo);
});

app.put('/api/articulos/:id', soloGerente, (req, res) => {
  const fila = bd.prepare('SELECT * FROM articulos WHERE id = ?').get(Number(req.params.id));
  if (!fila) return res.status(404).json({ error: 'Artículo no encontrado' });
  const articulo = { ...fila, disponible: !!fila.disponible };
  const { nombre, categoria, precio, disponible, motivo, subtipo, destino } = req.body;
  if (nombre !== undefined) articulo.nombre = nombre;
  if (categoria !== undefined) articulo.categoria = categoria;
  if (precio !== undefined) articulo.precio = Number(precio);
  if (subtipo !== undefined) articulo.subtipo = subtipo;
  if (destino === 'barra' || destino === 'cocina') articulo.destino = destino;
  if (disponible !== undefined) {
    articulo.disponible = Boolean(disponible);
    articulo.motivo = articulo.disponible ? '' : motivo || '';
  } else if (motivo !== undefined) {
    articulo.motivo = motivo;
  }
  bd.prepare(
    'UPDATE articulos SET nombre = ?, categoria = ?, precio = ?, subtipo = ?, disponible = ?, motivo = ?, destino = ? WHERE id = ?'
  ).run(
    articulo.nombre, articulo.categoria, articulo.precio, articulo.subtipo,
    articulo.disponible ? 1 : 0, articulo.motivo, articulo.destino, articulo.id
  );
  difundir();
  res.json(articulo);
});

app.delete('/api/articulos/:id', soloGerente, (req, res) => {
  const fila = bd.prepare('SELECT * FROM articulos WHERE id = ?').get(Number(req.params.id));
  if (!fila) return res.status(404).json({ error: 'Artículo no encontrado' });
  bd.prepare('DELETE FROM articulos WHERE id = ?').run(fila.id);
  difundir();
  res.json({ ...fila, disponible: !!fila.disponible });
});

// ----- Configuración (zonas, precios del menú del día) -----

app.put('/api/config', soloGerente, (req, res) => {
  const config = metaGet('config');
  const { menuDia, zonas } = req.body;
  if (menuDia) Object.assign(config.menuDia, menuDia);
  if (Array.isArray(zonas)) {
    for (const z of zonas) {
      const zona = config.zonas.find((x) => x.id === z.id);
      if (zona && z.mesas) zona.mesas = Number(z.mesas);
    }
  }
  metaSet('config', config);
  difundir();
  res.json(config);
});

// ----- Almacén: stock de alimentos y material (solo gerente) -----

function difundirAlmacen() {
  io.emit('almacen-cambiado'); // el panel de admin recarga; el resto lo ignora
}

app.get('/api/almacen', soloGerente, (req, res) => {
  res.json({
    productos: bd.prepare('SELECT * FROM almacenProductos ORDER BY id').all(),
    movimientos: bd.prepare('SELECT * FROM almacenMovimientos ORDER BY id DESC LIMIT 40').all(),
  });
});

// Lista corta de nombres para el desplegable de los avisos (la ve cualquier empleado)
app.get('/api/almacen/nombres', (req, res) => {
  res.json(bd.prepare('SELECT id, nombre, unidad, categoria FROM almacenProductos ORDER BY nombre').all());
});

app.post('/api/almacen', soloGerente, (req, res) => {
  const { nombre, categoria, unidad, cantidad, minimo } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Falta el nombre del producto' });
  const producto = {
    id: nuevoId(),
    nombre,
    categoria: categoria || 'General',
    unidad: unidad || 'uds',
    cantidad: redondear(Number(cantidad) || 0),
    minimo: redondear(Number(minimo) || 0),
  };
  bd.prepare(
    'INSERT INTO almacenProductos (id, nombre, categoria, unidad, cantidad, minimo) VALUES (?,?,?,?,?,?)'
  ).run(producto.id, producto.nombre, producto.categoria, producto.unidad, producto.cantidad, producto.minimo);
  difundirAlmacen();
  res.json(producto);
});

app.put('/api/almacen/:id', soloGerente, (req, res) => {
  const producto = bd.prepare('SELECT * FROM almacenProductos WHERE id = ?').get(Number(req.params.id));
  if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });
  const { nombre, categoria, unidad, minimo } = req.body;
  if (nombre) producto.nombre = nombre;
  if (categoria) producto.categoria = categoria;
  if (unidad) producto.unidad = unidad;
  if (minimo !== undefined) producto.minimo = redondear(Number(minimo) || 0);
  bd.prepare('UPDATE almacenProductos SET nombre = ?, categoria = ?, unidad = ?, minimo = ? WHERE id = ?').run(
    producto.nombre, producto.categoria, producto.unidad, producto.minimo, producto.id
  );
  difundirAlmacen();
  res.json(producto);
});

app.delete('/api/almacen/:id', soloGerente, (req, res) => {
  const producto = bd.prepare('SELECT * FROM almacenProductos WHERE id = ?').get(Number(req.params.id));
  if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });
  bd.prepare('DELETE FROM almacenProductos WHERE id = ?').run(producto.id);
  difundirAlmacen();
  res.json(producto);
});

// Entrada (compra), salida (gasto o merma) o recuento (corregir la cantidad)
app.post('/api/almacen/:id/movimiento', soloGerente, (req, res) => {
  const producto = bd.prepare('SELECT * FROM almacenProductos WHERE id = ?').get(Number(req.params.id));
  if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });
  const { tipo, cantidad, motivo } = req.body;
  if (!['entrada', 'salida', 'recuento'].includes(tipo)) {
    return res.status(400).json({ error: 'Movimiento no válido' });
  }
  const n = Number(cantidad);
  if (isNaN(n) || n < 0 || (tipo !== 'recuento' && n === 0)) {
    return res.status(400).json({ error: 'Cantidad no válida' });
  }
  const antes = producto.cantidad;
  let despues;
  if (tipo === 'entrada') despues = antes + n;
  else if (tipo === 'salida') despues = antes - n;
  else despues = n;
  despues = redondear(despues);
  if (despues < 0) {
    return res.status(400).json({ error: `Solo quedan ${antes} ${producto.unidad}` });
  }
  producto.cantidad = despues;
  enTransaccion(() => {
    bd.prepare('UPDATE almacenProductos SET cantidad = ? WHERE id = ?').run(despues, producto.id);
    bd.prepare(
      'INSERT INTO almacenMovimientos (id, productoId, producto, tipo, cantidad, antes, despues, motivo, empleado, fecha) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).run(nuevoId(), producto.id, producto.nombre, tipo, n, antes, despues, motivo || '', req.empleado.nombre, new Date().toISOString());
    // El historial de movimientos no crece sin límite
    bd.prepare(
      'DELETE FROM almacenMovimientos WHERE id NOT IN (SELECT id FROM almacenMovimientos ORDER BY id DESC LIMIT 500)'
    ).run();
  });
  difundirAlmacen();
  res.json(producto);
});

// ----- Avisos de stock: cocina y barra le dicen al gerente qué falta -----

const ALERTAS_ATENDIDAS_VISIBLES = 15;

function alertaConFormato(a) {
  return { ...a, atendida: a.atendida || null };
}

function listaAlertas() {
  return {
    pendientes: bd
      .prepare("SELECT * FROM alertasStock WHERE estado = 'pendiente' ORDER BY id DESC")
      .all()
      .map(alertaConFormato),
    atendidas: bd
      .prepare("SELECT * FROM alertasStock WHERE estado = 'atendida' ORDER BY id DESC LIMIT ?")
      .all(ALERTAS_ATENDIDAS_VISIBLES)
      .map(alertaConFormato),
  };
}

function difundirAlertas() {
  difundir(); // actualiza la chapa de avisos pendientes en todas las pantallas
  io.emit('alertas-cambiadas');
}

app.get('/api/alertas', (req, res) => res.json(listaAlertas()));

// Cualquier empleado puede avisar: los cocineros desde cocina, la barra desde su pantalla
app.post('/api/alertas', (req, res) => {
  const { producto, origen, gravedad, nota, productoId } = req.body;
  const nombre = String(producto || '').trim();
  if (!nombre) return res.status(400).json({ error: 'Di qué producto falta' });
  if (!['cocina', 'barra'].includes(origen)) {
    return res.status(400).json({ error: 'Origen no válido' });
  }
  if (!['poco', 'agotado'].includes(gravedad)) {
    return res.status(400).json({ error: 'Indica si queda poco o si se ha agotado' });
  }
  const texto = nota ? String(nota).slice(0, 200) : '';
  const ahora = new Date().toISOString();

  // Si ya hay un aviso pendiente del mismo producto y sitio no se apila otro:
  // se actualiza (y "queda poco" puede subir a "agotado")
  const previa = bd
    .prepare(
      "SELECT * FROM alertasStock WHERE estado = 'pendiente' AND origen = ? AND lower(producto) = lower(?)"
    )
    .get(origen, nombre);
  if (previa) {
    const gravedadFinal = previa.gravedad === 'agotado' ? 'agotado' : gravedad;
    bd.prepare(
      'UPDATE alertasStock SET gravedad = ?, nota = ?, empleado = ?, creado = ?, dispositivo = ?, repeticiones = repeticiones + 1 WHERE id = ?'
    ).run(gravedadFinal, texto || previa.nota, req.empleado.nombre, ahora, req.nombreDispositivo, previa.id);
    const alerta = bd.prepare('SELECT * FROM alertasStock WHERE id = ?').get(previa.id);
    io.emit('alerta-stock', alerta);
    difundirAlertas();
    return res.json({ ...alertaConFormato(alerta), repetida: true });
  }

  const alerta = {
    id: nuevoId(),
    producto: nombre.slice(0, 80),
    productoId: Number.isInteger(Number(productoId)) && productoId ? Number(productoId) : null,
    origen,
    gravedad,
    nota: texto,
    empleado: req.empleado.nombre,
    creado: ahora,
    repeticiones: 1,
    estado: 'pendiente',
    atendidaPor: null,
    atendida: null,
    dispositivo: req.nombreDispositivo,
  };
  bd.prepare(
    'INSERT INTO alertasStock (id, producto, productoId, origen, gravedad, nota, empleado, creado, repeticiones, estado, dispositivo) VALUES (?,?,?,?,?,?,?,?,1,?,?)'
  ).run(
    alerta.id, alerta.producto, alerta.productoId, origen, gravedad, alerta.nota,
    alerta.empleado, ahora, 'pendiente', alerta.dispositivo
  );
  io.emit('alerta-stock', alerta); // salta el aviso en el panel del gerente
  difundirAlertas();
  res.json({ ...alerta, repetida: false });
});

// El gerente da el aviso por resuelto (ya se ha repuesto o ya lo ha apuntado)
app.post('/api/alertas/:id/atendida', soloGerente, (req, res) => {
  const alerta = bd.prepare('SELECT * FROM alertasStock WHERE id = ?').get(Number(req.params.id));
  if (!alerta) return res.status(404).json({ error: 'Aviso no encontrado' });
  if (alerta.estado === 'atendida') return res.json(alertaConFormato(alerta));
  bd.prepare("UPDATE alertasStock SET estado = 'atendida', atendidaPor = ?, atendida = ? WHERE id = ?").run(
    req.empleado.nombre, new Date().toISOString(), alerta.id
  );
  // El historial de avisos no crece sin límite
  bd.prepare(
    "DELETE FROM alertasStock WHERE estado = 'atendida' AND id NOT IN (SELECT id FROM alertasStock WHERE estado = 'atendida' ORDER BY id DESC LIMIT 200)"
  ).run();
  difundirAlertas();
  res.json(alertaConFormato(bd.prepare('SELECT * FROM alertasStock WHERE id = ?').get(alerta.id)));
});

app.delete('/api/alertas/:id', soloGerente, (req, res) => {
  const alerta = bd.prepare('SELECT * FROM alertasStock WHERE id = ?').get(Number(req.params.id));
  if (!alerta) return res.status(404).json({ error: 'Aviso no encontrado' });
  bd.prepare('DELETE FROM alertasStock WHERE id = ?').run(alerta.id);
  difundirAlertas();
  res.json(alertaConFormato(alerta));
});

// ----- Empleados y sus códigos (solo gerente) -----

app.get('/api/empleados', soloGerente, (req, res) => {
  res.json(bd.prepare('SELECT id, nombre, rol FROM empleados ORDER BY id').all());
});

app.post('/api/empleados', soloGerente, (req, res) => {
  const { nombre, pin, rol } = req.body;
  if (!nombre || !['camarero', 'gerente'].includes(rol)) {
    return res.status(400).json({ error: 'Faltan nombre o puesto' });
  }
  if (!/^\d{4,6}$/.test(String(pin))) {
    return res.status(400).json({ error: 'El código debe tener de 4 a 6 números' });
  }
  const todos = bd.prepare('SELECT * FROM empleados').all();
  if (todos.some((e) => e.hash === hashPin(String(pin), e.sal))) {
    return res.status(400).json({ error: 'Ese código ya lo usa otro empleado; elige otro' });
  }
  const sal = crypto.randomBytes(8).toString('hex');
  const empleado = { id: nuevoId(), nombre, rol };
  bd.prepare('INSERT INTO empleados (id, nombre, rol, sal, hash) VALUES (?,?,?,?,?)').run(
    empleado.id, nombre, rol, sal, hashPin(String(pin), sal)
  );
  res.json(empleado);
});

app.put('/api/empleados/:id', soloGerente, (req, res) => {
  const empleado = bd.prepare('SELECT * FROM empleados WHERE id = ?').get(Number(req.params.id));
  if (!empleado) return res.status(404).json({ error: 'Empleado no encontrado' });
  const { nombre, pin, rol } = req.body;
  const gerentes = bd.prepare("SELECT COUNT(*) AS n FROM empleados WHERE rol = 'gerente'").get().n;
  if (rol === 'camarero' && empleado.rol === 'gerente' && gerentes === 1) {
    return res.status(400).json({ error: 'No puedes quitar el último gerente' });
  }
  if (pin !== undefined) {
    if (!/^\d{4,6}$/.test(String(pin))) {
      return res.status(400).json({ error: 'El código debe tener de 4 a 6 números' });
    }
    const otros = bd.prepare('SELECT * FROM empleados WHERE id != ?').all(empleado.id);
    if (otros.some((e) => e.hash === hashPin(String(pin), e.sal))) {
      return res.status(400).json({ error: 'Ese código ya lo usa otro empleado; elige otro' });
    }
    empleado.sal = crypto.randomBytes(8).toString('hex');
    empleado.hash = hashPin(String(pin), empleado.sal);
  }
  if (nombre) empleado.nombre = nombre;
  if (['camarero', 'gerente'].includes(rol)) empleado.rol = rol;
  bd.prepare('UPDATE empleados SET nombre = ?, rol = ?, sal = ?, hash = ? WHERE id = ?').run(
    empleado.nombre, empleado.rol, empleado.sal, empleado.hash, empleado.id
  );
  res.json({ id: empleado.id, nombre: empleado.nombre, rol: empleado.rol });
});

app.delete('/api/empleados/:id', soloGerente, (req, res) => {
  const empleado = bd.prepare('SELECT * FROM empleados WHERE id = ?').get(Number(req.params.id));
  if (!empleado) return res.status(404).json({ error: 'Empleado no encontrado' });
  const gerentes = bd.prepare("SELECT COUNT(*) AS n FROM empleados WHERE rol = 'gerente'").get().n;
  if (empleado.rol === 'gerente' && gerentes === 1) {
    return res.status(400).json({ error: 'No puedes borrar el último gerente' });
  }
  if (empleado.id === req.empleado.id) {
    return res.status(400).json({ error: 'No puedes borrarte a ti mismo' });
  }
  enTransaccion(() => {
    bd.prepare('DELETE FROM empleados WHERE id = ?').run(empleado.id);
    bd.prepare('DELETE FROM sesiones WHERE empleadoId = ?').run(empleado.id); // cierra sus sesiones
  });
  res.json({ id: empleado.id, nombre: empleado.nombre });
});

// Las pantallas en tiempo real también exigen sesión
io.use((socket, next) => {
  const empleado = empleadoDeSesion(socket.request.headers.cookie);
  if (!empleado) return next(new Error('sin-sesion'));
  // El aparato también tiene que estar autorizado (salvo el propio PC del bar
  // y el gerente, que si no no podría autorizar el primero)
  const dispositivo = dispositivoDeCookie(socket.request.headers.cookie);
  const ip = socket.request.socket.remoteAddress || '';
  const puestoDelBar = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (!puestoDelBar && empleado.rol !== 'gerente' && (!dispositivo || dispositivo.estado !== 'autorizado')) {
    return next(new Error('dispositivo-no-autorizado'));
  }
  socket.empleado = empleado;
  socket.dispositivo = dispositivo ? dispositivo.nombre : puestoDelBar ? 'Puesto del bar' : null;
  next();
});

io.on('connection', (socket) => {
  socket.emit('estado', estado());

  // La barra puede repetir el aviso si nadie baja a recoger las bebidas
  socket.on('reavisar-bebidas', (datos) => {
    const id = Number(datos && datos.id);
    if (!Number.isInteger(id)) return;
    const pedido = pedidoPorId(id);
    if (!pedido || pedido.estado !== 'listo') return;
    io.emit('comanda-lista', { ...pedido, avisadoPor: socket.empleado.nombre, repetido: true });
  });
});

servidor.listen(PUERTO, () => {
  const config = metaGet('config') || {};
  const titulo = (config.nombre || 'Bar').toUpperCase() + ' — servidor de comandas';
  console.log('');
  console.log('  ' + titulo);
  console.log('  ' + '='.repeat(titulo.length));
  console.log(`  En este ordenador:  http://localhost:${PUERTO}`);
  const redes = os.networkInterfaces();
  for (const nombre of Object.keys(redes)) {
    for (const red of redes[nombre]) {
      if (red.family === 'IPv4' && !red.internal) {
        console.log(`  Desde los móviles:  http://${red.address}:${PUERTO}  (misma WiFi)`);
      }
    }
  }
  // Solo la primera vez: los códigos con los que entrar (no se vuelven a poder ver)
  if (pinesRecienCreados.length) {
    console.log('');
    console.log('  ─── PRIMERA PUESTA EN MARCHA ───────────────────────────');
    for (const e of pinesRecienCreados) {
      console.log(`   ${e.rol === 'gerente' ? 'Gerente' : 'Camarero'} "${e.nombre}" → código ${e.pin}`);
    }
    console.log('   Apúntalos: no se pueden volver a consultar. Cámbialos desde');
    console.log('   Administración → Empleados en cuanto entres.');
    console.log('  ────────────────────────────────────────────────────────');
    pinesRecienCreados = [];
  }
  console.log('');
});
