// Aviso rápido de stock: lo usan la pantalla de cocina y la de barra para
// decirle al gerente que algo se está acabando o ya se ha agotado.
// Se incluye después de comun.js.

let productosAlmacen = null; // se pide una vez y se reutiliza

async function nombresDeAlmacen() {
  if (productosAlmacen) return productosAlmacen;
  try {
    productosAlmacen = await api('GET', '/api/almacen/nombres');
  } catch (e) {
    productosAlmacen = []; // sin sugerencias, pero el aviso se puede escribir igual
  }
  return productosAlmacen;
}

// origen: 'cocina' o 'barra'
async function abrirAvisoStock(origen) {
  const productos = await nombresDeAlmacen();
  const sugerencias = productos
    .map((p) => `<option value="${escaparHtml(p.nombre)}">${escaparHtml(p.categoria || '')}</option>`)
    .join('');

  abrirDialogo({
    titulo: origen === 'barra' ? '🍺 Avisar de que falta algo en barra' : '👩‍🍳 Avisar de que falta algo en cocina',
    textoOk: '📨 Avisar al gerente',
    cuerpo: `
      <span class="etiqueta">¿Qué producto?</span>
      <input type="text" id="al-producto" list="al-lista" placeholder="${
        origen === 'barra' ? 'Ej.: Cerveza de barril, tónica, hielo…' : 'Ej.: Calamares, aceite, pan…'
      }" autocomplete="off">
      <datalist id="al-lista">${sugerencias}</datalist>
      <span class="etiqueta" style="margin-top:0.8rem">¿Cómo está?</span>
      <div class="rejilla dos">
        <button type="button" class="boton gravedad activa" data-g="poco">⚠️ Queda poco</button>
        <button type="button" class="boton gravedad" data-g="agotado">⛔ Se ha agotado</button>
      </div>
      <span class="etiqueta" style="margin-top:0.8rem">Nota (opcional)</span>
      <input type="text" id="al-nota" placeholder="Ej.: para mañana no llega" autocomplete="off">
    `,
    alAceptar: async (dialogo) => {
      const producto = dialogo.querySelector('#al-producto').value.trim();
      if (!producto) {
        alert('Escribe qué producto falta');
        return false;
      }
      const gravedad = dialogo.querySelector('.gravedad.activa').dataset.g;
      const encontrado = productos.find((p) => p.nombre.toLowerCase() === producto.toLowerCase());
      try {
        const alerta = await api('POST', '/api/alertas', {
          producto,
          productoId: encontrado ? encontrado.id : null,
          origen,
          gravedad,
          nota: dialogo.querySelector('#al-nota').value.trim(),
        });
        avisar(
          alerta.repetida
            ? `📨 Ya había un aviso de ${producto}; se ha insistido (${alerta.repeticiones} veces)`
            : `📨 Avisado al gerente: ${producto}`
        );
      } catch (e) {
        alert('No se pudo enviar el aviso: ' + e.message);
        return false;
      }
    },
  });

  // Selector "queda poco / agotado"
  for (const btn of document.querySelectorAll('.dialogo .gravedad')) {
    btn.onclick = () => {
      for (const otro of document.querySelectorAll('.dialogo .gravedad')) otro.classList.remove('activa');
      btn.classList.add('activa');
    };
  }
}

// Coloca el botón de aviso en la barra superior de la pantalla que lo pida
function ponerBotonAvisoStock(origen) {
  const btn = document.createElement('button');
  btn.className = 'boton rojo boton-aviso-stock';
  btn.textContent = '⚠️ Falta stock';
  btn.onclick = () => abrirAvisoStock(origen);
  document.querySelector('header.barra-superior').appendChild(btn);
  return btn;
}
