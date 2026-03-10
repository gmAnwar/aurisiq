// ============================================================
//  AurisIQ — analisis.js
//  Llama al Worker (Cloudflare) → Claude API.
//  Guarda historial en localStorage.
//  Exporta: analizar(), getHistorial(), getUsoMes()
// ============================================================

import { SCORECARD_ACTIVO } from './scorecards.js';

const WORKER_URL = 'https://optix-proxy.anwarhsg.workers.dev';
const MAX_HISTORIAL = 50;
const LIMITE_GRATIS = 5;

// ── Estado interno ───────────────────────────────────────────
let historial = JSON.parse(localStorage.getItem('aurisiq_historial') || '[]');
let usoMes    = parseInt(localStorage.getItem('aurisiq_uso_mes') || '0');
let mesActual = localStorage.getItem('aurisiq_mes') || '';

// Reset uso mensual si cambió el mes
const mesHoy = new Date().toISOString().slice(0, 7);
if (mesHoy !== mesActual) {
  usoMes = 0;
  localStorage.setItem('aurisiq_uso_mes', '0');
  localStorage.setItem('aurisiq_mes', mesHoy);
  mesActual = mesHoy;
}

// ── Getters públicos ─────────────────────────────────────────
export function getHistorial()  { return historial; }
export function getUsoMes()     { return usoMes; }
export function getLimiteGratis() { return LIMITE_GRATIS; }

// ── Análisis principal ───────────────────────────────────────
export async function analizar({ empresa, producto, vendedor, duracion, transcripcion }) {

  const scorecard = SCORECARD_ACTIVO;

  const response = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: scorecard.system_prompt,
      messages: [
        { role: 'user', content: scorecard.buildUserPrompt(empresa, producto, vendedor, duracion, transcripcion) }
      ]
    })
  });

  if (!response.ok) throw new Error('Error del servidor: ' + response.status);

  const data = await response.json();
  const rawText = data.content?.[0]?.text || '';

  let resultado;
  try {
    const clean = rawText.replace(/```json|```/g, '').trim();
    resultado = JSON.parse(clean);
  } catch(e) {
    console.error('[AurisIQ] Raw response:', rawText);
    throw new Error('Error al procesar la respuesta de AurisIQ');
  }

  // Metadata
  resultado._meta = {
    empresa,
    producto,
    vendedor,
    duracion,
    fecha: new Date().toISOString(),
    transcripcion,
    scorecard_id: scorecard.id
  };

  // Guardar en historial
  historial.unshift(resultado);
  if (historial.length > MAX_HISTORIAL) historial = historial.slice(0, MAX_HISTORIAL);
  localStorage.setItem('aurisiq_historial', JSON.stringify(historial));

  // Actualizar uso mensual
  usoMes++;
  localStorage.setItem('aurisiq_uso_mes', usoMes);

  return resultado;
}

// ── Helpers de vendedores ────────────────────────────────────
export function getVendedoresFromHistorial() {
  const map = {};
  historial.forEach(h => {
    const n = h._meta.vendedor;
    if (!map[n]) map[n] = { nombre: n, scores: [] };
    map[n].scores.push(h.score_general);
  });
  return Object.values(map);
}
