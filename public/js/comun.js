// Utilidades compartidas por todas las pantallas

const socket = io();

// Si el servidor rechaza la conexión, o falta la sesión o falta identificar el aparato
socket.on('connect_error', (err) => {
  if (err.message === 'sin-sesion') location.href = 'login.html';
  else if (err.message === 'dispositivo-no-autorizado') irAIdentificarAparato();
});

// A la pantalla de "¿qué aparato es este?" (sin quedarse dando vueltas si ya está)
function irAIdentificarAparato() {
  if (!location.pathname.endsWith('/dispositivo.html')) location.href = 'dispositivo.html';
}

let ESTADO = { config: null, articulos: [], pedidos: [], alertasPendientes: 0 };
let YO = null; // empleado con la sesión iniciada { nombre, rol }
const escuchas = [];

// Comprueba la sesión al abrir cada pantalla; devuelve el empleado o redirige
async function cargarSesion() {
  try {
    YO = await api('GET', '/api/yo');
  } catch (e) {
    /* api() ya redirige al login si la sesión caducó */
  }
  return YO;
}

// Registra una función que se ejecuta cada vez que cambia el estado del servidor
function alCambiarEstado(fn) {
  escuchas.push(fn);
  if (ESTADO.config) fn(ESTADO);
}

socket.on('estado', (estado) => {
  ESTADO = estado;
  aplicarDatosDelLocal();
  for (const fn of escuchas) fn(ESTADO);
});

// El nombre y la dirección del bar salen de su configuración, no del código
function nombreDelLocal() {
  return (ESTADO.config && ESTADO.config.nombre) || 'Bar';
}

function aplicarDatosDelLocal(datos) {
  const config = datos || ESTADO.config;
  if (!config) return;
  for (const el of document.querySelectorAll('[data-local="nombre"]')) {
    el.textContent = config.nombre || '';
  }
  for (const el of document.querySelectorAll('[data-local="direccion"]')) {
    el.textContent = config.direccion ? '· ' + config.direccion : '';
  }
  const pantalla = document.body.dataset.pantalla;
  document.title = pantalla ? `${pantalla} — ${config.nombre || 'Bar'}` : config.nombre || 'Bar';
}

async function api(metodo, ruta, cuerpo) {
  const res = await fetch(ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = await res.json();
  if (res.status === 401) {
    location.href = 'login.html';
    throw new Error(datos.error || 'Sesión caducada');
  }
  if (res.status === 403 && datos.codigo === 'dispositivo-no-autorizado') {
    irAIdentificarAparato();
    throw new Error(datos.error || 'Aparato sin autorizar');
  }
  if (!res.ok) {
    // Se conserva el código del servidor (p. ej. 'comanda-repetida') para poder reaccionar
    const error = new Error(datos.error || 'Error del servidor');
    error.codigo = datos.codigo;
    error.estado = res.status;
    error.datos = datos;
    throw error;
  }
  return datos;
}

async function cerrarSesion() {
  await api('POST', '/api/logout');
  location.href = 'login.html';
}

function euros(n) {
  return n.toFixed(2).replace('.', ',') + ' €';
}

function horaCorta(iso) {
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function nombreZona(id) {
  const zona = ESTADO.config?.zonas.find((z) => z.id === id);
  return zona ? zona.nombre : id;
}

// Total de las comandas abiertas de una mesa
function totalMesa(zona, mesa) {
  let total = 0;
  for (const p of ESTADO.pedidos) {
    if (p.zona === zona && p.mesa === mesa) {
      for (const item of p.items) total += item.precio * item.cantidad;
    }
  }
  return Math.round(total * 100) / 100;
}

// Aviso flotante que desaparece solo (para "comanda lista", errores, etc.)
function avisar(texto) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = texto;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('visible'), 20);
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto;
  return div.innerHTML;
}

// Pitido para las pantallas de cocina y barra (y para el aviso de bebidas listas)
let audioCtx = null;
let audioListo = false;

// Los navegadores (sobre todo en el móvil) no dejan sonar nada hasta que alguien
// toca la pantalla. Esto lo despierta en cuanto hay un toque, para que la primera
// comanda del día no entre en silencio.
let avisarDelAudio = null; // la pantalla que quiere enterarse del cambio
let quitarEscuchasAudio = null;

// resume() tarda un poco en hacer efecto, así que el estado se anota cuando
// el navegador avisa del cambio, no justo después de pedirlo.
function anotarEstadoAudio() {
  audioListo = !!audioCtx && audioCtx.state === 'running';
  if (avisarDelAudio) avisarDelAudio(audioListo);
  if (audioListo && quitarEscuchasAudio) {
    quitarEscuchasAudio();
    quitarEscuchasAudio = null;
  }
}

function prepararAudio() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtx.addEventListener('statechange', anotarEstadoAudio);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    anotarEstadoAudio();
  } catch (e) {
    audioListo = false;
  }
  return audioListo;
}

// Las pantallas de cocina y barra avisan mientras el sonido siga bloqueado
function desbloquearAudioAlTocar(alCambiar) {
  avisarDelAudio = alCambiar;
  const sucesos = ['pointerdown', 'touchstart', 'keydown'];
  const intentar = () => prepararAudio();
  for (const s of sucesos) document.addEventListener(s, intentar);
  quitarEscuchasAudio = () => {
    for (const s of sucesos) document.removeEventListener(s, intentar);
  };
  intentar(); // en el ordenador suele estar permitido de entrada
}

function pitido(veces = 1) {
  try {
    prepararAudio();
    for (let i = 0; i < veces; i++) {
      const t = audioCtx.currentTime + i * 0.35;
      const osc = audioCtx.createOscillator();
      const gan = audioCtx.createGain();
      osc.connect(gan);
      gan.connect(audioCtx.destination);
      osc.frequency.value = 880;
      gan.gain.setValueAtTime(0.4, t);
      gan.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.start(t);
      osc.stop(t + 0.3);
    }
  } catch (e) {
    /* sin sonido si el navegador lo bloquea */
  }
}

function vibrar(patron) {
  if (navigator.vibrate) navigator.vibrate(patron);
}

// Clave distinta para cada envío de comanda: es lo que evita que una comanda
// entre dos veces si se toca dos veces el botón o si la red va lenta.
function nuevaClave() {
  const c = window.crypto;
  if (c && c.randomUUID) return c.randomUUID();
  if (c && c.getRandomValues) {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    return [...bytes].map((n) => n.toString(16).padStart(2, '0')).join('');
  }
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

// ----- Ventana emergente sencilla (avisos de stock, formularios cortos) -----

function abrirDialogo({ titulo, cuerpo, textoOk = 'Enviar', alAceptar }) {
  const fondo = document.createElement('div');
  fondo.className = 'fondo-dialogo';
  fondo.innerHTML = `
    <div class="dialogo" role="dialog" aria-modal="true">
      <div class="categoria-titulo" style="margin-top:0">${escaparHtml(titulo)}</div>
      <div class="cuerpo-dialogo">${cuerpo}</div>
      <div class="rejilla ${textoOk ? 'dos' : ''}" style="margin-top:1rem">
        <button class="boton" data-d="cancelar">Cancelar</button>
        ${textoOk ? `<button class="boton verde" data-d="ok">${escaparHtml(textoOk)}</button>` : ''}
      </div>
    </div>
  `;
  const cerrar = () => fondo.remove();
  fondo.querySelector('[data-d="cancelar"]').onclick = cerrar;
  fondo.onclick = (e) => {
    if (e.target === fondo) cerrar();
  };
  const btnOk = fondo.querySelector('[data-d="ok"]');
  if (btnOk) {
    btnOk.onclick = async () => {
      btnOk.disabled = true;
      try {
        const seguir = await alAceptar(fondo);
        if (seguir !== false) cerrar();
      } finally {
        btnOk.disabled = false;
      }
    };
  }
  document.body.appendChild(fondo);
  const primero = fondo.querySelector('input, select, textarea');
  if (primero) primero.focus();
  return fondo;
}
