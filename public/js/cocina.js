// Pantalla de cocina: comandas en tiempo real, marcar listo e imprimir ticket

const lista = document.getElementById('lista-comandas');

// Botón para avisar al gerente de que falta género (js/alertas.js)
ponerBotonAvisoStock('cocina');

// Mientras el navegador no deje sonar el aviso, se avisa en pantalla
const avisoAudio = document.getElementById('aviso-audio');
desbloquearAudioAlTocar((listo) => {
  avisoAudio.style.display = listo ? 'none' : '';
});

// Pitido solo con las comandas que le tocan a cocina; las de bebidas suenan en barra
socket.on('nueva-comanda', (p) => {
  if (p.destino !== 'barra') pitido();
});

socket.on('comanda-anulada', (p) => {
  if (p.destino === 'barra') return; // esa era de la barra
  avisar(`❌ ANULADA: ${nombreZona(p.zona)} · Mesa ${p.mesa} — ${p.motivo} (${p.anuladoPor})`);
  pitido();
});

socket.on('mesa-movida', (m) => {
  avisar(`↔️ ${nombreZona(m.deZona)} Mesa ${m.deMesa} pasa a ${nombreZona(m.aZona)} Mesa ${m.aMesa} (${m.por})`);
});

alCambiarEstado(pintar);

function pintar() {
  lista.innerHTML = '';
  // Solo lo que prepara cocina: las comandas de solo bebida van a la pantalla de barra
  const pedidos = ESTADO.pedidos
    .filter((p) => p.destino !== 'barra')
    .sort((a, b) => {
      if (a.estado !== b.estado) return a.estado === 'pendiente' ? -1 : 1;
      return a.creado.localeCompare(b.creado);
    });
  if (pedidos.length === 0) {
    lista.innerHTML = '<div class="vacio" style="grid-column:1/-1">Sin comandas pendientes 🎉</div>';
    return;
  }
  for (const p of pedidos) lista.appendChild(tarjetaComanda(p));
}

function tarjetaComanda(p) {
  const caja = document.createElement('div');
  caja.className = 'comanda' + (p.estado === 'pendiente' ? '' : ' lista');
  const zona = nombreZona(p.zona);
  // Si la mesa pidió además bebidas, se avisa de que van por la barra
  const hermana = ESTADO.pedidos.find((o) => o.grupo && o.grupo === p.grupo && o.destino === 'barra');
  caja.innerHTML = `
    <div class="cabecera">
      <span class="mesa-nombre"><span class="insignia ${p.zona}">${escaparHtml(zona)}</span> Mesa ${p.mesa}</span>
      <span class="hora">${p.camarero ? '👤 ' + escaparHtml(p.camarero) + ' · ' : ''}${
        p.dispositivo ? '📱 ' + escaparHtml(p.dispositivo) + ' · ' : ''
      }${horaCorta(p.creado)}</span>
    </div>
    ${hermana ? '<div class="apunte-destino">🍺 Las bebidas de esta mesa las saca la barra</div>' : ''}
    <ul></ul>
  `;
  const ul = caja.querySelector('ul');
  for (const item of p.items) {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${item.cantidad}×</strong> ${escaparHtml(item.nombre)}
      ${item.detalle ? `<span class="detalle">${escaparHtml(item.detalle)}</span>` : ''}
      ${item.notas ? `<span class="nota">📝 ${escaparHtml(item.notas)}</span>` : ''}`;
    ul.appendChild(li);
  }
  const btn = document.createElement('button');
  if (p.estado === 'pendiente') {
    btn.className = 'boton verde';
    btn.textContent = '✅ LISTO';
    btn.onclick = async () => {
      btn.disabled = true; // que no cuente dos veces si se toca rápido
      try {
        await api('POST', `/api/pedidos/${p.id}/listo`);
        if (document.getElementById('imprimir-auto').checked) imprimirTicket(p);
      } catch (e) {
        btn.disabled = false;
        alert('No se pudo marcar como lista: ' + e.message);
      }
    };
  } else {
    btn.className = 'boton';
    btn.textContent = '🖨 Reimprimir ticket';
    btn.onclick = () => imprimirTicket(p);
  }
  caja.appendChild(btn);
  return caja;
}

// ----- Ticket -----

function imprimirTicket(p) {
  const zona = nombreZona(p.zona).toUpperCase();
  const filas = p.items
    .map(
      (item) => `<li>${item.cantidad} x ${escaparHtml(item.nombre)}
        ${item.detalle ? `<div class="detalle">${escaparHtml(item.detalle)}</div>` : ''}
        ${item.notas ? `<div class="detalle">Nota: ${escaparHtml(item.notas)}</div>` : ''}</li>`
    )
    .join('');
  document.getElementById('zona-ticket').innerHTML = `
    <h2>${escaparHtml(nombreDelLocal().toUpperCase())}</h2>
    <hr>
    <div class="grande">${escaparHtml(zona)} — MESA ${p.mesa}</div>
    <div style="text-align:center">${horaCorta(p.creado)}</div>
    <hr>
    <ul>${filas}</ul>
    <hr>
  `;
  window.print();
}
