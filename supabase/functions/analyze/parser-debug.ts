// F46: diagnóstico de partial_extraction. Lógica PURA (sin I/O) para que sea
// unit-testeable sin DB. El detector en index.ts arma este objeto y lo pasa a
// db.writeParserDebug(). Se persiste en la tabla analysis_parser_debug (RLS
// deny-all, solo service_role) — contiene PII de prospectos, NUNCA va a Slack.

export interface ParserDebugRow {
  trigger: "missing_lead" | "phases_mismatch" | "both";
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
}): ParserDebugRow | null {
  const phasesFound = input.phasesFoundIds.length;
  const phasesMismatch = phasesFound < input.phasesExpected;
  // missingLead solo cuenta si el prompt pidió el bloque ESTADO DEL LEAD; si no,
  // lead_quality/outcome null es esperado, no una pérdida.
  const missingLead =
    input.promptHasEstado &&
    (input.leadQuality === null || input.leadOutcome === null);

  if (!phasesMismatch && !missingLead) return null;

  const trigger: ParserDebugRow["trigger"] =
    phasesMismatch && missingLead ? "both" : phasesMismatch ? "phases_mismatch" : "missing_lead";

  const missingFields: string[] = [];
  if (input.promptHasEstado && input.leadQuality === null) missingFields.push("lead_quality");
  if (input.promptHasEstado && input.leadOutcome === null) missingFields.push("lead_outcome");

  const { capture, truncated } = buildRawOutputCapture(input.rawOutput);

  return {
    trigger,
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
