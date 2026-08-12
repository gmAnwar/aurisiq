// Etiquetas de PRESENTACIÓN de analyses.clasificacion — los valores
// almacenados NO cambian (excelente/buena/regular/deficiente: CHECK de
// migración 001 + deriveClasificacion en supabase/functions/analyze/parser.ts
// y su espejo Worker). Decisión 7-ago-2026: "deficiente" en español desalienta
// al equipo; la rúbrica está bien calibrada (46% sale buena o mejor sobre 80
// análisis), así que umbrales y números NO se mueven — solo la palabra que ve
// el usuario. Fuente única: ningún sitio de render pinta la clasificación con
// strings sueltos.
// El helper vive en lib/ para que Next lo compile; el guard corre en la suite
// Deno (supabase/functions/_shared/clasificacion-labels.test.ts) contra
// deriveClasificacion real — mismo patrón que lib/descal-metrics.ts.

// Espejo de los valores del CHECK de analyses.clasificacion (migración 001).
export const CLASIFICACION_VALUES = ["excelente", "buena", "regular", "deficiente"] as const;
export type ClasificacionValue = (typeof CLASIFICACION_VALUES)[number];

export const CLASIFICACION_LABELS: Record<ClasificacionValue, string> = {
  excelente: "Excelente",
  buena: "Buena",
  regular: "En camino",
  deficiente: "A reforzar",
};

// Umbrales espejo de deriveClasificacion (fuente de verdad: 85/65/45). El
// guard de la suite falla si divergen — exactamente el drift que tenía la
// tabla de rangos de la UI (decía 81/61/41) antes de este módulo.
export const CLASIFICACION_RANGES: { value: ClasificacionValue; min: number; max: number }[] = [
  { value: "excelente", min: 85, max: 100 },
  { value: "buena", min: 65, max: 84 },
  { value: "regular", min: 45, max: 64 },
  { value: "deficiente", min: 0, max: 44 },
];

// null/undefined → null (el caller decide su guard: un fragmento muestra su
// badge propio, nunca una etiqueta inventada); valor fuera del CHECK → el
// valor crudo tal cual, jamás inventar etiqueta.
export function clasificacionLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return (CLASIFICACION_LABELS as Record<string, string>)[value] ?? value;
}

// F48b: clasificación DERIVADA del score que la UI pinta, no de la columna
// almacenada. Sin esto, un descarte con desempeño 70 saldría etiquetado
// "A reforzar" porque analyses.clasificacion guarda la del general (35) — el
// número y su etiqueta dirían cosas opuestas en el mismo renglón.
// La columna en DB NO se toca: sigue describiendo a score_general.
// Data-driven sobre CLASIFICACION_RANGES, que el guard de la suite Deno ya
// fija contra deriveClasificacion — un solo lugar donde viven los umbrales.
export function clasificacionFromScore(score: number | null | undefined): ClasificacionValue | null {
  if (typeof score !== "number") return null;
  return CLASIFICACION_RANGES.find((r) => score >= r.min && score <= r.max)?.value ?? null;
}
