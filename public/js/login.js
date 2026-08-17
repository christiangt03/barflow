// Pantalla de entrada: cada empleado escribe su código personal (PIN)

// El nombre del bar se pide al servidor (aquí todavía no hay sesión)
fetch('/api/local')
  .then((r) => r.json())
  .then((local) => {
    for (const el of document.querySelectorAll('[data-local="nombre"]')) el.textContent = local.nombre || '';
    for (const el of document.querySelectorAll('[data-local="direccion"]')) {
      el.textContent = local.direccion ? '· ' + local.direccion : '';
    }
    document.title = 'Entrar — ' + (local.nombre || 'Bar');
  })
  .catch(() => {});

let pin = '';
const puntos = document.getElementById('puntos');
const error = document.getElementById('error');
const teclado = document.getElementById('teclado');

const teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'];
for (const t of teclas) {
  const btn = document.createElement('button');
  btn.textContent = t;
  if (t === 'OK') btn.className = 'ok';
  btn.onclick = () => pulsar(t);
  teclado.appendChild(btn);
}

document.addEventListener('keydown', (e) => {
  if (/^\d$/.test(e.key)) pulsar(e.key);
  else if (e.key === 'Backspace') pulsar('⌫');
  else if (e.key === 'Enter') pulsar('OK');
});

function pintarPuntos() {
  puntos.innerHTML = '';
  for (let i = 0; i < 6; i++) {
    const p = document.createElement('span');
    p.className = i < pin.length ? 'lleno' : '';
    puntos.appendChild(p);
  }
}
pintarPuntos();

function pulsar(t) {
  error.textContent = '';
  if (t === '⌫') pin = pin.slice(0, -1);
  else if (t === 'OK') return entrar();
  else if (pin.length < 6) pin += t;
  pintarPuntos();
  if (pin.length === 6) entrar();
}

async function entrar() {
  if (pin.length < 4) {
    error.textContent = 'El código tiene al menos 4 números';
    return;
  }
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    const datos = await res.json();
    if (!res.ok) throw new Error(datos.error || 'Error del servidor');
    location.href = 'index.html';
  } catch (e) {
    pin = '';
    pintarPuntos();
    error.textContent = e.message;
    if (navigator.vibrate) navigator.vibrate(200);
  }
}
