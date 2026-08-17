// Identificación del aparato: cada tablet del bar dice cuál es (Tablet 1,
// Barra...) y el gerente le da el visto bueno. Se hace una sola vez por aparato.

socket.close(); // aquí todavía no hay permiso para el tiempo real

const contenido = document.getElementById('contenido');
document.getElementById('btn-salir').onclick = cerrarSesion;

let repaso = null;

async function pintar() {
  const yo = await cargarSesion();
  if (!yo) return;

  const { dispositivo, puestoDelBar } = await api('GET', '/api/dispositivos/mio');

  if (dispositivo && dispositivo.estado === 'autorizado') {
    clearInterval(repaso);
    contenido.innerHTML = `
      <div class="tarjeta" style="text-align:center">
        <div style="font-size:2.5rem">✅</div>
        <div class="categoria-titulo">Este aparato es ${escaparHtml(dispositivo.nombre)}</div>
        <p class="etiqueta">Ya está autorizado. No hará falta volver a identificarlo.</p>
        <a class="boton oro" href="index.html" style="margin-top:0.8rem">Entrar</a>
      </div>
    `;
    return;
  }

  if (dispositivo && dispositivo.estado === 'pendiente') {
    contenido.innerHTML = `
      <div class="tarjeta" style="text-align:center">
        <div style="font-size:2.5rem">⏳</div>
        <div class="categoria-titulo">${escaparHtml(dispositivo.nombre)} — pendiente de autorizar</div>
        <p class="etiqueta">Avisa al gerente para que lo autorice desde
          <strong>Administración → Dispositivos</strong>. Esta pantalla se actualiza sola.</p>
      </div>
    `;
    return;
  }

  if (dispositivo && dispositivo.estado === 'bloqueado') {
    contenido.innerHTML = `
      <div class="tarjeta" style="text-align:center">
        <div style="font-size:2.5rem">⛔</div>
        <div class="categoria-titulo">${escaparHtml(dispositivo.nombre)} está bloqueado</div>
        <p class="etiqueta">El gerente ha bloqueado este aparato. Habla con él.</p>
      </div>
    `;
    return;
  }

  // Aparato sin identificar: se elige de los que el gerente ha dado de alta
  const libres = await api('GET', '/api/dispositivos/disponibles');
  if (libres.length === 0) {
    contenido.innerHTML = `
      <div class="tarjeta" style="text-align:center">
        <div style="font-size:2.5rem">📱</div>
        <div class="categoria-titulo">Aparato no reconocido</div>
        <p class="etiqueta">No hay ningún aparato libre dado de alta. El gerente tiene que crearlo
          en <strong>Administración → Dispositivos</strong> (por ejemplo "Tablet 3") y volver aquí.</p>
        ${puestoDelBar ? '<p class="etiqueta">Este es el ordenador del bar: puede usar la app sin identificarse.</p>' : ''}
        <button class="boton" id="reintentar" style="margin-top:0.8rem">Volver a mirar</button>
      </div>
    `;
    contenido.querySelector('#reintentar').onclick = pintar;
    return;
  }

  contenido.innerHTML = `
    <p class="etiqueta">Elige cuál de los aparatos del bar es este. Se guarda para siempre en él,
      así que solo hay que hacerlo una vez.</p>
    <div class="rejilla" id="lista"></div>
  `;
  const lista = contenido.querySelector('#lista');
  for (const d of libres) {
    const btn = document.createElement('button');
    btn.className = 'boton oro';
    btn.style.padding = '1.2rem';
    btn.textContent = '📱 ' + d.nombre;
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const r = await api('POST', `/api/dispositivos/${d.id}/vincular`);
        avisar(
          r.estado === 'autorizado'
            ? `Este aparato es ${r.nombre}`
            : `${r.nombre}: pendiente de que el gerente lo autorice`
        );
        pintar();
      } catch (e) {
        alert(e.message);
        btn.disabled = false;
        pintar();
      }
    };
    lista.appendChild(btn);
  }
}

pintar();
// Mientras espera el visto bueno, va mirando si ya está autorizado
repaso = setInterval(() => {
  if (!document.hidden) pintar();
}, 4000);
