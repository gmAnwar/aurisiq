// F48b: score de DESEMPEÑO de la captadora, separado de la calidad del
// prospecto. Lógica PURA (sin I/O, sin imports con Deno.env) para que la suite
// la importe directo — mismo patrón que analysis-payload.ts.
//
// El problema: score_general castiga a la captadora por el prospecto que le
// tocó. Si el propietario no tiene escrituras, las fases "Calificación de la
// Propiedad", "Expectativa y Precio" y "Avance a Visita" se hunden por algo
// que la captadora no controla — y el número que ve el equipo dice "35" cuando
// el trabajo pudo ser impecable.
//
// La separación: las fases marcadas lead_dependent en scorecards.phases salen
// del cálculo cuando el prospecto se descarta, y en su lugar entra el bloque
// EVALUACION DE DESCARTE (4 criterios × 5 pts = 20) que mide lo único
// evaluable en ese escenario: si confirmó la causa, si exploró solución, si
// orientó bien y si dejó puerta abierta.
//
// AUSENCIA de lead_dependent = fase pura. No existe `lead_dependent: false` en
// el catálogo de prod y este código no lo requiere.
import type { DescarteScores, ScorecardPhase } from "./types.ts";

/** Puntos máximos del bloque de descarte: 4 criterios × 5. */
export const DESCARTE_MAX = 20;

export interface ScoreDesempenoInput {
  leadQuality: string | null;
  scoreGeneral: number | null;
  /** Fases parseadas del output (ya des-escapadas y matcheadas). */
  parsedPhases: { phase_name: string; score: number }[];
  /** scorecards.phases — la COLUMNA, no structure.phases. */
  phasesCatalog: ScorecardPhase[] | null;
  descarte: DescarteScores | null;
  unscorableReason: "fragmento" | null;
}

export interface ScoreDesempenoResult {
  score: number | null;
  /** true → el caller debe emitir el trigger descarte_block_missing. */
  descarteBlockMissing: boolean;
}

export function sumDescarte(d: DescarteScores): number {
  return d.causal_confirmada + d.resolubilidad_explorada + d.orientacion_correcta + d.puerta_abierta;
}

export function computeScoreDesempeno(input: ScoreDesempenoInput): ScoreDesempenoResult {
  const { leadQuality, scoreGeneral, parsedPhases, phasesCatalog, descarte, unscorableReason } = input;

  // 1. Fragmento: no se puntúa nada, y NO es una pérdida que reportar — el
  //    gate pre-LLM ya decidió que no hay material que evaluar.
  if (unscorableReason === "fragmento") {
    return { score: null, descarteBlockMissing: false };
  }

  // 2. Todo lo que no sea un descarte confirmado (calificado, indeterminado y
  //    null incluidos) usa el general tal cual: sin descarte no hay nada que
  //    separar. Puede ser null si el general lo es.
  if (leadQuality !== "descalificado") {
    return { score: scoreGeneral, descarteBlockMissing: false };
  }

  // 3. Descarte sin catálogo lead_dependent: el scorecard no declara qué fases
  //    dependen del prospecto, así que no hay separación posible. Cae al
  //    general — v1 solo tiene V5A declarada, el resto pasa por aquí.
  const catalog = phasesCatalog ?? [];
  const puras = catalog.filter((p) => p.lead_dependent !== true);
  if (puras.length === catalog.length) {
    return { score: scoreGeneral, descarteBlockMissing: false };
  }

  // 4. Descarte con catálogo: exige TODAS las fases puras presentes y el
  //    bloque de descarte completo. Cualquier hueco → null + trigger; nunca un
  //    número construido sobre datos incompletos.
  const byName = new Map(parsedPhases.map((p) => [p.phase_name, p]));
  const matched = puras.map((p) => byName.get(p.phase_name));
  if (matched.some((m) => m === undefined) || descarte === null) {
    return { score: null, descarteBlockMissing: true };
  }

  const numerador = matched.reduce((acc, m) => acc + m!.score, 0) + sumDescarte(descarte);
  const denominador = puras.reduce((acc, p) => acc + p.score_max, 0) + DESCARTE_MAX;
  return { score: Math.min(Math.round((100 * numerador) / denominador), 100), descarteBlockMissing: false };
}
