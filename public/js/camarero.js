// Pantalla de camareros: zona -> mesa -> comanda (carta / menú del día / cuenta)

const vista = {
  pantalla: 'zonas', // zonas | mesas | mesa
  zona: null,
  mesa: null,
  pestana: 'carta', // carta | menu | cuenta
  comanda: [], // líneas pendientes de enviar a cocina
  menuEnCurso: null, // { tipo: '1plato'|'2platos'|'postre', primero, segundo, postre }
  claveIdem: null, // identifica el envío: si se manda dos veces, solo entra una
  enviando: false, // mientras está en marcha, el botón de enviar queda bloqueado
};

const contenido = document.getElementById('contenido');
const titulo = document.getElementById('titulo');

document.getElementById('btn-volver').onclick = () => {
  if (vista.pantalla === 'mesa') {
    if (vista.comanda.length > 0 && !confirm('Hay artículos sin enviar a cocina. ¿Salir igualmente?')) return;
    vaciarComanda();
    vista.menuEnCurso = null;
    vista.pantalla = 'mesas';
  } else if (vista.pantalla === 'mesas') {
    vista.pantalla = 'zonas';
  } else {
    location.href = 'index.html';
  }
  pintar();
};

alCambiarEstado(pintar);

// Aviso cuando cocina o barra marcan una comanda como lista
socket.on('comanda-lista', (p) => {
  if (p.destino === 'barra') {
    // Las bebidas hay que ir a recogerlas: aviso más llamativo
    avisar(`🍺 BEBIDAS LISTAS — ${nombreZona(p.zona)} · Mesa ${p.mesa}`);
    pitido(2);
    vibrar([300, 120, 300]);
  } else {
    avisar(`✅ ${nombreZona(p.zona)} · Mesa ${p.mesa} — comanda lista`);
    vibrar([200, 100, 200]);
  }
});

function pintar() {
  if (!ESTADO.config) return;
  pintarBebidasPorRecoger();
  if (vista.pantalla === 'zonas') pintarZonas();
  else if (vista.pantalla === 'mesas') pintarMesas();
  else pintarMesa();
}

// ---------- Aviso permanente: bebidas listas en barra ----------
// Se ve en cualquier pantalla del camarero hasta que alguien las recoge.

function pintarBebidasPorRecoger() {
  const zona = document.getElementById('por-recoger');
  const listas = ESTADO.pedidos.filter((p) => p.destino === 'barra' && p.estado === 'listo');
  if (listas.length === 0) {
    zona.innerHTML = '';
    zona.style.display = 'none';
    return;
  }
  zona.style.display = '';
  zona.innerHTML = '<div class="titulo-recoger">🍺 Bebidas listas en barra</div>';
  for (const p of listas) {
    const fila = document.createElement('div');
    fila.className = 'fila-recoger';
    fila.innerHTML = `
      <span class="donde"><span class="insignia ${p.zona}">${escaparHtml(nombreZona(p.zona))}</span> Mesa ${p.mesa}</span>
      <span class="que">${p.items.map((i) => `${i.cantidad}× ${escaparHtml(i.nombre)}`).join(', ')}</span>
      <button class="boton verde">Recogido</button>
    `;
    const btn = fila.querySelector('button');
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await api('POST', `/api/pedidos/${p.id}/recogido`);
      } catch (e) {
        btn.disabled = false;
        alert('No se pudo confirmar: ' + e.message);
      }
    };
    zona.appendChild(fila);
  }
}

// ---------- Elegir zona ----------

function pintarZonas() {
  titulo.textContent = 'Elegir zona';
  contenido.innerHTML = '<div class="rejilla" style="margin-top:1rem"></div>';
  const rejilla = contenido.querySelector('.rejilla');
  for (const zona of ESTADO.config.zonas) {
    const abiertas = new Set(
      ESTADO.pedidos.filter((p) => p.zona === zona.id).map((p) => p.mesa)
    ).size;
    const btn = document.createElement('button');
    btn.className = 'boton oro';
    btn.style.padding = '1.6rem';
    btn.innerHTML = `${escaparHtml(zona.nombre)}<br><small style="font-weight:400">${abiertas} mesa(s) abiertas</small>`;
    btn.onclick = () => {
      vista.zona = zona.id;
      vista.pantalla = 'mesas';
      pintar();
    };
    rejilla.appendChild(btn);
  }
}

// ---------- Elegir mesa ----------

function pintarMesas() {
  const zona = ESTADO.config.zonas.find((z) => z.id === vista.zona);
  titulo.textContent = zona.nombre + ' — elegir mesa';
  contenido.innerHTML = '<div class="rejilla mesas" style="margin-top:1rem"></div>';
  const rejilla = contenido.querySelector('.rejilla');
  for (let n = 1; n <= zona.mesas; n++) {
    const total = totalMesa(vista.zona, n);
    const btn = document.createElement('button');
    btn.className = 'mesa' + (total > 0 ? ' ocupada' : '');
    btn.innerHTML = `${n}` + (total > 0 ? `<span class="importe">${euros(total)}</span>` : '');
    btn.onclick = () => {
      vista.mesa = n;
      vista.pantalla = 'mesa';
      vista.pestana = 'carta';
      pintar();
    };
    rejilla.appendChild(btn);
  }
}

// ---------- Mesa: carta / menú / cuenta ----------

function pintarMesa() {
  const zona = ESTADO.config.zonas.find((z) => z.id === vista.zona);
  titulo.textContent = `${zona.nombre} · Mesa ${vista.mesa}`;

  contenido.innerHTML = `
    <div class="pestanas">
      <button data-p="carta">Carta</button>
      <button data-p="menu">Menú del día</button>
      <button data-p="cuenta">Cuenta</button>
    </div>
    <div id="panel" class="con-barra-inferior"></div>
  `;
  for (const btn of contenido.querySelectorAll('.pestanas button')) {
    btn.classList.toggle('activa', btn.dataset.p === vista.pestana);
    btn.onclick = () => {
      vista.pestana = btn.dataset.p;
      pintar();
    };
  }
  const panel = document.getElementById('panel');
  if (vista.pestana === 'cuenta') {
    pintarCuenta(panel);
    return;
  }
  // Carta y menú: platos a la izquierda y resumen de la comanda a la derecha
  // (en pantallas estrechas, el resumen queda debajo)
  panel.innerHTML = '<div class="panel-mesa"><div id="platos"></div><div id="resumen"></div></div>';
  const platos = panel.querySelector('#platos');
  if (vista.pestana === 'carta') pintarCarta(platos);
  else pintarMenuDia(platos);
  pintarComandaPendiente(panel.querySelector('#resumen'));
}

// ----- Pestaña Carta -----

function pintarCarta(panel) {
  const porCategoria = {};
  for (const a of ESTADO.articulos.filter((x) => x.tipo === 'carta')) {
    (porCategoria[a.categoria] ||= []).push(a);
  }
  for (const [categoria, articulos] of Object.entries(porCategoria)) {
    const h = document.createElement('div');
    h.className = 'categoria-titulo';
    h.textContent = categoria;
    panel.appendChild(h);
    for (const a of articulos) panel.appendChild(botonArticulo(a));
  }
}

function botonArticulo(a) {
  const btn = document.createElement('button');
  btn.className = 'articulo' + (a.disponible ? '' : ' no-disponible');
  btn.innerHTML = `
    <span class="nombre">${escaparHtml(a.nombre)}
      ${a.disponible ? '' : `<span class="aviso">⛔ No disponible${a.motivo ? ' — ' + escaparHtml(a.motivo) : ''}</span>`}
    </span>
    <span class="precio">${euros(a.precio)}</span>
  `;
  btn.onclick = () => {
    if (!a.disponible) {
      alert('No disponible' + (a.motivo ? ': ' + a.motivo : ''));
      return;
    }
    const c = prompt(`${a.nombre} — ¿cuántos?`, '1');
    if (c === null) return;
    const cantidad = parseInt(c.trim(), 10);
    if (!cantidad || cantidad < 1) return;
    const existente = vista.comanda.find((l) => l.articuloId === a.id && !l.menu);
    if (existente) existente.cantidad += cantidad;
    else vista.comanda.push({ articuloId: a.id, nombre: a.nombre, precio: a.precio, cantidad });
    pintar();
  };
  return btn;
}

// ----- Pestaña Menú del día -----

function pintarMenuDia(panel) {
  const cfg = ESTADO.config.menuDia;
  const platos = (subtipo) => ESTADO.articulos.filter((a) => a.tipo === 'menu' && a.subtipo === subtipo);

  if (!vista.menuEnCurso) {
    panel.innerHTML = `
      <p class="etiqueta" style="margin-top:0.5rem">${escaparHtml(cfg.nota || '')}</p>
      <div class="rejilla" style="margin-top:0.8rem">
        <button class="boton oro" id="m1">Menú 1 plato — ${euros(cfg.precio1Plato)}</button>
        <button class="boton oro" id="m2">Menú 2 platos — ${euros(cfg.precio2Platos)}</button>
      </div>
    `;
    panel.querySelector('#m1').onclick = () => {
      vista.menuEnCurso = { tipo: '1plato', primero: null, segundo: null, postre: null };
      pintar();
    };
    panel.querySelector('#m2').onclick = () => {
      vista.menuEnCurso = { tipo: '2platos', primero: null, segundo: null, postre: null };
      pintar();
    };
    return;
  }

  const m = vista.menuEnCurso;
  panel.innerHTML = `<p class="etiqueta" style="margin-top:0.5rem">Menú de ${m.tipo === '1plato' ? '1 plato' : '2 platos'} — toca para elegir:</p>`;

  const seccion = (subtipoNombre, subtipo, clave) => {
    const h = document.createElement('div');
    h.className = 'categoria-titulo';
    h.textContent = subtipoNombre;
    panel.appendChild(h);
    for (const a of platos(subtipo)) {
      const btn = document.createElement('button');
      const elegido = m[clave] === a.nombre;
      btn.className = 'articulo' + (a.disponible ? '' : ' no-disponible');
      if (elegido) btn.style.outline = '2px solid var(--oro)';
      btn.innerHTML = `<span class="nombre">${elegido ? '✔ ' : ''}${escaparHtml(a.nombre)}
        ${a.disponible ? '' : `<span class="aviso">⛔ No disponible${a.motivo ? ' — ' + escaparHtml(a.motivo) : ''}</span>`}</span>`;
      btn.onclick = () => {
        if (!a.disponible) return;
        m[clave] = elegido ? null : a.nombre;
        pintar();
      };
      panel.appendChild(btn);
    }
  };

  if (m.tipo === '2platos') {
    seccion('Primer plato', 'primero', 'primero');
    seccion('Segundo plato', 'segundo', 'segundo');
  } else {
    seccion('Plato (elige primero o segundo)', 'primero', 'primero');
    for (const a of platos('segundo')) {
      const btn = document.createElement('button');
      const elegido = m.primero === a.nombre;
      btn.className = 'articulo' + (a.disponible ? '' : ' no-disponible');
      if (elegido) btn.style.outline = '2px solid var(--oro)';
      btn.innerHTML = `<span class="nombre">${elegido ? '✔ ' : ''}${escaparHtml(a.nombre)}
        ${a.disponible ? '' : `<span class="aviso">⛔ No disponible${a.motivo ? ' — ' + escaparHtml(a.motivo) : ''}</span>`}</span>`;
      btn.onclick = () => {
        if (!a.disponible) return;
        m.primero = elegido ? null : a.nombre;
        pintar();
      };
      panel.appendChild(btn);
    }
  }
  seccion('Postre o café', 'postre', 'postre');

  const acciones = document.createElement('div');
  acciones.className = 'rejilla dos';
  acciones.style.marginTop = '1rem';
  acciones.innerHTML = `
    <button class="boton rojo" id="cancelar-menu">Cancelar</button>
    <button class="boton verde" id="anadir-menu">Añadir menú</button>
  `;
  panel.appendChild(acciones);
  acciones.querySelector('#cancelar-menu').onclick = () => {
    vista.menuEnCurso = null;
    pintar();
  };
  acciones.querySelector('#anadir-menu').onclick = () => {
    const completo = m.tipo === '2platos' ? m.primero && m.segundo : m.primero;
    if (!completo) {
      alert(m.tipo === '2platos' ? 'Elige primer y segundo plato' : 'Elige un plato');
      return;
    }
    const precio = m.tipo === '2platos' ? cfg.precio2Platos : cfg.precio1Plato;
    const partes = [m.primero, m.segundo, m.postre && 'Postre: ' + m.postre].filter(Boolean);
    vista.comanda.push({
      nombre: 'Menú del día (' + (m.tipo === '2platos' ? '2 platos' : '1 plato') + ')',
      precio,
      cantidad: 1,
      menu: { tipo: m.tipo, primero: m.primero, segundo: m.segundo, postre: m.postre },
      detalle: partes.join(' · '),
    });
    vista.menuEnCurso = null;
    pintar();
  };
}

// ----- Comanda pendiente de enviar (aparece bajo carta y menú) -----

function pintarComandaPendiente(panel) {
  if (vista.comanda.length === 0) {
    // En pantallas anchas la columna derecha muestra un recordatorio
    panel.innerHTML = `<div class="tarjeta resumen-comanda solo-ancho" style="color:var(--texto-suave)">
      <div class="categoria-titulo" style="margin-top:0">Comanda sin enviar</div>
      Toca los platos para ir añadiendo.
    </div>`;
    return;
  }
  const caja = document.createElement('div');
  caja.className = 'tarjeta resumen-comanda';
  caja.innerHTML = '<div class="categoria-titulo" style="margin-top:0">Comanda sin enviar</div>';
  let total = 0;
  vista.comanda.forEach((linea, i) => {
    total += linea.precio * linea.cantidad;
    const fila = document.createElement('div');
    fila.className = 'linea-comanda';
    fila.innerHTML = `
      <span class="cantidad">${linea.cantidad}×</span>
      <span class="nombre">${escaparHtml(linea.nombre)}
        ${linea.detalle ? `<span class="detalle">${escaparHtml(linea.detalle)}</span>` : ''}
        ${linea.notas ? `<span class="nota">📝 ${escaparHtml(linea.notas)}</span>` : ''}
      </span>
      <span class="precio">${euros(linea.precio * linea.cantidad)}</span>
      <button class="anotar" title="Nota para cocina">📝</button>
      <button class="quitar">✕</button>
    `;
    fila.querySelector('.anotar').onclick = () => {
      const nota = prompt('Nota para cocina (ej.: sin cebolla, poco hecho):', linea.notas || '');
      if (nota === null) return;
      linea.notas = nota.trim();
      pintar();
    };
    fila.querySelector('.quitar').onclick = () => quitarDeLaComanda(i);
    caja.appendChild(fila);
  });
  caja.insertAdjacentHTML(
    'beforeend',
    `<div class="total-fila"><span>Total comanda</span><span class="cifra">${euros(total)}</span></div>`
  );
  // Adónde va cada cosa: si solo hay bebidas, la comanda ni pasa por cocina
  const aBarra = vista.comanda.filter((l) => destinoDeLinea(l) === 'barra').length;
  const aCocina = vista.comanda.length - aBarra;
  caja.insertAdjacentHTML(
    'beforeend',
    `<div class="reparto">${
      aCocina && aBarra
        ? '👩‍🍳 Cocina + 🍺 Barra (se envían por separado)'
        : aBarra
          ? '🍺 Va solo a la barra'
          : '👩‍🍳 Va a cocina'
    }</div>`
  );
  const btn = document.createElement('button');
  btn.className = 'boton verde';
  btn.disabled = vista.enviando;
  btn.textContent = vista.enviando ? '⏳ Enviando…' : aBarra && !aCocina ? '📤 Enviar a barra' : '📤 Enviar a cocina';
  btn.onclick = () => enviarComanda(btn);
  caja.appendChild(btn);
  panel.appendChild(caja);
}

// Quién prepara esta línea (el servidor lo vuelve a comprobar por su cuenta)
function destinoDeLinea(linea) {
  if (!linea.articuloId) return 'cocina';
  const articulo = ESTADO.articulos.find((a) => a.id === linea.articuloId);
  return articulo && articulo.destino === 'barra' ? 'barra' : 'cocina';
}

// La clave se crea al primer intento y se mantiene mientras la comanda no salga:
// si hay que reintentar por un fallo de red, el servidor sabe que es el mismo envío.
function claveDeEnvio() {
  vista.claveIdem ||= nuevaClave();
  return vista.claveIdem;
}

function vaciarComanda() {
  vista.comanda = [];
  vista.claveIdem = null;
  vista.enviando = false;
}

// Quitar líneas de la comanda sin tener que dar N veces a la ✕:
// si hay varias unidades, se elige cuántas se quitan o se quitan todas.
function quitarDeLaComanda(indice) {
  const linea = vista.comanda[indice];
  if (!linea) return;
  if (linea.cantidad === 1) {
    vista.comanda.splice(indice, 1);
    pintar();
    return;
  }

  const quitar = (cuantas) => {
    const linea = vista.comanda[indice];
    if (!linea) return;
    if (cuantas >= linea.cantidad) vista.comanda.splice(indice, 1);
    else linea.cantidad -= cuantas;
    pintar();
  };

  // Botones rápidos para las cantidades pequeñas (lo normal en una mesa)
  const sueltos = [];
  for (let n = 1; n < linea.cantidad && n <= 5; n++) sueltos.push(n);

  const dialogo = abrirDialogo({
    titulo: `Quitar ${linea.nombre}`,
    // Con pocas unidades bastan los botones rápidos; con muchas, el campo
    textoOk: linea.cantidad > 6 ? 'Quitar esa cantidad' : null,
    cuerpo: `
      <p class="etiqueta">Hay ${linea.cantidad} en la comanda. ¿Cuántos quitas?</p>
      <div class="rejilla botones-quitar">
        ${sueltos.map((n) => `<button type="button" class="boton" data-q="${n}">Quitar ${n}</button>`).join('')}
        <button type="button" class="boton rojo" data-q="${linea.cantidad}">Quitar todos (${linea.cantidad})</button>
      </div>
      ${linea.cantidad > 6
        ? `<span class="etiqueta" style="margin-top:0.8rem">O escribe la cantidad:</span>
           <input type="number" id="q-cuantos" min="1" max="${linea.cantidad}" value="1" inputmode="numeric">`
        : ''}
    `,
    alAceptar: (d) => {
      const campo = d.querySelector('#q-cuantos');
      const cuantas = campo ? parseInt(campo.value, 10) : 1;
      if (!cuantas || cuantas < 1) return false;
      quitar(cuantas);
    },
  });

  for (const btn of dialogo.querySelectorAll('[data-q]')) {
    btn.onclick = () => {
      quitar(Number(btn.dataset.q));
      dialogo.remove();
    };
  }
}

async function enviarComanda(btn, confirmarRepetida = false) {
  if (vista.enviando) return; // ya hay un envío en marcha: el doble toque no hace nada
  if (vista.comanda.length === 0) return;
  vista.enviando = true;
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Enviando…';
  }
  try {
    const respuesta = await api('POST', '/api/pedidos', {
      zona: vista.zona,
      mesa: vista.mesa,
      items: vista.comanda,
      claveIdem: claveDeEnvio(),
      confirmarRepetida,
    });
    avisar(
      respuesta.duplicada
        ? '✅ Esa comanda ya estaba enviada (no se ha duplicado)'
        : '📤 ' + resumenEnvio(respuesta.pedidos)
    );
    vaciarComanda();
    vista.pestana = 'cuenta';
    pintar();
  } catch (e) {
    vista.enviando = false;
    if (e.codigo === 'comanda-repetida') {
      const repetir = confirm(
        `⚠️ ${e.message}\n\n¿Seguro que la mesa quiere OTRA VEZ lo mismo?\n\n` +
          'Aceptar = enviarla igualmente · Cancelar = no enviar nada'
      );
      if (repetir) return enviarComanda(btn, true);
      pintar();
      return;
    }
    alert('Error al enviar: ' + e.message);
    pintar();
  }
}

function resumenEnvio(pedidos = []) {
  return pedidos
    .map((p) => {
      const unidades = p.items.reduce((s, i) => s + i.cantidad, 0);
      return `${p.destino === 'barra' ? '🍺 Barra' : '👩‍🍳 Cocina'}: ${unidades}`;
    })
    .join(' · ');
}

// ----- Pestaña Cuenta -----

function pintarCuenta(panel) {
  const pedidos = ESTADO.pedidos.filter((p) => p.zona === vista.zona && p.mesa === vista.mesa);
  if (pedidos.length === 0 && vista.comanda.length === 0) {
    panel.innerHTML = '<div class="vacio">La mesa no tiene nada apuntado todavía.</div>';
    return;
  }
  let total = 0;
  const caja = document.createElement('div');
  caja.className = 'tarjeta';
  for (const p of pedidos) {
    const cab = document.createElement('div');
    cab.className = 'categoria-titulo';
    cab.style.marginTop = caja.children.length ? '1rem' : '0';
    cab.style.display = 'flex';
    cab.style.alignItems = 'center';
    const donde = p.destino === 'barra' ? 'barra' : 'cocina';
    const situacion =
      p.estado === 'servido'
        ? '· ✅ servida'
        : p.estado === 'listo'
          ? `· ✅ lista en ${donde}` + (donde === 'barra' ? ' — ¡a recogerla!' : '')
          : `· ⏳ en ${donde}`;
    cab.innerHTML = `
      <span style="flex:1">${donde === 'barra' ? '🍺' : '👩‍🍳'} Comanda de las ${horaCorta(p.creado)} ${situacion}</span>
      <button class="quitar" style="background:var(--rojo);border:none;color:#fff;border-radius:6px;padding:0.2rem 0.6rem;font-size:0.75rem;cursor:pointer">Anular</button>
    `;
    cab.querySelector('.quitar').onclick = () => anularComanda(p);
    caja.appendChild(cab);
    for (const item of p.items) {
      total += item.precio * item.cantidad;
      const fila = document.createElement('div');
      fila.className = 'linea-comanda';
      fila.innerHTML = `
        <span class="cantidad">${item.cantidad}×</span>
        <span class="nombre">${escaparHtml(item.nombre)}
          ${item.detalle ? `<span class="detalle">${escaparHtml(item.detalle)}</span>` : ''}
          ${item.notas ? `<span class="nota">📝 ${escaparHtml(item.notas)}</span>` : ''}
        </span>
        <span class="precio">${euros(item.precio * item.cantidad)}</span>
      `;
      caja.appendChild(fila);
    }
  }
  total = Math.round(total * 100) / 100;
  caja.insertAdjacentHTML(
    'beforeend',
    `<div class="total-fila"><span>TOTAL MESA</span><span class="cifra">${euros(total)}</span></div>`
  );
  panel.appendChild(caja);

  if (pedidos.length > 0) {
    const acciones = document.createElement('div');
    acciones.className = 'rejilla dos';
    acciones.style.marginTop = '1rem';
    acciones.innerHTML = `
      <button class="boton" id="imprimir-cuenta">🖨 Imprimir cuenta</button>
      <button class="boton" id="mover-mesa">↔️ Cambiar de mesa</button>
      <button class="boton verde" id="pagar-efectivo">💵 Efectivo</button>
      <button class="boton azul" id="pagar-tarjeta">💳 Tarjeta</button>
    `;
    panel.appendChild(acciones);
    acciones.querySelector('#imprimir-cuenta').onclick = () => imprimirCuenta(pedidos, total);
    acciones.querySelector('#mover-mesa').onclick = moverMesa;
    acciones.querySelector('#pagar-efectivo').onclick = () => cobrar('efectivo', total);
    acciones.querySelector('#pagar-tarjeta').onclick = () => cobrar('tarjeta', total);
  }
}

// ----- Imprimir la cuenta para el cliente (formato ticket 72 mm) -----

function imprimirCuenta(pedidos, total) {
  // Junta en una línea los artículos repetidos entre comandas
  const lineas = new Map();
  for (const p of pedidos) {
    for (const item of p.items) {
      const clave = item.nombre + '|' + item.precio + '|' + (item.detalle || '');
      if (lineas.has(clave)) lineas.get(clave).cantidad += item.cantidad;
      else lineas.set(clave, { ...item });
    }
  }
  const filas = [...lineas.values()]
    .map(
      (l) => `<div class="fila-cuenta"><span class="concepto">${l.cantidad} x ${escaparHtml(l.nombre)}</span>
        <span>${euros(l.precio * l.cantidad)}</span></div>
        ${l.detalle ? `<div class="detalle">${escaparHtml(l.detalle)}</div>` : ''}`
    )
    .join('');
  const ahora = new Date();
  document.getElementById('zona-ticket').innerHTML = `
    <h2>${escaparHtml(nombreDelLocal().toUpperCase())}</h2>
    <div style="text-align:center">${escaparHtml(nombreZona(vista.zona))} — Mesa ${vista.mesa}</div>
    <div style="text-align:center">${ahora.toLocaleDateString('es-ES')} · ${horaCorta(ahora.toISOString())}</div>
    <hr>
    ${filas}
    <hr>
    <div class="fila-cuenta grande-total"><span>TOTAL</span><span>${euros(total)}</span></div>
    <div style="text-align:center">IVA incluido</div>
    <div style="text-align:center">¡Gracias por su visita!</div>
  `;
  window.print();
}

// ----- Cambiar la cuenta de mesa (los clientes se mueven) -----

async function moverMesa() {
  const zonas = ESTADO.config.zonas;
  const opciones = zonas.map((z, i) => `${i + 1} = ${z.nombre}`).join('   ');
  const zR = prompt(
    `¿A qué zona se mueven?\n${opciones}`,
    String(zonas.findIndex((z) => z.id === vista.zona) + 1)
  );
  if (zR === null) return;
  const zona = zonas[parseInt(zR.trim(), 10) - 1];
  if (!zona) return alert('Zona no válida');
  const mR = prompt(`¿A qué mesa de ${zona.nombre}? (1 a ${zona.mesas})`);
  if (mR === null) return;
  const mesa = parseInt(mR.trim(), 10);
  if (!mesa || mesa < 1 || mesa > zona.mesas) return alert('Mesa no válida');
  if (zona.id === vista.zona && mesa === vista.mesa) return alert('Es la misma mesa');
  const destinoOcupado = ESTADO.pedidos.some((p) => p.zona === zona.id && p.mesa === mesa);
  if (
    destinoOcupado &&
    !confirm(`La mesa ${mesa} de ${zona.nombre} ya tiene cuenta abierta. ¿Juntar las dos cuentas?`)
  ) {
    return;
  }
  try {
    await api('POST', '/api/mesas/mover', {
      deZona: vista.zona,
      deMesa: vista.mesa,
      aZona: zona.id,
      aMesa: mesa,
    });
    avisar(`↔️ Cuenta movida a ${zona.nombre} · Mesa ${mesa}`);
    vista.zona = zona.id;
    vista.mesa = mesa;
    pintar();
  } catch (e) {
    alert('Error al mover la mesa: ' + e.message);
  }
}

async function anularComanda(p) {
  const aviso =
    p.estado === 'listo'
      ? 'Esta comanda YA ESTÁ LISTA en cocina y se quitará de la cuenta.'
      : 'La comanda desaparecerá de cocina y de la cuenta.';
  const motivo = prompt(aviso + '\n\n¿Por qué se anula? (ej.: me equivoqué de mesa, el cliente se fue)');
  if (motivo === null) return;
  if (!motivo.trim()) {
    alert('Hay que escribir el motivo para anular');
    return;
  }
  try {
    await api('DELETE', `/api/pedidos/${p.id}`, { motivo: motivo.trim() });
  } catch (e) {
    alert('Error al anular: ' + e.message);
  }
}

async function cobrar(metodoPago, total) {
  if (!confirm(`Cobrar ${euros(total)} en ${metodoPago} y cerrar la mesa?`)) return;
  try {
    await api('POST', '/api/mesas/cobrar', { zona: vista.zona, mesa: vista.mesa, metodoPago });
    vista.pantalla = 'mesas';
    pintar();
  } catch (e) {
    alert('Error al cobrar: ' + e.message);
  }
}
