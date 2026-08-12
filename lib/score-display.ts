// F48b: reglas de DISPLAY del score. Fuente única — sin esto, el "??" se
// copia inline en las 8 vistas y la primera que se olvide muestra el número
// viejo sin que nada truene.
//
// score_desempeno mide el trabajo de la captadora; score_general mezcla ese
// trabajo con la calidad del prospecto que le tocó. El principal es el
// desempeño; el general queda de secundario SOLO cuando aporta información
// distinta (si son iguales, repetirlo es ruido).

export interface ScoreRow {
  score_general: number | null;
  score_desempeno?: number | null;
}

/** El número que se pinta grande. Cae al general cuando no hay desempeño. */
export function mainScore(a: ScoreRow): number | null {
  return a.score_desempeno ?? a.score_general;
}

/**
 * El general como secundario ("Avance"), o null si no hay nada que agregar:
 * sin desempeño calculado, o cuando ambos coinciden.
 */
export function avanceScore(a: ScoreRow): number | null {
  if (typeof a.score_desempeno !== "number") return null;
  if (a.score_general === a.score_desempeno) return null;
  return a.score_general;
}
