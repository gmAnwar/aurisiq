// ============================================================
// AurisIQ — ui.js
// Todas las funciones de render y helpers de DOM.
// No hace llamadas a la API — solo pinta resultados.
// ============================================================

// ── Score helpers ──────────────────────────────────────────────
export function getScoreClass(score) {
  if (score >= 85) return 'score-alto';
  if (score >= 65) return 'score-funcional';
  if (score >= 45) return 'score-problemas';
  return 'score-critico';
}
export function getScoreColor(score) {
  if (score >= 85) return '#4caf7d';
  if (score >= 65) return '#f0c040';
  if (score >= 45) return '#e07b20';
  return '#e05050';
}
export function getClasifClass(clasif) {
  if (clasif.includes('Alto')) return 'score-alto';
  if (clasif.includes('Funcional')) return 'score-funcional';
  if (clasif.includes('Problemas') || clasif.includes('estructural')) return 'score-problemas';
  return 'score-critico';
}
export function getEvalClass(ev) {
  if (ev === 'funcionó') return 'eval-ok';
  if (ev === 'podría mejorar') return 'eval-mejora';
  return 'eval-no';
}
export function getEstadoColor(estado) {
  const map = { 'caliente': '#4caf7d', 'tibio': '#f0c040', 'frío': '#e07b20', 'perdido': '#e05050' };
  return map[estado] || '#9a8a70';
}

// ── Toast ──────────────────────────────────────────────────────
export function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ── Loading overlay ────────────────────────────────────────────
export function setLoading(on) {
  const overlay = document.getElementById('loading-overlay');
  const btn = document.getElementById('btn-analizar');
  if (overlay) overlay.classList.toggle('open', on);
  if (btn) { btn.classList.toggle('loading', on); btn.disabled = on; }
}

// ── Char counter ───────────────────────────────────────────────
export function updateCharCount() {
  const t = document.getElementById('transcripcion');
  const cnt = document.getElementById('char-count');
  if (t && cnt) cnt.textContent = t.value.length.toLocaleString() + ' caracteres';
}

// ── Usage display ───────────────────────────────────────────────
export function updateUsageDisplay(usoMes) {
  const el = document.getElementById('uso-count');
  if (el) el.textContent = usoMes;
}

// ── Navegación entre pantallas ─────────────────────────────────
export function showScreen(id, event) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('screen-' + id)?.classList.add('active');
  if (event?.target) event.target.classList.add('active');
}

// ── Render resultado ───────────────────────────────────────────
export function renderResultado(r) {
  const score = r.score_general;
  const color = getScoreColor(score);
  const circumference = 2 * Math.PI * 38;
  const fill = (score / 100) * circumference;

  // Score ring
  const ring = document.getElementById('score-ring');
  if (ring) {
    ring.style.stroke = color;
    ring.style.strokeDasharray = `${fill} ${circumference - fill}`;
  }
  const scoreNumEl = document.getElementById('score-num');
  if (scoreNumEl) {
    scoreNumEl.textContent = score;
    scoreNumEl.className = 'score-num ' + getScoreClass(score);
  }
  const vendedorEl = document.getElementById('result-vendedor-name');
  if (vendedorEl) vendedorEl.textContent = r._meta?.vendedor || r.vendedor || '—';

  const clasifEl = document.getElementById('result-classification');
  if (clasifEl) {
    clasifEl.textContent = r.clasificacion;
    clasifEl.className = 'classification ' + getClasifClass(r.clasificacion);
    clasifEl.style.borderColor = color;
    clasifEl.style.color = color;
  }
  const empresaEl = document.getElementById('result-empresa-info');
  if (empresaEl) empresaEl.textContent = `${r._meta?.empresa || ''} · ${r._meta?.producto || ''}`;

  // Bloques de resultado
  const container = document.getElementById('result-blocks');
  if (!container) return;
  container.innerHTML = '';

  // 1. Diagnóstico por fase
  const faseHTML = `
    <div class="fases-grid">
      ${(r.fases || []).map(f => {
        const pct = (f.puntaje / f.maximo) * 100;
        const fc = getScoreColor(pct);
        return `
          <div class="fase-item">
            <div class="fase-top">
              <span class="fase-name">${f.nombre}</span>
              <span class="fase-score" style="color:${fc}">${f.puntaje}/${f.maximo}</span>
            </div>
            <div class="fase-bar-wrap">
              <div class="fase-bar-fill" style="width:${pct}%; background:${fc};"></div>
            </div>
            <div class="fase-text">${f.texto || f.diagnostico || ''}</div>
          </div>`;
      }).join('')}
    </div>`;
  container.appendChild(makeBlock('◈ DIAGNÓSTICO POR FASE', faseHTML, true));

  // 2. Objeciones
  if (r.objeciones?.length > 0) {
    const objHTML = r.objeciones.map(o => `
      <div class="objecion-item">
        <div class="obj-header">
          <div class="obj-label">Objeción detectada</div>
          <div class="obj-text">"${o.objecion}"</div>
        </div>
        <div class="obj-label">Respuesta del vendedor</div>
        <div class="fase-text" style="margin-bottom:6px;">${o.respuesta_vendedor || ''}</div>
        <span class="obj-eval ${getEvalClass(o.evaluacion)}">${(o.evaluacion || '').toUpperCase()}</span>
        ${o.respuesta_recomendada ? `<div class="obj-recomendacion">💡 ${o.respuesta_recomendada}</div>` : ''}
      </div>`).join('');
    container.appendChild(makeBlock('⚡ OBJECIONES DETECTADAS', objHTML, true));
  } else {
    // Fallback: mostrar objecion_principal del demo si existe
    const objPrincipal = r.objecion_principal;
    if (objPrincipal) {
      const objHTML = `
        <div class="objecion-item">
          <div class="obj-header">
            <div class="obj-label">Objeción principal</div>
            <div class="obj-text">"${objPrincipal}"</div>
          </div>
        </div>`;
      container.appendChild(makeBlock('⚡ OBJECIONES DETECTADAS', objHTML, true));
    } else {
      container.appendChild(makeBlock('⚡ OBJECIONES DETECTADAS', '<p class="rb-text" style="color:var(--text-dim);">No se detectaron objeciones explícitas.</p>', true));
    }
  }

  // 3. Siguiente paso — compatible con formato API y formato demo
  const sp = r.siguiente_paso;
  let spHTML;
  if (sp) {
    spHTML = `
      <div class="paso-grid">
        <div class="paso-item">
          <div class="paso-label">Estado del prospecto</div>
          <div class="paso-value" style="color:${getEstadoColor(sp.estado)}; font-family:var(--display); font-size:18px; letter-spacing:1px;">${(sp.estado || '').toUpperCase()}</div>
        </div>
        <div class="paso-item">
          <div class="paso-label">Acción en 24–48h</div>
          <div class="paso-value">${sp.accion_concreta || sp.accion_inmediata || ''}</div>
        </div>
      </div>
      <div class="paso-item" style="margin-top:12px;">
        <div class="paso-label">Razonamiento</div>
        <div class="paso-value">${sp.razonamiento || ''}</div>
      </div>
      <div class="whatsapp-box">
        <div class="paso-label">💬 Mensaje sugerido (WhatsApp)</div>
        <div class="paso-value">${sp.mensaje_sugerido || ''}</div>
      </div>`;
  } else {
    // Formato demo / legacy
    const accion = r.siguiente_accion || r.accion_recomendada || '—';
    spHTML = `<div class="paso-item"><div class="paso-label">Acción recomendada</div><div class="paso-value">${accion}</div></div>`;
    if (r.momento_critico) {
      spHTML += `<div class="paso-item" style="margin-top:12px;"><div class="paso-label">Momento crítico</div><div class="paso-value">${r.momento_critico}</div></div>`;
    }
  }
  container.appendChild(makeBlock('→ SIGUIENTE PASO CON ESTE PROSPECTO', spHTML, true));

  // 4. Patrón de error
  const patron = r.patron_error || r.diagnostico_general || '';
  container.appendChild(makeBlock('⚠ PATRÓN DE ERROR PRINCIPAL', `<div class="error-box"><p>${patron}</p></div>`, true));

  // Mostrar sección resultado
  const rs = document.getElementById('resultado-section');
  if (rs) {
    rs.style.display = 'block';
    rs.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ── Historial ──────────────────────────────────────────────────
export function renderHistorial(historial, onClickFn) {
  const container = document.getElementById('historial-list');
  if (!container) return;
  if (!historial.length) {
    container.innerHTML = '<div class="empty-history">Sin análisis aún.<br>El primero aparecerá aquí.</div>';
    return;
  }
  container.innerHTML = historial.slice(0, 10).map((h, i) => {
    const fecha = new Date(h._meta.fecha).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
    const sc = getScoreClass(h.score_general);
    return `<div class="history-item" data-idx="${i}">
      <div class="hi-top">
        <span class="hi-name">${h._meta.vendedor}</span>
        <span class="hi-score ${sc}">${h.score_general}</span>
      </div>
      <div class="hi-meta">${h._meta.empresa} · ${fecha} · ${h.clasificacion}</div>
    </div>`;
  }).join('');

  // Attach click handlers
  container.querySelectorAll('.history-item').forEach(el => {
    el.addEventListener('click', () => onClickFn(parseInt(el.dataset.idx)));
  });
}

// ── Config: vendedores ─────────────────────────────────────────
export function renderVendedoresConfig(vendedores) {
  const list = document.getElementById('vendedores-list');
  if (!list) return;
  if (!vendedores.length) {
    list.innerHTML = '<div class="empty-history">Los vendedores aparecen automáticamente al analizar sus llamadas.</div>';
    return;
  }
  list.innerHTML = vendedores.map(v => {
    const avg = Math.round(v.scores.reduce((a, b) => a + b, 0) / v.scores.length);
    const sc = getScoreClass(avg);
    return `<div class="vendedor-row">
      <div>
        <div class="vr-name">${v.nombre}</div>
        <div class="vr-stats">${v.scores.length} análisis</div>
      </div>
      <div class="vr-avg ${sc}">${avg}</div>
    </div>`;
  }).join('');
}

// ── Helper interno: bloque colapsable ──────────────────────────
function makeBlock(title, bodyHTML, open = false) {
  const block = document.createElement('div');
  block.className = 'result-block';
  block.innerHTML = `
    <div class="rb-header ${open ? 'open' : ''}" onclick="this.classList.toggle('open'); this.nextElementSibling.classList.toggle('open')">
      <div class="rb-title">${title}</div>
      <span class="rb-chevron">▼</span>
    </div>
    <div class="rb-body ${open ? 'open' : ''}">${bodyHTML}</div>`;
  return block;
}
