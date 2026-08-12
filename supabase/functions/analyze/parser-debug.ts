// F46: diagnóstico de partial_extraction. Lógica PURA (sin I/O) para que sea
// unit-testeable sin DB. El detector en index.ts arma este objeto y lo pasa a
// db.writeParserDebug(). Se persiste en la tabla analysis_parser_debug (RLS
// deny-all, solo service_role) — contiene PII de prospectos, NUNCA va a Slack.

// F47: causas en orden canónico. Reemplaza al `trigger` único de F46 — la
// columna vieja queda NULL desde este código y muere en la Migración F47 2/2.
export type ParserDebugTrigger =
  | "missing_lead"
  | "phases_mismatch"
  | "missing_prospect_extraction"
  | "descal_parse_failed"
  | "descarte_block_missing";

export interface ParserDebugRow {
  triggers: ParserDebugTrigger[];
  missing_fields: string[];
  phases_expected: number;
  phases_found: number;
  // MatchedPhase.phase_id es string | null en el type; en runtime matchPhaseIds
  // siempre cae a slugify (no-nulo), pero respetamos el type. jsonb tolera nulls.
  phases_found_ids: (string | null)[];
  raw_estado: string | null;
  estado_header_missing: boolean;
  raw_output_capture: string | null;
  raw_output_truncated: boolean;
  edge_version: string;
}

// Postgres text/jsonb rechaza el null byte (U+0000). Sin saneo, el insert de
// diagnóstico revienta justo cuando más lo necesitamos. Usamos fromCharCode(0)
// para no incrustar un byte nulo literal en el source.
const NULL_BYTE = String.fromCharCode(0);
export function stripNullBytes(s: string): string {
  return s.split(NULL_BYTE).join("");
}

// Ventana de captura del output crudo. El bloque ESTADO DEL LEAD NO es lo último
// del output (después vienen PROSPECTO/CHECKLIST/ETAPA_DETECTADA/DESCALIFICACION,
// varios instruidos "al final de tu respuesta" — verificado en claude.ts
// buildFullPrompt). Por eso anclamos en la ÚLTIMA ocurrencia de 'estado' y
// tomamos hacia adelante; si sobra espacio, rellenamos hacia atrás. Si 'estado'
// no aparece en absoluto, últimos `cap` chars.
export function buildRawOutputCapture(
  rawOutput: string,
  cap = 8000,
): { capture: string; truncated: boolean } {
  if (rawOutput.length <= cap) return { capture: rawOutput, truncated: false };

  const idx = rawOutput.toLowerCase().lastIndexOf("estado");
  let start: number;
  if (idx === -1) {
    // 'ESTADO' ausente → últimos `cap` chars
    start = rawOutput.length - cap;
  } else if (rawOutput.length - idx >= cap) {
    // desde la última 'ESTADO' hacia adelante caben `cap` chars
    start = idx;
  } else {
    // la cola desde 'ESTADO' es corta → rellenar hacia atrás hasta `cap`
    start = rawOutput.length - cap;
  }
  return { capture: rawOutput.slice(start, start + cap), truncated: true };
}

// Devuelve el objeto de diagnóstico, o null en el camino feliz (sin mismatch de
// fases ni lead faltante) — null = cero escritura a analysis_parser_debug.
// Sanea el null byte de los campos con PII (raw_estado, raw_output_capture) acá,
// en el único punto donde se arma la fila, antes de que llegue al insert.
export function buildParserDebug(input: {
  rawOutput: string;
  rawEstadoBlock: string | null;
  leadQuality: string | null;
  leadOutcome: string | null;
  promptHasEstado: boolean;
  phasesFoundIds: (string | null)[];
  phasesExpected: number;
  edgeVersion: string;
  // F47: columns esperadas cuyo LABEL no apareció en el output — ya filtradas
  // por filterExpectedMisses en el caller (solo lo que el prompt pidió).
  extractionMisses: string[];
  // F47: el prompt pidió DESCALIFICACION y el parser no leyó un array válido.
  descalParseFailed: boolean;
  // F48b: descarte confirmado con catálogo lead_dependent, pero faltó el
  // bloque EVALUACION DE DESCARTE o alguna fase pura → score_desempeno quedó
  // NULL. Se captura el raw para poder reconstruir qué emitió el modelo.
  descarteBlockMissing: boolean;
}): ParserDebugRow | null {
  const phasesFound = input.phasesFoundIds.length;
  const phasesMismatch = phasesFound < input.phasesExpected;
  // missingLead solo cuenta si el prompt pidió el bloque ESTADO DEL LEAD; si no,
  // lead_quality/outcome null es esperado, no una pérdida.
  const missingLead =
    input.promptHasEstado &&
    (input.leadQuality === null || input.leadOutcome === null);
  const missingProspect = input.extractionMisses.length > 0;

  // F47: CUALQUIER causa produce fila completa con raw capturado — capturar,
  // no solo alertar (1592fe97 del 24-jul es el contraejemplo: sin fila, el
  // raw se perdió para siempre).
  if (!phasesMismatch && !missingLead && !missingProspect && !input.descalParseFailed && !input.descarteBlockMissing) {
    return null;
  }

  // Orden canónico fijo — asserts deterministas y lectura estable de la tabla.
  const triggers: ParserDebugTrigger[] = [];
  if (missingLead) triggers.push("missing_lead");
  if (phasesMismatch) triggers.push("phases_mismatch");
  if (missingProspect) triggers.push("missing_prospect_extraction");
  if (input.descalParseFailed) triggers.push("descal_parse_failed");
  if (input.descarteBlockMissing) triggers.push("descarte_block_missing");

  const missingFields: string[] = [];
  if (input.promptHasEstado && input.leadQuality === null) missingFields.push("lead_quality");
  if (input.promptHasEstado && input.leadOutcome === null) missingFields.push("lead_outcome");
  missingFields.push(...input.extractionMisses);
  if (input.descalParseFailed) missingFields.push("descalificacion");
  if (input.descarteBlockMissing) missingFields.push("descarte");

  const { capture, truncated } = buildRawOutputCapture(input.rawOutput);

  return {
    triggers,
    missing_fields: missingFields,
    phases_expected: input.phasesExpected,
    phases_found: phasesFound,
    phases_found_ids: input.phasesFoundIds,
    raw_estado: input.rawEstadoBlock === null ? null : stripNullBytes(input.rawEstadoBlock),
    estado_header_missing: input.rawEstadoBlock === null,
    raw_output_capture: stripNullBytes(capture),
    raw_output_truncated: truncated,
    edge_version: input.edgeVersion,
  };
}

// F47: gate — un pattern declarado que el PROMPT nunca pidió no puede contar
// como pérdida (espejo del patrón promptHasEstado del caller). buildFullPrompt
// interpola los keys literales al prompt, así que includes(key) es señal
// exacta. Devuelve las columns afectadas.
export function filterExpectedMisses(
  misses: { key: string; column: string }[],
  systemPrompt: string,
): string[] {
  return misses.filter((m) => systemPrompt.includes(m.key)).map((m) => m.column);
}

// F47: org sin catálogo → el prompt no pide DESCALIFICACION y el null del
// parser se normaliza a [] (no es pérdida). Con catálogo, el null se preserva
// y dispara descal_parse_failed.
export function normalizeDescal(
  descal: string[] | null,
  promptHasDescal: boolean,
): string[] | null {
  return descal === null && !promptHasDescal ? [] : descal;
}

// F47: la fila EXACTA del INSERT se arma aquí (pura) para que el guard de la
// suite verifique el shape — en particular que la key legacy `trigger` NO va
// en el payload: este código escribe SOLO `triggers`. Orden duro de release:
// Migración F47 1/2 aplicada ANTES de deployar este código (sin la columna
// triggers en la tabla, el insert falla y el catch del caller pierde el
// diagnóstico).
export function buildParserDebugInsertRow(
  analysisId: string,
  row: ParserDebugRow,
): Record<string, unknown> {
  return {
    analysis_id: analysisId,
    triggers: row.triggers,
    missing_fields: row.missing_fields,
    phases_expected: row.phases_expected,
    phases_found: row.phases_found,
    phases_found_ids: row.phases_found_ids,
    raw_estado: row.raw_estado,
    estado_header_missing: row.estado_header_missing,
    raw_output_capture: row.raw_output_capture,
    raw_output_truncated: row.raw_output_truncated,
    edge_version: row.edge_version,
  };
}
