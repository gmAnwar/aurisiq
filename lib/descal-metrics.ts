// F47: métricas "qualified" sobre categoria_descalificacion con TRES estados:
// [] = calificado (sin causal) · [codes] = descalificado · null = el parser no
// pudo leer el bloque DESCALIFICACION. El null se EXCLUYE del denominador (no
// cuenta como calificado ni como descalificado) y el conteo excluido debe ser
// visible en el UI como "(N sin dato)" — nunca excluir en silencio.
export type DescalCats = string[] | null | undefined;

export function descalState(cats: DescalCats): "qualified" | "disqualified" | "unknown" {
  if (cats == null) return "unknown";
  return cats.length === 0 ? "qualified" : "disqualified";
}

export interface QualifiedStats {
  qualified: number;
  disqualified: number;
  unknown: number;
  // total - unknown: la base honesta para tasas y "X/Y"
  denominator: number;
}

export function qualifiedStats(rows: { categoria_descalificacion: DescalCats }[]): QualifiedStats {
  const stats: QualifiedStats = { qualified: 0, disqualified: 0, unknown: 0, denominator: 0 };
  for (const row of rows) {
    stats[descalState(row.categoria_descalificacion)]++;
  }
  stats.denominator = rows.length - stats.unknown;
  return stats;
}
