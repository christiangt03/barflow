// Administración: disponibilidad, edición de carta, menú del día y caja

let pestana = 'disponibilidad';
const panel = document.getElementById('panel');

for (const btn of document.querySelectorAll('.pestanas button')) {
  btn.onclick = () => {
    pestana = btn.dataset.p;
    for (const b of document.querySelectorAll('.pestanas button')) {
      b.classList.toggle('activa', b === btn);
    }
    pintar();
  };
}

alCambiarEstado(pintar);

function pintar() {
  if (!ESTADO.config) return;
  pintarChapaAlertas();
  panel.innerHTML = '';
  if (pestana === 'disponibilidad') pintarDisponibilidad();
  else if (pestana === 'carta') pintarCarta();
  else if (pestana === 'menu') pintarMenu();
  else if (pestana === 'empleados') pintarEmpleados();
  else if (pestana === 'almacen') pintarAlmacen();
  else if (pestana === 'alertas') pintarAlertas();
  else if (pestana === 'dispositivos') pintarDispositivos();
  else pintarCaja();
}

// El almacén se recarga en cuanto otro gerente mueve algo
socket.on('almacen-cambiado', () => {
  if (pestana === 'almacen') pintar();
});

// Aviso en vivo cuando cocina o barra dicen que falta algo
socket.on('alerta-stock', (a) => {
  avisar(
    `${a.gravedad === 'agotado' ? '⛔ SE HA AGOTADO' : '⚠️ Queda poco'}: ${a.producto} · ${
      a.origen === 'barra' ? 'barra' : 'cocina'
    } (${a.empleado})`
  );
  pitido(a.gravedad === 'agotado' ? 2 : 1);
});

socket.on('alertas-cambiadas', () => {
  if (pestana === 'alertas') pintar();
});

function pintarChapaAlertas() {
  const chapa = document.getElementById('chapa-alertas');
  const n = ESTADO.alertasPendientes || 0;
  chapa.textContent = n;
  chapa.style.display = n ? '' : 'none';
}

function agrupar(articulos) {
  const grupos = {};
  for (const a of articulos) (grupos[a.categoria || 'Sin categoría'] ||= []).push(a);
  return grupos;
}

// ---------- Disponibilidad ----------

function pintarDisponibilidad() {
  panel.insertAdjacentHTML(
    'beforeend',
    '<p class="etiqueta">Toca un artículo para marcarlo como agotado (con motivo) o volver a activarlo. Los camareros lo ven al instante.</p>'
  );
  for (const [categoria, articulos] of Object.entries(agrupar(ESTADO.articulos))) {
    panel.insertAdjacentHTML('beforeend', `<div class="categoria-titulo">${escaparHtml(categoria)}</div>`);
    for (const a of articulos) {
      const btn = document.createElement('button');
      btn.className = 'articulo' + (a.disponible ? '' : ' no-disponible');
      btn.style.opacity = a.disponible ? '' : '0.7';
      btn.innerHTML = `
        <span class="nombre">${a.disponible ? '🟢' : '🔴'} ${escaparHtml(a.nombre)}
          ${a.disponible ? '' : `<span class="aviso">No disponible${a.motivo ? ' — ' + escaparHtml(a.motivo) : ''}</span>`}
        </span>
      `;
      btn.onclick = async () => {
        if (a.disponible) {
          const motivo = prompt(`Motivo por el que "${a.nombre}" no está disponible (ej.: falta calamar):`, '');
          if (motivo === null) return;
          await api('PUT', `/api/articulos/${a.id}`, { disponible: false, motivo });
        } else {
          await api('PUT', `/api/articulos/${a.id}`, { disponible: true });
        }
      };
      panel.appendChild(btn);
    }
  }
}

// ---------- Editar carta ----------

function pintarCarta() {
  panel.insertAdjacentHTML(
    'beforeend',
    `<div class="tarjeta" style="margin-bottom:1rem">
      <div class="categoria-titulo" style="margin-top:0">Añadir artículo a la carta</div>
      <div class="rejilla dos" style="gap:0.5rem">
        <input type="text" id="nuevo-nombre" placeholder="Nombre">
        <input type="text" id="nueva-categoria" placeholder="Categoría (Raciones, Bebidas…)">
        <input type="number" id="nuevo-precio" placeholder="Precio €" step="0.10" min="0">
        <select id="nuevo-destino">
          <option value="">Quién lo prepara (automático)</option>
          <option value="cocina">👩‍🍳 Cocina</option>
          <option value="barra">🍺 Barra</option>
        </select>
        <button class="boton verde" id="btn-anadir">＋ Añadir</button>
      </div>
    </div>`
  );
  panel.querySelector('#btn-anadir').onclick = async () => {
    const nombre = panel.querySelector('#nuevo-nombre').value.trim();
    const categoria = panel.querySelector('#nueva-categoria').value.trim();
    const precio = parseFloat(panel.querySelector('#nuevo-precio').value);
    if (!nombre || !categoria || isNaN(precio)) {
      alert('Rellena nombre, categoría y precio');
      return;
    }
    await api('POST', '/api/articulos', {
      nombre,
      categoria,
      precio,
      tipo: 'carta',
      destino: panel.querySelector('#nuevo-destino').value || undefined,
    });
  };

  panel.insertAdjacentHTML(
    'beforeend',
    `<p class="etiqueta">El icono 👩‍🍳/🍺 dice quién lo prepara. Lo marcado como 🍺 va directo a la
     pantalla de barra: si una mesa pide solo bebidas, la comanda no pasa por cocina.</p>`
  );
  for (const [categoria, articulos] of Object.entries(agrupar(ESTADO.articulos.filter((a) => a.tipo === 'carta')))) {
    panel.insertAdjacentHTML('beforeend', `<div class="categoria-titulo">${escaparHtml(categoria)}</div>`);
    for (const a of articulos) panel.appendChild(filaEditable(a, true));
  }
}

function filaEditable(a, conPrecio) {
  const fila = document.createElement('div');
  fila.className = 'articulo';
  fila.style.cursor = 'default';
  const esBarra = a.destino === 'barra';
  fila.innerHTML = `
    <span class="nombre">${escaparHtml(a.nombre)}</span>
    ${conPrecio ? `<span class="precio">${euros(a.precio)}</span>` : ''}
    ${conPrecio ? `<button class="alm-btn ${esBarra ? 'azul' : ''}" data-a="destino" title="${esBarra ? 'Lo prepara la barra' : 'Lo prepara la cocina'}">${esBarra ? '🍺' : '👩‍🍳'}</button>` : ''}
    ${conPrecio ? '<button class="quitar" data-a="precio" style="background:var(--azul);border:none;color:#fff;border-radius:6px;width:1.9rem;height:1.9rem;cursor:pointer">€</button>' : ''}
    <button class="quitar" data-a="borrar" style="background:var(--rojo);border:none;color:#fff;border-radius:6px;width:1.9rem;height:1.9rem;cursor:pointer">🗑</button>
  `;
  const btnDestino = fila.querySelector('[data-a="destino"]');
  if (btnDestino) {
    btnDestino.onclick = async () => {
      try {
        await api('PUT', `/api/articulos/${a.id}`, { destino: esBarra ? 'cocina' : 'barra' });
      } catch (e) {
        alert(e.message);
      }
    };
  }
  const btnPrecio = fila.querySelector('[data-a="precio"]');
  if (btnPrecio) {
    btnPrecio.onclick = async () => {
      const nuevo = prompt(`Nuevo precio de "${a.nombre}":`, a.precio);
      if (nuevo === null) return;
      const precio = parseFloat(nuevo.replace(',', '.'));
      if (isNaN(precio)) return alert('Precio no válido');
      await api('PUT', `/api/articulos/${a.id}`, { precio });
    };
  }
  fila.querySelector('[data-a="borrar"]').onclick = async () => {
    if (!confirm(`¿Borrar "${a.nombre}" de la carta?`)) return;
    await api('DELETE', `/api/articulos/${a.id}`);
  };
  return fila;
}

// ---------- Menú del día ----------

function pintarMenu() {
  const cfg = ESTADO.config.menuDia;
  panel.insertAdjacentHTML(
    'beforeend',
    `<div class="tarjeta" style="margin-bottom:1rem">
      <div class="categoria-titulo" style="margin-top:0">Precios del menú</div>
      <div class="rejilla dos" style="gap:0.5rem">
        <div><span class="etiqueta">1 plato</span><input type="number" id="precio1" step="0.50" value="${cfg.precio1Plato}"></div>
        <div><span class="etiqueta">2 platos</span><input type="number" id="precio2" step="0.50" value="${cfg.precio2Platos}"></div>
      </div>
      <button class="boton oro" id="guardar-precios" style="margin-top:0.7rem">Guardar precios</button>
    </div>
    <div class="tarjeta" style="margin-bottom:1rem">
      <div class="categoria-titulo" style="margin-top:0">Añadir plato al menú de hoy</div>
      <div class="rejilla dos" style="gap:0.5rem">
        <input type="text" id="plato-nombre" placeholder="Nombre del plato">
        <select id="plato-subtipo">
          <option value="primero">Primero</option>
          <option value="segundo">Segundo</option>
          <option value="postre">Postre</option>
        </select>
      </div>
      <button class="boton verde" id="btn-anadir-plato" style="margin-top:0.7rem">＋ Añadir</button>
    </div>`
  );
  panel.querySelector('#guardar-precios').onclick = async () => {
    await api('PUT', '/api/config', {
      menuDia: {
        precio1Plato: parseFloat(panel.querySelector('#precio1').value),
        precio2Platos: parseFloat(panel.querySelector('#precio2').value),
      },
    });
  };
  panel.querySelector('#btn-anadir-plato').onclick = async () => {
    const nombre = panel.querySelector('#plato-nombre').value.trim();
    if (!nombre) return alert('Escribe el nombre del plato');
    await api('POST', '/api/articulos', {
      nombre,
      categoria: 'Menú del día',
      precio: 0,
      tipo: 'menu',
      subtipo: panel.querySelector('#plato-subtipo').value,
    });
  };

  const nombres = { primero: 'Primeros', segundo: 'Segundos', postre: 'Postres' };
  for (const subtipo of ['primero', 'segundo', 'postre']) {
    panel.insertAdjacentHTML('beforeend', `<div class="categoria-titulo">${nombres[subtipo]}</div>`);
    for (const a of ESTADO.articulos.filter((x) => x.tipo === 'menu' && x.subtipo === subtipo)) {
      panel.appendChild(filaEditable(a, false));
    }
  }
}

// ---------- Dispositivos del bar (tablets, ordenador de cocina...) ----------

// Un aparato nuevo esperando permiso hace que salte la chapa
socket.on('dispositivos-cambiados', () => {
  repasarDispositivos();
  if (pestana === 'dispositivos') pintar();
});

async function repasarDispositivos() {
  try {
    const equipos = await api('GET', '/api/dispositivos');
    const pendientes = equipos.filter((d) => d.estado === 'pendiente').length;
    const chapa = document.getElementById('chapa-dispositivos');
    chapa.textContent = pendientes;
    chapa.style.display = pendientes ? '' : 'none';
    if (pendientes) avisar(`📱 ${pendientes} aparato(s) esperando tu visto bueno`);
  } catch (e) {
    /* si no se puede, no pasa nada */
  }
}

repasarDispositivos();

const ESTADOS_DISPOSITIVO = {
  libre: { icono: '⚪', texto: 'Libre (sin aparato)' },
  pendiente: { icono: '⏳', texto: 'Pendiente de tu visto bueno' },
  autorizado: { icono: '🟢', texto: 'Autorizado' },
  bloqueado: { icono: '⛔', texto: 'Bloqueado' },
};

async function pintarDispositivos() {
  const equipos = await api('GET', '/api/dispositivos');
  if (pestana !== 'dispositivos') return;
  panel.innerHTML = `
    <p class="etiqueta">Los aparatos del bar. Da de alta uno por cada tablet o pantalla
      (“Tablet 1”, “Barra”, “Cocina”…). Al abrir la app en un aparato nuevo, se elige de esta
      lista y aquí le das el visto bueno. Los aparatos de fuera no pueden usar la app.</p>
    <div class="tarjeta" style="margin-bottom:1rem">
      <div class="categoria-titulo" style="margin-top:0">Dar de alta un aparato</div>
      <div class="rejilla dos" style="gap:0.5rem">
        <input type="text" id="disp-nombre" placeholder="Nombre (ej.: Tablet 3)">
        <button class="boton verde" id="disp-alta">＋ Dar de alta</button>
      </div>
    </div>
    <div id="lista-dispositivos"></div>
  `;
  panel.querySelector('#disp-alta').onclick = async () => {
    const nombre = panel.querySelector('#disp-nombre').value.trim();
    if (!nombre) return alert('Ponle un nombre al aparato');
    try {
      await api('POST', '/api/dispositivos', { nombre });
      pintar();
    } catch (e) {
      alert(e.message);
    }
  };

  const lista = panel.querySelector('#lista-dispositivos');
  if (equipos.length === 0) {
    lista.innerHTML = '<div class="vacio">Todavía no hay aparatos dados de alta.</div>';
    return;
  }
  // Primero los que esperan permiso
  const orden = { pendiente: 0, autorizado: 1, libre: 2, bloqueado: 3 };
  for (const d of [...equipos].sort((a, b) => orden[a.estado] - orden[b.estado] || a.nombre.localeCompare(b.nombre))) {
    lista.appendChild(filaDispositivo(d));
  }
}

function filaDispositivo(d) {
  const estado = ESTADOS_DISPOSITIVO[d.estado] || { icono: '❔', texto: d.estado };
  const fila = document.createElement('div');
  fila.className = 'articulo' + (d.estado === 'pendiente' ? ' alerta-stock poco' : '');
  fila.style.cursor = 'default';
  fila.innerHTML = `
    <span class="nombre">${estado.icono} ${escaparHtml(d.nombre)}
      <span class="detalle" style="display:block;font-size:0.8rem;color:var(--texto-suave)">
        ${estado.texto}
        ${d.ultimoUso ? ` · último uso ${horaCorta(d.ultimoUso)}` : ''}
        ${d.ultimoEmpleado ? ` · ${escaparHtml(d.ultimoEmpleado)}` : ''}
      </span>
    </span>
    ${d.estado === 'pendiente' || d.estado === 'bloqueado'
      ? '<button class="alm-btn verde" data-a="autorizar" title="Autorizar">✔</button>' : ''}
    ${d.estado === 'autorizado'
      ? '<button class="alm-btn rojo" data-a="bloquear" title="Bloquear">⛔</button>' : ''}
    ${d.estado !== 'libre'
      ? '<button class="alm-btn azul" data-a="desvincular" title="Desvincular del aparato">⟲</button>' : ''}
    <button class="alm-btn" data-a="renombrar" title="Cambiar el nombre">✎</button>
    <button class="alm-btn rojo" data-a="borrar" title="Borrar">🗑</button>
  `;
  const cambiar = async (cuerpo) => {
    try {
      await api('PUT', `/api/dispositivos/${d.id}`, cuerpo);
      pintar();
    } catch (e) {
      alert(e.message);
    }
  };
  const btn = (accion) => fila.querySelector(`[data-a="${accion}"]`);
  if (btn('autorizar')) btn('autorizar').onclick = () => cambiar({ estado: 'autorizado' });
  if (btn('bloquear')) {
    btn('bloquear').onclick = () => {
      if (!confirm(`¿Bloquear ${d.nombre}? Dejará de poder usar la app.`)) return;
      cambiar({ estado: 'bloqueado' });
    };
  }
  if (btn('desvincular')) {
    btn('desvincular').onclick = () => {
      if (!confirm(`¿Desvincular ${d.nombre}? El aparato tendrá que volver a identificarse.`)) return;
      cambiar({ estado: 'libre' });
    };
  }
  btn('renombrar').onclick = () => {
    const nombre = prompt('Nombre del aparato:', d.nombre);
    if (nombre === null) return;
    cambiar({ nombre: nombre.trim() });
  };
  btn('borrar').onclick = async () => {
    if (!confirm(`¿Borrar ${d.nombre} de la lista de aparatos?`)) return;
    try {
      await api('DELETE', `/api/dispositivos/${d.id}`);
      pintar();
    } catch (e) {
      alert(e.message);
    }
  };
  return fila;
}

// ---------- Avisos de stock que mandan cocina y barra ----------

async function pintarAlertas() {
  const { pendientes, atendidas } = await api('GET', '/api/alertas');
  if (pestana !== 'alertas') return; // por si cambió de pestaña mientras cargaba
  panel.innerHTML = `<p class="etiqueta">Lo que cocina y barra avisan que falta. Al marcar
    “Resuelto” el aviso pasa al historial (apunta antes la compra en Almacén si hace falta).</p>`;

  if (pendientes.length === 0) {
    panel.insertAdjacentHTML('beforeend', '<div class="vacio">No hay avisos pendientes 👍</div>');
  }
  for (const a of pendientes) panel.appendChild(filaAlerta(a));

  if (atendidas.length) {
    panel.insertAdjacentHTML('beforeend', '<div class="categoria-titulo">Resueltos últimamente</div>');
    for (const a of atendidas) {
      panel.insertAdjacentHTML(
        'beforeend',
        `<div class="movimiento">✅ <strong>${escaparHtml(a.producto)}</strong>
          · ${a.origen === 'barra' ? '🍺 barra' : '👩‍🍳 cocina'}
          <span class="quien">avisó ${escaparHtml(a.empleado)} · resolvió ${escaparHtml(a.atendidaPor || '')}
            · ${horaCorta(a.atendida || a.creado)}</span>
        </div>`
      );
    }
  }
}

function filaAlerta(a) {
  const fila = document.createElement('div');
  fila.className = 'articulo alerta-stock ' + (a.gravedad === 'agotado' ? 'agotado' : 'poco');
  fila.style.cursor = 'default';
  fila.innerHTML = `
    <span class="nombre">
      ${a.gravedad === 'agotado' ? '⛔' : '⚠️'} ${escaparHtml(a.producto)}
      ${a.repeticiones > 1 ? `<span class="chapa">×${a.repeticiones}</span>` : ''}
      <span class="detalle" style="display:block;font-size:0.8rem;color:var(--texto-suave)">
        ${a.origen === 'barra' ? '🍺 Barra' : '👩‍🍳 Cocina'} · ${escaparHtml(a.empleado)}
        ${a.dispositivo ? ' · 📱 ' + escaparHtml(a.dispositivo) : ''} · ${horaCorta(a.creado)}
        ${a.nota ? ' · ' + escaparHtml(a.nota) : ''}
      </span>
    </span>
    <button class="alm-btn verde" data-a="resuelto" title="Marcar como resuelto">✔</button>
    <button class="alm-btn rojo" data-a="borrar" title="Borrar aviso">🗑</button>
  `;
  fila.querySelector('[data-a="resuelto"]').onclick = async () => {
    try {
      await api('POST', `/api/alertas/${a.id}/atendida`);
      pintar();
    } catch (e) {
      alert(e.message);
    }
  };
  fila.querySelector('[data-a="borrar"]').onclick = async () => {
    if (!confirm(`¿Borrar el aviso de "${a.producto}"?`)) return;
    try {
      await api('DELETE', `/api/alertas/${a.id}`);
      pintar();
    } catch (e) {
      alert(e.message);
    }
  };
  return fila;
}

// ---------- Almacén (stock) ----------

const UNIDADES = ['uds', 'kg', 'l', 'botellas', 'cajas', 'paquetes'];

async function pintarAlmacen() {
  const { productos, movimientos } = await api('GET', '/api/almacen');
  if (pestana !== 'almacen') return;
  panel.innerHTML = '';

  // Aviso de productos por debajo del mínimo
  const bajos = productos.filter((p) => p.cantidad <= p.minimo);
  if (bajos.length) {
    panel.insertAdjacentHTML(
      'beforeend',
      `<div class="tarjeta stock-aviso" style="margin-bottom:1rem">
        <strong>⚠️ Hay que reponer:</strong>
        ${bajos.map((p) => `${escaparHtml(p.nombre)} (quedan ${p.cantidad} ${escaparHtml(p.unidad)})`).join(' · ')}
      </div>`
    );
  }

  // Alta de producto
  panel.insertAdjacentHTML(
    'beforeend',
    `<div class="tarjeta" style="margin-bottom:1rem">
      <div class="categoria-titulo" style="margin-top:0">Añadir producto al almacén</div>
      <div class="rejilla dos" style="gap:0.5rem">
        <input type="text" id="alm-nombre" placeholder="Nombre (ej.: Gambas)">
        <input type="text" id="alm-categoria" placeholder="Categoría (Congelados, Bebidas…)" list="alm-categorias">
        <datalist id="alm-categorias">
          ${[...new Set(productos.map((p) => p.categoria))].map((c) => `<option value="${escaparHtml(c)}">`).join('')}
        </datalist>
        <select id="alm-unidad">${UNIDADES.map((u) => `<option>${u}</option>`).join('')}</select>
        <input type="number" id="alm-cantidad" placeholder="Cantidad que hay" step="0.1" min="0">
        <input type="number" id="alm-minimo" placeholder="Avisar si baja de…" step="0.1" min="0">
        <button class="boton verde" id="alm-alta">＋ Añadir</button>
      </div>
    </div>`
  );
  panel.querySelector('#alm-alta').onclick = async () => {
    const nombre = panel.querySelector('#alm-nombre').value.trim();
    if (!nombre) return alert('Escribe el nombre del producto');
    try {
      await api('POST', '/api/almacen', {
        nombre,
        categoria: panel.querySelector('#alm-categoria').value.trim(),
        unidad: panel.querySelector('#alm-unidad').value,
        cantidad: parseFloat(panel.querySelector('#alm-cantidad').value) || 0,
        minimo: parseFloat(panel.querySelector('#alm-minimo').value) || 0,
      });
    } catch (e) {
      alert(e.message);
    }
  };

  // Lista por categorías
  for (const [categoria, lista] of Object.entries(agrupar(productos))) {
    panel.insertAdjacentHTML('beforeend', `<div class="categoria-titulo">${escaparHtml(categoria)}</div>`);
    for (const p of lista) panel.appendChild(filaProducto(p));
  }

  // Últimos movimientos
  if (movimientos.length) {
    panel.insertAdjacentHTML('beforeend', '<div class="categoria-titulo">Últimos movimientos</div>');
    for (const m of movimientos) {
      const icono = m.tipo === 'entrada' ? '🟢 Entrada' : m.tipo === 'salida' ? '🔴 Salida' : '🔵 Recuento';
      panel.insertAdjacentHTML(
        'beforeend',
        `<div class="movimiento">${icono} · <strong>${escaparHtml(m.producto)}</strong>
          ${m.tipo === 'recuento' ? `ahora ${m.despues}` : `${m.cantidad} → quedan ${m.despues}`}
          ${m.motivo ? ` · ${escaparHtml(m.motivo)}` : ''}
          <span class="quien">${escaparHtml(m.empleado)} · ${horaCorta(m.fecha)}</span>
        </div>`
      );
    }
  }
}

function filaProducto(p) {
  const bajo = p.cantidad <= p.minimo;
  const fila = document.createElement('div');
  fila.className = 'articulo';
  fila.style.cursor = 'default';
  fila.innerHTML = `
    <span class="nombre">${escaparHtml(p.nombre)}
      <span class="detalle" style="display:block;font-size:0.8rem">
        <span style="color:${bajo ? 'var(--rojo)' : 'var(--texto-suave)'};font-weight:${bajo ? '700' : '400'}">
          ${bajo ? '⚠️ ' : ''}${p.cantidad} ${escaparHtml(p.unidad)}</span>
        <span style="color:var(--texto-suave)"> · avisa en ${p.minimo}</span>
      </span>
    </span>
    <button class="alm-btn verde" data-a="entrada" title="Entrada (compra)">＋</button>
    <button class="alm-btn rojo" data-a="salida" title="Salida (gasto o merma)">－</button>
    <button class="alm-btn azul" data-a="recuento" title="Recuento (corregir cantidad)">⟳</button>
    <button class="alm-btn" data-a="editar" title="Editar nombre y mínimo">✎</button>
    <button class="alm-btn rojo" data-a="borrar" title="Borrar producto">🗑</button>
  `;
  const mover = async (tipo, cantidad, motivo) => {
    try {
      await api('POST', `/api/almacen/${p.id}/movimiento`, { tipo, cantidad, motivo });
    } catch (e) {
      alert(e.message);
    }
  };
  fila.querySelector('[data-a="entrada"]').onclick = () => {
    const c = prompt(`Entrada de "${p.nombre}" — ¿cuántos ${p.unidad} llegan?`);
    if (c === null || c.trim() === '') return;
    mover('entrada', parseFloat(c.replace(',', '.')));
  };
  fila.querySelector('[data-a="salida"]').onclick = () => {
    const c = prompt(`Salida de "${p.nombre}" — ¿cuántos ${p.unidad} se gastan o tiran?`);
    if (c === null || c.trim() === '') return;
    const motivo = prompt('Motivo (opcional, ej.: caducado, rotura):', '') || '';
    mover('salida', parseFloat(c.replace(',', '.')), motivo);
  };
  fila.querySelector('[data-a="recuento"]').onclick = () => {
    const c = prompt(`Recuento de "${p.nombre}" — ¿cuántos ${p.unidad} hay REALMENTE?`, p.cantidad);
    if (c === null || c.trim() === '') return;
    mover('recuento', parseFloat(c.replace(',', '.')), 'recuento');
  };
  fila.querySelector('[data-a="editar"]').onclick = async () => {
    const nombre = prompt('Nombre del producto:', p.nombre);
    if (nombre === null) return;
    const minimo = prompt(`¿Avisar cuando queden menos de cuántos ${p.unidad}?`, p.minimo);
    if (minimo === null) return;
    try {
      await api('PUT', `/api/almacen/${p.id}`, {
        nombre: nombre.trim() || p.nombre,
        minimo: parseFloat(minimo.replace(',', '.')) || 0,
      });
    } catch (e) {
      alert(e.message);
    }
  };
  fila.querySelector('[data-a="borrar"]').onclick = async () => {
    if (!confirm(`¿Borrar "${p.nombre}" del almacén?`)) return;
    try {
      await api('DELETE', `/api/almacen/${p.id}`);
    } catch (e) {
      alert(e.message);
    }
  };
  return fila;
}

// ---------- Empleados y sus códigos ----------

async function pintarEmpleados() {
  const empleados = await api('GET', '/api/empleados');
  if (pestana !== 'empleados') return;
  panel.innerHTML = `
    <div class="tarjeta" style="margin-bottom:1rem">
      <div class="categoria-titulo" style="margin-top:0">Dar de alta un empleado</div>
      <div class="rejilla dos" style="gap:0.5rem">
        <input type="text" id="emp-nombre" placeholder="Nombre">
        <select id="emp-rol">
          <option value="camarero">Camarero</option>
          <option value="gerente">Gerente</option>
        </select>
        <input type="number" id="emp-pin" placeholder="Código (4-6 números)">
        <button class="boton verde" id="btn-alta">＋ Dar de alta</button>
      </div>
      <p class="etiqueta" style="margin-top:0.5rem">Cada empleado entra en la app con su código.
      Los camareros solo pueden tomar comandas y cobrar; el gerente además entra aquí, a Administración.</p>
    </div>
    <div id="lista-empleados"></div>
  `;
  panel.querySelector('#btn-alta').onclick = async () => {
    const nombre = panel.querySelector('#emp-nombre').value.trim();
    const pin = panel.querySelector('#emp-pin').value.trim();
    const rol = panel.querySelector('#emp-rol').value;
    if (!nombre) return alert('Escribe el nombre');
    try {
      await api('POST', '/api/empleados', { nombre, pin, rol });
      pintar();
    } catch (e) {
      alert(e.message);
    }
  };
  const lista = panel.querySelector('#lista-empleados');
  for (const emp of empleados) {
    const fila = document.createElement('div');
    fila.className = 'articulo';
    fila.style.cursor = 'default';
    fila.innerHTML = `
      <span class="nombre">${emp.rol === 'gerente' ? '👑' : '👤'} ${escaparHtml(emp.nombre)}
        <span class="detalle" style="display:block;color:var(--texto-suave);font-size:0.8rem">${emp.rol === 'gerente' ? 'Gerente' : 'Camarero'}</span>
      </span>
      <button class="quitar" data-a="pin" style="background:var(--azul);border:none;color:#fff;border-radius:6px;padding:0 0.5rem;height:1.9rem;cursor:pointer;font-size:0.8rem">Código</button>
      <button class="quitar" data-a="borrar" style="background:var(--rojo);border:none;color:#fff;border-radius:6px;width:1.9rem;height:1.9rem;cursor:pointer">🗑</button>
    `;
    fila.querySelector('[data-a="pin"]').onclick = async () => {
      const pin = prompt(`Nuevo código para ${emp.nombre} (4-6 números):`);
      if (pin === null) return;
      try {
        await api('PUT', `/api/empleados/${emp.id}`, { pin: pin.trim() });
        alert('Código cambiado');
      } catch (e) {
        alert(e.message);
      }
    };
    fila.querySelector('[data-a="borrar"]').onclick = async () => {
      if (!confirm(`¿Dar de baja a ${emp.nombre}? Ya no podrá entrar en la app.`)) return;
      try {
        await api('DELETE', `/api/empleados/${emp.id}`);
        pintar();
      } catch (e) {
        alert(e.message);
      }
    };
    lista.appendChild(fila);
  }
}

// ---------- Caja ----------

async function pintarCaja() {
  const datos = await api('GET', '/api/historial');
  if (pestana !== 'caja') return; // por si cambió de pestaña mientras cargaba
  panel.innerHTML = `
    <div class="tarjeta">
      <div class="categoria-titulo" style="margin-top:0">Caja de hoy (${datos.dia})</div>
      <div class="total-fila"><span>💵 Efectivo</span><span class="cifra">${euros(datos.totalEfectivo)}</span></div>
      <div class="total-fila"><span>💳 Tarjeta</span><span class="cifra">${euros(datos.totalTarjeta)}</span></div>
      <div class="total-fila" style="border-top:2px solid var(--oro)"><span>TOTAL</span><span class="cifra">${euros(datos.total)}</span></div>
      <button class="boton oro" id="btn-cierre-z" style="margin-top:0.5rem">🖨 Cierre de caja (informe Z)</button>
    </div>
    <div id="zona-zetas"></div>
    <div class="categoria-titulo">Mesas cobradas hoy</div>
    <div id="lista-cierres"></div>
    <div id="zona-anulaciones"></div>
  `;
  panel.querySelector('#btn-cierre-z').onclick = async () => {
    const mesasAbiertas = new Set(ESTADO.pedidos.map((p) => p.zona + '-' + p.mesa)).size;
    if (
      mesasAbiertas > 0 &&
      !confirm(`⚠️ Todavía hay ${mesasAbiertas} mesa(s) sin cobrar; lo que cobren después no entrará en este informe.\n\n¿Hacer el cierre igualmente?`)
    ) {
      return;
    }
    if (!confirm(`Se cierra la caja del día con ${euros(datos.total)} y se imprime el informe Z. ¿Seguir?`)) return;
    try {
      const informe = await api('POST', '/api/caja/cierre');
      imprimirInformeZ(informe);
      pintar();
    } catch (e) {
      alert(e.message);
    }
  };
  // Cierres de caja ya hechos hoy (se pueden reimprimir)
  const zonaZetas = panel.querySelector('#zona-zetas');
  if (datos.zetas && datos.zetas.length) {
    zonaZetas.innerHTML = '<div class="categoria-titulo">Cierres de caja de hoy</div>';
    for (const z of datos.zetas) {
      const fila = document.createElement('div');
      fila.className = 'articulo';
      fila.style.cursor = 'default';
      fila.innerHTML = `
        <span class="nombre">📄 Informe Z nº ${z.numero}
          <span class="detalle" style="display:block;color:var(--texto-suave);font-size:0.8rem">
            ${horaCorta(z.fecha)} · ${escaparHtml(z.cerradoPor)} · ${z.mesasCobradas} mesa(s)</span>
        </span>
        <span class="precio">${euros(z.total)}</span>
        <button class="quitar" style="background:var(--azul);border:none;color:#fff;border-radius:6px;padding:0 0.5rem;height:1.9rem;cursor:pointer;font-size:0.8rem">🖨</button>
      `;
      fila.querySelector('.quitar').onclick = () => imprimirInformeZ(z);
      zonaZetas.appendChild(fila);
    }
  }
  // Comandas anuladas hoy: quién, por qué y cuánto sumaban
  const zonaAnulaciones = panel.querySelector('#zona-anulaciones');
  if (datos.anulaciones && datos.anulaciones.length) {
    zonaAnulaciones.innerHTML = '<div class="categoria-titulo">⚠️ Comandas anuladas hoy</div>';
    for (const a of [...datos.anulaciones].reverse()) {
      const importe = a.pedido.items.reduce((s, it) => s + it.precio * it.cantidad, 0);
      zonaAnulaciones.insertAdjacentHTML(
        'beforeend',
        `<div class="movimiento"><span class="insignia ${a.pedido.zona}">${escaparHtml(nombreZona(a.pedido.zona))}</span>
          Mesa ${a.pedido.mesa} · ${euros(importe)} · <strong>${escaparHtml(a.motivo)}</strong>
          <span class="quien">${escaparHtml(a.anuladoPor)} · ${horaCorta(a.fecha)} · ${a.pedido.items.map((it) => it.cantidad + '× ' + it.nombre).join(', ')}</span>
        </div>`
      );
    }
  }
  const listaCierres = panel.querySelector('#lista-cierres');
  if (datos.cierres.length === 0) {
    listaCierres.innerHTML = '<div class="vacio">Todavía no se ha cobrado ninguna mesa hoy.</div>';
    return;
  }
  for (const c of [...datos.cierres].reverse()) {
    listaCierres.insertAdjacentHTML(
      'beforeend',
      `<div class="articulo" style="cursor:default">
        <span class="nombre"><span class="insignia ${c.zona}">${escaparHtml(nombreZona(c.zona))}</span>
          Mesa ${c.mesa} · ${horaCorta(c.cobrado)} · ${c.metodoPago === 'efectivo' ? '💵' : '💳'}${
            c.cobradoPor ? ' · 👤 ' + escaparHtml(c.cobradoPor) : ''
          }${c.dispositivo ? ' · 📱 ' + escaparHtml(c.dispositivo) : ''}</span>
        <span class="precio">${euros(c.total)}</span>
      </div>`
    );
  }
}

// Informe Z en formato ticket (72 mm), listo para archivar
function imprimirInformeZ(z) {
  const fecha = new Date(z.fecha);
  const porEmpleado = (z.porEmpleado || [])
    .map(
      (e) => `<div class="fila-cuenta"><span class="concepto">${escaparHtml(e.nombre)} (${e.mesas} mesa${e.mesas === 1 ? '' : 's'})</span>
        <span>${euros(e.total)}</span></div>
        <div class="detalle">💵 ${euros(e.efectivo)} · 💳 ${euros(e.tarjeta)}</div>`
    )
    .join('');
  const porDispositivo = (z.porDispositivo || [])
    .map(
      (d) => `<div class="fila-cuenta"><span class="concepto">${escaparHtml(d.nombre)} (${d.mesas} mesa${d.mesas === 1 ? '' : 's'})</span>
        <span>${euros(d.total)}</span></div>`
    )
    .join('');
  document.getElementById('zona-ticket').innerHTML = `
    <h2>${escaparHtml(nombreDelLocal().toUpperCase())}</h2>
    <div class="grande">CIERRE DE CAJA — Z nº ${z.numero}</div>
    <div style="text-align:center">${fecha.toLocaleDateString('es-ES')} · ${horaCorta(z.fecha)}</div>
    <div style="text-align:center">Cerrado por: ${escaparHtml(z.cerradoPor)}</div>
    <hr>
    <div class="fila-cuenta"><span class="concepto">Mesas cobradas</span><span>${z.mesasCobradas}</span></div>
    <div class="fila-cuenta"><span class="concepto">💵 Efectivo</span><span>${euros(z.totalEfectivo)}</span></div>
    <div class="fila-cuenta"><span class="concepto">💳 Tarjeta</span><span>${euros(z.totalTarjeta)}</span></div>
    <div class="fila-cuenta grande-total"><span>TOTAL DEL DÍA</span><span>${euros(z.total)}</span></div>
    <hr>
    ${porEmpleado ? `<div style="text-align:center">— Por empleado —</div>${porEmpleado}<hr>` : ''}
    ${porDispositivo ? `<div style="text-align:center">— Por aparato —</div>${porDispositivo}<hr>` : ''}
    <div class="fila-cuenta"><span class="concepto">Comandas anuladas</span><span>${z.numAnulaciones}</span></div>
    ${z.numAnulaciones ? `<div class="fila-cuenta"><span class="concepto">Importe anulado</span><span>${euros(z.importeAnulado)}</span></div>` : ''}
  `;
  window.print();
}
