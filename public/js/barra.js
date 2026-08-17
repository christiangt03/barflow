// Pantalla del camarero de barra: solo las comandas de bebida.
// Cuando la barra marca LISTO, salta el aviso en los móviles de la sala.

const lista = document.getElementById('lista-comandas');

ponerBotonAvisoStock('barra');

// Mientras el navegador no deje sonar el aviso, se avisa en pantalla
const avisoAudio = document.getElementById('aviso-audio');
desbloquearAudioAlTocar((listo) => {
  avisoAudio.style.display = listo ? 'none' : '';
});

// Suena solo lo que sale por barra
socket.on('nueva-comanda', (p) => {
  if (p.destino === 'barra') pitido();
});

socket.on('comanda-anulada', (p) => {
  if (p.destino !== 'barra') return;
  avisar(`❌ ANULADA: ${nombreZona(p.zona)} · Mesa ${p.mesa} — ${p.motivo} (${p.anuladoPor})`);
  pitido();
});

socket.on('mesa-movida', (m) => {
  avisar(`↔️ ${nombreZona(m.deZona)} Mesa ${m.deMesa} pasa a ${nombreZona(m.aZona)} Mesa ${m.aMesa} (${m.por})`);
});

// Cuando la sala recoge las bebidas, la tarjeta se cierra sola
socket.on('comanda-recogida', (p) => {
  if (p.destino !== 'barra') return;
  avisar(`👍 Recogido: ${nombreZona(p.zona)} · Mesa ${p.mesa} (${p.recogidoPor})`);
});

alCambiarEstado(pintar);

function pintar() {
  lista.innerHTML = '';
  const pedidos = ESTADO.pedidos
    .filter((p) => p.destino === 'barra')
    .sort((a, b) => {
      const orden = { pendiente: 0, listo: 1, servido: 2 };
      if (orden[a.estado] !== orden[b.estado]) return orden[a.estado] - orden[b.estado];
      return a.creado.localeCompare(b.creado);
    });
  if (pedidos.length === 0) {
    lista.innerHTML = '<div class="vacio" style="grid-column:1/-1">Sin bebidas pendientes 🍻</div>';
    return;
  }
  for (const p of pedidos) lista.appendChild(tarjetaBebidas(p));
}

function tarjetaBebidas(p) {
  const caja = document.createElement('div');
  caja.className = 'comanda barra' + (p.estado === 'pendiente' ? '' : ' lista');
  // Si la mesa pidió también comida, la barra sabe que cocina va en paralelo
  const hermana = ESTADO.pedidos.find((o) => o.grupo && o.grupo === p.grupo && o.destino === 'cocina');
  caja.innerHTML = `
    <div class="cabecera">
      <span class="mesa-nombre"><span class="insignia ${p.zona}">${escaparHtml(nombreZona(p.zona))}</span> Mesa ${p.mesa}</span>
      <span class="hora">${p.camarero ? '👤 ' + escaparHtml(p.camarero) + ' · ' : ''}${
        p.dispositivo ? '📱 ' + escaparHtml(p.dispositivo) + ' · ' : ''
      }${horaCorta(p.creado)}</span>
    </div>
    ${hermana ? '<div class="apunte-destino">👩‍🍳 Esta mesa también tiene comida en cocina</div>' : ''}
    ${p.estado === 'listo' ? '<div class="apunte-destino esperando">🔔 Avisada la sala — pendiente de recoger</div>' : ''}
    ${p.estado === 'servido' ? '<div class="apunte-destino recogido">✅ Recogido por la sala</div>' : ''}
    <ul></ul>
  `;
  const ul = caja.querySelector('ul');
  for (const item of p.items) {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${item.cantidad}×</strong> ${escaparHtml(item.nombre)}
      ${item.notas ? `<span class="nota">📝 ${escaparHtml(item.notas)}</span>` : ''}`;
    ul.appendChild(li);
  }

  const btn = document.createElement('button');
  if (p.estado === 'pendiente') {
    btn.className = 'boton verde';
    btn.textContent = '🔔 LISTO — avisar a sala';
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await api('POST', `/api/pedidos/${p.id}/listo`);
        avisar(`🔔 Avisada la sala: Mesa ${p.mesa}`);
        if (document.getElementById('imprimir-auto').checked) imprimirTicketBarra(p);
      } catch (e) {
        btn.disabled = false;
        alert('No se pudo avisar: ' + e.message);
      }
    };
  } else if (p.estado === 'listo') {
    btn.className = 'boton';
    btn.textContent = '🔔 Volver a avisar';
    btn.onclick = () => {
      // El aviso vuelve a salir en los móviles de sala sin tocar el estado
      socket.emit('reavisar-bebidas', { id: p.id });
      avisar('🔔 Aviso repetido a la sala');
    };
  } else {
    btn.className = 'boton';
    btn.textContent = '🖨 Reimprimir';
    btn.onclick = () => imprimirTicketBarra(p);
  }
  caja.appendChild(btn);
  return caja;
}

function imprimirTicketBarra(p) {
  const filas = p.items
    .map(
      (item) => `<li>${item.cantidad} x ${escaparHtml(item.nombre)}
        ${item.notas ? `<div class="detalle">Nota: ${escaparHtml(item.notas)}</div>` : ''}</li>`
    )
    .join('');
  document.getElementById('zona-ticket').innerHTML = `
    <h2>${escaparHtml(nombreDelLocal().toUpperCase())}</h2>
    <hr>
    <div class="grande">BARRA — ${escaparHtml(nombreZona(p.zona).toUpperCase())} MESA ${p.mesa}</div>
    <div style="text-align:center">${horaCorta(p.creado)}</div>
    <hr>
    <ul>${filas}</ul>
    <hr>
  `;
  window.print();
}
